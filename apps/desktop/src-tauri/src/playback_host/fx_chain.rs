//! An ordered series of audio-effect VSTs applied as inserts on one channel.
//!
//! The mixer hangs an [`FxChain`] on the reverb aux bus and on the master bus
//! (and, later, on each instrument strip): the channel's signal flows through
//! every plugin in turn, each plugin's output feeding the next. An empty chain is
//! a passthrough. This is the series-insert counterpart to the earlier
//! single-reverb design — that one plugin is now just the first entry of the
//! reverb channel's chain.
//!
//! [`configure_effect`] centralises the effect-plugin setup (rate/block,
//! stereo bus arrangement, activation, saved-state restore, editor-gated content
//! warm-up) that previously lived inline in the single-reverb load path, so every
//! plugin in every chain is prepared identically.

use std::time::Duration;

use vst3_host::audio::AudioBuffers;
use vst3_host::plugin::Plugin;
use vst3_host::Vst3Host;

use super::{BLOCK_SIZE, OUTPUT_CHANNELS, SAMPLE_RATE};

/// Which channel an FX chain hangs on. Instrument-strip inserts are a planned
/// follow-up; v1 covers the reverb aux bus and the master bus.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum FxChannel {
    Reverb,
    Master,
}

impl FxChannel {
    /// Parse the channel tag the frontend sends over IPC.
    pub(super) fn from_tag(tag: &str) -> Option<Self> {
        match tag {
            "reverb" => Some(Self::Reverb),
            "master" => Some(Self::Master),
            _ => None,
        }
    }

    /// The channel tag mirrored back to the frontend (e.g. in the close event).
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Reverb => "reverb",
            Self::Master => "master",
        }
    }
}

/// One effect plugin to load, with the optional serialized state to restore.
pub(super) struct EffectSpec {
    pub path: String,
    pub state: Option<Vec<u8>>,
}

/// Load and fully configure an audio-effect VST as a stereo insert: reconfigure
/// to the host rate/block, negotiate a stereo input/output arrangement, activate
/// and start processing, advertise transport-playing, restore any saved patch,
/// and warm up editor-gated content (a streaming convolution reverb only pulls
/// its impulse response when its editor first attaches). This mirrors the setup
/// the single shared reverb used to do inline; it is now shared by every plugin
/// in every chain. See the extended rationale in [`super::engine`]'s history.
pub(super) fn configure_effect(host: &mut Vst3Host, spec: &EffectSpec) -> Result<Plugin, String> {
    let mut plugin = host.load_plugin(&spec.path).map_err(|error| error.to_string())?;
    plugin
        .reconfigure(SAMPLE_RATE, BLOCK_SIZE)
        .map_err(|error| error.to_string())?;
    // Effects rely on the host to declare each bus's speaker arrangement; without
    // it many leave their input bus unconfigured and emit pure silence. The plugin
    // may decline and keep its own layout (harmless — the crate re-runs setup from
    // whatever it accepted), so a failure here is logged, not fatal.
    let arrangement = vec![vst3_host::audio::SpeakerArrangement::STEREO];
    if let Err(error) = plugin.set_bus_arrangements(&arrangement, &arrangement) {
        eprintln!(
            "[fx] set_bus_arrangements(stereo) failed for '{}': {error}; using default layout",
            spec.path
        );
    }
    plugin
        .start_processing()
        .map_err(|error| error.to_string())?;
    // An insert bus runs continuously (it must process while a tail rings out), so
    // advertise transport-playing; some effects gate their DSP on it. Best-effort.
    let _ = plugin.set_playing(true);
    // Restore the saved patch last, after every activation/bus-arrangement cycle:
    // a streaming convolution reverb kicks off an async IR load inside `setState`,
    // and an earlier `setActive(0)` would cancel it. Non-fatal: some effects only
    // accept state while inactive and reject it here, keeping their default patch.
    if let Some(bytes) = &spec.state {
        if let Err(error) = plugin.load_state(bytes) {
            eprintln!(
                "[fx] load_state failed for '{}': {error}; keeping default patch",
                spec.path
            );
        }
    }
    let info = plugin.info();
    eprintln!(
        "[fx] loaded '{}' — audio_inputs={} audio_outputs={} latency={} samples, state={}",
        info.name,
        info.audio_inputs,
        info.audio_outputs,
        plugin.latency_samples(),
        if spec.state.is_some() { "applied" } else { "default" },
    );
    // Trigger any editor-gated content load before the effect goes live (see
    // reverb_warmup). Harmless no-op for effects that don't need it.
    let plugin = super::reverb_warmup::warm_up_editor(
        plugin,
        Duration::from_millis(1500),
        SAMPLE_RATE,
        BLOCK_SIZE,
    );
    Ok(plugin)
}

/// An ordered list of effect plugins processed in series on one channel.
pub(super) struct FxChain {
    plugins: Vec<Plugin>,
    /// Reusable deinterleaved I/O for the per-plugin `process_audio` call. Kept
    /// here so no block allocates; one plugin's output is copied back into the
    /// signal buffer to become the next plugin's input.
    scratch: AudioBuffers,
    /// One-shot guard so a plugin erroring every block logs once, not per callback.
    process_error_logged: bool,
}

impl FxChain {
    /// An empty (passthrough) chain.
    pub(super) fn new() -> Self {
        Self {
            plugins: Vec::new(),
            scratch: AudioBuffers::new(OUTPUT_CHANNELS, OUTPUT_CHANNELS, BLOCK_SIZE, SAMPLE_RATE),
            process_error_logged: false,
        }
    }

    /// A chain over already-configured plugins (see [`configure_effect`]).
    pub(super) fn from_plugins(plugins: Vec<Plugin>) -> Self {
        Self {
            plugins,
            ..Self::new()
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.plugins.is_empty()
    }

    /// Borrow the plugin at `index` (for attaching its editor). `None` if absent.
    pub(super) fn plugin_mut(&mut self, index: usize) -> Option<&mut Plugin> {
        self.plugins.get_mut(index)
    }

    /// Process `io` (`[channel][frame]`) in place through each plugin in series.
    /// Empty chains leave `io` untouched; an errored plugin passes its input
    /// through unaffected so one bad insert can't silence the whole channel.
    pub(super) fn process(&mut self, io: &mut [Vec<f32>], channels: usize, frames: usize) {
        let Self {
            plugins,
            scratch,
            process_error_logged,
        } = self;
        if plugins.is_empty() {
            return;
        }
        ensure_frames(scratch, frames);
        for plugin in plugins.iter_mut() {
            let in_limit = scratch.inputs.len().min(io.len()).min(channels);
            // Indexing two parallel buffers (scratch.inputs / io) by the same channel.
            #[allow(clippy::needless_range_loop)]
            for ch in 0..in_limit {
                let dst = &mut scratch.inputs[ch];
                let src = &io[ch];
                let n = frames.min(dst.len()).min(src.len());
                dst[..n].copy_from_slice(&src[..n]);
            }
            for buf in scratch.outputs.iter_mut() {
                let n = frames.min(buf.len());
                buf[..n].fill(0.0);
            }
            if plugin.process_audio(scratch).is_ok() {
                let out_limit = channels.min(scratch.outputs.len()).min(io.len());
                // Indexing two parallel buffers (scratch.outputs / io) by the same channel.
                #[allow(clippy::needless_range_loop)]
                for ch in 0..out_limit {
                    let src = &scratch.outputs[ch];
                    let dst = &mut io[ch];
                    let n = frames.min(src.len()).min(dst.len());
                    dst[..n].copy_from_slice(&src[..n]);
                }
            } else if !*process_error_logged {
                *process_error_logged = true;
                eprintln!(
                    "[fx] a plugin returned an error from process_audio; passing its input \
                     through unaffected (check its bus arrangement / channel layout)"
                );
            }
        }
    }
}

/// Resize a scratch buffer's channels to exactly `frames` (clearing is done by the
/// caller before each plugin renders). Mirrors the mixer's own handling of a
/// device callback that requests a varying block size.
fn ensure_frames(scratch: &mut AudioBuffers, frames: usize) {
    for ch in scratch.inputs.iter_mut().chain(scratch.outputs.iter_mut()) {
        if ch.len() != frames {
            ch.resize(frames, 0.0);
        }
    }
    scratch.block_size = frames;
}

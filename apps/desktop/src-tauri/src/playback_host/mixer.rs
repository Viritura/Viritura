//! The single summing mixer: one output stream drives every instrument plugin.
//!
//! The earlier design gave each plugin its own cpal stream and let the OS sum
//! them; that left no point in the graph where all instruments meet, so there
//! was nowhere to hang a master gain or a shared reverb. This module opens **one**
//! device stream whose callback pulls every loaded plugin's audio in lock-step,
//! folds each through its channel strip (gain + reverb send), sums the dry signal
//! to a stereo master, runs the summed sends through one shared reverb effect and
//! returns its wet output into the master, applies the master gain, and writes the
//! interleaved result to the device.
//!
//! Concurrency follows the host crate's own correctness-first model: the plugins
//! live behind one [`Mutex`] that both the audio callback (to render) and the
//! host thread (to inject MIDI / change transport) lock. The callback holds it
//! only for the duration of a block render; the host thread holds it only for the
//! microseconds it takes to queue events, so contention is negligible in practice
//! (a future optimization can move MIDI onto per-slot lock-free rings).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use rayon::prelude::*;
use vst3_host::audio::{AudioBackend, AudioBuffers, AudioConfig, AudioStream};
use vst3_host::backends::CpalBackend;
use vst3_host::plugin::Plugin;

use super::fx_chain::{FxChain, FxChannel};
use super::sf2::Sf2Voice;
use super::{BLOCK_SIZE, OUTPUT_CHANNELS, SAMPLE_RATE};

/// The concrete stream type the cpal backend produces. Held on the host thread to
/// keep audio alive; dropping it stops the stream.
type MixerStream = <CpalBackend as AudioBackend>::Stream;

/// What actually produces a strip's audio: either a hosted VST instrument plugin
/// or a native SoundFont voice. Both are driven by the same scheduled-MIDI
/// pipeline and render into the strip's scratch, so the mix path treats them
/// identically — the only difference in native mode is which one voices a part.
pub(super) enum StripSource {
    /// Boxed alongside `Sf2` so neither variant dominates the enum size; a
    /// `Plugin` handle is a moderately large struct and there is exactly one
    /// source per loaded slot, so the indirection is free in practice.
    Vst(Box<Plugin>),
    /// Boxed: a SoundFont synthesizer is far larger than a `Plugin` handle, so
    /// boxing it keeps the enum (and every `Strip`) small.
    Sf2(Box<Sf2Voice>),
}

/// One instrument's channel strip: its source plus the mix controls the callback
/// applies to that source's output before summing into the master.
pub(super) struct Strip {
    source: StripSource,
    /// Linear output gain (1.0 = unity).
    gain: f32,
    /// Post-fader amount of this strip's signal fed to the shared reverb bus
    /// (0.0 = fully dry, 1.0 = the strip's post-gain signal sent at unity).
    reverb_send: f32,
    /// This strip's own render buffer (`[channel][frame]`). Owning it per-strip
    /// lets the render fan every source's `process_audio` out across worker
    /// threads with no shared buffer and no per-block allocation.
    scratch: AudioBuffers,
}

impl Strip {
    /// Update the mix controls the callback applies to this strip (used when a
    /// slot is reloaded with new send/gain without re-instantiating the source).
    pub(super) fn set_mix(&mut self, gain: f32, reverb_send: f32) {
        self.gain = gain;
        self.reverb_send = reverb_send;
    }

    /// Set only this strip's output gain (live fader move; leaves the send intact).
    pub(super) fn set_gain(&mut self, gain: f32) {
        self.gain = gain;
    }

    /// Queue a MIDI event for this strip's source at a sample offset within the
    /// next processed block (mirrors the old `AudioHandle::send_midi_at`). A
    /// SoundFont voice applies it immediately (block-boundary timing).
    pub(super) fn send_midi_at(&mut self, event: vst3_host::midi::MidiEvent, offset: i32) {
        match &mut self.source {
            StripSource::Vst(plugin) => {
                let _ = plugin.send_midi_event_at(event, offset);
            }
            StripSource::Sf2(voice) => apply_sf2_event(voice, event),
        }
    }

    /// Queue a MIDI event applied at the start of the next block.
    pub(super) fn send_midi(&mut self, event: vst3_host::midi::MidiEvent) {
        match &mut self.source {
            StripSource::Vst(plugin) => {
                let _ = plugin.send_midi_event(event);
            }
            StripSource::Sf2(voice) => apply_sf2_event(voice, event),
        }
    }

    /// Advertise transport play/stop to the source (some VSTs gate rendering on
    /// it; a SoundFont voice always renders, so this is a no-op there).
    pub(super) fn set_playing(&mut self, playing: bool) {
        if let StripSource::Vst(plugin) = &mut self.source {
            let _ = plugin.set_playing(playing);
        }
    }

    /// All-notes-off / reset for this source.
    pub(super) fn panic(&mut self) {
        match &mut self.source {
            StripSource::Vst(plugin) => {
                let _ = plugin.midi_panic();
            }
            StripSource::Sf2(voice) => voice.panic(),
        }
    }

    /// Set only this strip's reverb send (live level change; leaves gain intact).
    pub(super) fn set_reverb_send(&mut self, reverb_send: f32) {
        self.reverb_send = reverb_send;
    }

    /// Render one block into this strip's scratch: clear it, then let the source
    /// fill it. Called from the parallel render phase.
    fn render_block(&mut self, frames: usize) {
        let Self {
            source, scratch, ..
        } = self;
        resize_scratch(scratch, frames);
        for buf in scratch.outputs.iter_mut() {
            let n = frames.min(buf.len());
            buf[..n].fill(0.0);
        }
        match source {
            StripSource::Vst(plugin) => {
                let _ = plugin.process_audio(scratch);
            }
            StripSource::Sf2(voice) => voice.render(&mut scratch.outputs, frames),
        }
    }
}

/// Feed one dispatched MIDI event to a SoundFont voice, translating the host's
/// `MidiEvent` into the synth's note/controller calls. Non-note/CC events (which
/// the scheduled pipeline never emits) are ignored.
fn apply_sf2_event(voice: &mut Sf2Voice, event: vst3_host::midi::MidiEvent) {
    use vst3_host::midi::MidiEvent;
    match event {
        MidiEvent::NoteOn { note, velocity, .. } => voice.note_on(note, velocity),
        MidiEvent::NoteOff { note, .. } => voice.note_off(note),
        MidiEvent::ControlChange {
            controller, value, ..
        } => voice.control_change(controller, value),
        _ => {}
    }
}

/// The shared reverb aux bus: an [`FxChain`] fed the summed per-strip sends, whose
/// processed output is returned into the master. The first plugin is typically a
/// reverb; further plugins post-process the wet signal (e.g. an EQ after reverb).
struct Reverb {
    chain: FxChain,
    /// The working signal buffer (`[channel][frame]`): the summed send bus is
    /// copied in, run through the chain in place, then folded into the master.
    /// Kept here so it is reused every block.
    io: Vec<Vec<f32>>,
    /// Linear gain applied to the wet return before it folds into the master.
    wet: f32,
}

/// State shared between the audio callback and the host thread. Everything the
/// callback touches lives here behind the mixer's single lock.
pub(super) struct MixerCore {
    /// Loaded instrument strips, keyed by the score's stable slot id.
    strips: HashMap<String, Strip>,
    /// Linear master gain applied after summing (1.0 = unity).
    master_gain: f32,
    /// The shared reverb aux bus, or `None` when no reverb chain is configured.
    reverb: Option<Reverb>,
    /// Insert effects applied to the summed master before the master gain. Empty
    /// (passthrough) until the frontend installs a master chain.
    master_chain: FxChain,
    /// Reusable master accumulator, indexed `[channel][frame]`.
    master: Vec<Vec<f32>>,
    /// Reusable reverb-send accumulator, indexed `[channel][frame]`.
    send_bus: Vec<Vec<f32>>,
}

impl MixerCore {
    fn new() -> Self {
        Self {
            strips: HashMap::new(),
            master_gain: 1.0,
            reverb: None,
            master_chain: FxChain::new(),
            master: vec![vec![0.0; BLOCK_SIZE]; OUTPUT_CHANNELS],
            send_bus: vec![vec![0.0; BLOCK_SIZE]; OUTPUT_CHANNELS],
        }
    }

    /// Borrow a loaded strip mutably (for MIDI injection / transport).
    pub(super) fn strip_mut(&mut self, key: &str) -> Option<&mut Strip> {
        self.strips.get_mut(key)
    }

    /// Apply an action to every loaded strip (e.g. panic-all, set-playing-all).
    pub(super) fn for_each_strip(&mut self, mut f: impl FnMut(&mut Strip)) {
        for strip in self.strips.values_mut() {
            f(strip);
        }
    }

    /// Borrow the FX chain for a channel: the reverb aux chain (absent when no
    /// reverb is loaded) or the always-present master insert chain.
    pub(super) fn chain_mut(&mut self, channel: FxChannel) -> Option<&mut FxChain> {
        match channel {
            FxChannel::Reverb => self.reverb.as_mut().map(|reverb| &mut reverb.chain),
            FxChannel::Master => Some(&mut self.master_chain),
        }
    }

    /// Live-update the reverb levels: set every strip's send and the reverb's wet
    /// return. A no-op on the reverb wet when no reverb effect is loaded.
    pub(super) fn set_reverb_levels(&mut self, send: f32, wet: f32) {
        for strip in self.strips.values_mut() {
            strip.set_reverb_send(send);
        }
        if let Some(reverb) = &mut self.reverb {
            reverb.wet = wet;
        }
    }

    /// Render one interleaved block into `data` (frames × channels). Called from
    /// the real-time audio callback; must not allocate in steady state.
    fn render(&mut self, data: &mut [f32], channels: usize) {
        data.fill(0.0);
        if channels == 0 {
            return;
        }
        let frames = data.len() / channels;

        // Split-borrow the fields the render touches so the parallel plugin phase
        // and the serial mix phase can use the strip map and mix buffers together.
        let Self {
            strips,
            master_gain,
            reverb,
            master_chain,
            master,
            send_bus,
            ..
        } = self;

        for ch in master.iter_mut().chain(send_bus.iter_mut()) {
            if ch.len() < frames {
                ch.resize(frames, 0.0);
            }
            ch[..frames].fill(0.0);
        }

        // 1a) Render every source in parallel, each into its own scratch buffer.
        //     `render_block` is the expensive part (a full sampler/plugin voice
        //     render); the strips are independent, so fanning them across worker
        //     threads turns an O(N) serial sum on one core into O(N / cores). Each
        //     strip owns its scratch, so the closures touch disjoint memory — no
        //     locks, no shared buffer, no per-block allocation. An errored plugin
        //     leaves its (freshly cleared) scratch silent, contributing zero.
        strips
            .par_iter_mut()
            .for_each(|(_, strip)| strip.render_block(frames));

        // 1b) Serially fold each strip's rendered output into the master (dry) and
        //     the reverb send bus (scaled by the strip's send). This is a cheap
        //     add pass — not the bottleneck — so it stays single-threaded to keep
        //     the accumulation deterministic.
        for strip in strips.values() {
            let limit = channels.min(strip.scratch.outputs.len());
            let send = strip.gain * strip.reverb_send;
            for ch in 0..limit {
                let src = &strip.scratch.outputs[ch];
                let n = frames.min(src.len());
                for f in 0..n {
                    master[ch][f] += src[f] * strip.gain;
                    send_bus[ch][f] += src[f] * send;
                }
            }
        }

        // 2) Run the reverb chain over the summed send bus and fold its processed
        //    return into the master. Skipped entirely when no reverb chain is
        //    configured (or the chain is empty), keeping a fully dry send silent.
        if let Some(reverb) = reverb {
            if !reverb.chain.is_empty() {
                resize_signal(&mut reverb.io, channels, frames);
                let copy_limit = reverb.io.len().min(send_bus.len());
                // Indexing two parallel buffers (reverb.io / send_bus) by the same channel.
                #[allow(clippy::needless_range_loop)]
                for ch in 0..copy_limit {
                    let dst = &mut reverb.io[ch];
                    let src = &send_bus[ch];
                    let n = frames.min(dst.len()).min(src.len());
                    dst[..n].copy_from_slice(&src[..n]);
                }
                reverb.chain.process(&mut reverb.io, channels, frames);
                let out_limit = channels.min(reverb.io.len());
                for (ch, dst) in master.iter_mut().enumerate().take(out_limit) {
                    let src = &reverb.io[ch];
                    let n = frames.min(src.len());
                    for f in 0..n {
                        dst[f] += src[f] * reverb.wet;
                    }
                }
            }
        }

        // 3) Run the master insert chain over the summed (dry + wet) master, in
        //    place. A passthrough when no master chain is installed.
        master_chain.process(master, channels, frames);

        // 4) Master gain, then interleave to the device buffer.
        let gain = *master_gain;
        for ch in 0..channels.min(master.len()) {
            let src = &master[ch];
            for f in 0..frames.min(src.len()) {
                data[f * channels + ch] = src[f] * gain;
            }
        }
    }
}

/// Resize a scratch buffer's channels to exactly `frames` (clearing is done by the
/// caller before each plugin renders). Mirrors the host crate's own handling of a
/// device callback that requests a varying block size.
fn resize_scratch(scratch: &mut AudioBuffers, frames: usize) {
    for ch in &mut scratch.outputs {
        if ch.len() != frames {
            ch.resize(frames, 0.0);
        }
    }
    for ch in &mut scratch.inputs {
        if ch.len() != frames {
            ch.resize(frames, 0.0);
        }
    }
    scratch.block_size = frames;
}

/// Resize a deinterleaved signal buffer to `channels` × `frames`, clearing it.
/// Used for the reverb chain's working buffer, which is refilled from the send
/// bus each block.
fn resize_signal(buffer: &mut Vec<Vec<f32>>, channels: usize, frames: usize) {
    if buffer.len() != channels {
        buffer.resize_with(channels, || vec![0.0; frames]);
    }
    for ch in buffer.iter_mut() {
        if ch.len() != frames {
            ch.resize(frames, 0.0);
        }
    }
}

/// Owns the single output stream and the shared plugin graph behind it.
pub(super) struct Mixer {
    backend: CpalBackend,
    core: Arc<Mutex<MixerCore>>,
    /// The one live output stream; `None` while idle (no device held).
    stream: Option<MixerStream>,
}

impl Mixer {
    pub(super) fn new() -> Result<Self, String> {
        let backend = CpalBackend::new().map_err(|error| error.to_string())?;
        Ok(Self {
            backend,
            core: Arc::new(Mutex::new(MixerCore::new())),
            stream: None,
        })
    }

    /// Lock the shared graph. Held briefly by the host thread for MIDI/transport;
    /// held by the audio callback for the length of a block render.
    pub(super) fn lock(&self) -> MutexGuard<'_, MixerCore> {
        self.core
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Insert (or replace) a strip for `key`. The source must already be
    /// configured and processing; the running callback picks it up next block.
    pub(super) fn insert(&self, key: String, source: StripSource, gain: f32, reverb_send: f32) {
        self.lock().strips.insert(
            key,
            Strip {
                source,
                gain,
                reverb_send,
                scratch: AudioBuffers::new(0, OUTPUT_CHANNELS, BLOCK_SIZE, SAMPLE_RATE),
            },
        );
    }

    /// Install the reverb aux chain. The plugins must already be configured and
    /// processing (see [`super::fx_chain::configure_effect`]). An empty list clears
    /// the reverb. Replaces any prior chain; the callback picks it up next block.
    pub(super) fn set_reverb_chain(&self, plugins: Vec<Plugin>, wet: f32) {
        let mut core = self.lock();
        if plugins.is_empty() {
            core.reverb = None;
            return;
        }
        core.reverb = Some(Reverb {
            chain: FxChain::from_plugins(plugins),
            io: vec![vec![0.0; BLOCK_SIZE]; OUTPUT_CHANNELS],
            wet,
        });
    }

    /// Install the master insert chain. The plugins must already be configured and
    /// processing. An empty list makes the master a passthrough (no inserts).
    pub(super) fn set_master_chain(&self, plugins: Vec<Plugin>) {
        self.lock().master_chain = FxChain::from_plugins(plugins);
    }

    /// The preferred editor size of the plugin at `index` in `channel`'s chain, or
    /// `None` when the chain/plugin is absent or exposes no editor.
    pub(super) fn fx_editor_size(&self, channel: FxChannel, index: usize) -> Option<(i32, i32)> {
        let mut core = self.lock();
        let plugin = core.chain_mut(channel)?.plugin_mut(index)?;
        if !plugin.has_editor() {
            return None;
        }
        plugin.get_editor_size().ok()
    }

    /// Attach the editor of the plugin at `index` in `channel`'s chain to the
    /// `parent` native window. The editor (IPlugView) and the processor
    /// (IAudioProcessor) are distinct VST3 interfaces meant for concurrent
    /// UI/audio-thread use, and this brief lock serialises the attach against the
    /// audio callback, so tweaks affect the plugin the mixer is already processing.
    pub(super) fn open_fx_editor(
        &self,
        channel: FxChannel,
        index: usize,
        parent: vst3_host::WindowHandle,
    ) -> Result<(), String> {
        let mut core = self.lock();
        let plugin = core
            .chain_mut(channel)
            .and_then(|c| c.plugin_mut(index))
            .ok_or("no plugin at that chain position")?;
        plugin.open_editor(parent).map_err(|error| error.to_string())
    }

    /// Detach the editor of the plugin at `index` in `channel`'s chain and return
    /// its serialized state so the caller can persist the user's edits. `None`
    /// when the chain/plugin is absent.
    pub(super) fn close_fx_editor_and_save(
        &self,
        channel: FxChannel,
        index: usize,
    ) -> Option<Vec<u8>> {
        let mut core = self.lock();
        let plugin = core.chain_mut(channel)?.plugin_mut(index)?;
        let _ = plugin.close_editor();
        plugin.save_state().ok()
    }

    /// Live-update reverb send (all strips) and wet return without reloading.
    pub(super) fn set_reverb_levels(&self, send: f32, wet: f32) {
        self.lock().set_reverb_levels(send, wet);
    }

    /// Live-update one strip's output gain (a fader move while playing). No-op if
    /// the slot isn't loaded.
    pub(super) fn set_gain(&self, key: &str, gain: f32) {
        if let Some(strip) = self.lock().strip_mut(key) {
            strip.set_gain(gain);
        }
    }

    /// Remove a strip, returning true if one was present.
    pub(super) fn remove(&self, key: &str) -> bool {
        self.lock().strips.remove(key).is_some()
    }

    /// Open the single output stream if it is not already running. Safe to call
    /// repeatedly; a no-op once the stream exists.
    pub(super) fn ensure_stream(&mut self) -> Result<(), String> {
        if self.stream.is_some() {
            return Ok(());
        }
        let device = self
            .backend
            .default_output_device()
            .ok_or_else(|| "no default output device available".to_string())?;
        let config = AudioConfig {
            sample_rate: SAMPLE_RATE,
            block_size: BLOCK_SIZE,
            input_channels: 0,
            output_channels: OUTPUT_CHANNELS,
            ..AudioConfig::default()
        };
        let core = Arc::clone(&self.core);
        let data_cb = Box::new(move |data: &mut [f32]| {
            let mut core = core.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            core.render(data, OUTPUT_CHANNELS);
        });
        let err_cb = Box::new(|error: <CpalBackend as AudioBackend>::Error| {
            eprintln!("mixer stream error: {error}");
        });
        let stream = self
            .backend
            .create_output_stream(&device, config, data_cb, err_cb)
            .map_err(|error| error.to_string())?;
        stream.play().map_err(|error| error.to_string())?;
        self.stream = Some(stream);
        Ok(())
    }

    /// Stop the stream and unload every plugin, freeing the audio device.
    pub(super) fn shutdown(&mut self) {
        // Drop the stream first so no further callback touches the plugins, then
        // clear them (instruments and the reverb effect).
        self.stream = None;
        let mut core = self.lock();
        core.strips.clear();
        core.reverb = None;
    }
}

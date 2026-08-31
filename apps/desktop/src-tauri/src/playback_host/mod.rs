//! Persistent VST playback host: per-slot plugin instances driven by transport.
//!
//! Phase 5 playback wiring (§3.4–3.6). The frontend, over Tauri IPC, hands the
//! host the precompiled per-slot MIDI for the slots the open score references
//! ([`load`]), then drives transport ([`start`]/[`stop`]/[`seek`]); the host
//! keeps one plugin instance per slot alive across plays and mixes their audio
//! straight to the output device (each instance streams through cpal; the OS
//! combines them, §3.6). All the plugin state that cannot cross threads lives on
//! one dedicated worker thread ([`engine`]); this module is only the thread's
//! lazily-spawned command channel plus the thin request/reply wrappers the Tauri
//! commands call.
//!
//! Desktop-only. Web builds never invoke these commands (the VST path is no-op
//! and falls back to SoundFont, §3.8).

mod engine;
mod fx_chain;
mod mixer;
mod reverb_editor;
mod reverb_warmup;
mod schedule;
mod sf2;

use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use tauri::AppHandle;

use engine::HostCommand;
use schedule::PartScheduledMidi;

/// Output stream sample rate. Every plugin is reconfigured to this so samplers
/// don't play detuned against the device clock.
const SAMPLE_RATE: f64 = 48_000.0;
/// Maximum frames per processed block; the device callback may request fewer.
const BLOCK_SIZE: usize = 512;
/// Stereo output.
const OUTPUT_CHANNELS: usize = 2;

/// Which engine voices a slot: a hosted VST plugin, or a native SoundFont voice
/// (the desktop "native" render mode's replacement for the browser SF2 path).
#[derive(Debug, Deserialize, Default, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum SlotKind {
    #[default]
    Vst,
    Sf2,
}

/// One plugin in an FX chain: which effect to load and its captured state.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSpec {
    /// Absolute path to the effect plugin binary to instantiate.
    pub plugin_path: String,
    /// Serialized VST3 component state to restore into it, if any.
    #[serde(default)]
    pub state: Option<Vec<u8>>,
}

/// One slot the open score references: which plugin to load, its captured state,
/// and the fully precompiled MIDI (mapper output) to play for it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotSpec {
    /// Stable per-score slot identifier (profile + instrument slot).
    pub slot_key: String,
    /// Whether this slot is voiced by a VST plugin or a native SoundFont voice.
    #[serde(default)]
    pub kind: SlotKind,
    /// Absolute path to the plugin binary to instantiate (VST slots only).
    #[serde(default)]
    pub plugin_path: String,
    /// Absolute path to the SoundFont file to voice this slot (SF2 slots only).
    #[serde(default)]
    pub soundfont_path: Option<String>,
    /// GM program number for a SoundFont voice (SF2 slots only).
    #[serde(default)]
    pub program: u8,
    /// Whether this SoundFont voice is a percussion kit (plays on GM channel 10).
    #[serde(default)]
    pub is_drum: bool,
    /// Content-addressed plugin state captured via edit-and-listen (§1.9), if any.
    #[serde(default)]
    pub state: Option<Vec<u8>>,
    /// The slot's precompiled scheduled MIDI for the loaded score, each event
    /// tagged with its source part so the host can mute/solo individual parts.
    #[serde(default)]
    pub events: Vec<PartScheduledMidi>,
    /// Linear output gain for this slot's strip (1.0 = unity).
    #[serde(default = "unit_gain")]
    pub gain: f32,
    /// Post-fader amount of this slot's signal sent to the shared reverb bus
    /// (0.0 = fully dry).
    #[serde(default)]
    pub reverb_send: f32,
}

impl SlotSpec {
    /// Stable identity used to decide whether a loaded slot can be reused (just
    /// refresh its schedule) or must be re-instantiated. For a VST that's the
    /// plugin path; for a SoundFont voice it's the font + program + kit, so
    /// switching a part's instrument forces a rebuild but replaying the same one
    /// reuses the voice.
    pub fn reuse_identity(&self) -> String {
        match self.kind {
            SlotKind::Vst => self.plugin_path.clone(),
            SlotKind::Sf2 => format!(
                "sf2|{}|{}|{}",
                self.soundfont_path.as_deref().unwrap_or(""),
                self.program,
                self.is_drum
            ),
        }
    }
}

/// Serde default for [`SlotSpec::gain`]: unity, so a spec that omits the field
/// (older frontends) plays at full level rather than silent.
fn unit_gain() -> f32 {
    1.0
}

/// Tauri-managed handle to the playback host thread.
///
/// The thread is spawned on first use and owns every plugin; this struct holds
/// only the command sender (which is `Send + Sync`), so it can live in shared
/// state while the plugins stay pinned to their thread.
#[derive(Default)]
pub struct PlaybackHost {
    sender: Mutex<Option<Sender<HostCommand>>>,
    /// App handle used by the host worker to emit load-progress events. Set once
    /// during Tauri setup, before any playback command can run.
    app_handle: OnceLock<AppHandle>,
}

impl PlaybackHost {
    /// Record the Tauri app handle so the (lazily-spawned) host worker can emit
    /// load-progress events. Idempotent; call once during setup.
    pub fn set_app_handle(&self, app: AppHandle) {
        let _ = self.app_handle.set(app);
    }

    /// Return the host thread's command sender, spawning the thread on first use.
    fn sender(&self) -> Result<Sender<HostCommand>, String> {
        let mut guard = self.sender.lock().map_err(|_| DEAD.to_owned())?;
        if let Some(sender) = guard.as_ref() {
            return Ok(sender.clone());
        }
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(0);
        let app = self.app_handle.get().cloned();
        std::thread::Builder::new()
            .name("viritura-vst-host".to_owned())
            .spawn(move || engine::run(rx, ready_tx, app))
            .map_err(|error| error.to_string())?;
        ready_rx.recv().map_err(|_| DEAD.to_owned())??;
        *guard = Some(tx.clone());
        Ok(tx)
    }
}

const DEAD: &str = "the VST playback host is not running";

/// Instantiate/refresh the referenced slots and load their precompiled MIDI.
pub fn load(host: &PlaybackHost, slots: Vec<SlotSpec>) -> Result<(), String> {
    let (reply, rx) = mpsc::channel();
    host.sender()?
        .send(HostCommand::Load { slots, reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Prune the loaded slot set to exactly `keys`, unloading any slot not listed.
/// No-op when the host thread has not started yet (nothing is loaded, so there
/// is nothing to prune). Sent after `load` to drop a slot whose part changed
/// voicing, which would otherwise keep sounding as a doubled voice.
pub fn retain(host: &PlaybackHost, keys: Vec<String>) -> Result<(), String> {
    let sender = {
        let guard = host.sender.lock().map_err(|_| DEAD.to_owned())?;
        match guard.as_ref() {
            Some(sender) => sender.clone(),
            None => return Ok(()),
        }
    };
    let (reply, rx) = mpsc::channel();
    sender
        .send(HostCommand::Retain { keys, reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Begin transport at `origin_seconds`; returns the new transport generation id.
pub fn start(host: &PlaybackHost, origin_seconds: f64) -> Result<u64, String> {
    let (reply, rx) = mpsc::channel();
    host.sender()?
        .send(HostCommand::Start {
            origin_seconds,
            reply,
        })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Halt transport and flush all notes; instances stay loaded for the next play.
pub fn stop(host: &PlaybackHost) -> Result<(), String> {
    let (reply, rx) = mpsc::channel();
    host.sender()?
        .send(HostCommand::Stop { reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Move the transport to `seconds`; returns the new transport generation id.
pub fn seek(host: &PlaybackHost, seconds: f64) -> Result<u64, String> {
    let (reply, rx) = mpsc::channel();
    host.sender()?
        .send(HostCommand::Seek { seconds, reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Unload every plugin instance (e.g. on score close or profile change).
pub fn release_all(host: &PlaybackHost) -> Result<(), String> {
    let (reply, rx) = mpsc::channel();
    host.sender()?
        .send(HostCommand::ReleaseAll { reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Set which parts are muted, silencing their events at the host without a
/// reload. No-op when the host thread has not been started yet: playback re-sends
/// the current mute set on the next `start`, so a mute toggled before anything
/// plays needn't spin up the audio host.
pub fn set_muted(host: &PlaybackHost, parts: Vec<u32>) -> Result<(), String> {
    let sender = {
        let guard = host.sender.lock().map_err(|_| DEAD.to_owned())?;
        match guard.as_ref() {
            Some(sender) => sender.clone(),
            None => return Ok(()),
        }
    };
    let (reply, rx) = mpsc::channel();
    sender
        .send(HostCommand::SetMuted { parts, reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Install, replace, or clear the reverb aux chain. An empty `plugins` list clears
/// it. Spawns the host thread if needed so the chain can be configured before the
/// first play (the effects render whenever instruments feed them a send).
pub fn set_reverb_chain(
    host: &PlaybackHost,
    plugins: Vec<PluginSpec>,
    wet: f32,
) -> Result<(), String> {
    let (reply, rx) = mpsc::channel();
    host.sender()?
        .send(HostCommand::SetReverbChain {
            plugins,
            wet,
            reply,
        })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Install or clear the master insert chain (an empty list is a passthrough).
/// Spawns the host thread if needed so the chain can be configured before play.
pub fn set_master_chain(host: &PlaybackHost, plugins: Vec<PluginSpec>) -> Result<(), String> {
    let (reply, rx) = mpsc::channel();
    host.sender()?
        .send(HostCommand::SetMasterChain { plugins, reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Live-update the reverb send (all strips) and wet return without reloading.
///
/// No-op when the host thread has not started yet (nothing is playing, so there
/// is nothing to adjust — the next `prepare`/`set_reverb_chain` applies the stored
/// values). This keeps a slider drag from spinning up the audio host.
pub fn set_reverb_levels(host: &PlaybackHost, send: f32, wet: f32) -> Result<(), String> {
    let sender = {
        let guard = host.sender.lock().map_err(|_| DEAD.to_owned())?;
        match guard.as_ref() {
            Some(sender) => sender.clone(),
            None => return Ok(()),
        }
    };
    let (reply, rx) = mpsc::channel();
    sender
        .send(HostCommand::SetReverbLevels { send, wet, reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Open the editor of one plugin in a channel's FX chain in a modeless window on
/// the host thread, so it can be tweaked while playback runs without freezing the
/// UI. The chain must already be loaded (the frontend installs it first). Errs on
/// an unknown channel tag or when the host thread has not started.
pub fn show_fx_editor(host: &PlaybackHost, channel: &str, index: usize) -> Result<(), String> {
    let channel = fx_chain::FxChannel::from_tag(channel)
        .ok_or_else(|| format!("unknown FX channel '{channel}'"))?;
    let (reply, rx) = mpsc::channel();
    host.sender()?
        .send(HostCommand::ShowFxEditor {
            channel,
            index,
            reply,
        })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Close the open FX editor if any, persisting the plugin's edited state (the
/// close event carrying the state bytes is emitted from the host thread). No-op
/// when the host thread has not started yet (nothing is open).
pub fn close_fx_editor(host: &PlaybackHost) -> Result<(), String> {
    let sender = {
        let guard = host.sender.lock().map_err(|_| DEAD.to_owned())?;
        match guard.as_ref() {
            Some(sender) => sender.clone(),
            None => return Ok(()),
        }
    };
    let (reply, rx) = mpsc::channel();
    sender
        .send(HostCommand::CloseFxEditor { reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Live-update one slot's output gain (a mixer fader move) without reloading.
///
/// No-op when the host thread has not started yet (nothing is playing), matching
/// [`set_reverb_levels`]: the gain is baked into the next `load` spec anyway, so a
/// fader nudged before playback needn't spin up the audio host.
pub fn set_gain(host: &PlaybackHost, slot_key: String, gain: f32) -> Result<(), String> {
    let sender = {
        let guard = host.sender.lock().map_err(|_| DEAD.to_owned())?;
        match guard.as_ref() {
            Some(sender) => sender.clone(),
            None => return Ok(()),
        }
    };
    let (reply, rx) = mpsc::channel();
    sender
        .send(HostCommand::SetGain {
            slot_key,
            gain,
            reply,
        })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Play one note immediately on a loaded slot (click-to-hear preview), releasing
/// it after `duration_ms`. No-op when the host thread has not started yet.
pub fn preview(
    host: &PlaybackHost,
    slot_key: String,
    note: u8,
    velocity: u8,
    duration_ms: u64,
) -> Result<(), String> {
    let sender = {
        let guard = host.sender.lock().map_err(|_| DEAD.to_owned())?;
        match guard.as_ref() {
            Some(sender) => sender.clone(),
            None => return Ok(()),
        }
    };
    let (reply, rx) = mpsc::channel();
    sender
        .send(HostCommand::Preview {
            slot_key,
            note,
            velocity,
            duration_ms,
            reply,
        })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

/// Release all instances, but only if the host thread has already been started.
///
/// Used before opening the edit-and-listen editor: playback and edit-and-listen
/// both host the plugin in-process and open the audio device, and running them
/// at once deadlocks (device + plugin-global contention), so playback must free
/// the device and unload its plugins first. Unlike [`release_all`] this never
/// spawns the host thread just to tear it down — it is a no-op when nothing has
/// played yet.
pub fn release_if_running(host: &PlaybackHost) -> Result<(), String> {
    let sender = {
        let guard = host.sender.lock().map_err(|_| DEAD.to_owned())?;
        match guard.as_ref() {
            Some(sender) => sender.clone(),
            None => return Ok(()),
        }
    };
    let (reply, rx) = mpsc::channel();
    sender
        .send(HostCommand::ReleaseAll { reply })
        .map_err(|_| DEAD.to_owned())?;
    rx.recv().map_err(|_| DEAD.to_owned())?
}

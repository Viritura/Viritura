//! The single OS thread that owns every live plugin and drives transport.
//!
//! VST3 plugin instances wrap COM pointers and cannot live in Tauri's shared
//! managed state, so one dedicated thread owns them for their whole life and is
//! spoken to over a channel ([`HostCommand`]); the frontend never touches a
//! plugin directly. This thread owns the [`Mixer`] — one output stream summing
//! every plugin — and keeps all transport/sequencing state here beside it.
//!
//! The thread interleaves two jobs on a short tick: it drains transport commands
//! and, while playing, pumps any MIDI now due onto each slot's plugin (by briefly
//! locking the mixer graph and queueing events on the plugin). It never *is* the
//! real-time audio thread — that is the mixer's cpal callback — so a
//! couple-millisecond tick here only bounds scheduling granularity, which the
//! per-event sample offset then refines to within the current audio block.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rustysynth::SoundFont;
use tauri::{AppHandle, Emitter};
use vst3_host::plugin::Plugin;
use vst3_host::{MidiChannel, MidiEvent, Vst3Host};

use super::fx_chain::{configure_effect, EffectSpec, FxChannel};
use super::mixer::{Mixer, Strip, StripSource};
use super::reverb_editor::ReverbEditorWindow;
use super::schedule::{plan_seek, resolve_schedule, ResolvedEvent, ResolvedMidi};
use super::sf2::{load_soundfont, Sf2Voice};
use super::SlotSpec;
use super::{SlotKind, BLOCK_SIZE, OUTPUT_CHANNELS, SAMPLE_RATE};

/// How often the host thread wakes to dispatch due MIDI when no command arrives.
const TICK: Duration = Duration::from_millis(2);

/// How far ahead of the transport clock an event is handed to the plugin. Kept to
/// one audio block so `send_midi_at`'s sample offset (which only addresses the
/// next block) stays meaningful; events further out wait for a later tick.
const LOOKAHEAD_SECONDS: f64 = BLOCK_SIZE as f64 / SAMPLE_RATE;

/// Event name for plugin-load progress, mirrored by the desktop frontend's
/// load-progress toast (`vstLoadProgress.ts`).
const LOAD_PROGRESS_EVENT: &str = "vst-load-progress";

/// Event name for an FX editor being closed, carrying the plugin's edited state
/// so the frontend can persist it (`fxChainState.ts`).
const FX_EDITOR_CLOSED_EVENT: &str = "vst-fx-editor-closed";

/// A closed FX editor's serialized plugin state, tagged with which chain slot it
/// belongs to so the frontend persists it against the right entry.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FxEditorClosed {
    channel: &'static str,
    index: usize,
    state: Vec<u8>,
}

/// One plugin-load progress tick emitted to the frontend. `phase` is `"loading"`
/// as each instrument starts instantiating and `"done"` once the batch finishes;
/// `loaded`/`total` count instruments in this load, `slot_key` identifies the
/// slot being loaded (so the frontend can show its instrument name), and `name`
/// is the plugin's file name as a fallback (both empty on `"done"`).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadProgress {
    phase: &'static str,
    loaded: usize,
    total: usize,
    slot_key: String,
    name: String,
}

/// Emit a load-progress tick when an app handle is available (always, at
/// runtime; `None` only in headless tests). Emission failures are non-fatal.
fn emit_load_progress(
    app: &Option<AppHandle>,
    phase: &'static str,
    loaded: usize,
    total: usize,
    slot_key: &str,
    name: &str,
) {
    if let Some(app) = app {
        let _ = app.emit(
            LOAD_PROGRESS_EVENT,
            LoadProgress {
                phase,
                loaded,
                total,
                slot_key: slot_key.to_owned(),
                name: name.to_owned(),
            },
        );
    }
}

/// A slot's human-readable name for the loading UI: a VST's file stem, or a
/// generic label for a native SoundFont voice (the frontend supplies the real
/// instrument label; this is only a fallback).
fn slot_display_name(spec: &SlotSpec) -> String {
    match spec.kind {
        SlotKind::Vst => Path::new(&spec.plugin_path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(str::to_owned)
            .unwrap_or_else(|| spec.plugin_path.clone()),
        SlotKind::Sf2 => "SoundFont".to_owned(),
    }
}

/// A message to the host thread. Every request carries a reply channel so the
/// calling Tauri command blocks until the thread has applied it.
pub(super) enum HostCommand {
    Load {
        slots: Vec<SlotSpec>,
        reply: Sender<Result<(), String>>,
    },
    /// Prune the loaded slot set to exactly `keys`, unloading any slot whose key
    /// is absent. Sent after a `Load` so a part that changed voicing (e.g. from
    /// the native SoundFont strip to a VST) doesn't leave its old strip playing
    /// in perfect sync with the new one.
    Retain {
        keys: Vec<String>,
        reply: Sender<Result<(), String>>,
    },
    Start {
        origin_seconds: f64,
        reply: Sender<Result<u64, String>>,
    },
    Stop {
        reply: Sender<Result<(), String>>,
    },
    Seek {
        seconds: f64,
        reply: Sender<Result<u64, String>>,
    },
    ReleaseAll {
        reply: Sender<Result<(), String>>,
    },
    /// Replace the set of muted part indices, silencing any now-muted note that
    /// is currently sounding and dropping their future events until unmuted.
    SetMuted {
        parts: Vec<u32>,
        reply: Sender<Result<(), String>>,
    },
    /// Install, replace, or clear the reverb aux chain. An empty `plugins` list
    /// removes the reverb; otherwise the given effect VSTs are loaded in order and
    /// the summed per-strip sends flow through them in series.
    SetReverbChain {
        plugins: Vec<super::PluginSpec>,
        wet: f32,
        reply: Sender<Result<(), String>>,
    },
    /// Install or clear the master insert chain (an empty list is a passthrough).
    SetMasterChain {
        plugins: Vec<super::PluginSpec>,
        reply: Sender<Result<(), String>>,
    },
    /// Live-update the reverb levels without reloading: set every strip's send to
    /// `send` and the reverb's wet return to `wet`. A cheap mutation applied on
    /// the next audio block, so slider drags are audible while playing.
    SetReverbLevels {
        send: f32,
        wet: f32,
        reply: Sender<Result<(), String>>,
    },
    /// Live-update one slot's output gain (a mixer fader move). Applied on the
    /// next audio block so the change is audible immediately while playing.
    SetGain {
        slot_key: String,
        gain: f32,
        reply: Sender<Result<(), String>>,
    },
    /// Open the editor of one plugin in a channel's FX chain, in a modeless
    /// host-thread window pumped non-blocking from the tick loop so playback and
    /// the Viritura UI keep running while it is open. The chain must already be
    /// loaded (the frontend installs it first).
    ShowFxEditor {
        channel: FxChannel,
        index: usize,
        reply: Sender<Result<(), String>>,
    },
    /// Close the open FX editor if any, emitting its edited state to the frontend.
    CloseFxEditor {
        reply: Sender<Result<(), String>>,
    },
    /// Play one note on a slot immediately (click-to-hear), releasing it after
    /// `duration_ms`, so a preview sounds exactly like playback (VST + reverb).
    Preview {
        slot_key: String,
        note: u8,
        velocity: u8,
        duration_ms: u64,
        reply: Sender<Result<(), String>>,
    },
}

/// One note the host has sent a note-on for and not yet a note-off, tracked per
/// slot so muting a part mid-note can send an immediate note-off for it.
#[derive(Clone, Copy)]
struct ActiveNote {
    part: u32,
    channel: u8,
    note: u8,
}

/// One loaded plugin's *sequencing* state, kept on the host thread. The source
/// itself lives in the [`Mixer`] (keyed by the same slot id); this tracks where
/// the transport is in that slot's schedule and which of its notes are sounding.
struct SlotSeq {
    /// Reuse identity of the loaded source (see [`SlotSpec::reuse_identity`]) —
    /// the plugin path for a VST, or font+program+kit for a SoundFont voice.
    identity: String,
    schedule: Vec<ResolvedEvent>,
    /// Index of the next event to dispatch in the current transport epoch.
    cursor: usize,
    /// Notes currently sounding (note-on sent, note-off not yet), for instant mute.
    active: Vec<ActiveNote>,
}

/// A preview note-off the host owes a strip at `due`, so a click-to-hear note
/// released after its duration even while the transport is stopped.
struct PreviewOff {
    due: Instant,
    slot_key: String,
    channel: u8,
    note: u8,
}

struct Engine {
    host: Vst3Host,
    mixer: Mixer,
    slots: HashMap<String, SlotSeq>,
    playing: bool,
    origin_seconds: f64,
    start_instant: Option<Instant>,
    /// Part indices the mixer has muted (or soloed-out); their events are dropped
    /// at dispatch. Kept across loads/plays until the frontend replaces it.
    muted_parts: HashSet<u32>,
    /// Monotonic transport-epoch id (play/stop/seek). Returned to the frontend so
    /// it can discard stale replies (§3.5).
    generation: u64,
    /// App handle for emitting load-progress events, or `None` in headless tests.
    app: Option<AppHandle>,
    /// Parsed SoundFonts shared across native SF2 voices, keyed by file path.
    /// Parsing a full GM font is expensive, so each is loaded once and reused.
    soundfonts: HashMap<String, Arc<SoundFont>>,
    /// Pending preview note-offs, released on their `due` tick regardless of play.
    previews: Vec<PreviewOff>,
    /// Open modeless FX editor windows, each tagged with which chain plugin it
    /// hosts. Pumped each tick; when the user closes one, that plugin's state is
    /// captured and emitted to the frontend. Several can be open at once (e.g. an
    /// EQ and a compressor side by side), at most one per (channel, index) slot.
    fx_editors: Vec<OpenFxEditor>,
}

/// A live FX editor window plus the chain slot whose plugin it is attached to.
struct OpenFxEditor {
    window: ReverbEditorWindow,
    channel: FxChannel,
    index: usize,
}

/// Own the audio backend and plugin host on this thread, then serve commands
/// until the channel closes. Reports construction success/failure over `ready`.
/// `app` is the Tauri handle used to emit load-progress events (absent in tests).
pub(super) fn run(
    rx: Receiver<HostCommand>,
    ready: SyncSender<Result<(), String>>,
    app: Option<AppHandle>,
) {
    let mut engine = match Engine::new(app) {
        Ok(engine) => {
            let _ = ready.send(Ok(()));
            engine
        }
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };

    loop {
        match rx.recv_timeout(TICK) {
            Err(RecvTimeoutError::Disconnected) => break,
            Ok(command) => engine.handle(command),
            Err(RecvTimeoutError::Timeout) => {}
        }
        engine.pump();
        engine.pump_editors();
        engine.tick_previews();
    }

    engine.release_all();
}

impl Engine {
    fn new(app: Option<AppHandle>) -> Result<Self, String> {
        let mixer = Mixer::new()?;
        let host = Vst3Host::builder()
            .sample_rate(SAMPLE_RATE)
            .block_size(BLOCK_SIZE)
            .input_channels(0)
            .output_channels(OUTPUT_CHANNELS)
            .with_process_isolation(false)
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            host,
            mixer,
            slots: HashMap::new(),
            playing: false,
            origin_seconds: 0.0,
            start_instant: None,
            muted_parts: HashSet::new(),
            generation: 0,
            app,
            soundfonts: HashMap::new(),
            previews: Vec::new(),
            fx_editors: Vec::new(),
        })
    }

    fn handle(&mut self, command: HostCommand) {
        match command {
            HostCommand::Load { slots, reply } => {
                let _ = reply.send(self.load(slots));
            }
            HostCommand::Retain { keys, reply } => {
                self.retain_slots(&keys);
                let _ = reply.send(Ok(()));
            }
            HostCommand::Start {
                origin_seconds,
                reply,
            } => {
                let _ = reply.send(Ok(self.start(origin_seconds)));
            }
            HostCommand::Stop { reply } => {
                self.stop();
                let _ = reply.send(Ok(()));
            }
            HostCommand::Seek { seconds, reply } => {
                let _ = reply.send(Ok(self.seek(seconds)));
            }
            HostCommand::ReleaseAll { reply } => {
                self.release_all();
                let _ = reply.send(Ok(()));
            }
            HostCommand::SetMuted { parts, reply } => {
                self.set_muted(parts);
                let _ = reply.send(Ok(()));
            }
            HostCommand::SetReverbChain {
                plugins,
                wet,
                reply,
            } => {
                let _ = reply.send(self.set_reverb_chain(plugins, wet));
            }
            HostCommand::SetMasterChain { plugins, reply } => {
                let _ = reply.send(self.set_master_chain(plugins));
            }
            HostCommand::SetReverbLevels { send, wet, reply } => {
                self.mixer.set_reverb_levels(send, wet);
                let _ = reply.send(Ok(()));
            }
            HostCommand::SetGain {
                slot_key,
                gain,
                reply,
            } => {
                self.mixer.set_gain(&slot_key, gain);
                let _ = reply.send(Ok(()));
            }
            HostCommand::ShowFxEditor {
                channel,
                index,
                reply,
            } => {
                let _ = reply.send(self.show_fx_editor(channel, index));
            }
            HostCommand::CloseFxEditor { reply } => {
                self.finish_all_fx_editors(true);
                let _ = reply.send(Ok(()));
            }
            HostCommand::Preview {
                slot_key,
                note,
                velocity,
                duration_ms,
                reply,
            } => {
                self.preview(&slot_key, note, velocity, duration_ms);
                let _ = reply.send(Ok(()));
            }
        }
    }

    /// Reconcile the referenced slots: reuse an instance whose plugin path is
    /// unchanged (just refresh its schedule), otherwise (re)instantiate it
    /// lazily (§3.4). Slots not listed are left loaded for reuse across plays.
    fn load(&mut self, specs: Vec<SlotSpec>) -> Result<(), String> {
        // Instantiating a plugin is the slow part of a cold play (seconds each),
        // so report progress to the frontend as we go. Count only the slots that
        // actually need loading (new, or whose plugin path changed) — reused slots
        // just get their schedule refreshed and cost nothing.
        let app = self.app.clone();
        let total = specs
            .iter()
            .filter(|spec| {
                self.slots
                    .get(&spec.slot_key)
                    .map_or(true, |s| s.identity != spec.reuse_identity())
            })
            .count();
        let mut loaded = 0usize;

        for spec in specs {
            if let Some(existing) = self.slots.get_mut(&spec.slot_key) {
                if existing.identity == spec.reuse_identity() {
                    existing.schedule = resolve_schedule(&spec.events);
                    existing.cursor = 0;
                    existing.active.clear();
                    if let Some(strip) = self.mixer.lock().strip_mut(&spec.slot_key) {
                        strip.set_mix(spec.gain, spec.reverb_send);
                    }
                    continue;
                }
                self.slots.remove(&spec.slot_key);
                self.mixer.remove(&spec.slot_key);
            }
            emit_load_progress(
                &app,
                "loading",
                loaded,
                total,
                &spec.slot_key,
                &slot_display_name(&spec),
            );
            let seq = self.create_slot(&spec)?;
            self.slots.insert(spec.slot_key, seq);
            loaded += 1;
        }
        if total > 0 {
            emit_load_progress(&app, "done", loaded, total, "", "");
        }
        // A loaded score holds the device open (matching the old per-plugin
        // behavior) so the first play has no cold-start latency.
        if !self.slots.is_empty() {
            self.mixer.ensure_stream()?;
        }
        Ok(())
    }

    /// Unload any slot whose key is not in `keys`, removing both its host-side
    /// sequencing state and its mixer strip. `load` only ever adds or refreshes
    /// slots, so this is how a slot the frontend dropped (a part that switched
    /// voicing, or an instrument removed from the score) stops sounding — without
    /// it the orphaned strip keeps replaying its old schedule in sync with the
    /// current ones, which is heard as a doubled voice.
    fn retain_slots(&mut self, keys: &[String]) {
        let keep: HashSet<&str> = keys.iter().map(String::as_str).collect();
        let stale: Vec<String> = self
            .slots
            .keys()
            .filter(|key| !keep.contains(key.as_str()))
            .cloned()
            .collect();
        for key in stale {
            self.slots.remove(&key);
            self.mixer.remove(&key);
        }
    }

    /// Instantiate the source for `spec` (a VST plugin or a native SoundFont
    /// voice), add it to the mixer, and return the host-side sequencing state for
    /// its slot.
    fn create_slot(&mut self, spec: &SlotSpec) -> Result<SlotSeq, String> {
        let source = match spec.kind {
            SlotKind::Vst => StripSource::Vst(Box::new(self.create_plugin(spec)?)),
            SlotKind::Sf2 => StripSource::Sf2(Box::new(self.create_sf2_voice(spec)?)),
        };
        self.mixer
            .insert(spec.slot_key.clone(), source, spec.gain, spec.reverb_send);
        Ok(SlotSeq {
            identity: spec.reuse_identity(),
            schedule: resolve_schedule(&spec.events),
            cursor: 0,
            active: Vec::new(),
        })
    }

    /// Instantiate and arm the VST plugin for a VST slot.
    fn create_plugin(&mut self, spec: &SlotSpec) -> Result<vst3_host::plugin::Plugin, String> {
        let mut plugin = self
            .host
            .load_plugin(&spec.plugin_path)
            .map_err(|error| error.to_string())?;
        if let Some(bytes) = &spec.state {
            plugin
                .load_state(bytes)
                .map_err(|error| error.to_string())?;
        }
        // `load_plugin` activates the component at the crate's *default* rate.
        // Force a proper deactivate → setupProcessing(SAMPLE_RATE) → reactivate
        // cycle so the plugin renders at the mixer stream's rate; otherwise a
        // sampler like Opus keeps its 44.1 kHz default and plays ~1.5 semitones
        // sharp against our 48 kHz stream (48000/44100). `reconfigure` requires
        // the component be not-processing, which it is until `start_processing`.
        plugin
            .reconfigure(SAMPLE_RATE, BLOCK_SIZE)
            .map_err(|error| error.to_string())?;
        // Arm the plugin before it joins the mixer graph so the very next audio
        // callback can render it.
        plugin
            .start_processing()
            .map_err(|error| error.to_string())?;
        Ok(plugin)
    }

    /// Build a native SoundFont voice for an SF2 slot, loading (and caching) the
    /// referenced font on first use so every voice sharing it parses it once.
    fn create_sf2_voice(&mut self, spec: &SlotSpec) -> Result<Sf2Voice, String> {
        let path = spec
            .soundfont_path
            .as_deref()
            .ok_or_else(|| "SF2 slot is missing its soundfont path".to_owned())?;
        let font = match self.soundfonts.get(path) {
            Some(font) => Arc::clone(font),
            None => {
                let font = load_soundfont(path)?;
                self.soundfonts.insert(path.to_owned(), Arc::clone(&font));
                font
            }
        };
        Sf2Voice::new(&font, spec.program, spec.is_drum)
    }

    /// Install, replace, or clear the reverb aux chain. An empty `plugins` list
    /// removes any reverb; otherwise each effect VST is loaded and configured (see
    /// [`configure_effect`]) in order, then handed to the mixer as the wet aux
    /// chain the summed sends flow through. Like instruments, the effects render at
    /// the stream's rate so tails don't detune against the device clock.
    fn set_reverb_chain(
        &mut self,
        plugins: Vec<super::PluginSpec>,
        wet: f32,
    ) -> Result<(), String> {
        // Reloading the chain drops the instances any editor is attached to, so
        // tear down this channel's editor windows first. No state emit: this is a
        // host-driven reload (e.g. a play-prepare), not the user closing to save.
        self.finish_fx_editors_on(FxChannel::Reverb, false);
        let loaded = self.load_chain(&plugins)?;
        self.mixer.set_reverb_chain(loaded, wet);
        Ok(())
    }

    /// Install or clear the master insert chain (an empty list is a passthrough).
    fn set_master_chain(&mut self, plugins: Vec<super::PluginSpec>) -> Result<(), String> {
        self.finish_fx_editors_on(FxChannel::Master, false);
        let loaded = self.load_chain(&plugins)?;
        self.mixer.set_master_chain(loaded);
        Ok(())
    }

    /// Load and configure every plugin in a chain spec, in order. Fails fast if any
    /// plugin can't be loaded so the caller can leave the channel's key stale and
    /// retry, rather than installing a half-built chain.
    fn load_chain(&mut self, plugins: &[super::PluginSpec]) -> Result<Vec<Plugin>, String> {
        let mut loaded = Vec::with_capacity(plugins.len());
        for spec in plugins {
            loaded.push(configure_effect(
                &mut self.host,
                &EffectSpec {
                    path: spec.plugin_path.clone(),
                    state: spec.state.clone(),
                },
            )?);
        }
        Ok(loaded)
    }

    /// Open the editor of the plugin at `index` in `channel`'s chain in a modeless
    /// host-thread window (§ the FX page's "Show" action). The chain must already
    /// be loaded (the frontend installs it first); attaches to the very instance
    /// the mixer processes, so tweaks are heard live while playback continues.
    /// Several editors can be open at once; re-showing a slot that already has a
    /// window focuses it instead of opening a second one.
    fn show_fx_editor(&mut self, channel: FxChannel, index: usize) -> Result<(), String> {
        if let Some(open) = self
            .fx_editors
            .iter()
            .find(|open| open.channel == channel && open.index == index)
        {
            open.window.show();
            return Ok(());
        }
        let (width, height) = self
            .mixer
            .fx_editor_size(channel, index)
            .ok_or_else(|| "that plugin has no editor".to_string())?;
        let title = format!("{} FX {}", channel.as_str(), index + 1);
        let window = ReverbEditorWindow::create(width, height, &title)?;
        self.mixer.open_fx_editor(channel, index, window.handle())?;
        window.show();
        self.fx_editors.push(OpenFxEditor {
            window,
            channel,
            index,
        });
        Ok(())
    }

    /// Pump every open FX editor's window messages (cheap; keeps them responsive
    /// without blocking the tick loop). Any the user has closed are removed, their
    /// plugin state captured and emitted to the frontend to persist.
    fn pump_editors(&mut self) {
        if self.fx_editors.is_empty() {
            return;
        }
        let mut closed = Vec::new();
        let mut alive = Vec::with_capacity(self.fx_editors.len());
        for open in std::mem::take(&mut self.fx_editors) {
            open.window.pump();
            if open.window.is_alive() {
                alive.push(open);
            } else {
                closed.push(open);
            }
        }
        self.fx_editors = alive;
        for open in closed {
            self.finish_one_fx_editor(open, true);
        }
    }

    /// Close and destroy every open FX editor (e.g. on host release/shutdown).
    fn finish_all_fx_editors(&mut self, emit: bool) {
        for open in std::mem::take(&mut self.fx_editors) {
            self.finish_one_fx_editor(open, emit);
        }
    }

    /// Close editors attached to `channel`, keeping the others. Called before that
    /// channel's chain is rebuilt, which drops the plugin instances they point at.
    fn finish_fx_editors_on(&mut self, channel: FxChannel, emit: bool) {
        let mut kept = Vec::with_capacity(self.fx_editors.len());
        for open in std::mem::take(&mut self.fx_editors) {
            if open.channel == channel {
                self.finish_one_fx_editor(open, emit);
            } else {
                kept.push(open);
            }
        }
        self.fx_editors = kept;
    }

    /// Detach and destroy one FX editor window. When `emit`, capture the plugin's
    /// state and hand it to the frontend to persist; a host-driven teardown
    /// (reload/release) passes `false` since there is nothing to save.
    fn finish_one_fx_editor(&mut self, open: OpenFxEditor, emit: bool) {
        let state = self.mixer.close_fx_editor_and_save(open.channel, open.index);
        open.window.destroy();
        if emit {
            if let (Some(app), Some(bytes)) = (&self.app, state) {
                let _ = app.emit(
                    FX_EDITOR_CLOSED_EVENT,
                    FxEditorClosed {
                        channel: open.channel.as_str(),
                        index: open.index,
                        state: bytes,
                    },
                );
            }
        }
    }

    /// Begin a transport epoch at `origin_seconds`: reconstruct each slot's state
    /// at that point (§3.5 seek fast-forward) and start the clock.
    fn start(&mut self, origin_seconds: f64) -> u64 {
        self.generation += 1;
        let muted = &self.muted_parts;
        let mut core = self.mixer.lock();
        for (key, seq) in self.slots.iter_mut() {
            let Some(strip) = core.strip_mut(key) else {
                continue;
            };
            seek_slot(seq, strip, origin_seconds, muted);
            // Some plugins gate rendering on transport-playing state.
            strip.set_playing(true);
        }
        drop(core);
        self.origin_seconds = origin_seconds;
        self.start_instant = Some(Instant::now());
        self.playing = true;
        self.generation
    }

    /// Dispatch every event now within the look-ahead horizon onto its plugin.
    fn pump(&mut self) {
        if !self.playing {
            return;
        }
        let Some(start) = self.start_instant else {
            return;
        };
        let elapsed = self.origin_seconds + start.elapsed().as_secs_f64();
        let horizon = elapsed + LOOKAHEAD_SECONDS;
        let muted = &self.muted_parts;
        let mut core = self.mixer.lock();
        for (key, seq) in self.slots.iter_mut() {
            let Some(strip) = core.strip_mut(key) else {
                continue;
            };
            while let Some(event) = seq.schedule.get(seq.cursor).copied() {
                if event.at_seconds > horizon {
                    break;
                }
                let offset = (((event.at_seconds - elapsed) * SAMPLE_RATE).round())
                    .clamp(0.0, (BLOCK_SIZE - 1) as f64) as i32;
                dispatch_event(seq, strip, event, offset, muted);
                seq.cursor += 1;
            }
        }
    }

    /// Play one note immediately on a loaded slot and queue its release. Requires
    /// the slot to be loaded (the audio stream running); a no-op otherwise. The
    /// strip is forced into the playing state so VST plugins that gate rendering
    /// on transport still voice the preview while the transport is stopped.
    fn preview(&mut self, slot_key: &str, note: u8, velocity: u8, duration_ms: u64) {
        let Some(channel) = MidiChannel::from_index(0) else {
            return;
        };
        let mut core = self.mixer.lock();
        let Some(strip) = core.strip_mut(slot_key) else {
            return;
        };
        strip.set_playing(true);
        strip.send_midi(MidiEvent::NoteOn {
            channel,
            note,
            velocity,
        });
        drop(core);
        self.previews.push(PreviewOff {
            due: Instant::now() + Duration::from_millis(duration_ms),
            slot_key: slot_key.to_owned(),
            channel: 0,
            note,
        });
    }

    /// Release any preview notes whose duration has elapsed. Runs every tick so
    /// previews sound even while the transport is stopped.
    fn tick_previews(&mut self) {
        if self.previews.is_empty() {
            return;
        }
        let now = Instant::now();
        let mut core = self.mixer.lock();
        self.previews.retain(|preview| {
            if preview.due > now {
                return true;
            }
            if let Some(channel) = MidiChannel::from_index(preview.channel) {
                if let Some(strip) = core.strip_mut(&preview.slot_key) {
                    strip.send_midi(MidiEvent::NoteOff {
                        channel,
                        note: preview.note,
                        velocity: 0,
                    });
                }
            }
            false
        });
    }

    /// Halt transport and flush: all-notes-off every plugin, advancing the
    /// generation so any late reply is recognizable as stale. Instances stay
    /// loaded for the next play.
    fn stop(&mut self) {
        self.mixer.lock().for_each_strip(|strip| strip.panic());
        self.playing = false;
        self.start_instant = None;
        self.generation += 1;
    }

    /// Move the transport to `seconds`. Flushes prior-generation notes, then — if
    /// playing — restarts the clock at the new point; otherwise just records it.
    fn seek(&mut self, seconds: f64) -> u64 {
        self.mixer.lock().for_each_strip(|strip| strip.panic());
        self.generation += 1;
        if self.playing {
            let muted = &self.muted_parts;
            let mut core = self.mixer.lock();
            for (key, seq) in self.slots.iter_mut() {
                let Some(strip) = core.strip_mut(key) else {
                    continue;
                };
                seek_slot(seq, strip, seconds, muted);
            }
            drop(core);
            self.start_instant = Some(Instant::now());
        }
        self.origin_seconds = seconds;
        self.generation
    }

    fn release_all(&mut self) {
        // The reverb/master chains are about to be unloaded; drop every editor
        // window first (no state emit — this is a teardown, not a user save).
        self.finish_all_fx_editors(false);
        self.slots.clear();
        self.mixer.shutdown();
        self.playing = false;
        self.start_instant = None;
    }

    /// Replace the muted-part set. Any note currently sounding for a part that is
    /// now muted gets an immediate note-off so muting is heard at once (matching
    /// the SF2 path's instant gain cut); future events are dropped in `pump`.
    fn set_muted(&mut self, parts: Vec<u32>) {
        self.muted_parts = parts.into_iter().collect();
        let muted = &self.muted_parts;
        let mut core = self.mixer.lock();
        for (key, seq) in self.slots.iter_mut() {
            let Some(strip) = core.strip_mut(key) else {
                continue;
            };
            let mut i = 0;
            while i < seq.active.len() {
                let active = seq.active[i];
                if muted.contains(&active.part) {
                    if let Some(channel) = MidiChannel::from_index(active.channel) {
                        strip.send_midi(MidiEvent::NoteOff {
                            channel,
                            note: active.note,
                            velocity: 0,
                        });
                    }
                    seq.active.swap_remove(i);
                } else {
                    i += 1;
                }
            }
        }
    }
}

/// Reconstruct one slot's playing state at `t` and point its cursor past the
/// catch-up region (§3.5). Muted parts' held notes are not re-attacked; their
/// controllers still replay (silent on their own) to keep plugin state coherent.
fn seek_slot(seq: &mut SlotSeq, strip: &mut Strip, t: f64, muted: &HashSet<u32>) {
    let plan = plan_seek(&seq.schedule, t);
    seq.active.clear();
    for controller in plan.controllers {
        if let Some(event) = to_midi_event(controller) {
            strip.send_midi(event);
        }
    }
    for held in plan.held_notes {
        if muted.contains(&held.part) {
            continue;
        }
        if let Some(event) = to_midi_event(held.midi) {
            strip.send_midi(event);
            if let ResolvedMidi::NoteOn { channel, note, .. } = held.midi {
                seq.active.push(ActiveNote {
                    part: held.part,
                    channel,
                    note,
                });
            }
        }
    }
    seq.cursor = plan.resume_index;
}

/// Route one scheduled event onto a slot's plugin, honoring the muted-part set.
///
/// Note-ons and control changes for a muted part are dropped so the part stays
/// silent; note-offs are always delivered so a note in flight when its part was
/// muted (or that started before the mute) can never get stuck on.
fn dispatch_event(
    seq: &mut SlotSeq,
    strip: &mut Strip,
    event: ResolvedEvent,
    offset: i32,
    muted: &HashSet<u32>,
) {
    let is_muted = muted.contains(&event.part);
    match event.midi {
        ResolvedMidi::NoteOn { channel, note, .. } => {
            if is_muted {
                return;
            }
            if let Some(midi) = to_midi_event(event.midi) {
                strip.send_midi_at(midi, offset);
                seq.active.push(ActiveNote {
                    part: event.part,
                    channel,
                    note,
                });
            }
        }
        ResolvedMidi::NoteOff { channel, note } => {
            if let Some(midi) = to_midi_event(event.midi) {
                strip.send_midi_at(midi, offset);
            }
            remove_active(&mut seq.active, event.part, channel, note);
        }
        ResolvedMidi::ControlChange { .. } => {
            if is_muted {
                return;
            }
            if let Some(midi) = to_midi_event(event.midi) {
                strip.send_midi_at(midi, offset);
            }
        }
    }
}

/// Drop the first active note matching `(part, channel, note)`, if present.
fn remove_active(active: &mut Vec<ActiveNote>, part: u32, channel: u8, note: u8) {
    if let Some(index) = active
        .iter()
        .position(|a| a.part == part && a.channel == channel && a.note == note)
    {
        active.swap_remove(index);
    }
}

fn to_midi_event(midi: ResolvedMidi) -> Option<MidiEvent> {
    match midi {
        ResolvedMidi::NoteOn {
            channel,
            note,
            velocity,
        } => MidiChannel::from_index(channel).map(|channel| MidiEvent::NoteOn {
            channel,
            note,
            velocity,
        }),
        ResolvedMidi::NoteOff { channel, note } => {
            MidiChannel::from_index(channel).map(|channel| MidiEvent::NoteOff {
                channel,
                note,
                velocity: 0,
            })
        }
        ResolvedMidi::ControlChange {
            channel,
            controller,
            value,
        } => MidiChannel::from_index(channel).map(|channel| MidiEvent::ControlChange {
            channel,
            controller,
            value,
        }),
    }
}

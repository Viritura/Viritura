//! Viritura desktop shell: wraps the web editor in a Tauri window.
//!
//! The engine remains WASM (loaded by the web frontend); this shell provides the
//! native window and the cross-origin isolation the editor needs for
//! SharedArrayBuffer, and hosts native capabilities the web build can't provide
//! (here: in-process VST3 hosting for the Instrument Profiles Configure panel).

mod mapper;
mod playback_host;
mod plugin_scan;
mod profile_fs;
mod vst;

use std::path::PathBuf;

use mapper::{PlaybackEvent, ScheduledMidi};
use playback_host::{PlaybackHost, SlotSpec};
use tauri::Manager;

/// Bundled GM SoundFont, resolved relative to the app's resource dir. Native SF2
/// slots (desktop "native" render mode) voice non-VST parts from this font.
const SOUNDFONT_RESOURCE: &str = "sounds/Shan-SGM-Pro-15.sf2";

/// Load a VST3 plugin once and return its identity (class UID, vendor, version)
/// and whether it exposes an editor. Used by the plugin picker.
#[tauri::command]
fn vst_load_identity(plugin_path: String) -> Result<vst::VstIdentity, String> {
    vst::load_identity(&PathBuf::from(plugin_path)).map_err(|error| error.to_string())
}

/// Open the plugin's editor with live audio (edit-and-listen) and return the
/// serialized plugin state once the user closes the window. Runs on a dedicated
/// OS thread because it pumps the editor's native message loop until close.
#[tauri::command]
fn vst_capture_state(
    host: tauri::State<'_, PlaybackHost>,
    plugin_path: String,
    existing_state: Option<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    // Edit-and-listen and score playback both host the plugin in-process and open
    // the audio device; running them at once deadlocks (audio-device and
    // plugin-global contention — e.g. a second in-process Opus instance), which
    // froze the app when the user opened the editor after playing. Release any
    // live playback first so the editor opens onto a clean slate.
    playback_host::release_if_running(&host)?;
    let path = PathBuf::from(plugin_path);
    std::thread::spawn(move || vst::capture_state(&path, existing_state))
        .join()
        .map_err(|_| vst::HostError::HostThreadPanicked.to_string())?
        .map_err(|error| error.to_string())
}

/// Compile a Lua articulation-mapper script and run a part's notation-level
/// performance-event stream through it, returning the sorted raw MIDI. The
/// script is read from `script_path` (its configured slot binding); a fresh
/// sandboxed VM runs per call (§2.2), so no `state` leaks across compilations.
#[tauri::command]
fn vst_compile_mapper(
    script_path: String,
    events: Vec<PlaybackEvent>,
) -> Result<Vec<ScheduledMidi>, String> {
    let source = std::fs::read_to_string(&script_path)
        .map_err(|error| format!("failed to read mapper script {script_path}: {error}"))?;
    mapper::compile_and_dispatch(&source, &events).map_err(|error| error.to_string())
}

/// Dry-run a mapper script against a synthetic event sequence to gate the
/// "Lua script" ready indicator in the Configure panel (§2.7). Returns `Ok(())`
/// when the script compiles and emits well-formed MIDI within the sandbox limits.
#[tauri::command]
fn vst_probe_mapper(script: String) -> Result<(), String> {
    mapper::probe(&script).map_err(|error| error.to_string())
}

/// Instantiate/refresh the VST slots the open score references and hand each its
/// precompiled MIDI (§3.4). Lazy: only listed slots load, and unchanged ones are
/// reused across plays.
#[tauri::command]
fn vst_playback_load(
    host: tauri::State<'_, PlaybackHost>,
    slots: Vec<SlotSpec>,
) -> Result<(), String> {
    playback_host::load(&host, slots)
}

/// Prune the loaded VST/SF2 slot set to exactly `keys`, unloading any slot the
/// current play no longer references so a part that changed voicing doesn't leave
/// its old strip sounding in sync with the new one.
#[tauri::command]
fn vst_playback_retain(
    host: tauri::State<'_, PlaybackHost>,
    keys: Vec<String>,
) -> Result<(), String> {
    playback_host::retain(&host, keys)
}

/// Begin VST transport at `origin_seconds`; returns the transport generation id
/// used to flush stale events on the next stop/seek (§3.5).
#[tauri::command]
fn vst_playback_start(
    host: tauri::State<'_, PlaybackHost>,
    origin_seconds: f64,
) -> Result<u64, String> {
    playback_host::start(&host, origin_seconds)
}

/// Halt VST transport and flush all notes; loaded instances are kept for reuse.
#[tauri::command]
fn vst_playback_stop(host: tauri::State<'_, PlaybackHost>) -> Result<(), String> {
    playback_host::stop(&host)
}

/// Move the VST transport to `seconds`; returns the new transport generation id.
#[tauri::command]
fn vst_playback_seek(host: tauri::State<'_, PlaybackHost>, seconds: f64) -> Result<u64, String> {
    playback_host::seek(&host, seconds)
}

/// Unload every VST plugin instance (score close or profile change).
#[tauri::command]
fn vst_playback_release(host: tauri::State<'_, PlaybackHost>) -> Result<(), String> {
    playback_host::release_all(&host)
}

/// Set which score parts are muted (mixer mute/solo). Their MIDI is dropped at
/// the host and any of their sounding notes are cut immediately, so mute/solo
/// affects VST audio the same way it affects the SoundFont fallback.
#[tauri::command]
fn vst_playback_set_muted(
    host: tauri::State<'_, PlaybackHost>,
    parts: Vec<u32>,
) -> Result<(), String> {
    playback_host::set_muted(&host, parts)
}

/// Install, replace, or clear the reverb aux FX chain (an ordered list of effect
/// VSTs the summed sends flow through). An empty list clears it. `wet` is the
/// linear gain of the chain's return into the master.
#[tauri::command]
fn vst_playback_set_reverb_chain(
    host: tauri::State<'_, PlaybackHost>,
    plugins: Vec<playback_host::PluginSpec>,
    wet: f32,
) -> Result<(), String> {
    playback_host::set_reverb_chain(&host, plugins, wet)
}

/// Install or clear the master insert FX chain (an empty list is a passthrough).
#[tauri::command]
fn vst_playback_set_master_chain(
    host: tauri::State<'_, PlaybackHost>,
    plugins: Vec<playback_host::PluginSpec>,
) -> Result<(), String> {
    playback_host::set_master_chain(&host, plugins)
}

/// Open the editor of one plugin in a channel's FX chain in a modeless window so
/// it can be tweaked live while playback runs (unlike the blocking edit-and-listen
/// capture). The chain must already be loaded. The edited state is delivered later
/// via the `vst-fx-editor-closed` event when the window is closed. `channel` is
/// `"reverb"` or `"master"`; `index` is the plugin's position in that chain.
#[tauri::command]
fn vst_playback_show_fx_editor(
    host: tauri::State<'_, PlaybackHost>,
    channel: String,
    index: usize,
) -> Result<(), String> {
    playback_host::show_fx_editor(&host, &channel, index)
}

/// Close the open FX editor if any, emitting its edited state to the frontend.
#[tauri::command]
fn vst_playback_close_fx_editor(host: tauri::State<'_, PlaybackHost>) -> Result<(), String> {
    playback_host::close_fx_editor(&host)
}

/// Live-adjust the reverb send (all VST parts) and wet return while playing, with
/// no reload. No-op when nothing is loaded; the stored values apply on next play.
#[tauri::command]
fn vst_playback_set_reverb_levels(
    host: tauri::State<'_, PlaybackHost>,
    send: f32,
    wet: f32,
) -> Result<(), String> {
    playback_host::set_reverb_levels(&host, send, wet)
}

/// Live-adjust one slot's output gain (a mixer fader move) while playing, with no
/// reload. No-op when nothing is loaded; the value is baked into the next load.
#[tauri::command]
fn vst_playback_set_gain(
    host: tauri::State<'_, PlaybackHost>,
    slot_key: String,
    gain: f32,
) -> Result<(), String> {
    playback_host::set_gain(&host, slot_key, gain)
}

/// Play one note immediately on a loaded slot (click-to-hear preview), releasing
/// it after `duration_ms`. Lets native-mode preview sound like real playback.
#[tauri::command]
fn vst_playback_preview(
    host: tauri::State<'_, PlaybackHost>,
    slot_key: String,
    note: u8,
    velocity: u8,
    duration_ms: u64,
) -> Result<(), String> {
    playback_host::preview(&host, slot_key, note, velocity, duration_ms)
}

/// Resolve the absolute filesystem path of the bundled GM SoundFont, so the
/// frontend can hand it to native SF2 slots. Resolved from the app's resource
/// dir; in dev Tauri copies the resource there.
#[tauri::command]
fn vst_soundfont_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .resolve(SOUNDFONT_RESOURCE, tauri::path::BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "soundfont path is not valid UTF-8".to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PlaybackHost::default())
        .setup(|app| {
            // Give the playback host an app handle so its worker thread can emit
            // load-progress events to the loading UI.
            app.state::<PlaybackHost>()
                .set_app_handle(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vst_load_identity,
            vst_capture_state,
            vst_compile_mapper,
            vst_probe_mapper,
            vst_playback_load,
            vst_playback_retain,
            vst_playback_start,
            vst_playback_stop,
            vst_playback_seek,
            vst_playback_release,
            vst_playback_set_muted,
            vst_playback_set_reverb_chain,
            vst_playback_set_master_chain,
            vst_playback_show_fx_editor,
            vst_playback_close_fx_editor,
            vst_playback_set_reverb_levels,
            vst_playback_set_gain,
            vst_playback_preview,
            vst_soundfont_path,
            profile_fs::profile_fs_read_text,
            profile_fs::profile_fs_write_text,
            profile_fs::profile_fs_read_binary,
            profile_fs::profile_fs_write_binary,
            profile_fs::profile_fs_exists,
            profile_fs::profile_fs_rename,
            profile_fs::profile_fs_mkdirp,
            plugin_scan::scan_plugins,
            plugin_scan::scan_lua_scripts,
            plugin_scan::default_scan_folders
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Viritura desktop app");
}

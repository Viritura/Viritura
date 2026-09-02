//! In-process VST3 hosting for the desktop shell.
//!
//! Phase 3 needs exactly two host operations, both driven from the Instrument
//! Profiles Configure panel over Tauri IPC:
//!
//! - [`load_identity`] loads a plugin once to read its stable identity (class
//!   UID, vendor, version) and confirm it exposes an editor, then unloads.
//! - [`capture_state`] opens the plugin's native editor with a live audio stream
//!   (edit-and-listen) so the user auditions and dials in a patch, and returns
//!   the serialized plugin state when the editor window closes.
//!
//! Plugins run **in-process** (§3.4 of the instrument-profiles spec): a
//! misbehaving plugin can take the whole process down, and we accept that. There
//! is no crash containment here.

use std::path::Path;

use serde::Serialize;
use vst3_host::Vst3Host;

#[cfg(windows)]
mod editor_session;

const SAMPLE_RATE: f64 = 48_000.0;
const BLOCK_SIZE: usize = 512;
const OUTPUT_CHANNELS: usize = 2;

/// A plugin's self-reported identity, mirrored to the TS `PluginIdentity` shape.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VstIdentity {
    /// Human-readable plugin name (used for a default slot label / window match).
    pub name: String,
    /// VST3 class UID — the stable per-plugin identifier.
    pub plugin_id: String,
    pub vendor: String,
    pub version: String,
    /// Whether the plugin exposes an editor GUI (required for state capture).
    pub has_editor: bool,
}

/// Host failures that return normally to the caller (never a native crash).
#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("VST3 host error: {0}")]
    Backend(String),
    #[cfg(windows)]
    #[error("the plugin does not expose a VST3 editor")]
    MissingEditor,
    #[error("state capture requires the Windows desktop build")]
    #[cfg_attr(windows, allow(dead_code))] // constructed only on the non-Windows fallback path
    Unsupported,
    #[error("the editor host thread panicked")]
    HostThreadPanicked,
}

impl HostError {
    fn backend(error: impl std::fmt::Display) -> Self {
        Self::Backend(error.to_string())
    }
}

fn build_host() -> Result<Vst3Host, HostError> {
    Vst3Host::builder()
        .sample_rate(SAMPLE_RATE)
        .block_size(BLOCK_SIZE)
        .input_channels(0)
        .output_channels(OUTPUT_CHANNELS)
        .with_process_isolation(false)
        .build()
        .map_err(HostError::backend)
}

/// Load the plugin once, read its identity, and unload it.
///
/// This executes native plugin code in-process (initialization only); it opens
/// no window and starts no audio.
pub fn load_identity(path: &Path) -> Result<VstIdentity, HostError> {
    let mut host = build_host()?;
    let plugin = host.load_plugin(path).map_err(HostError::backend)?;
    let info = plugin.info();
    Ok(VstIdentity {
        name: info.name.clone(),
        plugin_id: info.uid.clone(),
        vendor: info.vendor.clone(),
        version: info.version.clone(),
        has_editor: info.has_gui,
    })
}

/// Open the plugin's editor with live audio and capture its state on close.
///
/// When `existing_state` is provided it is restored before the editor opens so
/// the user's edits are incremental. Blocks the calling thread pumping the
/// editor's native message loop until the window is closed, so callers should
/// run this on a dedicated thread. Non-Windows builds return
/// [`HostError::Unsupported`].
pub fn capture_state(path: &Path, existing_state: Option<Vec<u8>>) -> Result<Vec<u8>, HostError> {
    #[cfg(windows)]
    {
        editor_session::capture_state(path, existing_state)
    }
    #[cfg(not(windows))]
    {
        let _ = (path, existing_state);
        Err(HostError::Unsupported)
    }
}

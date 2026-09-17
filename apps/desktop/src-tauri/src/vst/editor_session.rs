//! Windows edit-and-listen state capture.
//!
//! Ported from the `viritura-vst-host` lab's listening editor + message pump.
//! One shared plugin instance drives a cpal audio stream and its native editor
//! window, so the user hears the instrument while configuring it; the same
//! instance's state is serialized when the window closes.
//!
//! Everything here runs on one thread: the plugin, its audio handle, and its
//! editor window are created, pumped, and torn down together, because the native
//! window's message loop must be pumped on the thread that owns it.

use std::path::Path;
use std::ptr;

use vst3_host::{
    backends::CpalBackend, playback::play_with_backend, window::PluginWindow, AudioConfig,
    AudioHandle,
};
use winapi::shared::minwindef::DWORD;
use winapi::um::winuser::{
    DispatchMessageW, MsgWaitForMultipleObjectsEx, PeekMessageW, TranslateMessage,
    MWMO_INPUTAVAILABLE, PM_REMOVE, QS_ALLINPUT, WM_QUIT,
};

use super::{build_host, HostError, BLOCK_SIZE, OUTPUT_CHANNELS, SAMPLE_RATE};

const MESSAGE_WAIT_MILLIS: DWORD = 50;
const WAIT_FAILED: DWORD = 0xFFFF_FFFF;

/// Load the plugin, start live audio, open its editor, and return the plugin's
/// serialized state once the user closes the editor window.
pub fn capture_state(path: &Path, existing_state: Option<Vec<u8>>) -> Result<Vec<u8>, HostError> {
    let mut host = build_host()?;
    let mut plugin = host.load_plugin(path).map_err(HostError::backend)?;
    if !plugin.has_editor() {
        return Err(HostError::MissingEditor);
    }
    // Restore prior state first so the user's edits are incremental (§1.9).
    if let Some(bytes) = existing_state {
        plugin.load_state(&bytes).map_err(HostError::backend)?;
    }

    let backend = CpalBackend::new().map_err(HostError::backend)?;
    let config = AudioConfig {
        sample_rate: SAMPLE_RATE,
        block_size: BLOCK_SIZE,
        input_channels: 0,
        output_channels: OUTPUT_CHANNELS,
        ..AudioConfig::default()
    };
    let handle = play_with_backend(&backend, plugin, config).map_err(HostError::backend)?;

    let window = PluginWindow::new(handle.plugin());
    capture_editor(LiveEditor {
        window,
        handle: Some(handle),
    })
}

trait EditorSession {
    fn open(&mut self) -> Result<(), HostError>;
    fn poll(&self) -> Result<bool, HostError>;
    fn save_state(&self) -> Result<Vec<u8>, HostError>;
    fn close(&mut self);
    fn stop(&mut self);
}

struct LiveEditor {
    window: PluginWindow,
    handle: Option<AudioHandle>,
}

impl EditorSession for LiveEditor {
    fn open(&mut self) -> Result<(), HostError> {
        self.window.open().map_err(HostError::backend)
    }

    fn poll(&self) -> Result<bool, HostError> {
        // Since vst3-host 0.9, WM_CLOSE records intent without destroying the
        // HWND. is_open observes that intent; waiting for IsWindow would hang.
        if !self.window.is_open() {
            return Ok(false);
        }
        self.window
            .service_platform_events()
            .map_err(HostError::backend)?;
        Ok(self.window.is_open())
    }

    fn save_state(&self) -> Result<Vec<u8>, HostError> {
        self.handle
            .as_ref()
            .expect("audio lives until the editor is detached")
            .lock()
            .save_state()
            .map_err(HostError::backend)
    }

    fn close(&mut self) {
        // PluginWindow detaches IPlugView before destroying its native parent.
        self.window.close();
    }

    fn stop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.stop();
        }
    }
}

struct SessionCleanup<S: EditorSession>(S);

impl<S: EditorSession> Drop for SessionCleanup<S> {
    fn drop(&mut self) {
        self.0.close();
        self.0.stop();
    }
}

fn capture_editor(session: impl EditorSession) -> Result<Vec<u8>, HostError> {
    // Open/pump/save errors and Rust unwinding must still detach before stopping
    // audio, on this same thread. Only a successfully pumped session is saved.
    let mut session = SessionCleanup(session);
    session.0.open()?;
    pump_messages(|| session.0.poll())?;
    session.0.save_state()
}

/// Pump until close intent or WM_QUIT, without destroying the editor before save.
fn pump_messages(mut poll: impl FnMut() -> Result<bool, HostError>) -> Result<(), HostError> {
    loop {
        if !poll()? {
            return Ok(());
        }
        // SAFETY: a zeroed MSG is valid for PeekMessageW to initialize.
        let mut message = unsafe { std::mem::zeroed() };
        // SAFETY: the message pointer is valid and the null HWND requests all thread messages.
        while unsafe { PeekMessageW(&mut message, ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
            if message.message == WM_QUIT {
                return Ok(());
            }
            // SAFETY: `message` was initialized by PeekMessageW.
            unsafe {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            // Do not let a busy queue postpone close detection indefinitely.
            if !poll()? {
                return Ok(());
            }
        }

        // SAFETY: zero handles permits a null handle pointer; this waits for queued UI input.
        let wait_result = unsafe {
            MsgWaitForMultipleObjectsEx(
                0,
                ptr::null(),
                MESSAGE_WAIT_MILLIS,
                QS_ALLINPUT,
                MWMO_INPUTAVAILABLE,
            )
        };
        if wait_result == WAIT_FAILED {
            return Err(HostError::Backend(
                std::io::Error::last_os_error().to_string(),
            ));
        }
    }
}

#[cfg(test)]
mod tests;

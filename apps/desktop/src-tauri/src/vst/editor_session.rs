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

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr;

use vst3_host::{
    backends::CpalBackend, playback::play_with_backend, window::PluginWindow, AudioConfig,
};
use winapi::shared::minwindef::DWORD;
use winapi::shared::windef::HWND;
use winapi::um::processthreadsapi::GetCurrentProcessId;
use winapi::um::winuser::{
    DispatchMessageW, FindWindowExW, GetWindowThreadProcessId, IsWindow,
    MsgWaitForMultipleObjectsEx, PeekMessageW, TranslateMessage, MWMO_INPUTAVAILABLE, PM_REMOVE,
    QS_ALLINPUT, WM_QUIT,
};

use super::{build_host, HostError, BLOCK_SIZE, OUTPUT_CHANNELS, SAMPLE_RATE};

const MESSAGE_WAIT_MILLIS: DWORD = 50;
const WAIT_FAILED: DWORD = 0xFFFF_FFFF;

/// Load the plugin, start live audio, open its editor, and return the plugin's
/// serialized state once the user closes the editor window.
pub fn capture_state(path: &Path, existing_state: Option<Vec<u8>>) -> Result<Vec<u8>, HostError> {
    let mut host = build_host()?;
    let mut plugin = host.load_plugin(path).map_err(HostError::backend)?;
    let name = plugin.info().name.clone();
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

    let mut window = PluginWindow::new(handle.plugin());
    window.open().map_err(HostError::backend)?;

    // Pump the editor's messages until the user closes the window, then capture
    // the live instance's state while it is still loaded.
    let pump_result = find_plugin_window(&name).and_then(pump_messages);
    let capture = pump_result.and_then(|()| handle.lock().save_state().map_err(HostError::backend));

    window.close();
    handle.stop();
    capture
}

fn wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

/// Locate the native top-level window `vst3-host` created for the editor, so the
/// pump can detect when the user closes it. Matches the same class/title the lab
/// relied on, restricted to this process.
fn find_plugin_window(plugin_name: &str) -> Result<HWND, HostError> {
    let class_name = wide_null("VST3PluginWindow");
    let title = wide_null(&format!("{plugin_name} - VST3"));
    let current_process = unsafe { GetCurrentProcessId() };
    let mut previous = ptr::null_mut();

    loop {
        // SAFETY: both strings are NUL-terminated and `previous` is either null
        // or a handle returned by the preceding call.
        let candidate = unsafe {
            FindWindowExW(
                ptr::null_mut(),
                previous,
                class_name.as_ptr(),
                title.as_ptr(),
            )
        };
        if candidate.is_null() {
            return Err(HostError::Backend(
                "opened the editor but its native window was not found".to_owned(),
            ));
        }

        let mut process_id = 0;
        // SAFETY: `candidate` is a window returned by Windows and `process_id` is writable.
        unsafe {
            GetWindowThreadProcessId(candidate, &mut process_id);
        }
        if process_id == current_process {
            return Ok(candidate);
        }
        previous = candidate;
    }
}

/// Run the Windows message loop until the editor window is destroyed.
fn pump_messages(native_window: HWND) -> Result<(), HostError> {
    loop {
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
        }

        // SAFETY: `native_window` was returned by FindWindowExW. IsWindow accepts stale handles.
        if unsafe { IsWindow(native_window) } == 0 {
            return Ok(());
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

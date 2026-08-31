//! Editor warm-up for streaming convolution reverbs.
//!
//! Some effects — notably EastWest Spaces — only load their impulse-response
//! content when their editor view is first *attached*. Reaper and other DAWs get
//! this for free because inserting the plugin opens its FX window; a headless
//! host never opens the editor, so the convolver stays fed but silent (it passes
//! its default 50 % dry mix and never produces a wet tail).
//!
//! We reproduce the trigger without ever showing a window: create the plugin's
//! native editor, immediately hide it (`SW_HIDE`), and pump its Win32 message
//! loop while processing a short run of silence so the effect's own streaming
//! thread can pull its content in. Once loaded, the content stays resident even
//! after the editor is torn down, so we close the window and hand the now-warmed
//! plugin to the mixer. Confirmed offline against EW Spaces II with the
//! `vst-reverb-probe` harness: dry-only before, full wet tail after.
//!
//! Effects that don't gate content on the editor (e.g. ValhallaRoom, which is
//! algorithmic) are unaffected — the warm-up is a harmless no-op for them.

use std::time::Duration;

use vst3_host::plugin::Plugin;

/// Open the plugin's editor hidden, pump it while processing silence for
/// `warmup`, then close it — triggering any editor-gated content load. Returns
/// the same plugin instance, ready to be handed to the mixer. A no-op that
/// returns the plugin unchanged when the effect has no editor or the editor
/// can't be opened.
#[cfg(target_os = "windows")]
pub(super) fn warm_up_editor(
    plugin: Plugin,
    warmup: Duration,
    sample_rate: f64,
    block_size: usize,
) -> Plugin {
    use std::ptr;
    use std::sync::{Arc, Mutex};

    use vst3_host::audio::AudioBuffers;
    use vst3_host::window::PluginWindow;
    use winapi::shared::minwindef::DWORD;
    use winapi::um::processthreadsapi::GetCurrentProcessId;
    use winapi::um::winuser::{
        DispatchMessageW, FindWindowExW, GetWindowThreadProcessId, PeekMessageW, ShowWindow,
        TranslateMessage, PM_REMOVE, SW_HIDE, WM_QUIT,
    };

    if !plugin.has_editor() {
        eprintln!("[reverb] warm-up skipped: effect exposes no editor");
        return plugin;
    }
    let name = plugin.info().name.clone();

    let shared = Arc::new(Mutex::new(plugin));
    let mut window = PluginWindow::new(Arc::clone(&shared));
    if let Err(error) = window.open() {
        eprintln!("[reverb] warm-up: could not open editor: {error}; continuing un-warmed");
        window.close();
        drop(window);
        return unwrap_plugin(shared);
    }

    // Locate the native window vst3-host created for this process's editor and
    // hide it before it can paint, so the warm-up is invisible to the user.
    let class_name: Vec<u16> = "VST3PluginWindow\0".encode_utf16().collect();
    let title: Vec<u16> = format!("{name} - VST3\0").encode_utf16().collect();
    let our_pid = unsafe { GetCurrentProcessId() };
    let mut cursor = ptr::null_mut();
    loop {
        let candidate = unsafe {
            FindWindowExW(ptr::null_mut(), cursor, class_name.as_ptr(), title.as_ptr())
        };
        if candidate.is_null() {
            eprintln!("[reverb] warm-up: editor window not found; pumping without hiding");
            break;
        }
        let mut pid: DWORD = 0;
        unsafe { GetWindowThreadProcessId(candidate, &mut pid) };
        if pid == our_pid {
            unsafe { ShowWindow(candidate, SW_HIDE) };
            break;
        }
        cursor = candidate;
    }

    // Pump the editor's message loop while processing silence so the effect's
    // streaming thread has both a live message pump (its content-load timer) and
    // active audio processing to pull content in. Paced to roughly real time.
    let block_ms = ((block_size as f64 / sample_rate) * 1000.0).max(1.0) as u64;
    let deadline = std::time::Instant::now() + warmup;
    while std::time::Instant::now() < deadline {
        unsafe {
            let mut msg = std::mem::zeroed();
            while PeekMessageW(&mut msg, ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_QUIT {
                    break;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        {
            let mut plugin = shared.lock().unwrap_or_else(|poison| poison.into_inner());
            let mut buffers =
                AudioBuffers::new(OUT_CHANNELS, OUT_CHANNELS, block_size, sample_rate);
            let _ = plugin.process_audio(&mut buffers);
        }
        std::thread::sleep(Duration::from_millis(block_ms));
    }

    window.close();
    drop(window);
    eprintln!("[reverb] warm-up complete: editor opened, hidden, and closed to load content");
    unwrap_plugin(shared)
}

/// Reclaim sole ownership of the plugin after its `PluginWindow` (the only other
/// `Arc` holder) has been dropped.
#[cfg(target_os = "windows")]
fn unwrap_plugin(shared: std::sync::Arc<std::sync::Mutex<Plugin>>) -> Plugin {
    std::sync::Arc::try_unwrap(shared)
        .unwrap_or_else(|_| unreachable!("PluginWindow dropped; Arc is uniquely owned"))
        .into_inner()
        .unwrap_or_else(|poison| poison.into_inner())
}

/// Non-Windows builds don't host VST editors; the warm-up is a no-op.
#[cfg(not(target_os = "windows"))]
pub(super) fn warm_up_editor(
    plugin: Plugin,
    _warmup: Duration,
    _sample_rate: f64,
    _block_size: usize,
) -> Plugin {
    plugin
}

/// Stereo, matching the reverb aux bus the mixer feeds.
#[cfg(target_os = "windows")]
const OUT_CHANNELS: usize = super::OUTPUT_CHANNELS;

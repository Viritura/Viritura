//! Modeless native window that hosts the *live* reverb effect's editor.
//!
//! Unlike the edit-and-listen capture flow (`vst/editor_session.rs`), which
//! spins up a throwaway instance and blocks pumping its message loop until the
//! window closes, this window is opened onto the reverb instance the mixer is
//! already processing and is pumped non-blocking from the host thread's tick
//! loop. Tweaks therefore affect the audible reverb in real time, playback keeps
//! running, and the Viritura UI stays responsive. The plugin's editor
//! (`IPlugView`) and its processor (`IAudioProcessor`) are separate VST3
//! interfaces designed for concurrent use from the UI and audio threads, so
//! attaching/detaching the editor while the mixer processes the same instance is
//! safe (the mixer mutex serialises the brief attach/detach against the audio
//! callback).

use std::ffi::c_void;
use std::ptr;

use vst3_host::WindowHandle;
use winapi::shared::windef::{HWND, RECT};
use winapi::um::libloaderapi::GetModuleHandleW;
use winapi::um::winuser::{
    AdjustWindowRectEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, IsWindow,
    LoadCursorW, PeekMessageW, RegisterClassExW, SetForegroundWindow, ShowWindow, TranslateMessage,
    CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, IDC_ARROW, PM_REMOVE, SW_SHOW, WNDCLASSEXW,
    WS_OVERLAPPEDWINDOW,
};

/// A top-level window that parents a plugin editor, pumped from the host thread.
pub(super) struct ReverbEditorWindow {
    hwnd: HWND,
}

impl ReverbEditorWindow {
    /// Create a top-level window sized to `(width, height)` (the plugin's
    /// preferred editor size). The window uses the default window procedure, so
    /// its close button destroys it — the host thread detects that via
    /// [`Self::is_alive`] and persists the plugin's state.
    pub(super) fn create(width: i32, height: i32, title: &str) -> Result<Self, String> {
        unsafe {
            let class_name: Vec<u16> = "VirituraReverbEditor\0".encode_utf16().collect();
            let mut wc: WNDCLASSEXW = std::mem::zeroed();
            wc.cbSize = std::mem::size_of::<WNDCLASSEXW>() as u32;
            wc.style = CS_HREDRAW | CS_VREDRAW;
            wc.lpfnWndProc = Some(DefWindowProcW);
            wc.hInstance = GetModuleHandleW(ptr::null());
            wc.hCursor = LoadCursorW(ptr::null_mut(), IDC_ARROW);
            wc.lpszClassName = class_name.as_ptr();
            // Harmless if the class is already registered from a prior open.
            RegisterClassExW(&wc);

            let mut rect = RECT {
                left: 0,
                top: 0,
                right: width.max(320),
                bottom: height.max(200),
            };
            AdjustWindowRectEx(&mut rect, WS_OVERLAPPEDWINDOW, 0, 0);
            let win_w = rect.right - rect.left;
            let win_h = rect.bottom - rect.top;

            let title_w: Vec<u16> = format!("{title}\0").encode_utf16().collect();
            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                title_w.as_ptr(),
                WS_OVERLAPPEDWINDOW,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                win_w,
                win_h,
                ptr::null_mut(),
                ptr::null_mut(),
                GetModuleHandleW(ptr::null()),
                ptr::null_mut(),
            );
            if hwnd.is_null() {
                return Err("failed to create reverb editor window".to_string());
            }
            Ok(Self { hwnd })
        }
    }

    /// A VST3 parent-window handle for `Plugin::open_editor`.
    pub(super) fn handle(&self) -> WindowHandle {
        WindowHandle::from_hwnd(self.hwnd as *mut c_void)
    }

    /// Show and focus the window (used when "Show UI" is clicked again).
    pub(super) fn show(&self) {
        unsafe {
            ShowWindow(self.hwnd, SW_SHOW);
            SetForegroundWindow(self.hwnd);
        }
    }

    /// Whether the window still exists (false once the user closes it).
    pub(super) fn is_alive(&self) -> bool {
        unsafe { IsWindow(self.hwnd) != 0 }
    }

    /// Dispatch this thread's pending window messages. Cheap; call every tick so
    /// the editor stays responsive without blocking the host loop.
    pub(super) fn pump(&self) {
        unsafe {
            let mut msg = std::mem::zeroed();
            while PeekMessageW(&mut msg, ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    /// Destroy the window if it still exists (host-initiated close). The owning
    /// thread processes `WM_DESTROY` synchronously here, so no message remains.
    pub(super) fn destroy(&self) {
        unsafe {
            if IsWindow(self.hwnd) != 0 {
                DestroyWindow(self.hwnd);
            }
        }
    }
}

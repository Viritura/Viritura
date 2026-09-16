use super::*;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::OnceLock;
use std::thread::{self, ThreadId};
use std::time::{Duration, Instant};
use winapi::shared::minwindef::{LPARAM, LRESULT, UINT, WPARAM};
use winapi::shared::windef::HWND;
use winapi::um::libloaderapi::GetModuleHandleW;
use winapi::um::winuser::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindowLongPtrW, IsWindow, PostMessageW,
    PostQuitMessage, RegisterClassW, SetWindowLongPtrW, GWLP_USERDATA, WM_CLOSE, WM_DESTROY,
    WNDCLASSW, WS_OVERLAPPEDWINDOW,
};

#[derive(Clone, Copy, PartialEq)]
enum Outcome {
    Close,
    Quit,
    OpenError,
    PollError,
    SaveError,
    SavePanic,
}

struct WindowState {
    close_requested: Cell<bool>,
    trace: Rc<RefCell<Vec<&'static str>>>,
    owner: ThreadId,
}

impl WindowState {
    fn record(&self, event: &'static str) {
        assert_eq!(thread::current().id(), self.owner);
        self.trace.borrow_mut().push(event);
    }
}

// Match the dependency's deferred WM_CLOSE contract without loading a plugin.
unsafe extern "system" fn deferred_close(
    hwnd: HWND,
    message: UINT,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const WindowState;
    if let Some(state) = state.as_ref() {
        if message == WM_CLOSE {
            state.close_requested.set(true);
            state.record("close-request");
            return 0;
        }
        if message == WM_DESTROY {
            state.record("destroy");
        }
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}

fn window_class() -> &'static [u16] {
    static CLASS: OnceLock<Vec<u16>> = OnceLock::new();
    CLASS.get_or_init(|| {
        let name: Vec<u16> = "VirituraCaptureRegression\0".encode_utf16().collect();
        // SAFETY: class data and callback are valid; the name lives for the process.
        unsafe {
            let mut class: WNDCLASSW = std::mem::zeroed();
            class.lpfnWndProc = Some(deferred_close);
            class.hInstance = GetModuleHandleW(ptr::null());
            class.lpszClassName = name.as_ptr();
            assert_ne!(RegisterClassW(&class), 0);
        }
        name
    })
}

struct SyntheticEditor {
    hwnd: HWND,
    state: Box<WindowState>,
    outcome: Outcome,
    deadline: Instant,
}

impl SyntheticEditor {
    fn new(outcome: Outcome, trace: Rc<RefCell<Vec<&'static str>>>) -> Self {
        Self {
            hwnd: ptr::null_mut(),
            state: Box::new(WindowState {
                close_requested: Cell::new(false),
                trace,
                owner: thread::current().id(),
            }),
            outcome,
            deadline: Instant::now() + Duration::from_secs(3),
        }
    }
}

impl EditorSession for SyntheticEditor {
    fn open(&mut self) -> Result<(), HostError> {
        let class = window_class();
        // SAFETY: the window is created, pumped and destroyed on this test thread.
        // It is hidden; no user or plugin windows are touched.
        unsafe {
            self.hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                100,
                100,
                ptr::null_mut(),
                ptr::null_mut(),
                GetModuleHandleW(ptr::null()),
                ptr::null_mut(),
            );
            assert!(!self.hwnd.is_null());
            SetWindowLongPtrW(
                self.hwnd,
                GWLP_USERDATA,
                self.state.as_ref() as *const WindowState as isize,
            );
        }
        self.state.record("open");
        if self.outcome == Outcome::OpenError {
            return Err(HostError::backend("open failed"));
        }
        // SAFETY: these messages target only this synthetic window / its owner.
        unsafe {
            if self.outcome == Outcome::Quit {
                PostQuitMessage(0);
            } else {
                assert_ne!(PostMessageW(self.hwnd, WM_CLOSE, 0, 0), 0);
            }
        }
        Ok(())
    }

    fn poll(&self) -> Result<bool, HostError> {
        // Test-only bound: a regressed pump must fail, not hang the test runner.
        assert!(Instant::now() < self.deadline, "close intent was ignored");
        if self.outcome == Outcome::PollError {
            return Err(HostError::backend("poll failed"));
        }
        Ok(!self.state.close_requested.get())
    }

    fn save_state(&self) -> Result<Vec<u8>, HostError> {
        // This is the regression: WM_CLOSE has run, yet IsWindow remains true.
        // Saving must happen here, before the view or parent is removed.
        assert_ne!(unsafe { IsWindow(self.hwnd) }, 0);
        assert!(self.outcome == Outcome::Quit || self.state.close_requested.get());
        self.state.record("save");
        if self.outcome == Outcome::SaveError {
            return Err(HostError::backend("save failed"));
        }
        assert!(self.outcome != Outcome::SavePanic, "save panicked");
        Ok(vec![0, 127, 255])
    }

    fn close(&mut self) {
        self.state.record("detach");
        // SAFETY: the parent is still live and its state stays allocated until
        // DestroyWindow returns, including its synchronous WM_DESTROY callback.
        unsafe {
            assert_ne!(DestroyWindow(self.hwnd), 0);
            assert_eq!(IsWindow(self.hwnd), 0);
        }
        self.hwnd = ptr::null_mut();
    }

    fn stop(&mut self) {
        self.state.record("stop");
    }
}

fn on_window_thread(test: impl FnOnce() + Send + 'static) {
    thread::spawn(test).join().unwrap();
}

#[test]
fn deferred_wm_close_saves_before_destroy_and_can_reopen_on_same_thread() {
    on_window_thread(|| {
        for _ in 0..3 {
            let trace = Rc::default();
            let bytes = capture_editor(SyntheticEditor::new(Outcome::Close, Rc::clone(&trace)))
                .expect("close must finish without destroying the window first");
            assert_eq!(bytes, [0, 127, 255]);
            assert_eq!(
                *trace.borrow(),
                ["open", "close-request", "save", "detach", "destroy", "stop"]
            );
        }
    });
}

#[test]
fn wm_quit_still_saves_and_cleans_up() {
    on_window_thread(|| {
        let trace = Rc::default();
        capture_editor(SyntheticEditor::new(Outcome::Quit, Rc::clone(&trace))).unwrap();
        assert_eq!(
            *trace.borrow(),
            ["open", "save", "detach", "destroy", "stop"]
        );
    });
}

#[test]
fn open_and_pump_errors_skip_save_but_detach_destroy_and_stop() {
    for outcome in [Outcome::OpenError, Outcome::PollError] {
        on_window_thread(move || {
            let trace = Rc::default();
            let error =
                capture_editor(SyntheticEditor::new(outcome, Rc::clone(&trace))).unwrap_err();
            let expected = if outcome == Outcome::OpenError {
                "open failed"
            } else {
                "poll failed"
            };
            assert_eq!(error.to_string(), format!("VST3 host error: {expected}"));
            assert_eq!(*trace.borrow(), ["open", "detach", "destroy", "stop"]);
        });
    }
}

#[test]
fn save_error_preserves_error_and_cleanup_order() {
    on_window_thread(|| {
        let trace = Rc::default();
        let error = capture_editor(SyntheticEditor::new(Outcome::SaveError, Rc::clone(&trace)))
            .unwrap_err();
        assert_eq!(error.to_string(), "VST3 host error: save failed");
        assert_eq!(
            *trace.borrow(),
            ["open", "close-request", "save", "detach", "destroy", "stop"]
        );
    });
}

#[test]
fn save_panic_unwinds_through_same_thread_cleanup() {
    on_window_thread(|| {
        let trace = Rc::default();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            capture_editor(SyntheticEditor::new(Outcome::SavePanic, Rc::clone(&trace)))
        }));
        assert!(result.is_err());
        assert_eq!(
            *trace.borrow(),
            ["open", "close-request", "save", "detach", "destroy", "stop"]
        );
    });
}

#[test]
fn already_closed_poll_exits_without_waiting() {
    on_window_thread(|| pump_messages(|| Ok(false)).unwrap());
}

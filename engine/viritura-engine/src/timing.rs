//! WASM-safe layout timing infrastructure.
//!
//! Two backends, selected by `cfg(target_arch = "wasm32")`:
//!
//! - **Native:** [`std::time::Instant`]. The pre-existing `VIRITURA_LAYOUT_TIMING`
//!   env-gated `tick!` macro in `auto_flow.rs` is built on this and prints to
//!   stderr.
//! - **WASM:** [`js_sys::Date::now`] returning ms since epoch as `f64`. `Instant`
//!   panics on `wasm32-unknown-unknown` ("time not implemented on this
//!   platform"), so the env-gated macro is silently inert there. This module
//!   gives us the same probe surface in WASM by storing splits in a
//!   thread-local `Vec` that the wasm wrapper drains via
//!   [`take_collected_splits`].
//!
//! Usage from any engine module:
//!
//! ```ignore
//! use crate::timing;
//! let t = timing::now_ms();
//! // ... work ...
//! timing::record_split("auto_flow.foo", t);  // pushes (label, ms-elapsed)
//! ```
//!
//! The push is gated by [`is_enabled`], which the wasm wrapper toggles via
//! [`set_enabled`]. When off, `record_split` is a single atomic load and a
//! cheap branch — safe to leave inline in hot paths.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};

/// Global flag. When false, `record_split` is essentially free (one atomic
/// load + branch). Toggled on by the wasm wrapper around a single patch call
/// for profiling.
static ENABLED: AtomicBool = AtomicBool::new(false);

/// Enable or disable collection of `(label, ms)` splits via `record_split`.
pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

/// Whether collection is currently on.
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

thread_local! {
    /// Per-thread split buffer. WASM is single-threaded today; if that ever
    /// changes the wasm wrapper will need to round-trip a Mutex<Vec> instead.
    /// Native tests also run multi-threaded under cargo test; the thread_local
    /// keeps each test's splits isolated.
    static SPLITS: RefCell<Vec<(&'static str, f64)>> = const { RefCell::new(Vec::new()) };
}

/// Current wall-clock time in milliseconds. Native = `Instant` elapsed since
/// process start; WASM = `Date::now()` (epoch ms). The values are NOT
/// comparable across platforms but ARE comparable across calls on the same
/// platform — which is all `record_split` needs.
///
/// On native this avoids the `Instant` API entirely (no monotonic source on
/// wasm), trading off a slight loss of resolution (the native clock is
/// nanoseconds, but we only emit ms-rounded splits in `record_split`).
#[cfg(not(target_arch = "wasm32"))]
pub fn now_ms() -> f64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    let start = START.get_or_init(Instant::now);
    start.elapsed().as_secs_f64() * 1000.0
}

#[cfg(target_arch = "wasm32")]
pub fn now_ms() -> f64 {
    js_sys::Date::now()
}

/// Record an elapsed split: `now_ms() - since` ms under `label`. No-op when
/// `set_enabled(false)`. Pushes into the thread-local buffer that
/// [`take_collected_splits`] drains.
///
/// `label` is `&'static str` to keep the hot path allocation-free.
pub fn record_split(label: &'static str, since_ms: f64) {
    if !is_enabled() {
        return;
    }
    let elapsed = now_ms() - since_ms;
    SPLITS.with(|s| s.borrow_mut().push((label, elapsed)));
}

/// Drain and return the thread-local split buffer. Called by the wasm
/// wrapper after a layout pass to serialize the splits into the JSON the
/// browser test reads.
pub fn take_collected_splits() -> Vec<(&'static str, f64)> {
    SPLITS.with(|s| std::mem::take(&mut *s.borrow_mut()))
}

/// Macro that wraps `now_ms` + `record_split` into one line. Use as:
///
/// ```ignore
/// use crate::timing;
/// let _t = timing::tick_start();
/// // ... work ...
/// timing::tick!("phaseA-E.resolve_staves", _t);
/// ```
///
/// Slightly more readable than calling `record_split` directly; the macro
/// form keeps the label and start variable adjacent so it's harder to
/// accidentally drop the timing call.
#[macro_export]
macro_rules! tick {
    ($label:literal, $since:expr) => {{
        $crate::timing::record_split($label, $since);
    }};
}

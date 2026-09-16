//! Exclude plugin/audio contention without waiting on the UI or async executor.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::RwLockReadGuard;

use super::{release_if_running, PlaybackHost};
use crate::vst::HostError;

const BUSY: &str =
    "the native plugin host is busy with state capture or another playback/plugin operation; retry after it finishes";

impl PlaybackHost {
    /// Hold until all native work (or the host request/reply) has completed.
    pub(crate) fn operation(&self) -> Result<RwLockReadGuard<'_, ()>, String> {
        self.gate.try_read().map_err(|_| BUSY.to_owned())
    }
}

/// Run release and the entire capture callback on one blocking worker. Native
/// resources must be created and destroyed inside the callback, not returned.
pub async fn capture_state(
    host: PlaybackHost,
    capture: impl FnOnce() -> Result<Vec<u8>, HostError> + Send + 'static,
) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _exclusive = host.gate.try_write().map_err(|_| BUSY.to_owned())?;
        // Catch inside the gate so callback destructors finish while exclusive,
        // and a native panic cannot poison this coordination-only lock.
        catch_unwind(AssertUnwindSafe(|| {
            release_if_running(&host)?;
            capture().map_err(|error| error.to_string())
        }))
        .unwrap_or_else(|_| Err(HostError::HostThreadPanicked.to_string()))
    })
    .await
    .map_err(|_| HostError::HostThreadPanicked.to_string())?
}

#[cfg(test)]
mod tests;

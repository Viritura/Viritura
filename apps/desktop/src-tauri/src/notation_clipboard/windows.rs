use std::{mem::size_of, ptr, slice};

use tauri::WebviewWindow;
use winapi::{
    shared::{
        minwindef::{HGLOBAL, UINT},
        windef::HWND,
    },
    um::{
        errhandlingapi::{GetLastError, SetLastError},
        winbase::{GlobalAlloc, GlobalFree, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
        winuser::{
            CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
            OpenClipboard, RegisterClipboardFormatW, SetClipboardData, CF_UNICODETEXT,
        },
    },
};

use super::{
    decode_musescore_payload, decode_unicode_payload, encode_unicode_payload, MuseScoreClipboard,
    MuseScoreMime, NotationClipboardRead, NotationClipboardWrite, MAX_PAYLOAD_BYTES,
};

const OPTIONAL_NUL_BYTES: usize = 2;

pub(super) fn read(window: &WebviewWindow) -> Result<NotationClipboardRead, String> {
    let formats = MuseScoreFormats::register()?;
    let clipboard = Clipboard::open(owner_hwnd(window)?)?;
    let result = (|| {
        let text = if format_is_available(CF_UNICODETEXT) {
            Some(read_unicode_text()?)
        } else {
            None
        };

        let mut muse_score = None;
        for (format, mime) in formats.priority_order() {
            if format_is_available(format) {
                let bytes = read_global_bytes(
                    format,
                    MAX_PAYLOAD_BYTES
                        .checked_add(1)
                        .ok_or_else(|| "MuseScore clipboard size overflow".to_owned())?,
                )?;
                muse_score = Some(MuseScoreClipboard {
                    mime: mime.as_str().to_owned(),
                    xml: decode_musescore_payload(&bytes)?,
                });
                break;
            }
        }

        Ok(NotationClipboardRead {
            supported: true,
            text,
            muse_score,
        })
    })();
    clipboard.finish(result)
}

pub(super) fn write(window: &WebviewWindow, text: &str) -> Result<NotationClipboardWrite, String> {
    let text_units = encode_unicode_payload(text)?;
    let mut text_bytes = Vec::with_capacity(text_units.len() * size_of::<u16>());
    for unit in text_units {
        text_bytes.extend_from_slice(&unit.to_le_bytes());
    }

    let mut text_memory = OwnedGlobal::new(&text_bytes, MAX_PAYLOAD_BYTES + OPTIONAL_NUL_BYTES)?;

    let clipboard = Clipboard::open(owner_hwnd(window)?)?;
    let result = replace_with_unicode_text(empty_clipboard, || text_memory.transfer_unicode_text());
    clipboard.finish(result)
}

fn replace_with_unicode_text(
    empty: impl FnOnce() -> Result<(), String>,
    publish_text: impl FnOnce() -> Result<(), String>,
) -> Result<NotationClipboardWrite, String> {
    // Clear every previous format so stale MuseScore notation cannot survive a copy.
    empty()?;
    publish_text()?;
    Ok(NotationClipboardWrite { supported: true })
}

fn owner_hwnd(window: &WebviewWindow) -> Result<HWND, String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to get main window handle: {error}"))?;
    Ok(hwnd.0.cast())
}

fn read_unicode_text() -> Result<String, String> {
    let bytes = read_global_bytes(
        CF_UNICODETEXT,
        MAX_PAYLOAD_BYTES
            .checked_add(OPTIONAL_NUL_BYTES)
            .ok_or_else(|| "CF_UNICODETEXT clipboard size overflow".to_owned())?,
    )?;
    if bytes.len() % size_of::<u16>() != 0 {
        return Err("CF_UNICODETEXT payload has an odd byte length".to_owned());
    }
    let units: Vec<u16> = bytes
        .chunks_exact(size_of::<u16>())
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    decode_unicode_payload(&units)
}

fn read_global_bytes(format: UINT, maximum_allocation: usize) -> Result<Vec<u8>, String> {
    // SAFETY: the clipboard is held open by the caller and `format` is one of the
    // fixed formats registered by this module (or CF_UNICODETEXT).
    let handle = unsafe { GetClipboardData(format) } as HGLOBAL;
    if handle.is_null() {
        return Err(last_error("failed to get clipboard data"));
    }

    // SAFETY: GetClipboardData returned this HGLOBAL while the clipboard is open.
    let size = unsafe { GlobalSize(handle) };
    if size == 0 {
        return Err(last_error(
            "clipboard data has a zero-sized global allocation",
        ));
    }
    if size > maximum_allocation {
        return Err(format!(
            "clipboard allocation is {size} bytes, exceeding the {maximum_allocation}-byte limit"
        ));
    }

    let lock = GlobalLockGuard::new(handle)?;
    // SAFETY: GlobalLock produced a non-null pointer valid for the allocation's
    // GlobalSize, and the bytes are copied before the guard unlocks it.
    let bytes = unsafe { slice::from_raw_parts(lock.pointer.cast::<u8>(), size) }.to_vec();
    lock.unlock()?;
    Ok(bytes)
}

fn format_is_available(format: UINT) -> bool {
    // SAFETY: querying a numeric clipboard format has no ownership effect.
    unsafe { IsClipboardFormatAvailable(format) != 0 }
}

fn empty_clipboard() -> Result<(), String> {
    // SAFETY: the caller holds an open clipboard associated with the main HWND.
    if unsafe { EmptyClipboard() } == 0 {
        Err(last_error("failed to empty clipboard"))
    } else {
        Ok(())
    }
}

struct Clipboard {
    open: bool,
}

impl Clipboard {
    fn open(owner: HWND) -> Result<Self, String> {
        // SAFETY: `owner` is Tauri's live main-window HWND; this guard serializes
        // the matching CloseClipboard for every successful call.
        if unsafe { OpenClipboard(owner) } == 0 {
            Err(last_error("failed to open clipboard"))
        } else {
            Ok(Self { open: true })
        }
    }

    fn finish<T>(mut self, result: Result<T, String>) -> Result<T, String> {
        let close_result = self.close();
        match (result, close_result) {
            (Ok(value), Ok(())) => Ok(value),
            (Ok(_), Err(close_error)) => Err(close_error),
            (Err(operation_error), Ok(())) => Err(operation_error),
            (Err(operation_error), Err(close_error)) => {
                Err(format!("{operation_error}; additionally, {close_error}"))
            }
        }
    }

    fn close(&mut self) -> Result<(), String> {
        if !self.open {
            return Ok(());
        }
        // SAFETY: this instance exists only after OpenClipboard succeeded.
        if unsafe { CloseClipboard() } == 0 {
            Err(last_error("failed to close clipboard"))
        } else {
            self.open = false;
            Ok(())
        }
    }
}

impl Drop for Clipboard {
    fn drop(&mut self) {
        if self.open {
            // SAFETY: best-effort cleanup for the matching successful OpenClipboard.
            unsafe {
                CloseClipboard();
            }
        }
    }
}

struct GlobalLockGuard {
    handle: HGLOBAL,
    pointer: *mut winapi::ctypes::c_void,
    locked: bool,
}

impl GlobalLockGuard {
    fn new(handle: HGLOBAL) -> Result<Self, String> {
        // SAFETY: callers provide a live movable global-memory handle.
        let pointer = unsafe { GlobalLock(handle) };
        if pointer.is_null() {
            Err(last_error("failed to lock clipboard global memory"))
        } else {
            Ok(Self {
                handle,
                pointer,
                locked: true,
            })
        }
    }

    fn unlock(mut self) -> Result<(), String> {
        let result = unlock_global(self.handle);
        if result.is_ok() {
            self.locked = false;
        }
        result
    }
}

impl Drop for GlobalLockGuard {
    fn drop(&mut self) {
        if self.locked {
            let _ = unlock_global(self.handle);
        }
    }
}

fn unlock_global(handle: HGLOBAL) -> Result<(), String> {
    // GlobalUnlock returns zero both when the final lock is released and on error,
    // so clearing and inspecting GetLastError is required to distinguish the two.
    unsafe {
        SetLastError(0);
        let result = GlobalUnlock(handle);
        let error = GetLastError();
        if result == 0 && error != 0 {
            Err(format!(
                "failed to unlock clipboard global memory: {}",
                std::io::Error::from_raw_os_error(error as i32)
            ))
        } else {
            Ok(())
        }
    }
}

struct OwnedGlobal {
    handle: HGLOBAL,
}

impl OwnedGlobal {
    fn new(bytes: &[u8], maximum_allocation: usize) -> Result<Self, String> {
        if bytes.is_empty() {
            return Err("cannot allocate an empty clipboard payload".to_owned());
        }
        // SAFETY: GlobalAlloc is given a checked, non-zero slice length and the
        // returned movable handle remains owned by this RAII value until transfer.
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) };
        if handle.is_null() {
            return Err(last_error("failed to allocate clipboard global memory"));
        }
        let memory = Self { handle };
        // GlobalSize can exceed the requested length. Initialize the entire block
        // so clipboard readers cannot observe stale process memory in its padding.
        let allocated = unsafe { GlobalSize(memory.handle) };
        if allocated < bytes.len() || allocated > maximum_allocation {
            return Err("clipboard allocation is outside the supported size bounds".to_owned());
        }
        let lock = GlobalLockGuard::new(memory.handle)?;
        // SAFETY: GlobalSize establishes the destination length, checked above.
        // Source and destination cannot overlap because GlobalAlloc created it.
        unsafe {
            ptr::write_bytes(lock.pointer.cast::<u8>(), 0, allocated);
            ptr::copy_nonoverlapping(bytes.as_ptr(), lock.pointer.cast::<u8>(), bytes.len());
        }

        lock.unlock()?;
        Ok(memory)
    }

    fn transfer_unicode_text(&mut self) -> Result<(), String> {
        // SAFETY: the clipboard is open and empty, and `handle` is movable global
        // memory. Ownership changes only after SetClipboardData reports success.
        if unsafe { SetClipboardData(CF_UNICODETEXT, self.handle) }.is_null() {
            Err(last_error("failed to set clipboard data"))
        } else {
            self.handle = ptr::null_mut();
            Ok(())
        }
    }
}

impl Drop for OwnedGlobal {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: non-null means ownership was not transferred to the clipboard.
            unsafe {
                GlobalFree(self.handle);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    #[test]
    fn native_writer_can_only_publish_unicode_text() {
        let _: fn(&WebviewWindow, &str) -> Result<NotationClipboardWrite, String> = write;
        let source = include_str!("windows.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("native implementation");
        assert_eq!(source.matches("SetClipboardData(").count(), 1);
        assert!(source.contains("SetClipboardData(CF_UNICODETEXT, self.handle)"));
        assert!(source.contains("replace_with_unicode_text(empty_clipboard,"));
    }

    #[test]
    fn text_copy_empties_stale_musescore_formats_before_publishing() {
        let formats = MuseScoreFormats {
            staff_list: 0xc000,
            symbol: 0xc001,
            symbol_list: 0xc002,
        };
        assert_eq!(
            formats.priority_order(),
            [
                (0xc000, MuseScoreMime::StaffList),
                (0xc001, MuseScoreMime::Symbol),
                (0xc002, MuseScoreMime::SymbolList),
            ]
        );
        let clipboard = RefCell::new(vec![(CF_UNICODETEXT, b"old text".to_vec())]);
        for (format, _) in formats.priority_order() {
            clipboard
                .borrow_mut()
                .push((format, b"stale MuseScore notation".to_vec()));
        }
        let text_bytes: Vec<u8> = encode_unicode_payload("{\"viritura\":\"fragment\"}")
            .expect("encode")
            .into_iter()
            .flat_map(u16::to_le_bytes)
            .collect();
        let result = replace_with_unicode_text(
            || {
                clipboard.borrow_mut().clear();
                Ok(())
            },
            || {
                assert!(clipboard.borrow().is_empty());
                clipboard
                    .borrow_mut()
                    .push((CF_UNICODETEXT, text_bytes.clone()));
                Ok(())
            },
        )
        .expect("publish text");
        assert!(result.supported);
        assert_eq!(clipboard.into_inner(), vec![(CF_UNICODETEXT, text_bytes)]);
    }

    #[test]
    fn failed_empty_does_not_publish_text() {
        let result = replace_with_unicode_text(
            || Err("failed to empty clipboard".to_owned()),
            || panic!("must not publish without emptying the clipboard"),
        );
        assert_eq!(result.unwrap_err(), "failed to empty clipboard");
    }

    #[test]
    fn failed_text_publication_propagates_after_emptying() {
        let emptied = RefCell::new(false);
        let result = replace_with_unicode_text(
            || {
                *emptied.borrow_mut() = true;
                Ok(())
            },
            || {
                assert!(*emptied.borrow());
                Err("failed to set clipboard data".to_owned())
            },
        );
        assert_eq!(result.unwrap_err(), "failed to set clipboard data");
    }

    #[test]
    fn owned_allocations_initialize_all_storage_without_touching_the_clipboard() {
        for length in 1..65 {
            let bytes = vec![b'x'; length];
            let memory = OwnedGlobal::new(&bytes, MAX_PAYLOAD_BYTES).expect("allocate");
            // SAFETY: the owned handle remains live until after the lock is released.
            let size = unsafe { GlobalSize(memory.handle) };
            let lock = GlobalLockGuard::new(memory.handle).expect("lock");
            let storage = unsafe { slice::from_raw_parts(lock.pointer.cast::<u8>(), size) };
            assert_eq!(&storage[..length], bytes.as_slice());
            assert!(storage[length..].iter().all(|byte| *byte == 0));
            lock.unlock().expect("unlock");
        }
    }

    #[test]
    fn oversized_allocation_is_rejected_before_clipboard_transfer() {
        assert!(OwnedGlobal::new(b"notes", 4).is_err());
    }
}

struct MuseScoreFormats {
    staff_list: UINT,
    symbol: UINT,
    symbol_list: UINT,
}

impl MuseScoreFormats {
    fn register() -> Result<Self, String> {
        Ok(Self {
            staff_list: register_format(MuseScoreMime::StaffList)?,
            symbol: register_format(MuseScoreMime::Symbol)?,
            symbol_list: register_format(MuseScoreMime::SymbolList)?,
        })
    }

    fn priority_order(&self) -> [(UINT, MuseScoreMime); 3] {
        [
            (self.staff_list, MuseScoreMime::StaffList),
            (self.symbol, MuseScoreMime::Symbol),
            (self.symbol_list, MuseScoreMime::SymbolList),
        ]
    }
}

fn register_format(mime: MuseScoreMime) -> Result<UINT, String> {
    let wide: Vec<u16> = mime.as_str().encode_utf16().chain(Some(0)).collect();
    // SAFETY: `wide` is a NUL-terminated fixed whitelist string that lives through
    // the call; no frontend-provided format name reaches RegisterClipboardFormatW.
    let format = unsafe { RegisterClipboardFormatW(wide.as_ptr()) };
    if format == 0 {
        Err(last_error("failed to register MuseScore clipboard format"))
    } else {
        Ok(format)
    }
}

fn last_error(action: &str) -> String {
    format!("{action}: {}", std::io::Error::last_os_error())
}

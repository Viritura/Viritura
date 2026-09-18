#[cfg(windows)]
mod windows;

#[cfg(any(windows, test))]
use std::mem::size_of;

use serde::{Deserialize, Serialize};

const MAIN_WINDOW_LABEL: &str = "main";
#[cfg(any(windows, test))]
const MAX_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;

#[cfg(any(windows, test))]
const STAFF_LIST_MIME: &str = "application/musescore/stafflist";
#[cfg(any(windows, test))]
const SYMBOL_MIME: &str = "application/musescore/symbol";
#[cfg(any(windows, test))]
const SYMBOL_LIST_MIME: &str = "application/musescore/symbollist";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MuseScoreClipboard {
    mime: String,
    xml: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotationClipboardRead {
    supported: bool,
    text: Option<String>,
    muse_score: Option<MuseScoreClipboard>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotationClipboardWrite {
    supported: bool,
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MuseScoreMime {
    StaffList,
    Symbol,
    SymbolList,
}

#[cfg(any(windows, test))]
impl MuseScoreMime {
    fn parse(mime: &str) -> Result<Self, String> {
        match mime {
            STAFF_LIST_MIME => Ok(Self::StaffList),
            SYMBOL_MIME => Ok(Self::Symbol),
            SYMBOL_LIST_MIME => Ok(Self::SymbolList),
            _ => Err(format!("unsupported MuseScore clipboard MIME type: {mime}")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::StaffList => STAFF_LIST_MIME,
            Self::Symbol => SYMBOL_MIME,
            Self::SymbolList => SYMBOL_LIST_MIME,
        }
    }
}

#[tauri::command]
pub(crate) fn notation_clipboard_read(
    window: tauri::WebviewWindow,
) -> Result<NotationClipboardRead, String> {
    ensure_main_window(&window)?;

    #[cfg(windows)]
    {
        windows::read(&window)
    }

    #[cfg(not(windows))]
    {
        Ok(NotationClipboardRead {
            supported: false,
            text: None,
            muse_score: None,
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn notation_clipboard_write(
    window: tauri::WebviewWindow,
    text: String,
    muse_score: Option<MuseScoreClipboard>,
) -> Result<NotationClipboardWrite, String> {
    ensure_main_window(&window)?;

    #[cfg(windows)]
    {
        windows::write(&window, &text, muse_score.as_ref())
    }

    #[cfg(not(windows))]
    {
        let _ = (text, muse_score);
        Ok(NotationClipboardWrite { supported: false })
    }
}

fn ensure_main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == MAIN_WINDOW_LABEL {
        Ok(())
    } else {
        Err("notation clipboard commands are restricted to the main window".to_owned())
    }
}

#[cfg(any(windows, test))]
fn encode_unicode_payload(text: &str) -> Result<Vec<u16>, String> {
    if text.contains('\0') {
        return Err("clipboard text contains a NUL character".to_owned());
    }

    let mut units: Vec<u16> = text.encode_utf16().collect();
    let payload_bytes = units
        .len()
        .checked_mul(size_of::<u16>())
        .ok_or_else(|| "clipboard text size overflow".to_owned())?;
    if payload_bytes > MAX_PAYLOAD_BYTES {
        return Err(format!(
            "clipboard text exceeds the {MAX_PAYLOAD_BYTES}-byte limit"
        ));
    }
    units.push(0);
    Ok(units)
}

#[cfg(any(windows, test))]
fn decode_unicode_payload(units: &[u16]) -> Result<String, String> {
    let nul = units
        .iter()
        .position(|unit| *unit == 0)
        .ok_or_else(|| "CF_UNICODETEXT payload is not NUL-terminated".to_owned())?;
    let payload = &units[..nul];
    let payload_bytes = payload
        .len()
        .checked_mul(size_of::<u16>())
        .ok_or_else(|| "CF_UNICODETEXT payload size overflow".to_owned())?;
    if payload_bytes > MAX_PAYLOAD_BYTES {
        return Err(format!(
            "CF_UNICODETEXT payload exceeds the {MAX_PAYLOAD_BYTES}-byte limit"
        ));
    }
    String::from_utf16(payload)
        .map_err(|error| format!("CF_UNICODETEXT payload is invalid UTF-16: {error}"))
}

#[cfg(any(windows, test))]
fn encode_musescore_payload(xml: &str) -> Result<Vec<u8>, String> {
    let bytes = xml.as_bytes();
    if bytes.is_empty() {
        return Err("MuseScore clipboard XML is empty".to_owned());
    }
    if bytes.len() > MAX_PAYLOAD_BYTES {
        return Err(format!(
            "MuseScore clipboard XML exceeds the {MAX_PAYLOAD_BYTES}-byte limit"
        ));
    }
    if bytes.contains(&0) {
        return Err("MuseScore clipboard XML contains a NUL byte".to_owned());
    }
    Ok(bytes.to_vec())
}

#[cfg(any(windows, test))]
fn decode_musescore_payload(bytes: &[u8]) -> Result<String, String> {
    let payload = bytes.strip_suffix(&[0]).unwrap_or(bytes);
    if payload.is_empty() {
        return Err("MuseScore clipboard payload is empty".to_owned());
    }
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(format!(
            "MuseScore clipboard payload exceeds the {MAX_PAYLOAD_BYTES}-byte limit"
        ));
    }
    if payload.contains(&0) {
        return Err("MuseScore clipboard payload contains an embedded NUL byte".to_owned());
    }
    std::str::from_utf8(payload)
        .map(str::to_owned)
        .map_err(|error| format!("MuseScore clipboard payload is invalid UTF-8: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_whitelist_is_exact() {
        assert_eq!(
            MuseScoreMime::parse(STAFF_LIST_MIME),
            Ok(MuseScoreMime::StaffList)
        );
        assert_eq!(MuseScoreMime::parse(SYMBOL_MIME), Ok(MuseScoreMime::Symbol));
        assert_eq!(
            MuseScoreMime::parse(SYMBOL_LIST_MIME),
            Ok(MuseScoreMime::SymbolList)
        );
        assert!(MuseScoreMime::parse("Application/musescore/stafflist").is_err());
        assert!(MuseScoreMime::parse("application/musescore/stafflist\0").is_err());
        assert!(MuseScoreMime::parse("text/plain").is_err());
    }

    #[test]
    fn unicode_payload_round_trips_and_handles_trailing_storage() {
        let units = encode_unicode_payload("notes \u{1d11e}").expect("encode");
        let mut storage = units.clone();
        storage.extend([0, 0]);
        assert_eq!(
            decode_unicode_payload(&storage).expect("decode"),
            "notes \u{1d11e}"
        );
        assert_eq!(units.last(), Some(&0));
    }

    #[test]
    fn unicode_payload_rejects_nuls_invalid_utf16_and_oversize_text() {
        assert!(encode_unicode_payload("a\0b").is_err());
        assert!(decode_unicode_payload(&[0xd800, 0]).is_err());
        assert!(decode_unicode_payload(&[b'a' as u16]).is_err());
        let oversized = "a".repeat(MAX_PAYLOAD_BYTES / size_of::<u16>() + 1);
        assert!(encode_unicode_payload(&oversized).is_err());
    }

    #[test]
    fn musescore_payload_validates_utf8_size_and_nuls() {
        assert_eq!(
            decode_musescore_payload(b"<StaffList/>\0").expect("decode"),
            "<StaffList/>"
        );
        assert!(decode_musescore_payload(&[0xff]).is_err());
        assert!(decode_musescore_payload(b"<Staff\0List/>").is_err());
        assert!(decode_musescore_payload(b"\0").is_err());
        assert!(encode_musescore_payload("").is_err());
        assert!(encode_musescore_payload("<Staff\0List/>").is_err());
        let oversized = "a".repeat(MAX_PAYLOAD_BYTES + 1);
        assert!(encode_musescore_payload(&oversized).is_err());
        assert!(decode_musescore_payload(oversized.as_bytes()).is_err());
    }

    #[test]
    fn read_contract_serializes_camel_case_fields() {
        let result = NotationClipboardRead {
            supported: true,
            text: Some("{}".to_owned()),
            muse_score: Some(MuseScoreClipboard {
                mime: STAFF_LIST_MIME.to_owned(),
                xml: "<StaffList/>".to_owned(),
            }),
        };
        let value = serde_json::to_value(result).expect("serialize");
        assert_eq!(value["supported"], true);
        assert_eq!(value["text"], "{}");
        assert_eq!(value["museScore"]["mime"], STAFF_LIST_MIME);
        assert_eq!(value["museScore"]["xml"], "<StaffList/>");
    }
}

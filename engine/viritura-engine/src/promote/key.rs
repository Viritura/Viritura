//! Promote [`crate::raw::Key`] → [`crate::model::key::KeySignature`].
//!
//! Hoists the `_x.viritura.atonal` vendor extension onto the engine's
//! first-class `atonal` field. This replaces the custom `Deserialize`
//! impl on `model::KeySignature` that did the same job at deserialise
//! time.

use crate::model::key::KeySignature;
use crate::promote::vendor_ext::read_viritura_ext;
use crate::raw;

pub(crate) fn promote_key(raw: raw::Key) -> KeySignature {
    let atonal = read_viritura_ext(raw.x.as_ref())
        .and_then(|v| v.get("atonal"))
        .and_then(|v| v.as_bool());
    KeySignature {
        fifths: i32::try_from(raw.fifths.0).unwrap_or(0),
        color: raw.color.map(|c| c.0),
        atonal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_plain_key() {
        let json = r#"{"fifths":3}"#;
        let raw: raw::Key = serde_json::from_str(json).unwrap();
        let promoted = promote_key(raw);
        assert_eq!(promoted.fifths, 3);
    }

    #[test]
    fn promotes_key_with_atonal_vendor_ext() {
        let json = r#"{"fifths":0,"_x":{"viritura":{"atonal":true}}}"#;
        let raw: raw::Key = serde_json::from_str(json).unwrap();
        let promoted = promote_key(raw);
        assert_eq!(promoted.atonal, Some(true));
        assert_eq!(promoted.fifths, 0);
    }
}

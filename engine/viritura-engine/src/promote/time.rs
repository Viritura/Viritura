//! Promote [`crate::raw::Time`] → [`crate::model::time::TimeSignature`].

use crate::model::time::{TimeSignature, TimeSignatureDisplay};
use crate::raw;

pub(crate) fn promote_time(raw: raw::Time) -> TimeSignature {
    TimeSignature {
        count: u32::try_from(raw.count.0).unwrap_or(4),
        unit: time_signature_unit_to_u32(&raw.unit),
        display: raw.display.map(promote_time_signature_display),
    }
}

pub(crate) fn promote_time_signature_display(
    raw: raw::TimeSignatureDisplay,
) -> TimeSignatureDisplay {
    match raw {
        raw::TimeSignatureDisplay::Common => TimeSignatureDisplay::Common,
        raw::TimeSignatureDisplay::Cut => TimeSignatureDisplay::Cut,
    }
}

fn time_signature_unit_to_u32(unit: &raw::TimeSignatureUnit) -> u32 {
    // TimeSignatureUnit deref's to i64
    u32::try_from(**unit).unwrap_or(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_simple_time() {
        let json = r#"{"count":4,"unit":4}"#;
        let raw: raw::Time = serde_json::from_str(json).unwrap();
        let direct: TimeSignature = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_time(raw));
    }

    #[test]
    fn promotes_common_time_display() {
        let json = r#"{"count":4,"unit":4,"display":"common"}"#;
        let raw: raw::Time = serde_json::from_str(json).unwrap();
        let direct: TimeSignature = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_time(raw));
    }
}

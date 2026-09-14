//! Promote [`crate::raw::Time`] → [`crate::model::time::TimeSignature`].

use crate::model::time::{GroupingDisplay, TimeSignature, TimeSignatureDisplay};
use crate::promote::vendor_ext::read_viritura_ext;
use crate::raw;

pub(crate) fn promote_grouping_display(
    raw: crate::raw_viritura::GroupingDisplay,
) -> GroupingDisplay {
    match raw {
        crate::raw_viritura::GroupingDisplay::Standard => GroupingDisplay::Standard,
        crate::raw_viritura::GroupingDisplay::Additive => GroupingDisplay::Additive,
        crate::raw_viritura::GroupingDisplay::Annotation => GroupingDisplay::Annotation,
    }
}

pub(crate) fn promote_time(raw: raw::Time) -> TimeSignature {
    let extension = read_viritura_ext(raw.x.as_ref()).and_then(|value| {
        serde_json::from_value::<crate::raw_viritura::TimeExtensions>(serde_json::Value::Object(
            value.clone(),
        ))
        .ok()
    });
    let beat_structure = extension
        .as_ref()
        .and_then(|extension| {
            extension
                .beat_structure
                .iter()
                .copied()
                .map(u32::try_from)
                .collect::<Result<Vec<_>, _>>()
                .ok()
        })
        .filter(|groups| !groups.is_empty());
    let grouping_display = extension
        .and_then(|extension| extension.grouping_display)
        .map(promote_grouping_display);
    TimeSignature {
        count: u32::try_from(raw.count.0).unwrap_or(4),
        unit: time_signature_unit_to_u32(&raw.unit),
        display: raw.display.map(promote_time_signature_display),
        beat_structure,
        grouping_display,
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

    #[test]
    fn promotes_authored_beat_structure() {
        let json = r#"{
            "count":9,
            "unit":8,
            "_x":{"viritura":{"beatStructure":[2,3,2,2]}}
        }"#;
        let raw: raw::Time = serde_json::from_str(json).unwrap();
        assert_eq!(promote_time(raw).beat_structure, Some(vec![2, 3, 2, 2]));
    }
}

//! Promote MNX repeat / ending objects.

use crate::model::repeat::{Ending, RepeatEnd, RepeatStart};
use crate::raw;

/// Promote a repeat-start while recovering the engine-side `times`
/// override from the original JSON. `times` is not part of the MNX spec
/// for `repeatStart`, but the engine has historically accepted it.
pub(crate) fn promote_repeat_start_with_json(
    raw: raw::RepeatStart,
    original_json: Option<&serde_json::Value>,
) -> RepeatStart {
    let times = original_json
        .and_then(|v| v.get("times").and_then(|t| t.as_u64()))
        .map(|t| u32::try_from(t).unwrap_or(2));
    let _ = raw;
    RepeatStart { times }
}

pub(crate) fn promote_repeat_end(raw: raw::RepeatEnd) -> RepeatEnd {
    RepeatEnd {
        times: raw.times.map(|t| u32::try_from(t.0).unwrap_or(2)),
    }
}

pub(crate) fn promote_ending(raw: raw::Ending) -> Ending {
    Ending {
        duration: u32::try_from(raw.duration.0).unwrap_or(0),
        numbers: raw
            .numbers
            .into_iter()
            .map(|n| u32::try_from(n.0).unwrap_or(1))
            .collect(),
        open: raw.open.map(|o| o.0),
        color: raw.color.map(|c| c.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_repeat_end_with_times() {
        let json = r#"{"times":3}"#;
        let raw: raw::RepeatEnd = serde_json::from_str(json).unwrap();
        let direct: RepeatEnd = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_repeat_end(raw));
    }

    #[test]
    fn promotes_ending_with_numbers() {
        let json = r#"{"duration":2,"numbers":[1,3],"open":true}"#;
        let raw: raw::Ending = serde_json::from_str(json).unwrap();
        let direct: Ending = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_ending(raw));
    }
}

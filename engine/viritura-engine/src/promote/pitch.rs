//! Promote [`crate::raw::Pitch`] → [`crate::model::pitch::Pitch`].

use crate::model::pitch::Pitch;
use crate::raw;

/// Convert a schema-conformant raw pitch into the engine's pitch model.
///
/// Discarded from raw:
/// - `id` — pitches are not referenced by id in the engine layout pipeline.
/// - `c` — JSON comment, never consulted at runtime.
/// - `x` (vendor extensions) — the engine ignores vendor extensions; the
///   editor / TS side owns them.
pub(crate) fn promote_pitch(raw: raw::Pitch) -> Pitch {
    Pitch {
        step: raw.step.to_string(),
        octave: i32::try_from(raw.octave.0).unwrap_or(0),
        alter: raw.alter.map(|a| i32::try_from(a.0).unwrap_or(0)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raw;

    fn raw_pitch(step: raw::Step, octave: i64, alter: Option<i64>) -> raw::Pitch {
        raw::Pitch {
            alter: alter.map(raw::Alter),
            c: None,
            id: None,
            octave: raw::Octave(octave),
            step,
            x: None,
        }
    }

    #[test]
    fn promotes_natural_pitch() {
        let p = promote_pitch(raw_pitch(raw::Step::C, 4, None));
        assert_eq!(p.step, "C");
        assert_eq!(p.octave, 4);
        assert_eq!(p.alter, None);
    }

    #[test]
    fn promotes_pitch_with_alteration() {
        let p = promote_pitch(raw_pitch(raw::Step::B, 3, Some(-1)));
        assert_eq!(p.step, "B");
        assert_eq!(p.octave, 3);
        assert_eq!(p.alter, Some(-1));
    }

    #[test]
    fn discards_vendor_and_id() {
        let raw = raw::Pitch {
            alter: None,
            c: Some(raw::String("comment".to_string())),
            id: Some(raw::Id::try_from("p1".to_string()).unwrap()),
            octave: raw::Octave(5),
            step: raw::Step::G,
            x: None,
        };
        let p = promote_pitch(raw);
        assert_eq!(p.step, "G");
        assert_eq!(p.octave, 5);
    }

    #[test]
    fn promoted_pitch_matches_direct_deserialize() {
        // Belt-and-braces: the engine's existing deserialization path and
        // the promote path must agree on the same JSON.
        let json = r#"{"step":"D","octave":4,"alter":1}"#;
        let direct: Pitch = serde_json::from_str(json).expect("direct deserialise");
        let raw: raw::Pitch = serde_json::from_str(json).expect("raw deserialise");
        let promoted = promote_pitch(raw);
        assert_eq!(direct, promoted);
    }
}

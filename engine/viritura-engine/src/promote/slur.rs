//! Promote MNX slur objects.
//!
//! - `lineType: "wavy"` (in MNX core) is dropped — the engine model only
//!   models solid/dashed/dotted slurs. Wavy slurs render as solid.
//! - `_x.viritura.shape` hoists into `Slur.shape` (engrave-mode bezier
//!   overrides).
//! - `side` / `sideEnd` are strings in the engine model.

use crate::model::event::{
    Slur as ModelSlur, SlurLineType as ModelSlurLineType, SlurShape as ModelSlurShape,
};
use crate::promote::vendor_ext::read_viritura_ext;
use crate::{raw, raw_viritura};

pub(crate) fn promote_slur(r: raw::Slur) -> ModelSlur {
    let shape = read_viritura_ext(r.x.as_ref())
        .and_then(|json| {
            serde_json::from_value::<raw_viritura::SlurExtensions>(serde_json::Value::Object(
                json.clone(),
            ))
            .ok()
        })
        .and_then(|e| e.shape)
        .map(|s| ModelSlurShape {
            p0: s.p0.map(|d| *d),
            p1: s.p1.map(|d| *d),
            p2: s.p2.map(|d| *d),
            p3: s.p3.map(|d| *d),
        });

    ModelSlur {
        target: String::from(r.target),
        side: r.side.map(|s| s.to_string()),
        side_end: r.side_end.map(|s| s.to_string()),
        line_type: r.line_type.and_then(promote_slur_line_type),
        start_note: r.start_note.map(String::from),
        end_note: r.end_note.map(String::from),
        shape,
    }
}

/// Returns `None` for `wavy` (engine model has no wavy variant).
pub(crate) fn promote_slur_line_type(r: raw::LineType) -> Option<ModelSlurLineType> {
    match r {
        raw::LineType::Solid => Some(ModelSlurLineType::Solid),
        raw::LineType::Dashed => Some(ModelSlurLineType::Dashed),
        raw::LineType::Dotted => Some(ModelSlurLineType::Dotted),
        raw::LineType::Wavy => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_slur_with_shape() {
        let json = r#"{
            "target": "e2",
            "side": "up",
            "lineType": "dashed",
            "_x": {"viritura": {"shape": {"p0": [0.5, -1.0]}}}
        }"#;
        let r: raw::Slur = serde_json::from_str(json).unwrap();
        let s = promote_slur(r);
        assert_eq!(s.target, "e2");
        assert_eq!(s.side.as_deref(), Some("up"));
        assert!(matches!(s.line_type, Some(ModelSlurLineType::Dashed)));
        assert_eq!(s.shape.unwrap().p0, Some([0.5, -1.0]));
    }

    #[test]
    fn drops_wavy_line_type() {
        assert!(promote_slur_line_type(raw::LineType::Wavy).is_none());
    }
}

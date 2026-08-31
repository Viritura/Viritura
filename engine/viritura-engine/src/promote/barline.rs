//! Promote [`crate::raw::Barline`] → [`crate::model::barline::Barline`].
//!
//! Since `model::BarlineType` is a direct re-export of `raw::BarlineType`,
//! the only work here is to unwrap `raw::Barline` and rename `type_` to
//! `barline_type`.

use crate::model::barline::Barline;
use crate::raw;

pub(crate) fn promote_barline(raw: raw::Barline) -> Barline {
    Barline {
        barline_type: raw.type_,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::barline::BarlineType;

    #[test]
    fn round_trips_regular() {
        let json = r#"{"type":"regular"}"#;
        let raw: raw::Barline = serde_json::from_str(json).unwrap();
        let direct: Barline = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_barline(raw));
    }

    #[test]
    fn promotes_all_types() {
        for t in [
            BarlineType::Regular,
            BarlineType::Dotted,
            BarlineType::Dashed,
            BarlineType::Heavy,
            BarlineType::Double,
            BarlineType::Final,
            BarlineType::HeavyLight,
            BarlineType::HeavyHeavy,
            BarlineType::Tick,
            BarlineType::Short,
            BarlineType::NoBarline,
        ] {
            let raw = raw::Barline {
                c: None,
                id: None,
                type_: t,
                x: None,
            };
            let _ = promote_barline(raw);
        }
    }
}

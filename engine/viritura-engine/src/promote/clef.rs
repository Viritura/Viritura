//! Promote MNX clef objects.

use crate::model::clef::{Clef, ClefSign, PositionedClef, RhythmicPosition};
use crate::raw;

pub(crate) fn promote_clef(raw: raw::Clef) -> Clef {
    Clef {
        sign: promote_clef_sign(raw.sign),
        staff_position: i32::try_from(raw.staff_position.0).unwrap_or(0),
        color: raw.color.map(String::from),
        glyph: raw.glyph.map(|g| g.0),
        octave: raw.octave.map(|o| i32::try_from(*o).unwrap_or(0)),
        show_octave: raw.show_octave,
    }
}

pub(crate) fn promote_clef_sign(raw: raw::ClefSign) -> ClefSign {
    match raw {
        raw::ClefSign::G => ClefSign::G,
        raw::ClefSign::F => ClefSign::F,
        raw::ClefSign::C => ClefSign::C,
        // ClefSign::TAB exists in the model but not in MNX core — engine-only.
    }
}

pub(crate) fn promote_positioned_clef(raw: raw::PositionedClef) -> PositionedClef {
    PositionedClef {
        clef: promote_clef(raw.clef),
        position: raw.position.map(promote_rhythmic_position),
        staff: raw.staff.map(|s| u32::try_from(s.0).unwrap_or(1)),
    }
}

pub(crate) fn promote_rhythmic_position(raw: raw::RhythmicPosition) -> RhythmicPosition {
    let parts: Vec<u32> = raw
        .fraction
        .0
        .into_iter()
        .map(|i| u32::try_from(i.0).unwrap_or(0))
        .collect();
    let (num, denom) = match parts.as_slice() {
        [n, d] => (*n, *d),
        [n] => (*n, 1),
        _ => (0, 1),
    };
    RhythmicPosition {
        fraction: (num, denom),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_g_clef() {
        let json = r#"{"sign":"G","staffPosition":-2}"#;
        let raw: raw::Clef = serde_json::from_str(json).unwrap();
        let direct: Clef = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_clef(raw));
    }

    #[test]
    fn promotes_ottava_clef() {
        let json = r#"{"sign":"G","staffPosition":-2,"octave":-1,"showOctave":true}"#;
        let raw: raw::Clef = serde_json::from_str(json).unwrap();
        let direct: Clef = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_clef(raw));
    }
}

use serde::{Deserialize, Serialize};

/// Clef sign type — aliased to the MNX `clef-sign` schema (G, F, C).
pub use crate::raw::ClefSign;

/// A clef definition (MNX-aligned).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Clef {
    /// Clef sign: G (treble), F (bass), C (alto/tenor)
    pub sign: ClefSign,
    /// Staff position in half-spaces from center line.
    /// G clef (treble) = -2, F clef (bass) = 2
    #[serde(rename = "staffPosition")]
    pub staff_position: i32,
    /// Optional rendering color (MNX `simple-color`, e.g. "#ff0000").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Optional SMuFL glyph name override (e.g. "gClef8vb", "fClef8va").
    /// When set, the renderer uses this glyph instead of the default for the sign.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyph: Option<String>,
    /// Ottava transposition in octaves: -2, -1, 1, or 2.
    /// MNX `ottava-amount-or-zero`. Absent or 0 means no transposition.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub octave: Option<i32>,
    /// Whether to display the octave indicator ("8" or "15") on the clef glyph.
    /// Defaults to true when `octave` is set. MNX `showOctave`.
    #[serde(rename = "showOctave", skip_serializing_if = "Option::is_none")]
    pub show_octave: Option<bool>,
}

impl Clef {
    /// Returns the effective SMuFL glyph name considering `octave`, `showOctave`,
    /// and explicit `glyph` override. Explicit `glyph` takes priority.
    /// When `octave` is set and `showOctave` is true (default), returns the
    /// appropriate ottava clef glyph (e.g. "gClef8vb" for G clef octave=-1).
    /// Reference: SMuFL clef range U+E050–U+E07F.
    pub fn effective_glyph(&self) -> Option<String> {
        if self.glyph.is_some() {
            return self.glyph.clone();
        }
        let octave = match self.octave {
            Some(o) if o != 0 => o,
            _ => return None,
        };
        // showOctave defaults to true when octave is present
        let show = self.show_octave.unwrap_or(true);
        if !show {
            return None;
        }
        match (&self.sign, octave) {
            (ClefSign::G, -1) => Some("gClef8vb".into()),
            (ClefSign::G, 1) => Some("gClef8va".into()),
            (ClefSign::G, -2) => Some("gClef15mb".into()),
            (ClefSign::G, 2) => Some("gClef15ma".into()),
            (ClefSign::F, -1) => Some("fClef8vb".into()),
            (ClefSign::F, 1) => Some("fClef8va".into()),
            (ClefSign::F, -2) => Some("fClef15mb".into()),
            (ClefSign::F, 2) => Some("fClef15ma".into()),
            (ClefSign::C, -1) => Some("cClef8vb".into()),
            _ => None,
        }
    }

    /// Get the diatonic position of the reference note for this clef.
    /// G clef: G4 (diatonic 32), F clef: F3 (diatonic 24), C clef: C4 (diatonic 28)
    /// When `octave` is set, shifts the reference by 7 per octave
    /// (e.g. G clef octave=-1 → G3 = 25, making notes display an octave higher).
    pub fn reference_diatonic(&self) -> i32 {
        let base = match self.sign {
            ClefSign::G => 4 * 7 + 4, // G4 = 32
            ClefSign::F => 3 * 7 + 3, // F3 = 24
            ClefSign::C => 4 * 7,     // C4 = 28
        };
        let octave_shift = self.octave.unwrap_or(0) * 7;
        base + octave_shift
    }

    /// Get the staff line (from bottom, 0-indexed) that the clef reference sits on.
    pub fn line_from_bottom(&self) -> i32 {
        // staffPosition: 0 = middle line (line 2 from bottom)
        // -2 => line 2+1 = 3... actually:
        // MNX: staffPosition is half-spaces, negative = below center
        // treble G on line 2 from bottom: staffPosition = -2
        // line from bottom = 2 + staffPosition/2 ... but -2/2 = -1, 2+(-1)=1
        // Actually for treble: G sits on line 1 from bottom (second line up)
        2 + (self.staff_position as f64 / 2.0).round() as i32
    }
}

/// A positioned clef at a point in a measure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PositionedClef {
    pub clef: Clef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<RhythmicPosition>,
    /// Staff number this clef belongs to (1-indexed, for grand staff).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
}

/// Rhythmic position within a measure (as a fraction).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RhythmicPosition {
    pub fraction: (u32, u32),
}

impl RhythmicPosition {
    /// Position in quarter-note beats from the measure start.
    ///
    /// The fraction is expressed in whole-note units per the MNX spec
    /// (`[1, 4]` = one quarter note from the start = "beat 2"), so the
    /// conversion to quarter-note beats is always `fraction * 4`, independent
    /// of the active time signature. (A whole note spans four quarter beats.)
    pub fn beats(&self) -> f64 {
        if self.fraction.1 == 0 {
            0.0
        } else {
            (self.fraction.0 as f64 / self.fraction.1 as f64) * 4.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_treble_clef() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: None,
            show_octave: None,
        };
        assert_eq!(clef.reference_diatonic(), 32); // G4
        assert_eq!(clef.line_from_bottom(), 1); // second line from bottom
    }

    #[test]
    fn test_bass_clef() {
        let clef = Clef {
            sign: ClefSign::F,
            staff_position: 2,
            color: None,
            glyph: None,
            octave: None,
            show_octave: None,
        };
        assert_eq!(clef.reference_diatonic(), 24); // F3
        assert_eq!(clef.line_from_bottom(), 3); // fourth line from bottom
    }

    #[test]
    fn test_effective_glyph_no_octave() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: None,
            show_octave: None,
        };
        assert_eq!(clef.effective_glyph(), None);
    }

    #[test]
    fn test_effective_glyph_octave_zero() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(0),
            show_octave: None,
        };
        assert_eq!(clef.effective_glyph(), None);
    }

    #[test]
    fn test_effective_glyph_g_clef_8vb() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(-1),
            show_octave: None,
        };
        assert_eq!(clef.effective_glyph(), Some("gClef8vb".into()));
    }

    #[test]
    fn test_effective_glyph_g_clef_8va() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(1),
            show_octave: None,
        };
        assert_eq!(clef.effective_glyph(), Some("gClef8va".into()));
    }

    #[test]
    fn test_effective_glyph_g_clef_15mb() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(-2),
            show_octave: None,
        };
        assert_eq!(clef.effective_glyph(), Some("gClef15mb".into()));
    }

    #[test]
    fn test_effective_glyph_f_clef_8va() {
        let clef = Clef {
            sign: ClefSign::F,
            staff_position: 2,
            color: None,
            glyph: None,
            octave: Some(1),
            show_octave: None,
        };
        assert_eq!(clef.effective_glyph(), Some("fClef8va".into()));
    }

    #[test]
    fn test_effective_glyph_show_octave_false() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(-1),
            show_octave: Some(false),
        };
        assert_eq!(clef.effective_glyph(), None);
    }

    #[test]
    fn test_effective_glyph_explicit_override() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: Some("fClef".into()),
            octave: Some(-1),
            show_octave: None,
        };
        assert_eq!(clef.effective_glyph(), Some("fClef".into()));
    }

    #[test]
    fn test_deserialize_ottava_clef() {
        let json = r#"{"sign":"G","staffPosition":-2,"octave":-1,"showOctave":true}"#;
        let clef: Clef = serde_json::from_str(json).unwrap();
        assert_eq!(clef.octave, Some(-1));
        assert_eq!(clef.show_octave, Some(true));
        assert_eq!(clef.effective_glyph(), Some("gClef8vb".into()));
    }

    #[test]
    fn test_serialize_ottava_clef() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(-1),
            show_octave: Some(true),
        };
        let json = serde_json::to_string(&clef).unwrap();
        assert!(json.contains(r#""octave":-1"#));
        assert!(json.contains(r#""showOctave":true"#));
    }

    #[test]
    fn test_serialize_no_octave_omits_fields() {
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: None,
            show_octave: None,
        };
        let json = serde_json::to_string(&clef).unwrap();
        assert!(!json.contains("octave"));
        assert!(!json.contains("showOctave"));
    }

    #[test]
    fn test_reference_diatonic_g_clef_8vb() {
        // G clef octave=-1 → reference is G3 (25) instead of G4 (32)
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(-1),
            show_octave: None,
        };
        assert_eq!(clef.reference_diatonic(), 25); // G3 = 3*7+4
    }

    #[test]
    fn test_reference_diatonic_g_clef_8va() {
        // G clef octave=+1 → reference is G5 (39)
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(1),
            show_octave: None,
        };
        assert_eq!(clef.reference_diatonic(), 39); // G5 = 5*7+4
    }

    #[test]
    fn test_reference_diatonic_f_clef_8vb() {
        // F clef octave=-1 → reference is F2 (17) instead of F3 (24)
        let clef = Clef {
            sign: ClefSign::F,
            staff_position: 2,
            color: None,
            glyph: None,
            octave: Some(-1),
            show_octave: None,
        };
        assert_eq!(clef.reference_diatonic(), 17); // F2 = 2*7+3
    }

    #[test]
    fn test_reference_diatonic_g_clef_15mb() {
        // G clef octave=-2 → reference is G2 (18)
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(-2),
            show_octave: None,
        };
        assert_eq!(clef.reference_diatonic(), 18); // G2 = 2*7+4
    }

    #[test]
    fn test_reference_diatonic_no_octave_unchanged() {
        // No octave → same as base reference
        let clef = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: None,
            show_octave: None,
        };
        assert_eq!(clef.reference_diatonic(), 32); // G4
        let clef0 = Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: Some(0),
            show_octave: None,
        };
        assert_eq!(clef0.reference_diatonic(), 32); // octave=0 same as none
    }
}

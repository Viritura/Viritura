use super::clef::RhythmicPosition;
use serde::{Deserialize, Serialize};

/// Chord quality — the harmonic character of a chord symbol. Aliased to
/// the Viritura vendor `chord-quality` schema.
pub use crate::raw_viritura::ChordQuality;

/// Root or bass note of a chord (step + optional alteration).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChordRoot {
    /// Note step: C, D, E, F, G, A, B
    pub step: String,
    /// Chromatic alteration (-1 = flat, 1 = sharp)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alter: Option<i32>,
}

/// A chord symbol above the staff (e.g., "Cmaj7", "Dm", "G7", "F#dim").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChordSymbol {
    /// Rhythmic position within the measure
    pub position: RhythmicPosition,
    /// Root note (e.g., C, F#, Bb)
    pub root: ChordRoot,
    /// Chord quality
    pub quality: ChordQuality,
    /// Optional bass note for slash chords (e.g., C/E → bass = E)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bass: Option<ChordRoot>,
    /// Extension degree (7, 9, 11, 13) — None for triads
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<u32>,
    /// Text override — if set, render this exact string instead of computing from fields
    #[serde(skip_serializing_if = "Option::is_none", rename = "textOverride")]
    pub text_override: Option<String>,
}

impl ChordSymbol {
    /// Build the display string for this chord symbol.
    pub fn display_text(&self) -> String {
        if let Some(ref text) = self.text_override {
            return text.clone();
        }

        let mut s = String::new();

        // Root note
        s.push_str(&self.root.step);
        if let Some(alter) = self.root.alter {
            match alter {
                1 => s.push('#'),
                -1 => s.push('b'),
                2 => s.push_str("##"),
                -2 => s.push_str("bb"),
                _ => {}
            }
        }

        // Quality + extension
        let ext = self.extension.map(|e| e.to_string()).unwrap_or_default();
        match self.quality {
            ChordQuality::Major => {
                if self.extension.is_some() {
                    s.push_str("maj");
                    s.push_str(&ext);
                }
                // Plain major triad: just root letter
            }
            ChordQuality::Minor => {
                s.push('m');
                if self.extension.is_some() {
                    s.push_str(&ext);
                }
            }
            ChordQuality::Dominant => {
                s.push_str(&ext);
            }
            ChordQuality::Diminished => {
                s.push_str("dim");
                if self.extension.is_some() {
                    s.push_str(&ext);
                }
            }
            ChordQuality::Augmented => {
                s.push_str("aug");
                if self.extension.is_some() {
                    s.push_str(&ext);
                }
            }
            ChordQuality::HalfDiminished => {
                s.push('m');
                s.push_str(&ext);
                s.push_str("b5");
            }
            ChordQuality::MinorMajor => {
                s.push_str("m(maj");
                s.push_str(&ext);
                s.push(')');
            }
            ChordQuality::Power => {
                s.push('5');
            }
            ChordQuality::Suspended2 => {
                s.push_str("sus2");
            }
            ChordQuality::Suspended4 => {
                s.push_str("sus4");
            }
        }

        // Bass note for slash chords
        if let Some(ref bass) = self.bass {
            s.push('/');
            s.push_str(&bass.step);
            if let Some(alter) = bass.alter {
                match alter {
                    1 => s.push('#'),
                    -1 => s.push('b'),
                    _ => {}
                }
            }
        }

        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_chord(
        step: &str,
        alter: Option<i32>,
        quality: ChordQuality,
        ext: Option<u32>,
        bass: Option<ChordRoot>,
    ) -> ChordSymbol {
        ChordSymbol {
            position: RhythmicPosition { fraction: (0, 1) },
            root: ChordRoot {
                step: step.into(),
                alter,
            },
            quality,
            bass,
            extension: ext,
            text_override: None,
        }
    }

    #[test]
    fn test_major_triad() {
        let c = make_chord("C", None, ChordQuality::Major, None, None);
        assert_eq!(c.display_text(), "C");
    }

    #[test]
    fn test_major_seventh() {
        let c = make_chord("C", None, ChordQuality::Major, Some(7), None);
        assert_eq!(c.display_text(), "Cmaj7");
    }

    #[test]
    fn test_minor() {
        let c = make_chord("D", None, ChordQuality::Minor, None, None);
        assert_eq!(c.display_text(), "Dm");
    }

    #[test]
    fn test_dominant_seventh() {
        let c = make_chord("G", None, ChordQuality::Dominant, Some(7), None);
        assert_eq!(c.display_text(), "G7");
    }

    #[test]
    fn test_sharp_root() {
        let c = make_chord("F", Some(1), ChordQuality::Diminished, None, None);
        assert_eq!(c.display_text(), "F#dim");
    }

    #[test]
    fn test_flat_root() {
        let c = make_chord("B", Some(-1), ChordQuality::Major, Some(7), None);
        assert_eq!(c.display_text(), "Bbmaj7");
    }

    #[test]
    fn test_slash_chord() {
        let c = make_chord(
            "C",
            None,
            ChordQuality::Major,
            None,
            Some(ChordRoot {
                step: "E".into(),
                alter: None,
            }),
        );
        assert_eq!(c.display_text(), "C/E");
    }

    #[test]
    fn test_half_diminished() {
        let c = make_chord("B", None, ChordQuality::HalfDiminished, Some(7), None);
        assert_eq!(c.display_text(), "Bm7b5");
    }

    #[test]
    fn test_augmented() {
        let c = make_chord("C", None, ChordQuality::Augmented, None, None);
        assert_eq!(c.display_text(), "Caug");
    }

    #[test]
    fn test_suspended() {
        let c = make_chord("D", None, ChordQuality::Suspended4, None, None);
        assert_eq!(c.display_text(), "Dsus4");
    }

    #[test]
    fn test_text_override() {
        let mut c = make_chord("C", None, ChordQuality::Major, None, None);
        c.text_override = Some("C6/9".into());
        assert_eq!(c.display_text(), "C6/9");
    }

    #[test]
    fn test_serialization_roundtrip() {
        let c = make_chord("F", Some(1), ChordQuality::Minor, Some(7), None);
        let json = serde_json::to_string(&c).unwrap();
        let parsed: ChordSymbol = serde_json::from_str(&json).unwrap();
        assert_eq!(c, parsed);
    }
}

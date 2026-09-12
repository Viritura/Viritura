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

/// A time-anchored harmony event rendered as a chord symbol above the staff.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChordSymbol {
    /// Rhythmic position within the measure
    pub position: RhythmicPosition,
    /// Optional imported/per-event display-staff override (1-based).
    #[serde(skip_serializing_if = "Option::is_none", rename = "displayStaff")]
    pub display_staff: Option<u32>,
    /// Original measure-list index retained when layout filters by staff.
    #[serde(skip)]
    pub source_index: Option<usize>,
    /// Source part retained when a layout staff combines multiple parts.
    #[serde(skip)]
    pub source_part_index: Option<usize>,
    /// Root note (e.g., C, F#, Bb)
    pub root: ChordRoot,
    /// Chord quality
    pub quality: ChordQuality,
    /// Authored quality spelling retained alongside the normalized quality.
    #[serde(skip_serializing_if = "Option::is_none", rename = "kindText")]
    pub kind_text: Option<String>,
    /// Optional bass note for slash chords (e.g., C/E → bass = E)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bass: Option<ChordRoot>,
    /// Extension degree (6, 7, 9, 11, 13) — None for triads
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<u32>,
    /// Text override — if set, render this exact string instead of computing from fields
    #[serde(skip_serializing_if = "Option::is_none", rename = "textOverride")]
    pub text_override: Option<String>,
}

impl ChordSymbol {
    /// Build the quality/extension text that follows the root accidental.
    pub fn suffix_text(&self) -> String {
        let mut suffix = String::new();
        let ext = self.extension.map(|e| e.to_string()).unwrap_or_default();
        match self.quality {
            ChordQuality::Major => {
                if self.extension == Some(6) {
                    suffix.push('6');
                } else if self.extension.is_some() {
                    suffix.push_str("maj");
                    suffix.push_str(&ext);
                }
            }
            ChordQuality::Minor => {
                suffix.push('m');
                if self.extension.is_some() {
                    suffix.push_str(&ext);
                }
            }
            ChordQuality::Dominant => {
                suffix.push_str(&ext);
            }
            ChordQuality::Diminished => {
                suffix.push_str("dim");
                if self.extension.is_some() {
                    suffix.push_str(&ext);
                }
            }
            ChordQuality::Augmented => {
                suffix.push_str("aug");
                if self.extension.is_some() {
                    suffix.push_str(&ext);
                }
            }
            ChordQuality::HalfDiminished => {
                suffix.push('m');
                suffix.push_str(&ext);
                suffix.push_str("b5");
            }
            ChordQuality::MinorMajor => {
                suffix.push_str("m(maj");
                suffix.push_str(&ext);
                suffix.push(')');
            }
            ChordQuality::Power => {
                suffix.push('5');
            }
            ChordQuality::Suspended2 => {
                suffix.push_str("sus2");
            }
            ChordQuality::Suspended4 => {
                suffix.push_str("sus4");
            }
            ChordQuality::Other => {
                if let Some(ref kind_text) = self.kind_text {
                    suffix.push_str(kind_text);
                }
            }
        }
        suffix
    }

    /// Build an ASCII fallback used for diagnostics and text-only consumers.
    pub fn display_text(&self) -> String {
        if let Some(ref text) = self.text_override {
            return text.clone();
        }

        let mut s = self.root.step.clone();
        append_ascii_accidental(&mut s, self.root.alter);
        s.push_str(&self.suffix_text());

        if let Some(ref bass) = self.bass {
            s.push('/');
            s.push_str(&bass.step);
            append_ascii_accidental(&mut s, bass.alter);
        }

        s
    }
}

fn append_ascii_accidental(text: &mut String, alter: Option<i32>) {
    match alter {
        Some(1) => text.push('#'),
        Some(-1) => text.push('b'),
        Some(2) => text.push_str("##"),
        Some(-2) => text.push_str("bb"),
        Some(0) | None => {}
        Some(_) => {}
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
            display_staff: None,
            source_index: None,
            source_part_index: None,
            root: ChordRoot {
                step: step.into(),
                alter,
            },
            quality,
            kind_text: None,
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
    fn test_major_sixth() {
        let c = make_chord("C", None, ChordQuality::Major, Some(6), None);
        assert_eq!(c.display_text(), "C6");
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

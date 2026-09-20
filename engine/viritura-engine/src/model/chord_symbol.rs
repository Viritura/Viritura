use super::clef::RhythmicPosition;
use serde::{Deserialize, Serialize};

/// Chord quality — the harmonic character of a chord symbol. Aliased to
/// the Viritura vendor `chord-quality` schema.
pub use crate::raw_viritura::ChordQuality;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ChordRootCase {
    #[default]
    Uppercase,
    LowercaseMinor,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum MajorSeventhStyle {
    #[serde(rename = "triangle")]
    #[default]
    Triangle,
    #[serde(rename = "maj")]
    Maj,
    #[serde(rename = "M")]
    CapitalM,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum MinorStyle {
    #[serde(rename = "m")]
    #[default]
    M,
    #[serde(rename = "min")]
    Min,
    #[serde(rename = "minus")]
    Minus,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DiminishedStyle {
    #[default]
    Symbol,
    Dim,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum HalfDiminishedStyle {
    #[default]
    Symbol,
    MinorFlatFive,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AugmentedStyle {
    #[default]
    Plus,
    Aug,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ChordExtensionPosition {
    #[default]
    Superscript,
    Baseline,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ChordSymbolStyle {
    pub root_case: ChordRootCase,
    pub major_seventh: MajorSeventhStyle,
    pub minor: MinorStyle,
    pub diminished: DiminishedStyle,
    pub half_diminished: HalfDiminishedStyle,
    pub augmented: AugmentedStyle,
    pub extensions: ChordExtensionPosition,
}

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
    /// Original measure-list index retained when layout filters by staff.
    #[serde(skip)]
    pub source_index: Option<usize>,
    /// Source part retained when a layout staff combines multiple parts.
    #[serde(skip)]
    pub source_part_index: Option<usize>,
    /// Structured root, absent for unrecognized text and no-chord declarations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<ChordRoot>,
    /// Chord quality, when supplied by the author.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<ChordQuality>,
    /// Original authored text, including malformed symbols and NC, verbatim.
    /// Supported spellings use semantic house style; unsupported descriptions remain literal.
    #[serde(skip_serializing_if = "Option::is_none", rename = "rawText")]
    pub raw_text: Option<String>,
    /// Authored quality spelling, or the entire suffix when it carries degree modifiers.
    /// Quality/extension retain the base harmony; this is not a display override.
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
        match self.quality.unwrap_or(ChordQuality::Major) {
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

    /// Build a style-independent ASCII fallback for diagnostics, import/export
    /// compatibility, and tests. Engraving uses structured house-style runs.
    pub fn display_text(&self) -> String {
        if let Some(ref text) = self.text_override {
            return text.clone();
        }

        let Some(root) = self.root.as_ref() else {
            return self.raw_text.clone().unwrap_or_default();
        };
        let mut s = root.step.clone();
        append_ascii_accidental(&mut s, root.alter);
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
            source_index: None,
            source_part_index: None,
            root: Some(ChordRoot {
                step: step.into(),
                alter,
            }),
            quality: Some(quality),
            raw_text: None,
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
    fn test_rootless_authored_text_roundtrip() {
        for text in ["NC", "N.C.", "  ???♭  ", "H#?!", ""] {
            let json = serde_json::json!({
                "position": {"fraction": [1, 4]},
                "rawText": text
            });
            let chord: ChordSymbol = serde_json::from_value(json.clone()).unwrap();
            assert!(chord.root.is_none());
            assert!(chord.quality.is_none());
            assert_eq!(chord.raw_text.as_deref(), Some(text));
            assert_eq!(chord.display_text(), text);
            assert_eq!(serde_json::to_value(&chord).unwrap(), json);
        }
    }

    #[test]
    fn test_missing_quality_is_not_materialized() {
        let json = serde_json::json!({
            "position": {"fraction": [0, 1]},
            "root": {"step": "F", "alter": 1}
        });
        let chord: ChordSymbol = serde_json::from_value(json.clone()).unwrap();
        assert!(chord.quality.is_none());
        assert_eq!(chord.display_text(), "F#");
        assert_eq!(serde_json::to_value(&chord).unwrap(), json);
    }

    #[test]
    fn test_structured_chord_retains_authored_spelling() {
        let mut chord = make_chord("B", Some(-1), ChordQuality::Major, Some(7), None);
        chord.raw_text = Some("B♭Δ7".into());
        chord.kind_text = Some("Δ7".into());
        assert_eq!(chord.display_text(), "Bbmaj7");
        let json = serde_json::to_value(&chord).unwrap();
        assert_eq!(json["rawText"], "B♭Δ7");
        assert_eq!(json["kindText"], "Δ7");
        assert!(json.get("textOverride").is_none());
        assert_eq!(serde_json::from_value::<ChordSymbol>(json).unwrap(), chord);
    }

    #[test]
    fn test_modified_chord_preserves_base_harmony_and_verbatim_suffix() {
        let json = serde_json::json!({
            "position": {"fraction": [0, 1]},
            "root": {"step": "C"},
            "quality": "major",
            "rawText": "  Cadd79omit5/E  ",
            "kindText": "add79omit5",
            "bass": {"step": "E"}
        });
        let chord: ChordSymbol = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(chord.quality, Some(ChordQuality::Major));
        assert_eq!(chord.extension, None);
        assert_eq!(chord.kind_text.as_deref(), Some("add79omit5"));
        assert_eq!(serde_json::to_value(chord).unwrap(), json);
    }

    #[test]
    fn test_rootless_text_override_does_not_invent_harmony() {
        let mut chord = make_chord("C", None, ChordQuality::Major, None, None);
        chord.root = None;
        chord.quality = None;
        chord.raw_text = Some("N.C.".into());
        chord.text_override = Some("NC".into());
        assert_eq!(chord.display_text(), "NC");
        assert_eq!(chord.raw_text.as_deref(), Some("N.C."));
        assert!(chord.root.is_none());
        chord.raw_text = None;
        chord.text_override = None;
        assert_eq!(chord.display_text(), "");
    }

    #[test]
    fn test_serialization_roundtrip() {
        let c = make_chord("F", Some(1), ChordQuality::Minor, Some(7), None);
        let json = serde_json::to_string(&c).unwrap();
        let parsed: ChordSymbol = serde_json::from_str(&json).unwrap();
        assert_eq!(c, parsed);
    }
}

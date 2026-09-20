//! Interpret supported authored spellings for engraving copies only.
//! Core's chord resolver owns musical truth; this private projection neither
//! changes stored harmony nor supplies playback/voicing.

use super::display_spelling::parse_text_root;
use crate::model::{ChordQuality, ChordRoot, ChordSymbol};

#[derive(Clone, Copy)]
struct Quality {
    kind: ChordQuality,
    extension: Option<u32>,
}

impl Quality {
    fn normalized(kind: ChordQuality, extension: Option<u32>) -> Option<Self> {
        if kind == ChordQuality::Other
            || extension.is_some_and(|value| !matches!(value, 6 | 7 | 9 | 11 | 13))
            || (kind == ChordQuality::Power && extension.is_some())
        {
            return None;
        }
        let implied_seventh = matches!(
            kind,
            ChordQuality::Dominant | ChordQuality::HalfDiminished | ChordQuality::MinorMajor
        );
        Some(Self {
            kind,
            extension: extension.or(implied_seventh.then_some(7)),
        })
    }

    // A compact equality key, not a voicing: aliases may name the same harmony
    // with different quality/extension pairs (e.g. diminished 6 and 7).
    fn intervals(self) -> u16 {
        let third = match self.kind {
            ChordQuality::Minor
            | ChordQuality::MinorMajor
            | ChordQuality::Diminished
            | ChordQuality::HalfDiminished => 3,
            ChordQuality::Suspended2 => 2,
            ChordQuality::Suspended4 => 5,
            ChordQuality::Power => 0,
            _ => 4,
        };
        let fifth = match self.kind {
            ChordQuality::Diminished | ChordQuality::HalfDiminished => 6,
            ChordQuality::Augmented => 8,
            _ => 7,
        };
        let mut key = 1 | (1 << third) | (1 << fifth);
        if let Some(extension) = self.extension {
            let seventh = match self.kind {
                _ if extension == 6 => 9,
                ChordQuality::Major | ChordQuality::MinorMajor => 11,
                ChordQuality::Diminished => 9,
                _ => 10,
            };
            key |= 1 << seventh;
            for (degree, interval) in [(9, 2), (11, 5), (13, 9)] {
                if extension >= degree {
                    key |= 1 << interval;
                }
            }
        }
        key
    }
}

fn split_extension(text: &str) -> (&str, Option<u32>) {
    for (suffix, value) in [("13", 13), ("11", 11), ("9", 9), ("7", 7), ("6", 6)] {
        if let Some(marker) = text.strip_suffix(suffix) {
            return (marker, Some(value));
        }
    }
    (text, None)
}

fn parse_quality(text: &str) -> Option<Quality> {
    use ChordQuality::*;
    let lower = text.to_lowercase();
    let special = match text {
        "Δ" | "△" => Some((Major, Some(7))),
        "5" => Some((Power, None)),
        _ if lower == "m7b5" => Some((HalfDiminished, Some(7))),
        _ => None,
    };
    if let Some((kind, extension)) = special {
        return Quality::normalized(kind, extension);
    }
    for (suffix, kind) in [
        ("sus2", Suspended2),
        ("sus4", Suspended4),
        ("sus", Suspended4),
    ] {
        if let Some(prefix) = lower.strip_suffix(suffix) {
            let (rest, extension) = split_extension(prefix);
            return rest
                .is_empty()
                .then(|| Quality::normalized(kind, extension))?;
        }
    }
    let (marker, extension) = split_extension(text);
    if matches!(marker, "ø" | "0") {
        return Quality::normalized(HalfDiminished, extension);
    }
    let lower_marker = marker.to_lowercase();
    for minor in ["min", "m", "-"] {
        if lower_marker
            .strip_prefix(minor)
            .is_some_and(|major| matches!(major, "maj" | "ma" | "m" | "δ" | "△"))
        {
            return Quality::normalized(MinorMajor, extension);
        }
    }
    let kind = match marker {
        "" if extension.is_some_and(|value| value != 6) => Dominant,
        "" | "maj" | "Maj" | "MAJ" | "ma" | "Ma" | "M" | "Δ" | "△" => Major,
        "m" | "min" | "Min" | "MIN" | "-" => Minor,
        "dim" | "Dim" | "DIM" | "o" | "°" => Diminished,
        "aug" | "Aug" | "AUG" | "+" => Augmented,
        _ => return None,
    };
    Quality::normalized(kind, extension)
}

fn pitch_class(root: &ChordRoot) -> Option<i32> {
    let natural = match root.step.as_str() {
        "C" => 0,
        "D" => 2,
        "E" => 4,
        "F" => 5,
        "G" => 7,
        "A" => 9,
        "B" => 11,
        _ => return None,
    };
    Some((natural + root.alter.unwrap_or(0).rem_euclid(12)).rem_euclid(12))
}

struct Harmony {
    root: ChordRoot,
    bass: Option<ChordRoot>,
    quality: Quality,
}

impl Harmony {
    fn key(&self) -> Option<(i32, i32, u16)> {
        Some((
            pitch_class(&self.root)?,
            pitch_class(self.bass.as_ref().unwrap_or(&self.root))?,
            self.quality.intervals(),
        ))
    }

    fn from_text(text: &str) -> Option<Self> {
        // The spelling splitter also supports natural signs for transposing
        // literals; core's supported chord-entry grammar does not.
        if text.contains('♮') {
            return None;
        }
        let root = parse_text_root(text.trim())?;
        let (suffix, bass) = match root.rest.split_once('/') {
            Some((suffix, tail)) => {
                let bass = parse_text_root(tail)?;
                if !bass.rest.is_empty() {
                    return None;
                }
                (suffix, Some(bass.root))
            }
            None => (root.rest, None),
        };
        Some(Self {
            root: root.root,
            bass,
            quality: parse_quality(suffix)?,
        })
    }
}

/// Infer missing display fields only for supported raw-only input. Otherwise,
/// retain the structured spelling after checking all authored descriptions.
pub(super) fn semantic_display(chord: &ChordSymbol) -> Option<ChordSymbol> {
    let harmony = if let Some(root) = &chord.root {
        Harmony {
            root: root.clone(),
            bass: chord.bass.clone(),
            quality: Quality::normalized(
                chord.quality.unwrap_or(ChordQuality::Major),
                chord.extension,
            )?,
        }
    } else {
        if chord.quality.is_some()
            || chord.bass.is_some()
            || chord.extension.is_some()
            || chord.kind_text.is_some()
        {
            return None;
        }
        Harmony::from_text(chord.raw_text.as_deref()?)?
    };
    let key = harmony.key()?;
    if let Some(raw) = &chord.raw_text {
        if Harmony::from_text(raw)?.key()? != key {
            return None;
        }
    }
    if let Some(kind) = &chord.kind_text {
        if parse_quality(kind)?.intervals() != harmony.quality.intervals() {
            return None;
        }
    }
    let mut display = chord.clone();
    display.root = Some(harmony.root);
    display.bass = harmony.bass;
    display.quality = Some(harmony.quality.kind);
    display.extension = harmony.quality.extension;
    Some(display)
}

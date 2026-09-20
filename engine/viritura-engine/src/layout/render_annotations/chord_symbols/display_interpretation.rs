//! Interpret supported authored spellings for engraving copies only.
//! Core's chord resolver owns musical truth; this private projection neither
//! changes stored harmony nor supplies playback/voicing.

use super::display_spelling::parse_text_root;
use crate::model::{ChordQuality, ChordRoot, ChordSymbol};

#[path = "display_interpretation/modifiers.rs"]
mod modifiers;
use modifiers::Modifiers;

#[cfg(test)]
#[path = "display_interpretation/tests.rs"]
mod tests;

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
        Modifiers::default().intervals(self.degrees())
    }

    fn degrees(self) -> [u16; 14] {
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
        let mut degrees = [0; 14];
        degrees[1] = 1;
        let third_degree = match self.kind {
            ChordQuality::Suspended2 => 2,
            ChordQuality::Suspended4 => 4,
            ChordQuality::Power => 1,
            _ => 3,
        };
        degrees[third_degree] |= 1 << third;
        degrees[5] = 1 << fifth;
        if let Some(extension) = self.extension {
            let seventh = match self.kind {
                _ if extension == 6 => 9,
                ChordQuality::Major | ChordQuality::MinorMajor => 11,
                ChordQuality::Diminished => 9,
                _ => 10,
            };
            degrees[if extension == 6 { 6 } else { 7 }] = 1 << seventh;
            for (degree, interval) in [(9, 2), (11, 5), (13, 9)] {
                if extension >= degree {
                    degrees[degree as usize] = 1 << interval;
                }
            }
        }
        degrees
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
    if let Some(kind) = match marker.to_ascii_lowercase().as_str() {
        "sus2" => Some(Suspended2),
        "sus4" | "sus" => Some(Suspended4),
        _ => None,
    } {
        return Quality::normalized(kind, extension);
    }
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

fn parse_suffix(text: &str) -> Option<(Quality, Modifiers)> {
    let lower = text.to_ascii_lowercase();
    let boundary = ["add", "omit", "no", "("]
        .into_iter()
        .filter_map(|marker| lower.find(marker))
        .min()
        .unwrap_or(text.len());
    let base = &text[..boundary];
    let mut quality = parse_quality(if boundary < text.len() {
        base.trim()
    } else {
        base
    })?;
    let mut modifiers = Modifiers::parse(&text[boundary..])?;
    if quality.kind == ChordQuality::Major
        && quality.extension.is_none()
        && modifiers.added == [6]
        && modifiers.omitted.is_empty()
    {
        quality.extension = Some(6);
        modifiers = Modifiers::default();
    }
    Some((quality, modifiers))
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
    modifiers: Modifiers,
}

impl Harmony {
    fn key(&self) -> Option<(i32, i32, u16)> {
        Some((
            pitch_class(&self.root)?,
            pitch_class(self.bass.as_ref().unwrap_or(&self.root))?,
            self.modifiers.intervals(self.quality.degrees()),
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
        let (quality, modifiers) = parse_suffix(suffix)?;
        Some(Self {
            root: root.root,
            bass,
            quality,
            modifiers,
        })
    }
}

pub(super) struct SemanticDisplay {
    pub(super) symbol: ChordSymbol,
    pub(super) modifier_label: String,
}

/// Infer missing display fields only for supported raw-only input. Otherwise,
/// retain the structured spelling after checking all authored descriptions.
pub(super) fn semantic_display(chord: &ChordSymbol) -> Option<SemanticDisplay> {
    let harmony = if let Some(root) = &chord.root {
        let quality = Quality::normalized(
            chord.quality.unwrap_or(ChordQuality::Major),
            chord.extension,
        )?;
        let modifiers = if let Some(kind) = &chord.kind_text {
            let (base, modifiers) = parse_suffix(kind)?;
            if base.intervals() != quality.intervals()
                || modifiers.intervals(base.degrees()) != modifiers.intervals(quality.degrees())
            {
                return None;
            }
            modifiers
        } else {
            Modifiers::default()
        };
        Harmony {
            root: root.clone(),
            bass: chord.bass.clone(),
            quality,
            modifiers,
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
    let mut display = chord.clone();
    display.root = Some(harmony.root);
    display.bass = harmony.bass;
    display.quality = Some(harmony.quality.kind);
    display.extension = harmony.quality.extension;
    Some(SemanticDisplay {
        symbol: display,
        modifier_label: harmony.modifiers.label(),
    })
}

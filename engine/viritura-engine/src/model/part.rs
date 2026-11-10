use super::kit::KitComponent;
use super::measure::PartMeasure;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Source-part display policy for the score-wide harmony track.
pub use crate::raw_viritura::PartExtensionsChordSymbolVisibility as ChordSymbolVisibility;

/// MNX interval — chromatic + diatonic components.
/// Convention: sounding pitch + interval = written pitch.
/// Ref: MNX spec objects/interval
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Interval {
    /// Chromatic distance in semitones (signed).
    pub half_steps: i32,
    /// Diatonic staff distance in staff positions (signed).
    pub staff_distance: i32,
}

/// MNX part-transposition — transposing instrument configuration.
/// Ref: MNX spec objects/part-transposition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transposition {
    /// The sounding→written transposition interval.
    pub interval: Interval,
    /// Circle-of-fifths value at which key signatures flip enharmonically.
    /// Non-negative: subtract 12 fifths; negative: add 12 fifths.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_fifths_flip_at: Option<i32>,
    /// Instrument prefers written pitches even in concert-pitch scores
    /// (e.g. piccolo, glockenspiel, double bass).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefers_written_pitches: Option<bool>,
}

/// A part (instrument) in the score.
///
/// Model-internal type — construction goes through `promote::part::promote_part`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Part {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "shortName")]
    pub short_name: Option<String>,
    pub measures: Vec<PartMeasure>,
    /// Number of staves for this part (default 1; grand staff = 2, organ = 3).
    pub staves: u32,
    /// Unset or auto uses automatic placement of score-wide chord symbols.
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "chordSymbolVisibility"
    )]
    pub chord_symbol_visibility: Option<ChordSymbolVisibility>,
    /// Transposition for transposing instruments (MNX `transposition`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transposition: Option<Transposition>,
    /// Provisional instrument identities retained from `_x.viritura`.
    #[serde(flatten)]
    pub instrument_extensions: super::instrument::PartInstrumentExtensions,
    /// Drum-kit component map (MNX `kit`). When present, this part is an
    /// unpitched percussion part. Keys are component IDs (e.g. "kick").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kit: Option<HashMap<String, KitComponent>>,
}

impl Part {
    pub(crate) fn shows_chord_symbols(&self) -> bool {
        match self.chord_symbol_visibility {
            Some(ChordSymbolVisibility::Show) => true,
            Some(ChordSymbolVisibility::Hide) => false,
            None | Some(ChordSymbolVisibility::Auto) => {
                let extensions = &self.instrument_extensions;
                let instrument_id = extensions.instrument_id.as_deref().or_else(|| {
                    extensions
                        .initial_instrument
                        .as_ref()
                        .and_then(|key| extensions.instruments.get(key))
                        .map(|instrument| instrument.instrument_id.as_str())
                });
                instrument_id.is_some_and(|id| {
                    // Keep the sound-ID families in sync with @viritura/core.
                    [
                        "keyboard.piano",
                        "pluck.bass",
                        "pluck.guitar",
                        "strings.contrabass",
                    ]
                    .iter()
                    .any(|family| {
                        id == *family
                            || id
                                .strip_prefix(*family)
                                .is_some_and(|suffix| suffix.starts_with('.'))
                    })
                })
            }
        }
    }
}

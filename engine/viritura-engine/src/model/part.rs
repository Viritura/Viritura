use super::kit::KitComponent;
use super::measure::PartMeasure;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    /// Transposition for transposing instruments (MNX `transposition`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transposition: Option<Transposition>,
    /// Drum-kit component map (MNX `kit`). When present, this part is an
    /// unpitched percussion part. Keys are component IDs (e.g. "kick").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kit: Option<HashMap<String, KitComponent>>,
}

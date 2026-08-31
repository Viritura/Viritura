use super::barline::Barline;
use super::beam::Beam;
use super::chord_symbol::ChordSymbol;
use super::clef::{PositionedClef, RhythmicPosition};
use super::direction::{
    Coda, DynamicGroup, Fine, Jump, MultiStaffOrientation, Ottava, Pedal, RehearsalMark, Segno,
    Tempo, TextExpression,
};
use super::event::{ArpeggioDirection, Sequence};
use super::key::KeySignature;
use super::kit::KitComponent;
use super::repeat::{Ending, RepeatEnd, RepeatStart};
use super::time::TimeSignature;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Generic wrapper for the MNX `_x` vendor extension dict.
/// `T` is the vendor-specific payload (e.g. `GlobalMeasureExtensions`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct VendorExtensions<T> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viritura: Option<T>,
}

/// Viritura vendor extensions on a global measure (`_x.viritura`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct GlobalMeasureExtensions {
    /// Rehearsal mark (e.g. "A", "B")
    #[serde(skip_serializing_if = "Option::is_none", rename = "rehearsalMark")]
    pub rehearsal_mark: Option<RehearsalMark>,
    /// Coda marker
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coda: Option<Coda>,
    /// Jump direction (non-standard types like dsalcoda/dcalcoda)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump: Option<Jump>,
    /// Open-meter semantic kept outside standard MNX `time.display`.
    #[serde(skip_serializing_if = "Option::is_none", rename = "senzaMisura")]
    pub senza_misura: Option<bool>,
}

/// A global measure — score-wide properties (MNX global.measures[n]).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GlobalMeasure {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Custom measure number override (MNX `number`).
    /// When set, overrides the default sequential numbering.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<TimeSignature>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<KeySignature>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub barline: Option<Barline>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "repeatStart")]
    pub repeat_start: Option<RepeatStart>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "repeatEnd")]
    pub repeat_end: Option<RepeatEnd>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ending: Option<Ending>,
    /// Tempo markings in this measure (MNX `tempos[]`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tempos: Option<Vec<Tempo>>,
    /// Segno marker (MNX `segno`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segno: Option<Segno>,
    /// Fine marker (MNX `fine`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fine: Option<Fine>,
    /// Jump direction (MNX `jump` or `_x.viritura.jump`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump: Option<Jump>,
    /// Vendor extensions (`_x.viritura`)
    #[serde(skip_serializing_if = "Option::is_none", rename = "_x")]
    pub extensions: Option<VendorExtensions<GlobalMeasureExtensions>>,
}

// -- GlobalMeasure: model-internal type (no Deserialize).
//
// Construction goes through `promote::measure::promote_global_measure`
// (full parse) or `promote::promote_global_measure_json` (external
// patch flow). See `docs/spec/data-model-pipeline.md`.

impl GlobalMeasure {
    /// Convenience accessor for `_x.viritura.rehearsalMark`.
    pub fn rehearsal_mark(&self) -> Option<&RehearsalMark> {
        self.extensions
            .as_ref()?
            .viritura
            .as_ref()?
            .rehearsal_mark
            .as_ref()
    }
    /// Convenience accessor for `_x.viritura.coda`.
    pub fn coda(&self) -> Option<&Coda> {
        self.extensions.as_ref()?.viritura.as_ref()?.coda.as_ref()
    }
}

/// A part-specific measure (MNX parts[n].measures[m]).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PartMeasure {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clefs: Option<Vec<PositionedClef>>,
    #[serde(default)]
    pub sequences: Vec<Sequence>,
    /// Arpeggio markings in this measure (MNX `arpeggios[]`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arpeggios: Option<Vec<MnxArpeggio>>,
    /// Non-arpeggio markings in this measure (MNX `nonArpeggios[]`)
    #[serde(skip_serializing_if = "Option::is_none", rename = "nonArpeggios")]
    pub non_arpeggios: Option<Vec<NonArpeggio>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beams: Option<Vec<Beam>>,
    /// Dynamic markings in this measure (MNX `dynamics[]`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dynamics: Option<Vec<DynamicGroup>>,
    /// Ottava markings in this measure (MNX `ottavas[]`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ottavas: Option<Vec<Ottava>>,
    /// Simile marking covering this measure and the following `number - 1`
    /// measures (MNX `measureRepeat`).
    #[serde(skip_serializing_if = "Option::is_none", rename = "measureRepeat")]
    pub measure_repeat: Option<MeasureRepeat>,
    /// Piano pedal markings in this measure (Viritura extension `_x.viritura.pedals[]`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pedals: Option<Vec<Pedal>>,
    /// Chord symbols above the staff (Viritura extension `_x.viritura.chordSymbols[]`)
    #[serde(skip_serializing_if = "Option::is_none", rename = "chordSymbols")]
    pub chord_symbols: Option<Vec<ChordSymbol>>,
    /// Text expressions in this measure (Viritura extension `_x.viritura.expressions[]`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expressions: Option<Vec<TextExpression>>,
    /// User-specified condensing override for this measure (Viritura extension `_x.viritura.condensingOverride`).
    /// Values: "unison", "solo1", "solo2", "amalgamate", "divisi"
    #[serde(skip_serializing_if = "Option::is_none", rename = "condensingOverride")]
    pub condensing_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IdPair {
    pub start: String,
    pub end: String,
}

/// Counter printed with a measure-repeat sign so players can track the current
/// iteration (MNX `measure-repeat-counter`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeasureRepeatCounter {
    pub count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<MultiStaffOrientation>,
}

/// A simile marking: "repeat all music in the previous N measures"
/// (MNX `measure-repeat`). Only the first bar of a multi-bar repeat carries it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeasureRepeat {
    /// Number of measures the sign repeats.
    pub number: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counter: Option<MeasureRepeatCounter>,
    /// Whether to print the count above the sign. `None` and `Auto` leave the
    /// decision to engraving convention.
    #[serde(skip_serializing_if = "Option::is_none", rename = "displayNumber")]
    pub display_number: Option<crate::raw::YesNoAuto>,
    /// Vertical origin of the glyph on the staff; `None` means centred.
    #[serde(skip_serializing_if = "Option::is_none", rename = "staffPosition")]
    pub staff_position: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MnxArpeggio {
    pub position: RhythmicPosition,
    pub span: IdPair,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<ArpeggioDirection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrow: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NonArpeggio {
    pub position: RhythmicPosition,
    pub span: IdPair,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

// -- PartMeasure: model-internal type (no Deserialize).
//
// Construction goes through `promote::measure::promote_part_measure`
// (full parse) or `promote::promote_part_measure_json` (external
// patch flow). See `docs/spec/data-model-pipeline.md`.

/// Resolved measure — global + part data merged for rendering.
#[derive(Debug, Clone)]
pub struct ResolvedMeasure {
    pub index: usize,
    pub global: GlobalMeasure,
    pub part: PartMeasure,
    /// This measure is represented by a measure-repeat sign at this index or an
    /// earlier index in the same part. Derived during resolution; never stored.
    pub measure_repeat_covered: bool,
    /// Whether the following measure starts a repeat, used to resolve the
    /// combined repeat-end/repeat-start barline at this measure's boundary.
    pub next_has_repeat_start: bool,
    pub active_time: TimeSignature,
    pub active_key: KeySignature,
    /// The display key in effect in the measure immediately before this one.
    /// Used to draw cancellation naturals when a key change reduces or removes
    /// accidentals (e.g. a change to an open/atonal key must show the previous
    /// signature being cancelled). Equals `active_key` when no change occurs.
    pub prev_key: KeySignature,
    /// IDs of notes tied into this measure from an earlier measure. These
    /// continuations suppress automatic accidental spacing unless the renderer
    /// elects to show a courtesy accidental at a system start.
    pub tie_continuation_ids: Vec<String>,
    /// Transposition interval to apply when rendering (staff_distance, half_steps).
    /// Only set when useWritten is true and the part has a transposition.
    /// Convention (MNX): sounding + interval = written.
    pub transposition: Option<(i32, i32)>,
    /// Whether a condensing mode change occurs at this measure (condensed staves only).
    /// When true, a dashed condensing change marker should be rendered at the barline.
    pub condensing_change: bool,
    /// Kit components for percussion parts (cloned from Part.kit during resolve).
    /// Used by layout to look up staffPosition + notehead shape for kit-notes.
    pub kit: Option<HashMap<String, KitComponent>>,
}

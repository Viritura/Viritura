use super::direction::Caesura;
use super::duration::Duration;
use super::kit::PerformOptions;
use super::pitch::Pitch;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A rest marker with optional staff position override.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Rest {
    /// Explicit staff position (MNX staffPosition). When present, overrides
    /// the default rest Y position. 0 = middle line, positive = up.
    #[serde(skip_serializing_if = "Option::is_none", rename = "staffPosition")]
    pub staff_position: Option<i32>,
}

/// Written pitch information for transposed scores (MNX `written`).
/// Provides per-note enharmonic override for transposed display.
/// Ref: MNX spec objects/written
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Written {
    /// Diatonic delta applied after computing the transposed pitch.
    /// Example: C-flat written as B natural → diatonicDelta = -1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diatonic_delta: Option<i32>,
}

/// A single note within an event.
///
/// For pitched notes, `pitch` is the actual pitch and `kit_component` is None.
/// For drum-kit hits (MNX `kit-note`), `kit_component` references a
/// `KitComponent` on the parent Part's kit, and `pitch` is a parser-supplied
/// placeholder (C4) — renderer/playback paths look up the kit component
/// instead of reading `pitch`. On serialization the `pitch` field is omitted
/// when `kit_component` is set, so the emitted JSON matches the MNX spec.
#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    /// The pitch of this note (placeholder C4 for kit-notes).
    pub pitch: Pitch,
    /// Unique ID
    pub id: Option<String>,
    /// Tie to target note
    pub ties: Option<Vec<Tie>>,
    /// Accidental display control
    pub accidental_display: Option<AccidentalDisplay>,
    /// Written pitch info for transposed scores (MNX `written`).
    pub written: Option<Written>,
    /// Per-note staff number for cross-staff notation (MNX `staff`, 1-indexed).
    pub staff: Option<u32>,
    /// MNX `kit-note.kitComponent` — ID ref into the part's `kit`. When set
    /// this note is a drum-kit hit, not a pitched note.
    pub kit_component: Option<String>,
    /// MNX `kit-note.perform` (currently a stub object).
    pub perform: Option<PerformOptions>,
    /// Source part index for condensing (internal, not serialized).
    /// Set when this note was merged from a specific source part in a condensed chord.
    pub source_part_index: Option<usize>,
    /// Canonical source event path for condensed-note selection (internal, not serialized).
    pub source_event_id: Option<String>,
    /// Original note index within the source event (internal, not serialized).
    /// Used to generate correct per-note element IDs for condensed chord notes.
    pub source_note_index: Option<usize>,
}

impl Note {
    /// True if this note is a drum-kit hit (MNX `kit-note`) rather than a
    /// pitched note.
    pub fn is_kit_note(&self) -> bool {
        self.kit_component.is_some()
    }
}

impl Default for Note {
    fn default() -> Self {
        Note {
            pitch: placeholder_pitch(),
            id: None,
            ties: None,
            accidental_display: None,
            written: None,
            staff: None,
            kit_component: None,
            perform: None,
            source_part_index: None,
            source_event_id: None,
            source_note_index: None,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct NoteRaw {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pitch: Option<Pitch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ties: Option<Vec<Tie>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "accidentalDisplay"
    )]
    accidental_display: Option<AccidentalDisplay>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    written: Option<Written>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    staff: Option<u32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "kitComponent"
    )]
    kit_component: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    perform: Option<PerformOptions>,
}

fn placeholder_pitch() -> Pitch {
    // C4 — only used as a placeholder for kit notes which never read pitch.
    Pitch {
        step: "C".into(),
        octave: 4,
        alter: None,
    }
}

impl Serialize for Note {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let raw = NoteRaw {
            pitch: if self.kit_component.is_some() {
                None
            } else {
                Some(self.pitch.clone())
            },
            id: self.id.clone(),
            ties: self.ties.clone(),
            accidental_display: self.accidental_display.clone(),
            written: self.written.clone(),
            staff: self.staff,
            kit_component: self.kit_component.clone(),
            perform: self.perform.clone(),
        };
        raw.serialize(serializer)
    }
}

// Note: model-internal type. Construction goes through
// `promote::note::promote_note`. See `docs/spec/data-model-pipeline.md`.

/// Tie reference.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tie {
    /// Target note ID (absent for laissez vibrer ties).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Tie target type: nextNote, crossVoice, arpeggio, crossJump.
    #[serde(skip_serializing_if = "Option::is_none", rename = "targetType")]
    pub target_type: Option<String>,
    /// Explicit curve side: "up" or "down".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    /// Laissez vibrer — tie trails off with no target.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lv: Option<bool>,
}

/// Accidental enclosure symbol (MNX `accidental-enclosure-symbol`) —
/// leaf enum aliased from codegen.
pub use crate::raw::AccidentalEnclosureSymbol;

/// Accidental enclosure (MNX accidental-enclosure).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccidentalEnclosure {
    pub symbol: AccidentalEnclosureSymbol,
}

/// Accidental display control (MNX accidental-display).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccidentalDisplay {
    pub show: bool,
    /// Force display even if redundant (courtesy/cautionary accidental).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
    /// Visual enclosure around the accidental (parentheses or brackets).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enclosure: Option<AccidentalEnclosure>,
}

/// Staccato marking. Presence indicates the articulation; `orient` controls placement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Staccato {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Staccatissimo (wedge staccato) marking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Staccatissimo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Staccatissimo wedge variant (SMuFL U+E4A8). Viritura extension —
/// not in the MNX spec; orient is allowed for parity with other markings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct StaccatissimoWedge {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Spiccato marking (staccatissimo stroke, SMuFL U+E4AA).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Spiccato {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Tenuto marking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Tenuto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Accent marking (MNX `accent`).
///
/// Per MNX v15 spec the accent has only `orient` — no `pointing` field.
/// Ref: https://w3c-cg.github.io/mnx/docs/mnx-reference/objects/accent/
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Accent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Strong accent (marcato) marking (MNX `strong-accent`).
///
/// `orient` controls vertical placement; `pointing` (up/down/auto) controls
/// the direction the marcato wedge points.
/// Ref: https://w3c-cg.github.io/mnx/docs/mnx-reference/objects/strong-accent/
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct StrongAccent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pointing: Option<UpDownAuto>,
}

/// Soft accent (Bartók accent) marking — a hairpin-like wedge (<>).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SoftAccent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Stress marking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Stress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Unstress marking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Unstress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Bow direction marking (MNX `bow-direction`). Required `direction` (up = upbow,
/// down = downbow); optional `orient` for above/below placement.
/// Ref: https://w3c-cg.github.io/mnx/docs/mnx-reference/objects/bow-direction/
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BowDirection {
    pub direction: UpDown,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Fermata visual symbol (MNX `fermata-symbol`) — leaf enum aliased from codegen.
pub use crate::raw::FermataSymbol;

/// Fermata pause duration (MNX `fermata-duration`) — leaf enum aliased from codegen.
pub use crate::raw::FermataDuration;

/// Symbol orientation (MNX `orientation` — above/below/auto).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Orientation {
    #[serde(rename = "above")]
    Above,
    #[serde(rename = "below")]
    Below,
    #[serde(rename = "auto")]
    Auto,
}

impl Orientation {
    /// Map an explicit orientation to a forced stem direction.
    /// `Above` → `Some(true)` (stems up), `Below` → `Some(false)` (stems down),
    /// `Auto` → `None` (defer to default placement rules).
    pub fn force_stem_up(self) -> Option<bool> {
        match self {
            Orientation::Above => Some(true),
            Orientation::Below => Some(false),
            Orientation::Auto => None,
        }
    }
}

/// Up/down/auto direction (MNX `up-down-auto`) — leaf enum aliased from codegen.
pub use crate::raw::UpDownAuto;

/// Up/down direction (MNX `up-down`) — leaf enum aliased from codegen.
pub use crate::raw::UpDown;

/// Fermata marking on a note or rest (MNX `fermata` object).
///
/// All fields are optional. The MNX spec defaults are:
/// `symbol = Normal`, `duration = Auto`, `orient = Auto`, `pointing = Auto`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Fermata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<FermataSymbol>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<FermataDuration>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pointing: Option<UpDownAuto>,
}

/// Trill ornament marking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Trill {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accidental: Option<i32>,
}

/// Ornament type variants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrnamentType {
    #[serde(rename = "turn")]
    Turn,
    #[serde(rename = "invertedTurn")]
    InvertedTurn,
    #[serde(rename = "mordent")]
    Mordent,
    #[serde(rename = "invertedMordent")]
    InvertedMordent,
    #[serde(rename = "shortTrill")]
    ShortTrill,
    #[serde(rename = "trillMordent")]
    TrillMordent,
    #[serde(rename = "delayedTurn")]
    DelayedTurn,
    #[serde(rename = "schleifer")]
    Schleifer,
}

/// Single-note tremolo marking (1–3 slashes on the stem).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tremolo {
    /// Number of tremolo slashes (1, 2, or 3).
    pub marks: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Arpeggio direction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ArpeggioDirection {
    #[serde(rename = "up")]
    Up,
    #[serde(rename = "down")]
    Down,
    #[serde(rename = "auto")]
    Auto,
}

/// Arpeggio marking on a chord (wavy vertical line to the left).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Arpeggio {
    /// Direction: "up" (default, low to high) or "down" (high to low).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<ArpeggioDirection>,
}

/// Breath mark symbol type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BreathMarkSymbol {
    #[serde(rename = "comma")]
    Comma,
    #[serde(rename = "tick")]
    Tick,
    #[serde(rename = "upbow")]
    Upbow,
    #[serde(rename = "salzedo")]
    Salzedo,
    #[serde(rename = "auto")]
    Auto,
}

/// Breath mark — indicates a breathing point between notes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BreathMark {
    /// Symbol style. Omitted and `auto` leave the choice to the engraver.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<BreathMarkSymbol>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

/// Fingering annotation — a digit (0–5) placed near a notehead.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Fingering {
    /// Finger number: 0 (thumb in some traditions), 1–5.
    pub finger: u32,
}

/// Event markings — articulations and other note-level annotations.
///
/// Standard MNX markings (staccato, accent, etc.) live at the top level.
/// Viritura extensions (staccatissimo wedge, trill, ornaments, arpeggio,
/// fingerings) are read from `_x.viritura` in the MNX JSON.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(into = "MarkingsRaw")]
pub struct Markings {
    pub staccato: Option<Staccato>,
    pub accent: Option<Accent>,
    pub tenuto: Option<Tenuto>,
    pub strong_accent: Option<StrongAccent>,
    pub tremolo: Option<Tremolo>,
    pub staccatissimo: Option<Staccatissimo>,
    pub staccatissimo_wedge: Option<StaccatissimoWedge>,
    pub spiccato: Option<Spiccato>,
    pub soft_accent: Option<SoftAccent>,
    pub stress: Option<Stress>,
    pub unstress: Option<Unstress>,
    pub breath: Option<BreathMark>,
    /// Bow direction marking (MNX `bowDirection`).
    pub bow_direction: Option<BowDirection>,
    pub trill: Option<Trill>,
    pub ornaments: Option<Vec<OrnamentType>>,
    pub arpeggio: Option<Arpeggio>,
    /// Caesura (break) marking (Viritura extension).
    pub caesura: Option<Caesura>,
    /// Fingering annotations (digits placed near noteheads).
    pub fingerings: Option<Vec<Fingering>>,
}

// ── Serde helpers: map _x.viritura ↔ flat Markings fields ──

/// Raw JSON shape for EventMarkings (standard fields + `_x.viritura` nesting).
#[derive(Serialize, Deserialize)]
struct MarkingsRaw {
    #[serde(skip_serializing_if = "Option::is_none")]
    staccato: Option<Staccato>,
    #[serde(skip_serializing_if = "Option::is_none")]
    accent: Option<Accent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tenuto: Option<Tenuto>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "strongAccent")]
    strong_accent: Option<StrongAccent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tremolo: Option<Tremolo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    staccatissimo: Option<Staccatissimo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    spiccato: Option<Spiccato>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "softAccent")]
    soft_accent: Option<SoftAccent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stress: Option<Stress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unstress: Option<Unstress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    breath: Option<BreathMark>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "bowDirection")]
    bow_direction: Option<BowDirection>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "_x")]
    vendor_ext: Option<MarkingsVendorExt>,
}

#[derive(Serialize, Deserialize)]
struct MarkingsVendorExt {
    #[serde(skip_serializing_if = "Option::is_none")]
    viritura: Option<MarkingsVirituraExt>,
}

#[derive(Serialize, Deserialize)]
struct MarkingsVirituraExt {
    #[serde(skip_serializing_if = "Option::is_none", rename = "staccatissimoWedge")]
    staccatissimo_wedge: Option<StaccatissimoWedge>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trill: Option<Trill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ornaments: Option<Vec<OrnamentType>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    arpeggio: Option<Arpeggio>,
    #[serde(skip_serializing_if = "Option::is_none")]
    caesura: Option<Caesura>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fingerings: Option<Vec<Fingering>>,
}

impl From<MarkingsRaw> for Markings {
    fn from(raw: MarkingsRaw) -> Self {
        let (staccatissimo_wedge, trill, ornaments, arpeggio, caesura, fingerings) = raw
            .vendor_ext
            .and_then(|v| v.viritura)
            .map(|h| {
                (
                    h.staccatissimo_wedge,
                    h.trill,
                    h.ornaments,
                    h.arpeggio,
                    h.caesura,
                    h.fingerings,
                )
            })
            .unwrap_or_default();
        Markings {
            staccato: raw.staccato,
            accent: raw.accent,
            tenuto: raw.tenuto,
            strong_accent: raw.strong_accent,
            tremolo: raw.tremolo,
            staccatissimo: raw.staccatissimo,
            staccatissimo_wedge,
            spiccato: raw.spiccato,
            soft_accent: raw.soft_accent,
            stress: raw.stress,
            unstress: raw.unstress,
            breath: raw.breath,
            bow_direction: raw.bow_direction,
            trill,
            ornaments,
            arpeggio,
            caesura,
            fingerings,
        }
    }
}

impl From<Markings> for MarkingsRaw {
    fn from(m: Markings) -> Self {
        let has_ext = m.trill.is_some()
            || m.staccatissimo_wedge.is_some()
            || m.ornaments.is_some()
            || m.arpeggio.is_some()
            || m.caesura.is_some()
            || m.fingerings.is_some();
        MarkingsRaw {
            staccato: m.staccato,
            accent: m.accent,
            tenuto: m.tenuto,
            strong_accent: m.strong_accent,
            tremolo: m.tremolo,
            staccatissimo: m.staccatissimo,
            spiccato: m.spiccato,
            soft_accent: m.soft_accent,
            stress: m.stress,
            unstress: m.unstress,
            breath: m.breath,
            bow_direction: m.bow_direction,
            vendor_ext: if has_ext {
                Some(MarkingsVendorExt {
                    viritura: Some(MarkingsVirituraExt {
                        staccatissimo_wedge: m.staccatissimo_wedge,
                        trill: m.trill,
                        ornaments: m.ornaments,
                        arpeggio: m.arpeggio,
                        caesura: m.caesura,
                        fingerings: m.fingerings,
                    }),
                })
            } else {
                None
            },
        }
    }
}

/// MNX "space" element — a rhythmic gap that advances time without rendering.
///
/// In MNX, `{"type": "space", "duration": [1, 4]}` represents a quarter-note
/// duration of silence. Unlike rests, spaces are invisible and only advance
/// the beat cursor. Common in secondary voices that don't start on beat 1.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Space {
    /// Duration as a fraction `[numerator, denominator]`.
    pub duration: (u32, u32),
}

impl Space {
    /// Total duration in beats (quarter-note = 1.0).
    pub fn total_beats(&self) -> f64 {
        let (num, den) = self.duration;
        if den == 0 {
            return 0.0;
        }
        // A whole note = 4 beats, so fraction × 4
        (num as f64 / den as f64) * 4.0
    }
}

/// Syllable type for a lyric (MNX `event-lyric-line-type`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LyricLineType {
    /// First syllable of a multi-syllable word
    #[serde(rename = "start")]
    Start,
    /// Middle syllable of a multi-syllable word
    #[serde(rename = "middle")]
    Middle,
    /// Last syllable of a multi-syllable word
    #[serde(rename = "end")]
    End,
    /// Complete single-syllable word
    #[serde(rename = "whole")]
    Whole,
}

/// A single lyric line entry on an event (MNX `event-lyric-line`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LyricLine {
    /// The syllable text
    pub text: String,
    /// Syllable type indicating word continuation
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub syllable_type: Option<LyricLineType>,
}

/// Lyrics attached to an event (MNX `lyrics`).
/// The `lines` map keys are lyric line IDs (e.g., "1", "2" for verse numbers).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Lyrics {
    /// Map of lyric line ID → lyric line entry
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<HashMap<String, LyricLine>>,
}

/// Slur line type (MNX `lineType`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SlurLineType {
    #[serde(rename = "solid")]
    Solid,
    #[serde(rename = "dashed")]
    Dashed,
    #[serde(rename = "dotted")]
    Dotted,
}

/// Slur reference.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Slur {
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sideEnd")]
    pub side_end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "lineType")]
    pub line_type: Option<SlurLineType>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "startNote")]
    pub start_note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "endNote")]
    pub end_note: Option<String>,
    /// Engrave-mode shape overrides. Read from `_x.viritura.shape` on input;
    /// re-emitted by serializers in the format package. Not part of the MNX
    /// spec — see `docs/spec/viritura-extensions.md`.
    #[serde(skip_serializing, skip_deserializing)]
    pub shape: Option<SlurShape>,
}

/// Per-slur shape override stored in `_x.viritura.shape`.
///
/// Each field is a `[dx, dy]` delta in spatia (sp) applied on top of the
/// engine-computed bezier point. Used by engrave-mode handle drags so user
/// edits compose with automatic collision avoidance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlurShape {
    /// Start endpoint (p0) delta in sp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p0: Option<[f64; 2]>,
    /// First control point (p1) delta in sp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p1: Option<[f64; 2]>,
    /// Second control point (p2) delta in sp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p2: Option<[f64; 2]>,
    /// End endpoint (p3) delta in sp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p3: Option<[f64; 2]>,
}

// Slur: model-internal type. Construction goes through
// `promote::slur::promote_slur`. See `docs/spec/data-model-pipeline.md`.

/// MNX stem direction override on an event — leaf enum aliased from codegen.
pub use crate::raw::StemDirection;

/// Glissando line style.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GlissandoStyle {
    #[serde(rename = "straight")]
    Straight,
    #[serde(rename = "wavy")]
    Wavy,
}

/// Glissando line connecting two notes at different pitches.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Glissando {
    /// Target event ID
    pub target: String,
    /// Line style: straight or wavy
    #[serde(default = "default_glissando_style")]
    pub style: GlissandoStyle,
    /// Optional text label (e.g. "gliss.")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

fn default_glissando_style() -> GlissandoStyle {
    GlissandoStyle::Straight
}

// ═══════════════════════════════════════
// (Vendor extension deserialization helpers removed — Note/Event are
// model-internal types; construction goes through `promote::*`.
// See `docs/spec/data-model-pipeline.md`.)
// ═══════════════════════════════════════

// (KitNoteRaw / RawEvent removed — Event is model-internal; raw event
// JSON is consumed by `promote::event::*` against `crate::raw` types.)

/// An event — a note, chord, or rest at a specific rhythmic point.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Event {
    /// Duration
    pub duration: Duration,
    /// Unique ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Notes (if present and non-empty, this is a note/chord; otherwise rest)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<Vec<Note>>,
    /// Rest marker with optional staff position
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rest: Option<Rest>,
    /// Cross-staff override: render this event on the specified staff number
    /// (1-indexed) instead of the parent sequence's staff.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
    /// Slurs starting from this event
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slurs: Option<Vec<Slur>>,
    /// Glissando lines starting from this event
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glissandos: Option<Vec<Glissando>>,
    /// Articulation markings (staccato, accent, tenuto, marcato, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markings: Option<Markings>,
    /// Fermata (hold) marking — top-level per MNX v15 spec.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fermata: Option<Fermata>,
    /// Lyrics attached to this event
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lyrics: Option<Lyrics>,
    /// Explicit stem direction override (MNX stemDirection).
    #[serde(skip_serializing_if = "Option::is_none", rename = "stemDirection")]
    pub stem_direction: Option<StemDirection>,
    /// Vertical orientation override (MNX `orient`, above/below/auto).
    /// Forces stem direction: above → stems up, below → stems down.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
}

impl Event {
    /// Whether this event is a rest.
    pub fn is_rest(&self) -> bool {
        self.rest.is_some() || self.notes.as_ref().is_none_or(|n| n.is_empty())
    }

    /// Get the notes (empty slice if rest).
    pub fn notes(&self) -> &[Note] {
        self.notes.as_deref().unwrap_or(&[])
    }
}

/// Grace note type — how the grace notes affect timing.
/// Leaf enum aliased from codegen.
pub use crate::raw::GraceType;

/// A grace note container — one or more grace notes preceding a main note.
///
/// In MNX, `type: "grace"` in sequence content wraps inner events that are
/// rendered at reduced size before the next regular event.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Grace {
    /// The events within this grace note group
    pub content: Vec<Event>,
    /// How the grace notes affect timing
    #[serde(skip_serializing_if = "Option::is_none", rename = "graceType")]
    pub grace_type: Option<GraceType>,
    /// Whether to display a slash through the flag/beam (acciaccatura vs appoggiatura)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slash: Option<bool>,
    /// Optional rendering color (MNX `color`, e.g. "#ff0000").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// Duration specification for a tuplet (inner or outer).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TupletDuration {
    /// The base duration
    pub duration: Duration,
    /// Multiplier (number of notes)
    pub multiple: u32,
}

/// MNX `yes-no-auto` enum for tuplet bracket display.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TupletBracket {
    Yes,
    No,
    Auto,
}

/// MNX `tuplet-display-setting` enum for showNumber / showValue.
///
/// - `Inner` (default for showNumber): display inner multiple only (e.g. "3")
/// - `Both`: display ratio (e.g. "3:2")
/// - `NoNumber`: display nothing
///
/// Leaf enum aliased from codegen.
pub use crate::raw::TupletDisplaySetting;

/// A tuplet container — a group of events with modified duration.
///
/// In MNX, `inner` describes the actual content duration (e.g., 3 eighths)
/// and `outer` describes the notated space it occupies (e.g., 2 eighths).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Tuplet {
    /// Inner duration: what the content actually spans
    pub inner: TupletDuration,
    /// Outer duration: the notated duration the tuplet replaces
    pub outer: TupletDuration,
    /// The events (or nested tuplets) within this tuplet
    pub content: Vec<SequenceContent>,
    /// Whether to show the tuplet bracket (MNX `bracket`).
    /// Default: auto (show bracket unless all notes are beamed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bracket: Option<TupletBracket>,
    /// Which number(s) to display on the tuplet (MNX `showNumber`).
    /// Default: inner (show inner multiple, e.g. "3" for a 3:2 tuplet).
    #[serde(skip_serializing_if = "Option::is_none", rename = "showNumber")]
    pub show_number: Option<TupletDisplaySetting>,
    /// Which note value(s) to display on the tuplet (MNX `showValue`).
    /// Default: absent means no note values shown.
    #[serde(skip_serializing_if = "Option::is_none", rename = "showValue")]
    pub show_value: Option<TupletDisplaySetting>,
    /// Vertical orientation override (MNX `orient`, above/below/auto).
    /// Forces bracket placement and inner stem direction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
    /// Cross-staff tuplet staff number (MNX `staff`, 1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
}

/// Multi-note tremolo container — two notes with beam-like slashes between stems.
///
/// In MNX, `type: "tremolo"` wraps exactly two events that alternate rapidly.
/// The `marks` field indicates the number of slashes (1–3), and `outer`
/// specifies the total rhythmic duration the tremolo occupies.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MultiNoteTremolo {
    /// The two events in this tremolo
    pub content: Vec<Event>,
    /// Number of tremolo slashes (1, 2, or 3)
    pub marks: u32,
    /// Outer duration: the total notated duration the tremolo occupies
    pub outer: TupletDuration,
    /// Alternate duration for individual notes within the tremolo (MNX `individualDuration`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub individual_duration: Option<Duration>,
}

/// Visual duration for a full-measure rest (MNX fullMeasure).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FullMeasure {
    /// The visual duration to display (e.g., whole rest)
    #[serde(rename = "visualDuration")]
    pub visual_duration: Duration,
    /// Explicit staff position override (MNX staffPosition).
    /// 0 = middle line, positive = up, negative = down.
    #[serde(skip_serializing_if = "Option::is_none", rename = "staffPosition")]
    pub staff_position: Option<i32>,
}

/// A sequence (voice) within a measure.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Sequence {
    pub content: Vec<SequenceContent>,
    /// Full-measure rest indicator (MNX fullMeasure).
    #[serde(skip_serializing_if = "Option::is_none", rename = "fullMeasure")]
    pub full_measure: Option<FullMeasure>,
    /// Staff number for this sequence (1-indexed; used in grand staff / organ parts).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
    /// Voice name for this sequence (MNX voice identifier).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice: Option<String>,
    /// Vertical orientation override for the whole sequence (MNX `orient`,
    /// above/below/auto). Forces stem direction for all events in this sequence.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<Orientation>,
    /// Forced stem direction from layout source (internal, not serialized from MNX).
    #[serde(skip)]
    pub forced_stem_up: Option<bool>,
    /// Source part index for condensing (internal, not serialized).
    /// Set when this sequence originates from a specific source part on a condensed staff.
    #[serde(skip)]
    pub source_part_index: Option<usize>,
    /// Original sequence index within the source part measure (internal, not serialized).
    /// Used to generate correct element IDs for condensed staves.
    #[serde(skip)]
    pub source_seq_index: Option<usize>,
}

/// Content items in a sequence.
/// Discriminated by `type` field: `"tuplet"` for tuplets, `"tremolo"` for multi-note tremolos,
/// `"grace"` for grace notes, `"space"` for rhythmic gaps, absent for events.
/// Unknown types are captured as `Other` and skipped.
///
/// IMPORTANT: Variant order matters for `#[serde(untagged)]` — serde tries each in order.
/// MultiNoteTremolo must come before Grace because both have `content: Vec<Event>` and Grace
/// would match tremolo JSON (extra fields silently ignored). MultiNoteTremolo's required `marks`
/// field prevents Grace JSON from matching it.
/// Space must come before Event because Space has `duration: (u32,u32)` (JSON array) while
/// Event has `duration: Duration` (JSON object) — Event deserialization would fail on a Space,
/// but ordering Space first prevents unnecessary backtracking.
#[derive(Debug, Clone, PartialEq)]
// `Event` is the dominant, hot variant matched on every sequence walk; boxing
// it to shrink the others would pessimize the common path for no real benefit.
#[allow(clippy::large_enum_variant)]
pub enum SequenceContent {
    Tuplet(Tuplet),
    MultiNoteTremolo(MultiNoteTremolo),
    Grace(Grace),
    Space(Space),
    Event(Event),
    Other(serde_json::Value),
}

// Custom Serialize: each non-event variant emits its MNX `type` discriminator
// (`tuplet`, `tremolo`, `grace`, `space`). Events emit bare (no type field) to
// match the MNX spec — `promote_sequence_content_item` dispatches on the
// presence/value of `type`.
impl Serialize for SequenceContent {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        fn tagged<S, T>(s: S, tag: &str, value: &T) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
            T: Serialize,
        {
            let v = serde_json::to_value(value).map_err(serde::ser::Error::custom)?;
            let mut obj = match v {
                serde_json::Value::Object(m) => m,
                _ => return Err(serde::ser::Error::custom("expected object")),
            };
            obj.insert("type".into(), serde_json::Value::String(tag.into()));
            serde_json::Value::Object(obj).serialize(s)
        }
        match self {
            Self::Tuplet(t) => tagged(serializer, "tuplet", t),
            Self::MultiNoteTremolo(t) => tagged(serializer, "tremolo", t),
            Self::Grace(g) => tagged(serializer, "grace", g),
            Self::Space(sp) => tagged(serializer, "space", sp),
            Self::Event(e) => e.serialize(serializer),
            Self::Other(v) => v.serialize(serializer),
        }
    }
}

impl SequenceContent {
    /// Get as an event (if it is one).
    pub fn as_event(&self) -> Option<&Event> {
        match self {
            Self::Event(e) => Some(e),
            _ => None,
        }
    }

    /// Get as a tuplet (if it is one).
    pub fn as_tuplet(&self) -> Option<&Tuplet> {
        match self {
            Self::Tuplet(t) => Some(t),
            _ => None,
        }
    }

    /// Get as a grace note container (if it is one).
    pub fn as_grace(&self) -> Option<&Grace> {
        match self {
            Self::Grace(g) => Some(g),
            _ => None,
        }
    }

    /// Get as a multi-note tremolo container (if it is one).
    pub fn as_multi_note_tremolo(&self) -> Option<&MultiNoteTremolo> {
        match self {
            Self::MultiNoteTremolo(m) => Some(m),
            _ => None,
        }
    }
}

use super::clef::RhythmicPosition;
use super::duration::NoteValueBase;
use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════
// Jump / Marker types (MNX global measures)
// ═══════════════════════════════════════

/// A segno marker on a global measure (MNX `segno`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segno {
    pub location: RhythmicPosition,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyph: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// A fine marker on a global measure (MNX `fine`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Fine {
    pub location: RhythmicPosition,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// A jump direction on a global measure (MNX `jump`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Jump {
    #[serde(rename = "type")]
    pub jump_type: JumpType,
    pub location: RhythmicPosition,
}

/// A coda marker on a global measure (Viritura extension).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Coda {
    pub location: RhythmicPosition,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyph: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// Jump type enum.
///
/// This is a domain-level union of two wire enums:
/// - MNX spec `jump-type`: `Segno` (D.S.), `DsAlFine` (D.S. al Fine)
/// - Viritura vendor `jump-type` extension: `DsAlCoda` (D.S. al Coda),
///   `DcAlCoda` (D.C. al Coda)
///
/// Because the model collapses both wire enums into one rendering surface,
/// it cannot alias either raw enum directly. See `promote::direction` and
/// `promote::vendor_directions::promote_extended_jump`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JumpType {
    /// D.S. (dal segno) — go back to segno
    #[serde(rename = "segno")]
    Segno,
    /// D.S. al Fine — go back to segno, play until fine
    #[serde(rename = "dsalfine")]
    DsAlFine,
    /// D.S. al Coda — go back to segno, play until coda (Viritura extension)
    #[serde(rename = "dsalcoda")]
    DsAlCoda,
    /// D.C. al Coda — go back to beginning, play until coda (Viritura extension)
    #[serde(rename = "dcalcoda")]
    DcAlCoda,
}

/// A tempo marking at a rhythmic position (MNX `tempos[]` in global measures).
/// Viritura extension fields (`text`, `showMetronomeMark`, `showText`) live
/// under `_x.viritura` in MNX JSON but are flattened into this struct.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Tempo {
    /// Beats per minute
    pub bpm: f64,
    /// Note value that gets one beat (e.g. quarter, half)
    pub value: TempoNoteValue,
    /// Optional rhythmic position within the measure (defaults to start)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<RhythmicPosition>,
    /// Optional text label (e.g. "Allegro"). Viritura extension.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Whether to show the metronome mark (♩ = 120). Defaults to true. Viritura extension.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "showMetronomeMark"
    )]
    pub show_metronome_mark: Option<bool>,
    /// Whether to show the text label. Defaults to true. Viritura extension.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "showText")]
    pub show_text: Option<bool>,
    /// Manual [dx, dy] offset in spatia (sp); +x right, +y up. Viritura extension.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_offset: Option<[f64; 2]>,
    /// Whether collision avoidance may re-flow this marking (unset/true = on).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avoid_collisions: Option<bool>,
}

// Tempo: model-internal type. Construction goes through
// `promote::direction::promote_tempo`. See `docs/spec/data-model-pipeline.md`.

/// Note value for tempo markings (MNX `note-value` with `base` and optional `dots`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TempoNoteValue {
    pub base: NoteValueBase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dots: Option<u32>,
}

/// Standard MNX dynamic-group discriminator.
pub use crate::raw::DynamicGroupType;
/// Structural prefix letter of an accent dynamic (`s`, `r`, or none).
pub use crate::raw::DynamicPrefix;
/// Structural suffix letter of an accent dynamic (`z` or none).
pub use crate::raw::DynamicSuffix;
/// Standard absolute dynamic values.
pub use crate::raw::DynamicValue;
/// Multi-staff dynamic orientation.
pub use crate::raw::MultiStaffOrientation;
/// Standard relative dynamic direction.
pub use crate::raw::RelativeDynamicValue;
/// Standard gradual wedge direction.
pub use crate::raw::WedgeType;

/// A standard dynamic group in a part measure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DynamicGroup {
    /// Stable UUID-v7 identity.
    pub id: String,
    /// Immediate, gradual, relative, or accent.
    #[serde(rename = "type")]
    pub group_type: DynamicGroupType,
    pub position: RhythmicPosition,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<DynamicValue>,
    /// Accent-only: the level that persists after the initial attack, as in `fp`
    /// ("attack at f, immediately drop to p").
    #[serde(skip_serializing_if = "Option::is_none", rename = "residualValue")]
    pub residual_value: Option<DynamicValue>,
    /// Accent-only structural prefix letter. Absent means the `s` of `sfz`.
    #[serde(skip_serializing_if = "Option::is_none", rename = "accentPrefix")]
    pub accent_prefix: Option<DynamicPrefix>,
    /// Accent-only structural suffix letter. Absent means the `z` of `sfz`.
    #[serde(skip_serializing_if = "Option::is_none", rename = "accentSuffix")]
    pub accent_suffix: Option<DynamicSuffix>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<MeasureRhythmicPosition>,
    /// Ordered SMuFL glyph-name overrides.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyphs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<MultiStaffOrientation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "relativeValue")]
    pub relative_value: Option<RelativeDynamicValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
    /// Gradual-only: staff on which a diagonal cross-staff hairpin ends.
    #[serde(skip_serializing_if = "Option::is_none", rename = "staffEnd")]
    pub staff_end: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    /// Id of the immediately preceding group this one continues visually, so the
    /// pair engraves at a single shared vertical position.
    #[serde(skip_serializing_if = "Option::is_none", rename = "visuallyContinues")]
    pub visually_continues: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "wedgeType")]
    pub wedge_type: Option<WedgeType>,
    /// Internal placement hint set by the condensing layer when a dynamic belongs
    /// to a stem-up source (Some(true) → above staff) or stem-down source
    /// (Some(false) → below staff). Not part of the MNX spec — `#[serde(skip)]`
    /// so it never round-trips through serialization.
    #[serde(skip)]
    pub placement_above: Option<bool>,
    /// Source part index for selectable condensed directions (internal only).
    #[serde(skip)]
    pub source_part_index: Option<usize>,
    /// Manual [dx, dy] offset in spatia (sp); +x right, +y up. Viritura extension.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_offset: Option<[f64; 2]>,
    /// Whether collision avoidance may re-flow this group (unset/true = on).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avoid_collisions: Option<bool>,
}

impl DynamicGroup {
    /// Written spelling of an accent dynamic, assembled from its structural
    /// parts. MNX encodes `sfz` as `{type: accent, value: f}` with the prefix
    /// and suffix defaulting to `s` and `z`; `fp` adds `residualValue: p` and
    /// clears both affixes.
    fn accent_spelling(&self) -> String {
        let prefix = self.accent_prefix.unwrap_or(DynamicPrefix::S);
        let suffix = self.accent_suffix.unwrap_or(DynamicSuffix::Z);
        let mut out = prefix.to_string();
        if let Some(value) = self.value {
            out.push_str(&value.to_string());
        }
        if let Some(residual) = self.residual_value {
            out.push_str(&residual.to_string());
        }
        out.push_str(&suffix.to_string());
        out
    }

    /// Value used by the default glyph renderer when no explicit glyph list exists.
    pub fn display_value(&self) -> String {
        if self.group_type == DynamicGroupType::Accent {
            return self.accent_spelling();
        }
        if let Some(value) = self.value {
            return value.to_string();
        }
        match self.relative_value {
            Some(RelativeDynamicValue::Louder) => "f".to_owned(),
            Some(RelativeDynamicValue::Softer) => "p".to_owned(),
            None => String::new(),
        }
    }

    pub fn is_gradual(&self) -> bool {
        self.group_type == DynamicGroupType::Gradual
    }

    /// Resolve the requested vertical side. `between` is engraved below its
    /// upper anchor staff; `auto` falls back to the condensing placement hint.
    pub fn places_above(&self) -> bool {
        match self.orient {
            Some(MultiStaffOrientation::Above) => true,
            Some(MultiStaffOrientation::Below | MultiStaffOrientation::Between) => false,
            Some(MultiStaffOrientation::Auto) | None => self.placement_above == Some(true),
        }
    }

    /// Compare authored semantics while ignoring stable identity and derived placement hints.
    pub fn same_semantics(&self, other: &Self) -> bool {
        self.group_type == other.group_type
            && self.position == other.position
            && self.value == other.value
            && self.residual_value == other.residual_value
            && self.accent_prefix == other.accent_prefix
            && self.accent_suffix == other.accent_suffix
            && self.end == other.end
            && self.glyphs == other.glyphs
            && self.orient == other.orient
            && self.prefix == other.prefix
            && self.relative_value == other.relative_value
            && self.staff == other.staff
            && self.staff_end == other.staff_end
            && self.suffix == other.suffix
            // Link targets are source-local group IDs. Condensing compares
            // equivalent chain topology, not UUID identity across parts.
            && self.visually_continues.is_some() == other.visually_continues.is_some()
            && self.voice == other.voice
            && self.wedge_type == other.wedge_type
            && self.manual_offset == other.manual_offset
            && self.avoid_collisions == other.avoid_collisions
    }
}

/// A rhythmic position referencing a specific measure (MNX `measure-rhythmic-position`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeasureRhythmicPosition {
    /// Measure ID reference
    pub measure: String,
    /// Rhythmic position within that measure
    pub position: RhythmicPosition,
}

/// An ottava marking (8va, 15ma, etc.) spanning from a position to an end position
/// possibly in a different measure (MNX `ottavas[]` in part measures).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Ottava {
    /// Start rhythmic position within the measure
    pub position: RhythmicPosition,
    /// End position (may reference a different measure)
    pub end: MeasureRhythmicPosition,
    /// Ottava amount: 1 = 8va, 2 = 15ma, -1 = 8vb, etc.
    pub value: i32,
    /// Optional staff number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
    /// Optional voice name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice: Option<String>,
    /// Vertical orientation override (MNX `orient`, above/below/auto).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orient: Option<crate::model::Orientation>,
}

/// Caesura style variants — aliased to the Viritura vendor `caesura-style` schema.
pub use crate::raw_viritura::CaesuraStyle;

/// A caesura (break) on a global measure (Viritura extension).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Caesura {
    /// Style variant (default: Normal).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<CaesuraStyle>,
}

/// Piano pedal type — aliased to the Viritura vendor `pedal-type` schema.
pub use crate::raw_viritura::PedalType;

/// Piano pedal line style — aliased to the Viritura vendor `pedal-line-style` schema.
pub use crate::raw_viritura::PedalLineStyle;

/// A piano pedal marking spanning from a rhythmic position to an end position
/// possibly in a different measure (Viritura extension `pedals[]` in part measures).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Pedal {
    /// Pedal type (sustain, sostenuto, una corda)
    #[serde(rename = "type")]
    pub pedal_type: PedalType,
    /// Start rhythmic position within the measure
    pub position: RhythmicPosition,
    /// End position (may reference a different measure)
    pub end: MeasureRhythmicPosition,
    /// Line style (text or bracket); defaults to text if absent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<PedalLineStyle>,
    /// Optional staff number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
    /// Optional voice name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice: Option<String>,
}

/// Placement of a text expression (above or below the staff) — aliased to
/// the Viritura vendor `expression-placement` schema.
pub use crate::raw_viritura::ExpressionPlacement;

/// A text expression or direction at a rhythmic position (e.g. "dolce", "rit.", "a tempo").
/// These are Italian or other language performance directions typically rendered in italic.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextExpression {
    /// The expression text (e.g. "dolce", "espressivo", "rit.", "a tempo")
    pub text: String,
    /// Rhythmic position within the measure
    pub position: RhythmicPosition,
    /// Placement above or below the staff (default: below)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placement: Option<ExpressionPlacement>,
    /// Optional staff number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
    /// Optional voice name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice: Option<String>,
    /// Source identity for selectable condensed expressions (internal only).
    #[serde(skip)]
    pub source_part_index: Option<usize>,
    #[serde(skip)]
    pub source_expression_index: Option<usize>,
    /// Manual [dx, dy] offset in spatia (sp), applied after automatic placement.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_offset: Option<[f64; 2]>,
    /// Whether automatic collision avoidance may re-flow this expression
    /// outward. Unset/true = re-flow (default); false = pinned (stays where
    /// placed, others flow around it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avoid_collisions: Option<bool>,
}

/// Rehearsal mark display style — aliased to the Viritura vendor
/// `rehearsal-mark-style` schema.
pub use crate::raw_viritura::RehearsalMarkStyle;

/// A rehearsal mark on a global measure (Viritura extension).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RehearsalMark {
    /// The text label (e.g. "A", "B", "1")
    pub text: String,
    /// Style: boxed (default), circled, or plain
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<RehearsalMarkStyle>,
    /// Manual [dx, dy] offset in spatia (sp); +x right, +y up. Viritura extension.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_offset: Option<[f64; 2]>,
    /// Whether collision avoidance may re-flow this mark (unset/true = on).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avoid_collisions: Option<bool>,
}

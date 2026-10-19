//! Promote MNX core `direction` objects — segno, fine, jump, tempo,
//! dynamic-group, ottava.
//!
//! Vendor-extension-only direction types (caesura, coda, pedal,
//! text-expression, rehearsal-mark) live in [`super::vendor_directions`].

use crate::model::clef::RhythmicPosition;
use crate::model::direction::{
    Coda, DynamicGroup, DynamicGroupType, Fine, Jump, JumpType, MeasureRhythmicPosition, Ottava,
    Segno, Tempo, TempoNoteValue,
};
use crate::model::event::Placement;
use crate::promote::clef::promote_rhythmic_position;
use crate::promote::duration::promote_note_value_base;
use crate::promote::vendor_ext::read_viritura_ext;
use crate::promote::PromoteError;
use crate::raw;

pub(crate) fn promote_segno(raw: raw::Segno) -> Segno {
    Segno {
        location: promote_rhythmic_position(raw.location),
        glyph: raw.glyph.map(|g| g.0),
        color: raw.color.map(|c| c.0),
    }
}

pub(crate) fn promote_fine(raw: raw::Fine) -> Fine {
    Fine {
        location: promote_rhythmic_position(raw.location),
        color: raw.color.map(|c| c.0),
    }
}

pub(crate) fn promote_coda(raw: raw::Coda) -> Coda {
    Coda {
        location: promote_rhythmic_position(raw.location),
        glyph: raw.glyph.map(|glyph| glyph.0),
        color: raw.color.map(|color| color.0),
    }
}

pub(crate) fn promote_jump(raw: raw::Jump) -> Jump {
    Jump {
        jump_type: promote_jump_type(raw.type_),
        location: promote_rhythmic_position(raw.location),
    }
}

pub(crate) fn promote_jump_type(raw: raw::JumpType) -> JumpType {
    match raw {
        raw::JumpType::Dc => JumpType::Dc,
        raw::JumpType::DcAlCoda => JumpType::DcAlCoda,
        raw::JumpType::DcAlFine => JumpType::DcAlFine,
        raw::JumpType::DsAlCoda => JumpType::DsAlCoda,
        raw::JumpType::DsAlFine => JumpType::DsAlFine,
        raw::JumpType::Segno => JumpType::Segno,
        raw::JumpType::ToCoda => JumpType::ToCoda,
    }
}

/// Read `_x.viritura.manualOffset` ([dx, dy] numbers) from an ext map.
fn read_manual_offset(
    ext: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<[f64; 2]> {
    let arr = ext
        .and_then(|v| v.get("manualOffset"))
        .and_then(|v| v.as_array())?;
    if arr.len() != 2 {
        return None;
    }
    Some([arr[0].as_f64()?, arr[1].as_f64()?])
}

/// Read `_x.viritura.avoidCollisions` (bool) from an ext map.
fn read_avoid_collisions(ext: Option<&serde_json::Map<String, serde_json::Value>>) -> Option<bool> {
    ext.and_then(|v| v.get("avoidCollisions"))
        .and_then(|v| v.as_bool())
}

pub(crate) fn promote_tempo(raw: raw::Tempo) -> Result<Tempo, PromoteError> {
    // Hoist Viritura tempo extensions (text, showMetronomeMark, showText).
    let ext = read_viritura_ext(raw.x.as_ref());
    let text = ext
        .and_then(|v| v.get("text"))
        .map(|value| {
            serde_json::from_value(value.clone())
                .map_err(|error| PromoteError::UnsupportedTextContent(error.to_string()))
        })
        .transpose()?;
    let show_metronome_mark = ext
        .and_then(|v| v.get("showMetronomeMark"))
        .and_then(|v| v.as_bool());
    let show_text = ext
        .and_then(|v| v.get("showText"))
        .and_then(|v| v.as_bool());
    Ok(Tempo {
        bpm: raw.bpm.0,
        value: TempoNoteValue {
            base: promote_note_value_base(raw.value.base)?,
            dots: raw.value.dots.map(|d| u32::try_from(d.0).unwrap_or(0)),
        },
        location: raw.location.map(promote_rhythmic_position),
        text,
        show_metronome_mark,
        show_text,
        manual_offset: read_manual_offset(ext),
        avoid_collisions: read_avoid_collisions(ext),
    })
}

struct DynamicGroupCommon {
    id: String,
    position: RhythmicPosition,
    glyphs: Vec<String>,
    placement: Option<raw::MultiStaffPlacement>,
    prefix: Option<String>,
    staff: Option<u32>,
    suffix: Option<String>,
    visually_continues: Option<String>,
    voice: Option<String>,
    manual_offset: Option<[f64; 2]>,
    avoid_collisions: Option<bool>,
}

#[derive(Default)]
struct DynamicGroupDetails {
    value: Option<raw::DynamicValue>,
    residual_value: Option<raw::DynamicValue>,
    accent_prefix: Option<raw::DynamicPrefix>,
    accent_suffix: Option<raw::DynamicSuffix>,
    end: Option<MeasureRhythmicPosition>,
    relative_value: Option<raw::RelativeDynamicValue>,
    staff_end: Option<u32>,
    wedge_type: Option<raw::WedgeType>,
}

fn promote_dynamic_group_common(
    id: Option<raw::Id>,
    position: raw::RhythmicPosition,
    glyphs: Vec<raw::SmuflGlyph>,
    placement: Option<raw::MultiStaffPlacement>,
    prefix: Option<raw::String>,
    staff: Option<raw::StaffNumber>,
    suffix: Option<raw::String>,
    visually_continues: Option<raw::Id>,
    voice: Option<raw::VoiceName>,
    x: Option<raw::VendorExtensions>,
) -> DynamicGroupCommon {
    let ext = read_viritura_ext(x.as_ref());
    let dynamic_ext: Option<crate::raw_viritura::DynamicGroupExtensions> =
        ext.and_then(|value| serde_json::from_value(serde_json::Value::Object(value.clone())).ok());
    DynamicGroupCommon {
        id: id
            .map(|value| value.to_string())
            .unwrap_or_else(|| uuid::Uuid::now_v7().to_string()),
        position: promote_rhythmic_position(position),
        glyphs: glyphs.into_iter().map(|glyph| glyph.0).collect(),
        placement,
        prefix: prefix.map(|value| value.0),
        staff: staff.map(|value| u32::try_from(value.0).unwrap_or(1)),
        suffix: suffix.map(|value| value.0),
        visually_continues: visually_continues.map(String::from),
        voice: voice.map(|value| value.0),
        manual_offset: dynamic_ext
            .as_ref()
            .and_then(|value| value.manual_offset.as_ref().map(|d| d.0)),
        avoid_collisions: dynamic_ext.and_then(|value| value.avoid_collisions),
    }
}

fn build_dynamic_group(
    common: DynamicGroupCommon,
    group_type: DynamicGroupType,
    details: DynamicGroupDetails,
) -> DynamicGroup {
    DynamicGroup {
        id: common.id,
        group_type,
        position: common.position,
        value: details.value,
        residual_value: details.residual_value,
        accent_prefix: details.accent_prefix,
        accent_suffix: details.accent_suffix,
        end: details.end,
        glyphs: (!common.glyphs.is_empty()).then_some(common.glyphs),
        placement: common.placement,
        prefix: common.prefix,
        relative_value: details.relative_value,
        staff: common.staff,
        staff_end: details.staff_end,
        suffix: common.suffix,
        visually_continues: common.visually_continues,
        voice: common.voice,
        wedge_type: details.wedge_type,
        placement_above: None,
        source_part_index: None,
        manual_offset: common.manual_offset,
        avoid_collisions: common.avoid_collisions,
    }
}

pub(crate) fn promote_dynamic_group(
    raw: raw::DynamicGroupsItem,
) -> Result<DynamicGroup, PromoteError> {
    let (common, group_type, details) = match raw {
        raw::DynamicGroupsItem::Immediate(value) => (
            promote_dynamic_group_common(
                value.id,
                value.position,
                value.glyphs,
                value.placement,
                value.prefix,
                value.staff,
                value.suffix,
                value.visually_continues,
                value.voice,
                value.x,
            ),
            DynamicGroupType::Immediate,
            DynamicGroupDetails {
                value: Some(value.value),
                ..Default::default()
            },
        ),
        raw::DynamicGroupsItem::Gradual(value) => (
            promote_dynamic_group_common(
                value.id,
                value.position,
                value.glyphs,
                value.placement,
                value.prefix,
                value.staff,
                value.suffix,
                value.visually_continues,
                value.voice,
                value.x,
            ),
            DynamicGroupType::Gradual,
            DynamicGroupDetails {
                value: value.value,
                end: Some(promote_measure_rhythmic_position(value.end)),
                staff_end: value
                    .staff_end
                    .map(|staff| u32::try_from(staff.0).unwrap_or(1)),
                wedge_type: Some(value.wedge_type),
                ..Default::default()
            },
        ),
        raw::DynamicGroupsItem::Relative(value) => (
            promote_dynamic_group_common(
                value.id,
                value.position,
                value.glyphs,
                value.placement,
                value.prefix,
                value.staff,
                value.suffix,
                value.visually_continues,
                value.voice,
                value.x,
            ),
            DynamicGroupType::Relative,
            DynamicGroupDetails {
                value: value.value,
                relative_value: Some(value.relative_value),
                ..Default::default()
            },
        ),
        raw::DynamicGroupsItem::Accent(value) => (
            promote_dynamic_group_common(
                value.id,
                value.position,
                value.glyphs,
                value.placement,
                value.prefix,
                value.staff,
                value.suffix,
                value.visually_continues,
                value.voice,
                value.x,
            ),
            DynamicGroupType::Accent,
            DynamicGroupDetails {
                value: Some(value.value),
                residual_value: value.residual_value,
                accent_prefix: value.accent_prefix,
                accent_suffix: value.accent_suffix,
                ..Default::default()
            },
        ),
    };
    Ok(build_dynamic_group(common, group_type, details))
}

pub(crate) fn promote_measure_rhythmic_position(
    raw: raw::MeasureRhythmicPosition,
) -> MeasureRhythmicPosition {
    MeasureRhythmicPosition {
        measure: raw.measure.to_string(),
        position: promote_rhythmic_position(raw.position),
    }
}

pub(crate) fn promote_ottava(raw: raw::Ottava) -> Ottava {
    Ottava {
        position: promote_rhythmic_position(raw.position),
        end: promote_measure_rhythmic_position(raw.end),
        value: i32::try_from(*raw.value).unwrap_or(0),
        staff: raw.staff.map(|s| u32::try_from(s.0).unwrap_or(1)),
        voice: raw.voice.map(|v| v.0),
        placement: raw.placement.map(promote_placement),
    }
}

pub(crate) fn promote_placement(raw: raw::Placement) -> Placement {
    match raw {
        raw::Placement::Above => Placement::Above,
        raw::Placement::Below => Placement::Below,
        raw::Placement::Auto => Placement::Auto,
    }
}

#[allow(unused)]
fn _typecheck_rp(_: RhythmicPosition) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_segno_with_location() {
        let json = r#"{"location":{"fraction":[0,4]}}"#;
        let raw: raw::Segno = serde_json::from_str(json).unwrap();
        let direct: Segno = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_segno(raw));
    }

    #[test]
    fn promotes_jump_ds_al_fine() {
        let json = r#"{"type":"dsAlFine","location":{"fraction":[3,4]}}"#;
        let raw: raw::Jump = serde_json::from_str(json).unwrap();
        let direct: Jump = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_jump(raw));
    }

    #[test]
    fn promotes_tempo_with_vendor_text() {
        let json = r#"{
            "bpm":120,
            "value":{"base":"quarter"},
            "_x":{"viritura":{"text": [{"text": "Allegro"}],"showMetronomeMark":true}}
        }"#;
        let raw: raw::Tempo = serde_json::from_str(json).unwrap();
        let promoted = promote_tempo(raw).unwrap();
        assert_eq!(
            promoted.text.as_ref().map(|text| text.plain_text()),
            Some("Allegro".to_string())
        );
        assert_eq!(promoted.show_metronome_mark, Some(true));
    }

    #[test]
    fn promotes_dynamic_group() {
        let json = r#"{"id":"dyn1","type":"immediate","position":{"fraction":[0,4]},"value":"mf"}"#;
        let raw: raw::DynamicGroupsItem = serde_json::from_str(json).unwrap();
        let promoted = promote_dynamic_group(raw).unwrap();
        assert_eq!(promoted.id, "dyn1");
        assert_eq!(promoted.group_type, DynamicGroupType::Immediate);
        assert_eq!(promoted.value, Some(raw::DynamicValue::Mf));
    }

    #[test]
    fn promotes_relative_dynamic_with_optional_printed_value() {
        let json = r#"{
            "type":"relative",
            "position":{"fraction":[0,4]},
            "relativeValue":"louder",
            "value":"f"
        }"#;
        let raw: raw::DynamicGroupsItem = serde_json::from_str(json).unwrap();
        let promoted = promote_dynamic_group(raw).unwrap();
        assert_eq!(promoted.group_type, DynamicGroupType::Relative);
        assert_eq!(
            promoted.relative_value,
            Some(raw::RelativeDynamicValue::Louder)
        );
        assert_eq!(promoted.value, Some(raw::DynamicValue::F));
    }

    #[test]
    fn promotes_ottava() {
        let json = r#"{
            "position":{"fraction":[0,4]},
            "end":{"measure":"m2","position":{"fraction":[0,4]}},
            "value":1
        }"#;
        let raw: raw::Ottava = serde_json::from_str(json).unwrap();
        let direct: Ottava = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_ottava(raw));
    }
}

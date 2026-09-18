//! Promote MNX core `direction` objects — segno, fine, jump, tempo,
//! dynamic-group, ottava.
//!
//! Vendor-extension-only direction types (caesura, coda, pedal,
//! text-expression, rehearsal-mark) live in [`super::vendor_directions`].

use crate::model::clef::RhythmicPosition;
use crate::model::direction::{
    DynamicGroup, Fine, Jump, JumpType, MeasureRhythmicPosition, Ottava, Segno, Tempo,
    TempoNoteValue,
};
use crate::model::event::Orientation;
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

pub(crate) fn promote_jump(raw: raw::Jump) -> Jump {
    Jump {
        jump_type: promote_jump_type(raw.type_),
        location: promote_rhythmic_position(raw.location),
    }
}

pub(crate) fn promote_jump_type(raw: raw::JumpType) -> JumpType {
    match raw {
        raw::JumpType::Segno => JumpType::Segno,
        raw::JumpType::Dsalfine => JumpType::DsAlFine,
        // DsAlCoda / DcAlCoda exist on the model but aren't in MNX core's
        // jump-type enum (yet). They surface only via vendor-extension
        // jumps, not via this promote.
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
        .and_then(|v| v.as_str())
        .map(str::to_owned);
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

pub(crate) fn promote_dynamic_group(raw: raw::DynamicGroup) -> DynamicGroup {
    let ext = read_viritura_ext(raw.x.as_ref());
    let dynamic_ext: Option<crate::raw_viritura::DynamicGroupExtensions> =
        ext.and_then(|value| serde_json::from_value(serde_json::Value::Object(value.clone())).ok());
    let glyphs = raw
        .glyphs
        .into_iter()
        .map(|glyph| glyph.0)
        .collect::<Vec<_>>();
    DynamicGroup {
        id: raw
            .id
            .map(|id| id.to_string())
            .unwrap_or_else(|| uuid::Uuid::now_v7().to_string()),
        group_type: raw.type_,
        position: promote_rhythmic_position(raw.position),
        value: raw.value,
        residual_value: raw.residual_value,
        accent_prefix: raw.accent_prefix,
        accent_suffix: raw.accent_suffix,
        end: raw.end.map(promote_measure_rhythmic_position),
        glyphs: (!glyphs.is_empty()).then_some(glyphs),
        orient: raw.orient,
        prefix: raw.prefix.map(|value| value.0),
        relative_value: raw.relative_value,
        staff: raw.staff.map(|s| u32::try_from(s.0).unwrap_or(1)),
        staff_end: raw.staff_end.map(|s| u32::try_from(s.0).unwrap_or(1)),
        suffix: raw.suffix.map(|value| value.0),
        visually_continues: raw.visually_continues.map(|id| id.to_string()),
        voice: raw.voice.map(|v| v.0),
        wedge_type: raw.wedge_type,
        placement_above: None,
        source_part_index: None,
        manual_offset: dynamic_ext
            .as_ref()
            .and_then(|value| value.manual_offset.as_ref().map(|d| d.0)),
        avoid_collisions: dynamic_ext.and_then(|value| value.avoid_collisions),
    }
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
        orient: raw.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_orientation(raw: raw::Orientation) -> Orientation {
    match raw {
        raw::Orientation::Above => Orientation::Above,
        raw::Orientation::Below => Orientation::Below,
        raw::Orientation::Auto => Orientation::Auto,
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
    fn promotes_jump_dsalfine() {
        let json = r#"{"type":"dsalfine","location":{"fraction":[3,4]}}"#;
        let raw: raw::Jump = serde_json::from_str(json).unwrap();
        let direct: Jump = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_jump(raw));
    }

    #[test]
    fn promotes_tempo_with_vendor_text() {
        let json = r#"{
            "bpm":120,
            "value":{"base":"quarter"},
            "_x":{"viritura":{"text":"Allegro","showMetronomeMark":true}}
        }"#;
        let raw: raw::Tempo = serde_json::from_str(json).unwrap();
        let promoted = promote_tempo(raw).unwrap();
        assert_eq!(promoted.text.as_deref(), Some("Allegro"));
        assert_eq!(promoted.show_metronome_mark, Some(true));
    }

    #[test]
    fn promotes_dynamic_group() {
        let json = r#"{"id":"dyn1","type":"immediate","position":{"fraction":[0,4]},"value":"mf"}"#;
        let raw: raw::DynamicGroup = serde_json::from_str(json).unwrap();
        let promoted = promote_dynamic_group(raw);
        assert_eq!(promoted.id, "dyn1");
        assert_eq!(promoted.group_type, raw::DynamicGroupType::Immediate);
        assert_eq!(promoted.value, Some(raw::DynamicValue::Mf));
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

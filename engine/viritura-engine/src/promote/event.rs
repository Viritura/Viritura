//! Promote MNX `event`, `grace`, `tuplet`, `multi-note-tremolo`, `space`,
//! `sequence`, plus `rest`, `full-measure-rest`, and `lyrics`.
//!
//! Sequence-content dispatch: each `raw::SequenceContentItem` is a typify
//! flatten-union with one `subtype_N: Option<T>` per anyOf branch. Only one
//! branch deserializes successfully thanks to the required `type` literal
//! discriminators on every variant except `event` (which has a unique
//! required `duration` field).

use crate::model::duration::Duration as ModelDuration;
use crate::model::event::Glissando as ModelGlissando;
use crate::model::event::{
    Event as ModelEvent, FullMeasure as ModelFullMeasure, Grace as ModelGrace,
    GraceType as ModelGraceType, LyricLine as ModelLyricLine, LyricLineType as ModelLyricLineType,
    Lyrics as ModelLyrics, MultiNoteTremolo as ModelMultiNoteTremolo, Note as ModelNote,
    Rest as ModelRest, Sequence as ModelSequence, SequenceContent as ModelSequenceContent,
    Space as ModelSpace, StemDirection as ModelStemDirection, Tuplet as ModelTuplet,
    TupletBracket as ModelTupletBracket, TupletDisplaySetting as ModelTupletDisplaySetting,
    TupletDuration as ModelTupletDuration,
};
use crate::promote::articulation::{promote_fermata, promote_markings, promote_orientation};
use crate::promote::duration::promote_duration;
use crate::promote::note::{promote_kit_note_to_note, promote_note};
use crate::promote::slur::promote_slur;
use crate::promote::vendor_directions::extract_event_glissandos;
use crate::promote::PromoteError;
use crate::raw;

// ─── Leaves ──────────────────────────────────────────────────────────

pub(crate) fn promote_rest(r: raw::Rest) -> ModelRest {
    ModelRest {
        staff_position: r.staff_position.map(|p| i32::try_from(p.0).unwrap_or(0)),
    }
}

pub(crate) fn promote_full_measure_rest(
    r: raw::FullMeasureRest,
) -> Result<ModelFullMeasure, PromoteError> {
    // The MNX schema makes `visualDuration` optional, but the engine model
    // requires it. Default to a whole note when absent.
    let visual_duration = match r.visual_duration {
        Some(nv) => promote_duration(nv)?,
        None => ModelDuration {
            base: crate::model::duration::NoteValueBase::Whole,
            dots: None,
        },
    };
    Ok(ModelFullMeasure {
        visual_duration,
        staff_position: r.staff_position.map(|p| i32::try_from(p.0).unwrap_or(0)),
    })
}

pub(crate) fn promote_lyric_line_type(r: raw::EventLyricLineType) -> ModelLyricLineType {
    match r {
        raw::EventLyricLineType::Start => ModelLyricLineType::Start,
        raw::EventLyricLineType::Middle => ModelLyricLineType::Middle,
        raw::EventLyricLineType::End => ModelLyricLineType::End,
        raw::EventLyricLineType::Whole => ModelLyricLineType::Whole,
    }
}

pub(crate) fn promote_lyric_line(r: raw::EventLyricLine) -> ModelLyricLine {
    ModelLyricLine {
        text: String::from(r.text),
        syllable_type: r.type_.map(promote_lyric_line_type),
    }
}

pub(crate) fn promote_lyrics(r: raw::Lyrics) -> ModelLyrics {
    ModelLyrics {
        lines: r.lines.map(|map| {
            map.0
                .into_iter()
                .map(|(k, v)| (String::from(k), promote_lyric_line(v)))
                .collect()
        }),
    }
}

pub(crate) fn promote_stem_direction(r: raw::StemDirection) -> ModelStemDirection {
    match r {
        raw::StemDirection::Up => ModelStemDirection::Up,
        raw::StemDirection::Down => ModelStemDirection::Down,
    }
}

// ─── NoteValueQuantity → TupletDuration ──────────────────────────────

pub(crate) fn promote_tuplet_duration(
    r: raw::NoteValueQuantity,
) -> Result<ModelTupletDuration, PromoteError> {
    Ok(ModelTupletDuration {
        duration: promote_duration(r.duration)?,
        multiple: u32::try_from(r.multiple.0).unwrap_or(1),
    })
}

pub(crate) fn promote_tuplet_bracket(r: raw::YesNoAuto) -> ModelTupletBracket {
    match r {
        raw::YesNoAuto::Yes => ModelTupletBracket::Yes,
        raw::YesNoAuto::No => ModelTupletBracket::No,
        raw::YesNoAuto::Auto => ModelTupletBracket::Auto,
    }
}

pub(crate) fn promote_tuplet_display_setting(
    r: raw::TupletDisplaySetting,
) -> ModelTupletDisplaySetting {
    match r {
        raw::TupletDisplaySetting::NoNumber => ModelTupletDisplaySetting::NoNumber,
        raw::TupletDisplaySetting::Inner => ModelTupletDisplaySetting::Inner,
        raw::TupletDisplaySetting::Both => ModelTupletDisplaySetting::Both,
    }
}

pub(crate) fn promote_grace_type(r: raw::GraceType) -> ModelGraceType {
    match r {
        raw::GraceType::MakeTime => ModelGraceType::MakeTime,
        raw::GraceType::StealFollowing => ModelGraceType::StealFollowing,
        raw::GraceType::StealPrevious => ModelGraceType::StealPrevious,
    }
}

// ─── Event ────────────────────────────────────────────────────────────

pub(crate) fn promote_event(r: raw::Event) -> Result<ModelEvent, PromoteError> {
    // Top-level glissandos win; fall back to _x.viritura.glissandos.
    let vendor_glissandos: Option<Vec<ModelGlissando>> = extract_event_glissandos(r.x.as_ref());

    let notes: Vec<ModelNote> = {
        let mut all = r.notes.into_iter().map(promote_note).collect::<Vec<_>>();
        for kit_note in r.kit_notes {
            all.push(promote_kit_note_to_note(kit_note));
        }
        all
    };
    let notes = if notes.is_empty() { None } else { Some(notes) };
    let slurs = r.slurs.into_iter().map(promote_slur).collect::<Vec<_>>();

    Ok(ModelEvent {
        duration: promote_duration(r.duration)?,
        id: r.id.map(String::from),
        notes,
        rest: r.rest.map(promote_rest),
        staff: r.staff.map(|s| u32::try_from(s.0).unwrap_or(1)),
        slurs: (!slurs.is_empty()).then_some(slurs),
        glissandos: vendor_glissandos,
        markings: r.markings.map(promote_markings),
        fermata: r.fermata.map(promote_fermata),
        lyrics: r.lyrics.map(promote_lyrics),
        stem_direction: r.stem_direction.map(promote_stem_direction),
        orient: r.orient.map(promote_orientation),
    })
}

pub(crate) fn promote_grace(r: raw::Grace) -> Result<ModelGrace, PromoteError> {
    let content = r
        .content
        .into_iter()
        .map(promote_event)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ModelGrace {
        content,
        grace_type: r.grace_type.map(promote_grace_type),
        slash: r.slash,
        color: r.color.map(|c| c.0),
    })
}

pub(crate) fn promote_tuplet(
    r: raw::Tuplet,
    content_json: serde_json::Value,
) -> Result<ModelTuplet, PromoteError> {
    let items = match content_json {
        serde_json::Value::Array(a) => a,
        _ => Vec::new(),
    };
    let content = items
        .into_iter()
        .map(promote_sequence_content_item)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ModelTuplet {
        inner: promote_tuplet_duration(r.inner)?,
        outer: promote_tuplet_duration(r.outer)?,
        content,
        bracket: r.bracket.map(promote_tuplet_bracket),
        show_number: r.show_number.map(promote_tuplet_display_setting),
        show_value: r.show_value.map(promote_tuplet_display_setting),
        orient: r.orient.map(promote_orientation),
        staff: r.staff.map(|s| u32::try_from(s.0).unwrap_or(1)),
    })
}

pub(crate) fn promote_multi_note_tremolo(
    r: raw::MultiNoteTremolo,
) -> Result<ModelMultiNoteTremolo, PromoteError> {
    let content = r
        .content
        .into_iter()
        .map(promote_event)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ModelMultiNoteTremolo {
        content,
        marks: u32::try_from(r.marks.0).unwrap_or(1),
        outer: promote_tuplet_duration(r.outer)?,
        individual_duration: r.individual_duration.map(promote_duration).transpose()?,
    })
}

pub(crate) fn promote_space(r: raw::Space) -> ModelSpace {
    // Fraction is a Vec<IntegerUnsigned>; spec mandates length 2.
    let (num, den) = match r.duration.0.as_slice() {
        [n, d] => (
            u32::try_from(n.0).unwrap_or(0),
            u32::try_from(d.0).unwrap_or(1),
        ),
        _ => (0, 1),
    };
    ModelSpace {
        duration: (num, den),
    }
}

pub(crate) fn promote_sequence_content_item(
    v: serde_json::Value,
) -> Result<ModelSequenceContent, PromoteError> {
    // typify's SequenceContentItem dispatch is broken (flatten-union
    // silently drops all variants). Dispatch from raw JSON instead, using
    // the `type` discriminator.
    let type_str = v.get("type").and_then(|t| t.as_str()).map(str::to_owned);
    match type_str.as_deref() {
        Some("tuplet") => {
            let mut obj = match v {
                serde_json::Value::Object(m) => m,
                _ => {
                    return Err(PromoteError::UnsupportedNoteValueBase(
                        "tuplet not object".into(),
                    ))
                }
            };
            let content_json = obj
                .remove("content")
                .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
            // Re-inject an empty content so raw::Tuplet (which requires it)
            // deserializes successfully.
            obj.insert("content".into(), serde_json::Value::Array(Vec::new()));
            let t: raw::Tuplet = serde_json::from_value(serde_json::Value::Object(obj))
                .map_err(|e| PromoteError::UnsupportedNoteValueBase(format!("tuplet: {e}")))?;
            Ok(ModelSequenceContent::Tuplet(promote_tuplet(
                t,
                content_json,
            )?))
        }
        Some("tremolo") => {
            let t: raw::MultiNoteTremolo = serde_json::from_value(v)
                .map_err(|e| PromoteError::UnsupportedNoteValueBase(format!("tremolo: {e}")))?;
            Ok(ModelSequenceContent::MultiNoteTremolo(
                promote_multi_note_tremolo(t)?,
            ))
        }
        Some("grace") => {
            let g: raw::Grace = serde_json::from_value(v)
                .map_err(|e| PromoteError::UnsupportedNoteValueBase(format!("grace: {e}")))?;
            Ok(ModelSequenceContent::Grace(promote_grace(g)?))
        }
        Some("space") => {
            let s: raw::Space = serde_json::from_value(v)
                .map_err(|e| PromoteError::UnsupportedNoteValueBase(format!("space: {e}")))?;
            Ok(ModelSequenceContent::Space(promote_space(s)))
        }
        _ => {
            // Event has no `type` discriminator (or has a literal "event"
            // value that typify treats as optional).
            let e: raw::Event = serde_json::from_value(v)
                .map_err(|e| PromoteError::UnsupportedNoteValueBase(format!("event: {e}")))?;
            Ok(ModelSequenceContent::Event(promote_event(e)?))
        }
    }
}

pub(crate) fn promote_sequence(
    r: raw::Sequence,
    content_json: serde_json::Value,
) -> Result<ModelSequence, PromoteError> {
    let items = match content_json {
        serde_json::Value::Array(a) => a,
        _ => Vec::new(),
    };
    let content = items
        .into_iter()
        .map(promote_sequence_content_item)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ModelSequence {
        content,
        full_measure: r.full_measure.map(promote_full_measure_rest).transpose()?,
        staff: r.staff.map(|s| u32::try_from(s.0).unwrap_or(1)),
        voice: r.voice.map(|v| v.0),
        orient: r.orient.map(promote_orientation),
        forced_stem_up: None,
        source_part_index: None,
        source_seq_index: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_simple_event() {
        let json = r#"{
            "duration": {"base":"quarter"},
            "notes": [{"pitch":{"step":"C","octave":4}}]
        }"#;
        let r: raw::Event = serde_json::from_str(json).unwrap();
        let e = promote_event(r).unwrap();
        assert!(e.notes.is_some());
        assert!(!e.is_rest());
    }

    #[test]
    fn promotes_rest_event() {
        let json = r#"{"duration":{"base":"quarter"},"rest":{}}"#;
        let r: raw::Event = serde_json::from_str(json).unwrap();
        let e = promote_event(r).unwrap();
        assert!(e.is_rest());
    }

    #[test]
    fn promotes_tuplet_sequence_item() {
        let json = r#"{
            "type":"tuplet",
            "inner":{"duration":{"base":"eighth"},"multiple":3},
            "outer":{"duration":{"base":"eighth"},"multiple":2},
            "content":[]
        }"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let c = promote_sequence_content_item(v).unwrap();
        assert!(matches!(c, ModelSequenceContent::Tuplet(_)));
    }

    #[test]
    fn promotes_event_sequence_item() {
        let json = r#"{"duration":{"base":"quarter"},"rest":{}}"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let c = promote_sequence_content_item(v).unwrap();
        assert!(matches!(c, ModelSequenceContent::Event(_)));
    }

    #[test]
    fn promotes_sequence_with_events_and_tuplet() {
        let json = r#"{
            "content": [
                {"duration":{"base":"quarter"},"rest":{}},
                {"type":"tuplet","inner":{"duration":{"base":"eighth"},"multiple":3},
                 "outer":{"duration":{"base":"eighth"},"multiple":2},"content":[]}
            ],
            "voice": "v1"
        }"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let content = v.get("content").cloned().unwrap_or(serde_json::Value::Null);
        // Re-serialize with empty content so raw::Sequence parses.
        let mut stub = v.as_object().unwrap().clone();
        stub.insert("content".into(), serde_json::Value::Array(Vec::new()));
        let r: raw::Sequence = serde_json::from_value(serde_json::Value::Object(stub)).unwrap();
        let s = promote_sequence(r, content).unwrap();
        assert_eq!(s.voice.as_deref(), Some("v1"));
        assert_eq!(s.content.len(), 2);
    }
}

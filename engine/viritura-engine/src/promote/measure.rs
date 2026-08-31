//! Promote MNX `MeasureGlobal` and `PartMeasure` into the engine model.
//!
//! `PartMeasure.sequences` contains `raw::Sequence`s, but each Sequence's
//! `content` is a `SequenceContent` whose item type
//! (`SequenceContentItem`) is a broken typify flatten-union. So we accept
//! the raw JSON for the part-measure (or at least its `sequences` slot)
//! and route each sequence's content through
//! [`super::event::promote_sequence`].
//!
//! `_x.viritura.jump` wins over the top-level MNX-core `jump` on a global
//! measure (matches the old custom `Deserialize` semantics).

use crate::model::clef::RhythmicPosition as ModelRhythmicPosition;
use crate::model::event::ArpeggioDirection as ModelArpeggioDirection;
use crate::model::measure::{
    GlobalMeasure as ModelGlobalMeasure, GlobalMeasureExtensions, IdPair as ModelIdPair,
    MeasureRepeat as ModelMeasureRepeat, MeasureRepeatCounter as ModelMeasureRepeatCounter,
    MnxArpeggio as ModelMnxArpeggio, NonArpeggio as ModelNonArpeggio,
    PartMeasure as ModelPartMeasure, VendorExtensions as ModelVendorExtensions,
};
use crate::promote::barline::promote_barline;
use crate::promote::beam::promote_beam;
use crate::promote::clef::{promote_positioned_clef, promote_rhythmic_position};
use crate::promote::direction::{
    promote_dynamic_group, promote_fine, promote_jump, promote_ottava, promote_segno, promote_tempo,
};
use crate::promote::event::promote_sequence;
use crate::promote::key::promote_key;
use crate::promote::repeat::{promote_ending, promote_repeat_end, promote_repeat_start_with_json};
use crate::promote::time::promote_time;
use crate::promote::vendor_directions::{
    extract_global_measure_vendor, extract_part_measure_vendor_with_fallback,
};
use crate::promote::PromoteError;
use crate::{raw, raw_viritura};

fn promote_id_pair(r: raw::IdPair) -> ModelIdPair {
    ModelIdPair {
        start: String::from(r.start),
        end: String::from(r.end),
    }
}

fn promote_up_down_auto(r: raw::UpDownAuto) -> ModelArpeggioDirection {
    match r {
        raw::UpDownAuto::Up => ModelArpeggioDirection::Up,
        raw::UpDownAuto::Down => ModelArpeggioDirection::Down,
        raw::UpDownAuto::Auto => ModelArpeggioDirection::Auto,
    }
}

fn promote_mnx_arpeggio(r: raw::Arpeggio) -> ModelMnxArpeggio {
    ModelMnxArpeggio {
        position: promote_rhythmic_position(r.position),
        span: promote_id_pair(r.span),
        direction: r.direction.map(promote_up_down_auto),
        arrow: r.arrow,
        id: r.id.map(String::from),
    }
}

fn promote_non_arpeggio(r: raw::NonArpeggio) -> ModelNonArpeggio {
    ModelNonArpeggio {
        position: ModelRhythmicPosition {
            fraction: promote_rhythmic_position(r.position).fraction,
        },
        span: promote_id_pair(r.span),
        id: r.id.map(String::from),
    }
}

/// Promote an MNX `measure-repeat` (simile marking) into the engine model.
fn promote_measure_repeat(r: raw::MeasureRepeat) -> ModelMeasureRepeat {
    ModelMeasureRepeat {
        // A simile marking always covers at least the bar it sits in.
        number: u32::try_from(*r.number).unwrap_or(1).max(1),
        counter: r.counter.map(|c| ModelMeasureRepeatCounter {
            count: u32::try_from(*c.count).unwrap_or(1),
            orient: c.orient,
        }),
        display_number: r.display_number,
        staff_position: r.staff_position.map(|p| i32::try_from(*p).unwrap_or(0)),
    }
}

fn vec_or_none<T>(values: Vec<T>) -> Option<Vec<T>> {
    (!values.is_empty()).then_some(values)
}

#[cfg(test)]
pub(crate) fn promote_global_measure(
    r: raw::MeasureGlobal,
) -> Result<ModelGlobalMeasure, PromoteError> {
    promote_global_measure_with_json(r, None)
}

pub(crate) fn promote_global_measure_with_json(
    r: raw::MeasureGlobal,
    original_json: Option<&serde_json::Value>,
) -> Result<ModelGlobalMeasure, PromoteError> {
    let repeat_start_json = original_json.and_then(|v| v.get("repeatStart"));
    let vendor = extract_global_measure_vendor(r.x.as_ref());
    // _x.viritura.jump wins over top-level
    let jump = vendor.jump.clone().or_else(|| r.jump.map(promote_jump));
    let tempos = r
        .tempos
        .into_iter()
        .map(promote_tempo)
        .collect::<Result<Vec<_>, _>>()?;
    let tempos = vec_or_none(tempos);
    let mut time = r.time.map(promote_time);
    if vendor.senza_misura == Some(true) {
        if let Some(time) = time.as_mut() {
            time.display = Some(crate::model::time::TimeSignatureDisplay::SenzaMisura);
        }
    }
    // Preserve _x roundtrip if any viritura content present.
    let extensions = (vendor.rehearsal_mark.is_some()
        || vendor.coda.is_some()
        || vendor.jump.is_some()
        || vendor.senza_misura.is_some())
    .then_some(ModelVendorExtensions {
        viritura: Some(GlobalMeasureExtensions {
            rehearsal_mark: vendor.rehearsal_mark,
            coda: vendor.coda,
            jump: vendor.jump,
            senza_misura: vendor.senza_misura,
        }),
    });
    Ok(ModelGlobalMeasure {
        id: r.id.map(String::from),
        number: r.number.map(|n| n.0 as i32),
        time,
        key: r.key.map(promote_key),
        barline: r.barline.map(promote_barline),
        repeat_start: r
            .repeat_start
            .map(|rs| promote_repeat_start_with_json(rs, repeat_start_json)),
        repeat_end: r.repeat_end.map(promote_repeat_end),
        ending: r.ending.map(promote_ending),
        tempos,
        segno: r.segno.map(promote_segno),
        fine: r.fine.map(promote_fine),
        jump,
        extensions,
    })
}

/// Promote a part-measure. `original_json` is the original JSON object for
/// this part measure (so we can recover sequence content past the broken
/// typify flatten union on `SequenceContentItem`).
pub(crate) fn promote_part_measure(
    r: raw::PartMeasure,
    original_json: &serde_json::Value,
) -> Result<ModelPartMeasure, PromoteError> {
    let sequences_json = original_json
        .get("sequences")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();
    let mut sequences = Vec::with_capacity(sequences_json.len());
    for seq_json in sequences_json {
        // Stub `content` so raw::Sequence parses.
        let mut obj = match seq_json.clone() {
            serde_json::Value::Object(m) => m,
            _ => continue,
        };
        let content_json = obj
            .remove("content")
            .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
        obj.insert("content".into(), serde_json::Value::Array(Vec::new()));
        let raw_seq: raw::Sequence = serde_json::from_value(serde_json::Value::Object(obj))
            .map_err(|e| PromoteError::UnsupportedNoteValueBase(format!("sequence: {e}")))?;
        sequences.push(promote_sequence(raw_seq, content_json)?);
    }

    let clefs = vec_or_none(r.clefs.into_iter().map(promote_positioned_clef).collect());
    let beams = r
        .beams
        .map(|b| b.0.into_iter().map(promote_beam).collect::<Vec<_>>());
    let dynamics = vec_or_none(r.dynamics.into_iter().map(promote_dynamic_group).collect());
    let ottavas = vec_or_none(r.ottavas.into_iter().map(promote_ottava).collect());
    let arpeggios = vec_or_none(r.arpeggios.into_iter().map(promote_mnx_arpeggio).collect());
    let non_arpeggios = vec_or_none(
        r.non_arpeggios
            .into_iter()
            .map(promote_non_arpeggio)
            .collect(),
    );
    let measure_repeat = r.measure_repeat.map(promote_measure_repeat);

    let vendor = extract_part_measure_vendor_with_fallback(r.x.as_ref(), Some(original_json));

    Ok(ModelPartMeasure {
        clefs,
        sequences,
        arpeggios,
        non_arpeggios,
        beams,
        dynamics,
        ottavas,
        measure_repeat,
        pedals: vendor.pedals,
        chord_symbols: vendor.chord_symbols,
        expressions: vendor.expressions,
        condensing_override: vendor.condensing_override,
    })
}

// Quiet unused-import lint for `raw_viritura`: we may want it later if we
// add additional vendor fields; keep symmetry with sibling modules.
#[allow(dead_code)]
fn _touch_raw_viritura(_: Option<raw_viritura::PartMeasureExtensions>) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_global(json: &str) -> ModelGlobalMeasure {
        let r: raw::MeasureGlobal = serde_json::from_str(json).unwrap();
        promote_global_measure(r).unwrap()
    }

    fn parse_part(json: &str) -> ModelPartMeasure {
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        // Stub `sequences` empty for the raw parse; full sequences flow via JSON.
        let mut obj = v.as_object().unwrap().clone();
        obj.insert("sequences".into(), serde_json::Value::Array(Vec::new()));
        let r: raw::PartMeasure = serde_json::from_value(serde_json::Value::Object(obj)).unwrap();
        promote_part_measure(r, &v).unwrap()
    }

    #[test]
    fn promotes_minimal_global_measure() {
        let g = parse_global(r#"{"number": 1}"#);
        assert_eq!(g.number, Some(1));
        assert!(g.tempos.is_none());
        assert!(g.jump.is_none());
    }

    #[test]
    fn vendor_jump_wins_over_core_jump() {
        let g = parse_global(
            r#"{
                "jump": {"type": "dsalfine",
                          "location": {"fraction":[0,1]}},
                "_x": {"viritura": {"jump": {"type": "dsalcoda",
                          "location": {"fraction":[0,1]}}}}
            }"#,
        );
        let jt = g.jump.expect("jump promoted");
        let s = serde_json::to_string(&jt.jump_type).unwrap();
        assert!(s.contains("dsalcoda"), "got {s}");
    }

    #[test]
    fn promotes_part_measure_with_empty_sequences() {
        let p = parse_part(r#"{"sequences": []}"#);
        assert_eq!(p.sequences.len(), 0);
    }

    #[test]
    fn promotes_part_measure_with_a_sequence() {
        let p = parse_part(
            r#"{
                "sequences": [
                    {"content": [{"duration":{"base":"quarter"},"rest":{}}]}
                ]
            }"#,
        );
        assert_eq!(p.sequences.len(), 1);
        assert_eq!(p.sequences[0].content.len(), 1);
    }

    #[test]
    fn promotes_part_measure_with_empty_vendor_extensions() {
        let p = parse_part(r#"{"sequences": [], "_x": {"viritura": {}}}"#);
        assert!(p.chord_symbols.is_none());
    }
}

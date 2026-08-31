//! Promote MNX `part` into the engine model.
//!
//! Each part's measures need the original part JSON so we can recover
//! sequence content past typify's broken `SequenceContentItem` dispatch
//! (see [`super::event`] and [`super::measure`]).

use crate::model::part::{
    Interval as ModelInterval, Part as ModelPart, Transposition as ModelTransposition,
};
use crate::promote::kit::promote_kit_component;
use crate::promote::measure::promote_part_measure;
use crate::promote::PromoteError;
use crate::raw;

fn promote_interval(r: raw::Interval) -> ModelInterval {
    ModelInterval {
        half_steps: r.half_steps.0 as i32,
        staff_distance: r.staff_distance.0 as i32,
    }
}

fn promote_transposition(r: raw::PartTransposition) -> ModelTransposition {
    ModelTransposition {
        interval: promote_interval(r.interval),
        key_fifths_flip_at: r.key_fifths_flip_at.map(|v| v.0 as i32),
        prefers_written_pitches: r.prefers_written_pitches,
    }
}

/// Promote a part. `original_json` is the original JSON for this part
/// (so its measures' sequences can be promoted from raw JSON).
pub(crate) fn promote_part(
    r: raw::Part,
    original_json: &serde_json::Value,
) -> Result<ModelPart, PromoteError> {
    let measures_json = original_json
        .get("measures")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut measures = Vec::with_capacity(r.measures.len());
    for (idx, raw_pm) in r.measures.into_iter().enumerate() {
        let measure_json = measures_json
            .get(idx)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        measures.push(promote_part_measure(raw_pm, &measure_json)?);
    }

    let kit = r.kit.map(|k| {
        k.0.into_iter()
            .map(|(k, v)| (String::from(k), promote_kit_component(v)))
            .collect()
    });

    Ok(ModelPart {
        id: r.id.map(String::from),
        name: r.name.map(|n| n.0).unwrap_or_default(),
        short_name: r.short_name.map(|n| n.0),
        measures,
        staves: r
            .staves
            .map(|s| u32::try_from(s.0).unwrap_or(1))
            .unwrap_or(1),
        transposition: r.transposition.map(promote_transposition),
        kit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> ModelPart {
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        // Strip sequences from all measures so raw::Part parses (broken typify).
        let mut obj = v.as_object().unwrap().clone();
        if let Some(serde_json::Value::Array(ms)) = obj.get_mut("measures") {
            for m in ms.iter_mut() {
                if let serde_json::Value::Object(mo) = m {
                    mo.insert("sequences".into(), serde_json::Value::Array(Vec::new()));
                }
            }
        }
        let r: raw::Part = serde_json::from_value(serde_json::Value::Object(obj)).unwrap();
        promote_part(r, &v).unwrap()
    }

    #[test]
    fn promotes_minimal_part() {
        let p = parse(
            r#"{"id":"p1","name":"Violin",
                "measures":[{"sequences":[{"content":[]}]},
                            {"sequences":[]}]}"#,
        );
        assert_eq!(p.id.as_deref(), Some("p1"));
        assert_eq!(p.name, "Violin");
        assert_eq!(p.staves, 1);
        assert_eq!(p.measures.len(), 2);
    }

    #[test]
    fn promotes_part_with_transposition() {
        let p = parse(
            r#"{"name":"Bb Trumpet","measures":[],
                "transposition":{"interval":{"halfSteps":-2,"staffDistance":-1}}}"#,
        );
        let t = p.transposition.expect("transposition");
        assert_eq!(t.interval.half_steps, -2);
        assert_eq!(t.interval.staff_distance, -1);
    }
}

//! Promote the `ScoreDefinition` (MNX `score`) into the engine model.

use crate::model::layout::{
    InstrumentNameDisplayPolicy, InstrumentNameDisplaySettings,
    MultimeasureRestRange as ModelMultimeasureRestRange, ScoreDefinition as ModelScoreDefinition,
};
use crate::promote::layout::promote_page;
use crate::promote::vendor_ext::read_viritura_ext;
use crate::raw;

fn promote_multimeasure_rest(r: raw::MultimeasureRest) -> ModelMultimeasureRestRange {
    ModelMultimeasureRestRange {
        start: String::from(r.start),
        duration: u32::try_from(r.duration.0).unwrap_or(0),
        label: r.label.map(String::from),
    }
}

pub(crate) fn promote_score_definition(r: raw::Score) -> ModelScoreDefinition {
    let instrument_name_display = read_viritura_ext(r.x.as_ref())
        .and_then(|ext| ext.get("instrumentNameDisplay"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| {
            Some(InstrumentNameDisplaySettings {
                first_system: parse_instrument_name_policy(settings.get("firstSystem")?)?,
                subsequent_systems: parse_instrument_name_policy(
                    settings.get("subsequentSystems")?,
                )?,
            })
        });
    ModelScoreDefinition {
        name: Some(r.name.0),
        layout: r.layout.map(String::from),
        multimeasure_rests: r
            .multimeasure_rests
            .into_iter()
            .map(promote_multimeasure_rest)
            .collect(),
        use_written: r.use_written,
        pages: r.pages.into_iter().map(promote_page).collect(),
        instrument_name_display,
    }
}

fn parse_instrument_name_policy(value: &serde_json::Value) -> Option<InstrumentNameDisplayPolicy> {
    match value.as_str()? {
        "full" => Some(InstrumentNameDisplayPolicy::Full),
        "short" => Some(InstrumentNameDisplayPolicy::Short),
        "hidden" => Some(InstrumentNameDisplayPolicy::Hidden),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_minimal_score_definition() {
        let r: raw::Score = serde_json::from_str(r#"{"name":"Conductor"}"#).unwrap();
        let s = promote_score_definition(r);
        assert_eq!(s.name.as_deref(), Some("Conductor"));
    }
}

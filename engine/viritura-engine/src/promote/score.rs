//! Promote the `ScoreDefinition` (MNX `score`) into the engine model.

use crate::model::layout::{
    MultimeasureRestRange as ModelMultimeasureRestRange, ScoreDefinition as ModelScoreDefinition,
};
use crate::promote::layout::promote_page;
use crate::raw;

fn promote_multimeasure_rest(r: raw::MultimeasureRest) -> ModelMultimeasureRestRange {
    ModelMultimeasureRestRange {
        start: String::from(r.start),
        duration: u32::try_from(r.duration.0).unwrap_or(0),
        label: r.label.map(String::from),
    }
}

pub(crate) fn promote_score_definition(r: raw::Score) -> ModelScoreDefinition {
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

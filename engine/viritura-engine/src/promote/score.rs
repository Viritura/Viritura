//! Promote the `ScoreDefinition` (MNX `score`) into the engine model.

use crate::model::layout::{
    AutoHideEmptyStaves, InstrumentNameDisplayPolicy, InstrumentNameDisplaySettings, LayoutBreak,
    LayoutBreakKind, MultimeasureRestRange as ModelMultimeasureRestRange,
    ScoreDefinition as ModelScoreDefinition,
};
use crate::promote::layout::promote_page;
use crate::promote::text_frame::promote_text_frames;
use crate::promote::vendor_ext::read_viritura_ext;
use crate::promote::PromoteError;
use crate::raw;

fn promote_multimeasure_rest(r: raw::MultimeasureRest) -> ModelMultimeasureRestRange {
    ModelMultimeasureRestRange {
        start: String::from(r.start),
        duration: u32::try_from(r.duration.0).unwrap_or(0),
        label: r.label.map(String::from),
    }
}

pub(crate) fn promote_score_definition(
    r: raw::Score,
) -> Result<ModelScoreDefinition, PromoteError> {
    let viritura = read_viritura_ext(r.x.as_ref());
    let instrument_name_display = viritura
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
    let layout_breaks = viritura
        .and_then(|ext| ext.get("layoutBreaks"))
        .and_then(serde_json::Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let entry = entry.as_object()?;
                    let measure = entry.get("measure")?.as_str()?.to_owned();
                    let kind = match entry.get("kind")?.as_str()? {
                        "system" => LayoutBreakKind::System,
                        "page" => LayoutBreakKind::Page,
                        _ => return None,
                    };
                    Some(LayoutBreak { measure, kind })
                })
                .collect()
        })
        .unwrap_or_default();
    let text_frames = promote_text_frames(viritura.and_then(|ext| ext.get("textFrames")))?;
    let auto_hide_empty_parts: Vec<String> = viritura
        .and_then(|ext| ext.get("autoHideEmptyParts"))
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|error| PromoteError::InvalidAutoHideEmptyParts(error.to_string()))?
        .unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    if auto_hide_empty_parts
        .iter()
        .any(|id| id.is_empty() || !seen.insert(id))
    {
        return Err(PromoteError::InvalidAutoHideEmptyParts(
            "expected unique, nonempty part IDs".into(),
        ));
    }
    let auto_hide_empty_staves: Option<AutoHideEmptyStaves> = viritura
        .and_then(|ext| ext.get("autoHideEmptyStaves"))
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|error| PromoteError::InvalidAutoHideEmptyParts(error.to_string()))?;
    if auto_hide_empty_staves.as_ref().is_some_and(|options| {
        options.keep_visible.iter().any(|entry| {
            let mut seen = std::collections::HashSet::new();
            entry.measure.is_empty()
                || entry.parts.is_empty()
                || entry
                    .parts
                    .iter()
                    .any(|id| id.is_empty() || !seen.insert(id))
        })
    }) {
        return Err(PromoteError::InvalidAutoHideEmptyParts(
            "keepVisible entries need a measure and unique, nonempty part IDs".into(),
        ));
    }
    Ok(ModelScoreDefinition {
        bar_numbers: viritura
            .and_then(|ext| ext.get("barNumbers"))
            .map(crate::model::score::BarNumberSettings::parse)
            .transpose()?,
        name: Some(r.name.0),
        layout: r.layout.map(String::from),
        multimeasure_rests: r
            .multimeasure_rests
            .into_iter()
            .map(promote_multimeasure_rest)
            .collect(),
        use_written: r.use_written,
        pages: r.pages.into_iter().map(promote_page).collect(),
        page_setup_role: viritura
            .and_then(|ext| ext.get("pageSetupRole"))
            .map(|value| serde_json::from_value(value.clone()))
            .transpose()
            .map_err(|error| PromoteError::InvalidPageSetupRole(error.to_string()))?,
        instrument_name_display,
        auto_hide_empty_parts,
        auto_hide_empty_staves,
        layout_breaks,
        text_frames,
    })
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
        let s = promote_score_definition(r).unwrap();
        assert_eq!(s.name.as_deref(), Some("Conductor"));
    }

    #[test]
    fn rejects_malformed_auto_hide_decisions() {
        for options in [
            r#"{"firstSystem":"always"}"#,
            r#"{"keepVisible":[{"measure":"m1","parts":[]}]}"#,
            r#"{"keepVisible":[{"measure":"m1","parts":["a","a"]}]}"#,
        ] {
            let source = format!(
                r#"{{"name":"S","_x":{{"viritura":{{"autoHideEmptyStaves":{options}}}}}}}"#
            );
            let r: raw::Score = serde_json::from_str(&source).unwrap();
            assert!(promote_score_definition(r).is_err(), "{options}");
        }
    }

    #[test]
    fn rejects_invalid_page_setup_roles() {
        for role in [
            serde_json::json!("band"),
            serde_json::json!(null),
            serde_json::json!(1),
        ] {
            let source = serde_json::json!({"name":"S","_x":{"viritura":{"pageSetupRole":role}}});
            let raw: raw::Score = serde_json::from_value(source).unwrap();
            assert!(matches!(
                promote_score_definition(raw),
                Err(PromoteError::InvalidPageSetupRole(_))
            ));
        }
    }
}

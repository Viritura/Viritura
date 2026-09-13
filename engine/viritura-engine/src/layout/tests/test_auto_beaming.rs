use crate::layout::beams::auto_beam_groups;
use crate::layout::config::LayoutConfig;
use crate::layout::measure::layout_measure;
use crate::layout::resolve::resolve_measures;
use crate::parse::parse_mnx;
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoBeamingCase {
    name: String,
    score: serde_json::Value,
    excluded_event_ids: Vec<String>,
    expected: Vec<Vec<String>>,
}

#[derive(Deserialize)]
struct AutoBeamingFixture {
    cases: Vec<AutoBeamingCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IrregularAutoBeamingCase {
    name: String,
    count: u32,
    unit: u32,
    event_count: Option<u32>,
    event_base: Option<String>,
    beat_structure: Option<Vec<u32>>,
    expected_group_sizes: Vec<usize>,
}

#[derive(Deserialize)]
struct IrregularAutoBeamingFixture {
    cases: Vec<IrregularAutoBeamingCase>,
}

#[test]
fn automatic_beaming_matches_shared_editor_contract() {
    let fixture: AutoBeamingFixture = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test-fixtures/auto-beaming.json"
    )))
    .expect("shared auto-beaming fixture must parse");
    let config = LayoutConfig::default();

    for test_case in fixture.cases {
        let score = parse_mnx(&test_case.score.to_string())
            .unwrap_or_else(|error| panic!("{}: score must parse: {error}", test_case.name));
        let resolved = resolve_measures(&score, 0);
        let measure = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0);
        let excluded_ids = test_case
            .excluded_event_ids
            .into_iter()
            .collect::<HashSet<_>>();
        let actual = auto_beam_groups(
            &measure.voice_layouts,
            &measure.resolved.active_time,
            &excluded_ids,
        )
        .into_iter()
        .map(|beam| beam.events)
        .collect::<Vec<_>>();

        assert_eq!(actual, test_case.expected, "{}", test_case.name);
    }
}

#[test]
fn irregular_meter_beaming_matches_shared_editor_contract() {
    let fixture: IrregularAutoBeamingFixture = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test-fixtures/irregular-auto-beaming.json"
    )))
    .expect("shared irregular-meter fixture must parse");
    let config = LayoutConfig::default();

    for test_case in fixture.cases {
        let event_base = test_case.event_base.as_deref().unwrap_or("eighth");
        let events = (1..=test_case.event_count.unwrap_or(test_case.count))
            .map(|index| {
                serde_json::json!({
                    "id": format!("e{index}"),
                    "duration": { "base": event_base },
                    "notes": [{ "pitch": { "step": "C", "octave": 4 } }]
                })
            })
            .collect::<Vec<_>>();
        let mut time = serde_json::json!({
            "count": test_case.count,
            "unit": test_case.unit
        });
        if let Some(beat_structure) = test_case.beat_structure {
            time["_x"] = serde_json::json!({
                "viritura": { "beatStructure": beat_structure }
            });
        }
        let score_json = serde_json::json!({
            "mnx": { "version": 1 },
            "global": { "measures": [{ "time": time }] },
            "parts": [{ "measures": [{ "sequences": [{ "content": events }] }] }]
        });
        let score = parse_mnx(&score_json.to_string())
            .unwrap_or_else(|error| panic!("{}: score must parse: {error}", test_case.name));
        let resolved = resolve_measures(&score, 0);
        let measure = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0);
        let actual = auto_beam_groups(
            &measure.voice_layouts,
            &measure.resolved.active_time,
            &HashSet::new(),
        )
        .into_iter()
        .map(|beam| beam.events.len())
        .collect::<Vec<_>>();

        assert_eq!(actual, test_case.expected_group_sizes, "{}", test_case.name);
    }
}

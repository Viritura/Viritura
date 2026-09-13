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

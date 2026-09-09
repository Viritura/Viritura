use crate::layout::cache::measure_content_hash;
use crate::layout::config::LayoutConfig;
use crate::layout::resolve::{detect_multimeasure_rest_groups, resolve_measures};
use crate::layout::{layout_full_score, layout_score, layout_with_mnx_scores};
use crate::parse::parse_mnx;
use crate::render::{DisplayList, RenderCommand};

fn single_measure_score(staff_configs: Option<&str>) -> crate::model::Score {
    let staff_configs = staff_configs.map_or(String::new(), |configs| {
        format!(r#","staffConfigs": {configs}"#)
    });
    parse_mnx(&format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{"id": "m0", "time": {{"count": 4, "unit": 4}}}}]}},
            "parts": [{{"id": "part", "measures": [{{
                "sequences": [{{"content": [], "fullMeasure": {{"visualDuration": {{"base": "whole"}}}}}}]
                {staff_configs}
            }}]}}]
        }}"#
    ))
    .expect("staff-line test score should parse")
}

fn staff_line_segments(dl: &DisplayList, config: &LayoutConfig) -> Vec<(f64, f64, f64)> {
    let expected_width = config.staff_line_width * config.sp;
    dl.commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                ..
            } if (y1 - y2).abs() < 0.001 && (*width - expected_width).abs() < 0.001 && x2 > x1 => {
                Some((*x1, *x2, *y1))
            }
            _ => None,
        })
        .collect()
}

#[test]
fn default_and_omitted_line_count_render_five_lines() {
    let config = LayoutConfig::default();
    let default_display = layout_score(&single_measure_score(None), 0, &config);
    let omitted_display = layout_score(
        &single_measure_score(Some(r#"[{"config": {}}]"#)),
        0,
        &config,
    );

    assert_eq!(staff_line_segments(&default_display, &config).len(), 5);
    assert_eq!(staff_line_segments(&omitted_display, &config).len(), 5);
}

#[test]
fn omitted_lines_resets_inherited_line_count_to_five() {
    let score = parse_mnx(
        r#"{
            "mnx": {"version": 1},
            "global": {"measures": [
                {"id": "m0", "time": {"count": 4, "unit": 4}},
                {"id": "m1"}
            ]},
            "parts": [{"id": "part", "measures": [
                {
                    "staffConfigs": [{"config": {"lines": 1}}],
                    "sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]
                },
                {
                    "staffConfigs": [{"config": {}}],
                    "sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]
                }
            ]}]
        }"#,
    )
    .unwrap();
    let resolved = resolve_measures(&score, 0);
    assert_eq!(resolved[0].active_staff_lines, 1);
    assert_eq!(resolved[1].active_staff_lines, 5);

    let config = LayoutConfig::default();
    let display = layout_score(&score, 0, &config);
    let lines = staff_line_segments(&display, &config);
    let second_measure = display
        .measure_bounds
        .iter()
        .find(|bounds| bounds.index == 1)
        .unwrap();
    assert_eq!(lines.len(), 5);
    assert!(lines
        .iter()
        .filter(|(_, _, y)| { (*y - (second_measure.y + 2.0 * config.sp)).abs() >= 0.001 })
        .all(|(x1, _, _)| (*x1 - second_measure.x).abs() < 0.001));
}

#[test]
fn single_and_zero_line_staves_render_centered() {
    let config = LayoutConfig::default();
    let single_display = layout_score(
        &single_measure_score(Some(r#"[{"config": {"lines": 1}}]"#)),
        0,
        &config,
    );
    let single_lines = staff_line_segments(&single_display, &config);
    let staff_y = single_display.measure_bounds[0].y;
    assert_eq!(single_lines.len(), 1);
    assert!(
        (single_lines[0].2 - (staff_y + 2.0 * config.sp)).abs() < 0.001,
        "one-line staff must use the canonical middle line"
    );

    let two_line_display = layout_score(
        &single_measure_score(Some(r#"[{"config": {"lines": 2}}]"#)),
        0,
        &config,
    );
    let mut two_line_ys: Vec<_> = staff_line_segments(&two_line_display, &config)
        .into_iter()
        .map(|(_, _, y)| y)
        .collect();
    two_line_ys.sort_by(f64::total_cmp);
    assert_eq!(two_line_ys.len(), 2);
    assert!((two_line_ys[0] - (staff_y + 1.5 * config.sp)).abs() < 0.001);
    assert!((two_line_ys[1] - (staff_y + 2.5 * config.sp)).abs() < 0.001);

    let zero_display = layout_score(
        &single_measure_score(Some(r#"[{"config": {"lines": 0}}]"#)),
        0,
        &config,
    );
    assert!(
        staff_line_segments(&zero_display, &config).is_empty(),
        "zero-line staff must not emit staff lines"
    );
}

#[test]
fn excessive_line_counts_are_bounded_during_rendering() {
    let config = LayoutConfig::default();
    let display = layout_score(
        &single_measure_score(Some(r#"[{"config": {"lines": 4294967296}}]"#)),
        0,
        &config,
    );
    assert_eq!(
        staff_line_segments(&display, &config).len(),
        super::super::staff_lines::MAX_RENDERED_STAFF_LINES as usize
    );
}

#[test]
fn mid_measure_change_keeps_shared_lines_continuous() {
    let config = LayoutConfig::default();
    let display = layout_score(
        &single_measure_score(Some(
            r#"[{"position": {"fraction": [1, 2]}, "config": {"lines": 1}}]"#,
        )),
        0,
        &config,
    );
    let bounds = &display.measure_bounds[0];
    let lines = staff_line_segments(&display, &config);
    let middle_y = bounds.y + 2.0 * config.sp;
    let middle = lines
        .iter()
        .find(|(_, _, y)| (*y - middle_y).abs() < 0.001)
        .expect("canonical middle staff line should remain");

    assert_eq!(
        lines.len(),
        5,
        "the shared middle line should be coalesced across the transition"
    );
    assert!(
        middle.0 <= bounds.x + 0.001 && middle.1 >= bounds.x + bounds.width - 0.001,
        "middle line should span the complete measure"
    );
    let transition_xs: Vec<_> = lines
        .iter()
        .filter(|(_, _, y)| (*y - middle_y).abs() >= 0.001)
        .map(|(_, x2, _)| *x2)
        .collect();
    assert_eq!(transition_xs.len(), 4);
    assert!(transition_xs
        .iter()
        .all(|x| { *x > bounds.x + bounds.prefix_width && *x < bounds.x + bounds.width }));
    assert!(transition_xs
        .windows(2)
        .all(|pair| (pair[0] - pair[1]).abs() < 0.001));
}

#[test]
fn line_count_persists_across_explicit_systems() {
    let score = parse_mnx(
        r#"{
            "mnx": {"version": 1},
            "global": {"measures": [
                {"id": "m0", "time": {"count": 4, "unit": 4}},
                {"id": "m1"}
            ]},
            "layouts": [{"id": "solo-layout", "content": [
                {"type": "staff", "sources": [{"part": "solo"}]}
            ]}],
            "scores": [{"name": "Solo", "layout": "solo-layout", "pages": [
                {"systems": [{"measure": "m0"}, {"measure": "m1"}]}
            ]}],
            "parts": [{"id": "solo", "measures": [
                {
                    "staffConfigs": [{"config": {"lines": 1}}],
                    "sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]
                },
                {"sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]}
            ]}]
        }"#,
    )
    .unwrap();
    let config = LayoutConfig::default();
    let display = layout_with_mnx_scores(&score, &config, 0);
    let lines = staff_line_segments(&display, &config);

    assert_eq!(display.measure_bounds.len(), 2);
    assert_ne!(
        display.measure_bounds[0].system_index,
        display.measure_bounds[1].system_index
    );
    assert_eq!(
        lines.len(),
        2,
        "each explicit system should retain one line"
    );
    for bounds in &display.measure_bounds {
        assert!(lines
            .iter()
            .any(|(_, _, y)| (*y - (bounds.y + 2.0 * config.sp)).abs() < 0.001));
    }
}

#[test]
fn staff_targeting_works_in_grand_staff_and_full_score() {
    let score = parse_mnx(
        r#"{
            "mnx": {"version": 1},
            "global": {"measures": [{"id": "m0", "time": {"count": 4, "unit": 4}}]},
            "parts": [{"id": "piano", "name": "Piano", "staves": 2, "measures": [{
                "staffConfigs": [{"staff": 2, "config": {"lines": 1}}],
                "sequences": [
                    {"staff": 1, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}},
                    {"staff": 2, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
                ]
            }]}]
        }"#,
    )
    .unwrap();
    let config = LayoutConfig::default();

    for display in [
        layout_score(&score, 0, &config),
        layout_full_score(&score, &config),
    ] {
        let lines = staff_line_segments(&display, &config);
        assert_eq!(
            lines.len(),
            6,
            "staff 1 should have five lines; staff 2 one"
        );
        let mut bounds: Vec<_> = display.measure_bounds.iter().collect();
        bounds.sort_by_key(|bound| bound.staff_index);
        assert_eq!(bounds.len(), 2);
        let upper_count = lines
            .iter()
            .filter(|(_, _, y)| {
                *y >= bounds[0].y - 0.001 && *y <= bounds[0].y + 4.0 * config.sp + 0.001
            })
            .count();
        let lower_count = lines
            .iter()
            .filter(|(_, _, y)| (*y - (bounds[1].y + 2.0 * config.sp)).abs() < 0.001)
            .count();
        assert_eq!(upper_count, 5);
        assert_eq!(lower_count, 1);
    }
}

#[test]
fn automatic_mnx_flow_preserves_staff_config_and_cache_identity() {
    let make_score = |lines: u32| {
        parse_mnx(&format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [
                    {{"id": "m0", "time": {{"count": 4, "unit": 4}}}},
                    {{"id": "m1"}}
                ]}},
                "layouts": [{{"id": "solo-layout", "content": [
                    {{"type": "staff", "sources": [{{"part": "solo"}}]}}
                ]}}],
                "scores": [{{"name": "Solo", "layout": "solo-layout"}}],
                "parts": [{{"id": "solo", "measures": [
                    {{
                        "staffConfigs": [{{"config": {{"lines": {lines}}}}}],
                        "sequences": [{{"content": [], "fullMeasure": {{"visualDuration": {{"base": "whole"}}}}}}]
                    }},
                    {{"sequences": [{{"content": [], "fullMeasure": {{"visualDuration": {{"base": "whole"}}}}}}]}}
                ]}}]
            }}"#
        ))
        .unwrap()
    };
    let config = LayoutConfig::default();
    let one_line_score = make_score(1);
    let display = layout_with_mnx_scores(&one_line_score, &config, 0);
    assert_eq!(staff_line_segments(&display, &config).len(), 1);

    let three_line_score = make_score(3);
    let one_line_resolved = resolve_measures(&one_line_score, 0);
    let three_line_resolved = resolve_measures(&three_line_score, 0);
    assert_ne!(
        measure_content_hash(&one_line_resolved[1]),
        measure_content_hash(&three_line_resolved[1]),
        "inherited line state must participate in the measure cache key"
    );
}

#[test]
fn staff_config_change_splits_multimeasure_rest() {
    let score = parse_mnx(
        r#"{
            "mnx": {"version": 1},
            "global": {"measures": [
                {"id": "m0", "time": {"count": 4, "unit": 4}},
                {"id": "m1"},
                {"id": "m2"},
                {"id": "m3"},
                {"id": "m4"}
            ]},
            "parts": [{"id": "solo", "measures": [
                {"sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]},
                {"sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]},
                {
                    "staffConfigs": [{"config": {"lines": 1}}],
                    "sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]
                },
                {"sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]},
                {"sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]}
            ]}]
        }"#,
    )
    .unwrap();
    let resolved = resolve_measures(&score, 0);
    assert_eq!(
        detect_multimeasure_rest_groups(&resolved),
        vec![(0, 2), (3, 2)],
        "the config measure must be isolated from rests on both sides"
    );
    let config = LayoutConfig {
        multimeasure_rests: true,
        ..LayoutConfig::default()
    };
    let display = layout_score(&score, 0, &config);
    let visible: Vec<_> = display
        .measure_bounds
        .iter()
        .map(|bounds| bounds.index)
        .collect();
    assert_eq!(visible, vec![0, 2, 3]);
}

#[test]
fn targeted_staff_config_splits_authored_multimeasure_rest() {
    let score = parse_mnx(
        r#"{
            "mnx": {"version": 1},
            "global": {"measures": [
                {"id": "m0", "time": {"count": 4, "unit": 4}},
                {"id": "m1"},
                {"id": "m2"},
                {"id": "m3"},
                {"id": "m4"}
            ]},
            "layouts": [{"id": "piano-layout", "content": [{
                "type": "group",
                "symbol": "brace",
                "content": [
                    {"type": "staff", "sources": [{"part": "piano", "staff": 1}]},
                    {"type": "staff", "sources": [{"part": "piano", "staff": 2}]}
                ]
            }]}],
            "scores": [{
                "name": "Piano",
                "layout": "piano-layout",
                "multimeasureRests": [{"start": "m0", "duration": 5}]
            }],
            "parts": [{"id": "piano", "staves": 2, "measures": [
                {"sequences": [
                    {"staff": 1, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}},
                    {"staff": 2, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
                ]},
                {"sequences": [
                    {"staff": 1, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}},
                    {"staff": 2, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
                ]},
                {
                    "staffConfigs": [{"staff": 2, "config": {"lines": 1}}],
                    "sequences": [
                        {"staff": 1, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}},
                        {"staff": 2, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
                    ]
                },
                {"sequences": [
                    {"staff": 1, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}},
                    {"staff": 2, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
                ]},
                {"sequences": [
                    {"staff": 1, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}},
                    {"staff": 2, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
                ]}
            ]}]
        }"#,
    )
    .unwrap();
    let display = layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
    let visible: std::collections::BTreeSet<_> = display
        .measure_bounds
        .iter()
        .map(|bounds| bounds.index)
        .collect();
    assert_eq!(
        visible,
        [0, 2, 3].into_iter().collect(),
        "a staff-2 config measure must be isolated from an authored rest"
    );
}

#[test]
fn explicit_system_backfills_staff_lines_before_its_first_measure() {
    let score = parse_mnx(
        r#"{
            "mnx": {"version": 1},
            "global": {"measures": [
                {"id": "m0", "time": {"count": 4, "unit": 4}},
                {"id": "m1"},
                {"id": "m2"}
            ]},
            "layouts": [{"id": "solo-layout", "content": [
                {"type": "staff", "sources": [{"part": "solo"}]}
            ]}],
            "scores": [{"name": "Excerpt", "layout": "solo-layout", "pages": [
                {"systems": [{"measure": "m2"}]}
            ]}],
            "parts": [{"id": "solo", "measures": [
                {
                    "staffConfigs": [{"config": {"lines": 1}}],
                    "sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]
                },
                {"sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]},
                {"sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]}
            ]}]
        }"#,
    )
    .unwrap();
    let config = LayoutConfig::default();
    let display = layout_with_mnx_scores(&score, &config, 0);

    assert_eq!(display.measure_bounds.len(), 1);
    assert_eq!(display.measure_bounds[0].index, 2);
    assert_eq!(
        staff_line_segments(&display, &config).len(),
        1,
        "an unseen explicit staff must inherit prior staffConfigs"
    );
}

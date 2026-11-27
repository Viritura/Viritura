// Tests for GlobalMeasure number property (MNX measure-number)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::parse::parse_mnx;
use crate::render::*;
use serde_json::{json, Value};

fn bar_number_fixture(count: usize) -> Value {
    let globals: Vec<_> = (0..count)
        .map(|index| {
            if index == 0 {
                json!({"id": "m0", "time": {"count": 4, "unit": 4}})
            } else {
                json!({"id": format!("m{index}")})
            }
        })
        .collect();
    let piano: Vec<_> = (0..count).map(|index| {
        let mut measure = json!({"sequences": [
            {"staff": 1, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
            {"staff": 2, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
        ]});
        if index == 0 {
            measure["clefs"] = json!([
                {"staff": 1, "clef": {"sign": "G", "staffPosition": -2}},
                {"staff": 2, "clef": {"sign": "F", "staffPosition": 2}}
            ]);
        }
        measure
    }).collect();
    let violin: Vec<_> = (0..count).map(|_| json!({"sequences": [
        {"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}]}
    ]})).collect();
    json!({
        "mnx": {"version": 1},
        "global": {"measures": globals},
        "parts": [
            {"id": "piano", "name": "Piano", "staves": 2, "measures": piano},
            {"id": "violin", "name": "Violin", "measures": violin}
        ],
        "layouts": [{"id": "L", "content": [
            {"type": "group", "symbol": "brace", "content": [
                {"type": "staff", "sources": [{"part": "piano", "staff": 1}]},
                {"type": "staff", "sources": [{"part": "piano", "staff": 2}]}
            ]},
            {"type": "staff", "sources": [{"part": "violin"}]}
        ]}],
        "scores": [{"name": "Score", "layout": "L"}, {"name": "Alternative", "layout": "L"}]
    })
}

fn bar_number_texts(dl: &DisplayList) -> Vec<&str> {
    dl.commands
        .iter()
        .zip(&dl.element_ids)
        .filter_map(|(command, id)| match command {
            RenderCommand::DrawText { text, .. }
                if id.as_deref().is_some_and(|id| id.ends_with("/mnum")) =>
            {
                Some(text.as_str())
            }
            _ => None,
        })
        .collect()
}

#[test]
fn bar_number_alignment_and_distance_use_full_measure_geometry() {
    use crate::model::{BarNumberFrequency, BarNumberHorizontalAlignment, BarNumberPlacement};
    let score = parse_mnx(&bar_number_fixture(2).to_string()).unwrap();
    let resolved = resolve_measures(&score, 1);
    let mut config = LayoutConfig::default();
    config.bar_numbers.frequency = Some(BarNumberFrequency::EveryBar);
    config.bar_numbers.distance = Some(3.25);
    let mut measure = layout_measure(
        &resolved[1],
        config.sp,
        100.0,
        &config,
        Some(300.0),
        &[],
        1.0,
    );
    for mmr in [None, Some(4)] {
        measure.multimeasure_rest_count = mmr;
        for (alignment, x, align) in [
            (
                BarNumberHorizontalAlignment::Barline,
                measure.x,
                TextAlign::Left,
            ),
            (
                BarNumberHorizontalAlignment::Center,
                measure.x + measure.width * 0.5,
                TextAlign::Center,
            ),
        ] {
            config.bar_numbers.horizontal_alignment = Some(alignment);
            for placement in [
                BarNumberPlacement::AboveSystem,
                BarNumberPlacement::BelowSystem,
            ] {
                config.bar_numbers.placement = Some(placement);
                let label = crate::layout::render_annotations::number_label(
                    &measure, 50.0, config.sp, &config,
                )
                .unwrap();
                assert!((label.x - x).abs() < 1e-6);
                assert!(matches!(
                    (&label.align, &align),
                    (TextAlign::Left, TextAlign::Left) | (TextAlign::Center, TextAlign::Center)
                ));
                let gap = if placement == BarNumberPlacement::AboveSystem {
                    50.0 - label.bbox.y - label.bbox.height
                } else {
                    label.bbox.y - 50.0 - 4.0 * config.sp
                };
                assert!((gap - 3.25 * config.sp).abs() < 1e-6);
            }
        }
    }
}

#[test]
fn barline_aligned_numbers_follow_shared_mid_system_clef_changes() {
    let mut source = bar_number_fixture(2);
    source["parts"][1]["measures"][1]["clefs"] =
        json!([{"clef": {"sign": "F", "staffPosition": 2}}]);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "frequency": "everyBar", "horizontalAlignment": "barline"
    }}});
    for on_staff in [false, true] {
        source["_x"]["viritura"]["barNumbers"]["onStaff"] = json!(on_staff);
        let score = parse_mnx(&source.to_string()).unwrap();
        let config = LayoutConfig::default();
        for display in [
            crate::layout::layout_full_score(&score, &config),
            crate::layout::layout_with_mnx_scores(&score, &config, 0),
        ] {
            let measure = display
                .measure_bounds
                .iter()
                .find(|measure| measure.index == 1 && measure.part_index == 0)
                .unwrap();
            let number_x = display
                .commands
                .iter()
                .zip(&display.element_ids)
                .find_map(|(command, id)| match command {
                    RenderCommand::DrawText { x, .. } if id.as_deref() == Some("m1/mnum") => {
                        Some(*x)
                    }
                    _ => None,
                })
                .unwrap();
            assert!((number_x - measure.x).abs() < 1e-6);
        }
    }
}

#[test]
fn default_barline_alignment_follows_shared_mid_system_clef_changes() {
    let mut source = bar_number_fixture(2);
    source["parts"][1]["measures"][1]["clefs"] =
        json!([{"clef": {"sign": "F", "staffPosition": 2}}]);
    for multiple in [false, true] {
        for on_staff in [false, true] {
            let mut settings = json!({"frequency": "everyBar", "onStaff": on_staff});
            if multiple {
                settings["placements"] = json!(["belowTopInstrument"]);
            }
            source["_x"] = json!({"viritura": {"barNumbers": settings}});
            let score = parse_mnx(&source.to_string()).unwrap();
            let config = LayoutConfig::default();
            for display in [
                crate::layout::layout_full_score(&score, &config),
                crate::layout::layout_with_mnx_scores(&score, &config, 0),
            ] {
                let measure = display
                    .measure_bounds
                    .iter()
                    .find(|measure| measure.index == 1 && measure.part_index == 0)
                    .unwrap();
                let number_x = display
                    .commands
                    .iter()
                    .zip(&display.element_ids)
                    .find_map(|(command, id)| match command {
                        RenderCommand::DrawText { x, .. }
                            if id.as_deref().is_some_and(|id| {
                                id.starts_with("m1/") && id.ends_with("/mnum")
                            }) =>
                        {
                            Some(*x)
                        }
                        _ => None,
                    })
                    .unwrap();
                assert!(
                    (number_x - measure.x).abs() < 1e-6,
                    "default barline alignment must follow the visible barline"
                );
            }
        }
    }
}

#[test]
fn paginated_numbers_clear_the_bottom_instrument() {
    let mut source = bar_number_fixture(4);
    source["global"]["measures"][0]["tempos"] = json!([{"bpm": 120, "value": {"base": "quarter"}}]);
    for multiple in [false, true] {
        let mut settings = json!({
            "frequency": "everyBar", "showFirst": true, "size": 8, "enclosure": "circle"
        });
        if multiple {
            settings["placements"] = json!(["belowTopInstrument"]);
        }
        source["_x"] = json!({"viritura": {"barNumbers": settings}});
        let score = parse_mnx(&source.to_string()).unwrap();
        let config = LayoutConfig {
            page_width: Some(450.0),
            ..LayoutConfig::default()
        };
        let display = crate::layout::layout_full_score(&score, &config);
        for measure in display
            .measure_bounds
            .iter()
            .filter(|measure| measure.part_index == 1)
        {
            let number = display
                .element_bboxes
                .iter()
                .find(|element| {
                    element
                        .element_id
                        .starts_with(&format!("m{}/", measure.index))
                        && element.element_id.ends_with("/mnum")
                })
                .unwrap();
            assert!(
                number.bbox.y > measure.y + measure.height,
                "number {:?} must clear the bottom staff at {}",
                number.bbox,
                measure.y
            );
        }
        let number = display
            .element_bboxes
            .iter()
            .find(|element| {
                element.element_id.starts_with("m0/") && element.element_id.ends_with("/mnum")
            })
            .unwrap();
        let upper_bottom = display
            .measure_bounds
            .iter()
            .filter(|measure| measure.part_index == 0 && measure.index == 0)
            .map(|measure| measure.y + measure.height)
            .fold(0.0_f64, f64::max);
        let lower_tempos: Vec<_> = display
            .commands
            .iter()
            .zip(&display.element_ids)
            .filter(|(_, id)| id.as_deref().is_some_and(|id| id.contains("/tempo")))
            .filter_map(|(command, _)| crate::layout::page::vertical_ink_extent(command))
            .filter(|(top, _)| *top > upper_bottom)
            .collect();
        assert!(
            !lower_tempos.is_empty(),
            "missing following instrument tempo"
        );
        assert!(
            lower_tempos
                .iter()
                .all(|(_, bottom)| *bottom < number.bbox.y),
            "bottom instrument markings must clear number {:?}: {lower_tempos:?}",
            number.bbox
        );
    }
}

#[test]
fn styled_mnx_numbers_clear_bottom_instrument_expressions() {
    let mut source = bar_number_fixture(4);
    source["global"]["measures"][0]["number"] = json!(2);
    source["parts"][1]["measures"][0]["text"] = json!([{
        "type": "expression", "text": [{"text": "arco"}],
        "position": {"fraction": [0, 1]}, "placement": "below"
    }]);
    source["_x"] = json!({"viritura": {"barNumbers": {"size": 8, "enclosure": "circle"}}});
    let score = parse_mnx(&source.to_string()).unwrap();

    for page_width in [None, Some(450.0)] {
        let config = LayoutConfig {
            page_width,
            ..LayoutConfig::default()
        };
        let display = crate::layout::layout_with_mnx_scores(&score, &config, 0);
        let number = display
            .element_bboxes
            .iter()
            .find(|element| element.element_id == "m0/mnum")
            .unwrap();
        let lower_staff = display
            .measure_bounds
            .iter()
            .find(|measure| measure.part_index == 1 && measure.index == 0)
            .unwrap();
        assert!(
            number.bbox.y > lower_staff.y + lower_staff.height,
            "number {:?} must clear the bottom staff at {} for {page_width:?}",
            number.bbox,
            lower_staff.y
        );
        let expression_bottom = display
            .commands
            .iter()
            .find(
                |command| matches!(command, RenderCommand::DrawText { text, .. } if text == "arco"),
            )
            .and_then(crate::layout::page::vertical_ink_extent)
            .map(|(_, bottom)| bottom)
            .unwrap();
        assert!(
            expression_bottom < number.bbox.y,
            "bottom instrument expression at {expression_bottom} must clear number {:?}",
            number.bbox
        );
    }
}

#[test]
fn bar_number_role_and_score_view_style_merge() {
    let mut source = bar_number_fixture(2);
    source["_x"] = json!({"viritura": {
        "textStyles": {"barNumber": {"size": 3.0, "family": "sans-serif", "italic": false}},
        "barNumbers": {"frequency": "everyBar", "showFirst": true}
    }});
    source["scores"][1]["_x"] = json!({"viritura": {
        "barNumbers": {"style": {"size": 4.0, "bold": true}}
    }});
    let score = parse_mnx(&source.to_string()).unwrap();
    let config = LayoutConfig::default();

    for (score_index, expected_size, expected_font) in
        [(0, 3.0, "sans-serif"), (1, 4.0, "sans-serif bold")]
    {
        let display = crate::layout::layout_with_mnx_scores(&score, &config, score_index);
        let (font, size) = display
            .commands
            .iter()
            .zip(&display.element_ids)
            .find_map(|(command, id)| match command {
                RenderCommand::DrawText { font, size, .. }
                    if id.as_deref().is_some_and(|id| id.ends_with("/mnum")) =>
                {
                    Some((font.as_str(), *size))
                }
                _ => None,
            })
            .expect("first bar number is visible");
        assert_eq!(font, expected_font);
        assert!((size - expected_size * config.sp).abs() < 1e-6);
    }
}

#[test]
fn hidden_mnx_numbers_do_not_reserve_staff_space() {
    let mut source = bar_number_fixture(4);
    for page_width in [None, Some(450.0)] {
        let config = LayoutConfig {
            page_width,
            ..LayoutConfig::default()
        };
        source["_x"] = json!({"viritura": {"barNumbers": {"frequency": "hidden"}}});
        let hidden = parse_mnx(&source.to_string()).unwrap();
        let hidden = crate::layout::layout_with_mnx_scores(&hidden, &config, 0);
        source["_x"] = json!({"viritura": {"barNumbers": {
            "frequency": "hidden", "onStaff": true, "distance": 8, "size": 8,
            "enclosure": "circle", "placements": ["belowTopInstrument"]
        }}});
        let styled = parse_mnx(&source.to_string()).unwrap();
        let styled = crate::layout::layout_with_mnx_scores(&styled, &config, 0);
        assert!(bar_number_texts(&styled).is_empty());
        let staff_positions = |display: &DisplayList| {
            display
                .measure_bounds
                .iter()
                .map(|measure| (measure.part_index, measure.index, measure.y))
                .collect::<Vec<_>>()
        };
        assert_eq!(staff_positions(&styled), staff_positions(&hidden));
    }
}

#[test]
fn mnx_placement_only_numbers_stay_inside_the_galley() {
    let mut source = bar_number_fixture(4);
    source["global"]["measures"][0]["number"] = json!(2);
    for placement in ["aboveSystem", "belowSystem"] {
        source["_x"] = json!({"viritura": {"barNumbers": {"placement": placement}}});
        let score = parse_mnx(&source.to_string()).unwrap();
        let display = crate::layout::layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
        let number = display
            .element_bboxes
            .iter()
            .find(|element| element.element_id == "m0/mnum")
            .unwrap();
        assert!(
            number.bbox.y >= 0.0 && number.bbox.y + number.bbox.height <= display.height,
            "{placement} number {:?} must be inside height {}",
            number.bbox,
            display.height
        );
    }
}

#[test]
fn multiple_bar_number_locations_reserve_independent_rows() {
    let mut source = bar_number_fixture(4);
    source["layouts"][0]["content"] = json!([
        {"type": "group", "symbol": "bracket", "label": "Winds", "content": [
            {"type": "staff", "sources": [{"part": "violin"}]}
        ]},
        {"type": "group", "symbol": "bracket", "label": "Strings", "content": [
            {"type": "group", "symbol": "brace", "content": [
                {"type": "staff", "sources": [{"part": "piano", "staff": 1}]},
                {"type": "staff", "sources": [{"part": "piano", "staff": 2}]}
            ]}
        ]}
    ]);
    source["global"]["measures"][0]["tempos"] = json!([{"bpm": 120, "value": {"base": "quarter"}}]);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "placements": ["aboveSystem", "belowSystem"], "frequency": "everyBar", "showFirst": true,
        "onStaff": true, "showStaffLine": false, "distance": 2, "size": 4
    }}});
    source["scores"][0]["_x"] =
        json!({"viritura": {"barNumbers": {"aboveGroups": [["violin"], ["piano"]]}}});
    for page_width in [None, Some(650.0)] {
        let config = LayoutConfig {
            page_width,
            ..LayoutConfig::default()
        };
        let score = parse_mnx(&source.to_string()).unwrap();
        let display = crate::layout::layout_with_mnx_scores(&score, &config, 0);
        assert_eq!(
            bar_number_texts(&display).len(),
            12,
            "coincident system/group targets must not duplicate numbers"
        );
        let row = display
            .element_bboxes
            .iter()
            .find(|element| element.element_id == "m0/bn1-above/bar-number-staff")
            .unwrap();
        let upper = display
            .measure_bounds
            .iter()
            .find(|measure| measure.index == 0 && measure.staff_index == 0)
            .unwrap();
        let lower = display
            .measure_bounds
            .iter()
            .find(|measure| measure.index == 0 && measure.staff_index == 1)
            .unwrap();
        assert!(row.bbox.y > upper.y + upper.height);
        assert!(row.bbox.y + row.bbox.height < lower.y);
        assert!(display
            .element_bboxes
            .iter()
            .filter(|element| element.element_id.ends_with("/bar-number-staff"))
            .all(|element| element.bbox.y >= 0.0
                && element.bbox.y + element.bbox.height <= display.height));
        assert!(
            !display
                .element_ids
                .iter()
                .flatten()
                .any(|id| id.ends_with("/bar-number-staff")),
            "hidden lines must emit no drawing commands"
        );
        assert_eq!(
            crate::layout::layout_with_mnx_scores(&score, &config, 1)
                .element_bboxes
                .iter()
                .filter(|element| element.element_id.contains("/bn1-above/")
                    && element.element_id.ends_with("/mnum"))
                .count(),
            0
        );
        source["_x"]["viritura"]["barNumbers"]["showStaffLine"] = json!(true);
        let lined = crate::layout::layout_with_mnx_scores(
            &parse_mnx(&source.to_string()).unwrap(),
            &config,
            0,
        );
        assert!(lined
            .element_ids
            .iter()
            .flatten()
            .any(|id| id.ends_with("/bar-number-staff")));
        for original in display
            .element_bboxes
            .iter()
            .filter(|element| element.element_id.ends_with("/bar-number-staff"))
        {
            let visible = lined
                .element_bboxes
                .iter()
                .find(|element| element.element_id == original.element_id)
                .unwrap();
            assert_eq!(
                original.bbox, visible.bbox,
                "line visibility must not change row justification"
            );
        }
        source["_x"]["viritura"]["barNumbers"]["showStaffLine"] = json!(false);
    }
    source["_x"]["viritura"]["barNumbers"]["onStaff"] = json!(false);
    source["_x"]["viritura"]["barNumbers"]["distance"] = json!(0);
    let content = crate::layout::layout_with_mnx_scores(
        &parse_mnx(&source.to_string()).unwrap(),
        &LayoutConfig::default(),
        0,
    );
    assert!(!content
        .element_bboxes
        .iter()
        .any(|element| element.element_id.ends_with("/bar-number-staff")));
    let first = content
        .element_bboxes
        .iter()
        .find(|element| element.element_id == "m0/bn1-above/mnum")
        .unwrap();
    let second = content
        .element_bboxes
        .iter()
        .find(|element| element.element_id == "m1/bn1-above/mnum")
        .unwrap();
    assert!(
        (first.bbox.y - second.bbox.y).abs() > 1e-6,
        "content-following numbers must clear local markings independently: first={}, second={}",
        first.bbox.y,
        second.bbox.y
    );
}

#[test]
fn overlapping_brackets_keep_number_selection_when_members_are_hidden() {
    let mut source = bar_number_fixture(2);
    source["layouts"][0]["content"] = json!([
        {"type": "group", "symbol": "bracket", "label": "Piano", "content": [
            {"type": "staff", "sources": [{"part": "piano", "staff": 1}]}
        ]},
        {"type": "group", "symbol": "bracket", "label": "Combined", "content": [
            {"type": "staff", "sources": [{"part": "piano", "staff": 2}]},
            {"type": "staff", "sources": [{"part": "violin"}]}
        ]}
    ]);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "frequency": "everyBar", "showFirst": true, "placements": []
    }}});
    source["scores"][0]["_x"] = json!({"viritura": {
        "barNumbers": {"aboveGroups": [["piano", "violin"]]}
    }});
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let mut cache = crate::layout::cache::LayoutCache::new();

    for (hide_violin, keep_visible) in [(false, false), (true, false), (true, true)] {
        if hide_violin {
            source["scores"][0]["_x"]["viritura"]["autoHideEmptyParts"] = json!(["violin"]);
            for measure in source["parts"][1]["measures"].as_array_mut().unwrap() {
                measure["sequences"][0]["content"] =
                    json!([{"duration": {"base": "whole"}, "rest": {}}]);
            }
        }
        if keep_visible {
            source["scores"][0]["_x"]["viritura"]["autoHideEmptyStaves"] =
                json!({"keepVisible": [{"measure": "m0", "parts": ["violin"]}]});
        }
        let score = parse_mnx(&source.to_string()).unwrap();
        for display in [
            crate::layout::layout_with_mnx_scores(&score, &config, 0),
            crate::layout::layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache)),
        ] {
            let ids: Vec<_> = display
                .element_bboxes
                .iter()
                .filter(|element| {
                    element.element_id.starts_with("m0/") && element.element_id.ends_with("/mnum")
                })
                .map(|element| element.element_id.as_str())
                .collect();
            assert_eq!(
                ids,
                ["m0/bn1-above/mnum"],
                "hide violin: {hide_violin}, keep visible: {keep_visible}"
            );
            assert_eq!(
                display
                    .measure_bounds
                    .iter()
                    .any(|measure| measure.part_index == 1),
                !hide_violin || keep_visible
            );
        }
    }
}

#[test]
fn multiple_system_locations_work_in_legacy_and_horizon_views() {
    let mut source = bar_number_fixture(80);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "placements": ["aboveSystem", "belowSystem"], "frequency": "everyBar", "showFirst": true,
        "onStaff": true, "showStaffLine": false
    }}});
    let score = parse_mnx(&source.to_string()).unwrap();
    let config = LayoutConfig::default();
    for display in [
        crate::layout::layout_full_score(&score, &config),
        crate::layout::layout_with_mnx_scores(&score, &config, 0),
    ] {
        assert_eq!(bar_number_texts(&display).len(), 160);
        for key in ["bn0-above", "bn2-below"] {
            let centers: Vec<_> = display
                .element_bboxes
                .iter()
                .filter(|element| {
                    element.element_id.contains(key)
                        && element.element_id.ends_with("/bar-number-staff")
                })
                .map(|element| element.bbox.y + element.bbox.height * 0.5)
                .collect();
            assert!(!centers.is_empty());
            assert!(centers
                .iter()
                .all(|center| (*center - centers[0]).abs() < 1e-6));
        }
    }
    source["scores"][0]["_x"] = json!({"viritura": {"barNumbers": {"placement": "aboveSystem"}}});
    let legacy_override =
        crate::layout::layout_with_mnx_scores(&parse_mnx(&source.to_string()).unwrap(), &config, 0);
    assert_eq!(
        bar_number_texts(&legacy_override).len(),
        80,
        "legacy layout placement must replace inherited multi-placement"
    );
    source["scores"][0].as_object_mut().unwrap().remove("_x");
    source["_x"]["viritura"]["barNumbers"]["placements"] = json!([]);
    let hidden =
        crate::layout::layout_with_mnx_scores(&parse_mnx(&source.to_string()).unwrap(), &config, 0);
    assert!(bar_number_texts(&hidden).is_empty());
    assert!(!hidden
        .element_bboxes
        .iter()
        .any(|element| element.element_id.ends_with("/bar-number-staff")));
}

#[test]
fn invalid_bar_number_locations_are_rejected() {
    for settings in [
        json!({"placements": ["aboveSystem", "aboveSystem"]}),
        json!({"aboveGroups": [[]]}),
        json!({"aboveGroups": [["piano", "piano"]]}),
        json!({"aboveGroups": [["piano"], ["piano"]]}),
        json!({"aboveGroups": [[""]]}),
    ] {
        let mut source = bar_number_fixture(1);
        source["_x"] = json!({"viritura": {"barNumbers": settings}});
        assert!(parse_mnx(&source.to_string()).is_err());
    }
}

#[test]
fn single_line_bar_number_staff_has_one_center_and_reserves_system_space() {
    let mut source = bar_number_fixture(12);
    let config = LayoutConfig {
        page_width: Some(450.0),
        ..LayoutConfig::default()
    };
    source["_x"] = json!({"viritura": {"barNumbers": {
        "frequency": "everyBar", "showFirst": true, "onStaff": true, "distance": 3,
        "size": 4, "enclosure": "circle", "horizontalAlignment": "center"
    }}});
    let score = parse_mnx(&source.to_string()).unwrap();
    let display = crate::layout::layout_with_mnx_scores(&score, &config, 0);
    assert_eq!(bar_number_texts(&display).len(), 12);
    let rows: Vec<_> = display
        .element_bboxes
        .iter()
        .filter(|element| element.element_id.ends_with("/bar-number-staff"))
        .collect();
    assert!(rows.len() > 1);
    for row in rows {
        let center = row.bbox.y + row.bbox.height * 0.5;
        let bounds = display
            .measure_bounds
            .iter()
            .find(|bounds| {
                bounds.part_index == 0
                    && row.element_id == format!("m{}/bar-number-staff", bounds.index)
            })
            .unwrap();
        let system_bottom = display
            .measure_bounds
            .iter()
            .filter(|measure| measure.system_index == bounds.system_index)
            .map(|measure| measure.y + measure.height)
            .fold(0.0_f64, f64::max);
        assert!(row.bbox.y >= system_bottom + 3.0 * config.sp - 1e-6);
        for measure in display.measure_bounds.iter().filter(|measure| {
            measure.system_index == bounds.system_index && measure.part_index == 1
        }) {
            assert!(
                measure.y + measure.height < row.bbox.y,
                "number staff must sit below the whole system"
            );
            let label = display
                .element_bboxes
                .iter()
                .find(|label| label.element_id == format!("m{}/mnum", measure.index))
                .unwrap();
            assert!((label.bbox.y + label.bbox.height * 0.5 - center).abs() < 1e-6);
        }
        for (command, id) in display.commands.iter().zip(&display.element_ids) {
            if id.as_deref() == Some(&row.element_id) {
                let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = command else {
                    panic!("number staff must contain only line segments")
                };
                assert!((*y1 - center).abs() < 1e-6 && y1 == y2);
                assert!(x2 > x1);
                for label in display.element_bboxes.iter().filter(|label| {
                    label.element_id.ends_with("/mnum")
                        && (label.bbox.y + label.bbox.height * 0.5 - center).abs() < 1e-6
                }) {
                    assert!(*x2 <= label.bbox.x || *x1 >= label.bbox.x + label.bbox.width);
                }
            }
        }
        assert!(row.bbox.y + row.bbox.height <= display.height + 1e-6);
        if let Some(next_top) = display
            .measure_bounds
            .iter()
            .filter(|measure| measure.system_index == bounds.system_index + 1)
            .map(|measure| measure.y)
            .min_by(f64::total_cmp)
        {
            assert!(next_top > row.bbox.y + row.bbox.height);
        }
    }
}

#[test]
fn number_staff_is_collinear_across_horizon_chunks_and_hidden_as_a_unit() {
    let mut source = bar_number_fixture(8);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "frequency": "everyBar", "showFirst": true, "onStaff": true,
        "placement": "aboveSystem", "size": 2
    }}});
    source["global"]["measures"][3]["_x"] =
        json!({"viritura": {"rehearsalMark": {"text": [{"text": "A"}]}}});
    let score = parse_mnx(&source.to_string()).unwrap();
    let config = LayoutConfig {
        horizon_chunk_width: Some(1.0),
        ..LayoutConfig::default()
    };
    let display = crate::layout::layout_with_mnx_scores(&score, &config, 0);
    let rows: Vec<_> = display
        .element_bboxes
        .iter()
        .filter(|element| element.element_id.ends_with("/bar-number-staff"))
        .collect();
    assert!(rows.len() > 1);
    let center = rows[0].bbox.y + rows[0].bbox.height * 0.5;
    for row in rows {
        assert!((row.bbox.y + row.bbox.height * 0.5 - center).abs() < 1e-6);
        assert!(row.bbox.y >= -1e-6);
    }

    source["_x"]["viritura"]["barNumbers"]["frequency"] = json!("hidden");
    let display =
        crate::layout::layout_with_mnx_scores(&parse_mnx(&source.to_string()).unwrap(), &config, 0);
    assert!(bar_number_texts(&display).is_empty());
    assert!(!display
        .element_bboxes
        .iter()
        .any(|element| element.element_id.ends_with("/bar-number-staff")));
}

#[test]
fn configured_distance_reserves_space_even_without_the_number_staff() {
    let mut source = bar_number_fixture(4);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "frequency": "everyBar", "showFirst": true, "distance": 8
    }}});
    let score = parse_mnx(&source.to_string()).unwrap();
    for page_width in [None, Some(450.0)] {
        let config = LayoutConfig {
            page_width,
            horizon_chunk_width: Some(1.0),
            ..LayoutConfig::default()
        };
        let display = crate::layout::layout_with_mnx_scores(&score, &config, 0);
        for measure in display
            .measure_bounds
            .iter()
            .filter(|measure| measure.part_index == 1)
        {
            let number = display
                .element_bboxes
                .iter()
                .find(|element| element.element_id == format!("m{}/mnum", measure.index))
                .unwrap();
            assert!(number.bbox.y >= measure.y + measure.height + 8.0 * config.sp - 1e-6);
        }
    }
}

#[test]
fn number_staff_clears_markings_on_the_bottom_instrument() {
    let mut source = bar_number_fixture(2);
    source["global"]["measures"][0]["tempos"] = json!([{"bpm": 120, "value": {"base": "quarter"}}]);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "frequency": "everyBar", "showFirst": true, "onStaff": true, "distance": 2,
        "size": 4, "enclosure": "circle"
    }}});
    let score = parse_mnx(&source.to_string()).unwrap();
    for page_width in [None, Some(450.0)] {
        let config = LayoutConfig {
            page_width,
            ..LayoutConfig::default()
        };
        let display = crate::layout::layout_full_score(&score, &config);
        let row = display
            .element_bboxes
            .iter()
            .find(|element| element.element_id.ends_with("/bar-number-staff"))
            .unwrap();
        let upper_bottom = display
            .measure_bounds
            .iter()
            .filter(|measure| measure.part_index == 0 && measure.index == 0)
            .map(|measure| measure.y + measure.height)
            .fold(0.0_f64, f64::max);
        let lower_tempos: Vec<_> = display
            .commands
            .iter()
            .zip(&display.element_ids)
            .filter(|(_, id)| id.as_deref().is_some_and(|id| id.contains("/tempo")))
            .filter_map(|(command, _)| crate::layout::page::vertical_ink_extent(command))
            .filter(|(top, _)| *top > upper_bottom)
            .collect();
        assert!(
            !lower_tempos.is_empty(),
            "missing lower tempo for {page_width:?}"
        );
        for (_, bottom) in lower_tempos {
            assert!(
                bottom < row.bbox.y,
                "bottom instrument marking at {bottom} must clear row {:?} for {page_width:?}",
                row.bbox
            );
        }
    }
}

#[test]
fn bar_number_layout_overrides_inherit_house_style_without_affecting_other_views() {
    let mut source = bar_number_fixture(4);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "frequency": "everyBar", "showFirst": true, "family": "sans-serif", "bold": true
    }}});
    source["scores"][1]["_x"] = json!({"viritura": {"barNumbers": {
        "showFirst": false, "italic": false, "size": 1.5, "enclosure": "circle"
    }}});
    let score = parse_mnx(&source.to_string()).unwrap();
    let config = LayoutConfig::default();
    let default = crate::layout::layout_with_mnx_scores(&score, &config, 0);
    assert_eq!(bar_number_texts(&default), ["1", "2", "3", "4"]);
    let alternative = crate::layout::layout_with_mnx_scores(&score, &config, 1);
    assert_eq!(bar_number_texts(&alternative), ["2", "3", "4"]);
    for (command, id) in alternative.commands.iter().zip(&alternative.element_ids) {
        if id.as_deref().is_some_and(|id| id.ends_with("/mnum")) {
            if let RenderCommand::DrawText { font, size, .. } = command {
                assert_eq!(font, "sans-serif bold");
                assert_eq!(*size, 1.5 * config.sp);
            }
        }
    }
    assert_eq!(alternative.commands.iter().filter(|command|
        matches!(command, RenderCommand::DrawEllipse { filled: false, rx, ry, .. } if rx == ry)
    ).count(), 3);
    source["scores"][1]["_x"]["viritura"]["barNumbers"]["frequency"] = json!("hidden");
    let score = parse_mnx(&source.to_string()).unwrap();
    assert!(
        bar_number_texts(&crate::layout::layout_with_mnx_scores(&score, &config, 1)).is_empty()
    );
    source["layouts"] = json!([]);
    for parts in [2, 1] {
        source["parts"].as_array_mut().unwrap().truncate(parts);
        let score = parse_mnx(&source.to_string()).unwrap();
        assert!(
            bar_number_texts(&crate::layout::layout_with_mnx_scores(&score, &config, 1)).is_empty(),
            "fallback layouts must retain view overrides"
        );
    }
}

#[test]
fn every_bar_numbers_follow_configured_staff_across_systems() {
    let mut source = bar_number_fixture(12);
    for placement in [None, Some("belowSystem"), Some("belowTopInstrument")] {
        let mut settings = json!({
            "frequency": "everyBar", "showFirst": true, "enclosure": "box"
        });
        if let Some(placement) = placement {
            settings["placement"] = json!(placement);
        }
        source["_x"] = json!({"viritura": {"barNumbers": settings}});
        let score = parse_mnx(&source.to_string()).unwrap();
        let config = LayoutConfig {
            page_width: Some(450.0),
            ..LayoutConfig::default()
        };
        let dl = crate::layout::layout_with_mnx_scores(&score, &config, 0);
        assert!(dl
            .measure_bounds
            .iter()
            .any(|bounds| bounds.system_index > 0));
        assert_eq!(bar_number_texts(&dl).len(), 12);
        for index in 0..12 {
            let number = &dl
                .element_bboxes
                .iter()
                .find(|bbox| bbox.element_id == format!("m{index}/mnum"))
                .unwrap()
                .bbox;
            let bottom = dl
                .measure_bounds
                .iter()
                .filter(|bounds| bounds.index == index)
                .map(|bounds| bounds.y + 4.0 * config.sp)
                .max_by(f64::total_cmp)
                .unwrap();
            assert!(
                number.y > bottom,
                "bar {index} must be below the configured instrument/system"
            );
        }
    }
}

#[test]
fn multimeasure_rest_ranges_follow_bar_number_style_and_visibility() {
    let mut source = bar_number_fixture(4);
    for part in source["parts"].as_array_mut().unwrap() {
        for measure in part["measures"].as_array_mut().unwrap() {
            for sequence in measure["sequences"].as_array_mut().unwrap() {
                sequence["content"] = json!([{"duration": {"base": "whole"}, "rest": {}}]);
            }
        }
    }
    source["scores"][0]["multimeasureRests"] = json!([{"start": "m0", "duration": 4}]);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "placement": "belowSystem", "enclosure": "box"
    }}});
    let config = LayoutConfig::default();
    let score = parse_mnx(&source.to_string()).unwrap();
    let display = crate::layout::layout_with_mnx_scores(&score, &config, 0);
    assert_eq!(bar_number_texts(&display), ["1\u{2013}4"]);
    assert_eq!(
        display
            .element_bboxes
            .iter()
            .filter(|region| region.element_id == "m0/mnum")
            .count(),
        1
    );
    source["_x"]["viritura"]["barNumbers"]["frequency"] = json!("hidden");
    let score = parse_mnx(&source.to_string()).unwrap();
    assert!(
        bar_number_texts(&crate::layout::layout_with_mnx_scores(&score, &config, 0)).is_empty()
    );
}

#[test]
fn above_bar_numbers_clear_clef_and_rehearsal_frames() {
    let mut source = bar_number_fixture(2);
    source["_x"] = json!({"viritura": {"barNumbers": {
        "frequency": "everyBar", "showFirst": true, "placement": "aboveSystem", "enclosure": "box"
    }}});
    source["global"]["measures"][0]["_x"] =
        json!({"viritura": {"rehearsalMark": {"text": [{"text": "A"}]}}});
    let score = parse_mnx(&source.to_string()).unwrap();
    let config = LayoutConfig::default();
    let dl = crate::layout::layout_with_mnx_scores(&score, &config, 0);
    let number = &dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == "m0/mnum")
        .unwrap()
        .bbox;
    let rehearsal = &dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == "m0/rehearsal")
        .unwrap()
        .bbox;
    assert!(
        number.y + number.height < rehearsal.y,
        "bar number must clear the rehearsal frame"
    );
    for command in &dl.commands {
        if let RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            size,
            ..
        } = command
        {
            let bounds =
                crate::layout::render_annotations::glyph_screen_bbox(*x, *y, *codepoint, *size);
            if bounds.right > number.x && bounds.left < number.x + number.width {
                assert!(
                    number.y + number.height < bounds.top,
                    "bar number must clear overlapping glyph ink"
                );
            }
        }
    }
}

#[test]
fn every_bar_keeps_pickup_zero_unprinted() {
    let mut source = bar_number_fixture(3);
    source["global"]["measures"][0]["number"] = json!(0);
    source["global"]["measures"][1]["number"] = json!(1);
    source["global"]["measures"][2]["number"] = json!(2);
    source["_x"] =
        json!({"viritura": {"barNumbers": {"frequency": "everyBar", "showFirst": true}}});
    let score = parse_mnx(&source.to_string()).unwrap();
    assert_eq!(
        bar_number_texts(&crate::layout::layout_with_mnx_scores(
            &score,
            &LayoutConfig::default(),
            0
        )),
        ["1", "2"]
    );
}

#[test]
fn bar_number_placement_and_hit_regions_work_in_legacy_single_and_grand_staff_views() {
    let mut source = bar_number_fixture(4);
    for placement in ["aboveSystem", "belowSystem"] {
        source["_x"] = json!({"viritura": {"barNumbers": {
            "frequency": "everyBar", "showFirst": true, "placement": placement,
            "size": 3.0, "enclosure": "circle"
        }}});
        source["global"]["measures"][0]["_x"] =
            json!({"viritura": {"rehearsalMark": {"text": [{"text": "A"}]}}});
        let score = parse_mnx(&source.to_string()).unwrap();
        let config = LayoutConfig::default();
        let displays = [
            layout_score(&score, 0, &config),
            layout_score(&score, 1, &config),
            crate::layout::layout_full_score(&score, &config),
        ];
        for (path, display) in displays.into_iter().enumerate() {
            assert_eq!(bar_number_texts(&display).len(), 4);
            for index in 0..4 {
                let regions: Vec<_> = display
                    .element_bboxes
                    .iter()
                    .filter(|element| element.element_id == format!("m{index}/mnum"))
                    .collect();
                assert_eq!(
                    regions.len(),
                    1,
                    "each painted number needs exactly one hit region"
                );
                let region = &regions[0].bbox;
                assert!(
                    region.y >= -1e-6 && region.y + region.height <= display.height + 1e-6,
                    "bar-number ink must stay inside the galley: placement={placement}, path={path}, bar={index}, bbox={region:?}, height={}",
                    display.height
                );
                let outer = display
                    .measure_bounds
                    .iter()
                    .filter(|bounds| bounds.index == index)
                    .map(|bounds| bounds.y)
                    .reduce(|left, right| {
                        if placement == "aboveSystem" {
                            left.min(right)
                        } else {
                            left.max(right)
                        }
                    })
                    .unwrap();
                if placement == "aboveSystem" {
                    assert!(region.y + region.height < outer);
                } else {
                    assert!(region.y > outer + 4.0 * config.sp);
                }
            }
        }
    }
}

// ================================================
// Measure numbers — parsing
// ================================================

#[test]
fn test_measure_number_parse() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"number": 0, "time": {"count": 4, "unit": 4}},
            {"number": 1},
            {"number": 2},
            {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();

    assert_eq!(score.global.measures[0].number, Some(0));
    assert_eq!(score.global.measures[1].number, Some(1));
    assert_eq!(score.global.measures[2].number, Some(2));
    assert_eq!(score.global.measures[3].number, None);
}

#[test]
fn test_measure_number_absent_is_none() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    assert_eq!(score.global.measures[0].number, None);
}

// ================================================
// Measure numbers — rendering
// ================================================

#[test]
fn test_measure_number_renders_text() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"number": 5, "time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Should have a text command with "5" in serif font
    let num_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawText { text, font, .. }
            if text == "5" && font.starts_with("serif"))
        })
        .collect();
    assert_eq!(
        num_texts.len(),
        1,
        "Expected 1 measure number text '5', got {}",
        num_texts.len()
    );

    if let RenderCommand::DrawText { y, .. } = num_texts[0] {
        assert!(*y > staff_y, "Measure number should be below the staff");
    }
}

#[test]
fn test_measure_number_not_rendered_when_absent() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // No serif (non-bold) text that looks like a number should be present
    // (other text like tempo markings use "serif bold")
    let num_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawText { font, text, .. }
            if font.starts_with("serif") && text.parse::<i32>().is_ok())
        })
        .collect();
    assert!(
        num_texts.is_empty(),
        "No measure number should be rendered when number is absent"
    );
}

#[test]
fn test_measure_number_zero_not_rendered() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"number": 0, "time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let num_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawText { font, text, .. }
            if font.starts_with("serif") && text.parse::<i32>().is_ok())
        })
        .collect();
    assert!(
        num_texts.is_empty(),
        "Measure number 0 should not be rendered"
    );
}

#[test]
fn test_measure_number_from_mnx_file() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/measure-numbers.mnx"
    ))
    .expect("Failed to read measure-numbers.mnx");
    let score = parse_mnx(&json).unwrap();

    assert_eq!(score.global.measures[0].number, Some(0));
    assert_eq!(score.global.measures[1].number, Some(1));
    assert_eq!(score.global.measures[2].number, Some(2));
    assert_eq!(score.global.measures[3].number, Some(3));

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // House style: bar numbers appear only at the start of each system. With
    // the default config all four bars fit on one system, whose only opening
    // is the (unnumbered) measure 0 — so no numbers render mid-system even
    // though measures 1–3 carry explicit numbers.
    let num_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawText { font, text, .. }
            if font.starts_with("serif") && text.parse::<i32>().is_ok())
        })
        .collect();
    assert!(
        num_texts.is_empty(),
        "House style suppresses mid-system numbers; expected 0 on a single system, got {}",
        num_texts.len()
    );
}

#[test]
fn test_measure_numbers_only_at_system_start() {
    // House style regression: explicit per-measure numbers must NOT render
    // mid-system. Build a long single-part score with an explicit number on
    // every bar and a narrow page so it wraps onto many systems. Under the old
    // behavior all 16 numbered bars would render; under house style only the
    // system openings do.
    let mut global = String::new();
    let mut part = String::new();
    for i in 0..16 {
        if i == 0 {
            global.push_str(r#"{"number": 1, "time": {"count": 4, "unit": 4}}"#);
            part.push_str(
                r#"{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]}"#,
            );
        } else {
            global.push_str(&format!(r#",{{"number": {}}}"#, i + 1));
            part.push_str(
                r#",{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]}"#,
            );
        }
    }
    let json = format!(
        r#"{{"mnx": {{"version": 1}}, "global": {{"measures": [{global}]}}, "parts": [{{"measures": [{part}]}}]}}"#
    );
    let score = parse_mnx(&json).unwrap();

    let config = LayoutConfig {
        page_width: Some(450.0),
        ..LayoutConfig::default()
    };
    let dl = layout_score(&score, 0, &config);

    let num_texts: Vec<String> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawText { font, text, .. }
                if font.starts_with("serif") && text.parse::<i32>().is_ok() =>
            {
                Some(text.clone())
            }
            _ => None,
        })
        .collect();

    // At least one later system-start number renders, but far fewer than all
    // 16 bars (mid-system numbers are suppressed). Measure "1" is never numbered.
    assert!(
        !num_texts.is_empty(),
        "Expected at least one system-start measure number"
    );
    assert!(
        num_texts.len() < 16,
        "Mid-system numbers must be suppressed; got {} numbers: {num_texts:?}",
        num_texts.len()
    );
    assert!(
        !num_texts.contains(&"1".to_string()),
        "Measure 1 must never be numbered; got {num_texts:?}"
    );
}

#[test]
fn test_pickup_measure_spacing_is_compact() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"number": 0, "time": {"count": 4, "unit": 4}},
            {"number": 1}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
             ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
             ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let resolved = resolve_measures(&score, 0);
    let config = LayoutConfig::default();
    let sp = config.sp;
    let start_x = config.margin_left * sp;

    let pickup = layout_measure(&resolved[0], sp, start_x, &config, None, &[], 1.0);
    let full = layout_measure(
        &resolved[1],
        sp,
        start_x + pickup.width,
        &config,
        None,
        &[],
        1.0,
    );

    let pickup_content = pickup.width - pickup.prefix_width - 1.0 * sp;
    let full_content = full.width - full.prefix_width - 1.0 * sp;
    assert!(
        pickup_content < full_content,
        "Pickup content width should be narrower (pickup={}, full={})",
        pickup_content,
        full_content
    );
}

#[test]
fn test_pickup_spacing_stays_compact_with_justification() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"number": 0, "time": {"count": 4, "unit": 4}},
            {"number": 1},
            {"number": 2}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
             ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
             ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
             ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(900.0),
        ..Default::default()
    };
    let dl = layout_score(&score, 0, &config);

    assert!(
        dl.measure_bounds.len() >= 3,
        "Expected at least 3 measure bounds"
    );

    let pickup = &dl.measure_bounds[0];
    let full = &dl.measure_bounds[1];
    let pickup_content = pickup.width - pickup.prefix_width - config.sp;
    let full_content = full.width - full.prefix_width - config.sp;

    assert!(
        pickup_content < full_content,
        "Pickup content should remain narrower under justification (pickup={}, full={})",
        pickup_content,
        full_content
    );
}

// ================================================
// Measure numbers — serialization round-trip
// ================================================

#[test]
fn test_measure_number_serialization_roundtrip() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"number": 0, "time": {"count": 4, "unit": 4}},
            {"number": 1},
            {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();

    // Serialize back to JSON
    let serialized = serde_json::to_string(&score).unwrap();
    let reparsed = parse_mnx(&serialized).unwrap();

    assert_eq!(reparsed.global.measures[0].number, Some(0));
    assert_eq!(reparsed.global.measures[1].number, Some(1));
    assert_eq!(reparsed.global.measures[2].number, None);
}

#[test]
fn test_measure_number_element_ids_tagged() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"number": 5, "time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    assert!(
        !dl.element_ids.is_empty(),
        "element_ids should be populated"
    );

    // Find element IDs matching "mnum"
    let number_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/mnum"))
        .collect();
    assert_eq!(
        number_ids.len(),
        1,
        "Expected 1 measure number element ID, got {:?}",
        number_ids
    );
    assert_eq!(
        number_ids[0], "m0/mnum",
        "Measure number ID should be m0/mnum, got {}",
        number_ids[0]
    );
}

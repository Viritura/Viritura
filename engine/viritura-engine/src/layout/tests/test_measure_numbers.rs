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
    for placement in ["belowSystem", "belowTopInstrument"] {
        source["_x"] = json!({"viritura": {"barNumbers": {
            "frequency": "everyBar", "showFirst": true, "placement": placement, "enclosure": "box"
        }}});
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
                .filter(|bounds| {
                    bounds.index == index && (placement == "belowSystem" || bounds.part_index == 0)
                })
                .map(|bounds| bounds.y + 4.0 * config.sp)
                .max_by(f64::total_cmp)
                .unwrap();
            assert!(
                number.y > bottom,
                "bar {index} must be below the configured instrument/system"
            );
            if placement == "belowTopInstrument" {
                let next_staff = dl
                    .measure_bounds
                    .iter()
                    .find(|bounds| bounds.index == index && bounds.part_index == 1)
                    .unwrap();
                assert!(
                    number.y + number.height < next_staff.y,
                    "top-instrument numbers must clear the next instrument"
                );
            }
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

// Tests for GlobalMeasure number property (MNX measure-number)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::parse::parse_mnx;
use crate::render::*;

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

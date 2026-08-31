// Tests for heavy, dotted, heavyLight, and heavyHeavy barline types

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::render_barlines::*;
use crate::layout::types::MeasureLayout;
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::*;

#[allow(dead_code)] // future barline tests will check specific glyph codepoints; kept as a typed helper.
fn is_barline_glyph_codepoint(cmd: &RenderCommand, expected_cp: u32) -> bool {
    matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == expected_cp)
}

fn is_thick_rect(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawRect { color, .. } if color == "#000000")
}

fn is_dot(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawCircle { .. })
}

#[test]
fn repeat_start_left_extent_matches_glyph_anchor() {
    let config = LayoutConfig::default();

    assert_eq!(
        barline_left_extent(&BarlineKind::RepeatStart, &config, config.sp),
        0.0
    );
}

#[test]
fn test_heavy_barline_uses_primitive() {
    let mut dl = DisplayList::new(800.0, 600.0);
    let config = LayoutConfig::default();
    let sp = 12.0;
    let staff_y = 60.0;
    let staff_height = 4.0 * sp;

    render_barline(
        &mut dl,
        100.0,
        staff_y,
        staff_height,
        sp,
        &config,
        &BarlineKind::Heavy,
    );

    let rect_count = dl.commands.iter().filter(|c| is_thick_rect(c)).count();
    assert_eq!(
        rect_count, 1,
        "Expected 1 DrawRect for heavy barline, got {}",
        rect_count
    );
}

#[test]
fn test_dotted_barline_uses_dots() {
    let mut dl = DisplayList::new(800.0, 600.0);
    let config = LayoutConfig::default();
    let sp = 12.0;
    let staff_y = 60.0;
    let staff_height = 4.0 * sp;

    render_barline(
        &mut dl,
        100.0,
        staff_y,
        staff_height,
        sp,
        &config,
        &BarlineKind::Dotted,
    );

    let dot_count = dl.commands.iter().filter(|c| is_dot(c)).count();
    assert!(
        dot_count >= 3,
        "Expected at least 3 dots for dotted barline, got {}",
        dot_count
    );
}

#[test]
fn test_heavy_light_barline_uses_primitives() {
    let mut dl = DisplayList::new(800.0, 600.0);
    let config = LayoutConfig::default();
    let sp = 12.0;
    let staff_y = 60.0;
    let staff_height = 4.0 * sp;

    render_barline(
        &mut dl,
        100.0,
        staff_y,
        staff_height,
        sp,
        &config,
        &BarlineKind::HeavyLight,
    );

    // 1 rect (thick) + 1 line (thin)
    let rect_count = dl.commands.iter().filter(|c| is_thick_rect(c)).count();
    assert_eq!(
        rect_count, 1,
        "Expected 1 DrawRect for heavyLight barline, got {}",
        rect_count
    );
}

#[test]
fn test_heavy_heavy_barline_uses_primitives() {
    let mut dl = DisplayList::new(800.0, 600.0);
    let config = LayoutConfig::default();
    let sp = 12.0;
    let staff_y = 60.0;
    let staff_height = 4.0 * sp;

    render_barline(
        &mut dl,
        100.0,
        staff_y,
        staff_height,
        sp,
        &config,
        &BarlineKind::HeavyHeavy,
    );

    // 2 rects (both thick)
    let rect_count = dl.commands.iter().filter(|c| is_thick_rect(c)).count();
    assert_eq!(
        rect_count, 2,
        "Expected 2 DrawRect for heavyHeavy barline, got {}",
        rect_count
    );
}

#[test]
fn test_barline_primitives_span_staff_height() {
    // Primitive barlines (Heavy, HeavyLight, HeavyHeavy) should span the full staff height.
    let sp = 12.0;
    let config = LayoutConfig::default();
    let staff_y = 60.0;
    let staff_height = 4.0 * sp;

    let types = [
        BarlineKind::Heavy,
        BarlineKind::HeavyLight,
        BarlineKind::HeavyHeavy,
    ];

    for bt in &types {
        let mut dl = DisplayList::new(800.0, 600.0);
        render_barline(&mut dl, 100.0, staff_y, staff_height, sp, &config, bt);

        let rects: Vec<(f64, f64)> = dl
            .commands
            .iter()
            .filter_map(|cmd| {
                if let RenderCommand::DrawRect { y, h, .. } = cmd {
                    Some((*y, *h))
                } else {
                    None
                }
            })
            .collect();

        assert!(!rects.is_empty(), "Expected DrawRect for {:?}", bt);
        for (y, h) in &rects {
            assert!(
                (*y - staff_y).abs() < 0.01,
                "{:?} rect y={:.2} should be {:.2} (staff_y)",
                bt,
                y,
                staff_y
            );
            assert!(
                (*h - staff_height).abs() < 0.01,
                "{:?} rect h={:.2} should be {:.2} (staff_height)",
                bt,
                h,
                staff_height
            );
        }
    }
}

fn measure_layout_for_boundary(boundary: &str, forced_width: Option<f64>) -> MeasureLayout {
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{
                "time": {{"count": 4, "unit": 4}}{boundary}
            }}]}},
            "parts": [{{"measures": [{{
                "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                "sequences": [{{"content": [
                    {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "C", "octave": 4}}}}]}},
                    {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "D", "octave": 4}}}}]}},
                    {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "E", "octave": 4}}}}]}},
                    {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "F", "octave": 4}}}}]}}
                ]}}]
            }}]}}]
        }}"#
    );
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let resolved = crate::layout::resolve::resolve_measures(&score, 0);
    crate::layout::measure::layout_measure(
        &resolved[0],
        config.sp,
        0.0,
        &config,
        forced_width,
        &[],
        1.0,
    )
}

#[test]
fn test_wide_end_barlines_add_width_without_consuming_rhythmic_space() {
    let config = LayoutConfig::default();
    let regular = measure_layout_for_boundary("", None);
    let cases = [
        (r#", "barline": {"type": "double"}"#, BarlineKind::Double),
        (r#", "barline": {"type": "final"}"#, BarlineKind::Final),
        (r#", "repeatEnd": {}"#, BarlineKind::RepeatEnd),
    ];
    let regular_events = &regular.voice_layouts[0].events;
    let regular_gap = regular_events.x(3) - regular_events.x(0);
    let regular_ink = barline_ink_width(&BarlineKind::Regular, &config, config.sp);

    for (boundary, kind) in cases {
        let natural = measure_layout_for_boundary(boundary, None);
        let events = &natural.voice_layouts[0].events;
        let gap = events.x(3) - events.x(0);
        let expected_extra = barline_ink_width(&kind, &config, config.sp) - regular_ink;

        assert!(
            (gap - regular_gap).abs() < 1e-9,
            "{kind:?} changed natural rhythmic spacing by {}",
            gap - regular_gap
        );
        assert!(
            (natural.width - regular.width - expected_extra).abs() < 1e-9,
            "{kind:?} should add {expected_extra} to the measure width"
        );

        let forced = measure_layout_for_boundary(boundary, Some(natural.width));
        let forced_events = &forced.voice_layouts[0].events;
        let forced_gap = forced_events.x(3) - forced_events.x(0);
        assert!(
            (forced_gap - regular_gap).abs() < 1e-9,
            "{kind:?} forced layout did not preserve its rhythmic width"
        );
    }
}

#[test]
fn test_adjacent_repeat_end_and_start_reserve_combined_barline_width() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "repeatEnd": {}},
            {"repeatStart": {}}
        ]},
        "parts": [{"measures": [
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
            ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let resolved = crate::layout::resolve::resolve_measures(&score, 0);
    let regular_width = barline_ink_width(&BarlineKind::Regular, &config, config.sp);
    let combined_width = barline_ink_width(&BarlineKind::RepeatBoth, &config, config.sp);
    let combined_hash = crate::layout::cache::measure_content_hash(&resolved[0]);
    let mut repeat_end_only = resolved[0].clone();
    repeat_end_only.next_has_repeat_start = false;

    assert!(resolved[0].next_has_repeat_start);
    assert_ne!(
        combined_hash,
        crate::layout::cache::measure_content_hash(&repeat_end_only),
        "the following measure's repeat start must invalidate cached width"
    );
    assert!(
        (trailing_barline_extra_width(&resolved[0], &config, config.sp)
            - (combined_width - regular_width))
            .abs()
            < 1e-9
    );
}

#[test]
fn test_final_barline_primitive_alignment() {
    // Final barline: thick bar right edge at x, thin line to the left.
    let sp = 12.0;
    let config = LayoutConfig::default();
    let staff_y = 60.0;
    let staff_height = 4.0 * sp;
    let x = 100.0;

    let mut dl = DisplayList::new(800.0, 600.0);
    render_barline(
        &mut dl,
        x,
        staff_y,
        staff_height,
        sp,
        &config,
        &BarlineKind::Final,
    );

    // Should have 1 DrawRect (thick bar) with right edge at x
    let rects: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawRect { x: rx, w, .. } = cmd {
                Some((*rx, *w))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(rects.len(), 1, "Expected 1 DrawRect for final barline");
    let (rx, rw) = rects[0];
    assert!(
        (rx + rw - x).abs() < 0.01,
        "Thick bar right edge {:.2} should be at x={:.2}",
        rx + rw,
        x
    );
}

#[test]
fn test_parse_heavy_dotted_barlines() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}},
                {"barline": {"type": "heavy"}},
                {"barline": {"type": "dotted"}},
                {"barline": {"type": "heavyLight"}},
                {"barline": {"type": "heavyHeavy"}}
            ]
        },
        "parts": [{
            "measures": [
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]}
            ]
        }]
    }"#;

    let score = parse_mnx(json).expect("parse failed");
    assert_eq!(
        score.global.measures[1]
            .barline
            .as_ref()
            .unwrap()
            .barline_type,
        BarlineType::Heavy
    );
    assert_eq!(
        score.global.measures[2]
            .barline
            .as_ref()
            .unwrap()
            .barline_type,
        BarlineType::Dotted
    );
    assert_eq!(
        score.global.measures[3]
            .barline
            .as_ref()
            .unwrap()
            .barline_type,
        BarlineType::HeavyLight
    );
    assert_eq!(
        score.global.measures[4]
            .barline
            .as_ref()
            .unwrap()
            .barline_type,
        BarlineType::HeavyHeavy
    );
}

#[test]
fn test_barline_styles_mnx_produces_expected_commands() {
    // The barline-styles.mnx file includes heavy, dotted, heavyLight, heavyHeavy barlines.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/barline-styles.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Check for heavy barline (DrawRect)
    let heavy = dl.commands.iter().filter(|c| is_thick_rect(c)).count();
    assert!(
        heavy >= 1,
        "Expected at least 1 DrawRect for heavy barline, got {}",
        heavy
    );

    // Check for dotted barline (DrawCircle dots)
    let dotted = dl.commands.iter().filter(|c| is_dot(c)).count();
    assert!(
        dotted >= 1,
        "Expected at least 1 dot for dotted barline, got {}",
        dotted
    );
}

#[test]
fn test_barline_tagging_two_measures() {
    // A 2-measure score: the barline between m0 and m1 should be tagged "m1/barline"
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}},
                {}
            ]
        },
        "parts": [{
            "measures": [
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]}
            ]
        }]
    }"#;

    let score = parse_mnx(json).expect("parse failed");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // The inter-measure barline should be tagged with "m1/barline"
    let barline_tags: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/barline"))
        .collect();
    assert!(
        !barline_tags.is_empty(),
        "Expected at least one barline tag in element_ids"
    );
    assert!(
        barline_tags.iter().any(|t| *t == "m1/barline"),
        "Expected 'm1/barline' tag, got: {:?}",
        barline_tags
    );
}

#[test]
fn test_barline_tagging_heavy_barline() {
    // A 2-measure score with a heavy barline: tagged commands should include the glyph
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}, "barline": {"type": "heavy"}},
                {}
            ]
        },
        "parts": [{
            "measures": [
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]}
            ]
        }]
    }"#;

    let score = parse_mnx(json).expect("parse failed");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find the command(s) tagged with "m1/barline"
    let tagged_indices: Vec<usize> = dl
        .element_ids
        .iter()
        .enumerate()
        .filter_map(|(i, id)| {
            if id.as_deref() == Some("m1/barline") {
                Some(i)
            } else {
                None
            }
        })
        .collect();
    assert!(
        !tagged_indices.is_empty(),
        "Expected commands tagged 'm1/barline'"
    );

    // At least one tagged command should be a DrawRect (the heavy barline)
    let has_heavy = tagged_indices
        .iter()
        .any(|&i| is_thick_rect(&dl.commands[i]));
    assert!(
        has_heavy,
        "Expected heavy barline rect among tagged commands"
    );
}

#[test]
fn test_barline_tagging_double_barline() {
    // Double barline produces 2 DrawLine commands; both should be tagged
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}, "barline": {"type": "double"}},
                {}
            ]
        },
        "parts": [{
            "measures": [
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]}
            ]
        }]
    }"#;

    let score = parse_mnx(json).expect("parse failed");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let tagged_count = dl
        .element_ids
        .iter()
        .filter(|id| id.as_deref() == Some("m1/barline"))
        .count();
    assert!(
        tagged_count >= 2,
        "Double barline should tag at least 2 commands, got {}",
        tagged_count
    );
}

#[test]
fn test_barline_tagging_repeat_start_first_measure() {
    // First measure with repeat-start: the repeat barline at the start is
    // rendered by render_measure, and the final barline at the end uses
    // index+1 (m1/barline) to avoid ID collision with the start barline.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}, "repeat-start": {}}
            ]
        },
        "parts": [{
            "measures": [
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]}
            ]
        }]
    }"#;

    let score = parse_mnx(json).expect("parse failed");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let barline_tags: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/barline"))
        .collect();
    assert!(
        !barline_tags.is_empty(),
        "Expected barline tags, got: {:?}",
        barline_tags
    );
    // Final barline uses measure index + 1 to avoid colliding with
    // the start barline's element ID.
    assert!(
        barline_tags.iter().any(|t| *t == "m1/barline"),
        "Expected 'm1/barline' tag for final barline, got: {:?}",
        barline_tags
    );
}

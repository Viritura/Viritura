// Auto-generated from tests.rs — test_rests
// 3 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::layout::spacing::build_log_spacing_for_resolved_measure;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_full_measure_rest_centered() {
    // Measure 1: three quarter notes, Measure 2: full-measure rest
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 3, "unit": 4}},
            {}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
                ]}]
            },
            {
                "sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find whole rest glyph (SMuFL U+E4E3)
    let rest_glyphs: Vec<&RenderCommand> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::REST_WHOLE)
    }).collect();
    assert_eq!(
        rest_glyphs.len(),
        1,
        "Expected exactly one whole rest glyph for full-measure rest"
    );

    // Verify the rest is horizontally centered within its measure (not at beat 0)
    if let RenderCommand::DrawGlyph { x: rest_x, .. } = rest_glyphs[0] {
        // The rest should be near the center of the second measure, not at the left edge
        let sp = config.sp;
        let margin_left = config.margin_left * sp;
        assert!(
            *rest_x > margin_left + 5.0 * sp,
            "Full-measure rest should be centered, not at left edge. x={}",
            rest_x
        );
    }
}

#[test]
fn test_interior_full_measure_rest_ink_centers_between_barlines() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]},
            {"sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let resolved = resolve_measures(&score, 0);
    let spacing = build_log_spacing_for_resolved_measure(&resolved[1], 4.0, 1.0, &config, false);
    let start_x = 37.0;
    let ml = layout_measure_with_shared_spacing(
        &resolved[1],
        config.sp,
        start_x,
        &config,
        Some(20.0 * config.sp),
        &[],
        1.0,
        &spacing,
        None,
        &[],
        false,
    );
    let rest_ink_center = ml.voice_layouts[0].events.x(0);
    let expected_center = ml.x + ml.width * 0.5;

    assert!(
        (rest_ink_center - expected_center).abs() < 1.0e-9,
        "bar-rest ink center {rest_ink_center} must match barline midpoint {expected_center}"
    );
}

#[test]
fn test_first_measure_rests_center_in_rhythmic_space_after_prefix() {
    for sequence in [
        r#"{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}"#,
        r#"{"content": [{"duration": {"base": "whole"}, "rest": {}}]}"#,
    ] {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{
                    "time": {{"count": 4, "unit": 4}},
                    "key": {{"fifths": -4}}
                }}]}},
                "parts": [{{"measures": [{{
                    "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                    "sequences": [{sequence}]
                }}]}}]
            }}"#
        );
        let score = parse_mnx(&json).unwrap();
        let config = LayoutConfig::default();
        let start_x = 37.0;
        let resolved = resolve_measures(&score, 0);
        let ml = layout_measure(&resolved[0], config.sp, start_x, &config, None, &[], 1.0);
        let rest_x = ml.voice_layouts[0].events.x(0);
        let content_width = ml.width
            - ml.prefix_width
            - MEASURE_TRAILING_PADDING_SP * config.sp
            - ml.trailing_barline_extra;
        let expected = start_x + ml.prefix_width + content_width * 0.5;

        assert!(ml.prefix_width > 8.0 * config.sp);
        assert!(
            (rest_x - expected).abs() < 1e-9,
            "rest x {rest_x} should center in content space at {expected}"
        );
    }
}

#[test]
fn test_full_measure_rest_staff_position() {
    // Full-measure rest with explicit staffPosition should override default Y position.
    // MNX staffPosition: 0 = middle line, positive = up, negative = down.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {},
            {}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                ]}]
            },
            {
                "sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}, "staffPosition": 2}}]
            },
            {
                "sequences": [{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Find all whole rest glyphs
    let rest_glyphs: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if *codepoint == smufl::REST_WHOLE => Some((*x, *y)),
            _ => None,
        })
        .collect();
    assert_eq!(
        rest_glyphs.len(),
        2,
        "Expected two whole rest glyphs (measures 2 and 3)"
    );

    // Measure 2: staffPosition=2 → y = staff_y + (4 - 2) * 0.5 * sp = staff_y + 1.0 * sp
    let expected_y_custom = staff_y + (4.0 - 2.0) * 0.5 * sp;
    assert!(
        (rest_glyphs[0].1 - expected_y_custom).abs() < 0.01,
        "Full-measure rest with staffPosition=2: expected y={:.2}, got {:.2}",
        expected_y_custom,
        rest_glyphs[0].1
    );

    // Measure 3: no staffPosition → default whole rest y = staff_y + 1.0 * sp
    let expected_y_default = staff_y + 1.0 * sp;
    assert!(
        (rest_glyphs[1].1 - expected_y_default).abs() < 0.01,
        "Full-measure rest without staffPosition: expected y={:.2}, got {:.2}",
        expected_y_default,
        rest_glyphs[1].1
    );
}

#[test]
fn test_half_rest_not_centered_in_4_4() {
    // A single half rest in a 4/4 measure should NOT be centered (it doesn't fill the measure)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "rest": {}},
                {"duration": {"base": "half"}, "rest": {}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let resolved = resolve_measures(&score, 0);
    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], 1.0);

    // Two rest events should be laid out normally (not centered)
    assert_eq!(ml.voice_layouts[0].events_vec().len(), 2);
    let x1 = ml.voice_layouts[0].events_vec()[0].x;
    let x2 = ml.voice_layouts[0].events_vec()[1].x;
    assert!(
        x2 > x1 + 1.0 * sp,
        "Two half rests should be spaced apart, not centered. x1={}, x2={}",
        x1,
        x2
    );
}

#[test]
fn test_rest_staff_position_layout() {
    // Load rest-positions.mnx which has rests with staffPosition: 2
    let json = include_str!(
        "../../../../viritura-wasm/../../packages/format/fixtures/mnx/rest-positions.mnx"
    );
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Collect all quarter rest glyphs (SMuFL U+E4E5) with their Y positions
    let rest_glyphs: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if *codepoint == smufl::REST_QUARTER => Some((*x, *y)),
            _ => None,
        })
        .collect();

    assert_eq!(
        rest_glyphs.len(),
        2,
        "Expected 2 quarter rests with staffPosition"
    );

    // staffPosition=2 → y = staff_y + (4 - 2) * 0.5 * sp = staff_y + 1.0 * sp
    let expected_y = staff_y + 1.0 * sp;
    for (i, (_rx, ry)) in rest_glyphs.iter().enumerate() {
        assert!(
            (*ry - expected_y).abs() < 0.01,
            "Rest {} Y position: expected {:.2}, got {:.2}",
            i,
            expected_y,
            ry,
        );
    }
}

#[test]
fn test_dotted_rest_renders_augmentation_dot() {
    // Regression: `render_rest` used to skip augmentation dots entirely (they
    // were only drawn on the note branch of `render_event`), so a dotted rest
    // rendered visually identical to an undotted one of the same base value.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                {"duration": {"base": "quarter", "dots": 1}, "rest": {}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let rest_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. } if *codepoint == smufl::REST_QUARTER => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render a quarter rest glyph");

    let dot_count = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::AUGMENTATION_DOT)
        })
        .count();
    assert_eq!(
        dot_count, 1,
        "Dotted quarter rest should render exactly 1 augmentation dot"
    );

    let dot_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::AUGMENTATION_DOT =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render an augmentation dot glyph");
    assert!(
        dot_x > rest_x,
        "Augmentation dot (x={:.1}) should sit to the right of the rest glyph (x={:.1})",
        dot_x,
        rest_x
    );
}

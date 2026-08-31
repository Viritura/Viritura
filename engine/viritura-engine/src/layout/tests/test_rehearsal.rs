// Auto-generated from tests.rs — test_rehearsal
// 5 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::*;

// ================================================
// Rehearsal marks
// ================================================
#[test]
fn test_rehearsal_marks_parse_and_render() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/rehearsal-marks.mnx"
    ))
    .expect("Failed to read rehearsal-marks.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse rehearsal-marks.mnx");

    // Verify rehearsal marks parsed on correct measures
    assert!(
        score.global.measures[0].rehearsal_mark().is_some(),
        "Measure 0 should have rehearsal mark A"
    );
    assert_eq!(score.global.measures[0].rehearsal_mark().unwrap().text, "A");
    assert!(
        score.global.measures[1].rehearsal_mark().is_none(),
        "Measure 1 should have no rehearsal mark"
    );
    assert!(
        score.global.measures[2].rehearsal_mark().is_some(),
        "Measure 2 should have rehearsal mark B"
    );
    assert!(
        score.global.measures[3].rehearsal_mark().is_some(),
        "Measure 3 should have rehearsal mark C"
    );
    assert!(
        score.global.measures[4].rehearsal_mark().is_some(),
        "Measure 4 should have rehearsal mark D"
    );

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have bold text commands for A, B, C, D labels
    let rehearsal_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawText { font, text, .. }
            if font == "serif bold" && ["A", "B", "C", "D"].contains(&text.as_str()))
        })
        .collect();
    assert_eq!(
        rehearsal_texts.len(),
        4,
        "Expected 4 rehearsal mark texts (A, B, C, D), got {}",
        rehearsal_texts.len()
    );
}

#[test]
fn test_rehearsal_mark_boxed_has_border() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"rehearsalMark": {"text": "A"}}}
        }]},
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
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Check for "A" text in serif bold
    let a_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawText { text, font, .. }
            if text == "A" && font == "serif bold")
        })
        .collect();
    assert_eq!(a_texts.len(), 1, "Expected 1 rehearsal mark 'A' text");
    if let RenderCommand::DrawText { y, size, .. } = a_texts[0] {
        assert!(*y < staff_y, "Rehearsal mark should be above staff");
        assert!(
            *size >= 1.5 * sp,
            "Rehearsal mark font size should be large (>=1.5sp)"
        );
    }

    // Background is transparent: no opaque white rect should be emitted.
    let white_rects: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawRect { color, .. } if color == "#ffffff"))
        .collect();
    assert!(
        white_rects.is_empty(),
        "Boxed rehearsal mark should have a transparent background (no white fill rect)"
    );

    // The box border (black lines) must still be drawn.
    let border_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawLine { color, .. } if color == "#000000"))
        .collect();
    assert!(
        border_lines.len() >= 4,
        "Expected 4 border lines for boxed rehearsal mark, got {}",
        border_lines.len()
    );
}

#[test]
fn test_rehearsal_mark_above_staff() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"rehearsalMark": {"text": "1", "style": "plain"}}}
        }]},
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
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    let mark_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawText { text, font, .. }
            if text == "1" && font == "serif bold")
        })
        .collect();
    assert_eq!(mark_texts.len(), 1, "Expected 1 rehearsal mark '1' text");
    if let RenderCommand::DrawText { y, align, .. } = mark_texts[0] {
        assert!(*y < staff_y, "Rehearsal mark text should be above staff");
        assert!(
            matches!(align, TextAlign::Center),
            "Rehearsal mark should be center-aligned"
        );
    }
}

#[test]
fn test_rehearsal_mark_styles_parse() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "_x": {"viritura": {"rehearsalMark": {"text": "A", "style": "boxed"}}}},
            {"_x": {"viritura": {"rehearsalMark": {"text": "B", "style": "circled"}}}},
            {"_x": {"viritura": {"rehearsalMark": {"text": "C", "style": "plain"}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();

    assert_eq!(
        score.global.measures[0].rehearsal_mark().unwrap().style,
        Some(RehearsalMarkStyle::Boxed)
    );
    assert_eq!(
        score.global.measures[1].rehearsal_mark().unwrap().style,
        Some(RehearsalMarkStyle::Circled)
    );
    assert_eq!(
        score.global.measures[2].rehearsal_mark().unwrap().style,
        Some(RehearsalMarkStyle::Plain)
    );

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // All three should produce bold text
    let bold_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { font, .. } if font == "serif bold"))
        .collect();
    assert_eq!(
        bold_texts.len(),
        3,
        "Expected 3 rehearsal mark bold texts, got {}",
        bold_texts.len()
    );
}

#[test]
fn test_rehearsal_mark_default_style_is_boxed() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"rehearsalMark": {"text": "A"}}}
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();

    // Default style should be None (treated as boxed in rendering)
    assert!(score.global.measures[0]
        .rehearsal_mark()
        .unwrap()
        .style
        .is_none());

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Default boxed style draws a transparent background (no white fill rect)
    // but still emits the four black border lines.
    let white_rects: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawRect { color, .. } if color == "#ffffff"))
        .collect();
    assert!(
        white_rects.is_empty(),
        "Default boxed style should have a transparent background (no white fill rect)"
    );
    let border_lines = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawLine { color, .. } if color == "#000000"))
        .count();
    assert!(
        border_lines >= 4,
        "Default boxed style should still draw 4 border lines, got {border_lines}"
    );
}

#[test]
fn test_rehearsal_mark_element_ids_tagged() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/rehearsal-marks.mnx"
    ))
    .expect("Failed to read rehearsal-marks.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse rehearsal-marks.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    assert!(
        !dl.element_ids.is_empty(),
        "element_ids should be populated"
    );

    // Find element IDs matching "rehearsal"
    let rehearsal_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/rehearsal"))
        .collect();
    // rehearsal-marks.mnx has rehearsal marks on measures 0, 2, 3, 4
    // Each boxed mark has 5 commands (4 border lines + text), so many IDs per mark
    assert!(
        rehearsal_ids.len() >= 4,
        "Expected at least 4 rehearsal element IDs (one per mark), got {}: {:?}",
        rehearsal_ids.len(),
        rehearsal_ids
    );

    // Verify format: m{measure}/rehearsal
    assert!(
        rehearsal_ids.iter().any(|id| id.as_str() == "m0/rehearsal"),
        "Should have m0/rehearsal ID"
    );
}

#[test]
fn test_rehearsal_mark_box_centers_on_interior_barline() {
    // At an interior barline the rehearsal mark is horizontally centered over
    // the barline by default: the box's horizontal midpoint sits on the
    // barline, so the box extends equally to either side.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"_x": {"viritura": {"rehearsalMark": {"text": "B"}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Barline at the start of measure 1 (tagged "m1/barline").
    let barline_x = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .find_map(|(cmd, id)| match (cmd, id.as_deref()) {
            (RenderCommand::DrawLine { x1, .. }, Some("m1/barline")) => Some(*x1),
            _ => None,
        })
        .expect("m1/barline DrawLine");

    // Vertical border lines of the rehearsal box (tagged "m1/rehearsal").
    let (box_left_x, box_right_x) = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .filter_map(|(cmd, id)| match (cmd, id.as_deref()) {
            (RenderCommand::DrawLine { x1, x2, .. }, Some("m1/rehearsal"))
                if (x1 - x2).abs() < 1e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), x| {
            (lo.min(x), hi.max(x))
        });

    assert!(
        box_left_x.is_finite() && box_right_x.is_finite(),
        "Boxed rehearsal mark should emit vertical border lines"
    );
    let box_center = (box_left_x + box_right_x) * 0.5;
    assert!(
        (box_center - barline_x).abs() < 0.01,
        "Rehearsal box center x={box_center} should align with interior barline x={barline_x}"
    );
    assert!(
        box_left_x < barline_x && box_right_x > barline_x,
        "Centered box should straddle the barline (left={box_left_x}, right={box_right_x}, barline={barline_x})"
    );
}

#[test]
fn test_rehearsal_mark_box_left_aligns_at_system_start() {
    // A rehearsal mark on the first measure of a system stays left-aligned to
    // the barline. Centering it would push the box into the left margin, so the
    // box's left edge sits on the barline instead.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "_x": {"viritura": {"rehearsalMark": {"text": "B"}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Leftmost vertical border line of the rehearsal box (tagged "m0/rehearsal").
    let box_left_x = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .filter_map(|(cmd, id)| match (cmd, id.as_deref()) {
            (RenderCommand::DrawLine { x1, x2, .. }, Some("m0/rehearsal"))
                if (x1 - x2).abs() < 1e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);

    assert!(
        box_left_x.is_finite(),
        "Boxed rehearsal mark should emit vertical border lines"
    );
    // First-on-system marks are left-aligned: the box left edge sits on the
    // measure's left barline (config.margin_left * sp).
    let expected_left = config.margin_left * config.sp;
    assert!(
        (box_left_x - expected_left).abs() < 0.01,
        "System-start rehearsal box left edge x={box_left_x} should align with the barline x={expected_left}"
    );
}

#[test]
fn test_rehearsal_mark_circled_background_is_transparent() {
    // A circled rehearsal mark must not paint an opaque white fill circle; the
    // canvas background should show through (only the border ellipse is drawn).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"rehearsalMark": {"text": "A", "style": "circled"}}}
        }]},
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

    let white_circles = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawCircle { color, .. } if color == "#ffffff"))
        .count();
    assert_eq!(
        white_circles, 0,
        "Circled rehearsal mark should have a transparent background (no white fill circle)"
    );

    // The border ellipse must still be drawn.
    let border_ellipses = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawEllipse { filled, .. } if !*filled))
        .count();
    assert!(
        border_ellipses >= 1,
        "Circled rehearsal mark should still draw a border ellipse"
    );
}

#[test]
fn test_rehearsal_mark_clears_articulation() {
    // A boxed rehearsal mark over a note with an accent: the accent protrudes
    // above the notehead and sits directly under the box. The box must rise to
    // clear it rather than overlapping the accent.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"rehearsalMark": {"text": "13"}}}
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "stemDirection": "down",
                 "markings": {"accent": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let dl = layout_score(&score, 0, &config);

    // Box bottom border = largest Y among the box's border lines. The box sits
    // above the staff, so restrict to short horizontal black lines above the
    // top staff line (excludes the full-width staff lines and tall barlines).
    let box_bottom = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                color,
                ..
            } if color == "#000000"
                && (y1 - y2).abs() < 0.01
                && (x2 - x1).abs() < 12.0 * sp
                && *y1 < staff_y =>
            {
                Some(*y1)
            }
            _ => None,
        })
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(box_bottom.is_finite(), "Should draw box border lines");

    // Accent glyph top edge.
    let accent_top = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                y, codepoint, size, ..
            } if *codepoint == crate::render::smufl::smufl::ARTIC_ACCENT_ABOVE => {
                let (_, by, _, _) = crate::render::smufl::smufl::glyph_bbox(*codepoint);
                Some(y + by * (size / 4.0))
            }
            _ => None,
        })
        .expect("Should render an accent-above glyph");

    assert!(
        box_bottom <= accent_top,
        "Rehearsal box bottom ({:.1}) must clear accent top ({:.1})",
        box_bottom,
        accent_top
    );
}

#[test]
fn test_rehearsal_mark_text_centered_in_box() {
    // The label's optical centre (cap-height midpoint) must coincide with the
    // box centre, so digits/capitals sit centred within the border.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"rehearsalMark": {"text": "13"}}}
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let dl = layout_score(&score, 0, &config);

    // Box vertical extent from the horizontal border lines (top + bottom). The
    // box is above the staff, so restrict to short horizontal black lines above
    // the top staff line to exclude staff lines and barlines.
    let mut horizontal_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine {
                y1,
                y2,
                x1,
                x2,
                color,
                ..
            } if color == "#000000"
                && (y1 - y2).abs() < 0.01
                && (x2 - x1).abs() < 12.0 * sp
                && *y1 < staff_y =>
            {
                Some(*y1)
            }
            _ => None,
        })
        .collect();
    horizontal_ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert_eq!(
        horizontal_ys.len(),
        2,
        "Expected top and bottom box borders"
    );
    let box_center = (horizontal_ys[0] + horizontal_ys[1]) * 0.5;

    // Label baseline (Alphabetic) and font size.
    let (baseline_y, font_size) = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText {
                y,
                text,
                size,
                baseline,
                ..
            } if text == "13" => {
                assert!(
                    matches!(baseline, TextBaseline::Alphabetic),
                    "Rehearsal label should use Alphabetic baseline for deterministic centering"
                );
                Some((*y, *size))
            }
            _ => None,
        })
        .expect("Should render '13' label");

    // Cap-height midpoint of the digits (no descender): ~0.7 em cap height.
    let cap_midpoint = baseline_y - 0.35 * font_size;
    assert!(
        (cap_midpoint - box_center).abs() < 0.05 * sp,
        "Digit optical centre ({:.2}) should coincide with box centre ({:.2})",
        cap_midpoint,
        box_center
    );
}

#[test]
fn test_rehearsal_mark_clears_system_start_measure_number() {
    // The measure number is drawn BELOW the staff and the rehearsal mark ABOVE
    // it, so the two never compete for the same slot even when both anchor to
    // the system-start barline. The first measure carries an explicit number so
    // the number renders even on the opening bar.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "number": 17,
            "_x": {"viritura": {"rehearsalMark": {"text": "C"}}}
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let dl = layout_score(&score, 0, &config);

    // The measure number must render below the staff. Its glyphs descend from
    // the baseline (Top), so the baseline Y sits below the bottom staff line.
    let number_baseline = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText {
                y, text, baseline, ..
            } if text == "17" => {
                assert!(matches!(baseline, TextBaseline::Top));
                Some(*y)
            }
            _ => None,
        })
        .expect("measure number '17' should render at the system start");
    assert!(
        number_baseline > staff_y + 4.0 * sp,
        "measure number ({number_baseline:.1}) must sit below the bottom staff line ({:.1})",
        staff_y + 4.0 * sp
    );

    // Rehearsal box bottom border = largest Y among short horizontal black
    // lines above the staff.
    let box_bottom = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                color,
                ..
            } if color == "#000000"
                && (y1 - y2).abs() < 0.01
                && (x2 - x1).abs() < 12.0 * sp
                && *y1 < staff_y =>
            {
                Some(*y1)
            }
            _ => None,
        })
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(box_bottom.is_finite(), "rehearsal box should render");

    assert!(
        box_bottom < staff_y,
        "rehearsal box bottom ({box_bottom:.1}) must sit above the staff ({staff_y:.1})"
    );
}

#[test]
fn test_rehearsal_mark_dodges_left_over_direction() {
    // An interior rehearsal mark sits over a measure whose first beat carries a
    // high note and an above-staff performance direction ("arco"). Both push up
    // into the centred mark's band. Rather than lift the mark high above them,
    // the engine slides it LEFT — its right border travels to the barline — so
    // it clears the obstacles horizontally. Horizontal travel here (half a
    // box-width) is smaller than the vertical lift the high note would force, so
    // the smaller-displacement option (the dodge) wins. The direction obstacle
    // is x-localized, so once the box clears it horizontally the dodge resolves.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"_x": {"viritura": {"rehearsalMark": {"text": "11"}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]},
            {"expressions": [{"text": "arco", "position": {"fraction": [0, 4]}, "placement": "above"}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let dl = layout_score(&score, 0, &config);

    // Barline at the start of measure 1.
    let barline_x = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .find_map(|(cmd, id)| match (cmd, id.as_deref()) {
            (RenderCommand::DrawLine { x1, .. }, Some("m1/barline")) => Some(*x1),
            _ => None,
        })
        .expect("m1/barline DrawLine");

    // Vertical border lines of the rehearsal box give its left/right extent.
    let (box_left_x, box_right_x) = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .filter_map(|(cmd, id)| match (cmd, id.as_deref()) {
            (RenderCommand::DrawLine { x1, x2, .. }, Some("m1/rehearsal"))
                if (x1 - x2).abs() < 1e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), x| {
            (lo.min(x), hi.max(x))
        });
    assert!(
        box_left_x.is_finite() && box_right_x.is_finite(),
        "Boxed rehearsal mark should emit vertical border lines"
    );

    // Horizontal border lines give the box's vertical centre (= mark_y).
    let (box_top_y, box_bottom_y) = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .filter_map(|(cmd, id)| match (cmd, id.as_deref()) {
            (RenderCommand::DrawLine { y1, y2, .. }, Some("m1/rehearsal"))
                if (y1 - y2).abs() < 1e-6 =>
            {
                Some(*y1)
            }
            _ => None,
        })
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), y| {
            (lo.min(y), hi.max(y))
        });
    assert!(
        box_top_y.is_finite() && box_bottom_y.is_finite(),
        "Boxed rehearsal mark should emit horizontal border lines"
    );

    // Dodged left: the box has slid left of its centred position so its right
    // border no longer overlaps the obstacles. It need only move as far as
    // required to clear them (its leftward travel is capped at the barline).
    let box_center_x = (box_left_x + box_right_x) * 0.5;
    assert!(
        box_center_x < barline_x - 0.5 * sp,
        "dodged box centre x={box_center_x:.1} should sit left of the barline x={barline_x:.1}"
    );

    // Not lifted: the box's vertical centre stays at the default height
    // instead of rising over the obstacles. The default centre is the cap-height
    // midpoint of a baseline anchored `attach_gap` (2sp) above the staff:
    // `center = staff - 2sp - cap_height/2`, with `cap_height = 0.7*2.8sp`.
    let mark_y = (box_top_y + box_bottom_y) * 0.5;
    let cap_height = 0.7 * 2.8 * sp;
    let default_mark_y = staff_y - 2.0 * sp - cap_height * 0.5;
    assert!(
        (mark_y - default_mark_y).abs() < 0.2 * sp,
        "dodged box should stay at its default height: mark_y={mark_y:.1}, default={default_mark_y:.1}"
    );
}

#[test]
fn test_rehearsal_mark_bbox_tracks_dodge_over_direction() {
    // Regression: the selection bbox must follow the mark's horizontal dodge.
    // The geometry-pass bbox twin computed the box with NO above-glyph obstacle
    // bands, so it placed the box at the centred (un-dodged) position while the
    // renderer slid it left over the "arco" direction — leaving the selection
    // box visibly off the drawn border (user-reported on Rhapsody, double-bass
    // part, rehearsal 11). The bbox is now published at emit time from the same
    // resolved frame, so it must equal the drawn border on every edge even when
    // the dodge fires.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"_x": {"viritura": {"rehearsalMark": {"text": "11"}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]},
            {"expressions": [{"text": "arco", "position": {"fraction": [0, 4]}, "placement": "above"}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Outer extent of the four drawn border strokes (the visible box).
    let (mut min_x, mut max_x, mut min_y, mut max_y) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for (cmd, id) in dl.commands.iter().zip(dl.element_ids.iter()) {
        if let (RenderCommand::DrawLine { x1, y1, x2, y2, .. }, Some("m1/rehearsal")) =
            (cmd, id.as_deref())
        {
            min_x = min_x.min(x1.min(*x2));
            max_x = max_x.max(x1.max(*x2));
            min_y = min_y.min(y1.min(*y2));
            max_y = max_y.max(y1.max(*y2));
        }
    }
    assert!(
        min_x.is_finite(),
        "boxed rehearsal mark should draw a border"
    );

    let rb = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id == "m1/rehearsal")
        .expect("rehearsal selection bbox");
    let eps = 1e-6;
    assert!(
        (rb.bbox.x - min_x).abs() < eps
            && (rb.bbox.y - min_y).abs() < eps
            && ((rb.bbox.x + rb.bbox.width) - max_x).abs() < eps
            && ((rb.bbox.y + rb.bbox.height) - max_y).abs() < eps,
        "bbox [{:.2},{:.2},{:.2},{:.2}] should equal drawn border [{:.2},{:.2},{:.2},{:.2}] after the dodge",
        rb.bbox.x,
        rb.bbox.y,
        rb.bbox.x + rb.bbox.width,
        rb.bbox.y + rb.bbox.height,
        min_x,
        min_y,
        max_x,
        max_y
    );
}

#[test]
fn test_rehearsal_mark_dodge_clears_ledger_lines() {
    // An interior rehearsal mark sits over a measure whose first note is high
    // enough to carry ledger lines above the staff. Ledger lines are real ink
    // that extends past the notehead on both sides, so the dodge must clear the
    // ledger line's LEFT edge — not just the notehead. Without accounting for
    // the ledger extension the box would stop at the notehead and overlap the
    // ledger lines.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"_x": {"viritura": {"rehearsalMark": {"text": "6"}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let barline_x = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .find_map(|(cmd, id)| match (cmd, id.as_deref()) {
            (RenderCommand::DrawLine { x1, .. }, Some("m1/barline")) => Some(*x1),
            _ => None,
        })
        .expect("m1/barline DrawLine");

    // Leftmost notehead in measure 1 (the only glyph drawn right of the barline).
    let notehead_x = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, .. } if *x >= barline_x => Some(*x),
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    assert!(
        notehead_x.is_finite(),
        "Should render the measure-1 notehead"
    );

    // Right border of the rehearsal box.
    let box_right_x = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .filter_map(|(cmd, id)| match (cmd, id.as_deref()) {
            (RenderCommand::DrawLine { x1, x2, .. }, Some("m1/rehearsal"))
                if (x1 - x2).abs() < 1e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(
        box_right_x.is_finite(),
        "Boxed mark should emit border lines"
    );

    // The box must clear the ledger line's left edge — notehead_x minus the
    // ledger extension (0.4 sp) — within one dodge step (0.1 sp), not merely
    // the notehead's left edge.
    let ledger_left = notehead_x - 0.4 * sp;
    assert!(
        box_right_x <= ledger_left + 0.15 * sp,
        "box right edge x={box_right_x:.1} should clear the ledger line left edge x={ledger_left:.1} (notehead x={notehead_x:.1})"
    );
}

#[test]
fn test_rehearsal_mark_floats_over_previous_measure_note_ink() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"_x": {"viritura": {"rehearsalMark": {"text": "12"}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "half"}, "rest": {}},
                {"duration": {"base": "quarter"}, "rest": {}},
                {"duration": {"base": "eighth"}, "rest": {}},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let display = layout_score(&score, 0, &config);
    let rehearsal = display
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == "m1/rehearsal")
        .expect("rehearsal bbox");
    let previous_note = display
        .commands
        .iter()
        .enumerate()
        .filter(|(index, command)| {
            display.element_ids[*index]
                .as_deref()
                .is_some_and(|id| id.contains("/m0/") && id.contains("/n0"))
                && matches!(command, RenderCommand::DrawGlyph { codepoint, .. } if smufl::smufl::is_notehead(*codepoint))
        })
        .filter_map(|(_, command)| command.bbox())
        .min_by(|left, right| left.y.total_cmp(&right.y))
        .expect("previous high notehead");
    let rehearsal_bottom = rehearsal.bbox.y + rehearsal.bbox.height;

    assert!(
        rehearsal.bbox.x < previous_note.x + previous_note.width
            && previous_note.x < rehearsal.bbox.x + rehearsal.bbox.width,
        "fixture must overlap the boundary note and rehearsal frame horizontally"
    );
    assert!(
        rehearsal_bottom
            + config
                .placement
                .resolve(ElementKind::RehearsalMark)
                .padding
                .vertical
                * config.sp
            <= previous_note.y + 1.0e-6,
        "rehearsal bottom {rehearsal_bottom} must float above previous-note ink top {}",
        previous_note.y
    );
}

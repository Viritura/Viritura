// Auto-generated from tests.rs — test_repeats
// 12 test(s)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::HashSet;

#[test]
fn test_repeat_barlines_mnx_produces_glyphs() {
    // Load repeats.mnx which has 1 measure with both repeatStart and repeatEnd.
    // Expect SMuFL repeat barline glyphs (repeatLeft + repeatRight).
    let json = include_str!("../../../../../packages/format/fixtures/mnx/repeats.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let glyph_count = dl
        .commands
        .iter()
        .filter(|c| is_repeat_barline_glyph(c))
        .count();
    // RepeatStart glyph + RepeatEnd glyph = at least 2
    assert!(
        glyph_count >= 2,
        "Expected at least 2 repeat barline glyphs for start+end repeats, got {}",
        glyph_count
    );
}

#[test]
fn test_repeat_barlines_mnx_produces_thick_barline_glyphs() {
    // Repeat barlines use SMuFL glyphs that include thick lines.
    // RepeatStart = 1 glyph, RepeatEnd = 1 glyph → at least 2 glyphs.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/repeats.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let thick_count = dl
        .commands
        .iter()
        .filter(|c| is_thick_barline_glyph(c))
        .count();
    assert!(
        thick_count >= 2,
        "Expected at least 2 thick barline glyphs for repeat start+end, got {}",
        thick_count
    );
}

#[test]
fn test_repeat_barlines_no_glyphs_without_repeats() {
    // A simple score without repeat markers should produce zero repeat barline glyphs.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let glyph_count = dl
        .commands
        .iter()
        .filter(|c| is_repeat_barline_glyph(c))
        .count();
    assert_eq!(
        glyph_count, 0,
        "Expected 0 repeat barline glyphs for score without repeats, got {}",
        glyph_count
    );
}

#[test]
fn test_implied_start_repeat_no_start_barline() {
    // Load repeats-implied-start-repeat.mnx which has repeatEnd but NO repeatStart.
    // The implied start repeat should NOT render a start-repeat barline.
    // Expect exactly 1 repeat barline glyph (repeatRight for end-repeat only).
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/repeats-implied-start-repeat.mnx"
    );
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Only end-repeat glyph: 1 repeatRight (no repeatLeft)
    let repeat_right_count = dl.commands.iter().filter(|c|
        matches!(c, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::REPEAT_RIGHT)
    ).count();
    assert_eq!(
        repeat_right_count, 1,
        "Expected exactly 1 repeatRight glyph (end-repeat only) for implied start repeat, got {}",
        repeat_right_count
    );

    let repeat_left_count = dl.commands.iter().filter(|c|
        matches!(c, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::REPEAT_LEFT)
    ).count();
    assert_eq!(
        repeat_left_count, 0,
        "Expected 0 repeatLeft glyphs for implied start repeat, got {}",
        repeat_left_count
    );
}

#[test]
fn test_repeat_count_display_times_greater_than_2() {
    // Load repeats-more-once-repeated.mnx which has repeatEnd.times = 4.
    // Expect a DrawText command with "4x" above the repeat barline.
    let json =
        include_str!("../../../../../packages/format/fixtures/mnx/repeats-more-once-repeated.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let repeat_texts: Vec<&str> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawText { text, font, .. } = c {
                if font == "serif" && text.ends_with('x') {
                    Some(text.as_str())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    assert_eq!(
        repeat_texts.len(),
        1,
        "Expected exactly 1 repeat count label, got {:?}",
        repeat_texts
    );
    assert_eq!(
        repeat_texts[0], "4x",
        "Expected repeat count '4x', got '{}'",
        repeat_texts[0]
    );
}

#[test]
fn test_repeat_barline_glyph_size() {
    // Repeat barline glyphs should be rendered at 4.0*sp font size.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/repeats.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let glyph_sizes: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph {
                size, codepoint, ..
            } = c
            {
                if is_repeat_barline_glyph_codepoint(*codepoint) {
                    Some(*size)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    assert!(!glyph_sizes.is_empty(), "Expected repeat barline glyphs");
    for s in &glyph_sizes {
        assert!(
            (*s - 4.0 * sp).abs() < 0.01,
            "Repeat barline glyph size {:.2} should be {:.2} (4.0*sp)",
            s,
            4.0 * sp
        );
    }
}

#[test]
fn test_repeat_barlines_use_smufl_glyphs() {
    // Repeat barlines should use SMuFL composite glyphs (not geometric primitives).
    let json = include_str!("../../../../../packages/format/fixtures/mnx/repeats.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let repeat_left_count = dl.commands.iter().filter(|c|
        matches!(c, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::REPEAT_LEFT)
    ).count();
    assert!(
        repeat_left_count >= 1,
        "Expected at least 1 repeatLeft glyph, got {}",
        repeat_left_count
    );

    let repeat_right_count = dl.commands.iter().filter(|c|
        matches!(c, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::REPEAT_RIGHT)
    ).count();
    assert!(
        repeat_right_count >= 1,
        "Expected at least 1 repeatRight glyph, got {}",
        repeat_right_count
    );
}

#[test]
fn test_repeat_start_whole_note_no_collision() {
    // The whole note in a measure with repeat-start should not overlap the barline.
    // The note's x position should be past the repeat barline rightmost extent.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/repeats.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let resolved = resolve_measures(&score, 0);
    let ottavas = resolve_all_ottavas(&resolved);
    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &ottavas, 4.0);

    // The first event should be well past the repeat barline (advance width 1.472sp)
    let first_event_x = ml.voice_layouts[0].events_vec()[0].x;
    let repeat_barline_right_edge = 1.472 * sp;
    assert!(
        first_event_x > repeat_barline_right_edge,
        "First event x={:.2} should be past repeat barline right edge {:.2}",
        first_event_x,
        repeat_barline_right_edge
    );
}

#[test]
fn test_repeat_start_prefix_width_includes_barline() {
    // A measure with repeat-start should have prefix_width that accounts for the barline.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/repeats.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let resolved = resolve_measures(&score, 0);
    let ottavas = resolve_all_ottavas(&resolved);
    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &ottavas, 4.0);

    // prefix_width should include repeat barline width (≥ 1.5sp contribution)
    assert!(
        ml.prefix_width >= 1.5 * sp,
        "prefix_width {:.2} should be ≥ {:.2} for repeat-start measure",
        ml.prefix_width,
        1.5 * sp
    );
}

#[test]
fn test_first_measure_repeat_after_key_signature() {
    // A start-repeat barline on the very first measure of the piece must be
    // engraved AFTER the clef and key signature (immediately before the music),
    // not at the system's left edge.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}, "repeatStart": {}}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let repeat_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::REPEAT_LEFT => {
                Some(*x)
            }
            _ => None,
        })
        .expect("expected a REPEAT_LEFT glyph for the start repeat");

    let max_sharp_x = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. }
                if *codepoint == smufl::ACCIDENTAL_SHARP =>
            {
                Some(*x)
            }
            _ => None,
        })
        .fold(f64::MIN, f64::max);

    assert!(
        repeat_x > max_sharp_x,
        "first-measure repeat barline (x={repeat_x:.2}) must be engraved after \
         the key signature (rightmost sharp x={max_sharp_x:.2})"
    );
}

#[test]
fn test_first_measure_prefix_slots_do_not_overlap() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}, "repeatStart": {}}
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
    let ink_bounds = |codepoints: &[u32]| {
        dl.commands
            .iter()
            .filter_map(|command| match command {
                RenderCommand::DrawGlyph {
                    x, codepoint, size, ..
                } if codepoints.contains(codepoint) => {
                    let (bbox_x, _, bbox_width, _) = smufl::glyph_bbox(*codepoint);
                    let scale = *size / 4.0;
                    Some((x + bbox_x * scale, x + (bbox_x + bbox_width) * scale))
                }
                _ => None,
            })
            .fold(
                (f64::MAX, f64::MIN),
                |(left, right), (glyph_left, glyph_right)| {
                    (left.min(glyph_left), right.max(glyph_right))
                },
            )
    };

    let clef = ink_bounds(&[smufl::G_CLEF]);
    let key = ink_bounds(&[smufl::ACCIDENTAL_SHARP]);
    let time = ink_bounds(&[smufl::time_sig_digit(4)]);
    let repeat = ink_bounds(&[smufl::REPEAT_LEFT]);
    let note = ink_bounds(&[smufl::NOTEHEAD_WHOLE]);

    for (left_name, left, right_name, right) in [
        ("clef", clef, "key signature", key),
        ("key signature", key, "time signature", time),
        ("time signature", time, "repeat start", repeat),
        ("repeat start", repeat, "first note", note),
    ] {
        assert!(
            left.1 <= right.0,
            "{left_name} right ink {:.2} must not overlap {right_name} left ink {:.2}",
            left.1,
            right.0
        );
    }
}

#[test]
fn test_system_start_multimeasure_rest_repeat_after_key_signature() {
    // The user-reported case: a multimeasure rest that opens a new system and
    // carries a start-repeat barline must engrave the repeat AFTER the restated
    // clef and key signature, not at the system's left edge. Mirror the layout
    // of `test_system_start_multimeasure_rest_repeats_clef_and_key`, adding a
    // repeat-start to the measure that opens the second system.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}},
            {"repeatStart": {}}, {}, {}, {}, {}, {}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            },
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        multimeasure_rests: true,
        page_width: Some(320.0),
        ..LayoutConfig::default()
    };
    let dl = layout_score(&score, 0, &config);
    let repeat_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::REPEAT_LEFT => {
                Some(*x)
            }
            _ => None,
        })
        .expect("expected a REPEAT_LEFT glyph on the system-start multimeasure rest");

    // Rightmost sharp on the system-start multimeasure rest (the second system).
    let max_sharp_x = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. }
                if *codepoint == smufl::ACCIDENTAL_SHARP =>
            {
                Some(*x)
            }
            _ => None,
        })
        .fold(f64::MIN, f64::max);

    assert!(
        repeat_x > max_sharp_x,
        "system-start multimeasure-rest repeat barline (x={repeat_x:.2}) must be \
         engraved after the restated key signature (rightmost sharp x={max_sharp_x:.2})"
    );
}

#[test]
fn test_final_barline_uses_primitives() {
    // A score with a final barline should produce a DrawRect (thick bar) + DrawLine (thin bar).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "barline": {"type": "final"}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let rect_count = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawRect { color, .. } if color == "#000000"))
        .count();
    assert!(
        rect_count >= 1,
        "Expected at least 1 DrawRect for final barline thick bar, got {}",
        rect_count
    );
}

#[test]
fn test_volta_brackets_simple() {
    // Load repeats-alternate-endings-simple.mnx which has 3 endings:
    //   measure 1: ending {duration:1, numbers:[1]}, repeatEnd
    //   measure 2: ending {duration:1, numbers:[2]}, repeatEnd
    //   measure 3: ending {duration:1, numbers:[3], open:true}
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/repeats-alternate-endings-simple.mnx"
    );
    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Volta brackets produce DrawText commands with ending labels
    let volta_texts: Vec<(usize, &RenderCommand)> = dl
        .commands
        .iter()
        .enumerate()
        .filter(|(_, c)| {
            matches!(c, RenderCommand::DrawText { text, font, .. }
            if font == "serif bold" && (text == "1." || text == "2." || text == "3."))
        })
        .collect();
    assert_eq!(
        volta_texts.len(),
        3,
        "Expected 3 volta bracket labels (1., 2., 3.), got {}",
        volta_texts.len()
    );
    for (text_index, text) in &volta_texts {
        let RenderCommand::DrawText {
            y, size, baseline, ..
        } = text
        else {
            unreachable!();
        };
        assert!(
            (*size - 1.5 * sp).abs() < 0.01,
            "volta number should use larger 1.5sp type"
        );
        assert!(
            matches!(baseline, TextBaseline::Top),
            "volta number should grow below its anchor"
        );
        let eid = dl.element_ids[*text_index].as_deref().unwrap();
        let bracket_y = dl
            .commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| {
                if dl.element_ids[index].as_deref() != Some(eid) {
                    return None;
                }
                match command {
                    RenderCommand::DrawLine { y1, y2, .. } if (*y1 - *y2).abs() < 0.01 => Some(*y1),
                    _ => None,
                }
            })
            .expect("volta horizontal line");
        assert!(
            *y > bracket_y,
            "volta number must sit below the horizontal line"
        );
    }

    // Volta brackets produce tagged horizontal top lines.
    let volta_horiz_lines: Vec<(usize, &RenderCommand)> = dl
        .commands
        .iter()
        .enumerate()
        .filter(|c| {
            matches!(c.1, RenderCommand::DrawLine { y1, y2, .. } if (*y1 - *y2).abs() < 0.01)
                && dl.element_ids[c.0]
                    .as_deref()
                    .is_some_and(|id| id.ends_with("/volta"))
        })
        .collect();
    assert_eq!(
        volta_horiz_lines.len(),
        3,
        "Expected 3 horizontal volta bracket lines, got {}",
        volta_horiz_lines.len()
    );

    // Volta brackets have tagged vertical hooks.
    let volta_hooks: Vec<(usize, &RenderCommand)> = dl
        .commands
        .iter()
        .enumerate()
        .filter(|c| {
            matches!(c.1, RenderCommand::DrawLine { x1, x2, .. } if (*x1 - *x2).abs() < 0.01)
                && dl.element_ids[c.0]
                    .as_deref()
                    .is_some_and(|id| id.ends_with("/volta"))
        })
        .collect();
    // Endings 1, 2: left + right hooks = 4; Ending 3 (open): left hook only = 1 → total 5
    assert_eq!(
        volta_hooks.len(),
        5,
        "Expected 5 volta hooks (2+2+1 for closed+closed+open), got {}",
        volta_hooks.len()
    );

    // Every horizontal begins left of its left hook center, creating real ink
    // overlap instead of two butt-capped strokes merely touching centerlines.
    for (line_index, line) in volta_horiz_lines {
        let eid = dl.element_ids[line_index].as_deref().unwrap();
        let RenderCommand::DrawLine { x1, y1, .. } = line else {
            unreachable!();
        };
        let left_hook_x = volta_hooks
            .iter()
            .filter(|(index, _)| dl.element_ids[*index].as_deref() == Some(eid))
            .filter_map(|(_, hook)| match hook {
                RenderCommand::DrawLine { x1, y1: hook_y, .. } if (*hook_y - *y1).abs() < 0.01 => {
                    Some(*x1)
                }
                _ => None,
            })
            .fold(f64::INFINITY, f64::min);
        assert!(
            *x1 < left_hook_x,
            "volta top line must overlap its left hook"
        );
    }
}

#[test]
fn test_volta_brackets_advanced() {
    // Load repeats-alternate-endings-advanced.mnx which has:
    //   measure 1: ending {duration:2, numbers:[1,2]} — multi-value "1, 2."
    //   measure 3: ending {duration:2, numbers:[3], open:true} — single "3."
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/repeats-alternate-endings-advanced.mnx"
    );
    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Multi-value label should be "1, 2." (comma-separated, single trailing period)
    let volta_texts: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawText { font, .. } if font == "serif bold"))
        .collect();
    let labels: Vec<&str> = volta_texts
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawText { text, .. } = c {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect();
    assert!(
        labels.contains(&"1, 2."),
        "Expected multi-value label '1, 2.' in volta texts, got {:?}",
        labels
    );
    assert!(
        labels.contains(&"3."),
        "Expected label '3.' in volta texts, got {:?}",
        labels
    );

    // Should have 2 brackets total (2 horizontal lines)
    let volta_horiz_lines: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            (matches!(command, RenderCommand::DrawLine { y1, y2, .. } if (*y1 - *y2).abs() < 0.01)
                && dl.element_ids[index]
                    .as_deref()
                    .is_some_and(|id| id.ends_with("/volta")))
            .then_some(command)
        })
        .collect();
    assert_eq!(
        volta_horiz_lines.len(),
        2,
        "Expected 2 horizontal volta bracket lines, got {}",
        volta_horiz_lines.len()
    );

    // First ending (closed): left + right hooks = 2; second (open): left only = 1 → total 3
    let volta_hooks: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            (matches!(command, RenderCommand::DrawLine { x1, x2, .. } if (*x1 - *x2).abs() < 0.01)
                && dl.element_ids[index]
                    .as_deref()
                    .is_some_and(|id| id.ends_with("/volta")))
            .then_some(command)
        })
        .collect();
    assert_eq!(
        volta_hooks.len(),
        3,
        "Expected 3 volta hooks (2 for closed + 1 for open), got {}",
        volta_hooks.len()
    );
}

#[test]
fn test_volta_bracket_avoids_high_note_collisions() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {
                "time": {"count": 4, "unit": 4},
                "ending": {"duration": 2, "numbers": [1]}
            },
            {"repeatEnd": {}}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 6}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 6}}]}
                ]}]
            },
            {
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "rest": {}}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    let highest_note_y = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph { codepoint, y, .. } = c {
                if *codepoint == smufl::NOTEHEAD_BLACK {
                    return Some(*y);
                }
            }
            None
        })
        .fold(f64::INFINITY, f64::min);

    let bracket_y = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = c {
                // Horizontal line above the staff with meaningful span = volta top line
                if (*y1 - *y2).abs() < 0.01
                    && (*x2 - *x1) > 3.0 * sp
                    && *y1 < config.margin_top * sp
                {
                    return Some(*y1);
                }
            }
            None
        })
        .fold(f64::INFINITY, f64::min);

    assert!(
        highest_note_y.is_finite(),
        "expected noteheads in test score"
    );
    assert!(
        bracket_y.is_finite(),
        "expected volta horizontal line in test score"
    );
    assert!(
        bracket_y < highest_note_y - 0.5 * sp,
        "volta bracket should be above highest notehead: bracket_y={:.2}, highest_note_y={:.2}",
        bracket_y,
        highest_note_y,
    );
}

#[test]
fn test_alternate_endings_share_same_elevation() {
    // Two consecutive alternate endings should align on a single shared Y,
    // even when local note density differs between ending spans.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"ending": {"duration": 1, "numbers": [1]}, "repeatEnd": {}},
            {"ending": {"duration": 1, "numbers": [2], "open": true}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "rest": {}}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 6}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 6}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 6}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 6}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 6}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 6}}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "rest": {}}
            ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    let bracket_y_values: Vec<f64> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, c)| {
            if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = c {
                if (*y1 - *y2).abs() < 0.01
                    && (*x2 - *x1) > 1.5 * sp
                    && dl.element_ids[index]
                        .as_deref()
                        .is_some_and(|id| id.ends_with("/volta"))
                {
                    return Some(*y1);
                }
            }
            None
        })
        .collect();

    assert!(
        bracket_y_values.len() >= 2,
        "expected two volta horizontal lines"
    );
    let min_y = bracket_y_values
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let max_y = bracket_y_values
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(
        (max_y - min_y).abs() < 0.01,
        "alternate ending brackets should share one elevation, got y values {:?}",
        bracket_y_values,
    );
}

#[test]
fn test_volta_brackets_tagged_with_element_ids() {
    // Volta bracket render commands should be tagged with "m{index}/volta" element IDs
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/repeats-alternate-endings-simple.mnx"
    );
    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all element IDs that match the volta pattern
    let volta_ids: HashSet<String> = dl
        .element_ids
        .iter()
        .filter_map(|opt| opt.as_ref())
        .filter(|id| id.contains("/volta"))
        .cloned()
        .collect();

    // The simple alternate endings file has endings on 3 measures
    assert!(
        volta_ids.len() >= 3,
        "Expected at least 3 distinct volta element IDs, got {:?}",
        volta_ids
    );

    // Each volta ID should follow the "m{index}/volta" pattern
    for id in &volta_ids {
        assert!(
            id.starts_with("m") && id.ends_with("/volta"),
            "Volta element ID '{}' should match 'm{{index}}/volta' pattern",
            id
        );
    }

    // Verify that volta text commands are tagged
    for (i, cmd) in dl.commands.iter().enumerate() {
        if let RenderCommand::DrawText { text, font, .. } = cmd {
            if font == "serif" && (text == "1." || text == "2." || text == "3.") {
                let tag = dl.element_ids.get(i).and_then(|o| o.as_ref());
                assert!(
                    tag.is_some() && tag.unwrap().contains("/volta"),
                    "Volta text '{}' at index {} should be tagged with a volta element ID",
                    text,
                    i
                );
            }
        }
    }
}

// ── Measure repeats (simile marks) ──────────────────────────────────

fn measure_repeat_score(repeat_json: &str) -> String {
    format!(
        r#"{{
        "mnx": {{"version": 1}},
        "global": {{"measures": [
            {{"time": {{"count": 4, "unit": 4}}}},
            {{}},
            {{}}
        ]}},
        "parts": [{{"measures": [
            {{
                "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                "sequences": [{{"content": [
                    {{"duration": {{"base": "whole"}}, "notes": [{{"pitch": {{"step": "C", "octave": 5}}}}]}}
                ]}}]
            }},
            {{"measureRepeat": {repeat_json}, "sequences": [{{"content": []}}]}},
            {{"sequences": [{{"content": [
                {{"duration": {{"base": "whole"}}, "notes": [{{"pitch": {{"step": "G", "octave": 4}}}}]}}
            ]}}]}}
        ]}}]
    }}"#
    )
}

fn measure_repeat_span_score(span: u32) -> String {
    let measure_count = span * 2;
    let global = (0..measure_count)
        .map(|index| {
            if index == 0 {
                r#"{"time":{"count":4,"unit":4}}"#.to_owned()
            } else {
                "{}".to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(",");
    let parts = (0..measure_count)
        .map(|index| {
            if index < span {
                r#"{"sequences":[{"content":[{"duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":5}}]}]}]}"#
                    .to_owned()
            } else if index == span {
                format!(
                    r#"{{"measureRepeat":{{"number":{span}}},"sequences":[{{"content":[],"fullMeasure":{{"visualDuration":{{"base":"whole"}}}}}}]}}"#
                )
            } else {
                r#"{"sequences":[{"content":[],"fullMeasure":{"visualDuration":{"base":"whole"}}}]}"#
                    .to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        r#"{{"mnx":{{"version":1}},"global":{{"measures":[{global}]}},"parts":[{{"measures":[{parts}]}}]}}"#
    )
}

fn drawn_codepoints(dl: &DisplayList) -> Vec<u32> {
    dl.commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. } => Some(*codepoint),
            _ => None,
        })
        .collect()
}

fn top_staff_y(dl: &DisplayList, sp: f64) -> f64 {
    dl.commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawLine { y1, y2, x1, x2, .. }
                if (y1 - y2).abs() < 0.01 && (x2 - x1).abs() > sp =>
            {
                Some(*y1)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min)
}

fn measure_repeat_text<'a>(dl: &'a DisplayList, expected: &str) -> Option<(&'a str, f64)> {
    dl.commands.iter().enumerate().find_map(|(index, command)| {
        let is_repeat = dl
            .element_ids
            .get(index)
            .and_then(Option::as_deref)
            .is_some_and(|id| id.ends_with("/measurerepeat"));
        match command {
            RenderCommand::DrawText { text, font, y, .. } if is_repeat && text == expected => {
                Some((font.as_str(), *y))
            }
            _ => None,
        }
    })
}

/// A one-bar simile draws the single-bar slash and, by convention, no count.
#[test]
fn test_measure_repeat_one_bar_renders_slash_without_count() {
    let score = parse_mnx(&measure_repeat_score(r#"{"number": 1}"#)).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let glyphs = drawn_codepoints(&dl);
    assert_eq!(
        glyphs.iter().filter(|c| **c == smufl::REPEAT_1_BAR).count(),
        1,
        "one-bar simile should draw repeat1Bar exactly once"
    );
    assert!(
        !glyphs.contains(&smufl::time_sig_digit(1)),
        "a one-bar simile should not print a count above the staff"
    );
    assert!(
        dl.element_bboxes
            .iter()
            .any(|bbox| bbox.element_id.ends_with("/measurerepeat")),
        "measure-repeat sign should publish a selectable bounding box"
    );
}

/// A multi-bar simile uses the wider precomposed glyph and prints its span.
#[test]
fn test_measure_repeat_two_bars_renders_count() {
    let score = parse_mnx(&measure_repeat_score(r#"{"number": 2}"#)).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let glyphs = drawn_codepoints(&dl);
    assert!(
        glyphs.contains(&smufl::REPEAT_2_BARS),
        "two-bar simile should draw repeat2Bars"
    );
    assert!(
        glyphs.contains(&smufl::time_sig_digit(2)),
        "repeat span should use the multimeasure-rest numeral style"
    );
    assert!(
        measure_repeat_text(&dl, "2").is_none(),
        "repeat span should not use the regular counter font"
    );
    let numeral_y = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let is_repeat = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/measurerepeat"));
            match command {
                RenderCommand::DrawGlyph { y, codepoint, .. }
                    if is_repeat && *codepoint == smufl::time_sig_digit(2) =>
                {
                    Some(*y)
                }
                _ => None,
            }
        })
        .expect("two-bar span numeral should be tagged with the repeat");
    let (_, bbox_y, _, bbox_height) = smufl::glyph_bbox(smufl::time_sig_digit(2));
    let ink_bottom = numeral_y + (bbox_y + bbox_height) * config.sp;
    let staff_y = top_staff_y(&dl, config.sp);
    assert!(
        (staff_y - ink_bottom - config.sp).abs() < 0.01,
        "span numeral should clear the staff by 1sp: staff={staff_y:.1}, bottom={ink_bottom:.1}"
    );
}

/// `displayNumber` overrides the convention in both directions.
#[test]
fn test_measure_repeat_display_number_override() {
    let shown = parse_mnx(&measure_repeat_score(
        r#"{"number": 1, "displayNumber": "yes"}"#,
    ))
    .unwrap();
    let dl = layout_score(&shown, 0, &LayoutConfig::default());
    assert!(
        drawn_codepoints(&dl).contains(&smufl::time_sig_digit(1)),
        "displayNumber: yes should print the count on a one-bar simile"
    );

    let hidden = parse_mnx(&measure_repeat_score(
        r#"{"number": 2, "displayNumber": "no"}"#,
    ))
    .unwrap();
    let dl = layout_score(&hidden, 0, &LayoutConfig::default());
    assert!(
        !drawn_codepoints(&dl).contains(&smufl::time_sig_digit(2)),
        "displayNumber: no should suppress the count on a multi-bar simile"
    );
}

/// Two- and four-bar signs centre across the complete covered range.
#[test]
fn test_measure_repeat_centers_across_covered_bar_range() {
    for (span, codepoint) in [(2, smufl::REPEAT_2_BARS), (4, smufl::REPEAT_4_BARS)] {
        let score = parse_mnx(&measure_repeat_span_score(span)).unwrap();
        let config = LayoutConfig::default();
        let dl = layout_score(&score, 0, &config);
        let start_index = span as usize;
        let start = dl
            .measure_bounds
            .iter()
            .find(|bounds| bounds.index == start_index)
            .expect("repeat start measure should have bounds");
        let end = dl
            .measure_bounds
            .iter()
            .find(|bounds| bounds.index == span as usize * 2 - 1)
            .expect("repeat end measure should have bounds");
        let (glyph_x, _, glyph_width, _) = smufl::glyph_bbox(codepoint);
        let rendered_center = dl
            .commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph {
                    x,
                    codepoint: drawn,
                    ..
                } if *drawn == codepoint => Some(*x + (glyph_x + glyph_width / 2.0) * config.sp),
                _ => None,
            })
            .expect("repeat sign should be drawn");
        let expected_center = (start.x + end.x + end.width) / 2.0;
        assert!(
            (rendered_center - expected_center).abs() < 0.01,
            "{span}-bar sign center ({rendered_center:.1}) should span the covered range ({expected_center:.1})"
        );
        let rests = drawn_codepoints(&dl)
            .into_iter()
            .filter(|codepoint| (smufl::REST_MAXIMA..=smufl::REST_1024TH).contains(codepoint))
            .count();
        assert_eq!(
            rests, 0,
            "all {span} authored bar rests covered by the repeat should be hidden"
        );
    }
}

/// The iteration counter prints above the staff, clear of the staff lines.
#[test]
fn test_measure_repeat_counter_renders_above_staff() {
    let score = parse_mnx(&measure_repeat_score(
        r#"{"number": 1, "counter": {"count": 3, "orient": "above"}}"#,
    ))
    .unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let (font, counter_y) = measure_repeat_text(&dl, "3").expect("counter number should be drawn");
    assert_eq!(
        font, "serif",
        "repeat counter should use the regular text face"
    );
    let sign_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { y, codepoint, .. } if *codepoint == smufl::REPEAT_1_BAR => {
                Some(*y)
            }
            _ => None,
        })
        .expect("simile sign should be drawn");
    let staff_y = top_staff_y(&dl, LayoutConfig::default().sp);
    assert!(
        (staff_y - counter_y - LayoutConfig::default().sp).abs() < 0.01,
        "standalone counter ink bottom should clear the staff by 1sp"
    );
    assert!(
        counter_y < sign_y,
        "counter ({counter_y:.1}) should sit above the simile sign ({sign_y:.1})"
    );
}

/// When both a span numeral and iteration counter are shown, the counter stacks
/// 1sp above the numeral's ink top.
#[test]
fn test_measure_repeat_counter_stacks_above_span_number() {
    let score = parse_mnx(&measure_repeat_score(
        r#"{"number": 2, "counter": {"count": 3, "orient": "above"}}"#,
    ))
    .unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let (_, counter_bottom) =
        measure_repeat_text(&dl, "3").expect("iteration counter should be drawn");
    let span_origin = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let is_repeat = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/measurerepeat"));
            match command {
                RenderCommand::DrawGlyph { y, codepoint, .. }
                    if is_repeat && *codepoint == smufl::time_sig_digit(2) =>
                {
                    Some(*y)
                }
                _ => None,
            }
        })
        .expect("span numeral should be drawn");
    let (_, bbox_y, _, _) = smufl::glyph_bbox(smufl::time_sig_digit(2));
    let span_ink_top = span_origin + bbox_y * config.sp;

    assert!(
        (span_ink_top - counter_bottom - config.sp).abs() < 0.01,
        "counter bottom should sit 1sp above span numeral top: counter={counter_bottom:.1}, span_top={span_ink_top:.1}"
    );
}

/// The sign straddles the middle staff line and centres in the measure.
#[test]
fn test_measure_repeat_centered_on_middle_staff_line() {
    let score = parse_mnx(&measure_repeat_score(r#"{"number": 1}"#)).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let (sign_x, sign_y) = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if *codepoint == smufl::REPEAT_1_BAR => Some((*x, *y)),
            _ => None,
        })
        .expect("simile sign should be drawn");

    let staff_y = top_staff_y(&dl, sp);
    assert!(
        (sign_y - (staff_y + 2.0 * sp)).abs() < 0.01,
        "sign baseline ({sign_y:.1}) should sit on the middle staff line ({:.1})",
        staff_y + 2.0 * sp
    );
    let repeat_measure = dl
        .measure_bounds
        .iter()
        .find(|bounds| bounds.index == 1)
        .expect("repeat measure should have bounds");
    let (bbox_x, _, bbox_width, _) = smufl::glyph_bbox(smufl::REPEAT_1_BAR);
    let rendered_center = sign_x + (bbox_x + bbox_width / 2.0) * sp;
    let expected_center = repeat_measure.x + repeat_measure.width / 2.0;
    assert!(
        (rendered_center - expected_center).abs() < 0.01,
        "one-bar sign should center between barlines: rendered={rendered_center:.1}, expected={expected_center:.1}"
    );
}

/// Bars a multi-bar simile covers stay blank: the sign stands in for their
/// music, so the reconciler must not fill them with rests.
#[test]
fn test_measure_repeat_covered_bar_has_no_rest() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {},
            {},
            {}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            },
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]},
            {"measureRepeat": {"number": 2}, "sequences": [
                {"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
            ]},
            {"sequences": [
                {"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
            ]}
        ]}]
    }"#;
    let mut score = parse_mnx(json).unwrap();
    // Rest filling happens in reconciliation, which every WASM entry point runs
    // before layout.
    crate::reconcile::reconcile_score(&mut score);
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let rests = drawn_codepoints(&dl)
        .into_iter()
        .filter(|c| (smufl::REST_MAXIMA..=smufl::REST_1024TH).contains(c))
        .count();
    assert_eq!(
        rests, 0,
        "neither the simile bar nor the bar it covers should print a rest"
    );
}

/// A repeat sign suppresses pre-existing bar-rest notation as well as rests the
/// reconciler would otherwise synthesize.
#[test]
fn test_measure_repeat_hides_authored_bar_rest() {
    let sequence_forms = [
        r#"{"content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}"#,
        r#"{"content": [{"duration": {"base": "whole"}, "rest": {}}]}"#,
    ];

    for sequence in sequence_forms {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
                "parts": [{{"measures": [{{
                    "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                    "measureRepeat": {{"number": 1}},
                    "sequences": [{sequence}]
                }}]}}]
            }}"#
        );
        let score = parse_mnx(&json).unwrap();
        let dl = layout_score(&score, 0, &LayoutConfig::default());
        let rests = drawn_codepoints(&dl)
            .into_iter()
            .filter(|codepoint| (smufl::REST_MAXIMA..=smufl::REST_1024TH).contains(codepoint))
            .count();
        assert_eq!(
            rests, 0,
            "a measure repeat should hide authored bar-rest notation"
        );
        assert!(
            drawn_codepoints(&dl).contains(&smufl::REPEAT_1_BAR),
            "the measure-repeat sign should remain visible"
        );
    }
}

// Auto-generated from tests.rs — test_full_score
// 10 test(s)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::spacing::{build_merged_log_spacing_for_part_measures, rigid_delta_before};
use crate::layout::staff_brace::{brace_design_width, is_brace_glyph};
use crate::layout::{layout_full_score, layout_score, layout_with_mnx_scores};
use crate::parse::parse_mnx;
use crate::render::*;

#[test]
fn test_full_score_layout_parts() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/parts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let dl = layout_full_score(&score, &config);

    assert_eq!(score.parts.len(), 2, "parts.mnx should have 2 parts");

    // Full score should be taller than a single part
    let single = layout_score(&score, 0, &config);
    assert!(
        dl.height > single.height,
        "Full score height ({}) should exceed single part height ({})",
        dl.height,
        single.height
    );

    // Expected height: 2*margin_top*sp + 2*staff_height + 1*inter_staff_gap (7sp)
    let staff_height = 4.0 * sp;
    let inter_staff_gap = 7.0 * sp;
    let expected_height = config.margin_top * sp * 2.0 + 2.0 * staff_height + inter_staff_gap;
    assert!(
        (dl.height - expected_height).abs() < 0.01,
        "Full score height {} should be ~{}",
        dl.height,
        expected_height
    );

    // Should contain commands from both parts (at least 2× staff lines = 10 lines)
    let line_count = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, crate::render::RenderCommand::DrawLine { .. }))
        .count();
    assert!(
        line_count >= 10,
        "Full score should have at least 10 staff lines, got {}",
        line_count
    );

    // Should contain part name labels as DrawText commands
    let text_cmds: Vec<&RenderCommand> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawText { text, .. } if text == "Melody" || text == "Harmony")
    }).collect();
    assert_eq!(
        text_cmds.len(),
        2,
        "Full score should have 2 part name labels, got {}",
        text_cmds.len()
    );

    // Should have system barlines connecting staves (vertical lines in the gap)
    let system_barline_count = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = cmd {
                // Vertical lines in the inter-staff gap
                (x1 - x2).abs() < 0.01
                    && *y1 < *y2
                    && *y1 >= config.margin_top * sp + staff_height - 0.01
                    && *y2 <= config.margin_top * sp + staff_height + inter_staff_gap + 0.01
            } else {
                false
            }
        })
        .count();
    assert!(
        system_barline_count >= 1,
        "Full score should have system barlines connecting staves, got {}",
        system_barline_count
    );
}

#[test]
fn test_full_score_bracket_rendering() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/parts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let dl = layout_full_score(&score, &config);

    // Bracket consists of:
    // - 2 DrawGlyph commands (bracketTop U+E003 + bracketBottom U+E004)
    // - 1 DrawRect command (vertical connecting rectangle — sharp corners)
    // per SMuFL spec Section 4.1
    let margin_left = config.margin_left * sp + 6.0 * sp; // label_margin = 6sp
    let bracket_x = margin_left - 0.7 * sp;

    let bracket_glyphs: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph { x, codepoint, .. } = cmd {
                (*x - bracket_x).abs() < 0.01 && (*codepoint == 0xE003 || *codepoint == 0xE004)
            } else {
                false
            }
        })
        .collect();

    let bracket_rects: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawRect { x, .. } = cmd {
                (*x - bracket_x).abs() < 0.01
            } else {
                false
            }
        })
        .collect();

    assert!(
        bracket_glyphs.len() >= 2,
        "Expected at least 2 bracket terminal glyphs (top + bottom), got {}",
        bracket_glyphs.len()
    );
    assert!(
        !bracket_rects.is_empty(),
        "Expected at least 1 bracket vertical rect, got {}",
        bracket_rects.len()
    );
}

#[test]
fn test_full_score_abbreviated_labels() {
    // Multi-part score with page_width to force multiple systems
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{}, {}, {}, {}, {}, {}, {}, {}]},
        "parts": [
            {"name": "Violin", "measures": [
                {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                 "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}]}]}
            ]},
            {"name": "Cello", "measures": [
                {"clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                 "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 3}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 3}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 3}}]}]}]},
                {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]}
            ]}
        ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let mut config = LayoutConfig::default();
    config.page_width = Some(30.0 * config.sp); // very narrow page to force multiple systems
    config.page_margin_left = 0.0;
    config.page_margin_right = 0.0;

    let dl = layout_full_score(&score, &config);

    // First system should have full names
    let full_violin: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "Violin"))
        .collect();
    assert_eq!(
        full_violin.len(),
        1,
        "Expected 1 full 'Violin' label on first system"
    );

    let full_cello: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "Cello"))
        .collect();
    assert_eq!(
        full_cello.len(),
        1,
        "Expected 1 full 'Cello' label on first system"
    );

    // Subsequent systems should have abbreviated names
    let abbrev_violin: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "Vln."))
        .collect();
    assert!(
        !abbrev_violin.is_empty(),
        "Expected abbreviated 'Vln.' labels on non-first systems, got {}",
        abbrev_violin.len()
    );

    let abbrev_cello: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "Vc."))
        .collect();
    assert!(
        !abbrev_cello.is_empty(),
        "Expected abbreviated 'Vc.' labels on non-first systems, got {}",
        abbrev_cello.len()
    );
}

#[test]
fn test_full_score_multi_system_vertical_spacing() {
    // Use narrow page_width to force multi-system layout
    let json = include_str!("../../../../../packages/format/fixtures/mnx/parts.mnx");
    let score = parse_mnx(json).unwrap();
    let mut config = LayoutConfig::default();
    let sp = config.sp;
    config.page_width = Some(20.0 * sp); // very narrow to force line breaks
    config.page_margin_left = 0.0;
    config.page_margin_right = 0.0;

    let dl = layout_full_score(&score, &config);

    // With 2 parts, each system has staff_height(4sp)*2 + inter_staff_gap(7sp) = 15sp
    let staff_height = 4.0 * sp;
    let inter_staff_gap = 7.0 * sp;
    let single_system_height = 2.0 * staff_height + inter_staff_gap;

    // Multiple systems should be vertically offset
    // Collect distinct staff-line Y positions (horizontal lines spanning > 50px)
    let staff_line_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = cmd {
                if (y1 - y2).abs() < 0.01 && (x2 - x1).abs() > 50.0 {
                    Some(*y1)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    // Should have more than 10 staff lines (2 parts × 5 lines × ≥1 system)
    assert!(
        staff_line_ys.len() >= 10,
        "Expected at least 10 staff lines for multi-system 2-part score, got {}",
        staff_line_ys.len()
    );

    // Total height should accommodate multiple systems
    assert!(
        dl.height > single_system_height + config.margin_top * sp * 2.0,
        "Height {} should be more than one system",
        dl.height
    );
}

#[test]
fn test_full_score_page_breaks_multi_system() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/parts.mnx");
    let score = parse_mnx(json).unwrap();
    let mut config = LayoutConfig::default();
    let sp = config.sp;
    config.page_width = Some(30.0 * sp); // very narrow to force many systems

    let dl = layout_full_score(&score, &config);

    // Should have page break information
    assert!(
        !dl.pages.is_empty(),
        "Multi-system full score should have page layouts"
    );
    assert_eq!(
        dl.pages[0].system_indices[0], 0,
        "First page should start at system 0"
    );
}

#[test]
fn test_beam_valid_position_rejects_floater() {
    use crate::layout::beams::is_valid_beam_position;
    // Floater positions (qs % 4 == 2 after +8 offset) should be invalid inside staff
    assert!(
        !is_valid_beam_position(true, 2, true, true, false, 5, true),
        "Floater at qs=2 should be rejected"
    );
    assert!(
        !is_valid_beam_position(true, 6, false, true, false, 5, true),
        "Floater at qs=6 should be rejected"
    );
}

#[test]
fn test_beam_slope_constraint_flat_for_inner_extreme() {
    use crate::layout::beams::{get_slope_constraint, SlopeConstraint};
    // When an inner note is more extreme than both endpoints → FLAT
    // Stem up: inner note at line 0 (highest), endpoints at 4 and 6
    let lines = vec![4, 0, 6];
    assert_eq!(
        get_slope_constraint(&lines, true, 4, 6),
        SlopeConstraint::Flat,
        "Inner note beyond endpoints should force flat beam"
    );
}

#[test]
fn test_full_score_page_aware_y_positions() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/parts.mnx");
    let score = parse_mnx(json).unwrap();
    let mut config = LayoutConfig::default();
    let sp = config.sp;
    config.page_width = Some(25.0 * sp);
    config.page_height = 40.0; // short page
    config.page_margin_top = 2.0;
    config.page_margin_bottom = 2.0;

    let dl = layout_full_score(&score, &config);

    assert!(!dl.pages.is_empty(), "Should have at least 1 page");

    if dl.pages.len() > 1 {
        let expected_height = dl.pages.last().map_or(0.0, |p| p.y_offset + p.height);
        assert!(
            (dl.height - expected_height).abs() < 0.01,
            "DisplayList height {} should match page extent {}",
            dl.height,
            expected_height
        );
    }
}

#[test]
fn test_score_index_out_of_range_falls_back() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // Score index 99 should fall back to layout_full_score
    let dl = layout_with_mnx_scores(&score, &config, 99);
    assert!(
        !dl.commands.is_empty(),
        "Out-of-range score_index should produce output via fallback"
    );
}

#[test]
fn test_multi_part_grand_staff_brace_position() {
    // orchestral-layout.mnx has MNX layouts with braces for grand staff groups
    use crate::layout::layout_with_mnx_scores;

    let json = include_str!("../../../../../packages/format/fixtures/mnx/orchestral-layout.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // Score index 0 should render the first layout with braces
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Find all brace glyphs
    let brace_cmds: Vec<_> = dl.commands.iter().filter(|c| {
        matches!(c, RenderCommand::DrawStretchedGlyph { codepoint, .. } if is_brace_glyph(*codepoint))
    }).collect();

    let _sp = config.sp;

    for cmd in &brace_cmds {
        if let RenderCommand::DrawStretchedGlyph {
            x: brace_x,
            size: brace_font_size,
            scale_x,
            codepoint,
            ..
        } = cmd
        {
            let design_width = brace_design_width(*codepoint);
            let glyph_right_edge = brace_x + design_width * brace_font_size / 4.0 * scale_x;
            // The brace should not extend past any reasonable system start position
            // Just verify it's placed to the LEFT of its start, not overlapping to the right
            assert!(
                glyph_right_edge < brace_x + brace_font_size,
                "Brace glyph right edge should be reasonable"
            );
            // Ensure the brace is placed with adequate left offset
            assert!(
                *brace_x >= 0.0,
                "Brace x ({:.2}) should be non-negative",
                brace_x
            );
        }
    }
}

#[test]
fn test_full_score_cross_staff_uses_target_staff_y() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {
                "name": "Piano",
                "id": "P1",
                "staves": 2,
                "measures": [{
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"duration": {"base": "whole"}, "rest": {}}]},
                        {"staff": 2, "content": [
                            {"duration": {"base": "quarter"}, "staff": 1, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                            {"duration": {"base": "quarter"}, "rest": {}},
                            {"duration": {"base": "half"}, "rest": {}}
                        ]}
                    ]
                }]
            },
            {
                "name": "Bass",
                "id": "P2",
                "measures": [{
                    "sequences": [{
                        "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 2}}]}]
                    }]
                }]
            }
        ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_full_score(&score, &config);

    let top_staff_y = config.margin_top * sp;
    let top_staff_noteheads = dl
        .commands
        .iter()
        .filter(|c| {
            if !is_notehead_glyph(c) {
                return false;
            }
            let y_val = match c {
                RenderCommand::DrawGlyph { y, .. } => *y,
                RenderCommand::DrawEllipse { cy, .. } => *cy,
                _ => return false,
            };
            y_val >= top_staff_y - 0.5 * sp && y_val <= top_staff_y + 4.5 * sp
        })
        .count();

    assert!(
        top_staff_noteheads >= 1,
        "Expected a cross-staff notehead on the top staff"
    );
}

#[test]
fn test_mnx_layout_cross_staff_uses_target_staff_y() {
    let json = r#"{
        "mnx": {
            "version": 1,
            "layouts": [{
                "id": "L1",
                "content": [
                    {"type": "staff", "sources": [{"part": "P1", "staff": 1}]},
                    {"type": "staff", "sources": [{"part": "P1", "staff": 2}]}
                ]
            }],
            "scores": [{"layout": "L1"}]
        },
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "id": "P1",
            "name": "Piano",
            "staves": 2,
            "measures": [{
                "clefs": [
                    {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                    {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                ],
                "sequences": [
                    {"staff": 1, "content": [{"duration": {"base": "whole"}, "rest": {}}]},
                    {"staff": 2, "content": [
                        {"duration": {"base": "quarter"}, "staff": 1, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                        {"duration": {"base": "quarter"}, "rest": {}},
                        {"duration": {"base": "half"}, "rest": {}}
                    ]}
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let top_staff_y = config.margin_top * sp;
    let top_staff_noteheads = dl
        .commands
        .iter()
        .filter(|c| {
            if !is_notehead_glyph(c) {
                return false;
            }
            let y_val = match c {
                RenderCommand::DrawGlyph { y, .. } => *y,
                RenderCommand::DrawEllipse { cy, .. } => *cy,
                _ => return false,
            };
            y_val >= top_staff_y - 0.5 * sp && y_val <= top_staff_y + 4.5 * sp
        })
        .count();

    assert!(
        top_staff_noteheads >= 1,
        "Expected a cross-staff notehead on the top staff"
    );
}

/// Regression: a cross-staff note in a part that is NOT first in the system
/// must anchor to that part's own staff, not to some earlier part's staff.
///
/// `event.staff` is part-relative, so a naive `offsets[staff - 1]` lookup
/// sends a piano cross-staff note (target staff 1) onto the very first system
/// staff — e.g. a flute — whenever the piano isn't the first part. This test
/// puts a single-staff Flute first and a 2-staff Piano second, with a piano
/// note on the lower staff crossing up to the piano's top staff. The crossed
/// note must land on the piano top staff, never on the flute staff.
#[test]
fn test_full_score_cross_staff_anchors_to_own_part_staff() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {
                "name": "Flute",
                "id": "P1",
                "staves": 1,
                "measures": [{
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]
                }]
            },
            {
                "name": "Piano",
                "id": "P2",
                "staves": 2,
                "measures": [{
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"duration": {"base": "whole"}, "rest": {}}]},
                        {"staff": 2, "content": [
                            {"duration": {"base": "quarter"}, "staff": 1, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                            {"duration": {"base": "quarter"}, "rest": {}},
                            {"duration": {"base": "half"}, "rest": {}}
                        ]}
                    ]
                }]
            }
        ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_full_score(&score, &config);

    // Visual staff Y positions: Flute = staff 0, Piano-top = staff 1.
    let flute_staff_y = dl
        .measure_bounds
        .iter()
        .find(|b| b.staff_index == 0)
        .map(|b| b.y)
        .expect("flute staff bounds");
    let piano_top_staff_y = dl
        .measure_bounds
        .iter()
        .find(|b| b.staff_index == 1)
        .map(|b| b.y)
        .expect("piano top staff bounds");
    assert!(
        piano_top_staff_y > flute_staff_y,
        "piano top staff should sit below the flute staff"
    );

    let in_band = |y: f64, top: f64| y >= top - 0.5 * sp && y <= top + 4.5 * sp;
    let notehead_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { y, .. } if is_notehead_glyph(c) => Some(*y),
            RenderCommand::DrawEllipse { cy, .. } if is_notehead_glyph(c) => Some(*cy),
            _ => None,
        })
        .collect();

    let on_flute = notehead_ys.iter().any(|&y| in_band(y, flute_staff_y));
    let on_piano_top = notehead_ys.iter().any(|&y| in_band(y, piano_top_staff_y));

    assert!(
        on_piano_top,
        "cross-staff piano note should render on the piano top staff"
    );
    assert!(
        !on_flute,
        "cross-staff piano note must NOT render on the flute staff"
    );
}

/// Verify that beats are vertically aligned across parts in full-score layout.
#[test]
fn test_full_score_beat_alignment_across_parts() {
    let json = r#"{"mnx":{"version":1},"global":{"measures":[{"time":{"count":4,"unit":4}}]},"parts":[{"name":"Part1","staves":1,"measures":[{"clefs":[{"clef":{"sign":"G","staffPosition":-2}}],"sequences":[{"content":[{"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":5}}]},{"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":5}}]},{"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":5}}]},{"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"F","octave":5}}]}]}]}]},{"name":"Part2","staves":1,"measures":[{"clefs":[{"clef":{"sign":"G","staffPosition":-2}}],"sequences":[{"content":[{"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":4}}]},{"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":4}}]},{"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"E","octave":4}}]},{"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"F","octave":4}}]},{"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"G","octave":4}}]},{"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"A","octave":4}}]},{"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"B","octave":4}}]},{"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":5}}]}]}]}]}]}"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_full_score(&score, &config);
    let bounds_part0: Vec<_> = dl
        .measure_bounds
        .iter()
        .filter(|b| b.part_index == 0)
        .collect();
    let bounds_part1: Vec<_> = dl
        .measure_bounds
        .iter()
        .filter(|b| b.part_index == 1)
        .collect();
    assert!(!bounds_part0.is_empty() && !bounds_part1.is_empty());
    let b0 = &bounds_part0[0];
    let b1 = &bounds_part1[0];
    assert!(
        (b0.x - b1.x).abs() < 0.01,
        "Measure x: {} vs {}",
        b0.x,
        b1.x
    );
    assert!(
        (b0.width - b1.width).abs() < 0.01,
        "Measure width: {} vs {}",
        b0.width,
        b1.width
    );
    assert!(
        (b0.prefix_width - b1.prefix_width).abs() < 0.01,
        "Prefix width: {} vs {}",
        b0.prefix_width,
        b1.prefix_width
    );
    let x0_p0 = b0
        .beat_anchors
        .iter()
        .find(|(b, _)| *b < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    let x0_p1 = b1
        .beat_anchors
        .iter()
        .find(|(b, _)| *b < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    assert!(
        (x0_p0 - x0_p1).abs() < 0.01,
        "Beat 0 x: part0={:.2} vs part1={:.2}",
        x0_p0,
        x0_p1
    );
    let x2_p0 = b0
        .beat_anchors
        .iter()
        .find(|(b, _)| (*b - 2.0).abs() < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    let x2_p1 = b1
        .beat_anchors
        .iter()
        .find(|(b, _)| (*b - 2.0).abs() < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    assert!(
        (x2_p0 - x2_p1).abs() < 0.01,
        "Beat 2 x: part0={:.2} vs part1={:.2}",
        x2_p0,
        x2_p1
    );
}

/// Verify cross-staff beat alignment via `layout_with_mnx_scores` — the code path
/// the editor actually uses when MNX documents have layouts/scores definitions.
/// Regression test for the auto-flow merged spacing fix in mnx_layout.rs.
#[test]
fn test_mnx_layout_beat_alignment_across_staves() {
    // Two-part score with MNX layouts/scores: Part1 has quarters, Part2 has eighths.
    // Beats at positions 0 and 2 should align vertically.
    let json = r#"{
        "mnx": {
            "version": 1,
            "layouts": [{
                "id": "L1",
                "content": [
                    {"type": "staff", "sources": [{"part": "P1"}]},
                    {"type": "staff", "sources": [{"part": "P2"}]}
                ]
            }],
            "scores": [{"layout": "L1"}]
        },
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {
                "id": "P1",
                "name": "Flute",
                "measures": [{
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                    ]}]
                }]
            },
            {
                "id": "P2",
                "name": "Oboe",
                "measures": [{
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                        {"type":"event","duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                        {"type":"event","duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                        {"type":"event","duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]},
                        {"type":"event","duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                        {"type":"event","duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                        {"type":"event","duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                        {"type":"event","duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                    ]}]
                }]
            }
        ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Get measure bounds per part
    let bounds_p0: Vec<_> = dl
        .measure_bounds
        .iter()
        .filter(|b| b.part_index == 0)
        .collect();
    let bounds_p1: Vec<_> = dl
        .measure_bounds
        .iter()
        .filter(|b| b.part_index == 1)
        .collect();
    assert!(
        !bounds_p0.is_empty() && !bounds_p1.is_empty(),
        "Both parts should have measure bounds"
    );

    let b0 = &bounds_p0[0];
    let b1 = &bounds_p1[0];

    // Measure x, width, and prefix_width should match across parts
    assert!(
        (b0.x - b1.x).abs() < 0.01,
        "MNX layout: Measure x mismatch: part0={:.2} vs part1={:.2}",
        b0.x,
        b1.x
    );
    assert!(
        (b0.width - b1.width).abs() < 0.01,
        "MNX layout: Measure width mismatch: part0={:.2} vs part1={:.2}",
        b0.width,
        b1.width
    );
    assert!(
        (b0.prefix_width - b1.prefix_width).abs() < 0.01,
        "MNX layout: Prefix width mismatch: part0={:.2} vs part1={:.2}",
        b0.prefix_width,
        b1.prefix_width
    );

    // Beat 0 should align
    let x0_p0 = b0
        .beat_anchors
        .iter()
        .find(|(b, _)| *b < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    let x0_p1 = b1
        .beat_anchors
        .iter()
        .find(|(b, _)| *b < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    assert!(
        (x0_p0 - x0_p1).abs() < 0.01,
        "MNX layout: Beat 0 x mismatch: part0={:.2} vs part1={:.2}",
        x0_p0,
        x0_p1
    );

    // Beat 2 should align
    let x2_p0 = b0
        .beat_anchors
        .iter()
        .find(|(b, _)| (*b - 2.0).abs() < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    let x2_p1 = b1
        .beat_anchors
        .iter()
        .find(|(b, _)| (*b - 2.0).abs() < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    assert!(
        (x2_p0 - x2_p1).abs() < 0.01,
        "MNX layout: Beat 2 x mismatch: part0={:.2} vs part1={:.2}",
        x2_p0,
        x2_p1
    );
}

/// Verify beat alignment via `layout_with_mnx_scores` with explicit system definitions.
/// Regression test for the explicit-systems path fix in mnx_layout.rs.
#[test]
fn test_mnx_layout_explicit_systems_beat_alignment() {
    // Two-part score with explicit system definitions containing all measures.
    let json = r#"{
        "mnx": {
            "version": 1,
            "layouts": [{
                "id": "L1",
                "content": [
                    {"type": "staff", "sources": [{"part": "P1"}]},
                    {"type": "staff", "sources": [{"part": "P2"}]}
                ]
            }],
            "scores": [{
                "layout": "L1",
                "pages": [{"systems": [{"measure": 1}]}]
            }]
        },
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}}
        ]},
        "parts": [
            {
                "id": "P1",
                "name": "Violin",
                "measures": [{
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                        {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]}
                    ]}]
                }]
            },
            {
                "id": "P2",
                "name": "Cello",
                "measures": [{
                    "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 3}}]}
                    ]}]
                }]
            }
        ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let bounds_p0: Vec<_> = dl
        .measure_bounds
        .iter()
        .filter(|b| b.part_index == 0)
        .collect();
    let bounds_p1: Vec<_> = dl
        .measure_bounds
        .iter()
        .filter(|b| b.part_index == 1)
        .collect();
    assert!(
        !bounds_p0.is_empty() && !bounds_p1.is_empty(),
        "Both parts should have measure bounds in explicit systems path"
    );

    let b0 = &bounds_p0[0];
    let b1 = &bounds_p1[0];

    assert!(
        (b0.x - b1.x).abs() < 0.01,
        "Explicit systems: Measure x mismatch: part0={:.2} vs part1={:.2}",
        b0.x,
        b1.x
    );
    assert!(
        (b0.width - b1.width).abs() < 0.01,
        "Explicit systems: Measure width mismatch: part0={:.2} vs part1={:.2}",
        b0.width,
        b1.width
    );

    // Beat 0 should align
    let x0_p0 = b0
        .beat_anchors
        .iter()
        .find(|(b, _)| *b < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    let x0_p1 = b1
        .beat_anchors
        .iter()
        .find(|(b, _)| *b < 0.01)
        .map(|(_, x)| *x)
        .unwrap();
    assert!(
        (x0_p0 - x0_p1).abs() < 0.01,
        "Explicit systems: Beat 0 x mismatch: part0={:.2} vs part1={:.2}",
        x0_p0,
        x0_p1
    );
}

/// A mid-measure clef change raises the shared inter-onset gap only by the
/// clearance still missing after normal rhythmic spacing. Every staff uses that
/// same conditional gap, preserving aligned onsets and barlines without adding
/// a fake full-width clef column to the whole score.
#[test]
fn test_mid_measure_clef_change_adds_only_required_global_space() {
    // Part 0 (Flute) changes clef mid-bar at beat 1 (fraction 1/4 = one quarter
    // in). Part 1 (Cello) has no clef change. Layout WITHOUT explicit pages so
    // the auto-flow path runs.
    let with_clef = r#"{
        "mnx": {
            "version": 1,
            "layouts": [{"id": "L1", "content": [
                {"type": "staff", "sources": [{"part": "P1"}]},
                {"type": "staff", "sources": [{"part": "P2"}]}
            ]}],
            "scores": [{"layout": "L1"}]
        },
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"id": "P1", "name": "Flute", "measures": [{
                "clefs": [
                    {"clef": {"sign": "G", "staffPosition": -2}},
                    {"position": {"fraction": [1, 4]}, "clef": {"sign": "F", "staffPosition": 2}}
                ],
                "sequences": [{"content": [
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
                ]}]
            }]},
            {"id": "P2", "name": "Cello", "measures": [{
                "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                "sequences": [{"content": [
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]},
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 3}}]}
                ]}]
            }]}
        ]
    }"#;
    // Same score with the mid-bar clef change removed, to measure the added space.
    let no_clef = with_clef.replace(
        r#",
                    {"position": {"fraction": [1, 4]}, "clef": {"sign": "F", "staffPosition": 2}}"#,
        "",
    );

    let config = LayoutConfig::default();
    let dl = layout_with_mnx_scores(&parse_mnx(with_clef).unwrap(), &config, 0);
    let dl_plain = layout_with_mnx_scores(&parse_mnx(&no_clef).unwrap(), &config, 0);

    let bound = |dl: &crate::render::DisplayList, part: usize| {
        dl.measure_bounds
            .iter()
            .find(|b| b.index == 0 && b.part_index == part)
            .cloned()
            .unwrap()
    };
    let b0 = bound(&dl, 0);
    let b1 = bound(&dl, 1);

    // Barlines aligned: both parts' measure left edge and width identical.
    assert!(
        (b0.x - b1.x).abs() < 0.01,
        "mid-clef measure x must match across parts: part0={:.2} part1={:.2}",
        b0.x,
        b1.x
    );
    assert!(
        (b0.width - b1.width).abs() < 0.01,
        "mid-clef measure width must match across parts (aligned barlines): \
         part0={:.2} part1={:.2}",
        b0.width,
        b1.width
    );

    // Quarter-note springs already provide most of the required clearance. The
    // measure grows globally, but only by the remaining shortfall rather than a
    // fixed 2.5sp column.
    let plain_w = bound(&dl_plain, 1).width;
    let clef_w = b1.width;
    let sp = config.sp;
    let added = clef_w - plain_w;
    assert!(
        added > 0.0 && added < sp,
        "mid-clef change should add only the missing clearance: plain width \
         {plain_w:.2}, with-clef width {clef_w:.2} (added {added:.2}, expected \
         between 0 and {sp:.2})"
    );
}

#[test]
fn test_mid_measure_clef_change_reuses_sufficient_rhythmic_space() {
    let with_clef = r#"{
        "mnx": {
            "version": 1,
            "layouts": [{"id": "L1", "content": [
                {"type": "staff", "sources": [{"part": "P1"}]},
                {"type": "staff", "sources": [{"part": "P2"}]}
            ]}],
            "scores": [{"layout": "L1"}]
        },
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"id": "P1", "measures": [{
                "clefs": [
                    {"clef": {"sign": "G", "staffPosition": -2}},
                    {"position": {"fraction": [1, 2]}, "clef": {"sign": "F", "staffPosition": 2}}
                ],
                "sequences": [{"content": [
                    {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]}]
            }]},
            {"id": "P2", "measures": [{
                "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                "sequences": [{"content": [
                    {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                    {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]}
                ]}]
            }]}
        ]
    }"#;
    let no_clef = with_clef.replace(
        r#",
                    {"position": {"fraction": [1, 2]}, "clef": {"sign": "F", "staffPosition": 2}}"#,
        "",
    );
    let config = LayoutConfig::default();
    let dl = layout_with_mnx_scores(&parse_mnx(with_clef).unwrap(), &config, 0);
    let plain = layout_with_mnx_scores(&parse_mnx(&no_clef).unwrap(), &config, 0);
    let width = |display: &crate::render::DisplayList| {
        display
            .measure_bounds
            .iter()
            .find(|bounds| bounds.index == 0 && bounds.part_index == 1)
            .map(|bounds| bounds.width)
            .unwrap()
    };

    assert!(
        (width(&dl) - width(&plain)).abs() < 0.01,
        "a half-note spring already fits the change clef and must not widen the measure"
    );
}

#[test]
fn test_mid_measure_clef_clearance_targets_owning_staff_onset() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"measures": [{
                "clefs": [
                    {"clef": {"sign": "G", "staffPosition": -2}},
                    {"position": {"fraction": [1, 4]}, "clef": {"sign": "F", "staffPosition": 2}}
                ],
                "sequences": [{"content": [
                    {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]}]
            }]},
            {"measures": [{
                "sequences": [{"content": [
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]},
                    {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 3}}]}
                ]}]
            }]}
        ]
    }"#;
    let score = parse_mnx(json).unwrap();
    let measures = [&score.parts[0].measures[0], &score.parts[1].measures[0]];
    let first_key = crate::model::KeySignature::default();
    let second_key = crate::model::KeySignature::default();
    let keys = [&first_key, &second_key];
    let spacing = build_merged_log_spacing_for_part_measures(
        &measures,
        4.0,
        1.0,
        &LayoutConfig::default(),
        &keys,
    );

    assert!(
        rigid_delta_before(&spacing, 1.0) < 0.01,
        "a sibling onset must not steal the owning staff's clef reservation"
    );
    assert!(
        rigid_delta_before(&spacing, 2.0) > 2.0,
        "the clef reservation must precede the owning staff's next onset"
    );
}

#[test]
fn test_mid_measure_clef_after_leading_space_reserves_before_first_onset() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [
                {"clef": {"sign": "G", "staffPosition": -2}},
                {"position": {"fraction": [1, 4]}, "clef": {"sign": "F", "staffPosition": 2}}
            ],
            "sequences": [{"content": [
                {"type": "space", "duration": [1, 4]},
                {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let measures = [&score.parts[0].measures[0]];
    let key = crate::model::KeySignature::default();
    let spacing = build_merged_log_spacing_for_part_measures(
        &measures,
        4.0,
        1.0,
        &LayoutConfig::default(),
        &[&key],
    );

    assert!(
        rigid_delta_before(&spacing, 1.0) > 2.0,
        "a clef before the first visible onset must retain its own leading column"
    );
}

#[test]
fn test_rhapsody_before_rehearsal_four_piano_bass_clef_clears_adjacent_chords() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: None,
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let previous_suffix = "/s1/019e8ea7-4d51-7249-9f4a-a88b25045e5a";
    let target_suffix = "/s1/019e8ea7-4d51-7958-85ac-c4189114e3be";
    let previous_id = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id.ends_with(previous_suffix))
        .map(|bbox| bbox.element_id.as_str())
        .expect("preceding chord id");
    let target_id = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id.ends_with(target_suffix))
        .map(|bbox| bbox.element_id.as_str())
        .expect("target chord id");
    let glyph_extent = |event_id: &str| {
        dl.commands
            .iter()
            .enumerate()
            .filter_map(|(index, command)| {
                let id = dl.element_ids.get(index).and_then(|id| id.as_deref())?;
                if id != event_id && !id.starts_with(&format!("{event_id}/")) {
                    return None;
                }
                match command {
                    RenderCommand::DrawGlyph {
                        x, codepoint, size, ..
                    } => {
                        let (bbox_x, _, bbox_width, _) =
                            crate::render::smufl::smufl::glyph_bbox(*codepoint);
                        let scale = *size / 4.0;
                        Some((*x + bbox_x * scale, *x + (bbox_x + bbox_width) * scale))
                    }
                    _ => None,
                }
            })
            .fold((f64::INFINITY, f64::NEG_INFINITY), |extent, glyph| {
                (extent.0.min(glyph.0), extent.1.max(glyph.1))
            })
    };
    let previous_right = glyph_extent(previous_id).1;
    let target_left = glyph_extent(target_id).0;
    let midpoint = (previous_right + target_left) * 0.5;
    let (clef_x, clef_codepoint) = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x, codepoint, size, ..
            } if *codepoint == crate::render::smufl::smufl::F_CLEF
                && (*size - 4.0 * config.sp * 2.0 / 3.0).abs() < 0.01 =>
            {
                Some((*x, *codepoint))
            }
            _ => None,
        })
        .min_by(|left, right| {
            (left.0 - midpoint)
                .abs()
                .total_cmp(&(right.0 - midpoint).abs())
        })
        .expect("mid-measure piano bass clef");
    let clef_width =
        crate::render::smufl::smufl::glyph_bbox(clef_codepoint).2 * (2.0 / 3.0) * config.sp;

    assert!(
        previous_right + 0.45 * config.sp <= clef_x,
        "bass clef must clear the preceding chord: previous_right={previous_right:.2}, \
         clef_left={clef_x:.2}"
    );
    assert!(
        clef_x + clef_width + 0.3 * config.sp <= target_left,
        "bass clef must clear the following accidental/chord: clef_right={:.2}, \
         target_left={target_left:.2}",
        clef_x + clef_width
    );
}

/// A START-of-measure clef change (engraved BEFORE the shared barline as a
/// leading gap) must ADD global space too: the leading gap inflates every
/// part's prefix (the barline is shared), so without the measure growing, the
/// non-changing part's content gets compressed and its notes collapse/spill
/// past the barline. Regression for Rhapsody rehearsal 3 ("collapsed a bunch of
/// notes into the same column"). Routes through the auto-flow path (top-level
/// `layouts`/`scores`), which is what the live editor uses.
#[test]
fn test_start_of_measure_clef_change_adds_global_space() {
    // Two measures. Measure 1 opens with a clef change on part 0 only
    // (position omitted = start-of-measure). Part 1 never changes clef and
    // carries the denser content (4 quarters) so it dominates the measure's
    // natural width — exactly the case where the leading gap would otherwise
    // steal from its content.
    let with_clef = r#"{
        "mnx": {"version": 1},
        "layouts": [{"id":"L1","content":[
            {"type":"staff","sources":[{"part":"P1"}]},
            {"type":"staff","sources":[{"part":"P2"}]}
        ]}],
        "scores": [{"name":"S1","layout":"L1"}],
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}]},
        "parts": [
            {"id":"P1","name":"Flute","measures":[
                {
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                    ]}]
                },
                {
                    "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                    ]}]
                }
            ]},
            {"id":"P2","name":"Cello","measures":[
                {
                    "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 3}}]}
                    ]}]
                },
                {
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 3}}]}
                    ]}]
                }
            ]}
        ]
    }"#;
    // Same score with the start-of-measure clef change removed.
    let no_clef = with_clef.replace(
        r#"
                {
                    "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                    ]}]
                }"#,
        r#"
                {
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                    ]}]
                }"#,
    );
    assert!(no_clef != with_clef, "no_clef replacement must match");

    // Horizon path (no page_width) → natural widths, no justification masking
    // the growth. This is the path the live editor uses.
    let config = LayoutConfig {
        page_width: None,
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&parse_mnx(with_clef).unwrap(), &config, 0);
    let dl_plain = layout_with_mnx_scores(&parse_mnx(&no_clef).unwrap(), &config, 0);

    let bound = |dl: &crate::render::DisplayList, part: usize| {
        dl.measure_bounds
            .iter()
            .find(|b| b.index == 1 && b.part_index == part)
            .cloned()
            .unwrap()
    };
    let b0 = bound(&dl, 0);
    let b1 = bound(&dl, 1);

    // Barlines aligned: both parts' measure left edge and width identical.
    assert!(
        (b0.x - b1.x).abs() < 0.01,
        "clef-change measure x must match across parts: part0={:.2} part1={:.2}",
        b0.x,
        b1.x
    );
    assert!(
        (b0.width - b1.width).abs() < 0.01,
        "clef-change measure width must match across parts: part0={:.2} part1={:.2}",
        b0.width,
        b1.width
    );

    let left_barline = dl
        .element_bboxes
        .iter()
        .filter(|bbox| bbox.element_id == "m1/barline")
        .min_by(|left, right| {
            (left.bbox.y - b0.y)
                .abs()
                .total_cmp(&(right.bbox.y - b0.y).abs())
        })
        .expect("measure-1 left barline bbox");
    let barline_center = left_barline.bbox.x + left_barline.bbox.width * 0.5;
    assert!(
        (b0.x - barline_center).abs() < 0.1 * config.sp,
        "selection bounds must start at the visible barline, not the pre-clef \
         layout origin: bounds={:.2}, barline={barline_center:.2}",
        b0.x
    );

    // The pre-barline clef column is intentionally excluded from selectable
    // measure width. The post-barline content region must nevertheless remain
    // at least as wide as the plain score's content.
    let plain = bound(&dl_plain, 1);
    let plain_content = plain.width - plain.prefix_width;
    let clef_content = b1.width - b1.prefix_width;
    assert!(
        clef_content >= plain_content - 0.01,
        "non-changing part's CONTENT must not compress at a clef change: plain \
         content {plain_content:.2}, with-clef content {clef_content:.2}"
    );
}

/// A measure dense with accidentals across MANY staves must stay wide enough to
/// hold the SYSTEM-wide merged spacing — otherwise the merged spacing's rigid
/// (incompressible accidental-column) width approaches the per-staff natural
/// width, the elastic note spacing collapses toward zero, and a beat's triplet
/// piles into a single column. Regression for Rhapsody rehearsal 3, where the
/// beat-4 triplet collapsed in the live (auto-flow, horizon-chunked) view.
///
/// Driven directly off the real score because the collapse needs genuine
/// orchestral onset density (a thin synthetic measure stays above the rigid
/// threshold). Measure 20 (rehearsal 3) of "Rhapsody in Blue" has, in part 0,
/// a half note then two 3:2 eighth-triplets on beats 3–4; before the fix the
/// triplet notes shared an x (≈6600.6, 6600.6, 6697.0). Skips if the example
/// score isn't present (e.g. a minimal checkout).
#[test]
fn test_rhapsody_rehearsal3_triplet_does_not_collapse() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    );
    let Ok(json) = std::fs::read_to_string(path) else {
        eprintln!("skipping: {path} not found");
        return;
    };
    let score = parse_mnx(&json).unwrap();

    // The live editor uses the horizon-chunked auto-flow path.
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Part 0, measure 20 (rehearsal 3), staff 0: the beat-3..4 triplet
    // noteheads. Collect one x per event (the n0 notehead).
    let mut xs: Vec<f64> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(i, cmd)| {
            let id = dl
                .element_ids
                .get(i)
                .and_then(|o| o.as_deref())
                .unwrap_or("");
            if !id.starts_with("p0/m20/s0/") || !id.ends_with("/n0") {
                return None;
            }
            match cmd {
                RenderCommand::DrawGlyph { x, codepoint, .. } if *codepoint == 0xE0A4 => Some(*x),
                _ => None,
            }
        })
        .collect();
    xs.sort_by(f64::total_cmp);
    xs.dedup_by(|a, b| (*a - *b).abs() < 0.5);

    // The measure has six black triplet eighths (two 3:2 groups on beats 3–4).
    // Before the fix these piled into ~2 columns; with the merged-width floor
    // every onset gets its own column. Require all six distinct, each separated
    // by a real gap (> 1px).
    assert!(
        xs.len() >= 6,
        "Rhapsody rehearsal-3 triplets collapsed: only {} distinct note x \
         positions across the two triplets (expected 6): {xs:?}",
        xs.len()
    );
    for w in xs.windows(2) {
        assert!(
            w[1] - w[0] > 1.0,
            "adjacent triplet notes collapsed: {:.1} vs {:.1} (all: {xs:?})",
            w[0],
            w[1]
        );
    }
}

/// A tie across a stitched-horizon chunk seam must NOT restate the tied note's
/// accidental. The tie-accidental suppression map was built per-chunk, so a tie
/// whose source note lives in one chunk and its continuation in the next
/// couldn't find its target → suppression was lost and the accidental redrew at
/// the seam (visible at rehearsal 1 of Rhapsody: the saxes' multi-measure tied
/// flats restated mid-tie in horizon, while page mode was fine). Chunking is a
/// pure layout/retention transform, so the chunked galley must draw exactly the
/// SAME accidentals as the single-system horizon. A tiny chunk width forces one
/// measure per chunk, guaranteeing every cross-barline tie crosses a seam.
/// Skips if the example score isn't present (e.g. a minimal checkout).
#[test]
fn test_rhapsody_tied_accidental_not_restated_across_chunk_seam() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    );
    let Ok(json) = std::fs::read_to_string(path) else {
        eprintln!("skipping: {path} not found");
        return;
    };
    let score = parse_mnx(&json).unwrap();

    let count_accidentals = |dl: &DisplayList| -> usize {
        dl.commands
            .iter()
            .filter(|c| is_accidental_glyph(c))
            .count()
    };

    // Single-system horizon (no chunking): the tie-accidental map is already
    // global, so this is the correct accidental set.
    let single_cfg = LayoutConfig {
        page_width: None,
        horizon_chunk_width: None,
        ..LayoutConfig::default()
    };
    let single = layout_with_mnx_scores(&score, &single_cfg, 0);

    // Chunked horizon, one measure per chunk: every cross-barline tie now spans
    // a chunk seam — the exact condition that used to drop suppression.
    let chunked_cfg = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(1.0),
        ..LayoutConfig::default()
    };
    let chunked = layout_with_mnx_scores(&score, &chunked_cfg, 0);

    assert_eq!(
        count_accidentals(&chunked),
        count_accidentals(&single),
        "chunked horizon drew a different number of accidentals than single-system \
         horizon — a tied accidental is being restated at a chunk seam (single={}, \
         chunked={})",
        count_accidentals(&single),
        count_accidentals(&chunked),
    );
}

/// but a single-part layout shares no barline with other parts — so a clef
/// change in part B has no bearing on part A's spacing. Regression for the
/// bassoon part view showing space for another instrument's rehearsal-3 clef
/// change (and the resulting downstream note drift).
#[test]
fn test_part_view_ignores_other_parts_clef_change() {
    // Two parts: P1 (Flute) NEVER changes clef; P2 (Trombone) changes clef at
    // the start of measure 1. A separate score/layout exists for each part, plus
    // a full-score layout showing both.
    let json = r#"{
        "mnx": {"version": 1},
        "layouts": [
            {"id":"full","content":[
                {"type":"staff","sources":[{"part":"P1"}]},
                {"type":"staff","sources":[{"part":"P2"}]}
            ]},
            {"id":"flute","content":[{"type":"staff","sources":[{"part":"P1"}]}]},
            {"id":"tbn","content":[{"type":"staff","sources":[{"part":"P2"}]}]}
        ],
        "scores": [
            {"name":"Full","layout":"full"},
            {"name":"Flute","layout":"flute"},
            {"name":"Trombone","layout":"tbn"}
        ],
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}]},
        "parts": [
            {"id":"P1","name":"Flute","measures":[
                {
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                        {"type":"event","duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                    ]}]
                },
                {
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                    ]}]
                }
            ]},
            {"id":"P2","name":"Trombone","measures":[
                {
                    "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                    ]}]
                },
                {
                    "clefs": [{"clef": {"sign": "C", "staffPosition": 0}}],
                    "sequences": [{"content": [
                        {"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                    ]}]
                }
            ]}
        ]
    }"#;

    let config = LayoutConfig {
        page_width: None,
        ..LayoutConfig::default()
    };
    let score = parse_mnx(json).unwrap();

    let leading_gap = |dl: &crate::render::DisplayList, part: usize| -> f64 {
        let m0 = dl
            .measure_bounds
            .iter()
            .find(|b| b.index == 0 && b.part_index == part)
            .expect("m0 bounds");
        let m1 = dl
            .measure_bounds
            .iter()
            .find(|b| b.index == 1 && b.part_index == part)
            .expect("m1 bounds");
        m1.x - (m0.x + m0.width)
    };

    // Flute-only view: no change clef, so consecutive selectable bars touch.
    let dl_flute = layout_with_mnx_scores(&score, &config, 1);
    let flute_solo_gap = leading_gap(&dl_flute, 0);

    // Trombone-only view: its change clef occupies the pre-barline gap.
    let dl_tbn = layout_with_mnx_scores(&score, &config, 2);
    let tbn_solo_gap = leading_gap(&dl_tbn, 1);

    let sp = config.sp;
    assert!(
        flute_solo_gap.abs() < 0.01 && tbn_solo_gap > 1.5 * sp,
        "only the trombone part view should carry the pre-barline clef gap: \
         flute={flute_solo_gap:.2}, trombone={tbn_solo_gap:.2}"
    );

    // In the full score the shared visible barline shifts on every staff.
    let dl_full = layout_with_mnx_scores(&score, &config, 0);
    let flute_full_gap = leading_gap(&dl_full, 0);
    let tbn_full_gap = leading_gap(&dl_full, 1);
    assert!(
        (flute_full_gap - tbn_full_gap).abs() < 0.01,
        "full-score pre-barline gaps must match across parts: \
         flute={flute_full_gap:.2} trombone={tbn_full_gap:.2}"
    );
    assert!(
        flute_full_gap > 1.5 * sp,
        "the flute staff in the full score must follow the shared shifted barline"
    );
}

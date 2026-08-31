// Auto-generated from tests.rs — test_pedals
// 9 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::HashSet;

// ═══════════════════════════════════════════
// Piano pedal marking tests
// ═══════════════════════════════════════════
#[test]
fn test_pedal_text_style_produces_ped_and_star_glyphs() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"pedals": [{
                "type": "sustain",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
            }]}},
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Look for "Ped" glyph (U+E650)
    let ped_glyphs: Vec<_> = dl.commands.iter().filter(|c| matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::KEYBOARD_PEDAL_PED
    )).collect();
    assert_eq!(ped_glyphs.len(), 1, "Expected exactly one Ped glyph");

    // Look for "*" glyph (U+E655)
    let star_glyphs: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
                RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::KEYBOARD_PEDAL_UP
            )
        })
        .collect();
    assert_eq!(
        star_glyphs.len(),
        1,
        "Expected exactly one release (*) glyph"
    );
}

#[test]
fn test_pedal_bracket_style_produces_lines() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"pedals": [{
                "type": "sustain",
                "style": "bracket",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
            }]}},
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Bracket style should NOT have Ped or * glyphs
    let pedal_glyphs: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
                RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::KEYBOARD_PEDAL_PED || *codepoint == smufl::KEYBOARD_PEDAL_UP
            )
        })
        .collect();
    assert_eq!(
        pedal_glyphs.len(),
        0,
        "Bracket style should not use Ped/star glyphs"
    );

    // Should have at least 3 DrawLine commands for bracket (start hook, line, end hook)
    // Count lines below staff (y > staff_y + 4*sp)
    let sp = config.sp;
    let staff_bottom = config.margin_top * sp + 4.0 * sp;
    let bracket_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| match c {
            RenderCommand::DrawLine { y1, y2, .. } => {
                *y1 > staff_bottom + 2.0 * sp || *y2 > staff_bottom + 2.0 * sp
            }
            _ => false,
        })
        .collect();
    assert!(
        bracket_lines.len() >= 3,
        "Expected at least 3 bracket lines (2 hooks + 1 horizontal), got {}",
        bracket_lines.len()
    );
}

#[test]
fn test_pedal_sostenuto_glyph() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"pedals": [{
                "type": "sostenuto",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [1, 1]}}
            }]}},
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Sostenuto should use KEYBOARD_PEDAL_SOST glyph
    let sost_glyphs: Vec<_> = dl.commands.iter().filter(|c| matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::KEYBOARD_PEDAL_SOST
    )).collect();
    assert_eq!(sost_glyphs.len(), 1, "Expected exactly one Sost glyph");
}

#[test]
fn test_pedal_cross_measure() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "m1", "time": {"count": 4, "unit": 4}},
            {"id": "m2"}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "_x": {"viritura": {"pedals": [{
                    "type": "sustain",
                    "position": {"fraction": [0, 1]},
                    "end": {"measure": "m2", "position": {"fraction": [1, 2]}}
                }]}},
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                ]}]
            },
            {
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Cross-measure pedal should still produce Ped and * glyphs
    let ped_count = dl.commands.iter().filter(|c| matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::KEYBOARD_PEDAL_PED
    )).count();
    let star_count = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
                RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::KEYBOARD_PEDAL_UP
            )
        })
        .count();
    assert_eq!(
        ped_count, 1,
        "Cross-measure pedal should have one Ped glyph"
    );
    assert_eq!(
        star_count, 1,
        "Cross-measure pedal should have one release glyph"
    );

    // The release glyph should be in measure 2's x range
    if let Some(RenderCommand::DrawGlyph { x: ped_x, .. }) = dl.commands.iter().find(|c| {
        matches!(c,
            RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::KEYBOARD_PEDAL_PED
        )
    }) {
        if let Some(RenderCommand::DrawGlyph { x: star_x, .. }) = dl.commands.iter().find(|c| {
            matches!(c,
                RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::KEYBOARD_PEDAL_UP
            )
        }) {
            assert!(
                star_x > ped_x,
                "Release glyph ({:.1}) should be to the right of Ped glyph ({:.1})",
                star_x,
                ped_x
            );
        }
    }
}

#[test]
fn test_pedal_positioned_below_staff() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"pedals": [{
                "type": "sustain",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [1, 1]}}
            }]}},
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;

    // Ped glyph should be below the staff
    if let Some(RenderCommand::DrawGlyph { y, .. }) = dl.commands.iter().find(|c| {
        matches!(c,
            RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::KEYBOARD_PEDAL_PED
        )
    }) {
        assert!(
            *y > staff_bottom,
            "Ped glyph y ({:.1}) should be below staff bottom ({:.1})",
            y,
            staff_bottom
        );
    } else {
        panic!("No Ped glyph found");
    }
}

#[test]
fn test_pedal_smufl_codepoints() {
    assert_eq!(smufl::KEYBOARD_PEDAL_PED, 0xE650);
    assert_eq!(smufl::KEYBOARD_PEDAL_UP, 0xE655);
    assert_eq!(smufl::KEYBOARD_PEDAL_SOST, 0xE659);
    assert_eq!(smufl::KEYBOARD_PEDAL_HALF, 0xE65A);
}

#[test]
fn test_pedal_glyph_bboxes() {
    let (_, _, w, h) = smufl::glyph_bbox(smufl::KEYBOARD_PEDAL_PED);
    assert!(
        w > 2.0,
        "Ped glyph should be at least 2 staff spaces wide, got {}",
        w
    );
    assert!(h > 0.5, "Ped glyph should have positive height");

    let (_, _, w, h) = smufl::glyph_bbox(smufl::KEYBOARD_PEDAL_UP);
    assert!(
        w > 1.0,
        "Pedal up glyph should be at least 1 staff space wide"
    );
    assert!(h > 0.5, "Pedal up glyph should have positive height");

    let (_, _, w, _) = smufl::glyph_bbox(smufl::KEYBOARD_PEDAL_SOST);
    assert!(
        w > 3.0,
        "Sost glyph should be at least 3 staff spaces wide, got {}",
        w
    );
}

#[test]
fn test_pedal_start_glyph_helper() {
    let (cp, w) = smufl::pedal_start_glyph(&PedalType::Sustain);
    assert_eq!(cp, smufl::KEYBOARD_PEDAL_PED);
    assert!(w > 0.0);

    let (cp, _) = smufl::pedal_start_glyph(&PedalType::Sostenuto);
    assert_eq!(cp, smufl::KEYBOARD_PEDAL_SOST);

    let (cp, _) = smufl::pedal_start_glyph(&PedalType::UnaCorda);
    assert_eq!(cp, smufl::KEYBOARD_PEDAL_PED);
}

#[test]
fn test_pedal_mnx_score_parses() {
    let json = std::fs::read_to_string("../packages/format/fixtures/mnx/pedal-markings.mnx")
        .unwrap_or_else(|_| {
            // Fallback if running from different working directory
            r#"{
                "mnx": {"version": 1},
                "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
                "parts": [{"measures": [{
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "_x": {"viritura": {"pedals": [{"type": "sustain", "position": {"fraction": [0, 1]}, "end": {"measure": "m1", "position": {"fraction": [1, 1]}}}]}},
                    "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]
                }]}]
            }"#.to_string()
        });
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    assert!(
        !dl.commands.is_empty(),
        "Pedal markings score should produce render commands"
    );
}

#[test]
fn test_pedal_text_element_ids_tagged() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"pedals": [{
                "type": "sustain",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
            }]}},
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Text-style pedal should tag commands with element IDs like "p0/m0/pedal0"
    let pedal_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/pedal"))
        .collect();
    assert!(
        !pedal_ids.is_empty(),
        "Pedal render commands should have element IDs"
    );

    // Text pedal produces 2 glyphs (Ped + release), both tagged
    assert_eq!(
        pedal_ids.len(),
        2,
        "Text pedal should tag exactly 2 commands, got {}",
        pedal_ids.len()
    );

    // All should share the same ID
    assert_eq!(
        pedal_ids[0], pedal_ids[1],
        "Both pedal glyphs should share the same element ID"
    );

    // Verify format
    assert!(
        pedal_ids[0].starts_with("p0/m0/pedal0"),
        "Expected 'p0/m0/pedal0', got '{}'",
        pedal_ids[0]
    );
}

#[test]
fn test_pedal_bracket_element_ids_tagged() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"pedals": [{
                "type": "sustain",
                "style": "bracket",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
            }]}},
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Bracket-style pedal should tag 3 commands (start hook + line + end hook)
    let pedal_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/pedal"))
        .collect();
    assert_eq!(
        pedal_ids.len(),
        3,
        "Bracket pedal should tag exactly 3 commands, got {}",
        pedal_ids.len()
    );

    // All should share the same ID
    let unique: HashSet<_> = pedal_ids.iter().collect();
    assert_eq!(
        unique.len(),
        1,
        "All bracket pedal commands should share the same element ID"
    );
}

/// Una corda pedal should render italic text "una corda" and "tre corde"
/// instead of SMuFL glyphs (no SMuFL una corda glyph exists).
#[test]
fn test_pedal_una_corda_text_rendering() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"pedals": [{
                "type": "una-corda",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
            }]}},
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should NOT use Ped or Sost glyphs
    let pedal_glyphs: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
                RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::KEYBOARD_PEDAL_PED
                    || *codepoint == smufl::KEYBOARD_PEDAL_UP
                    || *codepoint == smufl::KEYBOARD_PEDAL_SOST
            )
        })
        .collect();
    assert_eq!(
        pedal_glyphs.len(),
        0,
        "Una corda should not use any pedal SMuFL glyphs, got {}",
        pedal_glyphs.len()
    );

    // Should have DrawText "una corda" at the start
    let una_corda_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
                RenderCommand::DrawText { text, .. } if text == "una corda"
            )
        })
        .collect();
    assert_eq!(
        una_corda_texts.len(),
        1,
        "Expected exactly one 'una corda' text command, got {}",
        una_corda_texts.len()
    );

    // Should have DrawText "tre corde" at the end
    let tre_corde_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
                RenderCommand::DrawText { text, .. } if text == "tre corde"
            )
        })
        .collect();
    assert_eq!(
        tre_corde_texts.len(),
        1,
        "Expected exactly one 'tre corde' text command, got {}",
        tre_corde_texts.len()
    );

    // "tre corde" should be to the right of "una corda"
    if let Some(RenderCommand::DrawText { x: uc_x, .. }) = dl.commands.iter().find(|c| {
        matches!(c,
            RenderCommand::DrawText { text, .. } if text == "una corda"
        )
    }) {
        if let Some(RenderCommand::DrawText { x: tc_x, .. }) = dl.commands.iter().find(|c| {
            matches!(c,
                RenderCommand::DrawText { text, .. } if text == "tre corde"
            )
        }) {
            assert!(
                tc_x > uc_x,
                "'tre corde' x ({:.1}) should be right of 'una corda' x ({:.1})",
                tc_x,
                uc_x
            );
        }
    }

    // Both texts should use italic serif font
    if let Some(RenderCommand::DrawText { font, .. }) = dl.commands.iter().find(|c| {
        matches!(c,
            RenderCommand::DrawText { text, .. } if text == "una corda"
        )
    }) {
        assert!(
            font.contains("italic"),
            "Una corda font should be italic, got: {}",
            font
        );
        assert!(
            font.contains("serif"),
            "Una corda font should include serif fallback, got: {}",
            font
        );
    }
}

/// Una corda element IDs should be tagged like other pedals.
#[test]
fn test_pedal_una_corda_element_ids_tagged() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"pedals": [{
                "type": "una-corda",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
            }]}},
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Element IDs should be tagged for both text commands
    let pedal_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/pedal"))
        .collect();
    assert_eq!(
        pedal_ids.len(),
        2,
        "Una corda pedal should tag 2 text commands, got {}",
        pedal_ids.len()
    );

    let unique: HashSet<_> = pedal_ids.iter().collect();
    assert_eq!(
        unique.len(),
        1,
        "Both una corda text commands should share the same element ID"
    );
}

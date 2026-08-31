// Auto-generated from tests.rs — test_ornaments
// 10 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_trill_renders_from_mnx_file() {
    // Load the trill.mnx sample
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/trill.mnx"
    );
    let json = std::fs::read_to_string(path).unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect trill glyph commands
    let trill_cmds: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ORNAMENT_TRILL)
        })
        .collect();

    // trill.mnx has: M1: 4 quarter notes each with trill, M2: 1 half with trill = 5 total
    assert_eq!(
        trill_cmds.len(),
        5,
        "Expected 5 trill glyphs, got {}",
        trill_cmds.len()
    );
}
#[test]
fn test_trill_above_staff() {
    // Trill symbol should be above the top staff line
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"trill": {}}}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "dotted-half"},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let trill_y = dl.commands.iter().find_map(|cmd| match cmd {
        RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::ORNAMENT_TRILL => {
            Some(*y)
        }
        _ => None,
    });

    assert!(trill_y.is_some(), "Should render a trill glyph");
    let staff_y = config.margin_top * sp;
    assert!(
        trill_y.unwrap() < staff_y,
        "Trill (y={:.1}) should be above top staff line (y={:.1})",
        trill_y.unwrap(),
        staff_y
    );
}

#[test]
fn test_trill_with_accidental_renders_extra_glyph() {
    // A trill with accidental=1 (sharp) should render both trill and accidental glyphs
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"trill": {"accidental": 1}}}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "dotted-half"},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have a trill glyph
    let has_trill = dl.commands.iter().any(|cmd| {
        matches!(
            cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ORNAMENT_TRILL
        )
    });
    assert!(has_trill, "Should render a trill glyph");

    // Should also have a sharp accidental glyph above the trill
    let has_sharp = dl.commands.iter().any(|cmd| {
        matches!(
            cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_SHARP
        )
    });
    assert!(
        has_sharp,
        "Trill with accidental=1 should render a sharp glyph"
    );
}

#[test]
fn test_trill_accidental_above_trill_symbol() {
    // The accidental glyph should be positioned above the trill glyph
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"trill": {"accidental": -1}}}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "dotted-half"},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let trill_y = dl.commands.iter().find_map(|cmd| match cmd {
        RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::ORNAMENT_TRILL => {
            Some(*y)
        }
        _ => None,
    });

    let flat_y = dl.commands.iter().find_map(|cmd| match cmd {
        RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::ACCIDENTAL_FLAT => {
            Some(*y)
        }
        _ => None,
    });

    assert!(trill_y.is_some(), "Should have trill glyph");
    assert!(flat_y.is_some(), "Should have flat accidental glyph");
    assert!(
        flat_y.unwrap() < trill_y.unwrap(),
        "Flat accidental (y={:.1}) should be above trill (y={:.1})",
        flat_y.unwrap(),
        trill_y.unwrap()
    );
}

#[test]
fn test_trill_parsing_plain() {
    // Plain trill (no accidental) should parse correctly
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "markings": {"_x": {"viritura": {"trill": {}}}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let event = &score.parts[0].measures[0].sequences[0].content[0];
    match event {
        SequenceContent::Event(e) => {
            let markings = e.markings.as_ref().expect("Should have markings");
            let trill = markings.trill.as_ref().expect("Should have trill");
            assert!(
                trill.accidental.is_none(),
                "Plain trill should have no accidental"
            );
        }
        _ => panic!("Expected Event"),
    }
}

#[test]
fn test_trill_parsing_with_accidentals() {
    // Trills with various accidentals should parse correctly
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"trill": {"accidental": 1}}}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"trill": {"accidental": -1}}}},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"trill": {"accidental": 0}}}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let content = &score.parts[0].measures[0].sequences[0].content;

    // First event: sharp trill
    match &content[0] {
        SequenceContent::Event(e) => {
            let trill = e.markings.as_ref().unwrap().trill.as_ref().unwrap();
            assert_eq!(trill.accidental, Some(1), "First should be sharp");
        }
        _ => panic!("Expected Event"),
    }

    // Second event: flat trill
    match &content[1] {
        SequenceContent::Event(e) => {
            let trill = e.markings.as_ref().unwrap().trill.as_ref().unwrap();
            assert_eq!(trill.accidental, Some(-1), "Second should be flat");
        }
        _ => panic!("Expected Event"),
    }

    // Third event: natural trill
    match &content[2] {
        SequenceContent::Event(e) => {
            let trill = e.markings.as_ref().unwrap().trill.as_ref().unwrap();
            assert_eq!(trill.accidental, Some(0), "Third should be natural");
        }
        _ => panic!("Expected Event"),
    }

    // Fourth event: no trill
    match &content[3] {
        SequenceContent::Event(e) => {
            let has_trill = e.markings.as_ref().and_then(|m| m.trill.as_ref()).is_some();
            assert!(!has_trill, "Fourth should have no trill");
        }
        _ => panic!("Expected Event"),
    }
}

#[test]
fn test_ornament_renders_from_mnx_file() {
    // Load the ornaments.mnx sample
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ornaments.mnx"
    );
    let json = std::fs::read_to_string(path).unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all ornament glyph commands (excluding trill which is separate)
    let ornament_cps = [
        smufl::ORNAMENT_TURN,
        smufl::ORNAMENT_TURN_INVERTED,
        smufl::ORNAMENT_MORDENT,
        smufl::ORNAMENT_MORDENT_INVERTED,
        smufl::ORNAMENT_DELAYED_TURN,
        smufl::ORNAMENT_SCHLEIFER,
        smufl::ORNAMENT_TRILL_MORDENT,
    ];
    let ornament_cmds: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if ornament_cps.contains(codepoint))
        })
        .collect();

    // ornaments.mnx has:
    // M1: turn, invertedTurn, mordent, invertedMordent (4)
    // M2: trillMordent, delayedTurn, schleifer (3)
    // M3: turn (with staccato), mordent (with accent) (2)
    // Total = 9
    assert_eq!(
        ornament_cmds.len(),
        9,
        "Expected 9 ornament glyphs, got {}",
        ornament_cmds.len()
    );
}

#[test]
fn test_ornament_above_staff() {
    // Ornament symbols should be above the top staff line
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["turn"]}}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["mordent"]}}},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let ornament_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::ORNAMENT_TURN || *codepoint == smufl::ORNAMENT_MORDENT =>
            {
                Some(*y)
            }
            _ => None,
        })
        .collect();

    assert_eq!(ornament_ys.len(), 2, "Should render 2 ornament glyphs");
    let staff_y = config.margin_top * sp;
    for oy in &ornament_ys {
        assert!(
            *oy < staff_y,
            "Ornament (y={:.1}) should be above top staff line (y={:.1})",
            oy,
            staff_y
        );
    }
}

#[test]
fn test_ornament_type_parsing() {
    // Verify all ornament types parse correctly from JSON
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["trillMordent"]}}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["delayedTurn"]}}},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["schleifer"]}}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let content = &score.parts[0].measures[0].sequences[0].content;

    // Verify each new ornament type is parsed
    match &content[0] {
        SequenceContent::Event(e) => {
            let ornaments = e.markings.as_ref().unwrap().ornaments.as_ref().unwrap();
            assert_eq!(ornaments[0], OrnamentType::TrillMordent);
        }
        _ => panic!("Expected Event"),
    }
    match &content[1] {
        SequenceContent::Event(e) => {
            let ornaments = e.markings.as_ref().unwrap().ornaments.as_ref().unwrap();
            assert_eq!(ornaments[0], OrnamentType::DelayedTurn);
        }
        _ => panic!("Expected Event"),
    }
    match &content[2] {
        SequenceContent::Event(e) => {
            let ornaments = e.markings.as_ref().unwrap().ornaments.as_ref().unwrap();
            assert_eq!(ornaments[0], OrnamentType::Schleifer);
        }
        _ => panic!("Expected Event"),
    }
}

#[test]
fn test_ornament_all_types_render_correct_glyphs() {
    // Each ornament type should produce its correct SMuFL glyph
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}, {}]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["turn"]}}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["invertedTurn"]}}},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["mordent"]}}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["invertedMordent"]}}},
                 "notes": [{"pitch": {"step": "F", "octave": 5}}]}
             ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["shortTrill"]}}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["trillMordent"]}}},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["delayedTurn"]}}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"ornaments": ["schleifer"]}}},
                 "notes": [{"pitch": {"step": "F", "octave": 5}}]}
             ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]}
             ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let expected_glyphs = [
        smufl::ORNAMENT_TURN,
        smufl::ORNAMENT_TURN_INVERTED,
        smufl::ORNAMENT_MORDENT,
        smufl::ORNAMENT_MORDENT_INVERTED,
        smufl::ORNAMENT_SHORT_TRILL,
        smufl::ORNAMENT_TRILL_MORDENT,
        smufl::ORNAMENT_DELAYED_TURN,
        smufl::ORNAMENT_SCHLEIFER,
    ];

    for expected_cp in &expected_glyphs {
        let found = dl.commands.iter().any(|cmd| {
            matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == *expected_cp)
        });
        assert!(
            found,
            "Expected ornament glyph 0x{:X} to be rendered",
            expected_cp
        );
    }
}

#[test]
fn test_trill_clears_accent_above_note() {
    // A high note with both an accent and a trill: the trill must sit above
    // the accent glyph, not overlap it (notehead, then articulation, then
    // ornament/trill priority).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"},
                 "markings": {"accent": {}, "_x": {"viritura": {"trill": {}}}},
                 "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"duration": {"base": "dotted-half"},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let accent_top = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                codepoint,
                y,
                size,
                x,
                ..
            } if smufl::is_articulation(*codepoint) => {
                let (_, by, _, _) = smufl::glyph_bbox(*codepoint);
                let _ = x;
                Some(*y + by * (size / 4.0))
            }
            _ => None,
        })
        .expect("Should render an accent glyph");

    let trill_bottom = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                codepoint, y, size, ..
            } if *codepoint == smufl::ORNAMENT_TRILL => {
                let (_, by, _, bh) = smufl::glyph_bbox(*codepoint);
                Some(*y + (by + bh) * (size / 4.0))
            }
            _ => None,
        })
        .expect("Should render a trill glyph");

    assert!(
        trill_bottom <= accent_top,
        "Trill bottom (y={:.1}) should clear the accent's top (y={:.1}), not overlap it",
        trill_bottom,
        accent_top
    );
}

#[test]
fn test_ornament_clears_accent_above_note() {
    // Same as the trill case, but for a turn ornament.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"},
                 "markings": {"accent": {}, "_x": {"viritura": {"ornaments": ["turn"]}}},
                 "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"duration": {"base": "dotted-half"},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let accent_top = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                codepoint, y, size, ..
            } if smufl::is_articulation(*codepoint) => {
                let (_, by, _, _) = smufl::glyph_bbox(*codepoint);
                Some(*y + by * (size / 4.0))
            }
            _ => None,
        })
        .expect("Should render an accent glyph");

    let ornament_bottom = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                codepoint, y, size, ..
            } if *codepoint == smufl::ORNAMENT_TURN => {
                let (_, by, _, bh) = smufl::glyph_bbox(*codepoint);
                Some(*y + (by + bh) * (size / 4.0))
            }
            _ => None,
        })
        .expect("Should render a turn ornament glyph");

    assert!(
        ornament_bottom <= accent_top,
        "Ornament bottom (y={:.1}) should clear the accent's top (y={:.1}), not overlap it",
        ornament_bottom,
        accent_top
    );
}

#[test]
fn test_trill_ignores_accent_on_a_different_staff() {
    // Regression: a trill's articulation-avoidance scan must be scoped to its
    // own staff's measure — not the whole display list. Part 1 has a low note
    // (stem up) with an accent that lands BELOW its own staff; part 2's staff
    // starts only `inter_staff_gap` (7sp) below part 1's, so part 1's below-
    // staff accent can fall inside part 2's overly generous `staff_obstacle_band`
    // margin (10sp). Part 2's trill must render at its own normal height,
    // completely unaffected by part 1's accent.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "markings": {"accent": {}},
                     "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                ]}]
            }]},
            {"measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "markings": {"_x": {"viritura": {"trill": {}}}},
                     "notes": [{"pitch": {"step": "G", "octave": 4}}]}
                ]}]
            }]}
        ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let full_dl = crate::layout::layout_full_score(&score, &config);
    let full_trill_y = full_dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::ORNAMENT_TRILL =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("Should render a trill glyph in the full score");
    // Part 2's absolute staff_y in the two-staff full score (mirrors
    // test_full_score_layout_parts's expected-height derivation).
    let staff_height = 4.0 * sp;
    let inter_staff_gap = 7.0 * sp;
    let full_staff_y = config.margin_top * sp + staff_height + inter_staff_gap;

    // Layout part 2 alone (no part 1 accent in the display list at all) as the
    // ground truth for where the trill belongs, relative to ITS OWN staff.
    let solo_dl = layout_score(&score, 1, &config);
    let solo_trill_y = solo_dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::ORNAMENT_TRILL =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("Should render a trill glyph in the solo layout");
    let solo_staff_y = config.margin_top * sp;

    let full_relative = full_trill_y - full_staff_y;
    let solo_relative = solo_trill_y - solo_staff_y;
    assert!(
        (full_relative - solo_relative).abs() < 0.01,
        "Trill height above its own staff in the full score ({:.2}) should match \
         its solo-part height ({:.2}) \u{2014} part 1's below-staff accent must not \
         affect part 2's trill",
        full_relative,
        solo_relative
    );
}

// Auto-generated from tests.rs — test_arpeggios
// 11 test(s)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_arpeggio_model_serialization() {
    // Test that arpeggio markings round-trip through JSON
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "half"}, "markings": {"_x": {"viritura": {"arpeggio": {}}}}, "notes": [
                {"pitch": {"step": "C", "octave": 4}},
                {"pitch": {"step": "E", "octave": 4}},
                {"pitch": {"step": "G", "octave": 4}}
            ]},
            {"duration": {"base": "half"}, "markings": {"_x": {"viritura": {"arpeggio": {"direction": "down"}}}}, "notes": [
                {"pitch": {"step": "F", "octave": 4}},
                {"pitch": {"step": "A", "octave": 4}}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let part = &score.parts[0];
    let seq = &part.measures[0].sequences[0];

    // First event: arpeggio with no direction
    if let SequenceContent::Event(e) = &seq.content[0] {
        let m = e.markings.as_ref().unwrap();
        assert!(
            m.arpeggio.is_some(),
            "First event should have arpeggio marking"
        );
        assert!(
            m.arpeggio.as_ref().unwrap().direction.is_none(),
            "No direction = default up"
        );
    } else {
        panic!("Expected Event");
    }

    // Second event: arpeggio with direction "down"
    if let SequenceContent::Event(e) = &seq.content[1] {
        let m = e.markings.as_ref().unwrap();
        assert!(
            m.arpeggio.is_some(),
            "Second event should have arpeggio marking"
        );
        assert_eq!(
            m.arpeggio.as_ref().unwrap().direction,
            Some(ArpeggioDirection::Down)
        );
    } else {
        panic!("Expected Event");
    }
}

#[test]
fn test_arpeggio_renders_glyph_on_chord() {
    // A chord with arpeggio marking should produce multi-segment arpeggio glyphs
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "markings": {"_x": {"viritura": {"arpeggio": {}}}}, "notes": [
                {"pitch": {"step": "C", "octave": 4}},
                {"pitch": {"step": "E", "octave": 4}},
                {"pitch": {"step": "G", "octave": 4}}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let arpeggio_cmds: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| is_arpeggio_glyph(c))
        .collect();

    assert!(
        !arpeggio_cmds.is_empty(),
        "Expected at least 1 arpeggio segment glyph, got {}",
        arpeggio_cmds.len()
    );

    // Default (no direction) should use plain wiggle segments (no arrows)
    let has_arrow = arpeggio_cmds.iter().any(|c| {
        matches!(c,
            RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::WIGGLE_ARPEGGIATO_UP_ARROW
                || *codepoint == smufl::WIGGLE_ARPEGGIATO_DOWN_ARROW
        )
    });
    assert!(
        !has_arrow,
        "Plain arpeggio (no direction) should NOT have arrow glyphs"
    );

    // All glyphs should be rotated -90°
    for cmd in &arpeggio_cmds {
        if let RenderCommand::DrawGlyph { rotation, .. } = cmd {
            assert!(
                (*rotation - (-std::f64::consts::FRAC_PI_2)).abs() < 0.01,
                "Arpeggio glyphs should be rotated -π/2, got {}",
                rotation
            );
        }
    }
}

#[test]
fn test_arpeggio_direction_glyphs() {
    // Test that "up" and "down" directions produce the correct arrow terminal glyphs
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "half"}, "markings": {"_x": {"viritura": {"arpeggio": {"direction": "up"}}}}, "notes": [
                {"pitch": {"step": "C", "octave": 4}},
                {"pitch": {"step": "G", "octave": 4}}
            ]},
            {"duration": {"base": "half"}, "markings": {"_x": {"viritura": {"arpeggio": {"direction": "down"}}}}, "notes": [
                {"pitch": {"step": "D", "octave": 4}},
                {"pitch": {"step": "A", "octave": 4}}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // "up" direction should produce an up-arrow terminal
    let has_up_arrow = dl.commands.iter().any(|c| matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::WIGGLE_ARPEGGIATO_UP_ARROW));
    assert!(
        has_up_arrow,
        "Up arpeggio should have WIGGLE_ARPEGGIATO_UP_ARROW terminal"
    );

    // "down" direction should produce a down-arrow terminal
    let has_down_arrow = dl.commands.iter().any(|c| matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::WIGGLE_ARPEGGIATO_DOWN_ARROW));
    assert!(
        has_down_arrow,
        "Down arpeggio should have WIGGLE_ARPEGGIATO_DOWN_ARROW terminal"
    );
}

#[test]
fn test_arpeggio_up_arrow_uses_repeat_offset_origin() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "arpeggios": [{"position": {"fraction": [0, 1]}, "span": {"start": "n1", "end": "n4"}, "direction": "up", "arrow": true}],
            "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [
                {"id": "n1", "pitch": {"step": "C", "octave": 3}},
                {"id": "n2", "pitch": {"step": "E", "octave": 4}},
                {"id": "n3", "pitch": {"step": "G", "octave": 5}},
                {"id": "n4", "pitch": {"step": "C", "octave": 6}}
            ]}]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let (arrow_y, font_size) = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                codepoint, y, size, ..
            } if *codepoint == smufl::WIGGLE_ARPEGGIATO_UP_ARROW => Some((*y, *size)),
            _ => None,
        })
        .expect("should render up-arrow terminal");
    let top_segment_y = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::WIGGLE_ARPEGGIATO_UP =>
            {
                Some(*y)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    let sp = font_size / 4.0;
    let expected_arrow_y = top_segment_y - smufl::WIGGLE_ARPEGGIATO_SEGMENT_WIDTH * sp;

    assert!(
        (arrow_y - expected_arrow_y).abs() < 0.001,
        "Up-arrow origin should follow the segment repeatOffset: got {:.3}, expected {:.3}",
        arrow_y,
        expected_arrow_y
    );
}

#[test]
fn test_arpeggio_down_arrow_uses_repeat_offset_origin() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "arpeggios": [{"position": {"fraction": [0, 1]}, "span": {"start": "n1", "end": "n4"}, "direction": "down", "arrow": true}],
            "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [
                {"id": "n1", "pitch": {"step": "C", "octave": 3}},
                {"id": "n2", "pitch": {"step": "E", "octave": 4}},
                {"id": "n3", "pitch": {"step": "G", "octave": 5}},
                {"id": "n4", "pitch": {"step": "C", "octave": 6}}
            ]}]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let (arrow_y, font_size) = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                codepoint, y, size, ..
            } if *codepoint == smufl::WIGGLE_ARPEGGIATO_DOWN_ARROW => Some((*y, *size)),
            _ => None,
        })
        .expect("should render down-arrow terminal");
    let bottom_segment_y = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::WIGGLE_ARPEGGIATO_DOWN =>
            {
                Some(*y)
            }
            _ => None,
        })
        .fold(f64::NEG_INFINITY, f64::max);
    let sp = font_size / 4.0;
    let expected_segment_y = arrow_y - smufl::WIGGLE_ARPEGGIATO_ARROW_WIDTH * sp;

    assert!(
        (bottom_segment_y - expected_segment_y).abs() < 0.001,
        "First down segment origin should follow the arrow repeatOffset: got {:.3}, expected {:.3}",
        bottom_segment_y,
        expected_segment_y
    );
}

#[test]
fn test_arpeggio_positioned_left_of_notehead() {
    // Arpeggio glyphs should be to the left of the notehead column
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "markings": {"_x": {"viritura": {"arpeggio": {}}}}, "notes": [
                {"pitch": {"step": "C", "octave": 4}},
                {"pitch": {"step": "E", "octave": 4}},
                {"pitch": {"step": "G", "octave": 4}}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find any arpeggio glyph X position
    let arpeggio_x = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { x, .. } if is_arpeggio_glyph(c) => Some(*x),
            _ => None,
        })
        .expect("Should have arpeggio glyph");

    let notehead_x = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_WHOLE
                    || *codepoint == smufl::NOTEHEAD_BLACK
                    || *codepoint == smufl::NOTEHEAD_HALF =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should have notehead glyph");

    assert!(
        arpeggio_x < notehead_x,
        "Arpeggio x ({:.2}) should be to the left of notehead x ({:.2})",
        arpeggio_x,
        notehead_x
    );
}

#[test]
fn test_arpeggio_skipped_on_single_note() {
    // Arpeggio marking on a single note should be skipped (arpeggios only make sense on chords)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "markings": {"_x": {"viritura": {"arpeggio": {}}}}, "notes": [
                {"pitch": {"step": "C", "octave": 4}}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let arpeggio_count = dl.commands.iter().filter(|c| is_arpeggio_glyph(c)).count();
    assert_eq!(
        arpeggio_count, 0,
        "Arpeggio on single note should not render, got {} glyphs",
        arpeggio_count
    );
}

#[test]
fn test_arpeggio_mnx_file_renders() {
    // Load arpeggios.mnx and verify arpeggio glyphs are produced
    let json = include_str!("../../../../../packages/format/fixtures/mnx/arpeggios.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let arpeggio_count = dl.commands.iter().filter(|c| is_arpeggio_glyph(c)).count();
    // arpeggios.mnx has multiple chords with arpeggio markings; each produces
    // multi-segment glyphs, so we should have well more than 5 total.
    assert!(
        arpeggio_count >= 5,
        "Expected at least 5 arpeggio glyphs from arpeggios.mnx, got {}",
        arpeggio_count
    );

    let bracket_lines = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawLine { .. }))
        .count();
    assert!(
        bracket_lines >= 3,
        "Expected non-arpeggio bracket lines from arpeggios.mnx, got {}",
        bracket_lines
    );
}

#[test]
fn test_fingering_model_deserialization() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "markings": {"_x": {"viritura": {"fingerings": [{"finger": 1}]}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let event = &score.parts[0].measures[0].sequences[0].content[0];
    match event {
        SequenceContent::Event(e) => {
            let markings = e.markings.as_ref().expect("should have markings");
            let fingerings = markings
                .fingerings
                .as_ref()
                .expect("should have fingerings");
            assert_eq!(fingerings.len(), 1);
            assert_eq!(fingerings[0].finger, 1);
        }
        _ => panic!("expected Event"),
    }
}

#[test]
fn test_fingering_multiple_deserialization() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}, {"pitch": {"step": "E", "octave": 4}}],
             "markings": {"_x": {"viritura": {"fingerings": [{"finger": 1}, {"finger": 3}]}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let event = &score.parts[0].measures[0].sequences[0].content[0];
    match event {
        SequenceContent::Event(e) => {
            let fingerings = e.markings.as_ref().unwrap().fingerings.as_ref().unwrap();
            assert_eq!(fingerings.len(), 2);
            assert_eq!(fingerings[0].finger, 1);
            assert_eq!(fingerings[1].finger, 3);
        }
        _ => panic!("expected Event"),
    }
}

#[test]
fn test_fingering_renders_glyph() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "markings": {"_x": {"viritura": {"fingerings": [{"finger": 3}]}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have a DrawGlyph with the fingering 3 codepoint (U+ED13)
    let has_fingering = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::FINGERING_3)
    });
    assert!(has_fingering, "Should render fingering 3 glyph (U+ED13)");
}

#[test]
fn test_fingering_stacks_vertically() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}, {"pitch": {"step": "E", "octave": 4}}],
             "markings": {"_x": {"viritura": {"fingerings": [{"finger": 1}, {"finger": 3}]}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Both fingering 1 and 3 should be rendered
    let fingering_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::FINGERING_1 || *codepoint == smufl::FINGERING_3 =>
            {
                Some(*y)
            }
            _ => None,
        })
        .collect();
    assert_eq!(fingering_ys.len(), 2, "Should have 2 fingering glyphs");
    // They should be at different Y positions (stacked)
    assert!(
        (fingering_ys[0] - fingering_ys[1]).abs() > 1.0,
        "Fingerings should be stacked vertically: y0={:.2}, y1={:.2}",
        fingering_ys[0],
        fingering_ys[1]
    );
}

#[test]
fn test_fingering_with_articulation() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "markings": {"staccato": {}, "_x": {"viritura": {"fingerings": [{"finger": 2}]}}}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Both staccato and fingering should render
    let has_staccato = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_STACCATO_ABOVE || *codepoint == smufl::ARTIC_STACCATO_BELOW)
    });
    let has_fingering = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::FINGERING_2)
    });
    assert!(has_staccato, "Should render staccato");
    assert!(has_fingering, "Should render fingering 2");
}

#[test]
fn test_arpeggio_clears_accidental_column() {
    // Regression: an arpeggio on a chord whose noteheads carry accidentals
    // must be engraved to the LEFT of the accidental column, not anchored on
    // the noteheads (which left it sitting on top of / inside the flats and
    // shoved into the previous event). The position-stable
    // invariant is that the wavy line clears every accidental glyph.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "markings": {"_x": {"viritura": {"arpeggio": {}}}}, "notes": [
                {"pitch": {"step": "E", "octave": 4, "alter": -1}},
                {"pitch": {"step": "G", "octave": 4, "alter": -1}},
                {"pitch": {"step": "B", "octave": 4, "alter": -1}}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Leftmost arpeggio glyph (all wavy segments share the same x).
    let arpeggio_x = dl
        .commands
        .iter()
        .filter(|c| is_arpeggio_glyph(c))
        .filter_map(glyph_xy)
        .map(|(x, _)| x)
        .fold(f64::INFINITY, f64::min);
    assert!(arpeggio_x.is_finite(), "should render an arpeggio");

    // Leftmost accidental glyph in the column.
    let acc_min_x = dl
        .commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .filter_map(glyph_xy)
        .map(|(x, _)| x)
        .fold(f64::INFINITY, f64::min);
    assert!(
        acc_min_x.is_finite(),
        "flat chord should render accidentals"
    );

    // The arpeggio must clear the entire accidental column with a comfortable
    // margin (~one arpeggio_offset). The old, notehead-anchored placement put
    // the wavy line to the RIGHT of the leftmost accidental, so this also
    // guards against regressing to that behavior.
    assert!(
        arpeggio_x < acc_min_x - 0.3 * config.sp,
        "arpeggio x ({:.2}) should sit clearly left of the accidental column ({:.2})",
        arpeggio_x,
        acc_min_x
    );
}

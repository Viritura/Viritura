// Auto-generated from tests.rs — test_tremolos
// 3 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::*;

#[test]
fn test_tremolo_marks_parsed() {
    // Verify that the tremolo marking parses correctly from MNX JSON
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"},
                 "markings": {"tremolo": {"marks": 2}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let event = &score.parts[0].measures[0].sequences[0].content[0];
    if let SequenceContent::Event(e) = event {
        let marks = e.markings.as_ref().unwrap().tremolo.as_ref().unwrap().marks;
        assert_eq!(marks, 2, "Expected 2 tremolo marks, got {}", marks);
    } else {
        panic!("Expected Event, got something else");
    }
}

#[test]
fn test_multi_note_tremolos() {
    // Load tremolos-multi-note.mnx: two measures with multi-note tremolos.
    // Measure 1: two 2-mark tremolos (half notes), Measure 2: one 3-mark tremolo (whole notes).
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/tremolos-multi-note.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let tremolo_strokes: Vec<_> = dl
        .commands
        .iter()
        .filter(|command| matches!(command, RenderCommand::DrawPolygon { points, .. } if points.len() == 4))
        .collect();

    // Two 2-mark tremolos plus one 3-mark tremolo produce seven strokes.
    assert_eq!(
        tremolo_strokes.len(),
        7,
        "Expected 7 multi-note tremolo strokes, got {}",
        tremolo_strokes.len()
    );
}

#[test]
fn test_tremolo_smufl_helpers() {
    use crate::render::smufl::smufl;

    // Single-note tremolo glyph lookup
    assert_eq!(smufl::tremolo_glyph(1), Some(smufl::TREMOLO_1));
    assert_eq!(smufl::tremolo_glyph(2), Some(smufl::TREMOLO_2));
    assert_eq!(smufl::tremolo_glyph(3), Some(smufl::TREMOLO_3));
    assert_eq!(smufl::tremolo_glyph(0), None);
    assert_eq!(smufl::tremolo_glyph(4), None);

    // Fingered tremolo glyph lookup
    assert_eq!(
        smufl::tremolo_fingered_glyph(1),
        Some(smufl::TREMOLO_FINGERED_1)
    );
    assert_eq!(
        smufl::tremolo_fingered_glyph(2),
        Some(smufl::TREMOLO_FINGERED_2)
    );
    assert_eq!(
        smufl::tremolo_fingered_glyph(3),
        Some(smufl::TREMOLO_FINGERED_3)
    );
    assert_eq!(smufl::tremolo_fingered_glyph(0), None);
    assert_eq!(smufl::tremolo_fingered_glyph(4), None);

    // Verify SMuFL codepoints are in the tremolo range (U+E220-U+E23F)
    assert_eq!(smufl::TREMOLO_1, 0xE220);
    assert_eq!(smufl::TREMOLO_2, 0xE221);
    assert_eq!(smufl::TREMOLO_3, 0xE222);
    assert_eq!(smufl::TREMOLO_FINGERED_1, 0xE225);
    assert_eq!(smufl::TREMOLO_FINGERED_2, 0xE226);
    assert_eq!(smufl::TREMOLO_FINGERED_3, 0xE227);
}

#[test]
fn test_upstem_single_note_tremolo_clears_notehead() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{
                "duration": {"base": "quarter"},
                "markings": {"tremolo": {"marks": 3}},
                "notes": [{"pitch": {"step": "C", "octave": 4}}]
            }]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    use crate::render::smufl::smufl;

    let note_y = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::NOTEHEAD_BLACK =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("black notehead");
    let tremolo_y = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::TREMOLO_3 => {
                Some(*y)
            }
            _ => None,
        })
        .expect("three-mark tremolo");
    let (_, tremolo_bbox_y, _, tremolo_bbox_h) = smufl::glyph_bbox(smufl::TREMOLO_3);
    let tremolo_bottom = tremolo_y + (tremolo_bbox_y + tremolo_bbox_h) * sp;
    let notehead_top = note_y - config.notehead_ry * sp;

    assert!(
        tremolo_bottom <= notehead_top - 0.3 * sp + 1e-6,
        "tremolo bottom {tremolo_bottom:.2} must clear notehead top {notehead_top:.2}"
    );
}

#[test]
fn test_multi_note_whole_notes_do_not_draw_stems() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{
                "type": "tremolo", "marks": 2,
                "outer": {"duration": {"base": "half"}, "multiple": 2},
                "individualDuration": {"base": "half"},
                "content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
                ]
            }]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let stem_width = config.stem_width * config.sp;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let visible_stems = dl
        .commands
        .iter()
        .filter(|command| {
            matches!(
                command,
                RenderCommand::DrawLine { x1, x2, y1, y2, width, .. }
                    if (x1 - x2).abs() < 1e-6
                        && (y1 - y2).abs() > config.sp
                        && (*width - stem_width).abs() < 1e-6
            )
        })
        .count();

    assert_eq!(visible_stems, 0, "whole-note tremolos must not paint stems");
}

#[test]
fn test_multi_note_tremolo_normalizes_opposite_stems() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{
                "type": "tremolo", "marks": 2,
                "outer": {"duration": {"base": "quarter"}, "multiple": 2},
                "individualDuration": {"base": "quarter"},
                "content": [
                    {"duration": {"base": "half"}, "stemDirection": "up", "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                    {"duration": {"base": "half"}, "stemDirection": "down", "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]
            }]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let stem_width = config.stem_width * sp;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    use crate::render::smufl::smufl;

    let notehead_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::NOTEHEAD_HALF => {
                Some(*x)
            }
            _ => None,
        })
        .collect();
    let stem_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawLine {
                x1,
                x2,
                y1,
                y2,
                width,
                ..
            } if (x1 - x2).abs() < 1e-6
                && (y1 - y2).abs() > sp
                && (*width - stem_width).abs() < 1e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .collect();

    assert_eq!(notehead_xs.len(), 2);
    assert_eq!(stem_xs.len(), 2);
    for (notehead_x, stem_x) in notehead_xs.iter().zip(stem_xs.iter()) {
        assert!(
            *stem_x > *notehead_x + 0.5 * sp,
            "both tremolo stems must use the shared upstem side: notehead={notehead_x}, stem={stem_x}"
        );
    }
}

#[test]
fn test_multi_note_tremolo_spacing_no_overlap() {
    // Two half notes with a 3-stroke multi-note tremolo. Each incomplete beam
    // is inset from both stems and separated vertically from its neighbours.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "tremolo", "marks": 3,
                 "outer": {"duration": {"base": "quarter"}, "multiple": 2},
                 "content": [
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                ]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    use crate::render::smufl::smufl;

    let tremolo_strokes: Vec<&Vec<(f64, f64)>> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawPolygon { points, .. } if points.len() == 4 => Some(points),
            _ => None,
        })
        .collect();
    assert_eq!(tremolo_strokes.len(), 3, "Should render 3 tremolo strokes");

    // Collect x positions of the two half noteheads
    let notehead_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::NOTEHEAD_HALF => {
                Some(*x)
            }
            _ => None,
        })
        .collect();

    assert_eq!(
        notehead_xs.len(),
        2,
        "Should render 2 half noteheads, got {}",
        notehead_xs.len()
    );
    let mut stem_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawLine {
                x1,
                x2,
                y1,
                y2,
                width,
                ..
            } if (x1 - x2).abs() < 1e-6
                && (y1 - y2).abs() > sp
                && (*width - config.stem_width * sp).abs() < 1e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .collect();
    stem_xs.sort_by(f64::total_cmp);
    assert_eq!(stem_xs.len(), 2, "two-note tremolo needs two visible stems");

    // Standard engraving practice: tremolo strokes are incomplete beams,
    // inset from both stems, with visible white between adjacent strokes.
    let expected_mid = (notehead_xs[0] + notehead_xs[1]) * 0.5;
    let left_stem_x = stem_xs[0];
    let right_stem_x = stem_xs[1];
    for points in &tremolo_strokes {
        let stroke_mid = (points[0].0 + points[1].0) * 0.5;
        assert!(
            (stroke_mid - expected_mid).abs() < 1.0 * sp,
            "Tremolo stroke midpoint ({stroke_mid:.1}) should be near notehead midpoint ({expected_mid:.1})"
        );
        assert!(
            (points[0].1 - points[1].1).abs() > 0.1,
            "Tremolo stroke should follow the slope between unequal pitches"
        );
        assert!(
            points[0].0 >= left_stem_x + 0.4 * sp - 1e-6,
            "Tremolo stroke must stop short of the left stem"
        );
        assert!(
            points[1].0 <= right_stem_x - 0.4 * sp + 1e-6,
            "Tremolo stroke must stop short of the right stem"
        );
    }
    let mut stroke_bands: Vec<(f64, f64)> = tremolo_strokes
        .iter()
        .map(|points| (points[0].1, points[3].1))
        .collect();
    stroke_bands.sort_by(|a, b| a.0.total_cmp(&b.0));
    for strokes in stroke_bands.windows(2) {
        let upper_bottom = strokes[0].1;
        let lower_top = strokes[1].0;
        assert!(
            lower_top - upper_bottom >= 0.24 * sp,
            "Adjacent tremolo strokes need a visible inter-stroke gap"
        );
    }
}

// Auto-generated from tests.rs — test_glissando
// 6 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::parse::parse_mnx;
use crate::render::*;

// ═══════════════════════════════════════════
// Glissando tests
// ═══════════════════════════════════════════
#[test]
fn test_glissando_mnx_file_produces_lines() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/glissando.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have diagonal DrawLine commands for glissando connections
    // Straight glissando: 1 DrawLine, Wavy glissando: multiple DrawLine segments
    // Count non-staff, non-barline, non-stem diagonal lines
    let diagonal_lines: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = c {
                // Diagonal: both x and y change significantly
                let dx = (x2 - x1).abs();
                let dy = (y2 - y1).abs();
                dx > 1.0 && dy > 1.0
            } else {
                false
            }
        })
        .collect();
    assert!(
        diagonal_lines.len() >= 2,
        "Expected at least 2 diagonal lines for glissandos, got {}",
        diagonal_lines.len()
    );
}

#[test]
fn test_glissando_straight_produces_single_line() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "g1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "_x": {"viritura": {"glissandos": [{"target": "g2", "style": "straight"}]}}},
                {"id": "g2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find diagonal lines (glissando)
    let diagonal_lines: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = c {
                let dx = (x2 - x1).abs();
                let dy = (y2 - y1).abs();
                dx > 1.0 && dy > 1.0
            } else {
                false
            }
        })
        .collect();
    assert_eq!(
        diagonal_lines.len(),
        1,
        "Straight glissando should produce exactly 1 diagonal line, got {}",
        diagonal_lines.len()
    );
}

#[test]
fn test_glissando_wavy_tiles_smufl_wiggle_segments() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "w1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "_x": {"viritura": {"glissandos": [{"target": "w2", "style": "wavy"}]}}},
                {"id": "w2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // The wave is assembled from repeats of wiggleGlissando (U+EAAF), all
    // rotated by the same angle and spaced one repeat offset apart.
    let wiggles: Vec<(f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                codepoint,
                x,
                y,
                rotation,
                ..
            } if *codepoint == 0xEAAF => Some((*x, *y, *rotation)),
            _ => None,
        })
        .collect();
    assert!(
        wiggles.len() >= 3,
        "wavy glissando should tile several wiggle segments, got {}",
        wiggles.len()
    );

    let angle = wiggles[0].2;
    assert!(
        angle < 0.0,
        "segments should be rotated along an upward line, got {angle:.3} rad"
    );
    assert!(
        wiggles.iter().all(|&(_, _, r)| (r - angle).abs() < 1e-9),
        "every segment shares the line's angle"
    );

    // Consecutive origins sit exactly one repeat offset apart along the line.
    let advance = 0.96 * config.sp;
    for pair in wiggles.windows(2) {
        let step = (pair[1].0 - pair[0].0).hypot(pair[1].1 - pair[0].1);
        assert!(
            (step - advance).abs() < 1e-6,
            "segments must be spaced by the glyph repeat offset ({advance:.3}), got {step:.3}"
        );
    }
}

#[test]
fn test_glissando_with_text_produces_draw_text() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "t1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "_x": {"viritura": {"glissandos": [{"target": "t2", "style": "straight", "text": "gliss."}]}}},
                {"id": "t2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have a DrawText with "gliss."
    let text_cmds: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawText { text, .. } = c {
                text == "gliss."
            } else {
                false
            }
        })
        .collect();
    assert_eq!(
        text_cmds.len(),
        1,
        "Expected 1 'gliss.' DrawText command, got {}",
        text_cmds.len()
    );
}

#[test]
fn test_glissando_default_style_is_straight() {
    // No style specified should default to straight
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "d1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "_x": {"viritura": {"glissandos": [{"target": "d2"}]}}},
                {"id": "d2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Default (straight) should produce exactly 1 diagonal line
    let diagonal_lines: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = c {
                let dx = (x2 - x1).abs();
                let dy = (y2 - y1).abs();
                dx > 1.0 && dy > 1.0
            } else {
                false
            }
        })
        .collect();
    assert_eq!(
        diagonal_lines.len(),
        1,
        "Default straight glissando should produce 1 diagonal line, got {}",
        diagonal_lines.len()
    );
}

#[test]
fn test_glissando_line_connects_correct_notes() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "c1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "_x": {"viritura": {"glissandos": [{"target": "c2", "style": "straight"}]}}},
                {"id": "c2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // The glissando line should go from lower-left (C4) to upper-right (G5)
    let diagonal: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = c {
                let dx = (x2 - x1).abs();
                let dy = (y2 - y1).abs();
                dx > 1.0 && dy > 1.0
            } else {
                false
            }
        })
        .collect();
    assert_eq!(diagonal.len(), 1);

    if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = diagonal[0] {
        // Source note (C4) is lower on staff → larger y value
        // Target note (G5) is higher on staff → smaller y value
        assert!(
            *x1 < *x2,
            "Glissando x1 ({:.2}) should be left of x2 ({:.2})",
            x1,
            x2
        );
        assert!(
            *y1 > *y2,
            "C4 (y1={:.2}) should be below G5 (y2={:.2})",
            y1,
            y2
        );
    }
}

// ---- Cross-staff glissando ----

/// Harp writing: the gliss climbs from a bass-staff note to a note written in
/// the treble staff's own sequence, so the line must be resolved across the
/// two staves of the part rather than within one staff.
#[test]
fn test_cross_staff_glissando_ends_on_target_staff() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}, {"id": "m2"}]},
        "parts": [{
            "id": "P1",
            "name": "Harp",
            "staves": 2,
            "measures": [
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"duration": {"base": "whole"}, "rest": {}}]},
                        {"staff": 2, "content": [
                            {"id": "gs", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}],
                             "_x": {"viritura": {"glissandos": [{"target": "ge", "style": "straight"}]}}}
                        ]}
                    ]
                },
                {
                    "sequences": [
                        {"staff": 1, "content": [
                            {"id": "ge", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                            {"duration": {"base": "quarter"}, "rest": {}},
                            {"duration": {"base": "half"}, "rest": {}}
                        ]},
                        {"staff": 2, "content": [{"duration": {"base": "whole"}, "rest": {}}]}
                    ]
                }
            ]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let gliss: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            let tagged = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id == "gliss/gs/ge");
            match command {
                RenderCommand::DrawLine { y1, y2, .. } if tagged => Some((*y1, *y2)),
                _ => None,
            }
        })
        .collect();
    assert_eq!(
        gliss.len(),
        1,
        "expected exactly one cross-staff glissando line"
    );

    let (start_y, end_y) = gliss[0];
    // The bass staff spans 4 spaces; reaching the treble staff means rising by
    // more than a staff height above the C3 notehead.
    assert!(
        start_y - end_y > 4.0 * config.sp,
        "glissando should climb from the bass staff onto the treble staff: \
         start_y={start_y:.2}, end_y={end_y:.2}"
    );
}

#[test]
fn test_glissando_element_id_tagged() {
    // Glissandos should be tagged with element IDs in the format "gliss/{src_event_id}/{target_event_id}"
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "g1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "_x": {"viritura": {"glissandos": [{"target": "g2", "style": "straight"}]}}},
                {"id": "g2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find diagonal line commands (glissando)
    let gliss_indices: Vec<usize> = dl
        .commands
        .iter()
        .enumerate()
        .filter(|(_, c)| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = c {
                let dx = (x2 - x1).abs();
                let dy = (y2 - y1).abs();
                dx > 1.0 && dy > 1.0
            } else {
                false
            }
        })
        .map(|(i, _)| i)
        .collect();
    assert_eq!(gliss_indices.len(), 1, "Expected 1 glissando line");

    let idx = gliss_indices[0];
    assert!(
        idx < dl.element_ids.len(),
        "element_ids should cover glissando command"
    );
    let id = dl.element_ids[idx]
        .as_deref()
        .expect("Glissando should have element ID");
    assert_eq!(
        id, "gliss/g1/g2",
        "Glissando element ID should be gliss/{{src}}/{{tgt}}"
    );
}

#[test]
fn test_glissando_wavy_all_segments_tagged() {
    // Wavy glissandos tile several wiggle glyphs; all share one element ID
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "w1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "_x": {"viritura": {"glissandos": [{"target": "w2", "style": "wavy"}]}}},
                {"id": "w2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all commands tagged with the glissando element ID
    let tagged: Vec<usize> = dl
        .element_ids
        .iter()
        .enumerate()
        .filter(|(_, id)| id.as_deref() == Some("gliss/w1/w2"))
        .map(|(i, _)| i)
        .collect();
    assert!(
        tagged.len() >= 2,
        "Wavy glissando should tag multiple segments, got {}",
        tagged.len()
    );

    // All tagged commands should be wiggleGlissando glyphs
    for &i in &tagged {
        assert!(
            matches!(
                dl.commands[i],
                RenderCommand::DrawGlyph {
                    codepoint: 0xEAAF,
                    ..
                }
            ),
            "All wavy glissando segments should be wiggleGlissando glyphs"
        );
    }
}

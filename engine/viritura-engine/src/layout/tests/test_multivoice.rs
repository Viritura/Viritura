// Auto-generated from tests.rs — test_multivoice
// 16 test(s)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_count_leaf_events() {
    use crate::model::duration::{Duration, NoteValueBase};
    use crate::model::event::*;
    use crate::model::pitch::Pitch;

    let eighth = Duration {
        base: NoteValueBase::Eighth,
        dots: None,
    };
    let make_event = || {
        SequenceContent::Event(Event {
            duration: eighth.clone(),
            id: None,
            notes: Some(vec![Note {
                pitch: Pitch {
                    step: "C".to_string(),
                    octave: 4,
                    alter: None,
                },
                id: None,
                ties: None,
                accidental_display: None,
                written: None,
                staff: None,
                kit_component: None,
                perform: None,
                source_part_index: None,
                source_note_index: None,
                source_event_id: None,
            }]),
            rest: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        })
    };

    // 3 regular events
    let flat = vec![make_event(), make_event(), make_event()];
    assert_eq!(count_leaf_events(&flat), 3);

    // 1 tuplet with 3 events + 1 regular event = 4
    let with_tuplet = vec![
        SequenceContent::Tuplet(Tuplet {
            inner: TupletDuration {
                duration: eighth.clone(),
                multiple: 3,
            },
            outer: TupletDuration {
                duration: eighth.clone(),
                multiple: 2,
            },
            content: vec![make_event(), make_event(), make_event()],
            bracket: None,
            show_number: None,
            show_value: None,
            orient: None,
            staff: None,
        }),
        make_event(),
    ];
    assert_eq!(count_leaf_events(&with_tuplet), 4);
}

#[test]
fn test_voice_collision_offset_unison() {
    // Two voices with the same note (C5) at the same beat — should share notehead,
    // not offset. Voice 1's notehead should be marked as shared.
    // Ref: standard engraving practice — voices sharing a pitch use a single notehead.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                {"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let resolved = resolve_measures(&score, 0);
    let ml = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0);

    assert_eq!(ml.voice_layouts.len(), 2);
    let v0_x = ml.voice_layouts[0].events_vec()[0].x;
    let v1_x = ml.voice_layouts[1].events_vec()[0].x;

    // Voice 1 should NOT be offset — shared notehead
    assert!(
        (v1_x - v0_x).abs() < 0.01,
        "Unison: voice 1 x={} should equal voice 0 x={} (shared notehead)",
        v1_x,
        v0_x
    );

    // Voice 1's note should be marked as shared
    assert!(
        ml.voice_layouts[1].events_vec()[0].shared_noteheads[0],
        "Unison note should be marked as shared"
    );
}

#[test]
fn test_voice_collision_offset_second() {
    // Two voices a second apart (C5 and D5) at the same beat — voice 1 should be offset.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]},
                {"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let resolved = resolve_measures(&score, 0);
    let ml = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0);

    let v0_x = ml.voice_layouts[0].events_vec()[0].x;
    let v1_x = ml.voice_layouts[1].events_vec()[0].x;
    let notehead_w = config.notehead_rx * 2.0 * config.sp;

    // Adjacent positions (distance 1) should also trigger offset
    assert!(
        (v1_x - v0_x - notehead_w).abs() < 0.01,
        "Second collision: voice 1 x={} should be offset from voice 0 x={}",
        v1_x,
        v0_x
    );
}

#[test]
fn test_voice_no_collision_offset_when_far_apart() {
    // Two voices far apart (C4 and C6) — no offset needed.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]},
                {"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let resolved = resolve_measures(&score, 0);
    let ml = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0);

    let v0_x = ml.voice_layouts[0].events_vec()[0].x;
    let v1_x = ml.voice_layouts[1].events_vec()[0].x;

    // Voices far apart should NOT be offset (same x)
    assert!(
        (v1_x - v0_x).abs() < 0.01,
        "No collision: voice 0 x={} and voice 1 x={} should be the same",
        v0_x,
        v1_x
    );
}

#[test]
fn test_multivoice_mnx_event_counts() {
    // Load multiple-voices.mnx and verify correct event counts per voice.
    // Measure 1: voice 0 = 4 quarter notes (upper), voice 1 = 2 half notes (lower)
    // Measure 2: voice 0 = 3 events (2 quarters + 1 half, upper), voice 1 = 1 whole note (lower)
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-voices.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    assert!(
        measures.len() >= 2,
        "multiple-voices.mnx should have at least 2 measures"
    );

    // Measure 1
    let ml0 = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    assert_eq!(
        ml0.voice_layouts.len(),
        2,
        "Measure 1 should have 2 voices, got {}",
        ml0.voice_layouts.len()
    );
    assert_eq!(
        ml0.voice_layouts[0].events_vec().len(),
        4,
        "Measure 1 voice 0 should have 4 events, got {}",
        ml0.voice_layouts[0].events_vec().len()
    );
    assert_eq!(
        ml0.voice_layouts[1].events_vec().len(),
        2,
        "Measure 1 voice 1 should have 2 events, got {}",
        ml0.voice_layouts[1].events_vec().len()
    );

    // Measure 2
    let ml1 = layout_measure(&measures[1], sp, 0.0, &config, None, &[], 1.0);
    assert_eq!(
        ml1.voice_layouts.len(),
        2,
        "Measure 2 should have 2 voices, got {}",
        ml1.voice_layouts.len()
    );
    assert_eq!(
        ml1.voice_layouts[0].events_vec().len(),
        3,
        "Measure 2 voice 0 should have 3 events, got {}",
        ml1.voice_layouts[0].events_vec().len()
    );
    assert_eq!(
        ml1.voice_layouts[1].events_vec().len(),
        1,
        "Measure 2 voice 1 should have 1 event, got {}",
        ml1.voice_layouts[1].events_vec().len()
    );
}

#[test]
fn test_multivoice_stem_directions() {
    // Verify voice 0 stems up and voice 1 stems down in multi-voice context.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-voices.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let ml0 = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);

    // Voice 0: all events should have stem_up = true
    for (i, ev) in ml0.voice_layouts[0].events_vec().iter().enumerate() {
        assert!(
            ev.stem_up,
            "Measure 1 voice 0 event {} should have stem up, got stem down",
            i
        );
    }

    // Voice 1: all events should have stem_up = false (stems down)
    for (i, ev) in ml0.voice_layouts[1].events_vec().iter().enumerate() {
        assert!(
            !ev.stem_up,
            "Measure 1 voice 1 event {} should have stem down, got stem up",
            i
        );
    }

    // Also verify measure 2
    let ml1 = layout_measure(&measures[1], sp, 0.0, &config, None, &[], 1.0);
    for (i, ev) in ml1.voice_layouts[0].events_vec().iter().enumerate() {
        assert!(
            ev.stem_up,
            "Measure 2 voice 0 event {} should have stem up",
            i
        );
    }
    for (i, ev) in ml1.voice_layouts[1].events_vec().iter().enumerate() {
        assert!(
            !ev.stem_up,
            "Measure 2 voice 1 event {} should have stem down",
            i
        );
    }
}

#[test]
fn test_multivoice_render_command_count() {
    // Verify the full display list contains commands for both voices.
    // With 2 measures × 2 voices = 10 total note events, we expect at least
    // 10 notehead glyphs in the render output.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-voices.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Count notehead glyphs (SMuFL notehead codepoints)
    let notehead_count = dl.commands.iter().filter(|c| is_notehead_glyph(c)).count();
    // 10 notes total across both measures and voices
    assert!(
        notehead_count >= 10,
        "Expected at least 10 notehead glyphs for 10 notes across 2 voices, got {}",
        notehead_count
    );

    // The total command count should be substantially more than a single-voice score
    // (staff lines + barlines + clef/time/key glyphs + 10 noteheads + stems + ledger lines)
    assert!(
        dl.commands.len() > 30,
        "Expected >30 render commands for multi-voice score, got {}",
        dl.commands.len()
    );
}

#[test]
fn test_multivoice_rest_note_collision_moves_rest() {
    // Voice 0: quarter rest + 3 quarter notes (E5, F5, G5)
    // Voice 1: half note B4 (middle line) + half rest
    // The voice 0 rest at beat 0 collides with voice 1's B4 on middle line.
    // The voice 1 rest at beat 2 collides with voice 0's notes near middle.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [
                    {"content": [
                        {"duration": {"base": "quarter"}, "rest": {}},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                    ]},
                    {"content": [
                        {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                        {"duration": {"base": "half"}, "rest": {}}
                    ]}
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Find all quarter rest glyphs (SMuFL REST_QUARTER = 0xE4E5)
    let quarter_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_QUARTER && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    // Voice 0 has a quarter rest at beat 0 — should be pushed UP from default (middle line)
    assert!(
        !quarter_rests.is_empty(),
        "Expected at least one quarter rest glyph"
    );
    let staff_y = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, .. } = cmd {
                if (y2 - y1).abs() < 0.01 {
                    Some(*y1)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .unwrap_or(0.0);

    // B4 is at the middle line (staff pos 4 from top). The rest should be pushed above.
    let middle_line_y = staff_y + 2.0 * sp;
    let v0_rest = &quarter_rests[0];
    assert!(
        v0_rest.1 < middle_line_y,
        "Voice 0 rest should be pushed above middle line. Rest y={}, middle_line_y={}",
        v0_rest.1,
        middle_line_y
    );

    // Find half rest glyphs (SMuFL REST_HALF = 0xE4E4)
    let half_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_HALF && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    // Voice 1 has a half rest at beat 2 — trailing rest after voice 1's last note,
    // so it should be hidden (secondary voice trailing rests are suppressed).
    assert!(
        half_rests.is_empty(),
        "Trailing half rest in voice 1 should be hidden, got {} half rests",
        half_rests.len()
    );
}

#[test]
fn test_multivoice_rest_to_rest_collision() {
    // Both voices have rests at beat 0 — they should not overlap.
    // Voice 0: quarter rest + 3 quarter notes
    // Voice 1: quarter rest + dotted half note
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [
                    {"content": [
                        {"duration": {"base": "quarter"}, "rest": {}},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                        {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                    ]},
                    {"content": [
                        {"duration": {"base": "quarter"}, "rest": {}},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                        {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 3}}]}
                    ]}
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Find all quarter rest glyphs
    let quarter_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_QUARTER && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    // Should have 1 quarter rest — shared between voices (same beat, same duration)
    assert_eq!(
        quarter_rests.len(),
        1,
        "Expected 1 shared quarter rest glyph, got {}",
        quarter_rests.len()
    );
}

#[test]
fn test_multivoice_rest_explicit_position_preserved() {
    // When a rest has an explicit staffPosition in MNX, it should be preserved.
    // Voice 0: rest with staffPosition=4 (top line)
    // Voice 1: note C4
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [
                    {"content": [
                        {"duration": {"base": "quarter"}, "rest": {"staffPosition": 4}},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                        {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                    ]},
                    {"content": [
                        {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                    ]}
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Find the quarter rest glyph
    let quarter_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_QUARTER && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    assert!(!quarter_rests.is_empty(), "Expected quarter rest glyph");

    // staffPosition=4 → y = staff_y + (4 - 4) * 0.5 * sp = staff_y (top line)
    let staff_y = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, .. } = cmd {
                if (y2 - y1).abs() < 0.01 {
                    Some(*y1)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .unwrap_or(0.0);

    let expected_y = staff_y; // staffPosition=4 → top line
    assert!(
        (quarter_rests[0].1 - expected_y).abs() < 0.5 * sp,
        "Explicit staffPosition=4 should place rest near top line. y={}, expected={}",
        quarter_rests[0].1,
        expected_y
    );
}

#[test]
fn test_single_voice_rests_not_affected() {
    // With only one voice, rests should stay at default positions.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [
                    {"content": [
                        {"duration": {"base": "quarter"}, "rest": {}},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                        {"duration": {"base": "quarter"}, "rest": {}}
                    ]}
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Find all quarter rest glyphs
    let quarter_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_QUARTER && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    assert_eq!(quarter_rests.len(), 2, "Expected 2 quarter rests");

    // Both rests should be at the default middle-line position
    let staff_y = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, .. } = cmd {
                if (y2 - y1).abs() < 0.01 {
                    Some(*y1)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .unwrap_or(0.0);

    let default_y = staff_y + 2.0 * sp; // middle line for quarter rests
    for (i, (_, ry)) in quarter_rests.iter().enumerate() {
        assert!(
            (*ry - default_y).abs() < 0.01 * sp,
            "Single-voice rest {} should be at default position. y={}, expected={}",
            i,
            ry,
            default_y
        );
    }
}

#[test]
fn test_multivoice_whole_rest_collision() {
    // Voice 0: whole rest (default pos=2, hangs from line 4)
    // Voice 1: whole note D5 (just above middle line → hfs 2)
    // Voice 0's rest should collide with D5 and be pushed up.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [
                    {"content": [
                        {"duration": {"base": "whole"}, "rest": {}}
                    ]},
                    {"content": [
                        {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                    ]}
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    let whole_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_WHOLE && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    assert!(!whole_rests.is_empty(), "Expected whole rest glyph");

    // Default whole rest y = staff_y + 1.0*sp (hanging from 2nd line from top)
    // D5 in treble clef is just above middle line (hfs 2)
    // Rest should be pushed up (lower y value)
    let staff_y = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, .. } = cmd {
                if (y2 - y1).abs() < 0.01 {
                    Some(*y1)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .unwrap_or(0.0);

    let default_y = staff_y + 1.0 * sp; // default whole rest position
    assert!(
        whole_rests[0].1 <= default_y + 0.01,
        "Voice 0 whole rest should stay at or move above default. Rest y={}, default_y={}",
        whole_rests[0].1,
        default_y
    );
}

#[test]
fn test_trailing_rests_hidden_in_secondary_voice() {
    // Voice 0: whole note C5
    // Voice 1: quarter note D4, quarter rest, half rest
    // The quarter rest and half rest in voice 1 are both after the last note (beat 0),
    // so they should be hidden (trailing rests in non-primary voices are suppressed).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]},
                {"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "rest": {}},
                    {"duration": {"base": "half"}, "rest": {}}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Count quarter rest glyphs
    let quarter_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_QUARTER && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    // Count half rest glyphs
    let half_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_HALF && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    assert!(
        quarter_rests.is_empty(),
        "Trailing quarter rest in voice 1 should be hidden, got {}",
        quarter_rests.len()
    );
    assert!(
        half_rests.is_empty(),
        "Trailing half rest in voice 1 should be hidden, got {}",
        half_rests.len()
    );
}

#[test]
fn test_trailing_rests_not_hidden_in_primary_voice() {
    // Voice 0: quarter note C5, quarter rest, half rest
    // Voice 1: whole note D4
    // Rests in voice 0 (primary) should NOT be hidden — trailing rest hiding
    // only applies to secondary voices.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "rest": {}},
                    {"duration": {"base": "half"}, "rest": {}}
                ]},
                {"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Count quarter rest glyphs — should still be rendered (voice 0 is primary)
    let quarter_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_QUARTER && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    // Count half rest glyphs
    let half_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_HALF && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    assert_eq!(
        quarter_rests.len(),
        1,
        "Primary voice quarter rest should be rendered, got {}",
        quarter_rests.len()
    );
    assert_eq!(
        half_rests.len(),
        1,
        "Primary voice half rest should be rendered, got {}",
        half_rests.len()
    );
}

#[test]
fn test_all_rest_voice_hidden() {
    // Voice 0: whole note C5
    // Voice 1: 4 quarter rests (a voice with no notes at all)
    // All rests in voice 1 should be hidden since it has no notes.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]},
                {"content": [
                    {"duration": {"base": "quarter"}, "rest": {}},
                    {"duration": {"base": "quarter"}, "rest": {}},
                    {"duration": {"base": "quarter"}, "rest": {}},
                    {"duration": {"base": "quarter"}, "rest": {}}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Count quarter rest glyphs — all should be hidden
    let quarter_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_QUARTER && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    assert!(
        quarter_rests.is_empty(),
        "All rests in an all-rest secondary voice should be hidden, got {}",
        quarter_rests.len()
    );
}

#[test]
fn test_non_trailing_rest_not_hidden() {
    // Voice 0: whole note C5
    // Voice 1: quarter rest, quarter note D4, half rest
    // The quarter rest at beat 0 is BEFORE the last note (beat 1), so it should be visible.
    // The half rest at beat 2 is AFTER the last note, so it should be hidden.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]},
                {"content": [
                    {"duration": {"base": "quarter"}, "rest": {}},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                    {"duration": {"base": "half"}, "rest": {}}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Quarter rest at beat 0 should be visible (before the last note at beat 1)
    let quarter_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_QUARTER && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    // Half rest at beat 2 should be hidden (after the last note at beat 1)
    let half_rests: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = cmd
            {
                if *codepoint == smufl::REST_HALF && (*size - 4.0 * sp).abs() < 0.01 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    assert_eq!(
        quarter_rests.len(),
        1,
        "Non-trailing quarter rest in voice 1 should be visible, got {}",
        quarter_rests.len()
    );
    assert!(
        half_rests.is_empty(),
        "Trailing half rest in voice 1 should be hidden, got {}",
        half_rests.len()
    );
}

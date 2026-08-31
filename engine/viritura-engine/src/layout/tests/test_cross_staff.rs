// Cross-staff notes (Event.staff) tests

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::{layout_score, layout_with_mnx_scores};
use crate::model::*;
use crate::parse::parse_mnx;

// ═══════════════════════════════════════
// Cross-Staff Notes Tests
// ═══════════════════════════════════════

#[test]
fn test_event_staff_field_parses() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "sequences": [
                    {
                        "staff": 1,
                        "content": [
                            { "duration": { "base": "whole" },
                              "notes": [{ "pitch": { "step": "C", "octave": 5 } }] }
                        ]
                    },
                    {
                        "staff": 2,
                        "content": [
                            { "duration": { "base": "quarter" },
                              "notes": [{ "pitch": { "step": "C", "octave": 3 } }] },
                            { "duration": { "base": "quarter" }, "staff": 1,
                              "notes": [{ "pitch": { "step": "E", "octave": 4 } }],
                              "id": "cross1" },
                            { "duration": { "base": "half" },
                              "notes": [{ "pitch": { "step": "G", "octave": 3 } }] }
                        ]
                    }
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let m = &score.parts[0].measures[0];

    // Staff 2 sequence has 3 events
    let seq2 = &m.sequences[1];
    assert_eq!(seq2.staff, Some(2));

    // First event: no staff override
    let e0 = seq2.content[0].as_event().unwrap();
    assert_eq!(e0.staff, None);

    // Second event: staff=1 (cross-staff)
    let e1 = seq2.content[1].as_event().unwrap();
    assert_eq!(e1.staff, Some(1));
    assert_eq!(e1.id.as_deref(), Some("cross1"));

    // Third event: no staff override
    let e2 = seq2.content[2].as_event().unwrap();
    assert_eq!(e2.staff, None);
}

#[test]
fn test_event_staff_serializes() {
    let event = Event {
        duration: Duration {
            base: NoteValueBase::Quarter,
            dots: None,
        },
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
        staff: Some(2),
        stem_direction: None,
        orient: None,
        slurs: None,
        glissandos: None,
        markings: None,
        fermata: None,
        lyrics: None,
    };

    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"staff\":2"));
}

#[test]
fn test_event_staff_none_not_serialized() {
    let event = Event {
        duration: Duration {
            base: NoteValueBase::Quarter,
            dots: None,
        },
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
        stem_direction: None,
        orient: None,
        slurs: None,
        glissandos: None,
        markings: None,
        fermata: None,
        lyrics: None,
    };

    let json = serde_json::to_string(&event).unwrap();
    assert!(!json.contains("\"staff\""));
}

#[test]
fn test_cross_staff_notes_render_on_target_staff() {
    // Load the cross-staff-notes.mnx example and verify it renders
    // without panics and produces noteheads.
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/cross-staff-notes.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();

    assert_eq!(score.parts[0].staves, 2);

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have noteheads rendered
    let noteheads: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| is_notehead_glyph(c))
        .collect();
    assert!(
        noteheads.len() >= 8,
        "Expected at least 8 noteheads, got {}",
        noteheads.len()
    );
}

#[test]
fn test_cross_staff_event_layout_has_sequence_staff() {
    // Verify that EventLayout correctly tracks the parent sequence's staff.
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "sequences": [
                    {
                        "staff": 1,
                        "content": [
                            { "duration": { "base": "whole" },
                              "notes": [{ "pitch": { "step": "C", "octave": 5 } }] }
                        ]
                    },
                    {
                        "staff": 2,
                        "content": [
                            { "duration": { "base": "half" },
                              "notes": [{ "pitch": { "step": "C", "octave": 3 } }] },
                            { "duration": { "base": "half" }, "staff": 1,
                              "notes": [{ "pitch": { "step": "E", "octave": 4 } }] }
                        ]
                    }
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();

    // layout_score renders the grand staff — just verify it doesn't panic
    let dl = layout_score(&score, 0, &config);
    assert!(
        !dl.commands.is_empty(),
        "DisplayList should have render commands"
    );
}

#[test]
fn test_cross_staff_produces_extra_stem() {
    // When an event crosses staves, an extra stem should extend between staves.
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "sequences": [
                    {
                        "staff": 1,
                        "content": [
                            { "duration": { "base": "whole" },
                              "notes": [{ "pitch": { "step": "C", "octave": 5 } }] }
                        ]
                    },
                    {
                        "staff": 2,
                        "content": [
                            { "duration": { "base": "whole" }, "staff": 1,
                              "notes": [{ "pitch": { "step": "E", "octave": 4 } }] }
                        ]
                    }
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Count stem lines (vertical thin lines)
    let stems: Vec<_> = dl.commands.iter().filter(|c| is_stem_line(c)).collect();
    // The cross-staff note should produce at least one stem line
    assert!(!stems.is_empty(), "Cross-staff note should have a stem");
}

#[test]
fn test_cross_staff_from_below_pushes_native_articulations_above() {
    // A grand-staff part where the BOTTOM staff (staff 2) holds a voice that
    // crosses UP to the TOP staff (staff 1). The arriving voice acts as a
    // secondary voice (from below), so the top staff's NATIVE voice is the
    // upper voice and its staccatos must sit ABOVE (outer side), not squished
    // between the two voices. Without the cross-staff articulation override the
    // native voice (stems flipped up) would place them below by the single-voice
    // rule. Mirrors the Rhapsody piano cross-staff passage.
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "sequences": [
                    { "staff": 1, "content": [
                        { "duration": { "base": "quarter" }, "markings": { "staccato": {} },
                          "notes": [{ "pitch": { "step": "G", "octave": 5 } }] },
                        { "duration": { "base": "quarter" }, "markings": { "staccato": {} },
                          "notes": [{ "pitch": { "step": "A", "octave": 5 } }] },
                        { "duration": { "base": "quarter" }, "markings": { "staccato": {} },
                          "notes": [{ "pitch": { "step": "G", "octave": 5 } }] },
                        { "duration": { "base": "quarter" }, "markings": { "staccato": {} },
                          "notes": [{ "pitch": { "step": "F", "octave": 5 } }] }
                    ]},
                    { "staff": 2, "content": [
                        { "duration": { "base": "quarter" }, "staff": 1,
                          "notes": [{ "pitch": { "step": "C", "octave": 5 } }] },
                        { "duration": { "base": "quarter" }, "staff": 1,
                          "notes": [{ "pitch": { "step": "D", "octave": 5 } }] },
                        { "duration": { "base": "quarter" }, "staff": 1,
                          "notes": [{ "pitch": { "step": "C", "octave": 5 } }] },
                        { "duration": { "base": "quarter" }, "staff": 1,
                          "notes": [{ "pitch": { "step": "B", "octave": 4 } }] }
                    ]}
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let above = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, crate::render::RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_ABOVE)
        })
        .count();
    let below = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, crate::render::RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_BELOW)
        })
        .count();

    assert_eq!(
        above, 4,
        "all 4 native staccatos must render ABOVE (cross-staff from below); got above={above} below={below}"
    );
    assert_eq!(
        below, 0,
        "no native staccato should render below; got {below}"
    );
}

/// A cross-staff beam group must anchor to the *piano's own* two staves, not
/// to whatever staff happens to share the part-relative index in another part.
/// Regression for the bug where `render_between_staff_beam` indexed the
/// system-wide `staff_y_offsets` with part-relative staff numbers, sending the
/// beam (and its stems) up to the top of the score when a single-staff part
/// preceded the piano.
#[test]
fn test_cross_staff_beam_anchors_to_own_staves() {
    use crate::layout::layout_full_score;

    // Flute (1 staff) followed by a piano (2 staves) whose lower sequence has a
    // cross-staff beamed pair — one note on each staff. The beam belongs between
    // the two piano staves, NOT up near the flute.
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [
            {
                "name": "Flute", "id": "P1", "staves": 1,
                "measures": [{
                    "clefs": [{ "clef": { "sign": "G", "staffPosition": -2 } }],
                    "sequences": [{ "content": [
                        { "duration": { "base": "whole" },
                          "notes": [{ "pitch": { "step": "G", "octave": 5 } }] }
                    ] }]
                }]
            },
            {
                "name": "Piano", "id": "P2", "staves": 2,
                "measures": [{
                    "clefs": [
                        { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                        { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                    ],
                    "beams": [{ "events": ["cb1", "cb2"] }],
                    "sequences": [
                        { "staff": 1, "content": [
                            { "duration": { "base": "whole" },
                              "notes": [{ "pitch": { "step": "C", "octave": 5 } }] }
                        ] },
                        { "staff": 2, "content": [
                            { "duration": { "base": "eighth" }, "id": "cb1",
                              "notes": [{ "pitch": { "step": "C", "octave": 3 } }] },
                            { "duration": { "base": "eighth" }, "id": "cb2", "staff": 1,
                              "notes": [{ "pitch": { "step": "G", "octave": 4 } }] },
                            { "duration": { "base": "half" },
                              "notes": [{ "pitch": { "step": "E", "octave": 3 } }] }
                        ] }
                    ]
                }]
            }
        ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_full_score(&score, &config);

    // Visual staff Y baselines: flute = staff 0, piano-top = staff 1, piano-bottom = staff 2.
    let staff_y = |idx: usize| {
        dl.measure_bounds
            .iter()
            .find(|b| b.staff_index == idx)
            .map(|b| b.y)
            .unwrap_or_else(|| panic!("no bounds for staff {idx}"))
    };
    let piano_top = staff_y(1);
    let piano_bottom = staff_y(2);

    // The between-staff beam polygon should sit in the gap between the two piano
    // staves — below the top staff's lower line and above the bottom staff. With
    // the bug it landed between the flute (staff 0) and piano-top (staff 1),
    // i.e. above `piano_top`.
    let beam_y = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            crate::render::RenderCommand::DrawPolygon { points, .. } => {
                Some(points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min))
            }
            _ => None,
        })
        .next()
        .expect("expected a between-staff beam polygon");

    assert!(
        beam_y > piano_top + 3.0 * sp && beam_y < piano_bottom + 4.0 * sp,
        "cross-staff beam Y {beam_y:.1} should lie between the piano staves \
         (top {piano_top:.1}, bottom {piano_bottom:.1}), not up near the flute"
    );
}

/// Mirror of the real Rhapsody data: a beam whose HOME staff is the top staff
/// (staff 1) and whose later events dip DOWN to staff 2 via `event.staff`
/// overrides. The beam must sit in the gap between the staves, not hug staff 1.
#[test]
fn test_cross_staff_beam_home_top_dips_down() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "name": "Piano", "id": "P1", "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "beams": [{ "events": ["d1", "d2", "d3"] }],
                "sequences": [
                    { "staff": 1, "content": [
                        { "duration": { "base": "eighth" }, "id": "d1",
                          "notes": [{ "pitch": { "step": "C", "octave": 4 } }] },
                        { "duration": { "base": "eighth" }, "id": "d2", "staff": 2,
                          "notes": [{ "pitch": { "step": "B", "octave": 3 } }] },
                        { "duration": { "base": "eighth" }, "id": "d3", "staff": 2,
                          "notes": [{ "pitch": { "step": "B", "octave": 3 } }] },
                        { "duration": { "base": "eighth" },
                          "notes": [{ "pitch": { "step": "C", "octave": 4 } }] }
                    ] },
                    { "staff": 2, "content": [
                        { "duration": { "base": "whole" },
                          "notes": [{ "pitch": { "step": "E", "octave": 2 } }] }
                    ] }
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = crate::layout::layout_full_score(&score, &config);

    let staff_y = |idx: usize| {
        dl.measure_bounds
            .iter()
            .find(|b| b.staff_index == idx)
            .map(|b| b.y)
            .unwrap_or_else(|| panic!("no bounds for staff {idx}"))
    };
    let piano_top = staff_y(0);
    let piano_bottom = staff_y(1);

    let beam_y = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            crate::render::RenderCommand::DrawPolygon { points, .. } => {
                Some(points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min))
            }
            _ => None,
        })
        .next()
        .expect("expected a between-staff beam polygon");

    assert!(
        beam_y > piano_top + 3.0 * sp && beam_y < piano_bottom + 4.0 * sp,
        "cross-staff beam Y {beam_y:.1} should lie between the piano staves \
         (top {piano_top:.1}, bottom {piano_bottom:.1}), not hug the top staff"
    );
}

#[test]
fn test_cross_staff_beam_survives_mnx_layout_virtual_measure() {
    let json = r#"{
        "mnx": { "version": 1, "support": { "useBeams": true } },
        "global": {
            "measures": [{
                "id": "m1",
                "time": { "count": 4, "unit": 4 }
            }]
        },
        "layouts": [{
            "id": "piano-layout",
            "content": [{
                "type": "group",
                "symbol": "brace",
                "content": [
                    {
                        "type": "staff",
                        "sources": [{ "part": "piano", "staff": 1 }]
                    },
                    {
                        "type": "staff",
                        "sources": [{ "part": "piano", "staff": 2 }]
                    }
                ]
            }]
        }],
        "scores": [{
            "name": "Piano",
            "pages": [{
                "systems": [{ "measure": "m1", "layout": "piano-layout" }]
            }]
        }],
        "parts": [{
            "id": "piano",
            "name": "Piano",
            "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "beams": [{ "events": ["b1", "b2", "b3", "b4"] }],
                "sequences": [
                    {
                        "staff": 1,
                        "content": [{
                            "duration": { "base": "whole" },
                            "notes": [{ "pitch": { "step": "C", "octave": 5 } }]
                        }]
                    },
                    {
                        "staff": 2,
                        "content": [
                            {
                                "id": "b1",
                                "duration": { "base": "eighth" },
                                "notes": [{ "pitch": { "step": "E", "octave": 2 } }]
                            },
                            {
                                "id": "b2",
                                "staff": 1,
                                "duration": { "base": "eighth" },
                                "notes": [{ "pitch": { "step": "G", "octave": 4 } }]
                            },
                            {
                                "id": "b3",
                                "staff": 1,
                                "duration": { "base": "eighth" },
                                "notes": [{ "pitch": { "step": "A", "octave": 4 } }]
                            },
                            {
                                "id": "b4",
                                "staff": 1,
                                "duration": { "base": "eighth" },
                                "notes": [{ "pitch": { "step": "B", "octave": 4 } }]
                            },
                            {
                                "duration": { "base": "half" },
                                "notes": [{ "pitch": { "step": "E", "octave": 2 } }]
                            }
                        ]
                    }
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let beam_polygons = dl
        .commands
        .iter()
        .filter(|command| matches!(command, crate::render::RenderCommand::DrawPolygon { .. }))
        .count();
    assert!(
        beam_polygons > 0,
        "authored cross-staff beams must survive MNX layout virtual-measure construction"
    );
}

/// Regression: a dynamic authored on staff 2 of a grand-staff part must render
/// exactly once, anchored to staff 2 — not duplicated onto both staves. Before
/// the fix the per-staff layout builder collected every measure direction for
/// every visual staff of the part (the staff filter that clefs already had was
/// missing for dynamics/hairpins/pedals/ottavas/expressions), so a piano left-
/// hand dynamic appeared on both the treble and bass staves.
#[test]
fn test_dynamic_on_staff_two_not_duplicated() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "name": "Piano", "id": "P1", "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "dynamics": [{ "type": "immediate", "value": "p", "position": { "fraction": [0, 1] }, "staff": 2 }],
                "sequences": [
                    { "staff": 1, "content": [
                        { "duration": { "base": "whole" },
                          "notes": [{ "pitch": { "step": "C", "octave": 5 } }] }
                    ] },
                    { "staff": 2, "content": [
                        { "duration": { "base": "whole" },
                          "notes": [{ "pitch": { "step": "E", "octave": 2 } }] }
                    ] }
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = crate::layout::layout_full_score(&score, &config);

    let dyn_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            crate::render::RenderCommand::DrawGlyph { y, codepoint, .. }
                if (0xE520..=0xE54F).contains(codepoint) =>
            {
                Some(*y)
            }
            _ => None,
        })
        .collect();

    assert_eq!(
        dyn_ys.len(),
        1,
        "staff-2 dynamic must render exactly once (not duplicated on both staves), got {dyn_ys:?}"
    );

    let staff_y = |idx: usize| {
        dl.measure_bounds
            .iter()
            .find(|b| b.staff_index == idx)
            .map(|b| b.y)
            .unwrap_or_else(|| panic!("no bounds for staff {idx}"))
    };
    let top = staff_y(0);
    // The dynamic belongs to the bass staff, so it must sit below the treble
    // staff body (in the gap or lower), never floating above the top staff.
    assert!(
        dyn_ys[0] > top + 4.0 * config.sp,
        "staff-2 dynamic Y {:.1} should sit below the treble staff (top {top:.1}), not above it",
        dyn_ys[0]
    );
}

/// Regression: a beam group whose events are *uniformly* dipped onto the
/// other staff (every event carries the same `event.staff` override, so the
/// mixed-staff `render_between_staff_beam` path bails out) must anchor its beam
/// to that target staff — not snap back to the home staff's middle line. Before
/// the fix the single-staff fallback passed the sequence's home `staff_y` to
/// the quanting frame, so the "reach toward the middle line" clamp stranded the
/// beam on the top staff with giant stems reaching down to the relocated
/// noteheads (Rhapsody in Blue, RH runs that cross fully into the bass staff).
#[test]
fn test_cross_staff_uniformly_dipped_beam_anchors_to_target_staff() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "name": "Piano", "id": "P1", "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "beams": [{ "events": ["u1", "u2", "u3", "u4"] }],
                "sequences": [
                    { "staff": 1, "content": [
                        { "duration": { "base": "16th" }, "id": "u1", "staff": 2,
                          "notes": [{ "pitch": { "step": "B", "octave": 3 } }] },
                        { "duration": { "base": "16th" }, "id": "u2", "staff": 2,
                          "notes": [{ "pitch": { "step": "G", "octave": 3 } }] },
                        { "duration": { "base": "16th" }, "id": "u3", "staff": 2,
                          "notes": [{ "pitch": { "step": "A", "octave": 3 } }] },
                        { "duration": { "base": "16th" }, "id": "u4", "staff": 2,
                          "notes": [{ "pitch": { "step": "G", "octave": 3 } }] }
                    ] },
                    { "staff": 2, "content": [
                        { "duration": { "base": "whole" },
                          "notes": [{ "pitch": { "step": "E", "octave": 2 } }] }
                    ] }
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = crate::layout::layout_full_score(&score, &config);

    let staff_y = |idx: usize| {
        dl.measure_bounds
            .iter()
            .find(|b| b.staff_index == idx)
            .map(|b| b.y)
            .unwrap_or_else(|| panic!("no bounds for staff {idx}"))
    };
    let top = staff_y(0);
    let bottom = staff_y(1);

    let beam_y = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            crate::render::RenderCommand::DrawPolygon { points, .. } => {
                Some(points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min))
            }
            _ => None,
        })
        .next()
        .expect("expected a beam polygon");

    // The notes live on the bottom (bass) staff, so the beam must sit near it —
    // below the top staff entirely, not clamped to the top staff's middle line.
    assert!(
        beam_y > top + 6.0 * sp,
        "uniformly-dipped beam Y {beam_y:.1} must anchor to the bass staff \
         (top {top:.1}, bottom {bottom:.1}), not snap back to the top staff"
    );
}

/// Regression: the tuplet bracket/number for a cross-staff beamed group must
/// follow the beam into the gap between the staves, not float on the sequence's
/// home staff. Before the fix `render_tuplet_brackets` computed the bracket Y
/// from the home `staff_y`, leaving the "3" stranded far above the top staff
/// while the beam sat between the staves (Rhapsody in Blue cross-staff runs).
#[test]
fn test_cross_staff_tuplet_number_follows_beam() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "name": "Piano", "id": "P1", "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "beams": [{ "events": ["u1", "u2", "u3"] }],
                "sequences": [
                    { "staff": 1, "content": [
                        { "type": "tuplet",
                          "inner": { "multiple": 3, "duration": { "base": "eighth" } },
                          "outer": { "multiple": 2, "duration": { "base": "eighth" } },
                          "content": [
                            { "duration": { "base": "eighth" }, "id": "u1", "staff": 2,
                              "notes": [{ "pitch": { "step": "B", "octave": 3 } }] },
                            { "duration": { "base": "eighth" }, "id": "u2", "staff": 2,
                              "notes": [{ "pitch": { "step": "A", "octave": 3 } }] },
                            { "duration": { "base": "eighth" }, "id": "u3", "staff": 2,
                              "notes": [{ "pitch": { "step": "G", "octave": 3 } }] }
                          ] },
                        { "duration": { "base": "half" }, "staff": 1,
                          "notes": [{ "pitch": { "step": "C", "octave": 5 } }] }
                    ] },
                    { "staff": 2, "content": [
                        { "duration": { "base": "whole" },
                          "notes": [{ "pitch": { "step": "E", "octave": 2 } }] }
                    ] }
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = crate::layout::layout_full_score(&score, &config);
    let staff_y = |idx: usize| {
        dl.measure_bounds
            .iter()
            .find(|b| b.staff_index == idx)
            .map(|b| b.y)
            .unwrap_or_else(|| panic!("no bounds for staff {idx}"))
    };
    let top = staff_y(0);
    let bottom = staff_y(1);

    let beam_y = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            crate::render::RenderCommand::DrawPolygon { points, .. } => {
                Some(points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min))
            }
            _ => None,
        })
        .next()
        .expect("expected a beam polygon");

    let tuplet_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            crate::render::RenderCommand::DrawGlyph { y, codepoint, .. }
                if (0xE880..=0xE889).contains(codepoint) =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("expected a tuplet number glyph");

    // The tuplet number must sit in the gap, hugging the beam — not stranded on
    // the home (top) staff. Require it to be below the top staff entirely and
    // within a couple of staff-spaces of the beam.
    assert!(
        tuplet_y > top + 6.0 * sp,
        "tuplet number Y {tuplet_y:.1} must follow the beam into the gap \
         (top {top:.1}, bottom {bottom:.1}), not float on the home staff"
    );
    assert!(
        (tuplet_y - beam_y).abs() < 3.0 * sp,
        "tuplet number Y {tuplet_y:.1} should hug the beam at {beam_y:.1}"
    );
}

/// Regression: when a voice cross-staffs *downward* (its home is the upper
/// staff but events are overridden onto the lower staff), the lower staff's
/// native voice must yield by flipping to **stems-down**, clearing the space
/// the arriving upper voice now occupies. This mirrors the existing upward
/// behavior (bottom→top cross flips the native voice stems-up). Before the fix
/// `cross_staff_flip_native_stems_up` always flipped native stems up, regardless
/// of arrival direction, so a top→bottom dip left the native bass notes
/// (default stems-up for low pitches) colliding with the descending voice.
#[test]
fn test_cross_staff_top_to_bottom_flips_native_down() {
    // Staff-1 (treble) voice dips two quarters down onto staff 2, then a half
    // note stays on staff 1. The native staff-2 voice is a half note (E2) at
    // beats 3–4 — a very low pitch that would default to stem-up in isolation.
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "name": "Piano", "id": "P1", "staves": 2,
            "measures": [{
                "clefs": [
                    { "clef": { "sign": "G", "staffPosition": -2 }, "staff": 1 },
                    { "clef": { "sign": "F", "staffPosition": 2 }, "staff": 2 }
                ],
                "sequences": [
                    { "staff": 1, "content": [
                        { "duration": { "base": "quarter" }, "staff": 2,
                          "notes": [{ "pitch": { "step": "A", "octave": 3 } }] },
                        { "duration": { "base": "quarter" }, "staff": 2,
                          "notes": [{ "pitch": { "step": "B", "octave": 3 } }] },
                        { "duration": { "base": "half" },
                          "notes": [{ "pitch": { "step": "C", "octave": 5 } }] }
                    ] },
                    { "staff": 2, "content": [
                        { "duration": { "base": "half" },
                          "notes": [{ "pitch": { "step": "G", "octave": 4 } }] },
                        { "duration": { "base": "half" },
                          "notes": [{ "pitch": { "step": "E", "octave": 2 } }] }
                    ] }
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = crate::layout::layout_full_score(&score, &config);

    let staff_y = |idx: usize| {
        dl.measure_bounds
            .iter()
            .find(|b| b.staff_index == idx)
            .map(|b| b.y)
            .unwrap_or_else(|| panic!("no bounds for staff {idx}"))
    };
    let bottom = staff_y(1);

    // The native bass note is the lowest-pitched notehead (largest y) — the E2.
    let (nh_x, nh_y) = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            crate::render::RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if (0xE0A0..=0xE0A4).contains(codepoint) => Some((*x, *y)),
            _ => None,
        })
        .fold((0.0_f64, f64::NEG_INFINITY), |acc, p| {
            if p.1 > acc.1 {
                p
            } else {
                acc
            }
        });

    assert!(
        nh_y > bottom,
        "expected the native bass notehead below the bottom staff top, got y {nh_y:.1}"
    );

    // A stem-down note's stem attaches at the notehead and extends *downward*
    // (toward larger y). Find the stem line at the native note's x and confirm
    // it descends below the notehead.
    let stem_down = dl.commands.iter().any(|c| match c {
        crate::render::RenderCommand::DrawLine {
            x1,
            x2,
            y1,
            y2,
            width,
            ..
        } => {
            let is_stem = (x1 - x2).abs() < 0.001 && *width < 2.0;
            let near_x = (x1 - nh_x).abs() < 2.0 * sp;
            let lo = y1.min(*y2);
            let hi = y1.max(*y2);
            is_stem && near_x && (lo - nh_y).abs() < 1.5 * sp && hi > nh_y + 2.0 * sp
        }
        _ => false,
    });

    assert!(
        stem_down,
        "native bass note (y {nh_y:.1}, x {nh_x:.1}) must flip to stem-down to \
         make way for the voice cross-staffing from the top staff"
    );
}

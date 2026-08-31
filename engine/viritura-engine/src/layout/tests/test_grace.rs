// Auto-generated from tests.rs — test_grace
// 8 test(s)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::layout::{layout_full_score, layout_score};
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_grace_note_layout_and_rendering() {
    // grace-note.mnx: grace B4 (eighth, acciaccatura) + whole C5
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-note.mnx").unwrap();
    let score = parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Should have at least one DrawGlyph for grace notehead (reduced size)
    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    let grace_glyphs: Vec<_> = dl.commands.iter().filter(|c| {
        matches!(c, RenderCommand::DrawGlyph { size, .. } if (*size - grace_glyph_size).abs() < 0.01)
    }).collect();
    assert!(
        !grace_glyphs.is_empty(),
        "Expected grace note glyphs at reduced size {:.1}, found none",
        grace_glyph_size
    );

    // Grace slurs are only rendered when explicitly defined in MNX.
    // This test does not define explicit slurs, so no beziers expected.
    let beziers: Vec<_> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        0,
        "No auto grace slurs expected (only explicit MNX slurs), got {}",
        beziers.len()
    );

    // Grace note should be positioned left of the main note
    let main_glyph_size = 4.0 * sp;
    let main_glyphs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } = c
            {
                if (*size - main_glyph_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_WHOLE {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    let grace_xs: Vec<f64> = grace_glyphs
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph { x, .. } = c {
                Some(*x)
            } else {
                None
            }
        })
        .collect();
    assert!(!main_glyphs.is_empty(), "Expected main whole-note glyph");
    assert!(!grace_xs.is_empty(), "Expected grace note glyph");
    assert!(
        grace_xs[0] < main_glyphs[0],
        "Grace note x ({:.1}) should be left of main note x ({:.1})",
        grace_xs[0],
        main_glyphs[0]
    );

    // Should have a slash line (DrawLine at an angle) for acciaccatura
    let slash_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = c {
                // Slash is a diagonal line (x1 != x2 AND y1 != y2, not horizontal/vertical)
                let dx = (x2 - x1).abs();
                let dy = (y2 - y1).abs();
                dx > 0.1 && dy > 0.1 && dx < 2.0 * sp && dy < 2.0 * sp
            } else {
                false
            }
        })
        .collect();
    assert!(
        !slash_lines.is_empty(),
        "Expected at least one diagonal slash line for acciaccatura"
    );
}

#[test]
fn test_trailing_grace_notes_render_after_main_event() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "alter": 1, "octave": 5}}]},
            {"type": "grace", "content": [
                {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "F", "alter": 1, "octave": 5}}]},
                {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "G", "alter": 1, "octave": 5}}]}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);
    let grace_size = 4.0 * sp * 0.65;
    let main_size = 4.0 * sp;
    let main_x = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } if (*size - main_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Expected principal quarter-note glyph");
    let grace_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } if (*size - grace_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some(*x)
            }
            _ => None,
        })
        .collect();

    assert_eq!(grace_xs.len(), 2, "Expected both trailing grace noteheads");
    assert!(
        grace_xs.iter().all(|x| *x > main_x),
        "Trailing grace noteheads should render after the principal note: main x={main_x}, grace xs={grace_xs:?}"
    );
}

#[test]
fn test_grace_notes_beamed() {
    // grace-notes-beamed.mnx: 3 grace note groups with beam definitions
    // Group 1: grace1+grace2 (2 eighths), Group 2: grace3+4+5 (3), Group 3: grace6+7+8+9 (4)
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;

    // Grace noteheads at reduced size — should have 9 total (2+3+4 grace notes)
    let grace_glyphs: Vec<_> = dl.commands.iter().filter(|c| {
        matches!(c, RenderCommand::DrawGlyph { size, .. } if (*size - grace_glyph_size).abs() < 0.01)
    }).collect();
    assert!(
        grace_glyphs.len() >= 9,
        "Expected at least 9 grace note glyphs, got {}",
        grace_glyphs.len()
    );

    // Beamed grace notes should NOT have flag glyphs
    // Flags use codepoints 0xE240-0xE24F (eighth flag up/down and higher)
    let grace_flags: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { size, codepoint, .. }
            if (*size - grace_glyph_size).abs() < 0.01
            && *codepoint >= 0xE240 && *codepoint <= 0xE24F)
        })
        .collect();
    assert_eq!(
        grace_flags.len(),
        0,
        "Beamed grace notes should have no flag glyphs, got {}",
        grace_flags.len()
    );

    // Should have beam polygons at grace scale
    // Beam thickness at grace scale = 0.5 * sp * 0.65
    let beam_thickness = 0.5 * sp * grace_scale;
    let grace_beams: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawPolygon { points, color, .. }
            if points.len() == 4
            && ((points[3].1 - points[0].1).abs() - beam_thickness).abs() < 0.1
            && color == "#000000")
        })
        .collect();
    // 3 beam groups → at least 3 primary beams
    assert!(
        grace_beams.len() >= 3,
        "Expected at least 3 grace beam rectangles, got {}",
        grace_beams.len()
    );
}

#[test]
fn test_grace_notes_auto_beam_without_explicit_beams() {
    // Two 16th-note grace notes with no `beams` declared must auto-beam:
    // standard engraving practice beams a run of two or more eighth-or-shorter
    // grace notes. The individual flags must be suppressed and a grace-scale
    // beam polygon emitted (mirrors Rhapsody m138-139 cello/bass grace pairs).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "id": "g1", "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                    {"duration": {"base": "16th"}, "id": "g2", "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                ]},
                {"duration": {"base": "half"}, "id": "m1", "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;

    // No flag glyphs on the grace notes — they are beamed instead.
    let grace_flags = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { size, codepoint, .. }
            if (*size - grace_glyph_size).abs() < 0.01
            && *codepoint >= 0xE240 && *codepoint <= 0xE24F)
        })
        .count();
    assert_eq!(
        grace_flags, 0,
        "Auto-beamed grace notes should have no flag glyphs, got {grace_flags}"
    );

    // A grace-scale beam polygon must be present (two beams for 16th-note pair).
    let beam_thickness = 0.5 * sp * grace_scale;
    let grace_beams = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawPolygon { points, color, .. }
            if points.len() == 4
            && ((points[3].1 - points[0].1).abs() - beam_thickness).abs() < 0.1
            && color == "#000000")
        })
        .count();
    assert!(
        grace_beams >= 2,
        "Expected at least 2 grace beam polygons (16th pair), got {grace_beams}"
    );
}

#[test]
fn test_grace_slur_only_when_explicit_in_mnx() {
    // Grace slurs are only rendered when explicitly defined in MNX.
    // grace-notes-beamed.mnx does NOT have explicit slur definitions,
    // so no grace-to-main slurs should be rendered.
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let slur_count = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawFilledBezier { .. }))
        .count();
    assert_eq!(
        slur_count, 0,
        "No auto grace slurs expected without explicit MNX slur definitions, got {}",
        slur_count
    );
}

#[test]
fn test_grace_note_slur_to_main_renders() {
    // A grace note carrying an explicit slur targeting the following principal
    // note must render a slur. Grace notes live in EventLayout.grace_notes and
    // were previously not addressable as slur endpoints, so nothing was drawn.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "g1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}], "slurs": [{"target": "m1"}]}
                ]},
                {"id": "m1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        1,
        "Expected 1 slur bezier from grace note to main note, got {}",
        beziers.len()
    );

    // The slur should start at the grace note (left) and end at the main note (right).
    if let RenderCommand::DrawFilledBezier { x1, x2, .. } = beziers[0] {
        assert!(
            *x1 < *x2,
            "Grace→main slur should run left→right (x1={} x2={})",
            x1,
            x2
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }

    // The start endpoint must hug the grace note's (shorter) stem, not float a
    // full main-note stem-length above it. Locate the grace notehead glyph and
    // assert the slur's start Y sits within a grace-scaled stem reach of it.
    let sp = config.sp;
    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    let grace_head_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, size, .. } if (*size - grace_glyph_size).abs() < 0.01 => {
                Some(*y)
            }
            _ => None,
        })
        .expect("grace notehead glyph not found");
    if let RenderCommand::DrawFilledBezier { y1, .. } = beziers[0] {
        // A full main stem-length anchor would lift the tip ≳ stem_length·sp
        // (≈3.5 sp) above the head; the grace-scaled anchor keeps it under 3 sp.
        let lift = grace_head_y - *y1;
        assert!(
            lift < 3.0 * sp,
            "Grace slur start should hug the grace stem (lift={lift} sp_threshold={})",
            3.0 * sp
        );
        assert!(
            *y1 > grace_head_y,
            "single-voice grace slur should leave the grace notehead below"
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_upward_grace_slur_springs_from_grace_stem_top() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"type": "grace", "content": [
                {"id": "g", "duration": {"base": "eighth"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "m"}]}
            ]},
            {"id": "m", "duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "G", "octave": 5}}]}
        ]}]}]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let grace_size = 4.0 * config.sp * 0.65;
    let (grace_x, grace_y) = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                size,
                codepoint,
                ..
            } if (*size - grace_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some((*x, *y))
            }
            _ => None,
        })
        .expect("grace notehead");
    let slur = dl
        .commands
        .iter()
        .find(|command| is_draw_bezier(command))
        .expect("slur");
    if let RenderCommand::DrawFilledBezier { x1, y1, .. } = slur {
        assert!(
            *y1 < grace_y - config.sp,
            "steep upward grace slur should start at the grace stem top: tip={y1}, head={grace_y}"
        );
        assert!(
            *x1 > grace_x,
            "grace stem-top endpoint should align with the up-stem side: tip={x1}, head={grace_x}"
        );
    }
}

#[test]
fn test_oboe_octave_grace_slur_auto_direction_uses_above_stem_top() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"type": "grace", "slash": true, "content": [
                {"id": "oboe-grace", "duration": {"base": "eighth"},
                 "notes": [{"pitch": {"step": "E", "octave": 4}}],
                 "slurs": [{"target": "oboe-main"}]}
            ]},
            {"id": "oboe-main", "duration": {"base": "eighth"},
             "notes": [{"pitch": {"step": "E", "octave": 5}}]},
            {"duration": {"base": "quarter", "dots": 1}, "rest": {}}
        ]}]}]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let grace_size = 4.0 * config.sp * 0.65;
    let (grace_x, grace_y) = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                size,
                codepoint,
                ..
            } if (*size - grace_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some((*x, *y))
            }
            _ => None,
        })
        .expect("oboe grace notehead");
    let slur = dl
        .commands
        .iter()
        .find(|command| is_draw_bezier(command))
        .expect("slur");
    if let RenderCommand::DrawFilledBezier {
        x1,
        y1,
        x2,
        y2,
        ocx1,
        ocy1,
        ocx2,
        ocy2,
        ..
    } = slur
    {
        assert!(
            *y1 < grace_y - config.sp,
            "automatic ascending grace slur must start at stem top"
        );
        assert!(
            *x1 > grace_x,
            "automatic ascending grace slur must align with up-stem side"
        );
        let chord_y = |x: f64| y1 + (y2 - y1) * ((x - x1) / (x2 - x1));
        assert!(
            *ocy1 < chord_y(*ocx1) && *ocy2 < chord_y(*ocx2),
            "lower grace to higher principal must form a cap-shaped arch, not a cup"
        );
    }
}

#[test]
fn test_grace_slur_moves_above_ledger_lines_and_measured_accidentals() {
    for target in [
        r#"{"step":"D","octave":7}"#,
        r#"{"step":"C","octave":5,"alter":1}"#,
    ] {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
                "parts": [{{"measures": [{{"sequences": [{{"content": [
                    {{"type":"grace","content":[{{"id":"g","duration":{{"base":"eighth"}},"notes":[{{"pitch":{{"step":"C","octave":7}}}}],"slurs":[{{"target":"m"}}]}}]}},
                    {{"id":"m","duration":{{"base":"quarter"}},"notes":[{{"pitch":{target}}}]}}
                ]}}]}}]}}]
            }}"#
        );
        let dl = layout_score(&parse_mnx(&json).unwrap(), 0, &LayoutConfig::default());
        let slur = dl
            .commands
            .iter()
            .find(|command| is_draw_bezier(command))
            .expect("grace slur");
        let grace_size = 4.0 * LayoutConfig::default().sp * 0.65;
        let main_size = 4.0 * LayoutConfig::default().sp;
        let grace_head = dl
            .commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph {
                    y, size, codepoint, ..
                } if (*size - grace_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                    Some(*y)
                }
                _ => None,
            })
            .expect("grace notehead");
        let main_head = dl
            .commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph {
                    y, size, codepoint, ..
                } if (*size - main_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                    Some(*y)
                }
                _ => None,
            })
            .expect("main notehead");
        let (y1, y2) = super::test_helpers::bezier_endpoints_y(slur);
        assert!(
            y1 < grace_head && y2 < main_head,
            "ledger-line or accidental risk should move both tips above their noteheads: y1={y1}, grace={grace_head}, y2={y2}, main={main_head}"
        );
    }
}

#[test]
fn test_grace_slur_defaults_to_uppermost_resolving_note_of_chord() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "sequences": [{
                    "content": [
                        {"type": "grace", "content": [
                            {"id": "g", "duration": {"base": "eighth"},
                             "notes": [{"pitch": {"step": "D", "octave": 5}}],
                             "slurs": [{"target": "m"}]}
                        ]},
                        {"id": "m", "duration": {"base": "quarter"}, "notes": [
                            {"pitch": {"step": "C", "octave": 5}},
                            {"pitch": {"step": "E", "octave": 5}}
                        ]}
                    ]
                }]
            }]
        }]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur = dl
        .commands
        .iter()
        .find(|command| is_draw_bezier(command))
        .expect("slur");
    let (_, y2) = super::test_helpers::bezier_endpoints_y(slur);
    let mut main_noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                y, size, codepoint, ..
            } if (*size - 4.0 * config.sp).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some(*y)
            }
            _ => None,
        })
        .collect();
    main_noteheads.sort_by(f64::total_cmp);
    assert_eq!(main_noteheads.len(), 2);
    assert!(
        y2 < (main_noteheads[0] + main_noteheads[1]) * 0.5,
        "grace slur should resolve toward upper chord note: endpoint={y2}, heads={main_noteheads:?}"
    );
}

#[test]
fn test_each_authored_grace_group_keeps_an_independent_slur() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "sequences": [{
                    "content": [
                        {"type": "grace", "content": [
                            {"id": "g1", "duration": {"base": "eighth"},
                             "notes": [{"pitch": {"step": "D", "octave": 5}}],
                             "slurs": [{"target": "m1"}]}
                        ]},
                        {"id": "m1", "duration": {"base": "quarter"},
                         "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                        {"type": "grace", "content": [
                            {"id": "g2", "duration": {"base": "eighth"},
                             "notes": [{"pitch": {"step": "F", "octave": 5}}],
                             "slurs": [{"target": "m2"}]}
                        ]},
                        {"id": "m2", "duration": {"base": "quarter"},
                         "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                    ]
                }]
            }]
        }]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    assert_eq!(
        dl.commands
            .iter()
            .filter(|command| is_draw_bezier(command))
            .count(),
        2,
        "each authored grace group should retain its own slur"
    );
}

#[test]
fn test_grace_slur_targeting_tie_start_stops_at_first_notehead() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "gtg", "duration": {"base": "eighth"},
                     "notes": [{"id": "gtgn", "pitch": {"step": "D", "octave": 5}}],
                     "slurs": [{"target": "gt1"}]}
                ]},
                {"id": "gt1", "duration": {"base": "quarter"},
                 "notes": [{"id": "gtn1", "pitch": {"step": "C", "octave": 5},
                            "ties": [{"target": "gtn2"}]}]},
                {"id": "gt2", "duration": {"base": "quarter"},
                 "notes": [{"id": "gtn2", "pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "half"}, "rest": {}}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur_x2 = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| match command {
            RenderCommand::DrawFilledBezier { x2, .. }
                if dl
                    .element_ids
                    .get(index)
                    .and_then(Option::as_ref)
                    .is_some_and(|id| id.starts_with("slur/")) =>
            {
                Some(*x2)
            }
            _ => None,
        })
        .expect("grace slur");
    let event_notehead_x = |event_id: &str| {
        dl.commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| match command {
                RenderCommand::DrawGlyph { x, size, .. }
                    if (*size - 4.0 * config.sp).abs() < 0.01
                        && dl
                            .element_ids
                            .get(index)
                            .and_then(Option::as_ref)
                            .is_some_and(|id| id.contains(event_id)) =>
                {
                    Some(*x + config.notehead_rx * config.sp)
                }
                _ => None,
            })
            .unwrap_or_else(|| panic!("notehead for {event_id}"))
    };
    let first_x = event_notehead_x("/gt1");
    let chain_end_x = event_notehead_x("/gt2");
    assert!(
        (slur_x2 - first_x).abs() < (slur_x2 - chain_end_x).abs(),
        "grace slur end x={slur_x2:.3} must stop at first tied head x={first_x:.3}, not chain end x={chain_end_x:.3}"
    );
}

#[test]
fn test_main_note_slur_to_grace_renders() {
    // The reverse direction: a principal note slurred to a following grace note.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "m1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"target": "g1"}]},
                {"type": "grace", "content": [
                    {"id": "g1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"id": "m2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        1,
        "Expected 1 slur bezier from main note to grace note, got {}",
        beziers.len()
    );
}

#[test]
fn test_grace_to_main_slur_across_measures_same_system() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "g1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}], "slurs": [{"target": "m2"}]}
                ]},
                {"id": "m1", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]},
            {"sequences": [{"content": [
                {"id": "m2", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    assert_eq!(
        dl.commands
            .iter()
            .filter(|command| is_draw_bezier(command))
            .count(),
        1,
        "grace-to-main slur should resolve across a barline"
    );
}

#[test]
fn test_main_to_grace_slur_across_measures_same_system() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"id": "m1", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"target": "g2"}]}
            ]}]},
            {"sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "g2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"id": "m2", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    assert_eq!(
        dl.commands
            .iter()
            .filter(|command| is_draw_bezier(command))
            .count(),
        1,
        "main-to-grace slur should resolve across a barline"
    );
}

#[test]
fn test_grace_note_always_stem_up_main_stem_up() {
    // Standard engraving practice: grace notes are always stem-up, even when the
    // main note (C4, below middle line) is stem up.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let event = &ml.voice_layouts[0].events_vec()[0];

    assert!(
        event.stem_up,
        "Main note C4 (below middle) should have stem up"
    );
    assert!(
        !event.grace_notes.is_empty(),
        "Event should have grace notes"
    );
    assert!(
        event.grace_notes[0].stem_up,
        "Grace note should always be stem up"
    );
}

#[test]
fn test_grace_note_always_stem_up_main_stem_down() {
    // Standard engraving practice: grace notes are always stem-up, even when the
    // main note (A5, above middle line) is stem down.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let event = &ml.voice_layouts[0].events_vec()[0];

    assert!(
        !event.stem_up,
        "Main note A5 (above middle) should have stem down"
    );
    assert!(
        !event.grace_notes.is_empty(),
        "Event should have grace notes"
    );
    assert!(
        event.grace_notes[0].stem_up,
        "Grace note should always be stem up"
    );
}

#[test]
fn test_grace_note_always_stem_up_in_multivoice() {
    // Grace notes are always stem-up, including in multi-voice contexts.
    // Voice 0 → stem up, voice 1 → stem down; the grace stays up regardless.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"type": "grace", "content": [
                        {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                    ]},
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]},
                {"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let event = &ml.voice_layouts[0].events_vec()[0];

    assert!(event.stem_up, "Voice 0 should have stem up in multi-voice");
    assert!(
        !event.grace_notes.is_empty(),
        "Event should have grace notes"
    );
    assert!(
        event.grace_notes[0].stem_up,
        "Grace note should always be stem up in multi-voice"
    );
}

#[test]
fn test_grace_beamed_stems_connect_to_beam() {
    // Verify that beamed grace note stems extend to the beam line,
    // not a fixed stem length.
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    let beam_thickness = 0.5 * sp * grace_scale;

    // Collect beam polygon Y-ranges (bottom-left Y and top-left Y of each grace beam)
    let grace_beams: Vec<(f64, f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawPolygon { points, .. } = c {
                if points.len() == 4 {
                    let thickness = (points[3].1 - points[0].1).abs();
                    if (thickness - beam_thickness).abs() < 0.15 {
                        // (x_left, y_top_left, x_right, y_top_right) for stem-up beam
                        let y_top = points[0].1.min(points[3].1);
                        let y_bottom = points[0].1.max(points[3].1);
                        return Some((points[0].0, y_top, points[1].0, y_bottom));
                    }
                }
            }
            None
        })
        .collect();
    assert!(!grace_beams.is_empty(), "Expected grace beam polygons");

    // Collect grace notehead X positions (reduced-size glyphs)
    let grace_notehead_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } = c
            {
                if (*size - grace_glyph_size).abs() < 0.01
                    && (*codepoint == smufl::NOTEHEAD_BLACK || *codepoint == smufl::NOTEHEAD_HALF)
                {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert!(
        grace_notehead_xs.len() >= 2,
        "Need at least 2 grace noteheads"
    );

    // Collect all vertical stems (DrawLine with x1 == x2)
    let stems: Vec<(f64, f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = c {
                if (x1 - x2).abs() < 0.01 {
                    return Some((*x1, y1.min(*y2), *x2, y1.max(*y2)));
                }
            }
            None
        })
        .collect();

    // For each grace beam, verify stems at both ends touch the beam Y range
    for (bx_left, by_top, bx_right, by_bottom) in &grace_beams {
        // Find stems near the beam's left and right X
        let tolerance = config.notehead_rx * 2.0 * sp;
        let stems_near_beam: Vec<&(f64, f64, f64, f64)> = stems
            .iter()
            .filter(|(sx, sy_top, _, sy_bottom)| {
                *sx >= bx_left - tolerance
                    && *sx <= bx_right + tolerance
                    && (*sy_top <= by_bottom + 0.5 && *sy_bottom >= by_top - 0.5)
            })
            .collect();
        // At least 2 stems should touch each beam (one at each end)
        assert!(stems_near_beam.len() >= 2,
            "Expected at least 2 stems touching grace beam at x=[{:.1},{:.1}], y=[{:.1},{:.1}], found {}",
            bx_left, bx_right, by_top, by_bottom, stems_near_beam.len());
    }
}

#[test]
fn test_grace_beamed_no_fixed_length_stems() {
    // Beamed grace notes should NOT have stems drawn at the fixed stem length.
    // Instead, stems should extend to the beam position.
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    let beam_thickness = 0.5 * sp * grace_scale;

    // Count grace beams
    let grace_beam_count = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawPolygon { points, .. }
            if points.len() == 4
            && ((points[3].1 - points[0].1).abs() - beam_thickness).abs() < 0.15)
        })
        .count();
    assert!(
        grace_beam_count >= 3,
        "Expected >= 3 grace beams, got {}",
        grace_beam_count
    );

    // Count grace noteheads
    let _grace_noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } = c
            {
                if (*size - grace_glyph_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK {
                    return Some(*x);
                }
            }
            None
        })
        .collect();

    // Verify beam thickness is consistently scaled at 0.65x
    let expected_beam_thickness = 0.5 * sp * grace_scale;
    for cmd in &dl.commands {
        if let RenderCommand::DrawPolygon { points, .. } = cmd {
            if points.len() == 4 {
                let thickness = (points[3].1 - points[0].1).abs();
                if (thickness - expected_beam_thickness).abs() < 0.15 {
                    // This is a grace beam — verify thickness
                    assert!(
                        (thickness - expected_beam_thickness).abs() < 0.15,
                        "Grace beam thickness {:.3} should be ~{:.3}",
                        thickness,
                        expected_beam_thickness
                    );
                }
            }
        }
    }
}

#[test]
fn test_grace_notes_tagged_with_element_ids() {
    // Grace notes should be tagged with element IDs for hit-testing / selection.
    // Format: p{part}/m{measure}/s{voice}/grace/{id}
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "gr1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find all element IDs containing "grace"
    let grace_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/grace/"))
        .collect();
    assert!(
        !grace_ids.is_empty(),
        "Expected grace note element IDs, got none"
    );

    // Should follow the format p0/m0/s0/grace/gr1
    assert!(
        grace_ids.iter().any(|id| id.contains("grace/gr1")),
        "Expected grace ID containing 'grace/gr1', got: {:?}",
        grace_ids
    );
}

#[test]
fn test_grace_notes_tagged_fallback_index() {
    // When grace notes have no explicit ID, fallback to g{index}
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/grace/"))
        .collect();
    assert!(
        !grace_ids.is_empty(),
        "Expected grace note element IDs with fallback index"
    );

    // With no explicit id, should use e0
    assert!(
        grace_ids.iter().any(|id| id.contains("grace/e0")),
        "Expected fallback grace ID 'grace/e0', got: {:?}",
        grace_ids
    );
}

#[test]
fn test_grace_notes_tagged_separate_from_main_event() {
    // Grace note commands should have different element IDs from the main event
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "gr1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}
                ]},
                {"id": "ev1", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/grace/"))
        .collect();
    let main_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/ev1") && !eid.contains("/grace/"))
        .collect();

    assert!(!grace_ids.is_empty(), "Expected grace element IDs");
    assert!(!main_ids.is_empty(), "Expected main event element IDs");

    // Grace and main IDs should be distinct
    for gid in &grace_ids {
        assert!(
            !main_ids.contains(gid),
            "Grace ID {} should differ from main event IDs",
            gid
        );
    }
}

#[test]
fn test_grace_notes_beamed_tagged() {
    // Beamed grace notes should all be tagged
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/grace/"))
        .collect();
    // grace-notes-beamed.mnx has 3 grace groups with 2+3+4 = 9 grace events
    // Each grace note should produce at least one tagged command
    assert!(
        grace_ids.len() >= 9,
        "Expected at least 9 tagged grace note commands (one per grace note), got {}",
        grace_ids.len()
    );
}

// ═══════════════════════════════════════════
// Grace note spacing integration tests
// ═══════════════════════════════════════════

#[test]
fn test_grace_notes_do_not_overflow_measure_width() {
    // Grace notes at the start of a measure should be accounted for in the
    // measure's natural width. No event should extend past measure_x + measure_width.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]}
                ]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    // Use natural width (no forced width)
    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let measure_end = ml.x + ml.width;

    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            assert!(
                el.x < measure_end,
                "Event at x={:.1} exceeds measure end {:.1}",
                el.x,
                measure_end
            );
            for gn in &el.grace_notes {
                assert!(
                    gn.x >= ml.x,
                    "Grace note at x={:.1} is before measure start {:.1}",
                    gn.x,
                    ml.x
                );
            }
        }
    }
}

#[test]
fn test_grace_spacing_preserves_cross_staff_alignment() {
    // Two staves: one with grace notes, one without.
    // Both should share the same beat→x mapping so events at the same beat align.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"name": "Staff1", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"type": "grace", "content": [
                        {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                    ]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]}]
            }],
            "staves": 1},
            {"name": "Staff2", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}
                ]}]
            }],
            "staves": 1}
        ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_full_score(&score, &config);
    let main_glyph_size = 4.0 * config.sp;
    let mut all_noteheads: Vec<(f64, f64)> = Vec::new(); // (x, y)
    for cmd in &dl.commands {
        if let RenderCommand::DrawGlyph {
            x,
            y,
            size,
            codepoint,
            ..
        } = cmd
        {
            if (*size - main_glyph_size).abs() < 0.01
                && (*codepoint == smufl::NOTEHEAD_BLACK
                    || *codepoint == smufl::NOTEHEAD_HALF
                    || *codepoint == smufl::NOTEHEAD_WHOLE)
            {
                all_noteheads.push((*x, *y));
            }
        }
    }

    assert!(
        all_noteheads.len() >= 6,
        "Expected at least 6 noteheads (3 per staff), got {}",
        all_noteheads.len()
    );

    // Split into two groups by Y: staff 1 (lower Y) and staff 2 (higher Y)
    all_noteheads.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    let mid_y = (all_noteheads.first().unwrap().1 + all_noteheads.last().unwrap().1) / 2.0;
    let staff1_xs: Vec<f64> = all_noteheads
        .iter()
        .filter(|(_, y)| *y < mid_y)
        .map(|(x, _)| *x)
        .collect();
    let staff2_xs: Vec<f64> = all_noteheads
        .iter()
        .filter(|(_, y)| *y > mid_y)
        .map(|(x, _)| *x)
        .collect();

    assert!(
        staff1_xs.len() >= 3,
        "Staff 1 should have >= 3 noteheads, got {}",
        staff1_xs.len()
    );
    assert!(
        staff2_xs.len() >= 3,
        "Staff 2 should have >= 3 noteheads, got {}",
        staff2_xs.len()
    );

    // Sort by x within each staff
    let mut s1 = staff1_xs.clone();
    s1.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut s2 = staff2_xs.clone();
    s2.sort_by(|a, b| a.partial_cmp(b).unwrap());

    // The beat-1 event (second notehead) and beat-2 event (third notehead) should
    // align vertically between staves within a small tolerance.
    // Staff 1's beat-1 note is the 2nd note (index 1), staff 2's is also index 1.
    let tolerance = 3.0; // pixels — tolerance for stem/layout differences
    let s1_beat1 = s1[1];
    let s2_beat1 = s2[1];
    assert!(
        (s1_beat1 - s2_beat1).abs() < tolerance,
        "Beat 1 notes should align: staff1 x={:.1}, staff2 x={:.1}, diff={:.1}",
        s1_beat1,
        s2_beat1,
        (s1_beat1 - s2_beat1).abs()
    );

    let s1_beat2 = s1[2];
    let s2_beat2 = s2[2];
    assert!(
        (s1_beat2 - s2_beat2).abs() < tolerance,
        "Beat 2 notes should align: staff1 x={:.1}, staff2 x={:.1}, diff={:.1}",
        s1_beat2,
        s2_beat2,
        (s1_beat2 - s2_beat2).abs()
    );
}

#[test]
fn test_grace_notes_left_of_main_event_after_spacing() {
    // After the spacing-map-based layout, grace notes should still be positioned
    // to the left of their main event.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);

    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            for gn in &el.grace_notes {
                assert!(
                    gn.x < el.x,
                    "Grace note at x={:.1} should be left of main event at x={:.1}",
                    gn.x,
                    el.x
                );
            }
        }
    }
}

#[test]
fn test_grace_spacing_with_forced_width_no_overflow() {
    // When a forced width is applied (system justification), grace notes should
    // still fit within the measure — the proportional scaling should handle it.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    // Use a forced width slightly larger than natural
    let natural = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let forced_w = natural.width * 1.2;
    let ml = layout_measure(
        &resolved[0],
        sp,
        0.0,
        &config,
        Some(forced_w),
        &[],
        common_shortest,
    );
    let measure_end = ml.x + ml.width;

    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            assert!(
                el.x < measure_end,
                "Event at x={:.1} exceeds forced measure end {:.1}",
                el.x,
                measure_end
            );
        }
    }
}

#[test]
fn test_measure_start_grace_does_not_cross_barline_under_compression() {
    // A grace note on the FIRST beat of a measure reserves a fixed pixel band to
    // the left of its main event. That reservation must be RIGID: under heavy
    // horizontal compression the elastic duration springs collapse, and if the
    // grace reservation compressed with them the fixed-width grace glyphs would
    // overflow left of the measure content — visually spilling over the
    // preceding barline. The grace notehead must stay at or right of the
    // measure's content start (left barline + prefix).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "G", "octave": 2}}]},
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "A", "octave": 2}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 2}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    // Compress hard: half the natural width.
    let natural = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let forced_w = natural.width * 0.5;
    let ml = layout_measure(
        &resolved[0],
        sp,
        0.0,
        &config,
        Some(forced_w),
        &[],
        common_shortest,
    );

    let content_start = ml.x + ml.prefix_width;
    let mut found_grace = false;
    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            for gn in &el.grace_notes {
                found_grace = true;
                assert!(
                    gn.x >= content_start - 0.01,
                    "Measure-start grace at x={:.1} crossed the content start {:.1} (over the barline)",
                    gn.x,
                    content_start
                );
            }
        }
    }
    assert!(found_grace, "Expected at least one grace note");
}

#[test]
fn test_grace_notes_clear_main_event_accidental() {
    // A grace note in front of a main note that carries an accidental must be
    // placed left of that accidental's column, not overlapping it. The main
    // note here is a flat (not in C major), forcing a flat glyph to the left of
    // its notehead.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5, "alter": -1}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);
    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);

    let el = &ml.voice_layouts[0].events_vec()[0];
    assert_eq!(el.grace_notes.len(), 1, "Expected one grace note");
    let grace_scale = 0.65;
    let grace_nw = config.notehead_rx * 2.0 * grace_scale * sp;
    let grace_right_edge = el.grace_notes[0].x + grace_nw;

    // The accidental column extends left of the notehead (el.x). The grace
    // note's right edge must stay left of the accidental's left edge.
    let acc_extent = el
        .event
        .notes
        .as_ref()
        .map(|notes| {
            crate::layout::spacing::event_accidental_extent_sp(
                notes,
                &resolved[0].active_key,
                &mut std::collections::HashMap::new(),
                None,
                0.0,
                None,
            ) * sp
        })
        .unwrap_or(0.0);
    assert!(
        acc_extent > 0.0,
        "Expected the flat to produce an accidental column"
    );
    let acc_left_edge = el.x - 0.12 * sp - acc_extent;
    assert!(
        grace_right_edge <= acc_left_edge + 0.01 * sp,
        "Grace right edge ({:.2}) should clear accidental left edge ({:.2})",
        grace_right_edge,
        acc_left_edge
    );
}

#[test]
fn test_grace_before_tuplet_reserves_space_no_barline_overflow() {
    // Regression: a grace note immediately before a TUPLET (e.g. an acciaccatura
    // before a triplet) must reserve horizontal space just like a grace before a
    // bare event. The grace attaches to the tuplet's first inner note; if the
    // spacing collector drops the pending grace count at the tuplet boundary,
    // the tuplet's first note isn't pushed right and the grace spills left over
    // the barline. Here the grace sits at the very start of the measure, so its
    // notehead must stay at/right of the measure content start. This mirrors the
    // Rhapsody-in-Blue measure before rehearsal 15 (grace before a triplet).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 1}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "A", "octave": 2}}]},
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "B", "octave": 2}}]}
                ]},
                {"type": "tuplet", "outer": {"duration": {"base": "quarter"}, "multiple": 1}, "inner": {"duration": {"base": "eighth"}, "multiple": 3}, "content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);
    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);

    let content_start = ml.x + ml.prefix_width;
    let mut found = false;
    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            for gn in &el.grace_notes {
                found = true;
                assert!(
                    gn.x >= content_start - 0.01,
                    "Grace before triplet at x={:.1} crossed the content start {:.1} (over the barline)",
                    gn.x,
                    content_start
                );
            }
        }
    }
    assert!(found, "Expected the grace note to be laid out");
}

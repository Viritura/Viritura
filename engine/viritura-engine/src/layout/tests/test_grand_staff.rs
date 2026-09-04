// Auto-generated from tests.rs — test_grand_staff
// 14 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_with_mnx_scores;
use crate::layout::resolve::*;
use crate::layout::staff_brace::is_brace_glyph;
use crate::layout::{layout_full_score, layout_score};
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

// ═══════════════════════════════════════
// Grand Staff (Piano) Tests
// ═══════════════════════════════════════
#[test]
fn test_grand_staff_parse_staves_field() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/grand-staff.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();

    assert_eq!(score.parts.len(), 1);
    assert_eq!(score.parts[0].staves, 2);
    assert_eq!(score.parts[0].name, "Piano");
}

#[test]
fn test_grand_staff_sequence_staff_field() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/grand-staff.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();

    // First measure: 2 sequences, staff 1 and staff 2
    let m0 = &score.parts[0].measures[0];
    assert_eq!(m0.sequences.len(), 2);
    assert_eq!(m0.sequences[0].staff, Some(1));
    assert_eq!(m0.sequences[1].staff, Some(2));
}

#[test]
fn test_grand_staff_clef_staff_field() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/grand-staff.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();

    // First measure has clefs for both staves
    let clefs = score.parts[0].measures[0].clefs.as_ref().unwrap();
    assert_eq!(clefs.len(), 2);
    assert_eq!(clefs[0].staff, Some(1));
    assert_eq!(clefs[1].staff, Some(2));
}

#[test]
fn test_grand_staff_split_by_staff() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/grand-staff.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();

    let pm = &score.parts[0].measures[0];

    // Split staff 1
    let s1 = split_part_measure_by_staff(pm, 1);
    assert_eq!(s1.sequences.len(), 1, "Staff 1 should have 1 sequence");
    assert_eq!(
        s1.clefs.as_ref().unwrap().len(),
        1,
        "Staff 1 should have 1 clef"
    );

    // Split staff 2
    let s2 = split_part_measure_by_staff(pm, 2);
    assert_eq!(s2.sequences.len(), 1, "Staff 2 should have 1 sequence");
    assert_eq!(
        s2.clefs.as_ref().unwrap().len(),
        1,
        "Staff 2 should have 1 clef"
    );
}

#[test]
fn test_grand_staff_layout_produces_two_staves() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/grand-staff.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should produce output
    assert!(
        dl.commands.len() > 10,
        "Expected many render commands, got {}",
        dl.commands.len()
    );
    assert!(dl.width > 0.0);
    assert!(dl.height > 0.0);

    // Should have staff lines for two staves (10 lines per system)
    let staff_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawLine { y1, y2, .. } if (y1 - y2).abs() < 0.001))
        .collect();
    // At least 10 staff lines (5 per staff, 2 staves)
    assert!(
        staff_lines.len() >= 10,
        "Expected >= 10 staff lines for grand staff, got {}",
        staff_lines.len()
    );
}

#[test]
fn test_grand_staff_onset_columns_align_across_staves() {
    // Both staves carry the SAME rhythm (four quarter notes). With shared merged
    // spacing, every onset's notehead must land at the SAME x on both staves —
    // a fundamental engraving rule (notes that sound together align vertically).
    //
    // Regression guard: a per-voice "stem direction optical correction" used to
    // shift post-stem-flip notes by 0.2sp independently per staff. Staff 1
    // (treble) flips stems mid-run (G4/A4 up, B4/C5 down) while staff 2 (bass,
    // all stem-down) does not, so the two staves' columns desynced by 0.2sp.
    // The correction was removed; this test ensures the columns stay aligned.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"staves": 2, "measures": [{
            "clefs": [
                {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
            ],
            "sequences": [
                {"staff": 1, "content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]},
                {"staff": 2, "content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 3, "alter": -1}, "accidentalDisplay": {"show": true}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 3}}]}
                ]}
            ]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect notehead x positions, partitioned into the two staves by y.
    // Staff 1 (treble) sits above staff 2 (bass), so split at the midpoint y.
    let nh: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if (0xE0A0..=0xE0A4).contains(codepoint) => Some((*x, *y)),
            _ => None,
        })
        .collect();
    assert_eq!(nh.len(), 8, "expected 8 noteheads (4 per staff)");
    let y_mid = nh.iter().map(|(_, y)| *y).sum::<f64>() / nh.len() as f64;
    let mut top: Vec<f64> = nh
        .iter()
        .filter(|(_, y)| *y < y_mid)
        .map(|(x, _)| *x)
        .collect();
    let mut bottom: Vec<f64> = nh
        .iter()
        .filter(|(_, y)| *y >= y_mid)
        .map(|(x, _)| *x)
        .collect();
    top.sort_by(f64::total_cmp);
    bottom.sort_by(f64::total_cmp);
    assert_eq!(top.len(), 4, "staff 1 should have 4 noteheads");
    assert_eq!(bottom.len(), 4, "staff 2 should have 4 noteheads");

    for (i, (t, b)) in top.iter().zip(bottom.iter()).enumerate() {
        assert!(
            (t - b).abs() < 0.001,
            "onset {i} columns must align across staves: staff1 x={t:.3}, staff2 x={b:.3}"
        );
    }
}

#[test]
fn test_grand_staff_has_brace() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/grand-staff.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have a brace glyph (one of the SMuFL brace cuts)
    let braces: Vec<_> = dl.commands.iter().filter(|c| {
        matches!(c, RenderCommand::DrawStretchedGlyph { codepoint, .. } if is_brace_glyph(*codepoint))
    }).collect();
    assert_eq!(
        braces.len(),
        1,
        "Expected 1 brace glyph, got {}",
        braces.len()
    );
}

#[test]
fn test_grand_staff_inherited_clefs_not_redrawn_each_bar() {
    // Clefs are defined only in measure 1. Subsequent measures should inherit
    // clef context for pitch mapping but should not render duplicate clef glyphs.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {},
            {}
        ]},
        "parts": [{
            "name": "Piano",
            "staves": 2,
            "measures": [
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
                    ]
                },
                {
                    "sequences": [
                        {"staff": 1, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]}]}
                    ]
                },
                {
                    "sequences": [
                        {"staff": 1, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]}]}
                    ]
                }
            ]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Initial clefs only: one full-size treble and one full-size bass.
    let g_clefs: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { codepoint, size, .. }
            if *codepoint == smufl::G_CLEF && (*size - 4.0 * config.sp).abs() < 0.01)
        })
        .collect();
    let f_clefs: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { codepoint, size, .. }
            if *codepoint == smufl::F_CLEF && (*size - 4.0 * config.sp).abs() < 0.01)
        })
        .collect();
    assert_eq!(
        g_clefs.len(),
        1,
        "expected exactly 1 initial G clef, found {}",
        g_clefs.len()
    );
    assert_eq!(
        f_clefs.len(),
        1,
        "expected exactly 1 initial F clef, found {}",
        f_clefs.len()
    );

    // No change-clef glyphs should appear since no explicit clef changes were declared.
    // Change clefs are regular clef glyphs rendered at 2/3 size.
    let change_size = 4.0 * config.sp * 2.0 / 3.0;
    let change_clefs: Vec<_> = dl.commands.iter().filter(|c| {
        matches!(c, RenderCommand::DrawGlyph { codepoint, size, .. }
            if (*codepoint == smufl::G_CLEF || *codepoint == smufl::F_CLEF || *codepoint == smufl::C_CLEF)
            && (*size - change_size).abs() < 0.01)
    }).collect();
    assert_eq!(
        change_clefs.len(),
        0,
        "expected 0 change-clef glyphs without explicit changes, found {}",
        change_clefs.len()
    );
}

#[test]
fn test_grand_staff_mid_measure_clef_change_only_affects_target_staff() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {}
        ]},
        "parts": [{
            "name": "Piano",
            "staves": 2,
            "measures": [
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
                    ]
                },
                {
                    "clefs": [
                        {
                            "clef": {"sign": "F", "staffPosition": 2},
                            "staff": 1,
                            "position": {"fraction": [1, 2]}
                        }
                    ],
                    "sequences": [
                        {"staff": 1, "content": [
                            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                        ]},
                        {"staff": 2, "content": [
                            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                        ]}
                    ]
                }
            ]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();

    let staff1 = resolve_measures_for_staff(&score, 0, 1);
    let s1_m1_clefs = staff1[1].part.clefs.as_ref().expect("staff 1 clefs");
    assert_eq!(
        s1_m1_clefs.len(),
        2,
        "staff 1 should have inherited start + explicit mid change"
    );
    assert_eq!(
        s1_m1_clefs[0].clef.sign,
        ClefSign::G,
        "staff 1 should inherit treble at measure start"
    );
    assert_eq!(
        s1_m1_clefs[0].position.as_ref().map(|p| p.fraction),
        Some((0, 1))
    );
    assert_eq!(
        s1_m1_clefs[1].clef.sign,
        ClefSign::F,
        "staff 1 explicit mid-measure change should be bass"
    );
    assert_eq!(
        s1_m1_clefs[1].position.as_ref().map(|p| p.fraction),
        Some((1, 2))
    );

    let staff2 = resolve_measures_for_staff(&score, 0, 2);
    let s2_m1_clefs = staff2[1].part.clefs.as_ref().expect("staff 2 clefs");
    assert_eq!(
        s2_m1_clefs.len(),
        1,
        "staff 2 should only carry inherited clef context"
    );
    assert_eq!(
        s2_m1_clefs[0].clef.sign,
        ClefSign::F,
        "staff 2 should inherit bass clef"
    );
    assert_eq!(
        s2_m1_clefs[0].position.as_ref().map(|p| p.fraction),
        Some((0, 1))
    );

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    // Change clefs use regular glyphs at 2/3 size
    let change_size = 4.0 * config.sp * 2.0 / 3.0;
    let change_clefs: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { codepoint, size, .. }
            if (*codepoint == smufl::G_CLEF || *codepoint == smufl::F_CLEF)
            && (*size - change_size).abs() < 0.01)
        })
        .collect();
    assert_eq!(
        change_clefs.len(),
        1,
        "expected exactly one mid-measure change clef on the target staff, found {}",
        change_clefs.len()
    );
}

/// A mid-measure clef change on one staff of a grand staff must open the SAME
/// horizontal gap on the sibling staff, so notes at the same beat stay
/// vertically aligned across the two staves (the bug: only the clef-owning
/// staff shifted, plus its content_width shrank, so the right hand and left
/// hand drifted apart after the clef). Exercises the live auto-flow path.
#[test]
fn test_grand_staff_mid_clef_keeps_cross_staff_alignment() {
    let json = r#"{
        "mnx": {"version": 1},
        "layouts": [{"id":"L1","content":[
            {"type":"staff","sources":[{"part":"P1","staff":1}]},
            {"type":"staff","sources":[{"part":"P1","staff":2}]}
        ]}],
        "scores": [{"name":"S1","layout":"L1"}],
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "id":"P1","name":"Piano","staves":2,
            "measures": [{
                "clefs": [
                    {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                    {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2},
                    {"clef": {"sign": "F", "staffPosition": 2}, "staff": 1, "position": {"fraction": [1, 2]}}
                ],
                "sequences": [
                    {"staff": 1, "content": [
                        {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                        {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                    ]},
                    {"staff": 2, "content": [
                        {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                        {"type":"event","duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                    ]}
                ]
            }]
        }]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Two staff bounds for measure 0 of the grand staff.
    let mut staff_bounds: Vec<_> = dl.measure_bounds.iter().filter(|b| b.index == 0).collect();
    staff_bounds.sort_by_key(|b| b.staff_index);
    assert!(
        staff_bounds.len() >= 2,
        "expected at least 2 staff bounds for the grand staff, got {}",
        staff_bounds.len()
    );

    let beat2_x = |b: &MeasureBounds| {
        b.beat_anchors
            .iter()
            .find(|(beat, _)| (*beat - 2.0).abs() < 0.01)
            .map(|(_, x)| *x)
    };
    let x_top = beat2_x(staff_bounds[0]).expect("staff 0 beat-2 anchor");
    let x_bot = beat2_x(staff_bounds[1]).expect("staff 1 beat-2 anchor");
    assert!(
        (x_top - x_bot).abs() < 0.5,
        "beat-2 note X must stay aligned across staves after the mid-measure clef: top={:.2} bot={:.2}",
        x_top,
        x_bot
    );

    // Beat 0 (before the clef) must also remain aligned.
    let beat0_x = |b: &MeasureBounds| {
        b.beat_anchors
            .iter()
            .find(|(beat, _)| *beat < 0.01)
            .map(|(_, x)| *x)
    };
    let x0_top = beat0_x(staff_bounds[0]).expect("staff 0 beat-0 anchor");
    let x0_bot = beat0_x(staff_bounds[1]).expect("staff 1 beat-0 anchor");
    assert!(
        (x0_top - x0_bot).abs() < 0.5,
        "beat-0 note X must align across staves: top={:.2} bot={:.2}",
        x0_top,
        x0_bot
    );
}

#[test]
fn test_grand_staff_staves_default_to_one() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    // Default staves should be 1
    assert_eq!(score.parts[0].staves, 1);
}

#[test]
fn test_grand_staff_connected_barlines() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/grand-staff.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have vertical barlines connecting the two staves
    // (lines where x1 == x2 and they span the inter-staff gap)
    let sp = config.sp;
    let staff_height = 4.0 * sp;
    let vertical_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = c {
                (x1 - x2).abs() < 0.001 && (y2 - y1).abs() > staff_height + 1.0
            } else {
                false
            }
        })
        .collect();
    assert!(
        !vertical_lines.is_empty(),
        "Expected connecting barlines between staves"
    );
}

/// A mid-system start-of-measure clef change shifts that measure's start
/// barline right by the leading clef gap (the change clef is engraved before
/// the barline). The inter-staff barline CONNECTOR must shift by the SAME gap,
/// or the barline visually splits: per-staff segments sit at `x + gap` while
/// the connector between staves stays at `x`. Regression for that split.
#[test]
fn test_grand_staff_mid_system_clef_change_barline_connector_aligned() {
    // Two measures on one system. Measure 1 opens with a clef change on the
    // bottom staff (position omitted = start-of-measure change).
    let json = r#"{
        "mnx": {"version": 1},
        "layouts": [{"id":"L1","content":[
            {"type":"staff","sources":[{"part":"P1","staff":1}]},
            {"type":"staff","sources":[{"part":"P1","staff":2}]}
        ]}],
        "scores": [{"name":"S1","layout":"L1"}],
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {}
        ]},
        "parts": [{
            "id":"P1","name":"Piano","staves":2,
            "measures": [
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
                    ]
                },
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}
                    ]
                }
            ]
        }]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(1200.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let sp = config.sp;
    let staff_height = 4.0 * sp;

    // Per-staff start barline x for measure 1 (tagged `m1/barline`). These are
    // the vertical segments drawn ON each staff; all should share one x.
    let want_tag = "m1/barline";
    let staff_barline_x: Vec<f64> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(i, cmd)| {
            let tagged = dl.element_ids.get(i).and_then(|o| o.as_deref()) == Some(want_tag);
            match cmd {
                RenderCommand::DrawLine { x1, x2, y1, y2, .. }
                    if tagged && (x1 - x2).abs() < 0.5 && (y2 - y1).abs() > 1.0 =>
                {
                    Some(*x1)
                }
                _ => None,
            }
        })
        .collect();
    assert!(
        !staff_barline_x.is_empty(),
        "expected per-staff m1 barline segments"
    );
    let barline_x = staff_barline_x[0];
    for x in &staff_barline_x {
        assert!(
            (x - barline_x).abs() < 0.5,
            "per-staff m1 barlines disagree: {x:.2} vs {barline_x:.2}"
        );
    }

    // Inter-staff gap region between staff 0 (top) and staff 1 (bottom) for
    // measure 1, taken from the exported measure bounds.
    let mut m1_bounds: Vec<_> = dl.measure_bounds.iter().filter(|b| b.index == 1).collect();
    m1_bounds.sort_by_key(|b| b.staff_index);
    assert!(m1_bounds.len() >= 2, "expected 2 staves for measure 1");
    let gap_top = m1_bounds[0].y + staff_height;
    let gap_bottom = m1_bounds[1].y;

    // The connector is a vertical line sitting inside the inter-staff gap.
    // Find the one nearest measure 1's barline x.
    let connector_x = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { x1, x2, y1, y2, .. }
                if (x1 - x2).abs() < 0.5
                    && y1.min(*y2) >= gap_top - 0.5
                    && y1.max(*y2) <= gap_bottom + 0.5
                    && (y2 - y1).abs() > 0.5 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .min_by(|a, b| (a - barline_x).abs().total_cmp(&(b - barline_x).abs()))
        .expect("expected an inter-staff connector in the gap");

    assert!(
        (connector_x - barline_x).abs() < 0.5,
        "inter-staff connector must align with the per-staff barline at a \
         mid-system clef change: connector={connector_x:.2} barline={barline_x:.2}"
    );
}

/// The barline's SELECTION bbox must track the leading-clef-gap shift. A start-
/// of-measure clef change engraves the change clef before the barline, shifting
/// the drawn barline right by the leading gap — the click hitbox (`m1/barline`
/// element bbox) must move with it, or selecting the barline lands at the un-
/// shifted `ml.x` while the glyph is drawn further right. Regression for the
/// misaligned barline hitbox the user reported at Rhapsody rehearsal 3.
#[test]
fn test_grand_staff_clef_change_barline_bbox_tracks_shift() {
    // Same 2-measure grand staff with a clef change opening measure 1.
    let json = r#"{
        "mnx": {"version": 1},
        "layouts": [{"id":"L1","content":[
            {"type":"staff","sources":[{"part":"P1","staff":1}]},
            {"type":"staff","sources":[{"part":"P1","staff":2}]}
        ]}],
        "scores": [{"name":"S1","layout":"L1"}],
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {}
        ]},
        "parts": [{
            "id":"P1","name":"Piano","staves":2,
            "measures": [
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
                    ]
                },
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}
                    ]
                }
            ]
        }]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(1200.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Rendered per-staff barline glyph x for measure 1.
    let barline_glyph_x = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(i, cmd)| {
            let tagged = dl.element_ids.get(i).and_then(|o| o.as_deref()) == Some("m1/barline");
            match cmd {
                RenderCommand::DrawLine { x1, x2, y1, y2, .. }
                    if tagged && (x1 - x2).abs() < 0.5 && (y2 - y1).abs() > 1.0 =>
                {
                    Some(*x1)
                }
                _ => None,
            }
        })
        .next()
        .expect("expected an m1 barline glyph");

    // Measure bounds now start at the visible barline, not at the pre-clef
    // nominal origin used internally by layout.
    let m1_left = dl
        .measure_bounds
        .iter()
        .find(|b| b.index == 1)
        .map(|b| b.x)
        .expect("m1 bounds");
    assert!(
        (barline_glyph_x - m1_left).abs() < 0.5,
        "clef-change measure bounds should start at the visible barline: \
         barline={barline_glyph_x:.2} m1_left={m1_left:.2}"
    );

    // Every m1/barline selection bbox center must match the drawn barline x.
    let centers: Vec<f64> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id == "m1/barline")
        .map(|eb| eb.bbox.x + eb.bbox.width * 0.5)
        .collect();
    assert!(
        !centers.is_empty(),
        "expected at least one m1/barline selection bbox"
    );
    for c in &centers {
        assert!(
            (c - barline_glyph_x).abs() < 0.5,
            "barline hitbox center must track the shifted barline: \
             bbox_center={c:.2} barline_glyph={barline_glyph_x:.2}"
        );
    }
}

#[test]
fn test_grand_staff_chunk_seam_clef_change_barline_connector_aligned() {
    // Regression: at a stitched-horizon chunk SEAM that coincides with a
    // start-of-measure clef change, the per-staff barline (drawn by the next
    // chunk's first measure, shifted right by the leading clef gap) must stay
    // aligned with the inter-staff connector. Previously the connector was
    // drawn by the PREVIOUS chunk's unshifted end-connector, so it split away
    // from the barline — the visible "staggered barline" the user reported.
    //
    // A tiny `horizon_chunk_width` forces one measure per chunk, so measure 1
    // (which opens with a bottom-staff clef change) is the first measure of the
    // second chunk = a seam continuation.
    let json = r#"{
        "mnx": {"version": 1},
        "layouts": [{"id":"L1","content":[
            {"type":"staff","sources":[{"part":"P1","staff":1}]},
            {"type":"staff","sources":[{"part":"P1","staff":2}]}
        ]}],
        "scores": [{"name":"S1","layout":"L1"}],
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {}
        ]},
        "parts": [{
            "id":"P1","name":"Piano","staves":2,
            "measures": [
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
                    ]
                },
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"type":"event","duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}
                    ]
                }
            ]
        }]
    }"#;
    let score = parse_mnx(json).unwrap();
    // Horizon (no page_width) + a tiny chunk width → one measure per chunk, so
    // measure 1 starts a fresh chunk (seam continuation).
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(1.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let sp = config.sp;
    let staff_height = 4.0 * sp;

    // Per-staff start barline x for measure 1 (tagged `m1/barline`).
    let want_tag = "m1/barline";
    let staff_barline_x: Vec<f64> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(i, cmd)| {
            let tagged = dl.element_ids.get(i).and_then(|o| o.as_deref()) == Some(want_tag);
            match cmd {
                RenderCommand::DrawLine { x1, x2, y1, y2, .. }
                    if tagged && (x1 - x2).abs() < 0.5 && (y2 - y1).abs() > 1.0 =>
                {
                    Some(*x1)
                }
                _ => None,
            }
        })
        .collect();
    assert!(
        !staff_barline_x.is_empty(),
        "expected per-staff m1 barline segments at the seam"
    );
    let barline_x = staff_barline_x[0];

    // The exported measure edge follows the shifted visible barline.
    let m1_left = dl
        .measure_bounds
        .iter()
        .find(|b| b.index == 1)
        .map(|b| b.x)
        .expect("m1 bounds");
    assert!(
        (barline_x - m1_left).abs() < 0.5,
        "clef-change measure bounds should follow the visible barline: \
         barline={barline_x:.2} m1_left={m1_left:.2}"
    );

    // Inter-staff gap region between the two staves of measure 1.
    let mut m1_bounds: Vec<_> = dl.measure_bounds.iter().filter(|b| b.index == 1).collect();
    m1_bounds.sort_by_key(|b| b.staff_index);
    assert!(m1_bounds.len() >= 2, "expected 2 staves for measure 1");
    let gap_top = m1_bounds[0].y + staff_height;
    let gap_bottom = m1_bounds[1].y;

    // The connector sitting in the inter-staff gap nearest the barline.
    let connector_x = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { x1, x2, y1, y2, .. }
                if (x1 - x2).abs() < 0.5
                    && y1.min(*y2) >= gap_top - 0.5
                    && y1.max(*y2) <= gap_bottom + 0.5
                    && (y2 - y1).abs() > 0.5 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .min_by(|a, b| (a - barline_x).abs().total_cmp(&(b - barline_x).abs()))
        .expect("expected an inter-staff connector in the gap");

    assert!(
        (connector_x - barline_x).abs() < 0.5,
        "at a chunk seam, the inter-staff connector must align with the \
         per-staff barline of a clef-change measure: connector={connector_x:.2} \
         barline={barline_x:.2}"
    );
}

#[test]
fn test_grand_staff_in_full_score() {
    // A score with a piano (2 staves) + violin (1 staff)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"number": 10, "time": {"count": 4, "unit": 4}}]},
        "parts": [
            {
                "name": "Piano",
                "staves": 2,
                "measures": [{
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                        {"staff": 2, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
                    ]
                }]
            },
            {
                "name": "Violin",
                "measures": [{
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}]}],
                    "dynamics": [{"id": "violin-p", "type": "immediate", "value": "p",
                        "position": {"fraction": [0, 1]}}]
                }]
            }
        ]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_full_score(&score, &config);

    assert!(dl.commands.len() > 10);

    // Should have 3 sets of staff lines (Piano top + Piano bottom + Violin)
    let staff_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawLine { y1, y2, .. } if (y1 - y2).abs() < 0.001))
        .collect();
    assert!(
        staff_lines.len() >= 15,
        "Expected >= 15 staff lines (3 staves × 5 lines), got {}",
        staff_lines.len()
    );

    // Should have a brace glyph for the piano
    let braces: Vec<_> = dl.commands.iter().filter(|c| {
        matches!(c, RenderCommand::DrawStretchedGlyph { codepoint, .. } if is_brace_glyph(*codepoint))
    }).collect();
    assert_eq!(braces.len(), 1, "Expected 1 brace for Piano");
    let violin_staff_y = dl
        .measure_bounds
        .iter()
        .find(|bounds| bounds.part_index == 1)
        .map(|bounds| bounds.y)
        .expect("violin staff bounds");
    let violin_dynamic_y = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let is_violin_dynamic = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/dynviolin-p"));
            match command {
                RenderCommand::DrawGlyph { y, .. } if is_violin_dynamic => Some(*y),
                _ => None,
            }
        })
        .expect("violin dynamic");
    assert!(
        violin_dynamic_y > violin_staff_y + 4.0 * config.sp,
        "a single-staff part in a full score must keep its dynamic below its own staff"
    );
    let system_bar_numbers = dl
        .commands
        .iter()
        .filter(|command| matches!(command, RenderCommand::DrawText { text, .. } if text == "10"))
        .count();
    assert_eq!(
        system_bar_numbers, 1,
        "ordinary system bar numbers must render once across the full score"
    );
}

#[test]
fn test_organ_layout_clefs_all_staves() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/organ-layout.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();

    let pm = &score.parts[0].measures[0];

    // Staff 1: G clef
    let s1 = split_part_measure_by_staff(pm, 1);
    let s1_clefs = s1.clefs.as_ref().unwrap();
    assert!(!s1_clefs.is_empty(), "Staff 1 should have a clef");
    assert_eq!(s1_clefs[0].clef.sign, ClefSign::G);

    // Staff 2: F clef
    let s2 = split_part_measure_by_staff(pm, 2);
    let s2_clefs = s2.clefs.as_ref().unwrap();
    assert!(!s2_clefs.is_empty(), "Staff 2 should have a clef");
    assert_eq!(
        s2_clefs[0].clef.sign,
        ClefSign::F,
        "Staff 2 should have bass (F) clef"
    );

    // Staff 3: F clef
    let s3 = split_part_measure_by_staff(pm, 3);
    let s3_clefs = s3.clefs.as_ref().unwrap();
    assert!(!s3_clefs.is_empty(), "Staff 3 should have a clef");
    assert_eq!(
        s3_clefs[0].clef.sign,
        ClefSign::F,
        "Staff 3 should have bass (F) clef"
    );
}

#[test]
fn test_grand_staff_brace_spans_from_top_to_bottom() {
    // The brace glyph should be vertically aligned so it spans from the
    // top of staff 1 to the bottom of staff 2.
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/grand-staff.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Find the brace glyph
    let brace = dl
        .commands
        .iter()
        .find_map(|c| {
            if let RenderCommand::DrawStretchedGlyph {
                y, size, codepoint, ..
            } = c
            {
                if is_brace_glyph(*codepoint) {
                    Some((*y, *size))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .expect("Should have a brace glyph");
    let (brace_y, brace_font_size) = brace;

    // Compute expected system extents from config
    // Inter-staff gap is dynamic: 11sp (dynamics+multivoice), 9sp (either), 7sp (neither)
    // Ref: full_score.rs inter_staff_gap computation
    let has_dynamics = score.parts.iter().any(|p| {
        p.measures
            .iter()
            .any(|m| m.dynamics.as_ref().is_some_and(|d| !d.is_empty()))
    });
    let has_multi_voice = score
        .parts
        .iter()
        .any(|p| p.measures.iter().any(|m| m.sequences.len() > 1));
    let inter_staff_gap = if has_dynamics && has_multi_voice {
        11.0 * sp
    } else if has_dynamics || has_multi_voice {
        9.0 * sp
    } else {
        7.0 * sp
    };
    let staff_height = 4.0 * sp;
    let margin_top = config.margin_top * sp;
    let system_top = margin_top; // first staff top
    let system_bottom = margin_top + staff_height + inter_staff_gap + staff_height;

    // The brace y (baseline) should be at the bottom of the system
    // (since brace glyph origin is at its bottom, bBoxSW.y = 0)
    assert!(
        (brace_y - system_bottom).abs() < 1.0,
        "Brace y ({}) should be at system bottom ({})",
        brace_y,
        system_bottom
    );

    // The brace visual top should be at the top of the first staff.
    // Visual top = brace_y - BRACE_GLYPH_HEIGHT * brace_font_size / 4.0
    let visual_top = brace_y - smufl::BRACE_GLYPH_HEIGHT * brace_font_size / 4.0;
    assert!(
        (visual_top - system_top).abs() < 1.0,
        "Brace visual top ({}) should be at system top ({})",
        visual_top,
        system_top
    );
}

#[test]
fn test_grand_staff_brace_font_size_scaling() {
    // Verify the brace font size is calculated correctly from the glyph height
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/grand-staff.mnx"),
    )
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let brace = dl
        .commands
        .iter()
        .find_map(|c| {
            if let RenderCommand::DrawStretchedGlyph {
                y, size, codepoint, ..
            } = c
            {
                if is_brace_glyph(*codepoint) {
                    Some((*y, *size))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .expect("Should have a brace glyph");
    let (_, brace_font_size) = brace;

    // For 2 staves: height = 2 * 4sp + gap
    // Inter-staff gap is dynamic — match full_score.rs logic
    let has_dynamics = score.parts.iter().any(|p| {
        p.measures
            .iter()
            .any(|m| m.dynamics.as_ref().is_some_and(|d| !d.is_empty()))
    });
    let has_multi_voice = score
        .parts
        .iter()
        .any(|p| p.measures.iter().any(|m| m.sequences.len() > 1));
    let inter_staff_gap = if has_dynamics && has_multi_voice {
        11.0 * sp
    } else if has_dynamics || has_multi_voice {
        9.0 * sp
    } else {
        7.0 * sp
    };
    let staff_height = 4.0 * sp;
    let brace_height = 2.0 * staff_height + inter_staff_gap;
    let expected_font_size = 4.0 * brace_height / smufl::BRACE_GLYPH_HEIGHT;

    assert!(
        (brace_font_size - expected_font_size).abs() < 0.1,
        "Brace font size ({}) should match expected ({})",
        brace_font_size,
        expected_font_size
    );
}

#[test]
fn test_grand_staff_brace_does_not_overlap_staves() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/grand-staff.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        page_margin_left: 0.0,
        page_margin_right: 0.0,
        ..LayoutConfig::default()
    };

    // layout_score for a grand staff part (staves >= 2) calls layout_grand_staff_score
    let dl = layout_score(&score, 0, &config);

    // Find the brace command
    let brace_cmd = dl.commands.iter().find(
        |c| matches!(c, RenderCommand::DrawStretchedGlyph { codepoint, .. } if is_brace_glyph(*codepoint)),
    );
    assert!(brace_cmd.is_some(), "Should have a brace glyph");

    if let Some(RenderCommand::DrawStretchedGlyph {
        x: brace_x,
        size: brace_font_size,
        scale_x,
        codepoint,
        ..
    }) = brace_cmd
    {
        let design_width = crate::layout::staff_brace::brace_design_width(*codepoint);
        let glyph_right_edge = brace_x + design_width * brace_font_size / 4.0 * scale_x;
        let sp = config.sp;
        let brace_margin = 2.0 * sp;
        // page_margin_left replaces config.margin_left in page mode
        let page_margin_l = if config.page_width.is_some() {
            config.page_margin_left * sp
        } else {
            config.margin_left * sp
        };
        let margin_left = page_margin_l + brace_margin;

        assert!(
            glyph_right_edge < margin_left,
            "Brace right edge ({:.2}) must be left of margin_left ({:.2})",
            glyph_right_edge,
            margin_left
        );
    }
}

#[test]
fn test_grand_staff_mmr_count_and_range_use_shared_vertical_lanes() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "m1", "time": {"count": 4, "unit": 4}},
            {"id": "m2"},
            {"id": "m3"}
        ]},
        "parts": [{"id": "harp", "name": "Harp", "staves": 2, "measures": [
            {"sequences": [
                {"staff": 1, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}},
                {"staff": 2, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
            ]},
            {"sequences": [
                {"staff": 1, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}},
                {"staff": 2, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
            ]},
            {"sequences": [
                {"staff": 1, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}},
                {"staff": 2, "content": [], "fullMeasure": {"visualDuration": {"base": "whole"}}}
            ]}
        ]}],
        "layouts": [{"id": "harp-part", "content": [
            {"type": "group", "symbol": "brace", "content": [
                {"type": "staff", "sources": [{"part": "harp", "staff": 1}]},
                {"type": "staff", "sources": [{"part": "harp", "staff": 2}]}
            ]}
        ]}],
        "scores": [{"name": "Harp", "layout": "harp-part"}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        multimeasure_rests: true,
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let mut staff_ys: Vec<f64> = dl
        .measure_bounds
        .iter()
        .filter(|bounds| bounds.index == 0)
        .map(|bounds| bounds.y)
        .collect();
    staff_ys.sort_by(f64::total_cmp);
    staff_ys.dedup_by(|left, right| (*left - *right).abs() < 0.01);
    let group_center = (staff_ys[0] + staff_ys[1] + 4.0 * config.sp) * 0.5;
    let count_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::time_sig_digit(3) =>
            {
                Some(*y)
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        count_ys.len(),
        1,
        "grand staff must render one MMR count, found {count_ys:?} for staves {staff_ys:?}"
    );
    assert!(
        (count_ys[0] - group_center).abs() < 0.01,
        "MMR count should be vertically centered between staves"
    );
    let range_y = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawText { text, y, .. } if text == "1\u{2013}3" => Some(*y),
            _ => None,
        })
        .expect("MMR range label");
    assert!(
        range_y > staff_ys[1] + 4.0 * config.sp,
        "MMR range label should sit below the bottom staff"
    );
    let count_boxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|bbox| bbox.element_id.ends_with("/mmrcount"))
        .collect();
    assert_eq!(
        count_boxes.len(),
        1,
        "MMR count must publish one shared bbox"
    );
    assert!(
        (count_boxes[0].bbox.y + count_boxes[0].bbox.height * 0.5 - group_center).abs() < 0.01,
        "MMR count bbox should follow the centered count"
    );
    let range_box = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id.ends_with("/mnum"))
        .expect("MMR range bbox");
    assert!(
        range_box.bbox.y > staff_ys[1] + 4.0 * config.sp,
        "MMR range bbox should follow the bottom-staff label"
    );
}

#[test]
fn test_grand_staff_repeat_numbers_and_dynamics_use_distinct_shared_lanes() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "m1", "number": 10, "time": {"count": 4, "unit": 4}},
            {"id": "m2"}
        ]},
        "parts": [{"name": "Harp", "staves": 2, "measures": [
            {"sequences": [
                {"staff": 1, "content": [{"id": "top", "duration": {"base": "whole"},
                    "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                {"staff": 2, "content": [{"id": "bottom", "duration": {"base": "whole"},
                    "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
            ]},
            {
                "measureRepeat": {"number": 1, "displayNumber": "yes", "counter": {"count": 2}},
                "sequences": [{"staff": 1, "content": []}, {"staff": 2, "content": []}],
                "dynamics": [
                    {"id": "repeat-p", "type": "immediate", "value": "p", "staff": 2,
                     "position": {"fraction": [0, 1]}},
                    {"id": "repeat-cresc", "type": "gradual", "staff": 2,
                     "position": {"fraction": [0, 1]},
                     "end": {"measure": "m2", "position": {"fraction": [1, 1]}},
                     "wedgeType": "increasing", "visuallyContinues": "repeat-p"}
                ],
                "expressions": [
                    {"text": "cresc.", "position": {"fraction": [1, 2]}}
                ]
            }
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let mut staff_ys: Vec<f64> = dl
        .measure_bounds
        .iter()
        .filter(|bounds| bounds.index == 1)
        .map(|bounds| bounds.y)
        .collect();
    staff_ys.sort_by(f64::total_cmp);
    staff_ys.dedup_by(|left, right| (*left - *right).abs() < 0.01);
    let group_center = (staff_ys[0] + staff_ys[1] + 4.0 * config.sp) * 0.5;

    let counter_ys: Vec<f64> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            let is_repeat = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/measurerepeat"));
            match command {
                RenderCommand::DrawText { text, y, .. } if is_repeat && text == "2" => Some(*y),
                _ => None,
            }
        })
        .collect();
    assert_eq!(
        counter_ys.len(),
        1,
        "repeat counter should render only once"
    );
    assert!(
        counter_ys[0] < staff_ys[0],
        "repeat counter should remain above the top staff"
    );
    let span_number_ys: Vec<f64> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            let is_repeat = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/measurerepeat"));
            match command {
                RenderCommand::DrawGlyph { codepoint, y, .. }
                    if is_repeat && *codepoint == smufl::time_sig_digit(1) =>
                {
                    Some(*y)
                }
                _ => None,
            }
        })
        .collect();
    assert_eq!(
        span_number_ys.len(),
        1,
        "repeat span numeral should render only once"
    );
    assert!(
        span_number_ys[0] < staff_ys[0],
        "repeat span numeral should remain above the top staff"
    );
    let bar_number_y = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawText { text, y, .. } if text == "10" => Some(*y),
            _ => None,
        })
        .expect("system bar number");
    assert!(
        bar_number_y > staff_ys[1] + 4.0 * config.sp,
        "bar number should sit below the bottom staff"
    );

    let dynamic_baseline = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let is_dynamic = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/dynrepeat-p"));
            match command {
                RenderCommand::DrawGlyph { y, .. } if is_dynamic => Some(*y),
                _ => None,
            }
        })
        .expect("repeat dynamic");
    let (_, dynamic_y, _, dynamic_height) = smufl::glyph_bbox(smufl::DYNAMIC_PIANO);
    let dynamic_ink_center = dynamic_baseline + (dynamic_y + dynamic_height * 0.5) * config.sp;
    assert!(
        (dynamic_ink_center - group_center).abs() < 0.01,
        "dynamic should be optically centered between staves"
    );
    let expression_baseline = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawText { text, y, .. } if text == "cresc." => Some(*y),
            _ => None,
        })
        .expect("repeat expression");
    let expression_center = expression_baseline
        - crate::layout::text_styles::lowercase_center_offset_from_baseline(
            crate::layout::text_styles::FontFamily::Serif,
            2.0 * config.sp,
        );
    assert!(
        (expression_center - group_center).abs() < 0.01,
        "expression text should be optically centered between staves"
    );

    let hairpin_center = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let is_hairpin = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/hairpinrepeat-cresc"));
            match command {
                RenderCommand::DrawLine { y1, .. } if is_hairpin => Some(*y1),
                _ => None,
            }
        })
        .expect("repeat hairpin");
    assert!(
        (hairpin_center - group_center).abs() < 0.01,
        "hairpin should be centered between staves"
    );
}

#[test]
fn test_brace_glyph_width_constant() {
    assert!((smufl::BRACE_GLYPH_WIDTH - 0.328).abs() < 0.001);
    #[allow(clippy::assertions_on_constants)]
    // sanity guard against future refactor accidentally zeroing the const.
    {
        assert!(smufl::BRACE_GLYPH_WIDTH > 0.0);
    }
}

#[test]
fn test_brace_stretches_without_thickening() {
    // A grand staff whose staves sit further apart than the spacing the brace
    // design assumes: the glyph has to reach further, but that distance belongs
    // to its height alone. A brace that grew wider with the gap would read as a
    // heavier stroke for a reason that has nothing to do with the music.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/grand-staff.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let (size, scale_x, codepoint) = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawStretchedGlyph {
                size,
                scale_x,
                codepoint,
                ..
            } if is_brace_glyph(*codepoint) => Some((*size, *scale_x, *codepoint)),
            _ => None,
        })
        .expect("Should have a brace glyph");

    // Two staves take the default cut.
    assert_eq!(codepoint, smufl::BRACE);

    // The layout opens this pair wider than the nominal 7sp gap, so the brace is
    // narrowed to compensate rather than drawn proportionally.
    assert!(
        scale_x < 1.0,
        "Brace over wider-than-nominal staves should be narrowed, got scale_x = {scale_x}"
    );

    // The drawn width is the width the same brace would have at nominal spacing.
    let nominal_span = (2.0 * 4.0 + 7.0) * sp;
    let nominal_width = smufl::BRACE_GLYPH_WIDTH * nominal_span / smufl::BRACE_GLYPH_HEIGHT;
    let drawn_width = smufl::BRACE_GLYPH_WIDTH * size / 4.0 * scale_x;
    assert!(
        (drawn_width - nominal_width).abs() < 0.01,
        "Brace width ({drawn_width:.3}) should be frozen at its nominal-spacing width ({nominal_width:.3})"
    );

    // …while the height still spans the staves exactly.
    let drawn_height = smufl::BRACE_GLYPH_HEIGHT * size / 4.0;
    assert!(
        drawn_height > nominal_span,
        "Brace height ({drawn_height:.1}) should follow the wider span (> {nominal_span:.1})"
    );
}

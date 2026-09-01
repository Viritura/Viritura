// Auto-generated from tests.rs — test_signatures
// 2 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::measure::*;
use crate::layout::render_signatures::render_key_signature;
use crate::layout::resolve::*;
use crate::layout::{layout_full_score, layout_score};
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_key_signature_advance_is_relative_to_origin() {
    let key = KeySignature {
        fifths: 2,
        ..Default::default()
    };
    let mut at_zero = DisplayList::new(400.0, 200.0);
    let mut at_offset = DisplayList::new(400.0, 200.0);
    let zero_advance =
        render_key_signature(&mut at_zero, 0.0, 80.0, 12.0, &key, &ClefSign::G, None);
    let offset_advance =
        render_key_signature(&mut at_offset, 120.0, 80.0, 12.0, &key, &ClefSign::G, None);

    assert!((zero_advance - offset_advance).abs() < 1.0e-9);
}

#[test]
fn test_time_signature_changes() {
    // Three measures: 4/4, inherit 4/4, then change to 2/4
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {},
            {"time": {"count": 2, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                ]}]
            },
            {
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                ]}]
            },
            {
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    // Verify resolve_measures inherits time correctly
    let resolved = resolve_measures(&score, 0);
    assert_eq!(resolved.len(), 3);
    assert!(
        resolved[0].global.time.is_some(),
        "Measure 0 should have explicit time"
    );
    assert!(
        resolved[1].global.time.is_none(),
        "Measure 1 should NOT have explicit time"
    );
    assert!(
        resolved[2].global.time.is_some(),
        "Measure 2 should have explicit time"
    );
    assert_eq!(
        resolved[0].active_time,
        TimeSignature {
            count: 4,
            unit: 4,
            display: None
        }
    );
    assert_eq!(
        resolved[1].active_time,
        TimeSignature {
            count: 4,
            unit: 4,
            display: None
        }
    );
    assert_eq!(
        resolved[2].active_time,
        TimeSignature {
            count: 2,
            unit: 4,
            display: None
        }
    );

    // Layout and render
    let dl = layout_score(&score, 0, &config);

    // Collect all time-sig digit glyphs (SMuFL 0xE080..0xE089)
    let ts_glyphs: Vec<(f64, f64, u32)> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if (0xE080..=0xE089).contains(codepoint) => Some((*x, *y, *codepoint)),
            _ => None,
        })
        .collect();

    // Expect 4 time sig digit glyphs: "4","4" for measure 0 and "2","4" for measure 2
    assert_eq!(
        ts_glyphs.len(),
        4,
        "Expected 4 time sig digit glyphs (two per time sig), got {}: {:?}",
        ts_glyphs.len(),
        ts_glyphs
    );

    // First two glyphs: 4/4 (digit 4 = 0xE084)
    assert_eq!(
        ts_glyphs[0].2,
        smufl::TIME_SIG_4,
        "First time sig numerator should be 4"
    );
    assert_eq!(
        ts_glyphs[1].2,
        smufl::TIME_SIG_4,
        "First time sig denominator should be 4"
    );

    // Last two glyphs: 2/4 (digit 2 = 0xE082, digit 4 = 0xE084)
    assert_eq!(
        ts_glyphs[2].2,
        smufl::TIME_SIG_2,
        "Second time sig numerator should be 2"
    );
    assert_eq!(
        ts_glyphs[3].2,
        smufl::TIME_SIG_4,
        "Second time sig denominator should be 4"
    );

    // The 2/4 time sig glyphs should be to the right of the 4/4 ones
    assert!(
        ts_glyphs[2].0 > ts_glyphs[0].0,
        "2/4 time sig should be to the right of 4/4 time sig"
    );

    // Verify measure widths: measure 2 (2/4) should be narrower than measure 0 (4/4)
    let margin_left = config.margin_left * sp;
    let mut x_cursor = margin_left;
    let mut measure_widths = Vec::new();
    for rm in &resolved {
        let ml = layout_measure(rm, sp, x_cursor, &config, None, &[], 1.0);
        measure_widths.push(ml.width);
        x_cursor += ml.width;
    }
    assert!(
        measure_widths[2] < measure_widths[0],
        "2/4 measure ({:.1}) should be narrower than 4/4 measure ({:.1})",
        measure_widths[2],
        measure_widths[0]
    );
}

#[test]
fn first_onset_accidental_padding_does_not_shift_time_signature() {
    let plain = r#"{
        "mnx": {"version": 1},
        "support": {"useAccidentalDisplay": true},
        "global": {"measures": [{"time": {"count": 5, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{
                "duration": {"base": "whole"},
                "notes": [{"pitch": {"step": "C", "octave": 5}}]
            }]}]
        }]}]
    }"#;
    let accidental = r#"{
        "mnx": {"version": 1},
        "support": {"useAccidentalDisplay": true},
        "global": {"measures": [{"time": {"count": 5, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{
                "duration": {"base": "whole"},
                "notes": [{
                    "pitch": {"step": "C", "octave": 5, "alter": -2},
                    "accidentalDisplay": {"show": true, "force": true}
                }]
            }]}]
        }]}]
    }"#;
    let time_signature_x = |json: &str| {
        let display = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
        display
            .commands
            .iter()
            .filter_map(|command| match command {
                RenderCommand::DrawGlyph { x, codepoint, .. }
                    if *codepoint == smufl::time_sig_digit(5) =>
                {
                    Some(*x)
                }
                _ => None,
            })
            .next()
            .expect("5/4 numerator should be rendered")
    };

    let plain_x = time_signature_x(plain);
    let accidental_x = time_signature_x(accidental);
    assert!(
        (plain_x - accidental_x).abs() < 0.01,
        "first-onset accidental padding must follow the time-signature slot: plain x={plain_x:.2}, accidental x={accidental_x:.2}"
    );
}

#[test]
fn full_score_aligns_time_signatures_before_different_first_onset_extents() {
    let json = r#"{
        "mnx": {"version": 1},
        "support": {"useAccidentalDisplay": true},
        "global": {"measures": [{"time": {"count": 5, "unit": 4}}]},
        "parts": [
            {"measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [{
                    "id": "plain-onset",
                    "duration": {"base": "whole"},
                    "notes": [{"pitch": {"step": "C", "octave": 5}}]
                }]}]
            }]},
            {"measures": [{
                "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                "sequences": [{"content": [{
                    "id": "altered-onset",
                    "duration": {"base": "whole"},
                    "notes": [{
                        "pitch": {"step": "C", "octave": 3, "alter": -2},
                        "accidentalDisplay": {"show": true, "force": true}
                    }]
                }]}]
            }]}
        ]
    }"#;
    let display = layout_full_score(&parse_mnx(json).unwrap(), &LayoutConfig::default());
    let numerator_x: Vec<f64> = display
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::time_sig_digit(5) =>
            {
                Some(*x)
            }
            _ => None,
        })
        .collect();
    assert_eq!(numerator_x.len(), 2, "5/4 should render once on each staff");
    assert!(
        (numerator_x[0] - numerator_x[1]).abs() < 0.01,
        "system-aligned time signatures must share x: {:?}",
        numerator_x
    );

    let signature_right = display
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } if (0xE080..=0xE089).contains(codepoint) => {
                let (bbox_x, _, bbox_width, _) = smufl::glyph_bbox(*codepoint);
                Some(x + (bbox_x + bbox_width) * size / 4.0)
            }
            _ => None,
        })
        .max_by(f64::total_cmp)
        .expect("time signature should render digit ink");
    let onset_ink: Vec<_> = display
        .element_shapes
        .iter()
        .filter(|shape| matches!(shape.kind, ElementKind::Notehead | ElementKind::Accidental))
        .filter_map(|shape| {
            shape
                .bbox(&display.commands)
                .map(|bbox| (shape.kind, bbox.x))
        })
        .collect();
    assert_eq!(
        onset_ink
            .iter()
            .filter(|(kind, _)| *kind == ElementKind::Notehead)
            .count(),
        2,
        "both staves should publish first-onset notehead ink"
    );
    assert_eq!(
        onset_ink
            .iter()
            .filter(|(kind, _)| *kind == ElementKind::Accidental)
            .count(),
        1,
        "the altered staff should publish accidental ink"
    );
    for (kind, onset_x) in onset_ink {
        assert!(
            onset_x > signature_right,
            "{kind:?} at {onset_x:.2} must clear signature ink ending at {signature_right:.2}"
        );
    }
}

#[test]
fn senza_misura_spaces_content_without_changing_the_following_meter() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 2, "unit": 4}},
            {"time": {"count": 2, "unit": 4}, "_x": {"viritura": {"senzaMisura": true}}},
            {}
        ]},
        "parts": [{"measures": [
            {"sequences": [{"content": [{"duration": {"base": "half"}, "rest": {}}]}]},
            {"sequences": [{"content": [
                {"id": "cadenza-1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "cadenza-2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "cadenza-3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "cadenza-4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]},
            {"sequences": [{"content": [{"duration": {"base": "half"}, "rest": {}}]}]}
        ]}]
    }"#;

    let mut score = parse_mnx(json).unwrap();
    crate::reconcile::reconcile_score(&mut score);
    let resolved = resolve_measures(&score, 0);
    assert_eq!(resolved[2].active_time.count, 2);
    assert_eq!(resolved[2].active_time.unit, 4);
    assert_eq!(
        resolved[1].part.sequences[0].content.len(),
        4,
        "reconciliation must not alter written senza-misura content"
    );

    let display = layout_score(&score, 0, &LayoutConfig::default());
    assert!(
        display
            .element_bboxes
            .iter()
            .any(|bbox| bbox.element_id.ends_with("cadenza-4")),
        "senza misura must lay out content beyond the inherited meter"
    );
    let following = display
        .measure_bounds
        .iter()
        .find(|bound| bound.index == 2)
        .expect("following measure should have bounds");
    assert_eq!(
        following.total_beats, 2.0,
        "senza-misura display applies only to the measure that declares it"
    );
}

#[test]
fn hidden_senza_misura_reserves_no_prefix_or_glyph() {
    let ts = TimeSignature {
        count: 2,
        unit: 4,
        display: Some(TimeSignatureDisplay::SenzaMisura),
    };
    let settings = TimeSignatureSettings {
        senza_misura: SenzaMisuraDisplay::Hidden,
        ..TimeSignatureSettings::default()
    };
    let layout = time_signature_layout(settings, &ts, 0.0, 0.0, 4.0, 1.0);

    assert!(layout.glyphs.is_empty());
    assert_eq!(layout.width, 0.0);
    assert_eq!(prefix_reserve(settings, &ts, 1.0), 0.0);
}

#[test]
fn beethoven_cadenza_uses_one_measure_for_the_full_oboe_line() {
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    );
    let mut score = parse_mnx(json).unwrap();
    let cadenza_index = score
        .global
        .measures
        .iter()
        .position(|measure| {
            measure
                .time
                .as_ref()
                .is_some_and(|time| time.display == Some(TimeSignatureDisplay::SenzaMisura))
        })
        .expect("Beethoven fixture should have a declared senza-misura cadenza");
    let cadenza_lengths: Vec<Vec<usize>> = score
        .parts
        .iter()
        .map(|part| {
            part.measures[cadenza_index]
                .sequences
                .iter()
                .map(|sequence| sequence.content.len())
                .collect()
        })
        .collect();
    crate::reconcile::reconcile_score(&mut score);
    assert!(
        score
            .parts
            .iter()
            .zip(&cadenza_lengths)
            .all(|(part, lengths)| {
                part.measures[cadenza_index]
                    .sequences
                    .iter()
                    .map(|sequence| sequence.content.len())
                    .eq(lengths.iter().copied())
            }),
        "WASM reconciliation must not generate an empty slot in the cadenza"
    );
    let display =
        crate::layout::mnx_layout::layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
    let cadenza_bounds: Vec<_> = display
        .measure_bounds
        .iter()
        .filter(|bound| bound.index == cadenza_index && bound.part_index == 2)
        .collect();
    assert_eq!(
        cadenza_bounds.len(),
        1,
        "oboe cadenza must have one measure bound"
    );
    let cadenza_bound = cadenza_bounds[0];
    assert_eq!(
        cadenza_bound.total_beats, 9.0,
        "oboe cadenza bounds must span all written events"
    );
    let final_oboe_note = display
        .element_bboxes
        .iter()
        .find(|bbox| {
            bbox.element_id
                .ends_with("019fd344-0a22-77f0-a2d5-9b46986c20b1")
        })
        .expect("oboe cadenza fermata note should render");
    let beat_two_x = cadenza_bound
        .beat_anchors
        .iter()
        .find(|(beat, _)| (*beat - 2.0).abs() < 0.001)
        .map(|(_, x)| *x)
        .expect("cadenza should expose its inherited-meter beat-two anchor");

    assert!(
        final_oboe_note.bbox.x > beat_two_x,
        "the oboe line must continue past the nominal 2/4 boundary"
    );
    assert!(
        final_oboe_note.bbox.x + final_oboe_note.bbox.width
            <= cadenza_bound.x + cadenza_bound.width,
        "the cadenza's final oboe note must remain inside measure 269"
    );
}

#[test]
fn test_clef_changes_mid_measure() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("packages/format/fixtures/mnx/clef-changes.mnx"),
    )
    .expect("clef-changes.mnx should exist");

    let score = parse_mnx(&json).expect("should parse");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have at least the basic render commands (staff lines, clef, notes)
    assert!(
        dl.commands.len() > 10,
        "expected many render commands, got {}",
        dl.commands.len()
    );

    // Find the change clef glyph (regular F clef rendered at 2/3 size)
    let change_size = 4.0 * config.sp * 2.0 / 3.0;
    let change_clef_cmds: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph {
                codepoint, size, ..
            } = cmd
            {
                *codepoint == smufl::F_CLEF && (*size - change_size).abs() < 0.01
            } else {
                false
            }
        })
        .collect();

    assert_eq!(
        change_clef_cmds.len(),
        1,
        "expected exactly 1 F clef change glyph (at 2/3 size), found {}",
        change_clef_cmds.len()
    );

    // Verify the initial G clef is rendered at full size
    let initial_clef_cmds: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph {
                codepoint, size, ..
            } = cmd
            {
                *codepoint == smufl::G_CLEF && (*size - 4.0 * config.sp).abs() < 0.01
            } else {
                false
            }
        })
        .collect();

    assert_eq!(
        initial_clef_cmds.len(),
        1,
        "expected exactly 1 initial G clef glyph, found {}",
        initial_clef_cmds.len()
    );

    // Verify 4 noteheads are rendered (C4, G3, E3, C3)
    let notehead_cmds: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, .. } = cmd {
                *codepoint == smufl::NOTEHEAD_BLACK
            } else {
                false
            }
        })
        .collect();

    assert_eq!(
        notehead_cmds.len(),
        4,
        "expected 4 noteheads, found {}",
        notehead_cmds.len()
    );

    // Verify the change clef x is between event 2 and event 3
    // (between the 2nd and 3rd noteheads)
    let mut notehead_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, x, .. } = cmd {
                if *codepoint == smufl::NOTEHEAD_BLACK {
                    Some(*x)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    notehead_xs.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let change_clef_x = if let RenderCommand::DrawGlyph { x, .. } = change_clef_cmds[0] {
        *x
    } else {
        panic!("expected DrawGlyph");
    };

    assert!(
        change_clef_x > notehead_xs[1],
        "change clef x ({:.1}) should be after 2nd note x ({:.1})",
        change_clef_x,
        notehead_xs[1]
    );
    assert!(
        change_clef_x < notehead_xs[2],
        "change clef x ({:.1}) should be before 3rd note x ({:.1})",
        change_clef_x,
        notehead_xs[2]
    );
}

#[test]
fn test_clef_change_at_start_of_non_first_measure() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            },
            {
                "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let initial_g_clefs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, codepoint, size, ..
            } = cmd
            {
                if *codepoint == smufl::G_CLEF && (*size - 4.0 * config.sp).abs() < 0.01 {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert_eq!(
        initial_g_clefs.len(),
        1,
        "expected 1 initial full-size G clef, found {}",
        initial_g_clefs.len()
    );

    let start_change_f_clefs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, codepoint, size, ..
            } = cmd
            {
                // At start of non-first measure (same system), clef is rendered at 2/3
                // change-clef size per engraving convention (courtesy clef before barline).
                let change_size = 4.0 * config.sp * 2.0 / 3.0;
                if *codepoint == smufl::F_CLEF && (*size - change_size).abs() < 0.01 {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert_eq!(
        start_change_f_clefs.len(),
        1,
        "expected 1 start-of-measure change-size F clef, found {}",
        start_change_f_clefs.len()
    );

    assert!(
        start_change_f_clefs[0] > initial_g_clefs[0],
        "start-of-measure change clef should appear after initial clef"
    );
}

#[test]
fn test_start_of_measure_clef_change_is_before_the_barline() {
    // Standard engraving practice: a clef change that takes effect at the start
    // of a (mid-system) measure is engraved BEFORE the preceding barline, not
    // after it. Two whole-note measures on one system; measure 1 changes to bass
    // clef. The 2/3-size change clef must sit to the LEFT of the measure-1 start
    // barline.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            },
            {
                "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // The 2/3-size change F clef for the measure-1 clef change.
    let change_size = 4.0 * config.sp * 2.0 / 3.0;
    let change_clef_x = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, codepoint, size, ..
            } = cmd
            {
                if *codepoint == smufl::F_CLEF && (*size - change_size).abs() < 0.01 {
                    return Some(*x);
                }
            }
            None
        })
        .expect("expected a 2/3-size change F clef");

    // The measure-1 start barline (tagged "m1/barline"): a vertical DrawLine.
    let barline_x = dl
        .element_ids
        .iter()
        .enumerate()
        .filter(|(_, id)| id.as_deref() == Some("m1/barline"))
        .find_map(|(i, _)| {
            if let RenderCommand::DrawLine { x1, y1, y2, .. } = &dl.commands[i] {
                // Vertical line (barline), not a horizontal staff line.
                if (y1 - y2).abs() > config.sp {
                    return Some(*x1);
                }
            }
            None
        })
        .expect("expected a vertical barline tagged m1/barline");

    assert!(
        change_clef_x < barline_x,
        "start-of-measure clef change should render BEFORE the barline: \
         clef x={change_clef_x:.1}, barline x={barline_x:.1}"
    );
}

#[test]
fn test_start_of_measure_clef_change_clears_double_barline() {
    // When the preceding barline is a DOUBLE barline (two strokes that straddle
    // the anchor x), the change clef must clear the barline's LEFTMOST stroke,
    // not just its center — otherwise the clef visually collides with the left
    // line of the double bar. Regression for that overlap.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "barline": {"type": "double"}},
            {}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            },
            {
                "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // The 2/3-size change F clef.
    let change_size = 4.0 * sp * 2.0 / 3.0;
    let change_clef_x = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, codepoint, size, ..
            } = cmd
            {
                if *codepoint == smufl::F_CLEF && (*size - change_size).abs() < 0.01 {
                    return Some(*x);
                }
            }
            None
        })
        .expect("expected a 2/3-size change F clef");
    // F clef ink width at 2/3 size, from its Bravura glyphBBox.
    let clef_right = change_clef_x + smufl::glyph_bbox(smufl::F_CLEF).2 * (2.0 / 3.0) * sp;

    // Leftmost vertical stroke tagged "m1/barline" = the double bar's left line.
    let leftmost_barline_x = dl
        .element_ids
        .iter()
        .enumerate()
        .filter(|(_, id)| id.as_deref() == Some("m1/barline"))
        .filter_map(|(i, _)| {
            if let RenderCommand::DrawLine { x1, y1, y2, .. } = &dl.commands[i] {
                if (y1 - y2).abs() > sp {
                    return Some(*x1);
                }
            }
            None
        })
        .min_by(f64::total_cmp)
        .expect("expected vertical barline strokes tagged m1/barline");

    assert!(
        clef_right <= leftmost_barline_x,
        "change clef right edge ({clef_right:.1}) must clear the double barline's \
         left stroke ({leftmost_barline_x:.1})"
    );

    // The clef must be RIGHT-aligned against the barline's left stroke with the
    // fixed pad — not left-aligned with a loose, clef-width-dependent gap. This
    // keeps the clef-to-barline padding uniform across clefs of different
    // widths. `leftmost_barline_x` is the left stroke's CENTER; its left ink
    // edge is half a line-width further left, so the expected gap from the clef
    // right edge to the stroke center is `pad + thin/2`.
    let thin = config.barline_width * sp;
    let expected_pad = 0.7 * sp + thin * 0.5;
    let pad = leftmost_barline_x - clef_right;
    assert!(
        (pad - expected_pad).abs() < 0.15 * sp,
        "change clef should keep a readable gap before the double barline \
         (measured {pad:.2}px, expected ~{expected_pad:.2}px), not floating"
    );
}

#[test]
fn test_mid_measure_clef_change_after_triplet_anchors_on_note() {
    // A triplet (three eighths in the space of a quarter) fills beat 1, then a
    // mid-measure clef change sits at beat 2 (whole-note position 1/4) ahead of
    // three quarter notes. The clef must be anchored on the ACTUAL x of the
    // post-triplet note, not on a linear beat→x interpolation: note spacing is
    // logarithmic and tuplet onsets land on non-integer beats, so a linear map
    // would drop the clef into the middle of the triplet.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [
                {"clef": {"sign": "G", "staffPosition": -2}},
                {"position": {"fraction": [1, 4]}, "clef": {"sign": "F", "staffPosition": 2}}
            ],
            "sequences": [{"content": [
                {
                    "type": "tuplet",
                    "inner": {"multiple": 3, "duration": {"base": "eighth"}},
                    "outer": {"multiple": 2, "duration": {"base": "eighth"}},
                    "content": [
                        {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                        {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                        {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                    ]
                },
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Six noteheads: three triplet eighths, then three quarters.
    let mut notehead_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, x, .. } = cmd {
                (*codepoint == smufl::NOTEHEAD_BLACK).then_some(*x)
            } else {
                None
            }
        })
        .collect();
    notehead_xs.sort_by(f64::total_cmp);
    assert_eq!(
        notehead_xs.len(),
        6,
        "expected 6 noteheads (3 triplet + 3 quarter), found {}",
        notehead_xs.len()
    );

    // The change clef is the F clef rendered at 2/3 size.
    let change_size = 4.0 * config.sp * 2.0 / 3.0;
    let change_clef_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, codepoint, size, ..
            } = cmd
            {
                (*codepoint == smufl::F_CLEF && (*size - change_size).abs() < 0.01).then_some(*x)
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        change_clef_xs.len(),
        1,
        "expected exactly 1 mid-measure change F clef, found {}",
        change_clef_xs.len()
    );
    let change_clef_x = change_clef_xs[0];

    // The clef must sit AFTER the last triplet eighth (index 2) and BEFORE the
    // first post-triplet quarter (index 3). A linear beat→x placement would
    // land it left of the triplet's tail and fail the first assertion.
    assert!(
        change_clef_x > notehead_xs[2],
        "change clef x ({:.1}) must be after the last triplet note ({:.1})",
        change_clef_x,
        notehead_xs[2]
    );
    assert!(
        change_clef_x < notehead_xs[3],
        "change clef x ({:.1}) must be before the first post-triplet note ({:.1})",
        change_clef_x,
        notehead_xs[3]
    );
}

#[test]
fn test_mid_measure_tenor_and_bass_clefs_use_ink_clearances() {
    let layout = |change_sign: &str, change_position: i32| {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{"time": {{"count": 2, "unit": 4}}}}]}},
                "parts": [{{"measures": [{{
                    "clefs": [
                        {{"clef": {{"sign": "F", "staffPosition": 2}}}},
                        {{"position": {{"fraction": [1, 8]}},
                          "clef": {{"sign": "{change_sign}", "staffPosition": {change_position}}}}}
                    ],
                    "beams": [{{"events": ["after-1", "after-2", "after-3"]}}],
                    "sequences": [{{"content": [
                        {{"id": "before", "duration": {{"base": "eighth"}}, "stemDirection": "up",
                          "notes": [{{"pitch": {{"step": "E", "octave": 4}}}}]}},
                        {{"id": "after-1", "duration": {{"base": "eighth"}},
                          "notes": [{{"pitch": {{"step": "G", "octave": 4}}}}]}},
                        {{"id": "after-2", "duration": {{"base": "eighth"}},
                          "notes": [{{"pitch": {{"step": "A", "octave": 4}}}}]}},
                        {{"id": "after-3", "duration": {{"base": "eighth"}},
                          "notes": [{{"pitch": {{"step": "B", "octave": 4}}}}]}}
                    ]}}]
                }}]}}]
            }}"#
        );
        layout_score(&parse_mnx(&json).unwrap(), 0, &LayoutConfig::default())
    };

    for (sign, staff_position, codepoint, name) in [
        ("C", 2, smufl::C_CLEF, "tenor"),
        ("F", 2, smufl::F_CLEF, "bass"),
    ] {
        let dl = layout(sign, staff_position);
        let sp = LayoutConfig::default().sp;
        let change_size = 4.0 * sp * 2.0 / 3.0;
        let clef = dl
            .commands
            .iter()
            .find(|command| {
                matches!(
                    command,
                    RenderCommand::DrawGlyph {
                        codepoint: cp,
                        size,
                        ..
                    } if *cp == codepoint && (*size - change_size).abs() < 0.01
                )
            })
            .and_then(RenderCommand::bbox)
            .expect("change clef bbox");
        let mut noteheads: Vec<_> = dl
            .commands
            .iter()
            .filter(|command| {
                matches!(
                    command,
                    RenderCommand::DrawGlyph { codepoint, .. }
                        if smufl::is_notehead(*codepoint)
                )
            })
            .filter_map(RenderCommand::bbox)
            .collect();
        noteheads.sort_by(|left, right| left.x.total_cmp(&right.x));
        let first_flag = dl
            .commands
            .iter()
            .filter(|command| {
                matches!(
                    command,
                    RenderCommand::DrawGlyph { codepoint, .. }
                        if *codepoint == smufl::FLAG_8TH_UP
                )
            })
            .filter_map(RenderCommand::bbox)
            .min_by(|left, right| left.x.total_cmp(&right.x))
            .expect("first eighth-note flag");
        let prior_right =
            (noteheads[0].x + noteheads[0].width).max(first_flag.x + first_flag.width);
        let following_left = noteheads[1].x;
        let left_gap = clef.x - prior_right;
        let right_gap = following_left - (clef.x + clef.width);

        assert!(
            left_gap >= 0.5 * sp - 0.01,
            "{name} change-clef left ink gap {left_gap:.3}px must clear the \
             preceding flag by 0.5sp"
        );
        assert!(
            right_gap >= 0.4 * sp - 0.01,
            "{name} change-clef right ink gap {right_gap:.3}px must preserve 0.4sp"
        );
        assert!(
            right_gap <= 0.5 * sp + 0.01,
            "{name} change-clef right ink gap {right_gap:.3}px must not include \
             an extra glyph slot"
        );
    }
}

#[test]
fn test_key_signature_vertical_position_follows_clef() {
    let treble_json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let bass_json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
            ]}]
        }]}]
    }"#;

    let config = LayoutConfig::default();
    let treble_dl = layout_score(&parse_mnx(treble_json).unwrap(), 0, &config);
    let bass_dl = layout_score(&parse_mnx(bass_json).unwrap(), 0, &config);

    let mut treble_sharp_ys: Vec<f64> = treble_dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, y, .. } = cmd {
                if *codepoint == smufl::ACCIDENTAL_SHARP {
                    return Some(*y);
                }
            }
            None
        })
        .collect();

    let mut bass_sharp_ys: Vec<f64> = bass_dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, y, .. } = cmd {
                if *codepoint == smufl::ACCIDENTAL_SHARP {
                    return Some(*y);
                }
            }
            None
        })
        .collect();

    treble_sharp_ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    bass_sharp_ys.sort_by(|a, b| a.partial_cmp(b).unwrap());

    assert_eq!(
        treble_sharp_ys.len(),
        2,
        "treble key signature should render 2 sharp glyphs"
    );
    assert_eq!(
        bass_sharp_ys.len(),
        2,
        "bass key signature should render 2 sharp glyphs"
    );

    assert!(
        bass_sharp_ys[0] > treble_sharp_ys[0] + 0.5 * config.sp,
        "bass-clef key signature should be vertically lower than treble: bass y {:.2}, treble y {:.2}",
        bass_sharp_ys[0],
        treble_sharp_ys[0]
    );
}

#[test]
fn test_ottava_clef_g_8vb() {
    // G clef with octave=-1 should render gClef8vb (U+E052)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2, "octave": -1, "showOctave": true}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have the G_CLEF_8VB glyph (U+E052) at full size
    let ottava_clef_cmds: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph {
                codepoint, size, ..
            } = cmd
            {
                *codepoint == smufl::G_CLEF_8VB && (*size - 4.0 * config.sp).abs() < 0.01
            } else {
                false
            }
        })
        .collect();

    assert_eq!(
        ottava_clef_cmds.len(),
        1,
        "expected exactly 1 G clef 8vb glyph, found {}",
        ottava_clef_cmds.len()
    );

    // Should NOT have a regular G_CLEF
    let regular_g_clef: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, .. } = cmd {
                *codepoint == smufl::G_CLEF
            } else {
                false
            }
        })
        .collect();
    assert_eq!(
        regular_g_clef.len(),
        0,
        "should not have regular G clef when ottava is used"
    );
}

#[test]
fn test_ottava_clef_f_8va() {
    // F clef with octave=1 should render fClef8va (U+E065)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "F", "staffPosition": 2, "octave": 1, "showOctave": true}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let ottava_clef_cmds: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph {
                codepoint, size, ..
            } = cmd
            {
                *codepoint == smufl::F_CLEF_8VA && (*size - 4.0 * config.sp).abs() < 0.01
            } else {
                false
            }
        })
        .collect();

    assert_eq!(
        ottava_clef_cmds.len(),
        1,
        "expected exactly 1 F clef 8va glyph, found {}",
        ottava_clef_cmds.len()
    );
}

#[test]
fn test_ottava_clef_show_octave_false() {
    // When showOctave=false, should render regular G clef even with octave set
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2, "octave": -1, "showOctave": false}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have regular G_CLEF, not 8vb
    let regular_g_clef: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph {
                codepoint, size, ..
            } = cmd
            {
                *codepoint == smufl::G_CLEF && (*size - 4.0 * config.sp).abs() < 0.01
            } else {
                false
            }
        })
        .collect();
    assert_eq!(
        regular_g_clef.len(),
        1,
        "expected regular G clef when showOctave=false"
    );

    let ottava_cmds: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, .. } = cmd {
                *codepoint == smufl::G_CLEF_8VB
            } else {
                false
            }
        })
        .collect();
    assert_eq!(
        ottava_cmds.len(),
        0,
        "should not have ottava glyph when showOctave=false"
    );
}

#[test]
fn test_ottava_clef_g_15ma() {
    // G clef with octave=2 should render gClef15ma (U+E054)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2, "octave": 2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 7}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let ottava_clef_cmds: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph {
                codepoint, size, ..
            } = cmd
            {
                *codepoint == smufl::G_CLEF_15MA && (*size - 4.0 * config.sp).abs() < 0.01
            } else {
                false
            }
        })
        .collect();

    assert_eq!(
        ottava_clef_cmds.len(),
        1,
        "expected exactly 1 G clef 15ma glyph, found {}",
        ottava_clef_cmds.len()
    );
}

#[test]
fn test_ottava_clef_from_mnx_file() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("packages/format/fixtures/mnx/ottava-clefs.mnx"),
    )
    .expect("ottava-clefs.mnx should exist");

    let score = parse_mnx(&json).expect("should parse");
    let config = LayoutConfig::default();

    // Layout each part and verify ottava clef glyphs
    let expected_glyphs = [
        smufl::G_CLEF_8VB,  // Part 0: Treble 8vb
        smufl::G_CLEF_8VA,  // Part 1: Treble 8va
        smufl::F_CLEF_8VB,  // Part 2: Bass 8vb
        smufl::G_CLEF_15MA, // Part 3: Treble 15ma
    ];

    for (part_idx, &expected_cp) in expected_glyphs.iter().enumerate() {
        let dl = layout_score(&score, part_idx, &config);
        let found: Vec<_> = dl
            .commands
            .iter()
            .filter(|cmd| {
                if let RenderCommand::DrawGlyph {
                    codepoint, size, ..
                } = cmd
                {
                    *codepoint == expected_cp && (*size - 4.0 * config.sp).abs() < 0.01
                } else {
                    false
                }
            })
            .collect();

        assert_eq!(
            found.len(),
            1,
            "Part {} should have exactly 1 ottava clef glyph (0x{:04X}), found {}",
            part_idx,
            expected_cp,
            found.len()
        );
    }
}

/// Test that Bb clarinet transposition transposes C major → D major (2 sharps)
/// when useWritten is true.
#[test]
fn test_transposing_instrument_key_signature() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": {
            "measures": [
                { "key": { "fifths": 0 }, "time": { "count": 4, "unit": 4 } }
            ]
        },
        "parts": [{
            "name": "Bb Clarinet",
            "transposition": {
                "interval": { "halfSteps": 2, "staffDistance": 1 }
            },
            "measures": [{ "sequences": [{ "content": [
                { "type": "event", "duration": { "base":"quarter" },
                  "notes": [{ "pitch": { "step": "C", "octave": 4 } }] }
            ] }] }]
        }],
        "scores": [{ "name": "Transposed", "useWritten": true }]
    }"#;

    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = crate::layout::layout_score(&score, 0, &config);

    // In C major with Bb clarinet transposition (halfSteps=2), the written key
    // should be D major (2 sharps). Verify we have sharp accidentals rendered.
    let sharp_glyphs: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, .. } = cmd {
                *codepoint == crate::render::smufl::smufl::ACCIDENTAL_SHARP
            } else {
                false
            }
        })
        .collect();
    assert_eq!(
        sharp_glyphs.len(),
        2,
        "Bb clarinet in C major with useWritten should show 2 sharps (D major)"
    );
}

/// Test that note positions are transposed for Bb clarinet.
#[test]
fn test_transposing_instrument_note_position() {
    // Bb clarinet: sounding C4 → written D4 (1 staff position higher)
    // We compare the resolved measure's active_key to verify transposition applied.
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "key": { "fifths": 0 }, "time": { "count": 4, "unit": 4 } }] },
        "parts": [{
            "name": "Bb Clarinet",
            "transposition": { "interval": { "halfSteps": 2, "staffDistance": 1 } },
            "measures": [{ "sequences": [{ "content": [
                { "type": "event", "duration": { "base":"quarter" },
                  "notes": [{ "pitch": { "step": "C", "octave": 4 } }] }
            ] }] }]
        }],
        "scores": [{ "name": "Transposed", "useWritten": true }]
    }"#;

    let score = crate::parse::parse_mnx(json).unwrap();

    // Verify the resolved measure has transposed key (D major = 2 sharps)
    let resolved = crate::layout::resolve::resolve_measures(&score, 0);
    assert_eq!(
        resolved[0].active_key.fifths, 2,
        "Bb clarinet in C major with useWritten should resolve to D major (2 sharps)"
    );

    // Verify transposition is set on the resolved measure
    assert_eq!(
        resolved[0].transposition,
        Some((1, 2)),
        "Resolved measure should carry the Bb clarinet transposition interval"
    );

    // Verify the layout produces render commands without panic
    let config = LayoutConfig::default();
    let dl = crate::layout::layout_score(&score, 0, &config);
    assert!(
        !dl.commands.is_empty(),
        "Layout should produce render commands"
    );
}

#[test]
fn test_key_flip_respell_transposed_notes_with_flats() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "key": { "fifths": 3 }, "time": { "count": 2, "unit": 4 } }] },
        "parts": [{
            "name": "Baritone Saxophone",
            "transposition": {
                "interval": { "halfSteps": 21, "staffDistance": 12 },
                "keyFifthsFlipAt": 6
            },
            "measures": [{ "sequences": [{ "content": [
                { "duration": { "base": "quarter" }, "notes": [{ "pitch": { "step": "E", "octave": 3 } }] },
                { "duration": { "base": "quarter" }, "notes": [{ "pitch": { "step": "A", "octave": 2 } }] }
            ] }] }]
        }],
        "scores": [{ "name": "Transposed", "useWritten": true }]
    }"#;

    let score = crate::parse::parse_mnx(json).unwrap();
    let resolved = crate::layout::resolve::resolve_measures(&score, 0);

    assert_eq!(resolved[0].active_key.fifths, -6);
    assert_eq!(
        resolved[0].transposition,
        Some((12, 21)),
        "key spelling must not change the instrument transposition interval"
    );
    assert_eq!(resolved[0].written_diatonic_adjustment, 1);
    assert_eq!(resolved[0].display_transposition(), Some((13, 21)));

    let config = LayoutConfig::default();
    let layout = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0);
    let events = &layout.voice_layouts[0].events;
    assert_eq!(events.display_pitches(0)[0].step, "D");
    assert_eq!(events.display_pitches(0)[0].alter, Some(-1));
    assert_eq!(events.display_pitches(1)[0].step, "G");
    assert_eq!(events.display_pitches(1)[0].alter, Some(-1));
}

#[test]
fn test_courtesy_clef_at_system_end() {
    // Two systems forced by narrow page width. Measure 1 = G clef, measure 5 = F clef.
    // The F clef should appear as a courtesy (2/3 size) at the end of system 1.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {},
            {},
            {},
            {}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            },
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}]}]},
            {
                "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    // Narrow page to force a system break before measure 5
    let config = LayoutConfig {
        page_width: Some(130.0),
        page_margin_left: 0.0,
        page_margin_right: 0.0,
        ..Default::default()
    };

    let dl = layout_score(&score, 0, &config);
    let change_size = 4.0 * config.sp * 2.0 / 3.0;

    // Count all F clef renderings at change-clef size (2/3)
    let courtesy_f_clefs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, codepoint, size, ..
            } = cmd
            {
                if *codepoint == smufl::F_CLEF && (*size - change_size).abs() < 0.01 {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    // Should have at least 1 courtesy clef (at end of system 1)
    assert!(
        !courtesy_f_clefs.is_empty(),
        "expected a courtesy F clef at 2/3 size at the end of a system, found none"
    );

    // The full-size F clef should also exist (at start of system 2)
    let full_f_clefs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, codepoint, size, ..
            } = cmd
            {
                if *codepoint == smufl::F_CLEF && (*size - 4.0 * config.sp).abs() < 0.01 {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert!(
        !full_f_clefs.is_empty(),
        "expected a full-size F clef at the start of system 2"
    );

    // Both courtesy (end of system 1) and full-size (start of system 2) should exist.
    // The courtesy clef is at the right edge of system 1 (high x),
    // and the full-size clef is at the left edge of system 2 (low x).
    // Just verify both exist — x comparison is not meaningful across systems.
}

#[test]
fn test_start_of_measure_clef_before_barline() {
    // Two measures on the same system. Clef change at start of measure 2
    // should be rendered BEFORE the barline (lower x position).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            },
            {
                "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let change_size = 4.0 * config.sp * 2.0 / 3.0;

    // Find the change-size F clef position
    let change_f_x: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, codepoint, size, ..
            } = cmd
            {
                if *codepoint == smufl::F_CLEF && (*size - change_size).abs() < 0.01 {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert_eq!(change_f_x.len(), 1, "expected 1 change-size F clef");

    // Find barline positions (thin vertical lines at measure boundaries)
    let barline_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = cmd {
                // Barlines are vertical lines (same x, different y)
                if (x1 - x2).abs() < 0.01 && (y2 - y1).abs() > 1.0 {
                    return Some(*x1);
                }
            }
            None
        })
        .collect();
    // There should be at least one mid-score barline
    assert!(!barline_xs.is_empty(), "expected barlines in the output");

    // Find the barline closest to the change clef (should be the one right after it)
    let nearest_barline = barline_xs
        .iter()
        .filter(|&&bx| bx > change_f_x[0])
        .copied()
        .reduce(f64::min);
    assert!(
        nearest_barline.is_some(),
        "expected a barline after the change clef"
    );
    assert!(change_f_x[0] < nearest_barline.unwrap(),
        "change clef at start of measure should appear before the barline (clef x={}, barline x={})",
        change_f_x[0], nearest_barline.unwrap());
}

/// A key change to an open/atonal signature must show naturals cancelling the
/// previous key (standard engraving practice). Measure 1 is D major (2 sharps),
/// measure 2 changes to an atonal/open key — the change must render two naturals
/// and no leftover sharps, and reserve space for them so they don't collide.
#[test]
fn test_atonal_key_change_shows_cancellation_naturals() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}},
            {"key": {"fifths": 0, "_x": {"viritura": {"atonal": true}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
             ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
             ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // The atonal measure must resolve to fifths 0 with the previous key tracked.
    let resolved = resolve_measures(&score, 0);
    assert_eq!(resolved[1].active_key.fifths, 0);
    assert_eq!(resolved[1].prev_key.fifths, 2);
    assert_eq!(
        resolved[1]
            .prev_key
            .cancellation_count(&resolved[1].active_key),
        2
    );

    // Collect key-signature glyphs (naturals + any sharps) with their x.
    let naturals: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::ACCIDENTAL_NATURAL =>
            {
                Some(*x)
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        naturals.len(),
        2,
        "atonal key change should render two cancellation naturals, got {}",
        naturals.len()
    );

    // The naturals must sit left of the atonal measure's note (inside the
    // reserved prefix), not overlapping the notehead.
    let rightmost_natural = naturals.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let next_notehead_x = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_WHOLE && *x > rightmost_natural =>
            {
                Some(*x)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    assert!(
        next_notehead_x.is_finite(),
        "expected a notehead after the cancellation naturals"
    );
    assert!(
        rightmost_natural + 1.0 * config.sp < next_notehead_x,
        "cancellation naturals (max x={rightmost_natural:.1}) must clear the next notehead (x={next_notehead_x:.1})"
    );
}

/// An open/atonal key signature shows no accidentals, even when it carries a
/// non-zero `fifths` value (e.g. a transposed key written by a transposing-
/// instrument pipeline). The change must cancel the whole previous signature
/// with naturals and must NOT re-draw the transposed key afterwards.
#[test]
fn test_atonal_key_with_residual_fifths_renders_no_accidentals() {
    // Measure 1: D major (2 sharps). Measure 2: open/atonal but with a leftover
    // fifths value of 2 on the key — it must still display as fully open.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}},
            {"key": {"fifths": 2, "_x": {"viritura": {"atonal": true}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
             ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
             ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();

    // The atonal key reports zero accidentals despite its residual fifths, and a
    // full cancellation of the outgoing two-sharp signature.
    let resolved = resolve_measures(&score, 0);
    assert_eq!(resolved[1].active_key.accidental_count(), 0);
    assert_eq!(
        resolved[1]
            .prev_key
            .cancellation_count(&resolved[1].active_key),
        2
    );

    let dl = layout_score(&score, 0, &config);
    let naturals = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::ACCIDENTAL_NATURAL)
        })
        .count();
    // Measure 1 draws two sharps for its key signature; the atonal measure must
    // add none on top of its cancellation naturals.
    let sharps = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::ACCIDENTAL_SHARP)
        })
        .count();
    assert_eq!(naturals, 2, "atonal change should cancel both sharps");
    assert_eq!(
        sharps, 2,
        "only measure 1's two sharps should appear; the atonal measure must not re-add the key"
    );
}

// ── Time signature styles (`_x.viritura.timeSignatures`) ──────────────────
//
// Each style changes where the meter is engraved and how much room it takes,
// so the tests below assert the engraving rule rather than exact pixels:
// where the ink sits relative to the staff, which Bravura cut it uses, and
// whether the staff reserves room for it at all.

use crate::layout::time_signatures::{prefix_reserve, time_signature_layout};
use crate::model::time::{
    LayoutContext, TimeSignatureDistribution, TimeSignaturePosition, TimeSignatureRenderStyle,
    TimeSignatureSettings, TimeSignatureStyles,
};

/// A one-part score in 4/4 with four quarters, optionally carrying a
/// document-level time signature style.
fn styled_score_json(style: Option<&str>) -> String {
    let ext = match style {
        Some(style) => {
            format!(r#", "_x": {{"viritura": {{"timeSignatures": {{"score": "{style}"}}}}}}"#)
        }
        None => String::new(),
    };
    format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}, {{}}]}},
            "parts": [{{"measures": [
                {{
                    "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                    "sequences": [{{"content": [
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "C", "octave": 5}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "D", "octave": 5}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "E", "octave": 5}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "F", "octave": 5}}}}]}}
                    ]}}]
                }},
                {{
                    "sequences": [{{"content": [
                        {{"duration": {{"base": "whole"}}, "notes": [{{"pitch": {{"step": "C", "octave": 5}}}}]}}
                    ]}}]
                }}
            ]}}]{ext}
        }}"#
    )
}

/// Every glyph drawn in a codepoint range, as `(x, y, codepoint, size)`.
fn glyphs_in_range(
    dl: &DisplayList,
    range: std::ops::RangeInclusive<u32>,
) -> Vec<(f64, f64, u32, f64)> {
    dl.commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } if range.contains(codepoint) => Some((*x, *y, *codepoint, *size)),
            _ => None,
        })
        .collect()
}

fn layout_styled(style: Option<&str>) -> (DisplayList, LayoutConfig) {
    let score = parse_mnx(&styled_score_json(style)).expect("fixture parses");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    (dl, config)
}

/// Y of the first system's top staff line, read back from the rendered staff
/// lines so the assertions below are independent of page margins.
fn top_staff_y(dl: &DisplayList) -> f64 {
    dl.commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { y1, y2, .. } if (y1 - y2).abs() < 1e-6 => Some(*y1),
            _ => None,
        })
        .fold(f64::INFINITY, f64::min)
}

#[test]
fn normal_style_sets_the_meter_inside_the_staff() {
    let (dl, config) = layout_styled(None);
    let sp = config.sp;
    let staff_y = top_staff_y(&dl);
    let digits = glyphs_in_range(&dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9);
    assert_eq!(digits.len(), 2, "4/4 engraves two digits");
    // Numerator centred on the upper half, denominator on the lower half.
    assert!(
        (digits[0].1 - (staff_y + sp)).abs() < 0.01,
        "numerator sits one space below the top line"
    );
    assert!(
        (digits[1].1 - (staff_y + 3.0 * sp)).abs() < 0.01,
        "denominator sits three spaces below"
    );
    assert!((digits[0].3 - 4.0 * sp).abs() < 0.01, "drawn at staff size");
}

#[test]
fn large_style_overflows_the_staff_and_reserves_more_room() {
    let (dl, config) = layout_styled(Some("large"));
    let sp = config.sp;
    let digits = glyphs_in_range(&dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9);
    assert_eq!(digits.len(), 2, "a large meter still engraves two digits");
    assert!(
        digits[0].3 > 4.0 * sp,
        "large digits are drawn bigger than staff size, got {}",
        digits[0].3
    );

    let ts = TimeSignature {
        count: 4,
        unit: 4,
        display: None,
    };
    let large = TimeSignatureSettings {
        scale: 1.5,
        ..TimeSignatureSettings::default()
    };
    let layout = time_signature_layout(large, &ts, 0.0, 0.0, 4.0 * sp, sp);
    assert!(
        layout.top_y < 0.0,
        "the pair reaches above the top staff line"
    );
    assert!(
        layout.bottom_y > 4.0 * sp,
        "and below the bottom staff line"
    );
    assert!(
        prefix_reserve(large, &ts, sp) > prefix_reserve(TimeSignatureSettings::default(), &ts, sp),
        "a large meter reserves more horizontal room than a normal one"
    );
}

#[test]
fn narrow_style_uses_the_condensed_cut_and_reserves_less_room() {
    let (dl, config) = layout_styled(Some("narrow"));
    let sp = config.sp;
    assert!(
        glyphs_in_range(&dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9).is_empty(),
        "the regular cut is not used"
    );
    let digits = glyphs_in_range(&dl, smufl::TIME_SIG_NARROW_0..=smufl::TIME_SIG_NARROW_9);
    assert_eq!(digits.len(), 2, "4/4 engraves two condensed digits");

    let ts = TimeSignature {
        count: 4,
        unit: 4,
        display: None,
    };
    assert!(
        prefix_reserve(
            TimeSignatureSettings {
                render_style: TimeSignatureRenderStyle::Narrow,
                ..TimeSignatureSettings::default()
            },
            &ts,
            sp,
        ) < prefix_reserve(TimeSignatureSettings::default(), &ts, sp),
        "condensed digits are what buys the horizontal room back"
    );
}

#[test]
fn above_staff_style_engraves_over_the_staff_and_reserves_no_slot() {
    let (dl, config) = layout_styled(Some("aboveStaff"));
    let sp = config.sp;
    let staff_y = top_staff_y(&dl);
    let digits = glyphs_in_range(&dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9);
    assert_eq!(digits.len(), 2, "the meter is still a stacked pair");
    for (_x, y, _cp, size) in &digits {
        assert!(
            *y + size / 4.0 < staff_y,
            "every digit's ink clears the top staff line, got y={y}"
        );
    }
    let ts = TimeSignature {
        count: 4,
        unit: 4,
        display: None,
    };
    assert_eq!(
        prefix_reserve(
            TimeSignatureSettings {
                position: TimeSignaturePosition::Above,
                ..TimeSignatureSettings::default()
            },
            &ts,
            sp,
        ),
        0.0,
        "an above-staff meter takes no room inside the staff"
    );
}

#[test]
fn scale_and_vertical_position_are_independent_of_render_style() {
    let sp = LayoutConfig::default().sp;
    let ts = TimeSignature {
        count: 12,
        unit: 8,
        display: None,
    };
    let settings = TimeSignatureSettings {
        render_style: TimeSignatureRenderStyle::Narrow,
        position: TimeSignaturePosition::Bottom,
        scale: 1.7,
        ..TimeSignatureSettings::default()
    };
    let layout = time_signature_layout(settings, &ts, 0.0, 10.0, 10.0 + 4.0 * sp, sp);

    assert!(layout.glyphs.iter().all(|glyph| (smufl::TIME_SIG_NARROW_0
        ..=smufl::TIME_SIG_NARROW_9)
        .contains(&glyph.codepoint)));
    assert!(layout
        .glyphs
        .iter()
        .all(|glyph| (glyph.size - 4.0 * sp * 1.7).abs() < 0.01));
    assert!(
        (layout.bottom_y - (10.0 + 4.0 * sp)).abs() < 0.01,
        "bottom alignment uses final ink bounds"
    );
}

#[test]
fn outside_staff_render_style_is_independent_of_distribution_and_scale() {
    let sp = LayoutConfig::default().sp;
    let ts = TimeSignature {
        count: 12,
        unit: 8,
        display: None,
    };
    let settings = TimeSignatureSettings {
        render_style: TimeSignatureRenderStyle::OutsideStaff,
        distribution: TimeSignatureDistribution::PerStaff,
        scale: 1.3,
        ..TimeSignatureSettings::default()
    };
    let layout = time_signature_layout(settings, &ts, 0.0, 0.0, 4.0 * sp, sp);

    assert!(layout.glyphs.iter().all(|glyph| {
        (smufl::TIME_SIG_LARGE_0..=smufl::TIME_SIG_LARGE_9).contains(&glyph.codepoint)
    }));
    assert!(layout
        .glyphs
        .iter()
        .all(|glyph| (glyph.size - 4.0 * sp * 1.3).abs() < 0.01));
}

#[test]
fn object_configuration_parses_distribution_independently() {
    let settings: TimeSignatureSettings = serde_json::from_value(serde_json::json!({
        "renderStyle": "singleNumber",
        "distribution": "perGroup",
        "grandStaff": "exclude",
        "position": "top",
        "scale": 1.3
    }))
    .expect("settings object parses");
    assert_eq!(
        settings.render_style,
        TimeSignatureRenderStyle::SingleNumber
    );
    assert_eq!(settings.distribution, TimeSignatureDistribution::PerGroup);
    assert_eq!(
        settings.grand_staff,
        crate::model::time::TimeSignatureGrandStaff::Exclude
    );
    assert_eq!(settings.position, TimeSignaturePosition::Top);
    assert_eq!(settings.scale, 1.3);
}

#[test]
fn time_signature_scale_clamps_at_film_score_maximum() {
    let settings: TimeSignatureSettings = serde_json::from_value(serde_json::json!({
        "renderStyle": "outsideStaff",
        "scale": 99
    }))
    .expect("settings object parses");
    assert_eq!(settings.scale, crate::model::time::TIME_SIGNATURE_SCALE_MAX);
}

#[test]
fn single_number_style_engraves_only_the_beat_count() {
    let (dl, config) = layout_styled(Some("singleNumber"));
    let sp = config.sp;
    let staff_y = top_staff_y(&dl);
    let digits = glyphs_in_range(&dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9);
    assert_eq!(digits.len(), 1, "the count is engraved alone");
    assert_eq!(digits[0].2, smufl::TIME_SIG_4, "the count is 4");
    assert!(
        (digits[0].1 - (staff_y + 2.0 * sp)).abs() < 0.01,
        "a single number is centred on the middle staff line"
    );
    assert!(
        (digits[0].3 - 8.0 * sp).abs() < 0.01,
        "legacy preset preserves its former 2x scale"
    );
}

#[test]
fn note_value_style_replaces_the_denominator_with_its_note() {
    let (dl, _config) = layout_styled(Some("noteValue"));
    let digits = glyphs_in_range(&dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9);
    assert_eq!(digits.len(), 1, "only the beat count is set as a digit");
    let notes = glyphs_in_range(&dl, smufl::MET_NOTE_QUARTER_UP..=smufl::MET_NOTE_QUARTER_UP);
    assert_eq!(notes.len(), 1, "the denominator is drawn as a quarter note");
}

#[test]
fn legacy_spanning_preset_restores_outside_staff_digits() {
    let (dl, config) = layout_styled(Some("spanning"));
    let sp = config.sp;
    let staff_y = top_staff_y(&dl);
    assert!(
        glyphs_in_range(&dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9).is_empty(),
        "legacy spanning must not fall back to regular digits"
    );
    let digits = glyphs_in_range(&dl, smufl::TIME_SIG_LARGE_0..=smufl::TIME_SIG_LARGE_9);
    assert_eq!(digits.len(), 2, "the group meter is a stacked pair");
    assert!((digits[0].3 - 8.0 * sp).abs() < 0.01);
    let middle = staff_y + 2.0 * sp;
    let (top, bottom) = (
        digits.iter().map(|g| g.1).fold(f64::INFINITY, f64::min),
        digits.iter().map(|g| g.1).fold(f64::NEG_INFINITY, f64::max),
    );
    assert!(
        top < middle && bottom > middle,
        "the pair straddles the middle of the staff it spans"
    );
}

#[test]
fn score_and_parts_styles_are_resolved_independently() {
    let styles = TimeSignatureStyles {
        score: Some(TimeSignatureSettings {
            scale: 1.5,
            ..TimeSignatureSettings::default()
        }),
        parts: Some(TimeSignatureSettings::default()),
    };
    assert_eq!(styles.resolve(LayoutContext::Score).scale, 1.5);
    assert_eq!(
        styles.resolve(LayoutContext::Part),
        TimeSignatureSettings::default()
    );
    assert_eq!(
        TimeSignatureStyles::default().resolve(LayoutContext::Score),
        TimeSignatureSettings::default(),
        "a document that says nothing engraves normal meters"
    );
}

#[test]
fn a_part_score_definition_reads_the_parts_style() {
    // Two score definitions over the same two parts: index 0 is the full
    // score, index 1 draws one part — the shape the editor's "add part" flow
    // produces. The document asks for large meters in the score and ordinary
    // ones in the parts.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"id": "p1", "name": "Flute", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]
            }]},
            {"id": "p2", "name": "Oboe", "measures": [{
                "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]
            }]}
        ],
        "layouts": [
            {"id": "L-full", "content": [
                {"type": "staff", "sources": [{"part": "p1"}]},
                {"type": "staff", "sources": [{"part": "p2"}]}
            ]},
            {"id": "L-p1", "content": [{"type": "staff", "sources": [{"part": "p1"}]}]}
        ],
        "scores": [
            {"name": "Full Score", "layout": "L-full"},
            {"name": "Flute", "layout": "L-p1"}
        ],
        "_x": {"viritura": {"timeSignatures": {"score": "large", "parts": "normal"}}}
    }"#;

    let score = parse_mnx(json).expect("fixture parses");
    let config = LayoutConfig::default();
    let sp = config.sp;

    let score_dl = crate::layout::layout_with_mnx_scores(&score, &config, 0);
    let part_dl = crate::layout::layout_with_mnx_scores(&score, &config, 1);

    let score_digits = glyphs_in_range(&score_dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9);
    let part_digits = glyphs_in_range(&part_dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9);
    assert!(
        !score_digits.is_empty() && !part_digits.is_empty(),
        "both layouts engrave the meter"
    );
    assert!(
        score_digits[0].3 > 4.0 * sp,
        "the conductor's score gets the large meter"
    );
    assert!(
        (part_digits[0].3 - 4.0 * sp).abs() < 0.01,
        "the player's part gets an ordinary staff-size meter"
    );
}

#[test]
fn per_group_distribution_draws_one_meter_for_a_bracket_group() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"id": "p1", "name": "Flute", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]
            }]},
            {"id": "p2", "name": "Oboe", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}]}]
            }]}
        ],
        "layouts": [{"id": "L", "content": [{
            "type": "group", "symbol": "bracket", "content": [
                {"type": "staff", "sources": [{"part": "p1"}]},
                {"type": "staff", "sources": [{"part": "p2"}]}
            ]
        }]}],
        "scores": [{"name": "Full Score", "layout": "L"}],
        "_x": {"viritura": {"timeSignatures": {"score": {
            "distribution": "perGroup",
            "position": "top",
            "scale": 1.25
        }}}}
    }"#;
    let score = parse_mnx(json).expect("fixture parses");
    let dl = crate::layout::layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
    let digits = glyphs_in_range(&dl, smufl::TIME_SIG_0..=smufl::TIME_SIG_9);

    assert_eq!(
        digits.len(),
        2,
        "one 4/4 meter is shared by the two-staff bracket group"
    );
    assert!(digits.iter().all(|digit| (digit.3 - 60.0).abs() < 0.01));
}

// Auto-generated from tests.rs — test_ties
// 17 test(s)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::{layout_full_score, layout_score, layout_with_mnx_scores};
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl::{self, NOTEHEAD_WHOLE};
use crate::render::*;

#[test]
fn test_tie_within_measure_produces_bezier() {
    // Two half notes tied together within one measure
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 12, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"id": "n1", "pitch": {"step": "E", "octave": 4}, "ties": [{"target": "n2"}]}]},
                {"duration": {"base": "half"}, "notes": [{"id": "n2", "pitch": {"step": "E", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let bezier_count = dl.commands.iter().filter(|c| is_draw_bezier(c)).count();
    assert_eq!(
        bezier_count, 1,
        "Expected 1 DrawBezier for tie, got {}",
        bezier_count
    );
}

#[test]
fn test_rhapsody_piano_cluster_ties_have_readable_span_and_level_endpoints() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: None,
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let pairs = [
        (
            "019e8ea7-4e31-7d61-ac08-5c745e60a209",
            "019e8ea7-4d51-7859-a207-1d6c0f84e67a",
        ),
        (
            "019e8ea7-4e31-77ab-baf7-62c059942d18",
            "019e8ea7-4d51-70aa-b590-cb0d15b334a0",
        ),
        (
            "019e8ea7-4e31-7bcf-8276-f27a89879f64",
            "019e8ea7-4d51-77c2-82d9-3e1e21f07655",
        ),
    ];

    for (source, target) in pairs {
        let tie_id = format!("tie/{source}/{target}");
        let (x1, y1, x2, y2) = dl
            .commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| {
                let tagged =
                    dl.element_ids.get(index).and_then(|id| id.as_deref()) == Some(&tie_id);
                match command {
                    RenderCommand::DrawFilledBezier { x1, y1, x2, y2, .. } if tagged => {
                        Some((*x1, *y1, *x2, *y2))
                    }
                    _ => None,
                }
            })
            .unwrap_or_else(|| panic!("missing clustered tie {tie_id}"));
        let span_sp = (x2 - x1).abs() / config.sp;
        assert!(
            span_sp >= 1.5,
            "clustered tie {tie_id} needs at least 1.5sp of horizontal run, got {span_sp:.3}sp"
        );
        assert!(
            (y2 - y1).abs() < 0.01 * config.sp,
            "same-pitch clustered tie {tie_id} endpoints must be level: y1={y1:.2}, y2={y2:.2}"
        );
    }
}

#[test]
fn aligned_prefix_growth_preserves_horizon_tie_spacing() {
    let upper_part = r#"{"measures":[{
        "clefs":[{"clef":{"sign":"G","staffPosition":-2}}],
        "sequences":[{"content":[
            {"duration":{"base":"quarter"},"notes":[{"id":"prefix-tie-source","pitch":{"step":"C","octave":5},"ties":[{"target":"prefix-tie-target"}]}]},
            {"duration":{"base":"quarter"},"notes":[{"id":"prefix-tie-target","pitch":{"step":"C","octave":5}}]},
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":5}}]},
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":5}}]}
        ]}]
    }]}"#;
    let lower_part = r#"{"measures":[{
        "clefs":[{"clef":{"sign":"C","staffPosition":0}}],
        "sequences":[{"content":[
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":3,"alter":-2},"accidentalDisplay":{"show":true,"force":true}}]},
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":3}}]},
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":3}}]},
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":3}}]}
        ]}]
    }]}"#;
    let make_score = |parts: &str| {
        parse_mnx(&format!(
            r#"{{
                "mnx":{{"version":1}},
                "support":{{"useAccidentalDisplay":true}},
                "global":{{"measures":[{{"time":{{"count":4,"unit":4}}}}]}},
                "parts":[{parts}]
            }}"#
        ))
        .unwrap()
    };
    let tie_span = |display: &DisplayList| {
        let tie_id = "tie/prefix-tie-source/prefix-tie-target";
        display
            .commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| {
                let tagged =
                    display.element_ids.get(index).and_then(|id| id.as_deref()) == Some(tie_id);
                match command {
                    RenderCommand::DrawFilledBezier { x1, x2, .. } if tagged => {
                        Some((x2 - x1).abs())
                    }
                    _ => None,
                }
            })
            .expect("upper-staff tie should render")
    };
    let config = LayoutConfig {
        page_width: None,
        ..LayoutConfig::default()
    };
    let upper_only = layout_full_score(&make_score(upper_part), &config);
    let aligned = layout_full_score(&make_score(&format!("{upper_part},{lower_part}")), &config);
    let upper_only_span = tie_span(&upper_only);
    let aligned_span = tie_span(&aligned);

    assert!(
        aligned_span + 0.01 >= upper_only_span,
        "aligned prefix growth must not consume rhythmic tie spacing: upper-only={:.3}sp, aligned={:.3}sp",
        upper_only_span / config.sp,
        aligned_span / config.sp,
    );
}

#[test]
fn test_tie_across_measures_produces_bezier() {
    // Quarter note tied across a barline
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {"barline": {"type": "regular"}}]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "half"}, "notes": [{"id": "t1", "pitch": {"step": "G", "octave": 4}, "ties": [{"target": "t2"}]}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"id": "t2", "pitch": {"step": "G", "octave": 4}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}
            ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let bezier_count = dl.commands.iter().filter(|c| is_draw_bezier(c)).count();
    assert_eq!(
        bezier_count, 1,
        "Expected 1 DrawBezier for cross-measure tie, got {}",
        bezier_count
    );
}

#[test]
fn test_ties_mnx_file_produces_beziers() {
    // Load the ties.mnx test score file:
    // Measure 1: C5, E5 (tied→E5), E5, C5 (tied→across barline)
    // Measure 2: C5 (target, tied→C5), C5 (target)
    // Expects 3 DrawBezier commands for the 3 tie pairs
    let json = include_str!("../../../../../packages/format/fixtures/mnx/ties.mnx");

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let bezier_count = dl.commands.iter().filter(|c| is_draw_bezier(c)).count();
    assert_eq!(
        bezier_count, 3,
        "Expected 3 DrawBezier for ties.mnx (E5→E5, C5→C5 cross-bar, C5→C5), got {}",
        bezier_count
    );
}

#[test]
fn test_chained_tie_tips_leave_space_at_shared_note() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"id": "chain1", "pitch": {"step": "G", "octave": 4}, "ties": [{"target": "chain2"}]}]},
                {"duration": {"base": "whole"}, "notes": [{"id": "chain2", "pitch": {"step": "G", "octave": 4}, "ties": [{"target": "chain3"}]}]},
                {"duration": {"base": "whole"}, "notes": [{"id": "chain3", "pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let endpoint = |id: &str, source: bool| {
        dl.commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| {
                dl.element_ids
                    .get(index)
                    .and_then(Option::as_ref)
                    .is_some_and(|element_id| element_id == id)
                    .then(|| {
                        let (x1, x2) = bezier_endpoints_x(command);
                        if source {
                            x1
                        } else {
                            x2
                        }
                    })
            })
            .expect("chained tie")
    };

    let incoming_tip = endpoint("tie/chain1/chain2", false);
    let outgoing_tip = endpoint("tie/chain2/chain3", true);
    let mut notehead_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                codepoint: NOTEHEAD_WHOLE,
                ..
            } => Some(*x),
            _ => None,
        })
        .collect();
    notehead_xs.sort_by(f64::total_cmp);
    let shared_notehead_center =
        notehead_xs[1] + smufl::notehead_width(NOTEHEAD_WHOLE) * config.sp * 0.5;
    let gap_center = (incoming_tip + outgoing_tip) * 0.5;
    assert!(
        ((outgoing_tip - incoming_tip) - 0.4 * config.sp).abs() < 0.01,
        "chained tie tip gap must be 0.4sp: incoming={incoming_tip:.3}, outgoing={outgoing_tip:.3}"
    );
    assert!(
        (gap_center - shared_notehead_center).abs() < 0.01,
        "chained tie gap must center on the notehead: gap={gap_center:.3}, notehead={shared_notehead_center:.3}"
    );
}

#[test]
fn test_tie_stem_up_curves_below() {
    // Tied G4 notes — below middle line → stem up → tie curves below (positive y direction)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"id": "su1", "pitch": {"step": "G", "octave": 4}, "ties": [{"target": "su2"}]}]},
                {"duration": {"base": "half"}, "notes": [{"id": "su2", "pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Verify exactly 1 DrawBezier for the tie
    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        1,
        "Expected 1 DrawBezier for stem-up tie, got {}",
        beziers.len()
    );

    // Control points should be below endpoints (ocy > y) since stem up → curve below
    if let RenderCommand::DrawFilledBezier {
        y1, ocy1, y2, ocy2, ..
    } = beziers[0]
    {
        assert!(
            *ocy1 > *y1,
            "Stem-up tie: outer control point ocy1 ({}) should be below y1 ({})",
            ocy1,
            y1
        );
        assert!(
            *ocy2 > *y2,
            "Stem-up tie: outer control point ocy2 ({}) should be below y2 ({})",
            ocy2,
            y2
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_tie_stem_down_curves_above() {
    // Tied E5 notes — above middle line → stem down → tie curves above (negative y direction)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"id": "sd1", "pitch": {"step": "E", "octave": 5}, "ties": [{"target": "sd2"}]}]},
                {"duration": {"base": "half"}, "notes": [{"id": "sd2", "pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Verify exactly 1 DrawBezier for the tie
    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        1,
        "Expected 1 DrawBezier for stem-down tie, got {}",
        beziers.len()
    );

    // Control points should be above endpoints (ocy < y) since stem down → curve above
    if let RenderCommand::DrawFilledBezier {
        y1, ocy1, y2, ocy2, ..
    } = beziers[0]
    {
        assert!(
            *ocy1 < *y1,
            "Stem-down tie: outer control point ocy1 ({}) should be above y1 ({})",
            ocy1,
            y1
        );
        assert!(
            *ocy2 < *y2,
            "Stem-down tie: outer control point ocy2 ({}) should be above y2 ({})",
            ocy2,
            y2
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_stem_side_tie_stays_inside_up_stems() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "stemDirection": "up", "notes": [{"id": "u1", "pitch": {"step": "C", "octave": 5}, "ties": [{"target": "u2", "side": "up"}]}]},
                {"duration": {"base": "half"}, "stemDirection": "up", "notes": [{"id": "u2", "pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let tie = dl
        .commands
        .iter()
        .find(|command| matches!(command, RenderCommand::DrawFilledBezier { .. }))
        .expect("stem-side tie");
    let (tie_x1, tie_x2) = bezier_endpoints_x(tie);
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
            } if (x1 - x2).abs() < 1.0e-6
                && (y1 - y2).abs() > config.sp
                && (*width - config.stem_width * config.sp).abs() < 1.0e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .collect();
    stem_xs.sort_by(f64::total_cmp);

    assert_eq!(stem_xs.len(), 2);
    assert!(
        tie_x1 > stem_xs[0],
        "source tie tip must sit right of source stem"
    );
    assert!(
        tie_x2 < stem_xs[1],
        "target tie tip must sit left of target stem"
    );
}

#[test]
fn test_stem_side_tie_mirrors_for_down_stems() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "stemDirection": "down", "notes": [{"id": "d1", "pitch": {"step": "E", "octave": 5}, "ties": [{"target": "d2", "side": "down"}]}]},
                {"duration": {"base": "half"}, "stemDirection": "down", "notes": [{"id": "d2", "pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let tie = dl
        .commands
        .iter()
        .find(|command| matches!(command, RenderCommand::DrawFilledBezier { .. }))
        .expect("mirrored stem-side tie");
    let (tie_x1, tie_x2) = bezier_endpoints_x(tie);
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
            } if (x1 - x2).abs() < 1.0e-6
                && (y1 - y2).abs() > config.sp
                && (*width - config.stem_width * config.sp).abs() < 1.0e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .collect();
    stem_xs.sort_by(f64::total_cmp);

    assert_eq!(stem_xs.len(), 2);
    assert!(
        tie_x1 > stem_xs[0],
        "mirrored source tip must sit right of source stem"
    );
    assert!(
        tie_x2 < stem_xs[1],
        "mirrored target tip must sit left of target stem"
    );
}

#[test]
fn test_inner_chord_tie_does_not_cross_source_stem_line() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "cs1", "duration": {"base": "half"}, "stemDirection": "up",
                 "notes": [
                    {"id": "cs1a", "pitch": {"step": "E", "octave": 5}},
                    {"id": "cs1m", "pitch": {"step": "D", "octave": 5}, "ties": [{"target": "cs2m"}]},
                    {"id": "cs1b", "pitch": {"step": "C", "octave": 5}}
                 ]},
                {"id": "cs2", "duration": {"base": "half"}, "stemDirection": "up",
                 "notes": [
                    {"id": "cs2a", "pitch": {"step": "E", "octave": 5}},
                    {"id": "cs2m", "pitch": {"step": "D", "octave": 5}},
                    {"id": "cs2b", "pitch": {"step": "C", "octave": 5}}
                 ]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let tie = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            dl.element_ids
                .get(index)
                .and_then(Option::as_ref)
                .is_some_and(|id| id == "tie/cs1m/cs2m")
                .then_some(command)
        })
        .expect("middle chord tie");
    let tie_x1 = bezier_endpoints_x(tie).0;
    let source_stem_x = dl
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
            } if (x1 - x2).abs() < 1.0e-6
                && (y1 - y2).abs() > config.sp
                && (*width - config.stem_width * config.sp).abs() < 1.0e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .min_by(f64::total_cmp)
        .expect("source stem");
    assert!(
        tie_x1 >= source_stem_x,
        "inner tie source x={tie_x1:.3} must not cross leftward past stem x={source_stem_x:.3}"
    );
}

#[test]
fn test_inner_chord_tie_does_not_cross_target_stem_line() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ct1", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [
                    {"id": "ct1a", "pitch": {"step": "E", "octave": 5}},
                    {"id": "ct1m", "pitch": {"step": "D", "octave": 5}, "ties": [{"target": "ct2m"}]},
                    {"id": "ct1b", "pitch": {"step": "C", "octave": 5}}
                 ]},
                {"id": "ct2", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [
                    {"id": "ct2a", "pitch": {"step": "E", "octave": 5}},
                    {"id": "ct2m", "pitch": {"step": "D", "octave": 5}},
                    {"id": "ct2b", "pitch": {"step": "C", "octave": 5}}
                 ]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let tie = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            dl.element_ids
                .get(index)
                .and_then(Option::as_ref)
                .is_some_and(|id| id == "tie/ct1m/ct2m")
                .then_some(command)
        })
        .expect("middle chord tie");
    let tie_x2 = bezier_endpoints_x(tie).1;
    let target_stem_x = dl
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
            } if (x1 - x2).abs() < 1.0e-6
                && (y1 - y2).abs() > config.sp
                && (*width - config.stem_width * config.sp).abs() < 1.0e-6 =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .max_by(f64::total_cmp)
        .expect("target stem");
    assert!(
        tie_x2 <= target_stem_x,
        "inner tie target x={tie_x2:.3} must not cross rightward past stem x={target_stem_x:.3}"
    );
}

#[test]
fn test_multi_voice_ties_follow_stems() {
    // Two voices in one measure. Standard engraving practice for multi-voice
    // writing: ties follow their voice's stem direction (the opposite of the
    // single-voice stem-opposite rule) so the upper voice's ties arch up and
    // the lower voice's arch down, keeping the voices visually distinct.
    //
    // Upper voice (voice 0) → stem up → tie curves above (ocy < y).
    // Lower voice (voice 1) → stem down → tie curves below (ocy > y).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"duration": {"base": "half"}, "notes": [{"id": "up1", "pitch": {"step": "G", "octave": 5}, "ties": [{"target": "up2"}]}]},
                    {"duration": {"base": "half"}, "notes": [{"id": "up2", "pitch": {"step": "G", "octave": 5}}]}
                ]},
                {"content": [
                    {"duration": {"base": "half"}, "notes": [{"id": "lo1", "pitch": {"step": "D", "octave": 4}, "ties": [{"target": "lo2"}]}]},
                    {"duration": {"base": "half"}, "notes": [{"id": "lo2", "pitch": {"step": "D", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        2,
        "Expected 2 DrawBezier (one per voice), got {}",
        beziers.len()
    );

    // The two ties sit at very different heights; the higher one (smaller y) is
    // the upper voice, the lower one (larger y) is the lower voice.
    let mut by_height: Vec<(f64, f64)> = beziers
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawFilledBezier { y1, ocy1, .. } => Some((*y1, *ocy1)),
            _ => None,
        })
        .collect();
    by_height.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    let (upper_y, upper_ocy) = by_height[0];
    let (lower_y, lower_ocy) = by_height[1];

    assert!(
        upper_ocy < upper_y,
        "Upper voice tie should curve above (ocy {} < y {})",
        upper_ocy,
        upper_y
    );
    assert!(
        lower_ocy > lower_y,
        "Lower voice tie should curve below (ocy {} > y {})",
        lower_ocy,
        lower_y
    );
}

#[test]
fn test_tie_targets_mnx_file_produces_beziers() {
    // Load tie-targets.mnx: advanced tie targeting with crossVoice, nextNote,
    // arpeggio, crossJump, side overrides, and laissez vibrer (lv) ties.
    // The file contains 5 measures and multiple voices.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/tie-targets.mnx");

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Count all bezier curves (ties). The file has 9 ties:
    //   ev21→ev26 (crossVoice), ev24→ev25 (nextNote, cross-measure),
    //   ev33→ev36n1 (arpeggio), ev33→ev38n1 (crossJump → incoming),
    //   ev34→ev36n2 (arpeggio), ev34→ev38n2 (crossJump → incoming),
    //   ev35→ev36n3 (nextNote), ev35→ev38n3 (crossJump → incoming),
    //   ev41 lv tie (laissez vibrer)
    let bezier_count = dl.commands.iter().filter(|c| is_draw_bezier(c)).count();
    assert_eq!(
        bezier_count, 9,
        "Expected 9 DrawBezier for tie-targets.mnx (5 regular + 3 incoming + 1 lv), got {}",
        bezier_count
    );
}

#[test]
fn test_tie_cross_repeat_incoming_starts_at_measure_edge() {
    // A tie from before a repeat barline into ending 2 should produce
    // an incoming partial tie that starts near the target measure's left
    // edge, NOT from the source note's x position.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"ending": {"duration": 1, "numbers": [1], "open": false}, "repeatEnd": {}},
            {"ending": {"duration": 1, "numbers": [2], "open": true}}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"id": "src", "duration": {"base": "whole"}, "notes": [
                        {"id": "srcN", "pitch": {"step": "C", "octave": 5},
                         "ties": [
                            {"target": "e1N", "targetType": "nextNote"},
                            {"target": "e2N", "targetType": "crossJump"}
                         ]}
                    ]}
                ]}]
            },
            {
                "sequences": [{"content": [
                    {"id": "e1", "duration": {"base": "whole"}, "notes": [
                        {"id": "e1N", "pitch": {"step": "C", "octave": 5}}
                    ]}
                ]}]
            },
            {
                "sequences": [{"content": [
                    {"id": "e2", "duration": {"base": "whole"}, "notes": [
                        {"id": "e2N", "pitch": {"step": "C", "octave": 5}}
                    ]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have 2 beziers: 1 regular tie (src→e1) + 1 incoming tie (→e2)
    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        2,
        "Expected 2 beziers (1 regular + 1 incoming), got {}",
        beziers.len()
    );

    // Extract x1 positions of both ties
    let mut x1_positions: Vec<f64> = beziers
        .iter()
        .map(|b| {
            if let RenderCommand::DrawFilledBezier { x1, .. } = b {
                *x1
            } else {
                0.0
            }
        })
        .collect();
    x1_positions.sort_by(|a, b| a.partial_cmp(b).unwrap());

    // The regular tie starts at the source note (leftmost x1).
    // The incoming tie starts near the target measure's left edge (rightmost x1).
    // The incoming tie's x1 must be significantly to the right of the regular tie's x1.
    let regular_x1 = x1_positions[0];
    let incoming_x1 = x1_positions[1];
    assert!(
        incoming_x1 > regular_x1 + config.sp * 5.0,
        "Incoming tie x1 ({:.1}) should be far right of regular tie x1 ({:.1})",
        incoming_x1,
        regular_x1
    );
}

#[test]
fn test_tie_enharmonic_different_staff_positions() {
    // Tie from C#4 to Db4 — enharmonically equivalent but different staff positions.
    // C4 is at staff position 10, D4 at position 9 (one half-space higher).
    // The tie curve must adapt: endpoints at different Y, boosted curve height.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"id": "en1", "pitch": {"step": "C", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}, "ties": [{"target": "en2"}]}]},
                {"duration": {"base": "half"}, "notes": [{"id": "en2", "pitch": {"step": "D", "octave": 4, "alter": -1}, "accidentalDisplay": {"show": true}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 tie bezier for enharmonic tie");

    // Endpoints should be at different Y positions (C4 vs D4 on staff)
    if let RenderCommand::DrawFilledBezier {
        y1, y2, ocy1, ocy2, ..
    } = beziers[0]
    {
        assert!(
            (y1 - y2).abs() > 0.01,
            "Enharmonic tie endpoints should be at different Y: y1={}, y2={}",
            y1,
            y2
        );
        // Control points should still arc properly away from both endpoints
        let curve_below = *ocy1 > *y1;
        assert_eq!(
            curve_below,
            *ocy2 > *y2,
            "Both control points should arc in the same direction"
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_tie_side_override() {
    // When tie.side = "down", curve should go below even if stem is down
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"duration": {"base": "half"}, "notes": [{"id": "so1", "pitch": {"step": "E", "octave": 5}, "ties": [{"target": "so2", "side": "down"}]}]},
            {"duration": {"base": "half"}, "notes": [{"id": "so2", "pitch": {"step": "E", "octave": 5}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 tie bezier");

    // E5 is above middle line → stem down by default → default curve would be above (negative dir)
    // But side="down" forces curve below (positive dir)
    if let RenderCommand::DrawFilledBezier {
        y1, ocy1, y2, ocy2, ..
    } = beziers[0]
    {
        assert!(
            *ocy1 > *y1,
            "side=down tie: ocy1 ({}) should be below y1 ({})",
            ocy1,
            y1
        );
        assert!(
            *ocy2 > *y2,
            "side=down tie: ocy2 ({}) should be below y2 ({})",
            ocy2,
            y2
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_lv_tie_produces_bezier() {
    // Laissez vibrer tie (lv=true, no target) should produce a short trailing curve
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"id": "lv1", "pitch": {"step": "G", "octave": 5}, "ties": [{"lv": true, "side": "up"}]}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let bezier_count = dl.commands.iter().filter(|c| is_draw_bezier(c)).count();
    assert_eq!(
        bezier_count, 1,
        "Expected 1 DrawBezier for lv tie, got {}",
        bezier_count
    );
}

#[test]
fn test_config_tie_same_thickness_as_slur() {
    let config = LayoutConfig::default();
    assert!(
        (config.tie_thickness - config.slur_thickness).abs() < 0.001,
        "Tie thickness ({}) should equal slur thickness ({})",
        config.tie_thickness,
        config.slur_thickness
    );
    assert!(
        (config.lv_tie_thickness - config.tie_thickness).abs() < 0.001,
        "LV tie thickness ({}) should equal tie thickness ({})",
        config.lv_tie_thickness,
        config.tie_thickness
    );
}

#[test]
fn test_config_tie_flatter_than_slur() {
    // Tie height asymptote is lower than slur's, producing flatter curves.
    // For a 5sp chord, tie height < slur height (both use asymptotic formula).
    let config = LayoutConfig::default();
    let sp = config.sp;
    let chord_len = 5.0 * sp;

    // Both use the same asymptotic formula: h = h_inf · (2/π) · atan(π · w · r₀ / (2 · h_inf))
    let w = chord_len / sp;

    let tie_x = w * config.tie_rise_rate / config.tie_height_inf;
    let tie_h = config.tie_height_inf
        * (2.0 / std::f64::consts::PI)
        * (std::f64::consts::PI * tie_x / 2.0).atan()
        * sp;

    let slur_x = w * config.slur_rise_rate / config.slur_height_inf;
    let slur_h = config.slur_height_inf
        * (2.0 / std::f64::consts::PI)
        * (std::f64::consts::PI * slur_x / 2.0).atan()
        * sp;

    assert!(
        tie_h < slur_h,
        "Tie height ({:.2}) must be less than slur height ({:.2}) for 5sp chord",
        tie_h,
        slur_h
    );
    assert!(
        tie_h / sp < 0.75,
        "A medium 5sp tie should stay below 0.75sp control height, got {:.3}sp",
        tie_h / sp
    );
}

#[test]
fn test_config_tie_cp_wider_than_slur() {
    // Tie control-point indent (0.20) is wider than slur's (0.15),
    // producing a rounder, more uniform arc vs slur's steep departure.
    let config = LayoutConfig::default();
    assert!(
        config.tie_cp_indent > config.slur_cp_indent,
        "Tie CP indent ({}) should be wider than slur CP indent ({})",
        config.tie_cp_indent,
        config.slur_cp_indent
    );
}

#[test]
fn test_config_tie_height_ceiling_lower_than_slur() {
    let config = LayoutConfig::default();
    assert!(
        config.tie_height_inf < config.slur_height_inf,
        "Tie height asymptote ({}) should be lower than slur height asymptote ({})",
        config.tie_height_inf,
        config.slur_height_inf
    );
}

#[test]
fn test_tie_height_lower_than_slur_height_rendered() {
    // End-to-end: same score, verify tie curve height < slur curve height.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "half"}, "notes": [{"id": "n1", "pitch": {"step": "C", "octave": 5}, "ties": [{"target": "n2"}]}],
                 "slurs": [{"target": "ev2", "side": "up"}]},
                {"id": "ev2", "duration": {"base": "half"}, "notes": [{"id": "n2", "pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all bezier outer control point heights
    let mut heights: Vec<f64> = Vec::new();
    for cmd in &dl.commands {
        if let RenderCommand::DrawFilledBezier { y1, ocy1, .. } = cmd {
            heights.push((ocy1 - y1).abs());
        }
    }
    assert_eq!(heights.len(), 2, "Expected 2 bezier heights");

    let min_h = heights.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_h = heights.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    assert!(
        min_h < max_h,
        "Tie curve height ({:.2}) should be less than slur curve height ({:.2})",
        min_h,
        max_h
    );
}

#[test]
fn test_tie_targets_mnx_layout() {
    // Verify that tie-targets.mnx lays out correctly with the space element
    let json = include_str!("../../../../../packages/format/fixtures/mnx/tie-targets.mnx");
    let score = parse_mnx(json).expect("should parse tie-targets.mnx");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    assert!(
        !dl.commands.is_empty(),
        "tie-targets.mnx should produce render output"
    );

    // Verify the space element was parsed correctly in measure 1, voice 2
    let m1 = &score.parts[0].measures[0];
    assert!(m1.sequences.len() >= 2, "measure 1 should have 2 voices");
    let voice2 = &m1.sequences[1];
    match &voice2.content[0] {
        SequenceContent::Space(s) => {
            assert_eq!(s.duration, (1, 4), "space should be a quarter duration");
        }
        other => panic!("Voice 2 should start with Space, got {:?}", other),
    }
}

// ---- Tie element ID tagging tests ----

#[test]
fn test_tie_element_id_tagged() {
    // Ties should be tagged with element IDs in the format "tie/{src_note_id}/{target_note_id}"
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"id": "n1", "pitch": {"step": "E", "octave": 4}, "ties": [{"target": "n2"}]}]},
                {"duration": {"base": "half"}, "notes": [{"id": "n2", "pitch": {"step": "E", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find the bezier command index (tie)
    let bezier_indices: Vec<usize> = dl
        .commands
        .iter()
        .enumerate()
        .filter(|(_, c)| is_draw_bezier(c))
        .map(|(i, _)| i)
        .collect();
    assert_eq!(bezier_indices.len(), 1, "Expected 1 tie bezier");

    let idx = bezier_indices[0];
    assert!(
        idx < dl.element_ids.len(),
        "element_ids should cover tie command"
    );
    let id = dl.element_ids[idx]
        .as_deref()
        .expect("Tie should have element ID");
    assert_eq!(
        id, "tie/n1/n2",
        "Tie element ID should be tie/{{src}}/{{tgt}}"
    );
}

#[test]
fn test_lv_tie_element_id_tagged() {
    // Laissez vibrer ties should be tagged with "tie/{src_note_id}/lv"
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"id": "lv1", "pitch": {"step": "C", "octave": 5}, "ties": [{"lv": true}]}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let bezier_indices: Vec<usize> = dl
        .commands
        .iter()
        .enumerate()
        .filter(|(_, c)| is_draw_bezier(c))
        .map(|(i, _)| i)
        .collect();
    assert_eq!(bezier_indices.len(), 1, "Expected 1 l.v. tie bezier");

    let idx = bezier_indices[0];
    assert!(
        idx < dl.element_ids.len(),
        "element_ids should cover l.v. tie command"
    );
    let id = dl.element_ids[idx]
        .as_deref()
        .expect("L.v. tie should have element ID");
    assert_eq!(
        id, "tie/lv1/lv",
        "L.v. tie element ID should be tie/{{src}}/lv"
    );
}

#[test]
fn test_tie_across_system_break_emits_two_halves() {
    // A tie whose source and target notes land on different systems must be
    // drawn as two half-curves: a source half trailing off the right edge of
    // the source system (id `tie/{src}/{tgt}/lh`) and a target half leading in
    // from the left edge of the target system (`/rh`). Build a long single
    // part of tied whole notes with a narrow page so it wraps onto many
    // systems, guaranteeing at least one tie is split by a system break.
    let mut global = String::new();
    let mut part = String::new();
    const N: usize = 16;
    for i in 0..N {
        let tie = if i + 1 < N {
            format!(r#", "ties": [{{"target": "t{}"}}]"#, i + 1)
        } else {
            String::new()
        };
        let note = format!(
            r#"{{"duration": {{"base": "whole"}}, "notes": [{{"id": "t{i}", "pitch": {{"step": "C", "octave": 5}}{tie}}}]}}"#
        );
        if i == 0 {
            global.push_str(r#"{"time": {"count": 4, "unit": 4}}"#);
            part.push_str(&format!(
                r#"{{"clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}], "sequences": [{{"content": [{note}]}}]}}"#
            ));
        } else {
            global.push_str(",{}");
            part.push_str(&format!(r#",{{"sequences": [{{"content": [{note}]}}]}}"#));
        }
    }
    let json = format!(
        r#"{{"mnx": {{"version": 1}}, "global": {{"measures": [{global}]}}, "parts": [{{"measures": [{part}]}}]}}"#
    );
    let score = parse_mnx(&json).unwrap();

    let config = LayoutConfig {
        page_width: Some(450.0),
        ..LayoutConfig::default()
    };
    let dl = layout_score(&score, 0, &config);

    // Collect cross-system tie half ids.
    let halves: Vec<&str> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_deref())
        .filter(|id| id.starts_with("tie/") && (id.ends_with("/lh") || id.ends_with("/rh")))
        .collect();

    assert!(
        !halves.is_empty(),
        "A tie spanning a system break should emit /lh and /rh halves; got none"
    );

    // Every source half must have a matching target half (and vice versa).
    let lh: std::collections::HashSet<&str> = halves
        .iter()
        .filter_map(|id| id.strip_suffix("/lh"))
        .collect();
    let rh: std::collections::HashSet<&str> = halves
        .iter()
        .filter_map(|id| id.strip_suffix("/rh"))
        .collect();
    assert_eq!(
        lh, rh,
        "Each cross-system tie must emit a matched /lh + /rh pair"
    );

    // Each half is a filled bezier carrying the tie id.
    let half_beziers = dl
        .commands
        .iter()
        .enumerate()
        .filter(|(i, c)| {
            is_draw_bezier(c)
                && dl
                    .element_ids
                    .get(*i)
                    .and_then(|o| o.as_deref())
                    .is_some_and(|id| {
                        id.starts_with("tie/") && (id.ends_with("/lh") || id.ends_with("/rh"))
                    })
        })
        .count();
    assert_eq!(
        half_beziers,
        halves.len(),
        "Every cross-system tie half id should tag a DrawFilledBezier command"
    );

    // A note that continues a tie chain across a system break must leave the
    // same 0.4sp tip gap as an in-system junction. The two halves of a broken
    // tie live on different systems, so the span direction has to come from
    // reading order rather than from comparing absolute X.
    let mut checked_system_start_junctions = 0;
    for split_tie in &rh {
        let Some((_, target_id)) = split_tie
            .strip_prefix("tie/")
            .and_then(|id| id.split_once('/'))
        else {
            continue;
        };
        let outgoing_prefix = format!("tie/{target_id}/");
        let incoming_tip = dl
            .commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| {
                dl.element_ids
                    .get(index)
                    .and_then(Option::as_deref)
                    .is_some_and(|id| id == format!("{split_tie}/rh"))
                    .then(|| bezier_endpoints_x(command).1)
            })
            .expect("incoming cross-system tie half");
        // The outgoing tie may itself be broken by the next system break, in
        // which case its source tip is carried by the `/lh` half.
        let outgoing_tip = dl.commands.iter().enumerate().find_map(|(index, command)| {
            dl.element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.starts_with(&outgoing_prefix) && !id.ends_with("/rh"))
                .then(|| bezier_endpoints_x(command).0)
        });
        if let Some(outgoing_tip) = outgoing_tip {
            checked_system_start_junctions += 1;
            assert!(
                ((outgoing_tip - incoming_tip) - 0.4 * config.sp).abs() < 0.01,
                "system-start chain gap at {target_id} must be 0.4sp, got {:.3}sp",
                (outgoing_tip - incoming_tip) / config.sp
            );
        }
    }
    assert!(
        checked_system_start_junctions > 0,
        "expected at least one tie chain continuing through a system break"
    );

    // The incoming (/rh) half must begin close to the target notehead, not
    // sweep in from the system start across the clef/key signature. Its
    // horizontal span is bounded by the continuation reach (~2.5sp); before
    // the fix it ran from the system's left content edge and spanned far more.
    let sp = config.sp;
    for (i, c) in dl.commands.iter().enumerate() {
        let is_rh = dl
            .element_ids
            .get(i)
            .and_then(|o| o.as_deref())
            .is_some_and(|id| id.starts_with("tie/") && id.ends_with("/rh"));
        if !is_rh {
            continue;
        }
        if let RenderCommand::DrawFilledBezier { x1, x2, .. } = c {
            let span = x2 - x1;
            assert!(
                span <= 2.5 * sp + 0.01,
                "incoming tie half should start near the notehead (span ≤ 2.5sp={:.1}), got span={:.1}",
                2.5 * sp,
                span
            );
        }
    }
}

#[test]
fn test_tie_across_chunk_seam_stays_continuous_in_stitched_horizon() {
    // In stitched-horizon mode the galley is split into retention chunks, each
    // with its own system_idx but laid on ONE continuous row. A tie whose
    // endpoints land in different chunks is dropped by the per-staff
    // `render_ties` pass (different system_idx) and resolved by
    // `render_cross_system_ties`. At a REAL page/system break that emits two
    // trailing half-curves (`/lh` + `/rh`); across a stitched chunk seam it must
    // instead emit ONE continuous curve. This unit-tests that branch directly
    // (the chunking machinery needs a full MNX score to engage, which is
    // fragile to hand-build — the flag is the whole behavioural difference).
    use crate::layout::slurs::SystemSlurBounds;
    use crate::layout::ties::{render_cross_system_ties, GlobalTieNote};
    use crate::model::event::Tie;
    use std::collections::HashMap;
    use std::rc::Rc;

    // Two whole-note "events" on different systems (chunks), same part+staff,
    // tied src → tgt. Source sits left of the seam, target to its right.
    let make = |id: &str, x: f64, system_idx: usize, ties: Vec<Tie>| GlobalTieNote {
        note_id: Rc::from(id),
        x,
        stem_x: x + 12.0,
        y_pos: 0.0,
        eff_staff_y: 100.0,
        stem_up: true,
        num_voices: 1,
        notehead_center_offset: 6.0,
        chord_positions: vec![0.0],
        system_idx,
        part_index: 0,
        staff_idx: 0,
        ties,
    };
    let src = make(
        "a",
        50.0,
        0,
        vec![Tie {
            target: Some("b".to_string()),
            target_type: None,
            side: None,
            lv: None,
        }],
    );
    let tgt = make("b", 400.0, 1, vec![]);
    let notes = vec![src, tgt];

    // System bounds for both (system, part, staff) triples (needed only by the
    // real-break path; the stitched path early-returns before consulting them).
    let mut bounds: HashMap<(usize, usize, usize), SystemSlurBounds> = HashMap::new();
    bounds.insert(
        (0, 0, 0),
        SystemSlurBounds {
            left_x: 0.0,
            right_x: 200.0,
        },
    );
    bounds.insert(
        (1, 0, 0),
        SystemSlurBounds {
            left_x: 300.0,
            right_x: 500.0,
        },
    );

    let config = LayoutConfig::default();
    let sp = config.sp;

    let tie_ids = |dl: &DisplayList| -> std::collections::HashSet<String> {
        dl.element_ids
            .iter()
            .filter_map(|id| id.as_deref())
            .filter(|id| id.starts_with("tie/"))
            .map(|id| id.to_string())
            .collect()
    };

    // Real break (stitched_horizon = false): two trailing halves.
    let mut dl_paged = DisplayList::new(600.0, 200.0);
    render_cross_system_ties(&mut dl_paged, &notes, &bounds, sp, &config, false);
    let paged_ids = tie_ids(&dl_paged);
    assert!(
        paged_ids.contains("tie/a/b/lh") && paged_ids.contains("tie/a/b/rh"),
        "a real system break should split the tie into /lh + /rh halves; got: {paged_ids:?}"
    );
    assert!(
        !paged_ids.contains("tie/a/b"),
        "a real break should NOT also emit a continuous tie; got: {paged_ids:?}"
    );

    // Stitched chunk seam (stitched_horizon = true): one continuous tie.
    let mut dl_stitched = DisplayList::new(600.0, 200.0);
    render_cross_system_ties(&mut dl_stitched, &notes, &bounds, sp, &config, true);
    let stitched_ids = tie_ids(&dl_stitched);
    assert!(
        stitched_ids.contains("tie/a/b"),
        "a stitched chunk seam should emit one continuous tie/a/b; got: {stitched_ids:?}"
    );
    assert!(
        !stitched_ids
            .iter()
            .any(|id| id.ends_with("/lh") || id.ends_with("/rh")),
        "a stitched chunk seam must NOT split the tie into halves; got: {stitched_ids:?}"
    );
}

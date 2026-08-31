// Auto-generated from tests.rs — test_slurs
// 7 test(s)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::{layout_score, layout_with_mnx_scores};
use crate::parse::parse_mnx;
use crate::render::*;

// ---- Slur rendering tests ----
#[test]
fn test_enclosing_slur_clears_tuplet_number() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "tuplet", "bracket": "no",
                 "inner": {"multiple": 4, "duration": {"base": "32nd"}},
                 "outer": {"multiple": 3, "duration": {"base": "32nd"}},
                 "content": [
                    {"id": "t1", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "slurs": [{"side": "up", "target": "end"}]},
                    {"id": "t2", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                    {"id": "t3", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                    {"id": "t4", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
                 ]},
                {"id": "end", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur = dl
        .commands
        .iter()
        .enumerate()
        .find(|(index, command)| {
            matches!(command, RenderCommand::DrawFilledBezier { .. })
                && dl.element_ids[*index].as_deref() == Some("slur/t1/end")
        })
        .map(|(_, command)| command)
        .expect("tuplet phrase should produce its slur");
    let tuplet_box = dl
        .element_bboxes
        .iter()
        .find(|entry| entry.element_id.contains("/tuplet"))
        .map(|entry| &entry.bbox)
        .expect("tuplet number should publish its exact ink box");
    let number_center_x = tuplet_box.x + tuplet_box.width * 0.5;
    let slur_y = bezier_outer_y_at_x(slur, number_center_x);

    assert!(
        slur_y <= tuplet_box.y - 0.49 * config.sp,
        "enclosing slur y={slur_y:.3} should pass outside tuplet box={tuplet_box:?} with standard clearance; slur={slur:?}"
    );
}

#[test]
fn test_slur_inside_inverted_voice_tuplet_clears_number() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"voice": "v1", "orient": "above", "content": [
                    {"type": "tuplet",
                     "inner": {"multiple": 3, "duration": {"base": "quarter"}},
                     "outer": {"multiple": 2, "duration": {"base": "quarter"}},
                     "content": [
                        {"id": "t1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "slurs": [{"side": "up", "target": "t3"}]},
                        {"id": "t2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                        {"id": "t3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]}
                     ]},
                    {"duration": {"base": "half"}, "rest": {}}
                ]},
                {"voice": "v2", "orient": "below", "content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                ]}
            ]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur = dl
        .commands
        .iter()
        .enumerate()
        .find(|(index, command)| {
            matches!(command, RenderCommand::DrawFilledBezier { .. })
                && dl.element_ids[*index].as_deref() == Some("slur/t1/t3")
        })
        .map(|(_, command)| command)
        .expect("tuplet voice should produce its slur");
    let tuplet_box = dl
        .element_bboxes
        .iter()
        .find(|entry| entry.element_id.contains("/tuplet"))
        .map(|entry| &entry.bbox)
        .expect("tuplet should publish its exact ink box");
    let RenderCommand::DrawFilledBezier { x1, x2, .. } = slur else {
        unreachable!();
    };
    let overlap_left = tuplet_box.x.max((*x1).min(*x2));
    let overlap_right = (tuplet_box.x + tuplet_box.width).min((*x1).max(*x2));
    let slur_y = bezier_outer_y_at_x(slur, (overlap_left + overlap_right) * 0.5);

    assert!(
        tuplet_box.y + tuplet_box.height <= slur_y - 0.39 * config.sp,
        "multi-voice tuplet must move outside its inner slur: slur y={slur_y:.3}, tuplet={tuplet_box:?}"
    );
}

#[test]
fn test_stem_side_slur_tip_clears_all_32nd_beam_levels() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "b1", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"id": "b2", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"id": "b3", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"id": "b4", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "F", "octave": 4}}], "slurs": [{"side": "up", "target": "end"}]},
                {"id": "end", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur = dl
        .commands
        .iter()
        .enumerate()
        .find(|(index, command)| {
            matches!(command, RenderCommand::DrawFilledBezier { .. })
                && dl.element_ids[*index].as_deref() == Some("slur/b4/end")
        })
        .map(|(_, command)| command)
        .expect("32nd-note phrase should produce its slur");
    let RenderCommand::DrawFilledBezier { x1, y1, .. } = slur else {
        unreachable!();
    };

    let beam_edges: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            let RenderCommand::DrawPolygon { points, .. } = command else {
                return None;
            };
            let id = dl.element_ids.get(index)?.as_deref()?;
            if !id.contains("/beam") {
                return None;
            }
            let right = points
                .iter()
                .map(|point| point.0)
                .fold(f64::NEG_INFINITY, f64::max);
            let top = points
                .iter()
                .map(|point| point.1)
                .fold(f64::INFINITY, f64::min);
            (right >= *x1 - 0.5 * config.sp && right <= *x1 + 0.5 * config.sp)
                .then_some((right, top))
        })
        .collect();
    assert!(
        beam_edges.len() >= 3,
        "expected all three 32nd-note beam levels at the slur endpoint, got {beam_edges:?}"
    );
    let beam_top = beam_edges
        .iter()
        .map(|(_, top)| *top)
        .fold(f64::INFINITY, f64::min);
    assert!(
        *y1 <= beam_top - 0.39 * config.sp,
        "stem-side slur tip y={y1:.3} should clear the local outer beam edge y={beam_top:.3}"
    );
}

#[test]
fn test_upward_beamed_slur_starts_on_stem_side() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "start", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "slurs": [{"side": "up", "target": "end"}]},
                {"id": "rise-1", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"id": "rise-2", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"id": "rise-3", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]},
                {"id": "end", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur = dl
        .commands
        .iter()
        .enumerate()
        .find(|(index, command)| {
            matches!(command, RenderCommand::DrawFilledBezier { .. })
                && dl.element_ids[*index].as_deref() == Some("slur/start/end")
        })
        .map(|(_, command)| command)
        .expect("expected upward slur");
    let start_head = dl
        .element_bboxes
        .iter()
        .find(|entry| entry.element_id == "p0/m0/s0/start/n0")
        .expect("expected source notehead bounding box");
    let notehead_center = start_head.bbox.x + start_head.bbox.width * 0.5;

    let RenderCommand::DrawFilledBezier { x1, .. } = slur else {
        unreachable!();
    };
    assert!(
        *x1 > notehead_center + 0.2 * config.sp,
        "upward slur must leave a stem-up source on its stem side: x1={x1:.2}, notehead centre={notehead_center:.2}"
    );
}

#[test]
fn test_slurs_mnx_file_produces_beziers() {
    // Load slurs.mnx: two measures, each with a slur (ev1→ev4 side=up, ev5→ev8 side=down)
    let json = include_str!("../../../../../packages/format/fixtures/mnx/slurs.mnx");

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let bezier_count = dl.commands.iter().filter(|c| is_draw_bezier(c)).count();
    assert_eq!(
        bezier_count, 2,
        "Expected 2 DrawBezier for slurs.mnx (one per slur), got {}",
        bezier_count
    );
}

#[test]
fn test_slur_side_up_curves_above() {
    // Slur with side="up" should curve above (control points have smaller y than endpoints)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 6, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"side": "up", "target": "s2"}]},
                {"id": "s2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
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
        "Expected 1 DrawBezier for slur, got {}",
        beziers.len()
    );

    // side="up" → curve above → outer control points should be above endpoints (ocy < y)
    if let RenderCommand::DrawFilledBezier {
        y1, ocy1, y2, ocy2, ..
    } = beziers[0]
    {
        assert!(
            *ocy1 < *y1,
            "Slur side=up: outer control point ocy1 ({}) should be above y1 ({})",
            ocy1,
            y1
        );
        assert!(
            *ocy2 < *y2,
            "Slur side=up: outer control point ocy2 ({}) should be above y2 ({})",
            ocy2,
            y2
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_simple_four_note_slur_has_clear_apex_rise() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"side": "up", "target": "ev4"}]},
                {"id": "ev2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "ev3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "ev4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let slur = dl
        .commands
        .iter()
        .find(|command| matches!(command, RenderCommand::DrawFilledBezier { .. }))
        .expect("simple phrase should produce a slur");
    let (start_y, end_y) = bezier_endpoints_y(slur);
    let apex_y = bezier_apex_y(slur);
    let apex_rise = (start_y + end_y) * 0.5 - apex_y;

    assert!(
        apex_rise >= 1.38 * config.sp,
        "simple slur apex rise should be at least 1.38sp, got {:.3}sp",
        apex_rise / config.sp
    );
}

#[test]
fn test_steeply_rising_passage_flattens_its_slur() {
    // Seven low notes then a leap of two octaves, under a slur drawn below.
    // The chord joining the endpoints climbs steeply away from the low notes,
    // so measuring their intrusion against it would demand an enormous
    // shoulder. Standard engraving practice is to draw the slur less steeply
    // than the notes rise, lifting the endpoint instead of digging the arc.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "slurs": [{"side": "down", "target": "ev8"}]},
                {"id": "ev2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"id": "ev3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"id": "ev4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
            ]}]
        }, {
            "sequences": [{"content": [
                {"id": "ev5", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"id": "ev6", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"id": "ev7", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"id": "ev8", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let slur = dl
        .commands
        .iter()
        .find(|command| matches!(command, RenderCommand::DrawFilledBezier { .. }))
        .expect("the phrase should produce a slur");
    let (start_y, end_y) = bezier_endpoints_y(slur);

    // The endpoints do not inherit the full 7sp of notehead rise — other
    // placement rules already temper it to 4.8sp. Slant reduction takes a
    // further 1.5sp (its cap) out of that, so a flattened slur lands near
    // 3.3sp. Asserting below 4.0 fails if slant reduction stops firing.
    let endpoint_rise = (start_y - end_y) / config.sp;
    assert!(
        endpoint_rise < 4.0,
        "a two-octave leap should be spanned by a slur flatter than the 4.8sp \
         rise its endpoints would otherwise take, got {endpoint_rise:.3}sp"
    );

    // Flattening must not tip over into a descending or level slur: the
    // contour of the passage still has to read.
    assert!(
        endpoint_rise > 2.0,
        "slant reduction should temper the rise, not erase it, got {endpoint_rise:.3}sp"
    );
}

#[test]
fn test_slur_side_down_curves_below() {
    // Slur with side="down" should curve below (control points have larger y than endpoints)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}], "slurs": [{"side": "down", "target": "s2"}]},
                {"id": "s2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]}
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
        "Expected 1 DrawBezier for slur, got {}",
        beziers.len()
    );

    // side="down" → curve below → outer control points should be below endpoints (ocy > y)
    if let RenderCommand::DrawFilledBezier {
        y1, ocy1, y2, ocy2, ..
    } = beziers[0]
    {
        assert!(
            *ocy1 > *y1,
            "Slur side=down: outer control point ocy1 ({}) should be below y1 ({})",
            ocy1,
            y1
        );
        assert!(
            *ocy2 > *y2,
            "Slur side=down: outer control point ocy2 ({}) should be below y2 ({})",
            ocy2,
            y2
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_slurs_chords_mnx_produces_bezier() {
    // Load slurs-chords.mnx: one measure with 4 chord events, slur ev1→ev4 side=up
    let json = include_str!("../../../../../packages/format/fixtures/mnx/slurs-chords.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let bezier_count = dl.commands.iter().filter(|c| is_draw_bezier(c)).count();
    assert_eq!(
        bezier_count, 1,
        "Expected 1 DrawFilledBezier for slurs-chords.mnx, got {}",
        bezier_count
    );
}

#[test]
fn test_slur_chord_anchor_topmost_when_up() {
    // Slur side="up" on chords should anchor at topmost note (E5), not bottommost (C4).
    // E5 is above C4 on the staff, so its Y should be smaller.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "c1", "duration": {"base": "half"}, "notes": [
                    {"pitch": {"step": "C", "octave": 4}},
                    {"pitch": {"step": "E", "octave": 5}}
                ], "slurs": [{"side": "up", "target": "c2"}]},
                {"id": "c2", "duration": {"base": "half"}, "notes": [
                    {"pitch": {"step": "D", "octave": 4}},
                    {"pitch": {"step": "F", "octave": 5}}
                ]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 DrawFilledBezier for slur");

    // Compute expected staff positions for topmost notes (E5, F5)
    // Treble clef: G4 ref diatonic=32, line_from_bottom=1
    // E5 diatonic=37, pos_from_top = (4-1)*2 - (37-32) = 6-5 = 1.0
    // F5 diatonic=38, pos_from_top = (4-1)*2 - (38-32) = 6-6 = 0.0
    // C4 diatonic=28, pos_from_top = (4-1)*2 - (28-32) = 6-(-4) = 10.0
    // D4 diatonic=29, pos_from_top = (4-1)*2 - (29-32) = 6-(-3) = 9.0
    let topmost_src_y_pos = 1.0; // E5
    let bottommost_src_y_pos = 10.0; // C4
    let staff_y = config.margin_top * sp;
    let topmost_y = staff_y + topmost_src_y_pos * sp * 0.5;
    let bottommost_y = staff_y + bottommost_src_y_pos * sp * 0.5;

    if let RenderCommand::DrawFilledBezier { y1, .. } = beziers[0] {
        // y1 should be near topmost note (E5), not bottommost (C4)
        let dist_to_top = (*y1 - topmost_y).abs();
        let dist_to_bottom = (*y1 - bottommost_y).abs();
        assert!(dist_to_top < dist_to_bottom,
            "Slur side=up: y1 ({:.1}) should be closer to topmost E5 ({:.1}) than bottommost C4 ({:.1})",
            y1, topmost_y, bottommost_y);
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_slur_chord_anchor_bottommost_when_down() {
    // Slur side="down" on chords should anchor at bottommost note (C4), not topmost (E5).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "c1", "duration": {"base": "half"}, "notes": [
                    {"pitch": {"step": "C", "octave": 4}},
                    {"pitch": {"step": "E", "octave": 5}}
                ], "slurs": [{"side": "down", "target": "c2"}]},
                {"id": "c2", "duration": {"base": "half"}, "notes": [
                    {"pitch": {"step": "D", "octave": 4}},
                    {"pitch": {"step": "F", "octave": 5}}
                ]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 DrawFilledBezier for slur");

    // Bottommost notes: C4 (pos 10.0), D4 (pos 9.0)
    // Topmost notes: E5 (pos 1.0), F5 (pos 0.0)
    let bottommost_src_y_pos = 10.0; // C4
    let topmost_src_y_pos = 1.0; // E5
    let staff_y = config.margin_top * sp;
    let bottommost_y = staff_y + bottommost_src_y_pos * sp * 0.5;
    let topmost_y = staff_y + topmost_src_y_pos * sp * 0.5;

    if let RenderCommand::DrawFilledBezier { y1, .. } = beziers[0] {
        // y1 should be near bottommost note (C4), not topmost (E5)
        let dist_to_bottom = (*y1 - bottommost_y).abs();
        let dist_to_top = (*y1 - topmost_y).abs();
        assert!(dist_to_bottom < dist_to_top,
            "Slur side=down: y1 ({:.1}) should be closer to bottommost C4 ({:.1}) than topmost E5 ({:.1})",
            y1, bottommost_y, topmost_y);
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_slur_targeting_specific_notes() {
    // Three slurs targeting specific notes within chords via startNote/endNote.
    // Slur 1: C5→B4 (side=down, startNote=note1, endNote=note4)
    // Slur 2: E5→D5 (side=up, startNote=note2, endNote=note5)
    // Slur 3: G5→F5 (side=up, startNote=note3, endNote=note6)
    let mnx = std::fs::read_to_string(
        "../../packages/format/fixtures/mnx/slurs-targeting-specific-notes.mnx",
    )
    .unwrap();
    let score = parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<_> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        3,
        "Expected 3 slur beziers for 3 targeted slurs"
    );

    let staff_y = config.margin_top * sp;

    // Treble clef: G4 ref diatonic=32, line_from_bottom=1
    // C5 diatonic=35, pos = (4-1)*2 - (35-32) = 6-3 = 3.0
    // E5 diatonic=37, pos = 6-5 = 1.0
    // G5 diatonic=39, pos = 6-7 = -1.0
    // B4 diatonic=34, pos = 6-2 = 4.0
    // D5 diatonic=36, pos = 6-4 = 2.0
    // F5 diatonic=38, pos = 6-6 = 0.0
    let c5_y = staff_y + 3.0 * sp * 0.5;
    let e5_y = staff_y + 1.0 * sp * 0.5;
    let g5_y = staff_y + -sp * 0.5;
    let b4_y = staff_y + 4.0 * sp * 0.5;
    let d5_y = staff_y + 2.0 * sp * 0.5;
    let f5_y = staff_y + 0.0 * sp * 0.5;

    // Each slur's y1/y2 should be anchored at its specific note, not top/bottom of chord.
    // Slurs are emitted in order: slur 1 (C5→B4), slur 2 (E5→D5), slur 3 (G5→F5)
    for (i, (expected_src_y, expected_tgt_y)) in [(c5_y, b4_y), (e5_y, d5_y), (g5_y, f5_y)]
        .iter()
        .enumerate()
    {
        if let RenderCommand::DrawFilledBezier { y1, y2, .. } = beziers[i] {
            // y1 should be near the specific start note (with some offset for clearance)
            let tolerance = 1.5 * sp; // allow for y_nudge and clearance offsets (up to 1.35sp for on-line notes)
            assert!(
                (*y1 - expected_src_y).abs() < tolerance,
                "Slur {}: y1={:.1} should be near note Y={:.1} (tolerance={:.1})",
                i,
                y1,
                expected_src_y,
                tolerance
            );
            assert!(
                (*y2 - expected_tgt_y).abs() < tolerance,
                "Slur {}: y2={:.1} should be near note Y={:.1} (tolerance={:.1})",
                i,
                y2,
                expected_tgt_y,
                tolerance
            );
        } else {
            panic!("Expected DrawFilledBezier for slur {}", i);
        }
    }

    // Verify slurs target different Y positions (not all using same top/bottom)
    let mut y1_values: Vec<f64> = Vec::new();
    for bezier in &beziers {
        if let RenderCommand::DrawFilledBezier { y1, .. } = bezier {
            y1_values.push(*y1);
        }
    }
    // All three slurs should have distinct y1 values since they target different notes
    for i in 0..y1_values.len() {
        for j in (i + 1)..y1_values.len() {
            assert!(
                (y1_values[i] - y1_values[j]).abs() > 0.1,
                "Slurs {} and {} should have different y1 values ({:.1} vs {:.1})",
                i,
                j,
                y1_values[i],
                y1_values[j]
            );
        }
    }
}

// ---- Slur lineType tests ----

#[test]
fn test_slur_line_type_dashed() {
    // A slur with lineType="dashed" should produce a DrawFilledBezier with line_style=1.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "s2", "side": "up", "lineType": "dashed"}]},
                {"id": "s2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 bezier for dashed slur");

    if let RenderCommand::DrawFilledBezier { line_style, .. } = beziers[0] {
        assert_eq!(
            *line_style, 1,
            "lineType=dashed should produce line_style=1"
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_slur_line_type_dotted() {
    // A slur with lineType="dotted" should produce a DrawFilledBezier with line_style=2.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "s2", "side": "up", "lineType": "dotted"}]},
                {"id": "s2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 bezier for dotted slur");

    if let RenderCommand::DrawFilledBezier { line_style, .. } = beziers[0] {
        assert_eq!(
            *line_style, 2,
            "lineType=dotted should produce line_style=2"
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_slur_line_type_solid_default() {
    // A slur with no lineType (or lineType="solid") should produce line_style=0.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "s2", "side": "up"}]},
                {"id": "s2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 bezier for solid slur");

    if let RenderCommand::DrawFilledBezier { line_style, .. } = beziers[0] {
        assert_eq!(
            *line_style, 0,
            "No lineType should default to line_style=0 (solid)"
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_slur_over_rest_high_notes_curves_above() {
    // C5-D5-(rest)-E5 in treble: all notes above middle line.
    // Stems should be DOWN (avg_pos < 4); slur side defaults to above.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "or1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"target": "or4"}]},
                {"id": "or2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "or3", "duration": {"base": "quarter"}, "rest": {}},
                {"id": "or4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1);
    if let RenderCommand::DrawFilledBezier {
        y1, ocy1, y2, ocy2, ..
    } = beziers[0]
    {
        assert!(
            *ocy1 < *y1,
            "Auto slur over high notes should curve above (ocy1 {} < y1 {})",
            ocy1,
            y1
        );
        assert!(
            *ocy2 < *y2,
            "Auto slur over high notes should curve above (ocy2 {} < y2 {})",
            ocy2,
            y2
        );
    } else {
        panic!("expected DrawFilledBezier");
    }
}

// ---- Slur sideEnd tests ----

#[test]
fn test_slur_side_end_different_from_side() {
    // Slur side="up", sideEnd="down": start anchors at topmost note, end anchors at bottommost.
    // With chords, this should produce different Y endpoints.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "c1", "duration": {"base": "half"}, "notes": [
                    {"pitch": {"step": "C", "octave": 4}},
                    {"pitch": {"step": "E", "octave": 5}}
                ], "slurs": [{"side": "up", "sideEnd": "down", "target": "c2"}]},
                {"id": "c2", "duration": {"base": "half"}, "notes": [
                    {"pitch": {"step": "D", "octave": 4}},
                    {"pitch": {"step": "F", "octave": 5}}
                ]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 bezier for slur");

    // side="up" → source anchors at topmost note (E5, pos 1.0)
    // sideEnd="down" → target anchors at bottommost note (D4, pos 9.0)
    let staff_y = config.margin_top * sp;
    let topmost_src_y = staff_y + 1.0 * sp * 0.5; // E5
    let bottommost_tgt_y = staff_y + 9.0 * sp * 0.5; // D4

    if let RenderCommand::DrawFilledBezier { y1, y2, .. } = beziers[0] {
        // y1 should be near topmost (E5)
        let tolerance = 1.5 * sp;
        assert!(
            (*y1 - topmost_src_y).abs() < tolerance,
            "Start y1={:.1} should be near topmost E5={:.1}",
            y1,
            topmost_src_y
        );
        // y2 should be near bottommost (D4), not topmost (F5)
        assert!(
            (*y2 - bottommost_tgt_y).abs() < tolerance,
            "End y2={:.1} should be near bottommost D4={:.1}",
            y2,
            bottommost_tgt_y
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_slur_side_end_same_as_side() {
    // When sideEnd is same as side (or not specified), behavior is the same as before.
    let json_with = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "s2", "side": "up", "sideEnd": "up"}]},
                {"id": "s2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let json_without = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "s2", "side": "up"}]},
                {"id": "s2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let config = LayoutConfig::default();
    let dl_with = layout_score(&parse_mnx(json_with).unwrap(), 0, &config);
    let dl_without = layout_score(&parse_mnx(json_without).unwrap(), 0, &config);

    let b_with: Vec<&RenderCommand> = dl_with
        .commands
        .iter()
        .filter(|c| is_draw_bezier(c))
        .collect();
    let b_without: Vec<&RenderCommand> = dl_without
        .commands
        .iter()
        .filter(|c| is_draw_bezier(c))
        .collect();
    assert_eq!(b_with.len(), 1);
    assert_eq!(b_without.len(), 1);

    // y2 should be the same whether sideEnd="up" or omitted (defaults to side)
    if let (
        RenderCommand::DrawFilledBezier { y2: y2_with, .. },
        RenderCommand::DrawFilledBezier { y2: y2_without, .. },
    ) = (b_with[0], b_without[0])
    {
        assert!(
            (*y2_with - *y2_without).abs() < 0.01,
            "sideEnd=up should be same as omitted: {:.2} vs {:.2}",
            y2_with,
            y2_without
        );
    } else {
        panic!("Expected DrawFilledBezier commands");
    }
}

// ---- Slur element ID tagging tests ----

#[test]
fn test_slur_element_id_tagged() {
    // Slurs should be tagged with element IDs in the format "slur/{src_event_id}/{target_event_id}"
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "s2", "side": "up"}]},
                {"id": "s2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find the bezier command index
    let bezier_indices: Vec<usize> = dl
        .commands
        .iter()
        .enumerate()
        .filter(|(_, c)| is_draw_bezier(c))
        .map(|(i, _)| i)
        .collect();
    assert_eq!(bezier_indices.len(), 1, "Expected 1 slur bezier");

    // Verify element ID is tagged
    let idx = bezier_indices[0];
    assert!(
        idx < dl.element_ids.len(),
        "element_ids should cover slur command"
    );
    let id = dl.element_ids[idx]
        .as_deref()
        .expect("Slur should have element ID");
    assert_eq!(
        id, "slur/s1/s2",
        "Slur element ID should be slur/{{src}}/{{tgt}}"
    );
}

// ---- S3: multi-voice direction (G14) ----
#[test]
fn test_s3_multi_voice_voice_one_curves_up() {
    // Two-voice measure. Voice 1 has descending stems-down notes; without
    // the multi-voice rule the slur would curve UP (stem-opposite), which
    // is what we want for voice 1 anyway. The real assertion: even when
    // voice 1's stems are FORCED down, the slur stays above (parity wins).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"id": "v1a", "duration": {"base": "half"}, "stemDirection": "down",
                     "notes": [{"pitch": {"step": "G", "octave": 5}}],
                     "slurs": [{"target": "v1b"}]},
                    {"id": "v1b", "duration": {"base": "half"}, "stemDirection": "down",
                     "notes": [{"pitch": {"step": "A", "octave": 5}}]}
                ]},
                {"content": [
                    {"id": "v2a", "duration": {"base": "half"},
                     "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                    {"id": "v2b", "duration": {"base": "half"},
                     "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 slur bezier");
    if let RenderCommand::DrawFilledBezier { y1, ocy1, .. } = beziers[0] {
        assert!(
            *ocy1 < *y1,
            "Voice 1 in multi-voice context must curve UP (parity rule), ocy1={} y1={}",
            ocy1,
            y1
        );
    } else {
        panic!("expected DrawFilledBezier");
    }
}

#[test]
fn test_s3_multi_voice_voice_two_curves_down() {
    // Voice 2 with stems UP must still slur DOWN (parity rule overrides stem).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
                ]},
                {"content": [
                    {"id": "v2a", "duration": {"base": "half"}, "stemDirection": "up",
                     "notes": [{"pitch": {"step": "C", "octave": 4}}],
                     "slurs": [{"target": "v2b"}]},
                    {"id": "v2b", "duration": {"base": "half"}, "stemDirection": "up",
                     "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 slur bezier");
    if let RenderCommand::DrawFilledBezier { y1, ocy1, .. } = beziers[0] {
        assert!(
            *ocy1 > *y1,
            "Voice 2 in multi-voice context must curve DOWN (parity rule), ocy1={} y1={}",
            ocy1,
            y1
        );
    } else {
        panic!("expected DrawFilledBezier");
    }
}

#[test]
fn test_s3_single_voice_keeps_stem_opposite() {
    // Single-voice measure: parity rule does NOT apply; stem-opposite wins.
    // Stem-down note must curve UP (above).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "s2"}]},
                {"id": "s2", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1);
    if let RenderCommand::DrawFilledBezier { y1, ocy1, .. } = beziers[0] {
        assert!(
            *ocy1 < *y1,
            "Single-voice stem-down must curve UP (stem-opposite), ocy1={} y1={}",
            ocy1,
            y1
        );
    } else {
        panic!("expected DrawFilledBezier");
    }
}

#[test]
fn test_s3_multi_voice_voice_one_turn_stays_above() {
    // Regression (Rhapsody piano m25): voice 1's slur spans a TURN figure
    // (B4-C5-B4) whose inner note is higher than the endpoints — a "mountain"
    // contour. Contour-following alone would flip the slur BELOW, colliding
    // with the stem-down lower voice. The multi-voice parity rule is a
    // voice-identity signal and must win: voice 1 stays ABOVE.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"id": "v1a", "duration": {"base": "quarter"},
                     "notes": [{"pitch": {"step": "B", "octave": 4}}],
                     "slurs": [{"target": "v1c"}]},
                    {"id": "v1b", "duration": {"base": "quarter"},
                     "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"id": "v1c", "duration": {"base": "quarter"},
                     "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                    {"id": "v1d", "duration": {"base": "quarter"},
                     "notes": [{"pitch": {"step": "B", "octave": 4}}]}
                ]},
                {"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1, "Expected 1 slur bezier (voice 1 only)");
    if let RenderCommand::DrawFilledBezier { y1, ocy1, .. } = beziers[0] {
        assert!(
            *ocy1 < *y1,
            "Voice 1 turn-figure slur must stay ABOVE despite mountain contour, ocy1={} y1={}",
            ocy1,
            y1
        );
    } else {
        panic!("expected DrawFilledBezier");
    }
}

#[test]
fn test_second_voice_slur_shape_ignores_outside_target_accent() {
    fn slur_geometry(target_markings: &str) -> [f64; 8] {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [
                    {{"time": {{"count": 4, "unit": 4}}}},
                    {{}}
                ]}},
                "parts": [{{"measures": [
                    {{"clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                      "sequences": [
                        {{"content": [
                            {{"duration": {{"base": "whole"}}, "notes": [{{"pitch": {{"step": "G", "octave": 4}}}}]}}
                        ]}},
                        {{"content": [
                            {{"duration": {{"base": "half"}}, "rest": {{}}}},
                            {{"duration": {{"base": "quarter", "dots": 1}}, "rest": {{}}}},
                            {{"id": "rv2s", "duration": {{"base": "16th"}},
                              "slurs": [{{"target": "rv2t"}}],
                              "notes": [{{"pitch": {{"step": "C", "octave": 4}}}}]}},
                            {{"duration": {{"base": "16th"}}, "rest": {{}}}}
                        ]}}
                      ]}},
                    {{"sequences": [
                        {{"content": [
                            {{"duration": {{"base": "whole"}}, "notes": [{{"pitch": {{"step": "G", "octave": 4}}}}]}}
                        ]}},
                        {{"content": [
                            {{"id": "rv2t", "duration": {{"base": "whole"}}{target_markings},
                              "notes": [{{"pitch": {{"step": "D", "octave": 4}}}}]}}
                        ]}}
                      ]}}
                ]}}]
            }}"#,
        );
        let dl = layout_score(&parse_mnx(&json).unwrap(), 0, &LayoutConfig::default());
        dl.commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| match command {
                RenderCommand::DrawFilledBezier {
                    x1,
                    y1,
                    ocx1,
                    ocy1,
                    ocx2,
                    ocy2,
                    x2,
                    y2,
                    ..
                } if dl
                    .element_ids
                    .get(index)
                    .and_then(Option::as_ref)
                    .is_some_and(|id| id.starts_with("slur/")) =>
                {
                    Some([*x1, *y1, *ocx1, *ocy1, *ocx2, *ocy2, *x2, *y2])
                }
                _ => None,
            })
            .expect("second-voice slur")
    }

    let without_accent = slur_geometry("");
    let with_accent = slur_geometry(r#", "markings": {"accent": {}}"#);
    for (index, (plain, accented)) in without_accent.iter().zip(with_accent.iter()).enumerate() {
        assert!(
            (plain - accented).abs() < 1.0e-6,
            "outside target accent changed slur geometry field {index}: plain={plain:.3}, accented={accented:.3}"
        );
    }
}

#[test]
fn test_rhapsody_m29_second_voice_slur_stays_compact() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    );
    let json = std::fs::read_to_string(path).expect("Rhapsody fixture");
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let slur_id = "slur/019e8ea7-4d52-755d-bb8c-ef49ec73943e/019e8ea7-4d52-7b49-8066-c42b0e913149";
    let geometry = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| match command {
            RenderCommand::DrawFilledBezier {
                y1, ocy1, ocy2, y2, ..
            } if dl.element_ids.get(index).and_then(Option::as_deref) == Some(slur_id) => {
                Some((*y1, *ocy1, *ocy2, *y2))
            }
            _ => None,
        })
        .expect("Rhapsody piano m28-to-m29 voice-2 slur");
    let endpoint_floor = geometry.0.max(geometry.3);
    let shoulder_floor = geometry.1.max(geometry.2);
    let depth_sp = (shoulder_floor - endpoint_floor) / config.sp;
    let target_note_y = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let id = dl.element_ids.get(index).and_then(Option::as_deref)?;
            if id != "p27/m28/s1/019e8ea7-4d52-7b49-8066-c42b0e913149/n0" {
                return None;
            }
            match command {
                RenderCommand::DrawGlyph { y, .. } => Some(*y),
                _ => None,
            }
        })
        .expect("target whole-note head");
    let target_accent_y = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let id = dl.element_ids.get(index).and_then(Option::as_deref)?;
            if id != "p27/m28/s1/019e8ea7-4d52-7b49-8066-c42b0e913149/art-accent" {
                return None;
            }
            match command {
                RenderCommand::DrawGlyph { y, .. } => Some(*y),
                _ => None,
            }
        })
        .expect("target whole-note accent");
    assert!(
        depth_sp <= 2.0,
        "Rhapsody piano m29 second-voice slur is too deep: {depth_sp:.3}sp, geometry={geometry:?}"
    );
    let target_endpoint_gap_sp = (geometry.3 - target_note_y).abs() / config.sp;
    assert!(
        target_endpoint_gap_sp <= 1.5,
        "stemless target endpoint floated {target_endpoint_gap_sp:.3}sp from its whole-note head"
    );
    let target_accent_gap_sp = (target_accent_y - target_note_y).abs() / config.sp;
    assert!(
        target_accent_gap_sp <= 3.0,
        "target accent floated {target_accent_gap_sp:.3}sp from its stemless whole-note head"
    );
}

#[test]
fn test_s3_explicit_side_overrides_parity() {
    // Voice 2 with explicit side="up" must curve UP despite even voice idx.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
                ]},
                {"content": [
                    {"id": "v2a", "duration": {"base": "half"},
                     "notes": [{"pitch": {"step": "C", "octave": 4}}],
                     "slurs": [{"target": "v2b", "side": "up"}]},
                    {"id": "v2b", "duration": {"base": "half"},
                     "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(beziers.len(), 1);
    if let RenderCommand::DrawFilledBezier { y1, ocy1, .. } = beziers[0] {
        assert!(
            *ocy1 < *y1,
            "Explicit side=up overrides parity, ocy1={} y1={}",
            ocy1,
            y1
        );
    } else {
        panic!("expected DrawFilledBezier");
    }
}

// ---- S2: endpoint clearances (A4 articulation pull-back active) ----
#[test]
fn test_s2_articulation_clears_endpoint() {
    // Slur source has a staccato above. Per, dot-style
    // articulations sit *inside* the slur (between notehead and slur tip),
    // so the slur tip must be above (smaller Y) the staccato glyph extent.
    // The pull-back may be a no-op when the natural slur anchor already
    // sits above the articulation — what matters is that the slur clears
    // the dot at the end.
    let with_staccato = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"staccato": {}},
                 "slurs": [{"target": "s2", "side": "up"}]},
                {"id": "s2", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(with_staccato).unwrap(), 0, &config);

    let bezier = dl.commands.iter().find(|c| is_draw_bezier(c)).unwrap();
    let y1 = match bezier {
        RenderCommand::DrawFilledBezier { y1, .. } => *y1,
        _ => panic!(),
    };

    // Find the staccato glyph's top Y (smallest y in its bbox).
    let staccato_top = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_ABOVE
                    || *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_BELOW =>
            {
                Some(*y)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);

    assert!(staccato_top.is_finite(), "expected a staccato glyph");
    assert!(
        y1 <= staccato_top,
        "Slur tip y1={} must be at or above staccato top={} (slur covers the dot)",
        y1,
        staccato_top
    );
}

#[test]
fn test_slur_endpoint_stops_at_notehead_under_fermata() {
    // A slur ending on a note that carries a fermata must terminate at the
    // notehead, NOT arc up to the top of the fermata. The fermata is always
    // engraved outside (above) the slur, so it must not pull the endpoint.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "f1", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "f2", "side": "up"}]},
                {"id": "f2", "duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}],
                 "fermata": {}},
                {"duration": {"base": "quarter"}, "rest": {}}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);

    let bezier = dl.commands.iter().find(|c| is_draw_bezier(c)).unwrap();
    let y2 = match bezier {
        RenderCommand::DrawFilledBezier { y2, .. } => *y2,
        _ => panic!("Expected DrawFilledBezier command"),
    };

    // Fermata glyph top (smallest y) — the slur endpoint must stay BELOW it.
    let fermata_top = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if (crate::render::smufl::smufl::FERMATA_ABOVE
                    ..=crate::render::smufl::smufl::FERMATA_SHORT_HENZE_BELOW)
                    .contains(codepoint) =>
            {
                Some(*y)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    assert!(fermata_top.is_finite(), "expected a fermata glyph");

    // E5 notehead center y (the slur target). The endpoint should sit near the
    // notehead, well below the fermata that floats above it.
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    // E5 is the top line of a treble staff → y ≈ staff_y (top line).
    let e5_notehead_y = staff_y;

    assert!(
        y2 > fermata_top,
        "Slur endpoint y2={} must stay below fermata top={} (slur stops at notehead)",
        y2,
        fermata_top
    );
    assert!(
        (y2 - e5_notehead_y).abs() < 3.0 * sp,
        "Slur endpoint y2={} should anchor near the E5 notehead y={}, not the fermata",
        y2,
        e5_notehead_y
    );
}

// ============================================================
// Rule regression suite (added 2026-05-17)
// Each test locks in a rule that was tuned during the 2026-05-16/17
// slur engraving pass. Assertions are tolerance-based and aim to
// survive harmless layout shifts.
// ============================================================

// ---- A. Direction & contour ------------------------------------

#[test]
fn test_mountain_contour_defaults_below() {
    // Short mountain (span < 10 hs) with endpoints BELOW middle line:
    // the register guard requires `endpoints_high == false`, so the
    // outer notes need to sit below the staff middle. G4 outer +
    // C5/D5 inner peaks → clean mountain that flips to BELOW.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "m1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}], "slurs": [{"target": "m4"}]},
                {"id": "m2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "m3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "m4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    assert!(
        !super::test_helpers::is_curve_above(bz),
        "short low-register mountain G4–C5–D5–G4 should curve BELOW (standard engraving G-P)"
    );
}

#[test]
fn test_valley_contour_defaults_above() {
    // High–low–high: slur should sit ABOVE the valley.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "v1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 5}}], "slurs": [{"target": "v4"}]},
                {"id": "v2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"id": "v3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"id": "v4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    assert!(
        super::test_helpers::is_curve_above(bz),
        "valley contour A5–D4–C4–A5 should curve ABOVE (standard engraving G-P)"
    );
}

#[test]
fn test_mixed_stems_defaults_above() {
    // Mixed stems (one above middle line, one below) → slur ABOVE.
    // G-F: when stems mix across a slur, default
    // ABOVE so the slur sits opposite the lower stem direction.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "x1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}], "slurs": [{"target": "x4"}]},
                {"id": "x2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "x3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"id": "x4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    assert!(
        super::test_helpers::is_curve_above(bz),
        "mixed-stem A4→F5 should curve ABOVE"
    );
    let (x1, _) = super::test_helpers::bezier_endpoints_x(bz);
    let (y1, _) = super::test_helpers::bezier_endpoints_y(bz);
    let config = LayoutConfig::default();
    let sp = config.sp;
    let (source_stem_x, source_stem_tip_y) = dl
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
                && (y1 - y2).abs() > sp
                && (*width - config.stem_width * sp).abs() < 1.0e-6 =>
            {
                Some((*x1, y1.min(*y2)))
            }
            _ => None,
        })
        .min_by(|left, right| left.0.total_cmp(&right.0))
        .expect("source stem");
    assert!(
        x1 > source_stem_x,
        "mixed-stem source tip x={x1} must stay right of source stem x={source_stem_x}"
    );
    let gap = (y1 - source_stem_tip_y).abs();
    assert!(
        gap <= 1.5 * sp,
        "mixed-stem source Y should stay near the stem tip: gap={:.3}sp",
        gap / sp
    );
}

#[test]
fn test_mixed_stem_endpoint_does_not_tilt_against_pitch_direction() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "mixed-start", "duration": {"base": "quarter", "dots": 1},
                 "stemDirection": "down", "notes": [{"pitch": {"step": "B", "octave": 4}}],
                 "slurs": [{"target": "mixed-end", "side": "up"}]},
                {"id": "mixed-end", "duration": {"base": "eighth"},
                 "stemDirection": "up", "notes": [{"pitch": {"step": "A", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let slur = dl
        .commands
        .iter()
        .find(|command| is_draw_bezier(command))
        .expect("mixed-stem slur");
    let (y1, y2) = super::test_helpers::bezier_endpoints_y(slur);

    assert!(
        y2 >= y1 - 1.0e-9,
        "descending outer notes must not produce a rising slur chord: y1={y1}, y2={y2}"
    );
}

#[test]
fn test_mixed_stem_source_endpoint_does_not_tilt_against_pitch_direction() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "mixed-start", "duration": {"base": "quarter"},
                 "stemDirection": "up", "notes": [{"pitch": {"step": "A", "octave": 4}}],
                 "slurs": [{"target": "mixed-end", "side": "up"}]},
                {"id": "mixed-end", "duration": {"base": "quarter"},
                 "stemDirection": "down", "notes": [{"pitch": {"step": "B", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let slur = dl
        .commands
        .iter()
        .find(|command| is_draw_bezier(command))
        .expect("mixed-stem slur");
    let (y1, y2) = super::test_helpers::bezier_endpoints_y(slur);

    assert!(
        y2 <= y1 + 1.0e-9,
        "ascending outer notes must not produce a descending slur chord: y1={y1}, y2={y2}"
    );
}

#[test]
fn test_tall_mountain_forced_above() {
    // True mountain with span >= 10 hs: outer notes C4, inner peaks A5/B5.
    // Per, tall slurs default ABOVE (industry-standard).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "tx1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "slurs": [{"target": "tx4"}], "markings": {"accent": {}}},
                {"id": "tx2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"id": "tx3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]},
                {"id": "tx4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "markings": {"accent": {}}}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    assert!(
        super::test_helpers::is_curve_above(bz),
        "tall mountain C4–A5–B5–C4 should be forced ABOVE"
    );
    let (x1, x2) = super::test_helpers::bezier_endpoints_x(bz);
    let (y1, y2) = super::test_helpers::bezier_endpoints_y(bz);
    let config = LayoutConfig::default();
    let sp = config.sp;
    let stem_lines: Vec<(f64, f64)> = dl
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
                && (y1 - y2).abs() > sp
                && (*width - config.stem_width * sp).abs() < 1.0e-6 =>
            {
                Some((*x1, y1.min(*y2)))
            }
            _ => None,
        })
        .collect();
    for (endpoint_x, endpoint_y) in [(x1, y1), (x2, y2)] {
        let stem_tip_y = stem_lines
            .iter()
            .min_by(|left, right| {
                (left.0 - endpoint_x)
                    .abs()
                    .total_cmp(&(right.0 - endpoint_x).abs())
            })
            .map(|(_, tip_y)| *tip_y)
            .expect("boundary stem");
        let gap = (endpoint_y - stem_tip_y).abs();
        assert!(
            gap <= 1.5 * sp,
            "tall-slur endpoint should stay near its stem tip: gap={:.3}sp",
            gap / sp
        );
    }
}

#[test]
fn test_tall_ascending_not_forced_above_by_mountain_rule() {
    // Ascending E4→B5 over A5/B5: span is tall (≥10 hs) but the contour
    // is NOT a mountain (start at the bottom, end at the top). The
    // mountain-contour gate (added 2026-05-17) keeps the tall-slur
    // forced-above exception scoped to true mountains; here the slur
    // is free to follow its natural side (mixed-stem → above anyway,
    // so the assertion is that it still works without crashing — the
    // important regression check is the mountain-contour gate itself,
    // verified visually).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ms1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}], "slurs": [{"target": "ms4"}]},
                {"id": "ms2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"id": "ms3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]},
                {"id": "ms4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    // Curve must be above, and the RIGHT endpoint (B5) must land at or
    // below the curve apex — i.e. the apex isn't dragged so far up that
    // the right tip floats above its own notehead. (Regression for the
    // uniform inner-articulation lift bug.)
    assert!(
        super::test_helpers::is_curve_above(bz),
        "mixed-stem E4→B5 spans curve above"
    );
    let apex = super::test_helpers::bezier_apex_y(bz);
    let (_y1, y2) = super::test_helpers::bezier_endpoints_y(bz);
    assert!(
        y2 >= apex - 0.01,
        "right endpoint y2={} should be at or below apex={}",
        y2,
        apex
    );
}

// ---- B. Endpoint placement -------------------------------------

#[test]
fn test_notehead_side_endpoint_clears_notehead() {
    // For a curve_above slur over stem-down notes, the tip sits on the
    // NOTEHEAD side (above) and must clear the notehead by some pad.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ne1", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "ne2", "side": "up"}]},
                {"id": "ne2", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (y1, y2) = super::test_helpers::bezier_endpoints_y(bz);
    let top_nh = super::test_helpers::topmost_notehead_y(&dl);
    assert!(
        y1 < top_nh && y2 < top_nh,
        "notehead-side tips (y1={}, y2={}) must sit above topmost notehead y={}",
        y1,
        y2,
        top_nh
    );
}

#[test]
fn test_stem_side_endpoint_offset_from_notehead_x() {
    // For a curve_below slur over stem-up notes, the start tip sits on
    // the STEM side. The X must be shifted away from the notehead
    // centre toward the stem: anchor at the stem).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ss1", "duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "C", "octave": 4}}],
                 "slurs": [{"target": "ss2", "side": "down"}]},
                {"id": "ss2", "duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "E", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (x1, _x2) = super::test_helpers::bezier_endpoints_x(bz);
    // First notehead centre X (noteheads may render as ellipse OR glyph)
    let nh1_x = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawEllipse { cx, .. } => Some(*cx),
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if (0xE0A0..=0xE0A4).contains(codepoint) =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("first notehead");
    // Stem-side anchor for stem-up notes sits to the RIGHT of the
    // notehead centre (at the stem's X). Allow small tolerance.
    assert!(
        x1 > nh1_x - 0.01,
        "stem-side x1={} must be at or to the right of notehead centre={}",
        x1,
        nh1_x
    );
}

#[test]
fn test_note_targeted_chord_slur_stays_inside_stem_edges() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "half"}, "stemDirection": "up", "notes": [
                    {"id": "n1-top", "pitch": {"step": "G", "octave": 4}},
                    {"id": "n1-bot", "pitch": {"step": "C", "octave": 4}}
                ], "slurs": [
                    {"target": "ev2", "startNote": "n1-top", "endNote": "n2-top", "side": "up"},
                    {"target": "ev2", "startNote": "n1-bot", "endNote": "n2-bot", "side": "down"}
                ]},
                {"id": "ev2", "duration": {"base": "half"}, "stemDirection": "up", "notes": [
                    {"id": "n2-top", "pitch": {"step": "A", "octave": 4}},
                    {"id": "n2-bot", "pitch": {"step": "D", "octave": 4}}
                ]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let upper_slur = dl
        .commands
        .iter()
        .find(|command| {
            matches!(command, RenderCommand::DrawFilledBezier { y1, ocy1, .. } if ocy1 < y1)
        })
        .expect("upper chord slur");
    let (slur_x1, slur_x2) = bezier_endpoints_x(upper_slur);
    let (slur_y1, slur_y2) = bezier_endpoints_y(upper_slur);
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
    stem_xs.dedup_by(|left, right| (*left - *right).abs() < 1.0e-6);

    assert_eq!(stem_xs.len(), 2, "fixture should render two chord stems");
    assert!(
        slur_x1 > stem_xs[0],
        "source tip x={slur_x1} must sit to the right of source stem x={}",
        stem_xs[0]
    );
    assert!(
        slur_x2 < stem_xs[1],
        "target tip x={slur_x2} must sit to the left of target stem x={}",
        stem_xs[1]
    );
    assert!(
        (slur_y1 - slur_y2).abs() < 1.0e-6,
        "upper stem-contained tips should share a spring line: y1={slur_y1}, y2={slur_y2}"
    );
}

#[test]
fn test_note_targeted_chord_slur_mirrors_for_down_stems() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "half"}, "stemDirection": "down", "notes": [
                    {"id": "n1-top", "pitch": {"step": "E", "octave": 5}},
                    {"id": "n1-bot", "pitch": {"step": "A", "octave": 4}}
                ], "slurs": [
                    {"target": "ev2", "startNote": "n1-bot", "endNote": "n2-bot", "side": "down"}
                ]},
                {"id": "ev2", "duration": {"base": "half"}, "stemDirection": "down", "notes": [
                    {"id": "n2-top", "pitch": {"step": "F", "octave": 5}},
                    {"id": "n2-bot", "pitch": {"step": "B", "octave": 4}}
                ]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let lower_slur = dl
        .commands
        .iter()
        .find(|command| {
            matches!(command, RenderCommand::DrawFilledBezier { y1, ocy1, .. } if ocy1 > y1)
        })
        .expect("lower chord slur");
    let (slur_x1, slur_x2) = bezier_endpoints_x(lower_slur);
    let (slur_y1, slur_y2) = bezier_endpoints_y(lower_slur);
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
    stem_xs.dedup_by(|left, right| (*left - *right).abs() < 1.0e-6);

    assert_eq!(stem_xs.len(), 2, "fixture should render two chord stems");
    assert!(
        slur_x1 > stem_xs[0],
        "mirrored source tip x={slur_x1} must sit to the right of source stem x={}",
        stem_xs[0]
    );
    assert!(
        slur_x2 < stem_xs[1],
        "mirrored target tip x={slur_x2} must sit to the left of target stem x={}",
        stem_xs[1]
    );
    assert!(
        (slur_y1 - slur_y2).abs() < 1.0e-6,
        "lower stem-contained tips should share a spring line: y1={slur_y1}, y2={slur_y2}"
    );
}

// ---- C. Apex / shoulder ----------------------------------------

#[test]
fn test_excess_shoulder_lifts_endpoints_for_tall_span() {
    // Tall mountain (C4–A5–B5–C4 with accents on both C4): with shoulder
    // capped, the excess required height converts into endpoint lift.
    // Endpoints should sit noticeably ABOVE the C4 notehead Y.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "es1", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "C", "octave": 4}}],
                 "slurs": [{"target": "es4"}]},
                {"id": "es2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"id": "es3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]},
                {"id": "es4", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (y1, y2) = super::test_helpers::bezier_endpoints_y(bz);
    let bottom = super::test_helpers::bottommost_notehead_y(&dl);
    // Curve is above; endpoints should sit ABOVE the lowest notehead
    // (smaller Y in screen coords).
    assert!(
        y1 < bottom && y2 < bottom,
        "tall-span endpoints (y1={}, y2={}) should lift above lowest notehead y={}",
        y1,
        y2,
        bottom
    );
}

// ---- D. Articulation interaction (boundary) -------------------

#[test]
fn test_accent_boundary_outside_slur() {
    //: accent at slur boundary sits OUTSIDE the curve
    // (above an above-curving slur). The accent glyph Y must be ≤
    // (above) the slur tip Y.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ab1", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"accent": {}},
                 "slurs": [{"target": "ab2", "side": "up"}]},
                {"id": "ab2", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (y1, _) = super::test_helpers::bezier_endpoints_y(bz);
    // Accent should sit ABOVE the slur tip (smaller Y).
    let accent_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_ACCENT_ABOVE
                    || *codepoint == crate::render::smufl::smufl::ARTIC_ACCENT_BELOW =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("accent glyph");
    assert!(
        accent_y < y1,
        "accent y={} should sit ABOVE slur tip y1={}",
        accent_y,
        y1
    );
}

#[test]
fn test_below_slur_clears_full_boundary_accent_span() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ba1", "duration": {"base": "quarter"}, "stemDirection": "up",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"accent": {}},
                 "slurs": [{"target": "ba3", "side": "down"}]},
                {"id": "ba2", "duration": {"base": "quarter"}, "stemDirection": "up",
                 "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"id": "ba3", "duration": {"base": "quarter"}, "stemDirection": "up",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "rest": {}}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur = dl
        .commands
        .iter()
        .find(|command| matches!(command, RenderCommand::DrawFilledBezier { .. }))
        .expect("slur");
    let (slur_left, slur_right) = match slur {
        RenderCommand::DrawFilledBezier { x1, x2, .. } => (x1.min(*x2), x1.max(*x2)),
        _ => unreachable!(),
    };
    let (accent_left, accent_right, accent_top) = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } if *codepoint == crate::render::smufl::smufl::ARTIC_ACCENT_BELOW => {
                let scale = *size / 4.0;
                let (bbox_x, bbox_y, bbox_w, _) =
                    crate::render::smufl::smufl::glyph_bbox(*codepoint);
                Some((
                    *x + bbox_x * scale,
                    *x + (bbox_x + bbox_w) * scale,
                    *y + bbox_y * scale,
                ))
            }
            _ => None,
        })
        .expect("below accent");
    let overlap_left = accent_left.max(slur_left);
    let overlap_right = accent_right.min(slur_right);
    assert!(
        overlap_left < overlap_right,
        "accent must overlap slur in X"
    );

    let mut lowest_slur_edge = f64::NEG_INFINITY;
    for sample in 0..=16 {
        let x = overlap_left + (overlap_right - overlap_left) * sample as f64 / 16.0;
        lowest_slur_edge = lowest_slur_edge.max(bezier_outer_y_at_x(slur, x));
    }
    assert!(
        accent_top >= lowest_slur_edge + 0.3 * sp,
        "outside accent top={accent_top:.3} must clear the full slur span edge={lowest_slur_edge:.3}"
    );
    let accent_id = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id.ends_with("/art-accent"))
        .expect("accent bbox");
    assert!(
        (accent_id.bbox.y - accent_top).abs() < 1.0e-6,
        "selection bbox must follow the shifted accent command"
    );
    let accent_shape = dl
        .element_shapes
        .iter()
        .find(|shape| shape.element_id.ends_with("/art-accent"))
        .and_then(|shape| shape.bbox(&dl.commands))
        .expect("accent shape");
    assert!(
        (accent_shape.y - accent_top).abs() < 1.0e-6,
        "collision shape must follow the shifted accent command"
    );
}

#[test]
fn test_marcato_boundary_outside_slur() {
    // Marcato follows the same outside-boundary rule as accent.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "mb1", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"strongAccent": {}},
                 "slurs": [{"target": "mb2", "side": "up"}]},
                {"id": "mb2", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (y1, _) = super::test_helpers::bezier_endpoints_y(bz);
    let marc_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_MARCATO_ABOVE
                    || *codepoint == crate::render::smufl::smufl::ARTIC_MARCATO_BELOW =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("marcato glyph");
    assert!(
        marc_y < y1,
        "marcato y={} should sit ABOVE slur tip y1={}",
        marc_y,
        y1
    );
}

#[test]
fn test_staccato_boundary_inside_slur() {
    // Staccato/tenuto (dot-style) sit INSIDE the slur curve: between
    // notehead and slur tip. Tip should be above the dot, dot above
    // the notehead.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "sb1", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"staccato": {}},
                 "slurs": [{"target": "sb2", "side": "up"}]},
                {"id": "sb2", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (y1, _) = super::test_helpers::bezier_endpoints_y(bz);
    let stac_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_ABOVE
                    || *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_BELOW =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("staccato glyph");
    // Bottom of all noteheads — the staccato's host (C5 stem-down) is
    // the lower of the two noteheads. Staccato sits above (smaller Y)
    // its host, so it must be above the bottommost notehead.
    let bot_nh = super::test_helpers::bottommost_notehead_y(&dl);
    assert!(
        stac_y < bot_nh,
        "staccato y={} should sit above its host notehead y={}",
        stac_y,
        bot_nh
    );
    // Slur tip above the staccato (curve covers the dot).
    assert!(
        y1 <= stac_y + 0.01,
        "slur tip y1={} should sit above staccato y={}",
        y1,
        stac_y
    );
}

#[test]
fn test_staccatissimo_wedge_boundaries_outside_and_interior_inside_slur() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "sw1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"target": "sw4"}], "markings": {"_x": {"viritura": {"staccatissimoWedge": {}}}}},
                {"id": "sw2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}], "markings": {"_x": {"viritura": {"staccatissimoWedge": {}}}}},
                {"id": "sw3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}], "markings": {"_x": {"viritura": {"staccatissimoWedge": {}}}}},
                {"id": "sw4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}], "markings": {"_x": {"viritura": {"staccatissimoWedge": {}}}}}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_top = config.margin_top * sp;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur = dl
        .commands
        .iter()
        .find(|command| matches!(command, RenderCommand::DrawFilledBezier { .. }))
        .expect("slur");
    let mut wedges: Vec<(f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if *codepoint == crate::render::smufl::smufl::ARTIC_STACCATISSIMO_WEDGE_ABOVE => {
                let (_, bbox_y, _, bbox_h) = crate::render::smufl::smufl::glyph_bbox(*codepoint);
                let center_x =
                    *x + crate::render::smufl::smufl::articulation_width(*codepoint) * sp * 0.5;
                let center_y = *y + (bbox_y + bbox_h * 0.5) * sp;
                let ink_bottom = *y + (bbox_y + bbox_h) * sp;
                Some((center_x, center_y, ink_bottom))
            }
            _ => None,
        })
        .collect();
    wedges.sort_by(|left, right| left.0.total_cmp(&right.0));

    assert_eq!(wedges.len(), 4);
    for (index, (x, center_y, ink_bottom)) in wedges.iter().copied().enumerate() {
        assert!(
            ink_bottom <= staff_top + 1.0e-6,
            "wedge {index} must remain outside the staff"
        );
        let curve_y = bezier_outer_y_at_x(slur, x);
        if index == 0 || index == wedges.len() - 1 {
            assert!(
                center_y < curve_y,
                "boundary wedge {index} center={center_y:.3} should sit outside slur y={curve_y:.3}"
            );
        } else {
            assert!(
                center_y > curve_y,
                "interior wedge {index} center={center_y:.3} should sit inside slur y={curve_y:.3}"
            );
        }
    }
}

// ---- E. Articulation interaction (interior) --------------------

#[test]
fn test_inner_staccato_lifts_apex() {
    // Slur from C5 → C5 over inner G5 with staccato. The slur apex must
    // clear the staccato glyph by some pad — apex Y < staccato Y.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "is1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "is4", "side": "up"}]},
                {"id": "is2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "G", "octave": 5}}],
                 "markings": {"staccato": {}}},
                {"id": "is3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "F", "octave": 5}}],
                 "markings": {"staccato": {}}},
                {"id": "is4", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let apex = super::test_helpers::bezier_apex_y(bz);
    let inner_stac_top = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_ABOVE =>
            {
                Some(*y)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    assert!(inner_stac_top.is_finite(), "expected inner staccatos");
    assert!(
        apex < inner_stac_top,
        "slur apex y={} should clear inner staccato y={}",
        apex,
        inner_stac_top
    );
}

// ---- F. Articulation placement --------------------------------

#[test]
fn test_staccato_outside_staff_for_upper_half_note() {
    // A4 in treble (upper-half of the staff under stem-up default with
    // place-below): staccato should sit OUTSIDE the staff (below the
    // bottom line, y > 4*sp from staff top — i.e. y > 0 if staff is
    // 0..4sp). Just assert the dot is below the lowest notehead by
    // at least half a staff space — i.e. clearly outside.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "su1", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "A", "octave": 4}}],
                 "markings": {"staccato": {}}},
                {"duration": {"base": "quarter", "dots": 1}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let stac = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_ABOVE
                    || *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_BELOW =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("staccato glyph");
    let a4_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawEllipse { cy, .. } => Some(*cy),
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if (0xE0A0..=0xE0A4).contains(codepoint) =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("notehead");
    // For A4 stem-up, place_below=true → dot below the notehead.
    assert!(
        stac > a4_y,
        "A4 staccato y={} should sit BELOW notehead y={} (stem-up upper-half)",
        stac,
        a4_y
    );
}

// ---- G. Nested slurs & tip stacking ---------------------------

#[test]
fn test_nested_slurs_stack_tips() {
    // Two slurs sharing the outer pair of endpoints + an inner pair.
    // Outer slur's tip should sit FARTHER from the staff than the
    // inner slur's tip on the SAME side.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ns1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "ns4", "side": "up"}, {"target": "ns3", "side": "up"}]},
                {"id": "ns2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "ns3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "ns4", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let beziers: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawFilledBezier { .. }))
        .collect();
    assert_eq!(beziers.len(), 2, "expected 2 slur beziers");
    // Both share the same start event (ns1). Their y1 values should differ
    // — the outer (ns1→ns4) must sit above (smaller Y) the inner (ns1→ns3).
    let (y1_a, _) = super::test_helpers::bezier_endpoints_y(beziers[0]);
    let (y1_b, _) = super::test_helpers::bezier_endpoints_y(beziers[1]);
    assert!(
        (y1_a - y1_b).abs() > 0.1,
        "nested slurs sharing start should stack tips (y1_a={} y1_b={})",
        y1_a,
        y1_b
    );
}

// ---- H. Tie integration ---------------------------------------

#[test]
fn test_slur_over_tied_pair_y_stacks() {
    // First note of slur is tied. The slur tip must sit OUTSIDE the
    // tie arc on the same side (standard engraving practice: ≥1 sp displacement).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "tp1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"id": "n_a", "pitch": {"step": "C", "octave": 5}, "ties": [{"target": "n_b"}]}],
                 "slurs": [{"target": "tp3", "side": "up"}]},
                {"id": "tp2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"id": "n_b", "pitch": {"step": "C", "octave": 5}}]},
                {"id": "tp3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let beziers: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawFilledBezier { .. }))
        .collect();
    assert!(beziers.len() >= 2, "expected at least one slur and one tie");
    // The slur and tie both curve above. The slur's y1 should sit
    // farther above the staff than the tie's y1 (smaller Y).
    // Identify the slur as the longer-span bezier.
    let mut spans: Vec<(usize, f64, f64)> = beziers
        .iter()
        .enumerate()
        .map(|(i, b)| {
            let (x1, x2) = super::test_helpers::bezier_endpoints_x(b);
            let (y1, _) = super::test_helpers::bezier_endpoints_y(b);
            (i, (x2 - x1).abs(), y1)
        })
        .collect();
    spans.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let slur_y1 = spans[0].2;
    let tie_y1 = spans[1].2;
    assert!(
        slur_y1 < tie_y1,
        "slur y1={} should sit above tie y1={}",
        slur_y1,
        tie_y1
    );
    let tip_gap_sp = (tie_y1 - slur_y1) / LayoutConfig::default().sp;
    // One stack step: CURVE_STACK_WHITE_SP of white plus the ink of the two
    // tapered tips. Range allows for the staff-line snap nudging it outward.
    assert!(
        (0.6..=1.1).contains(&tip_gap_sp),
        "shared slur/tie tips should be about one stack step apart, got {tip_gap_sp:.3}sp"
    );
}

#[test]
fn test_tie_and_slur_tips_carry_the_same_weight() {
    // A tie and a slur are the same engraved stroke — a graver cutting a
    // crescent — so their tapered tips must carry identical weight. They are
    // built from separate spine pipelines, so this guards the shared
    // `engrave_stroke` graver against the two drifting apart again (ties once
    // used a proportional `mid * 0.45` tip while slurs used an absolute
    // 0.10 sp, leaving tie tips 35% heavier).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "w1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"id": "wn_a", "pitch": {"step": "C", "octave": 5}, "ties": [{"target": "wn_b"}]}],
                 "slurs": [{"target": "w3", "side": "up"}]},
                {"id": "w2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"id": "wn_b", "pitch": {"step": "C", "octave": 5}}]},
                {"id": "w3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    // Tip width = distance from the outer endpoint to the tapered inner tip.
    let tip_width = |command: &RenderCommand| match command {
        RenderCommand::DrawFilledBezier {
            x1, y1, ix1, iy1, ..
        } => ((ix1 - x1).powi(2) + (iy1 - y1).powi(2)).sqrt(),
        _ => f64::NAN,
    };
    let find = |prefix: &str| {
        dl.commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| {
                let id = dl.element_ids.get(index).and_then(Option::as_deref)?;
                id.starts_with(prefix).then_some(command)
            })
            .unwrap_or_else(|| panic!("missing {prefix} curve"))
    };
    let slur_tip = tip_width(find("slur/"));
    let tie_tip = tip_width(find("tie/"));
    assert!(
        (slur_tip - tie_tip).abs() < 1.0e-6,
        "tie and slur tips must carry the same weight: slur={slur_tip:.4}, tie={tie_tip:.4}"
    );
    // And that weight is the configured endpoint thickness, not a ratio of
    // the midpoint weight.
    assert!(
        (slur_tip - config.slur_endpoint_thickness * config.sp).abs() < 1.0e-6,
        "tip width should equal the configured endpoint thickness, got {slur_tip:.4}"
    );
}

// ---- I. Misc / regression -------------------------------------

#[test]
fn test_rest_does_not_create_phantom_obstacle() {
    // Rest between slur endpoints should not lift the slur as if it
    // were a notehead.
    let json_with_rest = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "rr1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "rr3", "side": "up"}]},
                {"id": "rr2", "duration": {"base": "quarter"}, "rest": {}},
                {"id": "rr3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let json_no_rest = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "nr1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "nr3", "side": "up"}]},
                {"id": "nr2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "nr3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl_r = layout_score(
        &parse_mnx(json_with_rest).unwrap(),
        0,
        &LayoutConfig::default(),
    );
    let dl_n = layout_score(
        &parse_mnx(json_no_rest).unwrap(),
        0,
        &LayoutConfig::default(),
    );
    let apex_r = super::test_helpers::bezier_apex_y(
        dl_r.commands
            .iter()
            .find(|c| is_draw_bezier(c))
            .expect("slur r"),
    );
    let apex_n = super::test_helpers::bezier_apex_y(
        dl_n.commands
            .iter()
            .find(|c| is_draw_bezier(c))
            .expect("slur n"),
    );
    // Rest variant's apex should NOT sit dramatically higher than the
    // note-only variant — both apices should be in the same ballpark.
    assert!(
        (apex_r - apex_n).abs() < 2.0,
        "rest variant apex={} should not differ much from note-only apex={}",
        apex_r,
        apex_n
    );
}

// ============================================================
// Wave 2: remaining rule coverage (added 2026-05-17)
// ============================================================

// ---- D. Articulation boundary (continued) ----------------------

#[test]
fn test_soft_accent_boundary_outside_slur() {
    // softAccent (Bartók wedge) was added to the outside-boundary
    // set in commit 82b31aa1. The glyph must sit ABOVE the slur tip
    // for an above-curving slur.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "sa1", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"softAccent": {}},
                 "slurs": [{"target": "sa2", "side": "up"}]},
                {"id": "sa2", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (y1, _) = super::test_helpers::bezier_endpoints_y(bz);
    let sa_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_SOFT_ACCENT_ABOVE
                    || *codepoint == crate::render::smufl::smufl::ARTIC_SOFT_ACCENT_BELOW =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("soft-accent glyph");
    assert!(
        sa_y < y1,
        "soft-accent y={} should sit ABOVE slur tip y1={}",
        sa_y,
        y1
    );
}

#[test]
fn test_stress_boundary_outside_slur() {
    // stress marking is also outside-boundary per the same commit.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "st1", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"stress": {}},
                 "slurs": [{"target": "st2", "side": "up"}]},
                {"id": "st2", "duration": {"base": "half"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (y1, _) = super::test_helpers::bezier_endpoints_y(bz);
    let s_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_STRESS_ABOVE
                    || *codepoint == crate::render::smufl::smufl::ARTIC_STRESS_BELOW =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("stress glyph");
    assert!(
        s_y < y1,
        "stress y={} should sit ABOVE slur tip y1={}",
        s_y,
        y1
    );
}

// ---- D. Mixed-stem articulation pull (d193b0ed) ----------------

#[test]
fn test_mixed_stem_slur_side_artic_pulls_tip() {
    // Mixed-stem span E4→B5 with staccato on B5. B5 is stem-down so
    // its staccato sits ABOVE the notehead (notehead-side, which is
    // the slur side for an above-curving slur). The right tip must
    // clear (be at or above) the staccato.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ms1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}],
                 "markings": {"staccato": {}},
                 "slurs": [{"target": "ms4"}]},
                {"id": "ms2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 5}}],
                 "markings": {"staccato": {}}},
                {"id": "ms3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}],
                 "markings": {"staccato": {}}},
                {"id": "ms4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 5}}],
                 "markings": {"staccato": {}}}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (_, y2) = super::test_helpers::bezier_endpoints_y(bz);
    let (_, x2) = super::test_helpers::bezier_endpoints_x(bz);
    // Find the staccato glyph closest to x2 (the B5 dot).
    let b5_stac_y = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_ABOVE
                || *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_BELOW =>
            {
                Some(((*x - x2).abs(), *y))
            }
            _ => None,
        })
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap())
        .map(|(_, y)| y)
        .expect("staccato near right tip");
    // Right tip should be at or above the B5 staccato (covers the dot).
    assert!(
        y2 <= b5_stac_y + 0.5,
        "mixed-stem right tip y2={} must clear slur-side staccato y={}",
        y2,
        b5_stac_y
    );
}

#[test]
fn test_mixed_stem_endpoint_stays_near_stem_tip() {
    // Mixed-stem span E4→B5: E4 is stem-up so its staccato sits BELOW
    // (notehead-side for stem-up = below = OPPOSITE the above-curving
    // slur). The left slur endpoint belongs at the top of E4's stem, while
    // interior staccatos must not lift it beyond that attachment.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "mo1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}],
                 "markings": {"staccato": {}},
                 "slurs": [{"target": "mo4"}]},
                {"id": "mo2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 5}}],
                 "markings": {"staccato": {}}},
                {"id": "mo3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}],
                 "markings": {"staccato": {}}},
                {"id": "mo4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 5}}],
                 "markings": {"staccato": {}}}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let (x1, _) = super::test_helpers::bezier_endpoints_x(bz);
    let (y1, _) = super::test_helpers::bezier_endpoints_y(bz);
    let config = LayoutConfig::default();
    let sp = config.sp;
    let (stem_x, stem_tip_y) = dl
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
                && (y1 - y2).abs() > sp
                && (*width - config.stem_width * sp).abs() < 1.0e-6 =>
            {
                Some((*x1, y1.min(*y2)))
            }
            _ => None,
        })
        .min_by(|left, right| (left.0 - x1).abs().total_cmp(&(right.0 - x1).abs()))
        .expect("source stem");
    assert!(x1 > stem_x, "source tip must sit inside/right of its stem");
    let gap = (y1 - stem_tip_y).abs();
    assert!(
        gap <= 1.5 * sp,
        "mixed-stem left tip should stay near E4 stem tip: gap={:.3}sp",
        gap / sp
    );
}

// ---- E. Per-endpoint inner-articulation lift (74fea2f5) --------

#[test]
fn test_inner_artic_lift_is_per_endpoint() {
    // Asymmetric span (low → high) with inner staccato. Comparing WITH
    // vs WITHOUT the inner staccato: the LOW endpoint should lift more
    // than the HIGH endpoint. (Before the fix, a uniform delta lifted
    // both equally and the high tip ended up above its own notehead.)
    let with_inner = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "wi1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "wi3", "side": "up"}]},
                {"id": "wi2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "A", "octave": 5}}],
                 "markings": {"staccato": {}}},
                {"id": "wi3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "B", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let without_inner = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "wo1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "wo3", "side": "up"}]},
                {"id": "wo2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"id": "wo3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "B", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl_w = layout_score(&parse_mnx(with_inner).unwrap(), 0, &LayoutConfig::default());
    let dl_o = layout_score(
        &parse_mnx(without_inner).unwrap(),
        0,
        &LayoutConfig::default(),
    );
    let bz_w = dl_w
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur w");
    let bz_o = dl_o
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur o");
    let (y1_w, y2_w) = super::test_helpers::bezier_endpoints_y(bz_w);
    let (y1_o, y2_o) = super::test_helpers::bezier_endpoints_y(bz_o);
    // Lift = (without - with), positive = endpoint moved UP (smaller Y).
    let lift_low = y1_o - y1_w; // low endpoint (C5)
    let lift_high = y2_o - y2_w; // high endpoint (B5)
                                 // Low endpoint must lift at least as much as the high endpoint.
                                 // If both stayed put (lift~0) the test still passes — the rule we
                                 // assert is: the high endpoint is NEVER lifted more than the low.
    assert!(lift_low + 0.01 >= lift_high,
        "per-endpoint lift: low_lift={} should be >= high_lift={} (uniform lift would equalize them)",
        lift_low, lift_high);
}

// ---- A. Long-phrase contour-flip suppression (5923ebe7) --------

#[test]
fn test_long_phrase_mountain_does_not_flip_below() {
    // 7-note phrase forming a mountain: with >=5 inner notes the
    // contour flip is suppressed and the slur stays on the natural
    // (stem-opposite) side. All notes stem-down → slur should stay
    // ABOVE, not flip below despite the mountain shape.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "lp1", "duration": {"base": "eighth"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "lp7"}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "lp7", "duration": {"base": "eighth"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    assert!(
        super::test_helpers::is_curve_above(bz),
        "long-phrase mountain (>=5 inner notes) should NOT flip below"
    );
}

// ---- C. Apex line-snap (long phrase) ---------------------------

#[test]
fn test_apex_snaps_to_staff_line_for_long_phrase() {
    // Long phrase slur whose natural apex lands near a staff line:
    // the apex should snap onto a half-integer Y position (i.e.
    // a staff line or space center, NOT mid-bump). This test is
    // intentionally loose — it just asserts the apex is finite and
    // within the broader staff vicinity, locking out regressions
    // that would NaN/diverge the apex calculation.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ls1", "duration": {"base": "eighth"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "ls8", "side": "up"}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "stemDirection": "down", "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "ls8", "duration": {"base": "eighth"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur");
    let apex = super::test_helpers::bezier_apex_y(bz);
    assert!(
        apex.is_finite(),
        "long-phrase apex must be finite, got {}",
        apex
    );
    // Apex above the highest notehead (curve_above slur covers the line).
    let top_nh = super::test_helpers::topmost_notehead_y(&dl);
    assert!(
        apex < top_nh,
        "long-phrase slur apex y={} should sit above topmost notehead y={}",
        apex,
        top_nh
    );
}

// ---- I. Accidental NOT a slur obstacle (b7ff544e) --------------

#[test]
fn test_accidental_does_not_lift_slur_apex() {
    // A sharp accidental on an inner note should NOT cause the slur
    // apex to lift as if the sharp were a notehead. Compare with vs
    // without the accidental — apex Y must be ~identical.
    let with_sharp = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ws1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "ws3", "side": "up"}]},
                {"id": "ws2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "D", "octave": 5, "alter": 1}}]},
                {"id": "ws3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let no_sharp = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ns1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "ns3", "side": "up"}]},
                {"id": "ns2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "ns3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl_w = layout_score(&parse_mnx(with_sharp).unwrap(), 0, &LayoutConfig::default());
    let dl_n = layout_score(&parse_mnx(no_sharp).unwrap(), 0, &LayoutConfig::default());
    let apex_w = super::test_helpers::bezier_apex_y(
        dl_w.commands
            .iter()
            .find(|c| is_draw_bezier(c))
            .expect("slur w"),
    );
    let apex_n = super::test_helpers::bezier_apex_y(
        dl_n.commands
            .iter()
            .find(|c| is_draw_bezier(c))
            .expect("slur n"),
    );
    // Allow some difference (the sharp may shift spacing slightly) but
    // not by more than 1 sp (regression would lift by several sp).
    let sp = 4.0_f64;
    assert!(
        (apex_w - apex_n).abs() < sp,
        "accidental should not lift apex (with={}, without={})",
        apex_w,
        apex_n
    );
}

#[test]
fn test_outer_slur_clears_inner_tie_across_curve() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "quarter"}, "notes": [{"id": "n1", "pitch": {"step": "C", "octave": 4}}], "slurs": [{"target": "e6", "side": "down"}]},
                {"id": "e2", "duration": {"base": "quarter"}, "notes": [{"id": "n2", "pitch": {"step": "D", "octave": 4}}]},
                {"id": "e3", "duration": {"base": "quarter"}, "notes": [{"id": "n3", "pitch": {"step": "E", "octave": 4}}]},
                {"id": "e4", "duration": {"base": "quarter"}, "notes": [{"id": "n4", "pitch": {"step": "F", "octave": 4}, "ties": [{"target": "n5", "side": "down"}]}]},
                {"id": "e5", "duration": {"base": "quarter"}, "notes": [{"id": "n5", "pitch": {"step": "F", "octave": 4}}]},
                {"id": "e6", "duration": {"base": "quarter"}, "notes": [{"id": "n6", "pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let mut slur = None;
    let mut tie = None;
    for (index, command) in dl.commands.iter().enumerate() {
        if !matches!(command, RenderCommand::DrawFilledBezier { .. }) {
            continue;
        }
        match dl.element_ids.get(index).and_then(|id| id.as_deref()) {
            Some(id) if id.starts_with("slur/") => slur = Some(command),
            Some(id) if id.starts_with("tie/") => tie = Some(command),
            _ => {}
        }
    }
    let slur = slur.expect("outer slur");
    let tie = tie.expect("inner tie");
    let (tie_x1, tie_x2) = bezier_endpoints_x(tie);
    let clearance = 1.0 * config.sp;
    for fraction in [0.15, 0.3, 0.5, 0.7, 0.85] {
        let x = tie_x1 + (tie_x2 - tie_x1) * fraction;
        let slur_y = bezier_inner_y_at_x(slur, x);
        let tie_y = bezier_outer_y_at_x(tie, x);
        assert!(
            slur_y >= tie_y + clearance - 1.0e-6,
            "outer slur must clear inner tie at t={fraction:.2}: slur={slur_y:.3}, tie={tie_y:.3}"
        );
    }
}

/// Evaluate a cubic bezier at `t`.
fn cubic_at(p0: (f64, f64), p1: (f64, f64), p2: (f64, f64), p3: (f64, f64), t: f64) -> (f64, f64) {
    let u = 1.0 - t;
    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    (
        a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0,
        a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1,
    )
}

/// Walk a filled bezier's two contours in step, looking for the point where
/// the stroke turns inside out.
///
/// A slur is a stroke of finite width: the vector from the inner contour to
/// the outer one rotates smoothly along the span but never flips. Where it
/// flips, the outline has crossed itself and renders as a pinch or a spike.
/// Comparing each sample against the previous one needs no knowledge of which
/// way the curve bulges, and unlike a fixed reference direction it stays valid
/// as the stroke turns.
///
/// Returns `(reversed, min_width)` — whether the separation ever flipped, and
/// the narrowest the stroke ever gets.
fn stroke_inversion(command: &RenderCommand) -> Option<(bool, f64)> {
    let RenderCommand::DrawFilledBezier {
        x1,
        y1,
        x2,
        y2,
        ocx1,
        ocy1,
        ocx2,
        ocy2,
        icx1,
        icy1,
        icx2,
        icy2,
        ix1,
        iy1,
        ix2,
        iy2,
        ..
    } = command
    else {
        return None;
    };
    let outer = |t: f64| cubic_at((*x1, *y1), (*ocx1, *ocy1), (*ocx2, *ocy2), (*x2, *y2), t);
    let inner = |t: f64| {
        cubic_at(
            (*ix1, *iy1),
            (*icx1, *icy1),
            (*icx2, *icy2),
            (*ix2, *iy2),
            t,
        )
    };

    let steps = 400;
    let sep = |t: f64| {
        let (ox, oy) = outer(t);
        let (nx, ny) = inner(t);
        (ox - nx, oy - ny)
    };

    let mut prev = sep(0.0);
    let mut reversed = false;
    let mut min_width = (prev.0 * prev.0 + prev.1 * prev.1).sqrt();
    for i in 1..=steps {
        let t = f64::from(i) / f64::from(steps);
        let cur = sep(t);
        let width = (cur.0 * cur.0 + cur.1 * cur.1).sqrt();
        min_width = min_width.min(width);
        // Only meaningful while the stroke has some width; at a true tip the
        // separation legitimately shrinks toward the tip thickness.
        if prev.0 * cur.0 + prev.1 * cur.1 < 0.0 {
            reversed = true;
        }
        prev = cur;
    }
    Some((reversed, min_width))
}

#[test]
fn test_full_score_slurs_leave_noteheads_at_a_readable_angle() {
    // A slur should leave its notehead heading along the phrase, not square
    // to it. When a control point lands on its own endpoint — which the apex
    // shift could do, being bounded by the indent — the curve has no
    // along-chord travel there and departs at a right angle, reading as a
    // hook rather than the start of an arc.
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    );
    let json = std::fs::read_to_string(path).expect("Rhapsody fixture");
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };
    let mut worst: Vec<String> = Vec::new();
    for (view, score_index) in [("full score", 0), ("Horn 1 part", 15)] {
        let dl = layout_with_mnx_scores(&score, &config, score_index);
        for (index, command) in dl.commands.iter().enumerate() {
            let RenderCommand::DrawFilledBezier {
                x1,
                y1,
                x2,
                y2,
                ocx1,
                ocy1,
                ocx2,
                ocy2,
                ..
            } = command
            else {
                continue;
            };
            let id = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .unwrap_or("");
            if !id.starts_with("slur/") {
                continue;
            }
            let chord = (x2 - x1, y2 - y1);
            let clen = (chord.0 * chord.0 + chord.1 * chord.1).sqrt().max(1e-9);
            for (name, tx, ty) in [
                ("start", ocx1 - x1, ocy1 - y1),
                ("end", ocx2 - x2, ocy2 - y2),
            ] {
                let tlen = (tx * tx + ty * ty).sqrt().max(1e-9);
                let cosang = ((tx * chord.0 + ty * chord.1) / (tlen * clen)).abs();
                let angle = cosang.clamp(-1.0, 1.0).acos().to_degrees();
                // Headroom over the 67 degrees the tuned bounds actually
                // produce; anything approaching a right angle is the defect.
                if angle > 75.0 {
                    worst.push(format!("{view}/{id}: {name} departs at {angle:.1} deg"));
                }
            }
        }
    }

    assert!(
        worst.is_empty(),
        "{} slur ends leave their notehead nearly square to the chord: {:?}",
        worst.len(),
        &worst[..worst.len().min(6)]
    );
}

#[test]
fn test_full_score_slur_tips_stay_on_the_inner_side() {
    // Each tip is placed by stepping from the endpoint along the perpendicular
    // of the *local* tangent, then flipped to face away from the bulge. When
    // the curve departs its endpoint steeply that local perpendicular turns
    // nearly parallel to the chord, the flip test approaches zero, and the tip
    // can land on the wrong side — folding the outline right at the tip.
    //
    // The bulge direction is recoverable from the command itself: the outer
    // control points are displaced from the spine by +p, the inner ones by -p.
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    );
    let json = std::fs::read_to_string(path).expect("Rhapsody fixture");
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };

    let mut offenders: Vec<String> = Vec::new();
    // Both the full score and the Horn 1 part: the two views space the same
    // music differently, so a degenerate departure in one need not appear in
    // the other.
    for (view, score_index) in [("full score", 0), ("Horn 1 part", 15)] {
        let dl = layout_with_mnx_scores(&score, &config, score_index);
        for (index, command) in dl.commands.iter().enumerate() {
            let RenderCommand::DrawFilledBezier {
                x1,
                y1,
                x2,
                y2,
                ocx1,
                ocy1,
                icx1,
                icy1,
                ix1,
                iy1,
                ix2,
                iy2,
                ..
            } = command
            else {
                continue;
            };
            let id = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .unwrap_or("<none>");
            if !id.starts_with("slur/") {
                continue;
            }
            // Bulge direction, from outer control point minus inner.
            let (bx, by) = (ocx1 - icx1, ocy1 - icy1);
            let blen = (bx * bx + by * by).sqrt();
            if blen < 1e-9 {
                continue;
            }
            let (bx, by) = (bx / blen, by / blen);
            for (name, ex, ey, tx, ty) in [
                ("start", *x1, *y1, *ix1, *iy1),
                ("end", *x2, *y2, *ix2, *iy2),
            ] {
                // The tip must step *against* the bulge, i.e. toward the
                // staff. Zero is a failure too: it means the step went along
                // the stroke rather than across it, which is the degenerate
                // case this guards.
                let dot = (tx - ex) * bx + (ty - ey) * by;
                if dot > -1e-9 {
                    offenders.push(format!("{view}/{id}: {name} tip flipped ({dot:.3})"));
                }
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "{} slur tips sit on the wrong side of the stroke: {:?}",
        offenders.len(),
        &offenders[..offenders.len().min(6)]
    );
}

#[test]
fn test_full_score_emits_each_slur_once() {
    // Two copies of one slur, drawn with different endpoint stacking ranks,
    // cross near their shared endpoints and read as a pinch there — while the
    // middle, where they nearly coincide, looks like a single clean curve.
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    );
    let json = std::fs::read_to_string(path).expect("Rhapsody fixture");
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };

    let dl = layout_with_mnx_scores(&score, &config, 0);

    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (index, command) in dl.commands.iter().enumerate() {
        if !matches!(command, RenderCommand::DrawFilledBezier { .. }) {
            continue;
        }
        let Some(id) = dl.element_ids.get(index).and_then(Option::as_deref) else {
            continue;
        };
        if id.starts_with("slur/") {
            *counts.entry(id).or_default() += 1;
        }
    }
    let mut dupes: Vec<String> = counts
        .iter()
        .filter(|(_, &n)| n > 1)
        .map(|(id, n)| format!("{id} x{n}"))
        .collect();
    dupes.sort();

    assert!(
        dupes.is_empty(),
        "{} slurs are drawn more than once: {:?}",
        dupes.len(),
        &dupes[..dupes.len().min(6)]
    );
}

#[test]
fn test_full_score_slur_strokes_never_invert() {
    // The reported "pinch" is the slur's outline crossing itself: the inner
    // contour passes through the outer one, so instead of tapering to a point
    // the tip folds into a spike. Walk both contours of every slur and require
    // the stroke never to turn inside out.
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    );
    let json = std::fs::read_to_string(path).expect("Rhapsody fixture");
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };

    let dl = layout_with_mnx_scores(&score, &config, 0);

    let mut offenders: Vec<String> = Vec::new();
    for (index, command) in dl.commands.iter().enumerate() {
        let id = dl
            .element_ids
            .get(index)
            .and_then(Option::as_deref)
            .unwrap_or("<none>");
        if !id.starts_with("slur/") {
            continue;
        }
        let Some((reversed, min_width)) = stroke_inversion(command) else {
            continue;
        };
        if reversed {
            offenders.push(format!("{id}: inverts, min width {min_width:.3}"));
        }
    }

    assert!(
        offenders.is_empty(),
        "{} slur strokes turn inside out: {:?}",
        offenders.len(),
        &offenders[..offenders.len().min(6)]
    );
}

#[test]
fn test_full_score_horizon_slurs_never_double_back() {
    // A slur whose control point passes either endpoint doubles back on
    // itself, and the tapered tip renders as a pinch or a curl instead of a
    // clean point. Standard engraving has no such shape, and neither does a
    // correct bezier: the tangent at an endpoint must point into the span.
    //
    // Checked over every slur in the full score (index 0) in horizon mode,
    // which is where the pinch was reported; the Horn 1 part view is clean.
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    );
    let json = std::fs::read_to_string(path).expect("Rhapsody fixture");
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };

    let dl = layout_with_mnx_scores(&score, &config, 0);

    let mut offenders: Vec<String> = Vec::new();
    for (index, command) in dl.commands.iter().enumerate() {
        let RenderCommand::DrawFilledBezier {
            x1,
            x2,
            ocx1,
            ocx2,
            icx1,
            icx2,
            ..
        } = command
        else {
            continue;
        };
        let id = dl
            .element_ids
            .get(index)
            .and_then(Option::as_deref)
            .unwrap_or("<none>");
        if !id.starts_with("slur/") {
            continue;
        }
        let (lo, hi) = if x1 < x2 { (*x1, *x2) } else { (*x2, *x1) };
        // No tolerance. A contour control point even slightly past its
        // endpoint reverses the outline there, and the half-thickness offset
        // that causes it is only ~0.15sp — a loose tolerance hides it.
        let tol = 1e-6;
        for (name, cx) in [
            ("ocx1", *ocx1),
            ("ocx2", *ocx2),
            ("icx1", *icx1),
            ("icx2", *icx2),
        ] {
            if cx < lo - tol || cx > hi + tol {
                offenders.push(format!(
                    "{id}: {name}={cx:.1} outside span [{lo:.1}, {hi:.1}]"
                ));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "{} slur control points pass their endpoint and double the curve \
         back: {:?}",
        offenders.len(),
        &offenders[..offenders.len().min(5)]
    );
}

#[test]
fn test_rhapsody_horn1_slurs_stay_outside_their_ties() {
    // Horn 1, mm. 2-5 carries both range relations against a slur:
    // a tie that ends where the slur ends (converging tips) and a tie
    // that starts where the slur starts (diverging tips). Both must keep
    // the tie strictly inside the slur, including at the shared notehead.
    //
    // Checked in horizon mode (`page_width: None`) against both the part
    // view (score 15 = Horn 1) and the full score (score 0). The two views
    // space the passage differently, and the full score previously fused the
    // slur tip into the tie tip at the shared notehead while the part view
    // did not — so a single view is not enough coverage.
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    );
    let json = std::fs::read_to_string(path).expect("Rhapsody fixture");
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let groups = [
        (
            "tie at slur end",
            "slur/019e8ea7-4cff-73a9-bb13-1568172e43d6/019e8ea7-4cff-777b-88cb-3c722a884c23",
            "tie/019e8ea7-4e2a-7376-b328-1eb160e2df7b/019e8ea7-4cff-7a1f-a53d-e87b7ac2aa4d",
        ),
        (
            "tie at slur start",
            "slur/019e8ea7-4cff-7c8a-b860-d9ffed6ff3a0/019e8ea7-4cff-7ffe-a6c5-5fff0653edcd",
            "tie/019e8ea7-4e2a-7582-ad98-c92eaf943e1c/019e8ea7-4cff-764c-a36a-b3e54d31fe8e",
        ),
    ];
    // The slur must hold roughly its designed stacking step away from the tie
    // for the whole overlap. The defect this guards is convergence: the slur
    // sagging into the tie until the two read as one fused stroke. Deriving
    // the floor from the step (with tolerance for the staff-line snap) keeps
    // the test honest if the stack spacing is ever retuned.
    let clearance = 0.9 * crate::layout::slurs::tuning::TIP_STACK_STEP_SP * config.sp;
    // A tie sitting near one end of the slur must not balloon the whole arc:
    // shifting the apex toward it is what keeps the curve outside without
    // diving toward the staff below.
    let max_excursion = 4.0 * config.sp;
    for (view, score_index) in [("part view", 15), ("full score", 0)] {
        let dl = layout_with_mnx_scores(&score, &config, score_index);
        let find_curve = |element_id: &str| {
            dl.commands
                .iter()
                .enumerate()
                .find_map(|(index, command)| {
                    (dl.element_ids.get(index).and_then(Option::as_deref) == Some(element_id))
                        .then_some(command)
                })
                .unwrap_or_else(|| panic!("{view}: missing curve {element_id}"))
        };
        for (label, slur_id, tie_id) in groups {
            let slur = find_curve(slur_id);
            let tie = find_curve(tie_id);
            // A control point that overshoots its endpoint makes the curve
            // double back, inverting the tapered tip into a visible bowtie.
            if let RenderCommand::DrawFilledBezier {
                x1, x2, ocx1, ocx2, ..
            } = slur
            {
                let span = x2 - x1;
                let f1 = (ocx1 - x1) / span;
                let f2 = (ocx2 - x1) / span;
                assert!(
                    (0.0..=1.0).contains(&f1) && (0.0..=1.0).contains(&f2),
                    "{view}/{label}: slur control points must stay between the endpoints, got f1={f1:.3} f2={f2:.3}"
                );
            }
            let (tie_x1, tie_x2) = bezier_endpoints_x(tie);
            for fraction in [0.0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 0.95, 1.0] {
                let x = tie_x1 + (tie_x2 - tie_x1) * fraction;
                let slur_y = bezier_inner_y_at_x(slur, x);
                let tie_y = bezier_outer_y_at_x(tie, x);
                assert!(
                    slur_y >= tie_y + clearance - 1.0e-6,
                    "{view}/{label}: slur must stay outside the tie at t={fraction:.2}: slur={slur_y:.3}, tie={tie_y:.3}"
                );
                assert!(
                    slur_y <= tie_y + max_excursion,
                    "{view}/{label}: slur must not balloon past the tie at t={fraction:.2}: slur={slur_y:.3}, tie={tie_y:.3}"
                );
            }
        }
    }
}

#[test]
fn test_stacked_slurs_and_tie_take_separate_endpoint_lanes() {
    // Two nested slurs and a tie all start on the same notehead and all
    // curve above. Each must take its own lane outward, innermost first:
    // tie (hugs the head) < inner slur < outer slur.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "sk1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"id": "kn_a", "pitch": {"step": "C", "octave": 5}, "ties": [{"target": "kn_b"}]}],
                 "slurs": [{"target": "sk3", "side": "up"}, {"target": "sk4", "side": "up"}]},
                {"id": "sk2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"id": "kn_b", "pitch": {"step": "C", "octave": 5}}]},
                {"id": "sk3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "sk4", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let curve_start_y = |element_id: &str| {
        dl.commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| {
                (dl.element_ids.get(index).and_then(Option::as_deref) == Some(element_id))
                    .then(|| super::test_helpers::bezier_endpoints_y(command).0)
            })
            .unwrap_or_else(|| panic!("missing curve {element_id}"))
    };
    let tie_y = curve_start_y("tie/kn_a/kn_b");
    let inner_y = curve_start_y("slur/sk1/sk3");
    let outer_y = curve_start_y("slur/sk1/sk4");
    // Curves above the staff stack toward smaller Y. Each connector clears the
    // previous graver tip by one stack step.
    assert!(
        inner_y <= tie_y - 0.6 * config.sp,
        "inner slur tip {inner_y:.3} must clear tie tip {tie_y:.3} by a stack step"
    );
    assert!(
        outer_y < inner_y - 1.0e-6,
        "outer slur tip {outer_y:.3} must sit beyond inner slur tip {inner_y:.3}"
    );
}

// ---- H. Tie integration: slur starts after tied note

#[test]
fn test_slur_with_tied_source_renders_without_crash() {
    // When the slur source is the SECOND note of a tied pair, the
    // engine must still emit a slur bezier (regression: no panic,
    // no missing-target error, no NaN endpoints). We deliberately
    // do NOT pin the exact X here — current x-anchor heuristics for
    // tied sources are still tuned; pinning would create false
    // regressions during further standard engraving-G10 work.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ta1", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"id": "na", "pitch": {"step": "A", "octave": 4}, "ties": [{"target": "nb"}]}]},
                {"id": "ta2", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"id": "nb", "pitch": {"step": "A", "octave": 4}}],
                 "slurs": [{"target": "ta3", "side": "up"}]},
                {"id": "ta3", "duration": {"base": "quarter"}, "stemDirection": "down",
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let beziers: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawFilledBezier { .. }))
        .collect();
    // Must produce at least one bezier (the slur), plus possibly a tie.
    assert!(
        !beziers.is_empty(),
        "expected slur bezier when source is tied"
    );
    // All endpoints must be finite.
    for bz in &beziers {
        let (x1, x2) = super::test_helpers::bezier_endpoints_x(bz);
        let (y1, y2) = super::test_helpers::bezier_endpoints_y(bz);
        assert!(
            x1.is_finite() && x2.is_finite() && y1.is_finite() && y2.is_finite(),
            "bezier endpoints must be finite (x1={}, x2={}, y1={}, y2={})",
            x1,
            x2,
            y1,
            y2
        );
    }
}

// ---- F. Staccato outside-staff for stem-up upper-half note -----
//   (this complements the earlier test_staccato_outside_staff_*)

#[test]
fn test_staccato_for_below_staff_note_stays_close() {
    // C4 (well below staff, stem-up default) with staccato. The dot
    // should sit BELOW the notehead (stem-opposite, since stem-up).
    // It should NOT be artificially pushed to "outside the staff" —
    // the staff is far above C4 already.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "bs1", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "C", "octave": 4}}],
                 "markings": {"staccato": {}}},
                {"duration": {"base": "quarter", "dots": 1}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let stac = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_ABOVE
                    || *codepoint == crate::render::smufl::smufl::ARTIC_STACCATO_BELOW =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("staccato glyph");
    let c4_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawEllipse { cy, .. } => Some(*cy),
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if (0xE0A0..=0xE0A4).contains(codepoint) =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("notehead");
    // Dot below notehead (stem-opposite for stem-up).
    assert!(
        stac > c4_y,
        "C4 staccato y={} should sit BELOW notehead y={} (stem-up stem-opposite)",
        stac,
        c4_y
    );
    // …and not absurdly far (regression check: within 3 sp).
    let sp_est = 6.0; // approx staff space at default config (8pt staff_y units)
    assert!(
        (stac - c4_y).abs() < sp_est * 3.0,
        "C4 staccato shouldn't be pushed dramatically away from notehead (gap={})",
        stac - c4_y
    );
}

// ---- Regression: ledger/tie shape obstacles must be filtered to staff band ----

/// Regression test for the bug where `render_slurs` treated LedgerLine and
/// Tie shapes from EVERY staff and system (via the global `dl.element_shapes`
/// list) as in-range obstacles. On multi-staff scores like the Beethoven 5
/// finale, a slur near the bottom of system 6 (chord y ~9400) would see
/// ledger lines at the top of system 0 (y ~491) as 8000+ px intrusions,
/// blowing through the shoulder cap and triggering an endpoint-lift overflow
/// that yanked the bezier endpoints to ~y=-50,000 - far above a 21,000-px
/// canvas. Fix: filter shape-based obstacles to a vertical band around the
/// current staff's `staff_y` before adding them to the obstacle list.
///
/// This test loads the actual Beethoven 5 finale score (the score that
/// triggered the report), runs page-mode layout, and asserts every slur
/// bezier's outer endpoints fall inside the rendered canvas. Without the
/// fix, the min slur y1 was approximately -50,008 on a canvas of height
/// ~21,700; with the fix it sits at ~3,107.
#[test]
fn test_slur_bezier_endpoints_stay_within_canvas_on_dense_orchestral_score() {
    use crate::layout::mnx_layout::layout_with_mnx_scores;

    let json = include_str!("../../../../../packages/format/fixtures/mnx/beethoven-5-finale.mnx");
    let score = parse_mnx(json).expect("parse beethoven-5-finale.mnx");

    let config = LayoutConfig {
        page_width: Some(2480.0),
        page_height: 3508.0,
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Collect every slur-tagged DrawFilledBezier (cross-system halves use
    // /lh and /rh suffixes; the in-system path uses the plain `slur/...` id).
    // The original regression specifically hit the in-system path.
    let mut slur_y_extremes: Vec<(String, f64, f64)> = Vec::new();
    for (i, cmd) in dl.commands.iter().enumerate() {
        if let RenderCommand::DrawFilledBezier { y1, y2, .. } = cmd {
            let id = dl
                .element_ids
                .get(i)
                .and_then(|o| o.as_deref())
                .unwrap_or("");
            if !id.starts_with("slur/") {
                continue;
            }
            slur_y_extremes.push((id.to_string(), *y1, *y2));
        }
    }

    assert!(
        !slur_y_extremes.is_empty(),
        "Beethoven 5 finale should produce at least one slur bezier"
    );

    // Allow a small margin above the canvas top (slurs that curve above the
    // top staff can legitimately sit at slightly negative Y), but anything
    // more than a few staff-spaces above the canvas is the regression.
    let sp = config.sp;
    let lo_bound = -6.0 * sp; // a few staff spaces of slack
    let hi_bound = dl.height + 6.0 * sp;

    let mut bad: Vec<String> = Vec::new();
    for (id, y1, y2) in &slur_y_extremes {
        if *y1 < lo_bound || *y2 < lo_bound || *y1 > hi_bound || *y2 > hi_bound {
            bad.push(format!("  {id}: y1={:.1} y2={:.1}", y1, y2));
        }
    }

    assert!(
        bad.is_empty(),
        "Slur bezier endpoints escaped canvas bounds [{:.1}, {:.1}] (dl.height={:.1}). \
         This is the off-staff-shape-obstacle regression (slurs.rs `for shape in &dl.element_shapes` \
         must filter by Y proximity to the current `staff_y`):\n{}",
        lo_bound, hi_bound, dl.height,
        bad.join("\n")
    );
}

#[test]
fn test_expansion_staff_slurs_ignore_condensed_staff_shapes() {
    use crate::layout::mnx_layout::layout_with_mnx_scores;

    let json = r##"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"id": "P1", "name": "Flute 1", "shortName": "Fl. 1", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"id": "p1a", "duration": {"base": "quarter"}, "markings": {"staccato": {}},
                     "notes": [{"pitch": {"step": "E", "octave": 5}}],
                     "slurs": [{"target": "p1c", "side": "up"}]},
                    {"id": "p1b", "duration": {"base": "quarter"}, "markings": {"staccato": {}},
                     "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                    {"id": "p1c", "duration": {"base": "half"}, "markings": {"staccato": {}},
                     "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                ]}]
            }]},
            {"id": "P2", "name": "Flute 2", "shortName": "Fl. 2", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"id": "p2a", "duration": {"base": "quarter"}, "markings": {"staccato": {}},
                     "notes": [{"pitch": {"step": "C", "octave": 5}}],
                     "slurs": [{"target": "p2c", "side": "up"}]},
                    {"id": "p2b", "duration": {"base": "quarter"}, "markings": {"staccato": {}},
                     "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"id": "p2c", "duration": {"base": "half"}, "markings": {"staccato": {}},
                     "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]}]
            }]}
        ],
        "layouts": [{"id": "cond", "content": [
            {"type": "staff", "label": "Fl. 1, 2", "sources": [{"part": "P1"}, {"part": "P2"}]},
            {"type": "staff", "label": "Fl. 1", "sources": [{"part": "P1"}], "_expansion": true},
            {"type": "staff", "label": "Fl. 2", "sources": [{"part": "P2"}], "_expansion": true}
        ]}],
        "scores": [{"name": "Condensed", "pages": [{"systems": [{"measure": "0", "layout": "cond"}]}]}]
    }"##;

    let score = parse_mnx(json).expect("parse expansion slur regression");
    let config = LayoutConfig {
        page_width: Some(900.0),
        page_height: 700.0,
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let sp = config.sp;

    let expansion_bands: Vec<(f64, f64)> = dl
        .measure_bounds
        .iter()
        .filter(|mb| mb.is_expansion)
        .map(|mb| (mb.y - 6.0 * sp, mb.y + mb.height + 8.0 * sp))
        .collect();
    assert_eq!(
        expansion_bands.len(),
        2,
        "expected two expansion staff bounds"
    );

    let mut expansion_slur_count = 0;
    let mut bad = Vec::new();
    for cmd in &dl.commands {
        let RenderCommand::DrawFilledBezier { y1, y2, color, .. } = cmd else {
            continue;
        };
        if color != "#667890" {
            continue;
        }
        expansion_slur_count += 1;
        let in_expansion_band = expansion_bands
            .iter()
            .any(|(lo, hi)| *y1 >= *lo && *y1 <= *hi && *y2 >= *lo && *y2 <= *hi);
        if !in_expansion_band {
            bad.push(format!("y1={:.1} y2={:.1}", y1, y2));
        }
    }

    assert_eq!(
        expansion_slur_count, 2,
        "expected one slur on each expansion staff"
    );
    assert!(bad.is_empty(),
        "expansion slurs should stay anchored to expansion staff bands, not condensed-staff duplicate shapes: {}",
        bad.join(", ")
    );

    let bogus_continuations: Vec<String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_deref())
        .filter(|id| id.starts_with("slur/") && (id.ends_with("/lh") || id.ends_with("/rh")))
        .map(|id| id.to_string())
        .collect();
    assert!(
        bogus_continuations.is_empty(),
        "same-system condensed/expansion duplicate IDs must not emit cross-system slur halves: {}",
        bogus_continuations.join(", ")
    );
}

/// Regression: an engrave-mode slur shape override (`_x.viritura.shape`) must
/// change the measure content hash. The hash is the per-system retention-cache
/// key; the model `Slur.shape` field is `skip_serializing`, so before the fix
/// the `serde_json::to_string(&rm.part)` inside `measure_content_hash` never
/// saw the override → a shape-only handle drag produced an identical hash →
/// the stale slur segment was reused on warm relayout and the edit had no
/// visible effect. Folding the slur shapes into the hash invalidates the cache.
#[test]
fn test_slur_shape_override_changes_content_hash() {
    use crate::layout::cache::measure_content_hash;
    use crate::layout::resolve::resolve_measures;
    use crate::model::event::{SequenceContent, SlurShape};

    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "s1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"side": "up", "target": "s2"}]},
                {"id": "s2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let mut score = parse_mnx(json).unwrap();
    let hash_before = measure_content_hash(&resolve_measures(&score, 0)[0]);

    // Apply a p3 endpoint delta to the slur, exactly as an engrave handle drag
    // would (setSlurShapeInScore → `_x.viritura.shape`).
    let seq = &mut score.parts[0].measures[0].sequences[0];
    let mut applied = false;
    for item in &mut seq.content {
        if let SequenceContent::Event(ev) = item {
            if let Some(slurs) = ev.slurs.as_mut() {
                slurs[0].shape = Some(SlurShape {
                    p3: Some([2.0, 1.0]),
                    ..Default::default()
                });
                applied = true;
            }
        }
    }
    assert!(applied, "test fixture must contain a slur to override");

    let hash_after = measure_content_hash(&resolve_measures(&score, 0)[0]);
    assert_ne!(
        hash_before, hash_after,
        "slur shape override must change the measure content hash so the retention cache re-renders the slur"
    );
}

#[test]
fn test_slur_end_anchors_at_notehead_not_augmentation_dot() {
    // Standard engraving practice: a slur ends at the notehead, NOT at a
    // trailing augmentation dot. The dot sits clear of the curve in its own
    // staff space, so the slur endpoint must stay over the notehead and must
    // not be extended rightward past the dot.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ad1", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "ad2", "side": "up"}]},
                {"id": "ad2", "duration": {"base": "half", "dots": 1},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());

    let bz = dl
        .commands
        .iter()
        .find(|c| is_draw_bezier(c))
        .expect("slur bezier");
    let (_x1, x2) = super::test_helpers::bezier_endpoints_x(bz);

    // Left edge of the augmentation dot glyph (the trailing dot on ad2).
    let dot_x = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::AUGMENTATION_DOT =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("augmentation dot glyph");

    // Rightmost notehead = the slur target (E5 sits later in time).
    let target_nh_x = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if (0xE0A0..=0xE0A4).contains(codepoint) =>
            {
                Some(*x)
            }
            RenderCommand::DrawEllipse { cx, .. } => Some(*cx),
            _ => None,
        })
        .fold(f64::MIN, f64::max);

    // The slur end must sit at the target notehead, before the dot.
    assert!(
        x2 < dot_x,
        "slur end x2={x2} must stay left of the augmentation dot x={dot_x} \
         (slur ends at the notehead, not the dot)"
    );
    assert!(
        x2 >= target_nh_x - 0.5,
        "slur end x2={x2} should anchor at the target notehead x={target_nh_x}, not retreat from it"
    );
}

#[test]
#[allow(clippy::too_many_lines)] // One shared synthetic fixture compares paged halves, stitched continuity, endpoint anchoring, dependents, and obstacle lift.
fn test_slur_across_chunk_seam_stays_continuous_in_stitched_horizon() {
    // In stitched-horizon mode the galley is split into retention chunks, each
    // with its own system_idx but laid on ONE continuous row. A slur whose
    // endpoints land in different chunks is dropped by the per-staff
    // `render_slurs` pass (different system_idx) and resolved by
    // `render_cross_system_slurs`. At a REAL page/system break that emits two
    // trailing half-curves (`/lh` + `/rh`); across a stitched chunk seam it
    // must instead emit ONE continuous arc. This unit-tests that branch
    // directly (mirrors the tie regression guard) — the chunking machinery
    // needs a full MNX score to engage, which is fragile to hand-build, so we
    // exercise the post-pass with synthetic `GlobalSlurEvent`s.
    use crate::layout::slurs::participation::endpoint_snapshot;
    use crate::layout::slurs::{render_cross_system_slurs, GlobalSlurEvent, SystemSlurBounds};
    use crate::model::event::Slur;
    use std::collections::HashMap;
    use std::rc::Rc;

    let slur = Slur {
        target: "b".to_string(),
        side: None,
        side_end: None,
        line_type: None,
        start_note: None,
        end_note: None,
        shape: None,
    };
    let make = |id: &str, x: f64, system_idx: usize, slurs: Vec<Slur>| GlobalSlurEvent {
        event_id: Rc::from(id),
        endpoint: endpoint_snapshot(
            x, 0.0, 0.0, true, true, 12.0, 1, 100.0, 1, 1, 0, 1.0, false, false, None,
        ),
        system_idx,
        part_index: 0,
        staff_idx: 0,
        slurs,
        note_positions: Vec::new(),
        tie_links: Vec::new(),
    };
    // Source (left of seam, chunk 0) slurred to target (right of seam, chunk 1).
    let src = make("a", 50.0, 0, vec![slur]);
    let tgt = make("b", 400.0, 1, vec![]);
    let events = vec![src, tgt];

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

    let slur_ids = |dl: &DisplayList| -> std::collections::HashSet<String> {
        dl.element_ids
            .iter()
            .filter_map(|id| id.as_deref())
            .filter(|id| id.starts_with("slur/"))
            .map(|id| id.to_string())
            .collect()
    };

    let stem_slur = Slur {
        target: "stem-tgt".to_string(),
        side: Some("up".to_string()),
        side_end: None,
        line_type: None,
        start_note: None,
        end_note: None,
        shape: None,
    };
    let mut stem_src = make("stem-src", 50.0, 0, vec![stem_slur]);
    stem_src.endpoint.is_beamed = true;
    stem_src.endpoint.beam_top_y = Some(50.0);
    let stem_tgt = make("stem-tgt", 400.0, 1, vec![]);
    let mut dl_stem = DisplayList::new(600.0, 200.0);
    render_cross_system_slurs(
        &mut dl_stem,
        &[stem_src, stem_tgt],
        &bounds,
        sp,
        &config,
        false,
    );
    let stem_outgoing_half = dl_stem
        .commands
        .iter()
        .enumerate()
        .find(|(index, command)| {
            matches!(command, RenderCommand::DrawFilledBezier { .. })
                && dl_stem.element_ids[*index].as_deref() == Some("slur/stem-src/stem-tgt/lh")
        })
        .map(|(_, command)| command)
        .expect("outgoing stem-side cross-system slur half");
    let RenderCommand::DrawFilledBezier { x1, y1, .. } = stem_outgoing_half else {
        unreachable!();
    };
    assert!(
        *x1 > 56.0 + 0.2 * sp,
        "upward cross-system slur must leave stem-up source on its stem side: x1={x1:.2}"
    );
    assert!(
        *y1 < 50.0 - 0.3 * sp,
        "upward cross-system slur tip must clear the source beam: y1={y1:.2}"
    );

    let tied_slur = Slur {
        target: "tied-tgt".to_string(),
        side: None,
        side_end: None,
        line_type: None,
        start_note: None,
        end_note: None,
        shape: None,
    };
    let mut tied_src = make("tied-src", 50.0, 0, vec![tied_slur]);
    tied_src.endpoint.outgoing_tie = true;
    tied_src.endpoint.stem_up = false;
    let first_after_break = make("tied-continuation", 340.0, 1, vec![]);
    let tied_tgt = make("tied-tgt", 400.0, 1, vec![]);
    let mut dl_tied = DisplayList::new(600.0, 200.0);
    render_cross_system_slurs(
        &mut dl_tied,
        &[tied_src, first_after_break, tied_tgt],
        &bounds,
        sp,
        &config,
        false,
    );
    let tied_outgoing_half = dl_tied
        .commands
        .iter()
        .enumerate()
        .find(|(index, command)| {
            matches!(command, RenderCommand::DrawFilledBezier { .. })
                && dl_tied.element_ids[*index].as_deref() == Some("slur/tied-src/tied-tgt/lh")
        })
        .map(|(_, command)| command)
        .expect("outgoing slur half sharing a tied source");
    assert!(
        matches!(
            tied_outgoing_half,
            RenderCommand::DrawFilledBezier { y1, ocy1, .. } if ocy1 < y1
        ),
        "an automatic cross-system slur sharing its source with a tie must curve above"
    );
    let tied_incoming_half = dl_tied
        .commands
        .iter()
        .enumerate()
        .find(|(index, command)| {
            matches!(command, RenderCommand::DrawFilledBezier { .. })
                && dl_tied.element_ids[*index].as_deref() == Some("slur/tied-src/tied-tgt/rh")
        })
        .map(|(_, command)| command)
        .expect("incoming slur half after a tied continuation");
    assert!(
        matches!(
            tied_incoming_half,
            RenderCommand::DrawFilledBezier { x1, y1, ocy1, .. }
                if *x1 <= 340.0 - 0.5 * sp && ocy1 < y1
        ),
        "incoming automatic slur must hang left of the first event and curve above"
    );

    // Real break (stitched_horizon = false): two trailing halves.
    let mut dl_paged = DisplayList::new(600.0, 200.0);
    render_cross_system_slurs(&mut dl_paged, &events, &bounds, sp, &config, false);
    let paged = slur_ids(&dl_paged);
    assert!(
        paged.contains("slur/a/b/lh") && paged.contains("slur/a/b/rh"),
        "a real system break should split the slur into /lh + /rh halves; got: {paged:?}"
    );
    assert!(
        !paged.contains("slur/a/b"),
        "a real break should NOT also emit a continuous slur; got: {paged:?}"
    );
    let paged_shape_ids: std::collections::HashSet<&str> = dl_paged
        .element_shapes
        .iter()
        .filter(|shape| shape.kind == ElementKind::Slur)
        .map(|shape| shape.element_id.as_str())
        .collect();
    assert_eq!(
        paged_shape_ids,
        std::collections::HashSet::from(["slur/a/b/lh", "slur/a/b/rh"]),
        "each continuation half must publish one connector band"
    );
    assert_eq!(
        dl_paged.slur_geometries.len(),
        2,
        "each continuation half must publish editable spine geometry"
    );

    let middle_slur = Slur {
        target: "middle-target".to_string(),
        side: Some("up".to_string()),
        side_end: None,
        line_type: None,
        start_note: None,
        end_note: None,
        shape: None,
    };
    let middle_src = make("middle-source", 50.0, 0, vec![middle_slur]);
    let middle_event = make("middle-event", 350.0, 1, vec![]);
    let middle_tgt = make("middle-target", 650.0, 2, vec![]);
    let mut middle_bounds = bounds.clone();
    middle_bounds.insert(
        (2, 0, 0),
        SystemSlurBounds {
            left_x: 600.0,
            right_x: 800.0,
        },
    );
    let mut dl_middle = DisplayList::new(900.0, 300.0);
    render_cross_system_slurs(
        &mut dl_middle,
        &[middle_src, middle_event, middle_tgt],
        &middle_bounds,
        sp,
        &config,
        false,
    );
    let middle_ids = slur_ids(&dl_middle);
    assert_eq!(
        middle_ids,
        std::collections::HashSet::from([
            "slur/middle-source/middle-target/lh".to_string(),
            "slur/middle-source/middle-target/mid/1".to_string(),
            "slur/middle-source/middle-target/rh".to_string(),
        ])
    );
    assert_eq!(dl_middle.slur_geometries.len(), 3);
    assert!(
        dl_middle
            .slur_geometries
            .iter()
            .all(|geometry| geometry.curve_dir < 0.0),
        "every broken piece must inherit the parent slur direction"
    );
    let middle_geometry = dl_middle
        .slur_geometries
        .iter()
        .find(|geometry| geometry.element_id.ends_with("/mid/1"))
        .expect("middle-system slur geometry");
    assert!(
        middle_geometry.p1_y.min(middle_geometry.p2_y) < 100.0 - config.notehead_ry * sp,
        "middle-system slur must arch clear of its local note column"
    );

    let mixed_slur = Slur {
        target: "mixed-target".to_string(),
        side: None,
        side_end: None,
        line_type: None,
        start_note: None,
        end_note: None,
        shape: None,
    };
    let mixed_src = make("mixed-source", 50.0, 0, vec![mixed_slur]);
    let mut mixed_tgt = make("mixed-target", 400.0, 1, vec![]);
    mixed_tgt.endpoint.stem_up = false;
    let mut dl_mixed = DisplayList::new(600.0, 200.0);
    render_cross_system_slurs(
        &mut dl_mixed,
        &[mixed_src, mixed_tgt],
        &bounds,
        sp,
        &config,
        false,
    );
    assert!(
        dl_mixed
            .slur_geometries
            .iter()
            .all(|geometry| geometry.curve_dir < 0.0),
        "mixed-stem slur direction must remain above after system reflow"
    );

    // Stitched chunk seam (stitched_horizon = true): one continuous arc.
    let mut dl_stitched = DisplayList::new(600.0, 200.0);
    dl_stitched.push_tagged(
        RenderCommand::DrawRect {
            x: 100.0,
            y: 120.0,
            w: 24.0,
            h: 20.0,
            color: "#000000".to_string(),
        },
        "dependent-test".to_string(),
    );
    dl_stitched.push_shape_rect(
        BoundingBox::new(100.0, 120.0, 24.0, 20.0),
        "dependent-test".to_string(),
        ElementKind::Dynamic,
        Some(0),
        Some(0),
    );
    render_cross_system_slurs(&mut dl_stitched, &events, &bounds, sp, &config, true);
    let stitched = slur_ids(&dl_stitched);
    assert!(
        stitched.contains("slur/a/b"),
        "a stitched chunk seam should emit one continuous slur/a/b; got: {stitched:?}"
    );
    assert!(
        !stitched
            .iter()
            .any(|id| id.ends_with("/lh") || id.ends_with("/rh")),
        "a stitched chunk seam must NOT split the slur into halves; got: {stitched:?}"
    );
    let stitched_shapes: Vec<&str> = dl_stitched
        .element_shapes
        .iter()
        .filter(|shape| shape.kind == ElementKind::Slur)
        .map(|shape| shape.element_id.as_str())
        .collect();
    assert_eq!(stitched_shapes, ["slur/a/b"]);
    assert_eq!(dl_stitched.slur_geometries.len(), 1);
    let dependent_y = match &dl_stitched.commands[0] {
        RenderCommand::DrawRect { y, .. } => *y,
        command => panic!("expected dependent rectangle, got {command:?}"),
    };
    assert!(
        dependent_y > 120.0,
        "below-staff dependent must move outward from the continuation curve"
    );

    // A tall interior event near the seam must lift the continuous curve. The
    // source stem points up, so the automatic slur is below; place the interior
    // note well below the staff and compare the selected shoulder control Y.
    let mut interior = make("inside", 220.0, 1, vec![]);
    interior.endpoint.y_pos = 14.0;
    interior.endpoint.y_pos_bottom = 14.0;
    interior.endpoint.stem_up = false;
    let mut dl_obstructed = DisplayList::new(600.0, 200.0);
    render_cross_system_slurs(
        &mut dl_obstructed,
        &[events[0].clone(), interior, events[1].clone()],
        &bounds,
        sp,
        &config,
        true,
    );
    let clear_peak = dl_stitched.slur_geometries[0]
        .p1_y
        .max(dl_stitched.slur_geometries[0].p2_y);
    let obstructed_peak = dl_obstructed.slur_geometries[0]
        .p1_y
        .max(dl_obstructed.slur_geometries[0].p2_y);
    assert!(
        obstructed_peak > clear_peak,
        "stitched slur should lift below a tall interior obstacle: clear={clear_peak}, obstructed={obstructed_peak}"
    );

    let render_tip_width = |endpoint_thickness: f64| {
        let mut taper_config = config.clone();
        taper_config.slur_endpoint_thickness = endpoint_thickness;
        let mut display_list = DisplayList::new(600.0, 200.0);
        render_cross_system_slurs(&mut display_list, &events, &bounds, sp, &taper_config, true);
        display_list
            .commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawFilledBezier {
                    x1, y1, ix1, iy1, ..
                } => Some((x1 - ix1).hypot(y1 - iy1)),
                _ => None,
            })
    };
    let thin_tip = render_tip_width(0.05).expect("thin tapered slur");
    let thick_tip = render_tip_width(0.18).expect("thick tapered slur");
    assert!(thick_tip > thin_tip * 2.0);
    assert!((thin_tip - 0.05 * sp).abs() < 0.01);
    assert!((thick_tip - 0.18 * sp).abs() < 0.01);
}

#[test]
fn test_cross_system_slur_uses_hanger_and_clears_tie_continuation() {
    use crate::layout::slurs::participation::endpoint_snapshot;
    use crate::layout::slurs::{render_cross_system_slurs, GlobalSlurEvent, SystemSlurBounds};
    use crate::layout::ties::{render_cross_system_ties, GlobalTieNote};
    use crate::model::event::{Slur, Tie};
    use std::collections::HashMap;
    use std::rc::Rc;

    let config = LayoutConfig::default();
    let sp = config.sp;
    let tie = Tie {
        target: Some("tie-target".to_string()),
        target_type: None,
        side: None,
        lv: None,
    };
    let tie_notes = vec![
        GlobalTieNote {
            note_id: Rc::from("source-note"),
            x: 170.0,
            stem_x: 170.0,
            y_pos: 4.0,
            eff_staff_y: 100.0,
            stem_up: false,
            num_voices: 1,
            notehead_center_offset: 0.59 * sp,
            chord_positions: vec![4.0],
            system_idx: 0,
            part_index: 0,
            staff_idx: 0,
            ties: vec![tie],
        },
        GlobalTieNote {
            note_id: Rc::from("tie-target"),
            x: 330.0,
            stem_x: 330.0 + 1.18 * sp,
            y_pos: 4.0,
            eff_staff_y: 220.0,
            stem_up: true,
            num_voices: 1,
            notehead_center_offset: 0.59 * sp,
            chord_positions: vec![4.0],
            system_idx: 1,
            part_index: 0,
            staff_idx: 0,
            ties: Vec::new(),
        },
    ];
    let make_event =
        |id: &str, x: f64, y: f64, system_idx: usize, outgoing_tie: bool| GlobalSlurEvent {
            event_id: Rc::from(id),
            endpoint: endpoint_snapshot(
                x,
                4.0,
                4.0,
                !outgoing_tie,
                true,
                1.18 * sp,
                1,
                y,
                1,
                1,
                0,
                1.0,
                outgoing_tie,
                false,
                None,
            ),
            system_idx,
            part_index: 0,
            staff_idx: 0,
            slurs: Vec::new(),
            note_positions: Vec::new(),
            tie_links: Vec::new(),
        };
    let mut source = make_event("source", 170.0, 100.0, 0, true);
    source.slurs.push(Slur {
        target: "slur-target".to_string(),
        side: None,
        side_end: None,
        line_type: None,
        start_note: None,
        end_note: None,
        shape: None,
    });
    source.note_positions = vec![(Rc::from("source-note"), 4.0, 100.0)];
    source.tie_links = vec![(Rc::from("source-note"), Rc::from("tie-target"))];
    let mut continuation = make_event("tie-continuation", 330.0, 220.0, 1, false);
    continuation.note_positions = vec![(Rc::from("tie-target"), 4.0, 220.0)];
    let target = make_event("slur-target", 390.0, 220.0, 1, false);
    let events = vec![source, continuation, target];
    let bounds = HashMap::from([
        (
            (0, 0, 0),
            SystemSlurBounds {
                left_x: 20.0,
                right_x: 200.0,
            },
        ),
        (
            (1, 0, 0),
            SystemSlurBounds {
                left_x: 300.0,
                right_x: 500.0,
            },
        ),
    ]);
    let mut display = DisplayList::new(600.0, 400.0);
    render_cross_system_ties(&mut display, &tie_notes, &bounds, sp, &config, false);
    render_cross_system_slurs(&mut display, &events, &bounds, sp, &config, false);
    let band = |id: &str| {
        display
            .element_shapes
            .iter()
            .find(|shape| shape.element_id == id)
            .and_then(|shape| match &shape.geom {
                ShapeGeom::Band { samples } => Some(samples),
                _ => None,
            })
            .unwrap_or_else(|| {
                let ids: Vec<_> = display
                    .element_shapes
                    .iter()
                    .filter(|shape| matches!(shape.kind, ElementKind::Tie | ElementKind::Slur))
                    .map(|shape| shape.element_id.as_str())
                    .collect();
                panic!("missing connector band {id}; got {ids:?}")
            })
    };
    let tie_source = band("tie/source-note/tie-target/lh");
    let slur_source = band("slur/source/slur-target/lh");
    let tie_top = tie_source.first().expect("tie samples").1;
    let slur_top = slur_source.first().expect("slur samples").1;
    assert!(
        slur_top < tie_top - 0.1 * sp,
        "source slur top {slur_top} must occupy the outer lane above tie top {tie_top}"
    );

    let incoming = band("slur/source/slur-target/rh");
    assert!(
        incoming.first().expect("incoming samples").0 < 330.0 - 0.25 * sp,
        "incoming slur must begin at a detached hanger before the tied continuation"
    );
    assert!(
        display
            .slur_geometries
            .iter()
            .filter(|geometry| geometry.element_id.starts_with("slur/source/slur-target/"))
            .all(|geometry| geometry.curve_dir < 0.0),
        "the complete broken slur must inherit one automatic-up direction"
    );
}

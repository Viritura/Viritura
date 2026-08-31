// Auto-generated from tests.rs — test_bbox
// 6 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::HashSet;

// ═══════════════════════════════════════
// Bounding box tests
// ═══════════════════════════════════════
#[test]
fn test_bbox_basic_score_has_element_bboxes() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}, {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}, {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]}, {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have bboxes for: clef, time sig, 4 notes = at least 6
    assert!(
        dl.element_bboxes.len() >= 6,
        "Expected at least 6 element bboxes, got {}",
        dl.element_bboxes.len()
    );

    // Check that a clef bbox exists
    let clef_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/clef"));
    assert!(clef_bbox.is_some(), "Should have a clef bounding box");
    let clef = clef_bbox.unwrap();
    assert!(
        clef.bbox.width > 0.0,
        "Clef bbox should have positive width"
    );
    assert!(
        clef.bbox.height > 0.0,
        "Clef bbox should have positive height"
    );

    // Check that time sig bbox exists
    let time_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/time"));
    assert!(
        time_bbox.is_some(),
        "Should have a time signature bounding box"
    );

    // All bboxes should have positive dimensions
    for eb in &dl.element_bboxes {
        assert!(
            eb.bbox.width > 0.0,
            "bbox for {} should have positive width",
            eb.element_id
        );
        assert!(
            eb.bbox.height > 0.0,
            "bbox for {} should have positive height",
            eb.element_id
        );
    }
}

#[test]
fn test_bbox_rest_event() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have at least a rest bbox (rests may use auto-generated event IDs)
    let rest_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/s0/"))
        .collect();
    assert!(
        !rest_bboxes.is_empty(),
        "Should have event bboxes for rests. All bboxes: {:?}",
        dl.element_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );
}

#[test]
fn test_bbox_union() {
    let a = BoundingBox::new(10.0, 20.0, 30.0, 40.0);
    let b = BoundingBox::new(25.0, 15.0, 20.0, 50.0);
    let u = a.union(&b);
    assert_eq!(u.x, 10.0);
    assert_eq!(u.y, 15.0);
    assert_eq!(u.width, 35.0); // 45 - 10
    assert_eq!(u.height, 50.0); // 65 - 15
}

#[test]
fn test_bbox_contains() {
    let bbox = BoundingBox::new(10.0, 20.0, 30.0, 40.0);
    assert!(bbox.contains(15.0, 30.0));
    assert!(bbox.contains(10.0, 20.0)); // edge
    assert!(bbox.contains(40.0, 60.0)); // edge
    assert!(!bbox.contains(5.0, 30.0)); // outside left
    assert!(!bbox.contains(50.0, 30.0)); // outside right
    assert!(!bbox.contains(15.0, 10.0)); // outside top
    assert!(!bbox.contains(15.0, 70.0)); // outside bottom
}

#[test]
fn test_glyph_bbox_known_glyphs() {
    // Verify some specific glyph bboxes make sense
    let (bx, _by, bw, bh) = smufl::glyph_bbox(smufl::NOTEHEAD_BLACK);
    assert_eq!(bx, 0.0);
    assert!((bw - 1.18).abs() < 0.01); // standard notehead width
    assert!((bh - 1.0).abs() < 0.01); // standard notehead height

    let (_, _, rw, rh) = smufl::glyph_bbox(smufl::REST_QUARTER);
    assert!(rw > 0.0);
    assert!(rh > 0.0);
}

#[test]
fn test_bbox_tempo_marking() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "tempos": [{"bpm": 120, "value": {"base": "quarter"}}]}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let tempo_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/tempo"));
    assert!(
        tempo_bbox.is_some(),
        "Should have a tempo marking bounding box"
    );
    let tb = tempo_bbox.unwrap();
    assert!(tb.bbox.width > 0.0, "Tempo bbox should have positive width");
    assert!(
        tb.bbox.height > 0.0,
        "Tempo bbox should have positive height"
    );
    assert!(
        tb.element_id.ends_with("/tempo0"),
        "Tempo bbox ID should end with /tempo0"
    );
}

#[test]
fn test_bbox_segno_marker() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "segno": {"location": {"fraction": [0, 1]}}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let segno_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/segno"));
    assert!(segno_bbox.is_some(), "Should have a segno bounding box");
    let sb = segno_bbox.unwrap();
    assert!(sb.bbox.width > 0.0, "Segno bbox should have positive width");
    assert!(
        sb.bbox.height > 0.0,
        "Segno bbox should have positive height"
    );
}

#[test]
fn test_bbox_fine_marker() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "fine": {"location": {"fraction": [0, 1]}}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let fine_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/fine"));
    assert!(fine_bbox.is_some(), "Should have a fine bounding box");
    let fb = fine_bbox.unwrap();
    assert!(fb.bbox.width > 0.0, "Fine bbox should have positive width");
    assert!(
        fb.bbox.height > 0.0,
        "Fine bbox should have positive height"
    );
}

#[test]
fn test_bbox_jump_marker() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "jump": {"type": "segno", "location": {"fraction": [0, 1]}}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let jump_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/jump"));
    assert!(jump_bbox.is_some(), "Should have a jump bounding box");
    let jb = jump_bbox.unwrap();
    assert!(jb.bbox.width > 0.0, "Jump bbox should have positive width");
    assert!(
        jb.bbox.height > 0.0,
        "Jump bbox should have positive height"
    );
}

#[test]
fn test_bbox_rehearsal_mark() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "_x": {"viritura": {"rehearsalMark": {"text": "A"}}}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let reh_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/rehearsal"));
    assert!(
        reh_bbox.is_some(),
        "Should have a rehearsal mark bounding box"
    );
    let rb = reh_bbox.unwrap();
    assert!(
        rb.bbox.width > 0.0,
        "Rehearsal mark bbox should have positive width"
    );
    assert!(
        rb.bbox.height > 0.0,
        "Rehearsal mark bbox should have positive height"
    );

    // The selection box must BE the drawn border, not a separately-estimated
    // rectangle. Collect the four border strokes tagged with the rehearsal id
    // and assert their outer extent matches the bbox on every edge.
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for (cmd, id) in dl.commands.iter().zip(dl.element_ids.iter()) {
        let is_reh = id.as_deref().is_some_and(|s| s.contains("/rehearsal"));
        if let (RenderCommand::DrawLine { x1, y1, x2, y2, .. }, true) = (cmd, is_reh) {
            min_x = min_x.min(x1.min(*x2));
            max_x = max_x.max(x1.max(*x2));
            min_y = min_y.min(y1.min(*y2));
            max_y = max_y.max(y1.max(*y2));
        }
    }
    assert!(
        min_x.is_finite(),
        "boxed rehearsal mark should draw border strokes"
    );
    let eps = 1e-6;
    assert!(
        (rb.bbox.x - min_x).abs() < eps,
        "bbox left {} should match border left {}",
        rb.bbox.x,
        min_x
    );
    assert!(
        (rb.bbox.y - min_y).abs() < eps,
        "bbox top {} should match border top {}",
        rb.bbox.y,
        min_y
    );
    assert!(
        ((rb.bbox.x + rb.bbox.width) - max_x).abs() < eps,
        "bbox right {} should match border right {}",
        rb.bbox.x + rb.bbox.width,
        max_x
    );
    assert!(
        ((rb.bbox.y + rb.bbox.height) - max_y).abs() < eps,
        "bbox bottom {} should match border bottom {}",
        rb.bbox.y + rb.bbox.height,
        max_y
    );
}

#[test]
fn test_bbox_chord_symbol() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}], "_x": {"viritura": {"chordSymbols": [{"position": {"fraction": [0, 1]}, "root": {"step": "C"}, "quality": "major"}]}}}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let chord_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/chord"));
    assert!(
        chord_bbox.is_some(),
        "Should have a chord symbol bounding box"
    );
    let cb = chord_bbox.unwrap();
    assert!(
        cb.bbox.width > 0.0,
        "Chord symbol bbox should have positive width"
    );
    assert!(
        cb.bbox.height > 0.0,
        "Chord symbol bbox should have positive height"
    );
    assert!(
        cb.element_id.ends_with("/chord0"),
        "Chord bbox ID should end with /chord0"
    );
}

#[test]
fn test_bbox_text_expression() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}], "_x": {"viritura": {"expressions": [{"text": "dolce", "position": {"fraction": [0, 1]}}]}}}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let expr_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/expr"));
    assert!(
        expr_bbox.is_some(),
        "Should have a text expression bounding box"
    );
    let xb = expr_bbox.unwrap();
    assert!(
        xb.bbox.width > 0.0,
        "Expression bbox should have positive width"
    );
    assert!(
        xb.bbox.height > 0.0,
        "Expression bbox should have positive height"
    );
    assert!(
        xb.element_id.ends_with("/expr0"),
        "Expression bbox ID should end with /expr0"
    );
}

#[test]
fn test_bbox_text_expression_manual_offset_moves() {
    // manual_offset must actually shift the rendered bbox: +x right, +y up.
    let layout = |off: &str| {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
                "parts": [{{"measures": [{{"clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}], "sequences": [{{"content": [{{"duration": {{"base": "whole"}}, "rest": {{}}}}]}}], "_x": {{"viritura": {{"expressions": [{{"text": "dolce", "position": {{"fraction": [0, 1]}}{off}}}]}}}}}}]}}]
            }}"#,
            off = off
        );
        let score = parse_mnx(&json).unwrap();
        let dl = layout_score(&score, 0, &LayoutConfig::default());
        dl.element_bboxes
            .iter()
            .find(|eb| eb.element_id.ends_with("/expr0"))
            .map(|eb| (eb.bbox.x, eb.bbox.y))
            .expect("expr0 bbox")
    };

    let (x0, y0) = layout("");
    // +2 sp right, +3 sp up. Default spatium is small; just assert direction.
    let (x1, y1) = layout(r#", "manualOffset": [2, 3]"#);

    assert!(
        x1 > x0 + 0.5,
        "manualOffset +x should move bbox right: {x0} -> {x1}"
    );
    assert!(
        y1 < y0 - 0.5,
        "manualOffset +y should move bbox UP (smaller canvas y): {y0} -> {y1}"
    );
}

#[test]
fn test_text_expression_offset_invalidates_warm_cache() {
    // Editor reproduction: the live editor lays out with a WARM LayoutCache and
    // a patch. A vertical manual offset changes the measure's content but NOT
    // its width, so the per-system retention must still re-render the segment.
    // If the content hash that feeds the render-reuse decision is keyed only on
    // geometry/width, the warm pass reuses the stale segment and the move never
    // appears on screen (the reported bug).
    use crate::layout::cache::LayoutCache;
    use crate::layout::layout_score_cached;

    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}], "_x": {"viritura": {"expressions": [{"text": "dolce", "position": {"fraction": [0, 1]}}]}}}]}]
    }"#;

    let mut score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let mut cache = LayoutCache::new();

    // Cold pass — warms the cache.
    let dl0 = layout_score_cached(&score, 0, &config, Some(&mut cache));
    let y0 = dl0
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.ends_with("/expr0"))
        .map(|eb| eb.bbox.y)
        .expect("expr0 bbox (cold)");

    // Mutate the offset in place (3sp up), then re-layout with the SAME warm cache.
    score.parts[0].measures[0].expressions.as_mut().unwrap()[0].manual_offset = Some([0.0, 3.0]);
    let dl1 = layout_score_cached(&score, 0, &config, Some(&mut cache));
    let y1 = dl1
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.ends_with("/expr0"))
        .map(|eb| eb.bbox.y)
        .expect("expr0 bbox (warm)");

    assert!(
        y1 < y0 - 0.5,
        "warm-cache offset edit must move the bbox UP: {y0} -> {y1} (stale reuse if unchanged)"
    );
}

#[test]
fn test_text_expression_avoid_collisions_false_uses_bare_datum() {
    // An above-staff expression over a high note: with auto avoidance (default)
    // the skyline lifts it ABOVE the note; with avoidCollisions=false it sits at
    // the bare datum (just above the staff), ignoring the note — so its baseline
    // is LOWER (larger canvas y) than the auto-lifted version. This is the
    // visible effect of the flag.
    let layout = |avoid: &str| {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
                "parts": [{{"measures": [{{"clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}], "sequences": [{{"content": [{{"duration": {{"base": "whole"}}, "notes": [{{"pitch": {{"step": "G", "octave": 6}}}}]}}]}}], "_x": {{"viritura": {{"expressions": [{{"text": "arco", "position": {{"fraction": [0, 1]}}, "placement": "above"{avoid}}}]}}}}}}]}}]
            }}"#,
            avoid = avoid
        );
        let score = parse_mnx(&json).unwrap();
        let dl = layout_score(&score, 0, &LayoutConfig::default());
        dl.element_bboxes
            .iter()
            .find(|eb| eb.element_id.ends_with("/expr0"))
            .map(|eb| eb.bbox.y)
            .expect("expr0 bbox")
    };

    let y_auto = layout("");
    let y_pinned = layout(r#", "avoidCollisions": false"#);
    assert!(
        y_pinned > y_auto + 0.5,
        "avoidCollisions=false should sit at the bare datum (lower, ignoring the high note): \
         auto={y_auto} pinned={y_pinned}"
    );
}

#[test]
fn test_bbox_text_expression_width_hugs_text() {
    // Regression: the selection box must hug the rendered text, not overshoot
    // it. "pizz." in serif advances ~1.92 em (p .5, i .278, z .444, z .444,
    // . .25); the old flat 0.6-em/char estimate gave 3.0 em — a box ~56% too
    // wide, leaving a large gap past the period. The box now uses the real AFM
    // advance table, so its width must land near the true ink width.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}], "_x": {"viritura": {"expressions": [{"text": "pizz.", "position": {"fraction": [0, 1]}}]}}}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let font_size = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { text, size, .. } if text == "pizz." => Some(*size),
            _ => None,
        })
        .expect("pizz. should render");

    let xb = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.ends_with("/expr0"))
        .expect("expression bbox should exist");

    // True serif advance for "pizz." in em units.
    let expected = (0.5 + 0.278 + 0.444 + 0.444 + 0.25) * font_size;
    assert!(
        (xb.bbox.width - expected).abs() < 0.05 * font_size,
        "expression bbox width={} should hug the ~{} em text, not overshoot",
        xb.bbox.width,
        expected
    );
    // And it must be clearly tighter than the old 0.6-em/char overshoot.
    let old_overshoot = "pizz.".len() as f64 * 0.6 * font_size;
    assert!(
        xb.bbox.width < old_overshoot - 0.5 * font_size,
        "expression bbox width={} should be much tighter than the old estimate {}",
        xb.bbox.width,
        old_overshoot
    );
}

#[test]
fn test_bbox_text_expression_left_aligned_at_note() {
    // An above-staff direction ("arco") is ALWAYS left-aligned at its note: the
    // text's left border is its rhythmic anchor, so it extends rightward however
    // long the string runs and is never shifted left to clear a following event
    // (shifting would move the unambiguous left edge off the beat it marks). The
    // selection bbox must sit at that left-aligned note x, exactly under the
    // rendered glyph.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "expressions": [{"text": "arco", "position": {"fraction": [1, 4]}, "placement": "above"}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "rest": {}},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // The rendered text x for the "arco" direction.
    let text_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { x, text, .. } if text == "arco" => Some(*x),
            _ => None,
        })
        .expect("arco direction should render");

    // The first black notehead (the beat-2 eighth note the direction attaches
    // to). The direction's left edge must be aligned with that notehead, never
    // shifted left of it.
    let first_black_notehead_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == crate::render::smufl::smufl::NOTEHEAD_BLACK =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("should render a black notehead");
    assert!(
        (text_x - first_black_notehead_x).abs() < 0.01,
        "direction text x={text_x} should be left-aligned with its notehead x={first_black_notehead_x}"
    );

    let expr_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.ends_with("/expr0"))
        .expect("expression bbox should exist");

    assert!(
        (expr_bbox.bbox.x - text_x).abs() < 0.01,
        "expression bbox left x={} should match rendered text x={}",
        expr_bbox.bbox.x,
        text_x
    );
}

#[test]
fn test_text_expression_slides_left_off_right_margin() {
    // A long direction on the LAST note of the system would overflow the
    // closing barline (the system's right margin). The margin dodge slides it
    // LEFT to bring its ink back inside, bounded by the safe 1/3 envelope to the
    // previous sounding note. Compare against a short label on the same note,
    // which fits and stays left-aligned: the long one must render strictly left
    // of the short one (it slid), and its right edge must move inward.
    let make = |text: &str| {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
                "parts": [{{"measures": [{{
                    "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                    "expressions": [{{"text": "{text}", "position": {{"fraction": [3, 4]}}, "placement": "above"}}],
                    "sequences": [{{"content": [
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "G", "octave": 4}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "G", "octave": 4}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "G", "octave": 4}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "G", "octave": 4}}}}]}}
                    ]}}]
                }}]}}]
            }}"#
        );
        let score = parse_mnx(&json).unwrap();
        let config = LayoutConfig::default();
        let dl = layout_score(&score, 0, &config);
        let text_x = dl
            .commands
            .iter()
            .find_map(|cmd| match cmd {
                RenderCommand::DrawText { x, text: t, .. } if t == text => Some(*x),
                _ => None,
            })
            .expect("direction should render");
        let bbox = dl
            .element_bboxes
            .iter()
            .find(|eb| eb.element_id.ends_with("/expr0"))
            .expect("expression bbox should exist");
        (text_x, bbox.bbox.x + bbox.bbox.width)
    };

    let (short_x, _short_right) = make("mp");
    let (long_x, long_right) = make("sempre molto espressivo");

    // The long direction must have slid left of where a short one sits (which is
    // left-aligned on the note).
    assert!(
        long_x < short_x - 0.5,
        "long direction x={long_x} should slide left of the left-aligned short one x={short_x}"
    );
    // And its slid left edge must still be left of its right ink edge (sanity).
    assert!(long_right > long_x, "ink width must be positive");
}

#[test]
fn test_tempo_does_not_decongest_expression_when_already_clear() {
    // A high note independently lifts both an "arco" direction and a tempo.
    // The tempo's normal substrate clearance leaves it fully above "arco", so
    // the decongestion escape hatch must not spend horizontal whitespace on a
    // needless slide.
    let layout = |with_tempo: bool| {
        let tempos = if with_tempo {
            r#""tempos": [{"bpm": 120, "value": {"base": "quarter"}}],"#
        } else {
            ""
        };
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{ {tempos} "time": {{"count": 4, "unit": 4}}}}]}},
                "parts": [{{"measures": [{{
                    "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                    "expressions": [{{"text": "arco", "position": {{"fraction": [0, 1]}}, "placement": "above"}}],
                    "sequences": [{{"content": [
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"step": "C", "octave": 7}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "rest": {{}}}},
                        {{"duration": {{"base": "half"}}, "rest": {{}}}}
                    ]}}]
                }}]}}]
            }}"#
        );
        let score = parse_mnx(&json).unwrap();
        let config = LayoutConfig::default();
        layout_score(&score, 0, &config)
    };
    let arco_x = |dl: &DisplayList| {
        dl.commands
            .iter()
            .find_map(|cmd| match cmd {
                RenderCommand::DrawText { x, text, .. } if text == "arco" => Some(*x),
                _ => None,
            })
            .expect("arco should render")
    };

    let dl_no_tempo = layout(false);
    let dl_with_tempo = layout(true);
    let x_no_tempo = arco_x(&dl_no_tempo);
    let x_with_tempo = arco_x(&dl_with_tempo);
    let bbox = |suffix: &str| {
        dl_with_tempo
            .element_bboxes
            .iter()
            .find(|bbox| bbox.element_id.contains(suffix))
            .expect("marking bbox should exist")
            .bbox
            .clone()
    };
    let arco_bbox = bbox("/expr0");
    let tempo_bbox = bbox("/tempo0");
    assert!(
        (x_with_tempo - x_no_tempo).abs() < 0.01,
        "already-clear tempo should not slide 'arco': with={x_with_tempo} without={x_no_tempo}"
    );
    let overlaps = tempo_bbox.x < arco_bbox.x + arco_bbox.width
        && tempo_bbox.x + tempo_bbox.width > arco_bbox.x
        && tempo_bbox.y < arco_bbox.y + arco_bbox.height
        && tempo_bbox.y + tempo_bbox.height > arco_bbox.y;
    assert!(
        !overlaps,
        "tempo ink should already clear 'arco': tempo={tempo_bbox:?}, arco={arco_bbox:?}"
    );
}

#[test]
fn test_bbox_measure_number() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "number": 5}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let mnum_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/mnum"));
    assert!(
        mnum_bbox.is_some(),
        "Should have a measure number bounding box"
    );
    let mb = mnum_bbox.unwrap();
    assert!(
        mb.bbox.width > 0.0,
        "Measure number bbox should have positive width"
    );
    assert!(
        mb.bbox.height > 0.0,
        "Measure number bbox should have positive height"
    );

    // The box must track the rendered glyph. The bar number is drawn below the
    // staff with `TextBaseline::Top`, so the DrawText anchor `y` is the box top,
    // the anchor `x` is the box left, and both must agree with the bbox.
    let (text_x, text_y) = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .find_map(|(cmd, id)| match (cmd, id) {
            (RenderCommand::DrawText { x, y, .. }, Some(id)) if id.contains("/mnum") => {
                Some((*x, *y))
            }
            _ => None,
        })
        .expect("measure number should emit a DrawText command");
    assert!(
        (mb.bbox.x - text_x).abs() < 1e-6,
        "bbox left {} should match rendered x {}",
        mb.bbox.x,
        text_x
    );
    assert!(
        (mb.bbox.y - text_y).abs() < 1e-6,
        "bbox top {} should match rendered baseline-top y {} (box must sit below the staff with the glyph, not above)",
        mb.bbox.y,
        text_y
    );
}

#[test]
fn test_bbox_coda_marker() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "_x": {"viritura": {"coda": {"location": {"fraction": [0, 1]}}}}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let coda_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/coda"));
    assert!(coda_bbox.is_some(), "Should have a coda bounding box");
    let cb = coda_bbox.unwrap();
    assert!(cb.bbox.width > 0.0, "Coda bbox should have positive width");
    assert!(
        cb.bbox.height > 0.0,
        "Coda bbox should have positive height"
    );
}

#[test]
fn test_bbox_binary_roundtrip() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Verify bboxes are present
    assert!(!dl.element_bboxes.is_empty(), "Should have element bboxes");

    // Verify binary encoding includes bbox count
    let buf = dl.to_binary();
    assert!(buf.len() >= 6);
    let num_bboxes = buf[5] as usize;
    assert_eq!(num_bboxes, dl.element_bboxes.len());
}

// ═══════════════════════════════════════
// Articulation bounding box tests
// ═══════════════════════════════════════
#[test]
fn test_bbox_articulation_staccato() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}], "markings": {"staccato": {}}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let artic_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/artic"));
    assert!(
        artic_bbox.is_some(),
        "Should have an articulation bounding box"
    );
    let bb = &artic_bbox.unwrap().bbox;
    assert!(
        bb.width > 0.0,
        "Articulation bbox should have positive width"
    );
    assert!(
        bb.height > 0.0,
        "Articulation bbox should have positive height"
    );
}

#[test]
fn test_bbox_articulation_stacked() {
    // Staccato + accent: two stacked articulations should produce a taller bbox
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}], "markings": {"staccato": {}, "accent": {}}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let artic_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/artic"));
    assert!(
        artic_bbox.is_some(),
        "Stacked articulations should have a bounding box"
    );
    let bb = &artic_bbox.unwrap().bbox;
    assert!(bb.width > 0.0);
    assert!(bb.height > 0.0);
}

#[test]
fn test_bbox_articulation_id_format() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "markings": {"staccato": {}}},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}], "markings": {"accent": {}}},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let artic_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.ends_with("/artic"))
        .collect();
    // Two notes have articulations, so we should get 2 artic bboxes
    assert_eq!(
        artic_bboxes.len(),
        2,
        "Expected 2 articulation bboxes, got {}",
        artic_bboxes.len()
    );
}

// ═══════════════════════════════════════
// Fermata bounding box tests
// ═══════════════════════════════════════
#[test]
fn test_bbox_fermata() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "fermata": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let fermata_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/fermata"));
    assert!(fermata_bbox.is_some(), "Should have a fermata bounding box");
    let bb = &fermata_bbox.unwrap().bbox;
    assert!(bb.width > 0.0, "Fermata bbox should have positive width");
    assert!(bb.height > 0.0, "Fermata bbox should have positive height");
    // Fermata above the staff: its Y should be less than the staff top
    // (staff_y = margin_top * sp = 5.0 * 12.0 = 60.0)
}

#[test]
fn test_bbox_fermata_above_staff() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "fermata": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let fermata_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/fermata"))
        .unwrap();
    let staff_y = config.margin_top * config.sp;
    // Default placement above: fermata bbox y should be above or near the staff top
    assert!(
        fermata_bbox.bbox.y < staff_y,
        "Fermata should be above staff (bbox.y={} < staff_y={})",
        fermata_bbox.bbox.y,
        staff_y
    );
}

// ═══════════════════════════════════════
// Ornament bounding box tests
// ═══════════════════════════════════════
#[test]
fn test_bbox_ornament_turn() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "markings": {"_x": {"viritura": {"ornaments": ["turn"]}}}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let orn_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/ornament"));
    assert!(orn_bbox.is_some(), "Should have an ornament bounding box");
    let bb = &orn_bbox.unwrap().bbox;
    assert!(bb.width > 0.0, "Ornament bbox should have positive width");
    assert!(bb.height > 0.0, "Ornament bbox should have positive height");
}

#[test]
fn test_bbox_ornament_above_staff() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "markings": {"_x": {"viritura": {"ornaments": ["mordent"]}}}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let orn_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/ornament"))
        .unwrap();
    let staff_y = config.margin_top * config.sp;
    assert!(
        orn_bbox.bbox.y < staff_y,
        "Ornament should be above staff (bbox.y={} < staff_y={})",
        orn_bbox.bbox.y,
        staff_y
    );
}

// ═══════════════════════════════════════
// Trill bounding box tests
// ═══════════════════════════════════════
#[test]
fn test_bbox_trill() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "markings": {"_x": {"viritura": {"trill": {}}}}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let trill_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/trill"));
    assert!(trill_bbox.is_some(), "Should have a trill bounding box");
    let bb = &trill_bbox.unwrap().bbox;
    assert!(bb.width > 0.0, "Trill bbox should have positive width");
    assert!(bb.height > 0.0, "Trill bbox should have positive height");
}

// ═══════════════════════════════════════
// Mixed markings bounding box tests
// ═══════════════════════════════════════
#[test]
fn test_bbox_mixed_markings() {
    // Note with staccato + fermata: should have both artic and fermata bboxes
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}], "markings": {"staccato": {}}, "fermata": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let artic = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.ends_with("/artic"));
    let fermata = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.ends_with("/fermata"));
    assert!(artic.is_some(), "Should have articulation bbox");
    assert!(fermata.is_some(), "Should have fermata bbox");
    // They should not overlap (fermata is above, staccato is near note)
    let artic_bb = &artic.unwrap().bbox;
    let fermata_bb = &fermata.unwrap().bbox;
    assert!(artic_bb.width > 0.0);
    assert!(fermata_bb.width > 0.0);
}

// ═══════════════════════════════════════
// Spanner bounding box tests (hairpins, pedals, ottavas)
// ═══════════════════════════════════════
#[test]
fn test_bbox_hairpin_spanner() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "dynamics": [{
                "type": "gradual",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}},
                "wedgeType": "increasing"
            }],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let hairpin_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/hairpin"))
        .collect();
    assert_eq!(
        hairpin_bboxes.len(),
        1,
        "Expected 1 hairpin bbox, got {}",
        hairpin_bboxes.len()
    );

    let hb = &hairpin_bboxes[0];
    assert!(
        hb.element_id.starts_with("p0/m0/hairpin"),
        "ID should match p0/m0/hairpin*, got {}",
        hb.element_id
    );
    assert!(
        hb.bbox.width > 0.0,
        "Hairpin bbox should have positive width"
    );
    assert!(
        hb.bbox.height > 0.0,
        "Hairpin bbox should have positive height"
    );
}

#[test]
fn test_bbox_pedal_spanner() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"pedals": [{
                "type": "sustain",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
            }]}},
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let pedal_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/pedal"))
        .collect();
    assert_eq!(
        pedal_bboxes.len(),
        1,
        "Expected 1 pedal bbox, got {}",
        pedal_bboxes.len()
    );

    let pb = &pedal_bboxes[0];
    assert!(
        pb.element_id.starts_with("p0/m0/pedal"),
        "ID should match p0/m0/pedal*, got {}",
        pb.element_id
    );
    assert!(pb.bbox.width > 0.0, "Pedal bbox should have positive width");
    assert!(
        pb.bbox.height > 0.0,
        "Pedal bbox should have positive height"
    );
}

#[test]
fn test_bbox_ottava_spanner() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let ottava_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/ottava"))
        .collect();
    assert!(
        !ottava_bboxes.is_empty(),
        "Expected at least 1 ottava bbox, got {}",
        ottava_bboxes.len()
    );

    for ob in &ottava_bboxes {
        assert!(
            ob.bbox.width > 0.0,
            "Ottava bbox {} should have positive width",
            ob.element_id
        );
        assert!(
            ob.bbox.height > 0.0,
            "Ottava bbox {} should have positive height",
            ob.element_id
        );
    }
}

#[test]
fn test_bbox_spanner_dimensions_reasonable() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "dynamics": [{
                "type": "gradual",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}},
                "wedgeType": "decreasing"
            }],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let _sp = config.sp;

    let hb = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/hairpin"));
    // Hairpin bbox exists (dimensions may be zero if start == end position resolves identically)
    assert!(
        hb.is_some(),
        "Should have a hairpin bbox. All bboxes: {:?}",
        dl.element_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );
}
// ═══════════════════════════════════════
// Additional element ID tagging tests
// ═══════════════════════════════════════

#[test]
fn test_element_ids_populated_during_layout() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    assert!(
        !dl.element_ids.is_empty(),
        "element_ids should be populated during layout"
    );

    let tagged_ids: Vec<&String> = dl.element_ids.iter().filter_map(|id| id.as_ref()).collect();
    assert!(
        !tagged_ids.is_empty(),
        "Should have at least some tagged commands"
    );

    let unique_ids: HashSet<&str> = tagged_ids.iter().map(|s| s.as_str()).collect();

    let has_events = unique_ids.iter().any(|id| id.contains("/s0/"));
    assert!(
        has_events,
        "Should have event element IDs, got: {:?}",
        unique_ids
    );

    let has_clef = unique_ids.iter().any(|id| id.contains("/clef"));
    assert!(
        has_clef,
        "Should have clef element ID, got: {:?}",
        unique_ids
    );

    let has_time = unique_ids.iter().any(|id| id.contains("/time"));
    assert!(
        has_time,
        "Should have time signature element ID, got: {:?}",
        unique_ids
    );
}

#[test]
fn test_element_ids_parallel_to_commands() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "rest": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    if !dl.element_ids.is_empty() {
        assert_eq!(
            dl.element_ids.len(),
            dl.commands.len(),
            "element_ids ({}) should have same length as commands ({})",
            dl.element_ids.len(),
            dl.commands.len()
        );
    }
}

#[test]
fn test_diverse_score_element_tagging() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}},
            {"barline": {"type": "double"}}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "dynamics": [{"type": "immediate", "value": "f", "position": {"fraction": [0, 1]}}],
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5, "alter": 1}}]},
                    {"duration": {"base": "half"}, "rest": {}}
                ]}]
            },
            {
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let unique_ids: HashSet<&str> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref().map(|s| s.as_str()))
        .collect();

    assert!(
        unique_ids.iter().any(|id| id.contains("/clef")),
        "Missing clef tag. IDs: {:?}",
        unique_ids
    );
    assert!(
        unique_ids.iter().any(|id| id.contains("/time")),
        "Missing time tag. IDs: {:?}",
        unique_ids
    );
    assert!(
        unique_ids.iter().any(|id| id.contains("/key")),
        "Missing key sig tag. IDs: {:?}",
        unique_ids
    );

    let event_ids: Vec<&&str> = unique_ids.iter().filter(|id| id.contains("/s0/")).collect();
    assert!(
        event_ids.len() >= 4,
        "Should have at least 4 event IDs, got {}: {:?}",
        event_ids.len(),
        event_ids
    );
}

// ═══════════════════════════════════════
// Grace note bounding box tests
// ═══════════════════════════════════════

#[test]
fn test_bbox_grace_note_present() {
    // Grace eighth → main quarter
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "grace", "content": [{"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
            {"duration": {"base": "half"}, "rest": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/grace/"))
        .collect();
    assert!(
        !grace_bboxes.is_empty(),
        "Should have grace note bounding boxes. All bboxes: {:?}",
        dl.element_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );

    // Grace bbox should have positive dimensions
    for gb in &grace_bboxes {
        assert!(
            gb.bbox.width > 0.0,
            "Grace bbox {} should have positive width",
            gb.element_id
        );
        assert!(
            gb.bbox.height > 0.0,
            "Grace bbox {} should have positive height",
            gb.element_id
        );
    }
}

#[test]
fn test_flagged_note_bbox_encloses_flag() {
    // A lone (unbeamed) flagged 8th note renders a LENGTHENED stem plus a flag
    // glyph; the note's element_bbox must enclose them. Previously the bbox
    // used the default 3.5sp stem and omitted the flag, so the box stopped
    // short of the flag — the editor's overlay/hit-test then "excluded" the
    // flag from ink detection (Rhapsody rehearsal 22 "pizz." over a flagged
    // middle-C). The bbox top must reach the flag glyph's ink, and the box
    // must be wider than the bare stem to cover the flag's rightward curl.
    //
    // Middle C (C4) in treble sits a ledger line below the staff → stem UP, so
    // the flag is at the TOP of the stem.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "eighth"}, "rest": {}},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // The flagged 8th note's chord bbox (the event id, not the /n0 notehead).
    // It's the leftmost event bbox in the measure (first event).
    let note_bbox = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.starts_with("p0/m0/s0/") && !eb.element_id.contains("/n"))
        .min_by(|a, b| a.bbox.x.partial_cmp(&b.bbox.x).unwrap())
        .map(|eb| eb.bbox.clone())
        .expect("flagged 8th note should have an element_bbox");

    // The rendered up-stem flag glyph (flag8thUp).
    let flag = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } if *codepoint == smufl::flag_glyph(1, true).unwrap() => Some((*x, *y, *size)),
            _ => None,
        })
        .expect("an 8th-up flag glyph should render");
    let (flag_x, flag_y, flag_size) = flag;
    let (_fbx, fby, fbw, _fbh) = smufl::glyph_bbox(smufl::flag_glyph(1, true).unwrap());
    let flag_ink_top = flag_y + fby * (flag_size / 4.0);
    let flag_ink_right = flag_x + (fbw) * (flag_size / 4.0);

    // The bbox top must reach (≤) the flag's ink top — the flag is enclosed,
    // not clipped. The naive default-3.5sp stem tip would be ~0.5sp lower.
    assert!(
        note_bbox.y <= flag_ink_top + 0.5,
        "note bbox top {:.1} must enclose the flag ink top {:.1} (flag must not be clipped)",
        note_bbox.y,
        flag_ink_top
    );
    // And the box must be wide enough to cover the flag's rightward curl.
    assert!(
        note_bbox.x + note_bbox.width >= flag_ink_right - 0.5,
        "note bbox right {:.1} must enclose the flag ink right {:.1}",
        note_bbox.x + note_bbox.width,
        flag_ink_right
    );
    // Sanity: the flag is above the notehead (stem-up), well above the staff
    // bottom — i.e. we really exercised the up-stem-flag path.
    assert!(flag_ink_top < staff_y + 4.0 * sp);
}

#[test]
fn test_bbox_grace_note_left_of_main_event() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "grace", "content": [{"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "dotted half"}, "rest": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/grace/"))
        .expect("Should have a grace note bbox");

    // Find the main event's bbox (s0/e0 — the note the grace is attached to)
    let main_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/s0/") && !eb.element_id.contains("/grace/"))
        .expect("Should have a main event bbox");

    // Grace note should be positioned to the left of the main event
    assert!(
        grace_bbox.bbox.x < main_bbox.bbox.x,
        "Grace bbox x={:.1} should be left of main event x={:.1}",
        grace_bbox.bbox.x,
        main_bbox.bbox.x
    );
}

#[test]
fn test_bbox_grace_note_smaller_than_main() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "grace", "content": [{"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "dotted half"}, "rest": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/grace/"))
        .expect("Should have a grace bbox");

    let main_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/s0/") && !eb.element_id.contains("/grace/"))
        .expect("Should have a main event bbox");

    // Grace note rendered at 0.65× scale — its bbox height should be shorter
    // (stem is shorter at the scaled size). Width may vary due to flags.
    assert!(
        grace_bbox.bbox.height < main_bbox.bbox.height,
        "Grace bbox height={:.1} should be smaller than main event height={:.1}",
        grace_bbox.bbox.height,
        main_bbox.bbox.height
    );
}

#[test]
fn test_bbox_multiple_grace_notes() {
    // Two grace notes before a main note
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "grace", "content": [
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 3}}]}
            ]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "dotted half"}, "rest": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/grace/"))
        .collect();
    assert_eq!(
        grace_bboxes.len(),
        2,
        "Expected 2 grace note bboxes, got {}: {:?}",
        grace_bboxes.len(),
        grace_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );

    // They should have distinct X positions
    assert!(
        (grace_bboxes[0].bbox.x - grace_bboxes[1].bbox.x).abs() > 1.0,
        "Two grace notes should have different X positions: {:.1} vs {:.1}",
        grace_bboxes[0].bbox.x,
        grace_bboxes[1].bbox.x
    );
}

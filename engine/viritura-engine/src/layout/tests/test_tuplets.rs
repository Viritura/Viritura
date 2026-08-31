// Auto-generated from tests.rs — test_tuplets
// 5 test(s)

use super::test_helpers::*;
use crate::layout::build_beat_anchors;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::layout::spacing::{collect_all_event_durations, detect_common_shortest_duration};
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_tuplets_mnx_correct_event_count() {
    // Load tuplets.mnx and verify event counts in each measure's voice layout.
    // Measure 1: 2 tuplets (2 events + 3 events) + 2 regular = 7 events
    // Measure 2: 1 tuplet of 6 events = 6 events
    let json = include_str!("../../../../../packages/format/fixtures/mnx/tuplets.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    assert!(
        measures.len() >= 2,
        "tuplets.mnx should have at least 2 measures"
    );

    let ml0 = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    assert!(
        !ml0.voice_layouts.is_empty(),
        "Measure 1 should have at least one voice"
    );
    assert_eq!(
        ml0.voice_layouts[0].events_vec().len(),
        7,
        "Measure 1 should have 7 events (2+3 from two tuplets + 2 regular), got {}",
        ml0.voice_layouts[0].events_vec().len()
    );

    let ml1 = layout_measure(&measures[1], sp, 0.0, &config, None, &[], 1.0);
    assert!(
        !ml1.voice_layouts.is_empty(),
        "Measure 2 should have at least one voice"
    );
    assert_eq!(
        ml1.voice_layouts[0].events_vec().len(),
        6,
        "Measure 2 should have 6 events (6-in-4 tuplet), got {}",
        ml1.voice_layouts[0].events_vec().len()
    );
}

#[test]
fn test_tuplet_bracket_lines_exist() {
    // Verify that tuplet bracket render commands (DrawLine for hooks and horizontal segments) appear.
    // A single 3:2 tuplet bracket should produce at least 4 DrawLine commands:
    //   2 vertical hooks + 2 horizontal segments (split around the number)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Count all DrawLine commands (staff lines, stems, barlines AND bracket lines)
    let all_lines: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawLine { .. }))
        .collect();

    // Also verify the tuplet number glyph exists (confirms bracket rendering ran)
    let tuplet_glyphs = dl
        .commands
        .iter()
        .filter(|c| is_tuplet_number_glyph(c))
        .count();
    assert!(
        tuplet_glyphs >= 1,
        "Expected at least 1 tuplet number glyph, got {}",
        tuplet_glyphs
    );

    // The bracket produces thin lines (hook_length-based vertical + horizontal segments).
    // Filter for thin bracket-width lines (0.16*sp ≈ 1.92 pixels).
    // (Bravura engravingDefaults.tupletBracketThickness = 0.16)
    let sp = config.sp;
    let bracket_lw = 0.16 * sp;
    let bracket_lines = all_lines
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawLine { width, .. } = c {
                (*width - bracket_lw).abs() < 0.01
            } else {
                false
            }
        })
        .count();
    // 2 vertical hooks + at least 1 horizontal segment = at least 3 lines
    assert!(
        bracket_lines >= 3,
        "Expected at least 3 thin bracket DrawLine commands (hooks + horizontal), got {}",
        bracket_lines
    );
}

#[test]
fn test_tuplet_number_centered_on_bracket() {
    // The tuplet number glyph must be centered horizontally on the bracket span
    // and centered vertically on the bracket line (so the bracket's horizontal
    // segments pass through the middle of the digit, not along its baseline).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let glyph_size = 4.0 * sp;

    // Locate the tuplet "3" glyph and its draw origin.
    let (gx, gy) = dl
        .commands
        .iter()
        .find_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } = c
            {
                if *codepoint == smufl::tuplet_digit(3) {
                    return Some((*x, *y));
                }
            }
            None
        })
        .expect("expected a tuplet '3' glyph");

    // Collect the thin bracket lines.
    let bracket_lw = 0.16 * sp;
    let bracket_lines: Vec<(f64, f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                ..
            } = c
            {
                if (*width - bracket_lw).abs() < 0.01 {
                    return Some((*x1, *y1, *x2, *y2));
                }
            }
            None
        })
        .collect();

    // The two short vertical hooks sit at the bracket's left and right ends; the
    // digit's horizontal center must sit at their midpoint. (Filter by the hook
    // length to avoid catching full-height barlines/stems.)
    let hook_length = 0.5 * sp;
    let hooks: Vec<&(f64, f64, f64, f64)> = bracket_lines
        .iter()
        .filter(|(x1, y1, x2, y2)| {
            (x1 - x2).abs() < 0.01 && ((y1 - y2).abs() - hook_length).abs() < 0.05 * sp
        })
        .collect();
    assert_eq!(
        hooks.len(),
        2,
        "expected exactly 2 bracket hooks, got {}",
        hooks.len()
    );
    let center_x = (hooks[0].0 + hooks[1].0) / 2.0;
    // The bracket line sits at the y of the horizontal segments that connect to
    // the hooks (distinguishes it from staff lines of the same thickness).
    let hook_left_x = hooks[0].0.min(hooks[1].0);
    let bracket_y = bracket_lines
        .iter()
        .find_map(|(x1, y1, x2, y2)| {
            ((y1 - y2).abs() < 0.01
                && ((x1 - hook_left_x).abs() < 0.05 * sp || (x2 - hook_left_x).abs() < 0.05 * sp))
                .then_some(*y1)
        })
        .expect("expected a horizontal bracket segment meeting a hook");

    // Reconstruct the glyph's geometric center from its bbox and draw origin.
    let scale = glyph_size / 4.0;
    let (bx, by, bw, bh) = smufl::glyph_bbox(smufl::tuplet_digit(3));
    let glyph_center_x = gx + (bx + bw / 2.0) * scale;
    let glyph_center_y = gy + (by + bh / 2.0) * scale;

    assert!(
        (glyph_center_x - center_x).abs() < 0.05 * sp,
        "tuplet number not horizontally centered: glyph center x={:.2}, bracket center x={:.2}",
        glyph_center_x,
        center_x
    );
    assert!(
        (glyph_center_y - bracket_y).abs() < 0.05 * sp,
        "tuplet number not vertically centered on bracket line: glyph center y={:.2}, bracket y={:.2}",
        glyph_center_y,
        bracket_y
    );
}

#[test]
fn test_bracketless_tuplet_number_centered_on_beam() {
    // A beamed tuplet WITHOUT a bracket centres its number on the BEAM (the
    // stem span), not the notehead span. For a stem-up group the stems sit at
    // the noteheads' right edge, so the beam centre is ~half a notehead to the
    // right of the notehead-span midpoint. The digit's ink centre must land on
    // the stem-span midpoint, and a precise selection bbox must be published.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet", "bracket": "no",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let glyph_size = 4.0 * sp;

    // Reconstruct the digit's ink centre from its draw origin.
    let (gx, _gy) = dl
        .commands
        .iter()
        .find_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } = c
            {
                if *codepoint == smufl::tuplet_digit(3) {
                    return Some((*x, *y));
                }
            }
            None
        })
        .expect("expected a tuplet '3' glyph");
    let scale = glyph_size / 4.0;
    let (bx, _by, bw, _bh) = smufl::glyph_bbox(smufl::tuplet_digit(3));
    let glyph_center_x = gx + (bx + bw / 2.0) * scale;

    // The beam (stem-span) centre: the three tuplet noteheads are black
    // noteheads; their up-stems sit at notehead_x + STEM_UP_SE.0*sp - stem_w/2.
    let noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_BLACK =>
            {
                Some(*x)
            }
            _ => None,
        })
        .collect();
    assert_eq!(noteheads.len(), 3, "expected the 3 tuplet noteheads");
    let stem_w = config.stem_width * sp;
    let stem_x = |nx: f64| nx + smufl::STEM_UP_SE.0 * sp - stem_w * 0.5;
    let beam_center = (stem_x(noteheads[0]) + stem_x(noteheads[2])) / 2.0;

    assert!(
        (glyph_center_x - beam_center).abs() < 0.1 * sp,
        "bracketless tuplet number not centred on the beam: glyph center x={glyph_center_x:.2}, beam center x={beam_center:.2}"
    );

    // A precise selection bbox must be published, hugging the digit ink (well
    // under a 4sp em square) and containing the digit's ink centre.
    let tuplet_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("/tuplet"))
        .expect("expected an element_bbox for the tuplet");
    let bb = &tuplet_bbox.bbox;
    assert!(
        bb.width < glyph_size && bb.height < glyph_size,
        "tuplet selection bbox should hug the digit ink, got {bb:?}"
    );
    assert!(
        glyph_center_x >= bb.x - 0.01 && glyph_center_x <= bb.x + bb.width + 0.01,
        "tuplet bbox must horizontally contain the digit ink centre"
    );
}

#[test]
fn test_tuplet_number_glyph_exists() {
    // Measure 1 has two 3:2 tuplets → 2 × tuplet "3" glyph (0xE883)
    // Measure 2 has one 6:4 tuplet → 1 × tuplet "6" glyph (0xE886)
    let json = include_str!("../../../../../packages/format/fixtures/mnx/tuplets.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let tuplet_glyphs: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| is_tuplet_number_glyph(c))
        .collect();

    // 3 total tuplets across the score → 3 tuplet number glyphs
    assert_eq!(
        tuplet_glyphs.len(),
        3,
        "Expected 3 tuplet number glyphs (two '3' + one '6'), got {}",
        tuplet_glyphs.len()
    );

    // Verify specific codepoints: tuplet "3" = 0xE883, tuplet "6" = 0xE886
    let three_count = tuplet_glyphs
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == 0xE883))
        .count();
    let six_count = tuplet_glyphs
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == 0xE886))
        .count();
    assert_eq!(
        three_count, 2,
        "Expected 2 tuplet '3' glyphs (0xE883), got {}",
        three_count
    );
    assert_eq!(
        six_count, 1,
        "Expected 1 tuplet '6' glyph (0xE886), got {}",
        six_count
    );
}

#[test]
fn test_tuplet_layout_produces_events() {
    // tuplets.mnx: measure 1 has two tuplets (3-in-2 eighths) + 2 quarter notes
    let json =
        include_str!("../../../../viritura-wasm/../../packages/format/fixtures/mnx/tuplets.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // All 7 events in measure 1 (2+3 from tuplets, 2 regular) should produce glyphs
    let noteheads: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|c| match c {
            RenderCommand::DrawGlyph { codepoint, .. } => {
                // SMuFL noteheadBlack=0xE0A4, noteheadHalf=0xE0A3, noteheadWhole=0xE0A2
                (0xE0A2..=0xE0A4).contains(codepoint)
            }
            _ => false,
        })
        .collect();

    // Measure 1: 5 events, Measure 2: 6 events = 11 noteheads minimum
    assert!(
        noteheads.len() >= 11,
        "Expected at least 11 noteheads from tuplet score, got {}",
        noteheads.len()
    );
}

#[test]
fn test_tuplet_duration_scaling() {
    // 3 eighth notes in the time of 2: each inner event advances by 0.5 * (2/3) = 1/3 beat
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);

    // Voice should have 4 events: 3 from tuplet + 1 regular
    let voice = &ml.voice_layouts[0];
    assert_eq!(
        voice.events_vec().len(),
        4,
        "Expected 4 events (3 tuplet + 1 regular), got {}",
        voice.events_vec().len()
    );

    // The 3 tuplet eighths should span the time of 2 eighths = 1 beat out of 4.
    // The half note starts at beat 1 out of 4 total, so at 25% of content width.
    // Verify the 4th event (half note) x is greater than the 3rd tuplet event x.
    let tuplet_last_x = voice.events_vec()[2].x;
    let regular_x = voice.events_vec()[3].x;
    assert!(
        regular_x > tuplet_last_x,
        "Regular event x ({}) should be after last tuplet event x ({})",
        regular_x,
        tuplet_last_x
    );

    // Verify tuplet events are evenly spaced (equal duration scaling)
    let spacing_1_2 = voice.events_vec()[1].x - voice.events_vec()[0].x;
    let spacing_2_3 = voice.events_vec()[2].x - voice.events_vec()[1].x;
    assert!(
        (spacing_1_2 - spacing_2_3).abs() < 0.01,
        "Tuplet events should be evenly spaced: {} vs {}",
        spacing_1_2,
        spacing_2_3
    );
}

// ═══════════════════════════════════════════
// Tuplet display property tests
// ═══════════════════════════════════════════

/// Helper: build a simple MNX JSON for a 3:2 tuplet with optional display properties.
fn tuplet_mnx_with_display(
    bracket: Option<&str>,
    show_number: Option<&str>,
    show_value: Option<&str>,
) -> String {
    let mut extra = String::new();
    if let Some(b) = bracket {
        extra.push_str(&format!(r#","bracket":"{}""#, b));
    }
    if let Some(sn) = show_number {
        extra.push_str(&format!(r#","showNumber":"{}""#, sn));
    }
    if let Some(sv) = show_value {
        extra.push_str(&format!(r#","showValue":"{}""#, sv));
    }
    format!(
        r#"{{
        "mnx": {{"version": 1}},
        "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
        "parts": [{{"measures": [{{"clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}], "sequences": [{{"content": [
            {{"type": "tuplet",
             "inner": {{"multiple": 3, "duration": {{"base": "eighth"}}}},
             "outer": {{"multiple": 2, "duration": {{"base": "eighth"}}}}
             {}
             ,"content": [
               {{"duration": {{"base": "eighth"}}, "notes": [{{"pitch": {{"step": "C", "octave": 5}}}}]}},
               {{"duration": {{"base": "eighth"}}, "notes": [{{"pitch": {{"step": "D", "octave": 5}}}}]}},
               {{"duration": {{"base": "eighth"}}, "notes": [{{"pitch": {{"step": "E", "octave": 5}}}}]}}
             ]}},
            {{"duration": {{"base": "half"}}, "notes": [{{"pitch": {{"step": "F", "octave": 5}}}}]}}
        ]}}]}}]}}]
    }}"#,
        extra
    )
}

/// Helper: count thin lines that are likely tuplet bracket lines (not barlines).
/// Barlines span the full staff (~4*sp height), while bracket hooks are ~0.5*sp.
fn count_bracket_lines(dl: &DisplayList, sp: f64) -> usize {
    let bracket_lw = 0.16 * sp;
    let staff_height = 4.0 * sp;
    dl.commands
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawLine {
                x1: _,
                y1,
                x2: _,
                y2,
                width,
                ..
            } = c
            {
                if (*width - bracket_lw).abs() > 0.01 {
                    return false;
                }
                let height = (y2 - y1).abs();
                let is_horizontal = height < 0.01;
                let is_short_vertical = height > 0.01 && height < staff_height * 0.5;
                is_horizontal || is_short_vertical
            } else {
                false
            }
        })
        .count()
}

#[test]
fn test_tuplet_bracket_no_hides_bracket_lines() {
    // bracket="no" should suppress bracket lines but still show the number
    let json = tuplet_mnx_with_display(Some("no"), None, None);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Number glyph should still be present (showNumber defaults to inner)
    let tuplet_glyphs = dl
        .commands
        .iter()
        .filter(|c| is_tuplet_number_glyph(c))
        .count();
    assert_eq!(
        tuplet_glyphs, 1,
        "Expected 1 tuplet number glyph with bracket=no, got {}",
        tuplet_glyphs
    );

    // Bracket-specific lines should NOT be present
    let bracket_lines = count_bracket_lines(&dl, sp);
    assert_eq!(
        bracket_lines, 0,
        "Expected 0 bracket lines with bracket=no, got {}",
        bracket_lines
    );
}

#[test]
fn test_tuplet_bracket_yes_shows_bracket() {
    // bracket="yes" should always show bracket lines
    let json = tuplet_mnx_with_display(Some("yes"), None, None);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    let bracket_lines = count_bracket_lines(&dl, sp);
    // 2 hooks + 2 horizontal segments = at least 3 lines
    assert!(
        bracket_lines >= 3,
        "Expected at least 3 bracket lines with bracket=yes, got {}",
        bracket_lines
    );
}

#[test]
fn test_tuplet_show_number_none_hides_number() {
    // showNumber="noNumber" should suppress the tuplet number
    let json = tuplet_mnx_with_display(None, Some("noNumber"), None);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let tuplet_glyphs = dl
        .commands
        .iter()
        .filter(|c| is_tuplet_number_glyph(c))
        .count();
    assert_eq!(
        tuplet_glyphs, 0,
        "Expected 0 tuplet glyphs with showNumber=noNumber, got {}",
        tuplet_glyphs
    );
}

#[test]
fn test_tuplet_show_number_both_renders_ratio_glyphs() {
    // showNumber="both" should compose "3:2" from SMuFL tuplet glyphs.
    let json = tuplet_mnx_with_display(None, Some("both"), None);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let ratio_glyphs: Vec<(u32, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                codepoint, x, size, ..
            } if (0xE880..=0xE889).contains(codepoint) || *codepoint == 0xE88A => {
                Some((*codepoint, *x, *size))
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        ratio_glyphs
            .iter()
            .map(|(codepoint, _, _)| *codepoint)
            .collect::<Vec<_>>(),
        vec![smufl::tuplet_digit(3), 0xE88A, smufl::tuplet_digit(2)],
        "Expected SMuFL 3, colon, 2 glyph sequence"
    );
    let ratio_left = ratio_glyphs
        .iter()
        .map(|(codepoint, x, size)| x + smufl::glyph_bbox(*codepoint).0 * size / 4.0)
        .fold(f64::INFINITY, f64::min);
    let ratio_right = ratio_glyphs
        .iter()
        .map(|(codepoint, x, size)| {
            let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(*codepoint);
            x + (bbox_x + bbox_w) * size / 4.0
        })
        .fold(f64::NEG_INFINITY, f64::max);
    let bracket_lw = 0.16 * config.sp;
    let hook_length = 0.5 * config.sp;
    let hook_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                ..
            } if (*width - bracket_lw).abs() < 0.01
                && (x1 - x2).abs() < 0.01
                && ((y1 - y2).abs() - hook_length).abs() < 0.05 * config.sp =>
            {
                Some(*x1)
            }
            _ => None,
        })
        .collect();
    assert_eq!(hook_xs.len(), 2);
    let bracket_center = (hook_xs[0] + hook_xs[1]) * 0.5;
    assert!(
        ((ratio_left + ratio_right) * 0.5 - bracket_center).abs() < 1.0e-6,
        "ratio glyph sequence must be centered on the bracket"
    );

    let ratio_texts = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawText { text, .. } if text == "3:2"))
        .count();
    assert_eq!(
        ratio_texts, 0,
        "Ratio tuplets must not fall back to DrawText"
    );
}

#[test]
fn test_tuplet_bracket_no_and_show_number_none_hides_all() {
    // bracket=no + showNumber=noNumber should produce no bracket rendering at all
    let json = tuplet_mnx_with_display(Some("no"), Some("noNumber"), None);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    let tuplet_glyphs = dl
        .commands
        .iter()
        .filter(|c| is_tuplet_number_glyph(c))
        .count();
    assert_eq!(tuplet_glyphs, 0, "No tuplet glyphs expected");

    let bracket_lines = count_bracket_lines(&dl, sp);
    assert_eq!(bracket_lines, 0, "No bracket lines expected");
}

#[test]
fn test_tuplet_default_shows_bracket_and_inner_number() {
    // No display properties (all defaults): bracket=auto → shown, showNumber=inner → shown
    let json = tuplet_mnx_with_display(None, None, None);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Number glyph should be present
    let tuplet_glyphs = dl
        .commands
        .iter()
        .filter(|c| is_tuplet_number_glyph(c))
        .count();
    assert_eq!(
        tuplet_glyphs, 1,
        "Expected 1 tuplet number glyph with defaults, got {}",
        tuplet_glyphs
    );

    // Bracket lines should be present
    let bracket_lines = count_bracket_lines(&dl, sp);
    assert!(
        bracket_lines >= 3,
        "Expected at least 3 bracket lines with defaults, got {}",
        bracket_lines
    );
}

#[test]
fn test_tuplet_model_serde_roundtrip() {
    // Verify that bracket, showNumber, showValue survive JSON parse → model → serialize
    let json = r#"{
        "type": "tuplet",
        "inner": {"multiple": 3, "duration": {"base": "eighth"}},
        "outer": {"multiple": 2, "duration": {"base": "eighth"}},
        "bracket": "no",
        "showNumber": "both",
        "showValue": "noNumber",
        "content": [
            {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
        ]
    }"#;
    let value: serde_json::Value = serde_json::from_str(json).unwrap();
    let content_json = value
        .get("content")
        .cloned()
        .unwrap_or(serde_json::Value::Array(Vec::new()));
    let raw: crate::raw::Tuplet = serde_json::from_value(value).unwrap();
    let parsed = crate::promote::event::promote_tuplet(raw, content_json).unwrap();
    assert_eq!(parsed.bracket, Some(TupletBracket::No));
    assert_eq!(parsed.show_number, Some(TupletDisplaySetting::Both));
    assert_eq!(parsed.show_value, Some(TupletDisplaySetting::NoNumber));

    // Serialize back and verify
    let serialized = serde_json::to_string(&parsed).unwrap();
    assert!(
        serialized.contains(r#""bracket":"no""#),
        "Serialized should contain bracket"
    );
    assert!(
        serialized.contains(r#""showNumber":"both""#),
        "Serialized should contain showNumber"
    );
    assert!(
        serialized.contains(r#""showValue":"noNumber""#),
        "Serialized should contain showValue"
    );
}

#[test]
fn test_tuplet_commands_tagged_with_element_ids() {
    // Verify that tuplet bracket and number commands are tagged with structured element IDs
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find tuplet-tagged commands (bracket lines + number glyph)
    let tuplet_ids: Vec<&str> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_deref())
        .filter(|id| id.contains("/tuplet"))
        .collect();

    assert!(
        !tuplet_ids.is_empty(),
        "Tuplet commands should have element IDs"
    );

    // Should have ID: p0/m0/s0/tuplet0
    assert!(
        tuplet_ids.iter().all(|id| *id == "p0/m0/s0/tuplet0"),
        "All tuplet commands should have ID p0/m0/s0/tuplet0, got: {:?}",
        tuplet_ids
    );
}

#[test]
fn test_beat_anchors_include_tuplet_events() {
    // A 3:2 triplet of eighths (beats 0, 1/3, 2/3) followed by a half note (beat 1).
    // build_beat_anchors should produce 5 anchors: 0, 0.333, 0.667, 1.0, 4.0 (end).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
            {"duration": {"base": "quarter"}, "rest": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);

    let (total_beats, anchors) = build_beat_anchors(&ml);
    assert_eq!(total_beats, 4.0);

    let beats: Vec<f64> = anchors.iter().map(|(b, _)| *b).collect();
    eprintln!("Beat anchors: {:?}", beats);

    // Should have 6 anchors: tuplet events at 0, 1/3, 2/3 + half note at 1.0 + rest at 3.0 + end at 4.0
    assert_eq!(
        beats.len(),
        6,
        "Expected 6 beat anchors (3 tuplet + half + rest + end), got {}: {:?}",
        beats.len(),
        beats
    );

    // Check tuplet beat positions
    assert!(
        (beats[0] - 0.0).abs() < 1e-9,
        "First tuplet event at beat 0"
    );
    assert!(
        (beats[1] - 1.0 / 3.0).abs() < 1e-9,
        "Second tuplet event at beat 1/3, got {}",
        beats[1]
    );
    assert!(
        (beats[2] - 2.0 / 3.0).abs() < 1e-9,
        "Third tuplet event at beat 2/3, got {}",
        beats[2]
    );
    assert!(
        (beats[3] - 1.0).abs() < 1e-9,
        "Half note at beat 1.0, got {}",
        beats[3]
    );
}

#[test]
fn test_tuplet_proportional_spacing_quarter_vs_eighth() {
    // A 3:2 tuplet containing a quarter + eighth should give the quarter
    // roughly double the space of the eighth (proportional to duration).
    // Before the fix, min_note_spacing=3.2 clamped both to nearly equal widths.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
            {"duration": {"base": "quarter"}, "rest": {}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let durations = collect_all_event_durations(&measures);
    let csd = detect_common_shortest_duration(&durations);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], csd);
    let voice = &ml.voice_layouts[0];

    // Events: tuplet-quarter (0), tuplet-eighth (1), half (2), rest (3)
    assert_eq!(voice.events_vec().len(), 4);

    // Gap from tuplet-quarter to tuplet-eighth
    let gap_q = voice.events_vec()[1].x - voice.events_vec()[0].x;
    // Gap from tuplet-eighth to half note
    let gap_e = voice.events_vec()[2].x - voice.events_vec()[1].x;

    // The quarter inside the tuplet spans 2/3 beat, the eighth spans 1/3 beat.
    // The quarter gap should be noticeably wider than the eighth gap
    // (at least 1.2x, ideally close to 2x).
    let ratio = gap_q / gap_e;
    assert!(
        ratio > 1.15,
        "Tuplet quarter gap ({:.2}) should be wider than eighth gap ({:.2}), ratio={:.3}",
        gap_q,
        gap_e,
        ratio
    );
}

#[test]
fn test_tuplet_six_quarters_even_spacing() {
    // A 6:4 tuplet with six equal quarter notes: all should be equally spaced.
    // Use inline MNX with identical pitches to avoid stem direction effects.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 6, "duration": {"base": "quarter"}},
             "outer": {"multiple": 4, "duration": {"base": "quarter"}},
             "content": [
               {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
             ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let durations = collect_all_event_durations(&measures);
    let csd = detect_common_shortest_duration(&durations);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], csd);
    let voice = &ml.voice_layouts[0];
    assert_eq!(voice.events_vec().len(), 6);

    // All gaps between consecutive events should be equal
    let gaps: Vec<f64> = (0..5)
        .map(|i| voice.events_vec()[i + 1].x - voice.events_vec()[i].x)
        .collect();
    for i in 1..gaps.len() {
        assert!(
            (gaps[i] - gaps[0]).abs() < 0.1,
            "Gap {} ({:.2}) should equal gap 0 ({:.2}) in 6:4 sextuplet",
            i,
            gaps[i],
            gaps[0]
        );
    }
}

#[test]
fn test_tuplet_number_on_stem_side_outside_staff() {
    // Low notes (below the middle line) have stems up, so the tuplet number
    // belongs on the stem side = above the staff, and must clear the top staff
    // line entirely. Previously the auto side was inverted (notehead side).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let dl = layout_score(&score, 0, &config);

    let number_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, .. } if is_tuplet_number_glyph(c) => Some(*y),
            _ => None,
        })
        .expect("tuplet number glyph");

    // Stem side (above) for stems-up notes, and above the top staff line.
    assert!(
        number_y < staff_y,
        "tuplet number y={number_y} should be above the top staff line y={staff_y} (stem side, outside staff)"
    );
}

#[test]
fn test_tuplet_bracket_clears_articulations_on_bracket_side() {
    // Standard engraving practice: a tuplet bracket clears articulations on its
    // own side. In a multi-voice context articulations sit on the stem (bracket)
    // side, so accents on a stems-up triplet share the side with the bracket —
    // the bracket must move out past the accents rather than overlap them.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"type": "tuplet",
                     "inner": {"multiple": 3, "duration": {"base": "eighth"}},
                     "outer": {"multiple": 2, "duration": {"base": "eighth"}},
                     "content": [
                       {"duration": {"base": "eighth"}, "stemDirection": "up",
                        "markings": {"accent": {}}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                       {"duration": {"base": "eighth"}, "stemDirection": "up",
                        "markings": {"accent": {}}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                       {"duration": {"base": "eighth"}, "stemDirection": "up",
                        "markings": {"accent": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                     ]},
                    {"duration": {"base": "half"}, "stemDirection": "up", "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                ]},
                {"content": [
                    {"duration": {"base": "whole"}, "stemDirection": "down", "notes": [{"pitch": {"step": "F", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Top edge of the highest accent glyph (accentAbove, stem side).
    let accent_top = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph {
                y, size, codepoint, ..
            } if (0xE4A0..=0xE4BF).contains(codepoint) => {
                let glyph_sp = size / 4.0;
                let (_bx, by, _bw, _bh) = crate::render::smufl::smufl::glyph_bbox(*codepoint);
                Some(y + by * glyph_sp)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    assert!(
        accent_top.is_finite(),
        "expected at least one accent glyph above the staff"
    );

    // Highest tuplet bracket horizontal line (thin bracket-width, horizontal).
    let bracket_lw = 0.16 * sp;
    let bracket_y = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                ..
            } if (width - bracket_lw).abs() < 0.01
                && (y1 - y2).abs() < 0.01
                && (x1 - x2).abs() > sp =>
            {
                Some(*y1)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    assert!(
        bracket_y.is_finite(),
        "expected a horizontal tuplet bracket line"
    );

    // The bracket must sit above the accents' top edge (smaller Y), clear of them.
    assert!(
        bracket_y < accent_top - 0.5 * sp,
        "tuplet bracket y={bracket_y} should clear the accent top y={accent_top} \
         (bracket moves out past articulations on its side)"
    );
}

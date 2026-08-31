// Auto-generated from tests.rs — test_caesura
// 4 test(s)

use super::test_helpers::is_beam_polygon;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

// ═══════════════════════════════════════════
// Caesura tests
// ═══════════════════════════════════════════
#[test]
fn test_caesura_renders_from_mnx() {
    // Load the caesura.mnx sample which has 4 measures with different caesura styles
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/caesura.mnx"
    );
    let json = std::fs::read_to_string(path).unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect caesura glyph codepoints
    let caesura_glyphs: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. }
                if [
                    smufl::CAESURA,
                    smufl::CAESURA_THICK,
                    smufl::CAESURA_SHORT,
                    smufl::CAESURA_CURVED,
                ]
                .contains(codepoint) =>
            {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    // Should have 4 caesura glyphs (one per measure)
    assert_eq!(
        caesura_glyphs.len(),
        4,
        "Expected 4 caesura glyphs, got {}: {:?}",
        caesura_glyphs.len(),
        caesura_glyphs
    );

    // Verify all four style types are present
    assert!(
        caesura_glyphs.contains(&smufl::CAESURA),
        "Missing normal caesura"
    );
    assert!(
        caesura_glyphs.contains(&smufl::CAESURA_THICK),
        "Missing thick caesura"
    );
    assert!(
        caesura_glyphs.contains(&smufl::CAESURA_SHORT),
        "Missing short caesura"
    );
    assert!(
        caesura_glyphs.contains(&smufl::CAESURA_CURVED),
        "Missing curved caesura"
    );
}

#[test]
fn test_caesura_above_staff() {
    // Caesura glyph strokes should span from second staff line to first ledger line above.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"_x": {"viritura": {"caesura": {}}}}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Find one caesura glyph.
    let caesura_glyph = dl.commands.iter().find_map(|cmd| match cmd {
        RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::CAESURA => {
            Some((*codepoint, *y))
        }
        _ => None,
    });

    assert!(caesura_glyph.is_some(), "Should render a caesura glyph");
    let (codepoint, glyph_y) = caesura_glyph.unwrap();
    let (_, yoff, _, h) = smufl::glyph_bbox(codepoint);

    let staff_y = config.margin_top * sp;
    let glyph_top = glyph_y + yoff * sp;
    let glyph_bottom = glyph_top + h * sp;

    assert!(
        (glyph_bottom - (staff_y + sp)).abs() < 0.2 * sp,
        "Caesura bottom should be near second staff line: got y={:.3}, expected y={:.3}",
        glyph_bottom,
        staff_y + sp
    );
    assert!(
        (glyph_top - (staff_y - sp)).abs() < 0.2 * sp,
        "Caesura top should be near first ledger line above: got y={:.3}, expected y={:.3}",
        glyph_top,
        staff_y - sp
    );
}

#[test]
fn test_caesura_default_style_is_normal() {
    // When no style is specified, caesura should use normal (U+E4D1).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"_x": {"viritura": {"caesura": {}}}}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_normal = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::CAESURA)
    });

    assert!(
        has_normal,
        "Default caesura should use normal style (U+E4D1)"
    );
}

#[test]
fn test_caesura_near_measure_end() {
    // Caesura should be positioned near the right end of the measure (before barline)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"_x": {"viritura": {"caesura": {}}}}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find the caesura glyph X position.
    let caesura_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::CAESURA => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render a caesura glyph");

    // The caesura should be in the right half of the display
    assert!(
        caesura_x > dl.width * 0.3,
        "Caesura x={:.1} should be in the right portion of the measure (width={:.1})",
        caesura_x,
        dl.width
    );
}

#[test]
fn test_caesura_breaks_beam_group() {
    // Four eighth notes in 4/4 normally beam as one half-measure group (1 beam
    // polygon). A caesura on the second eighth forces a beam break after it, so
    // the run splits into two beamed pairs (2 beam polygons).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}],
                 "markings": {"_x": {"viritura": {"caesura": {}}}}},
                {"id": "e3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 2,
        "A caesura mid-run should split the beam into two groups (2 polygons), got {}",
        poly_count
    );
}

#[test]
fn test_caesura_reserves_horizontal_space() {
    // 8 quarter notes each carrying a caesura (8/4 time). A caesura reserves its
    // own horizontal footprint (like an accidental), so adjacent caesura glyphs
    // must not overlap and each must clear its preceding notehead.
    let note = r#"{"duration": {"base": "quarter"}, "markings": {"_x": {"viritura": {"caesura": {}}}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}"#;
    let eight_notes = std::iter::repeat_n(note, 8).collect::<Vec<_>>().join(", ");
    let json = format!(
        r#"{{
        "mnx": {{"version": 1}},
        "global": {{"measures": [{{"time": {{"count": 8, "unit": 4}}}}]}},
        "parts": [{{"measures": [{{
            "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
            "sequences": [{{"content": [{eight_notes}]}}]
        }}]}}]
    }}"#
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let caesura_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::CAESURA => {
                Some(*x)
            }
            _ => None,
        })
        .collect();

    assert_eq!(caesura_xs.len(), 8, "Should render 8 caesura glyphs");

    let (_, _, cw, _) = smufl::glyph_bbox(smufl::CAESURA);
    for i in 0..caesura_xs.len() - 1 {
        let right_edge = caesura_xs[i] + cw * sp;
        let next_left = caesura_xs[i + 1];
        assert!(
            right_edge <= next_left + 0.01 * sp,
            "Caesura {} right edge ({:.1}px) overlaps caesura {} left ({:.1}px)",
            i,
            right_edge,
            i + 1,
            next_left,
        );
    }
}

#[test]
fn test_caesura_clears_next_note_accidental() {
    // A caesura on a note followed by a note that carries an accidental must be
    // engraved to the LEFT of that accidental's column, not on top of it. The
    // spacing engine reserves room for both; the glyph just has to land in it.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"_x": {"viritura": {"caesura": {}}}}},
                {"duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "B", "octave": 4, "alter": -1}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let caesura_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::CAESURA => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render a caesura glyph");

    // The flat glyph drawn for the second note.
    let flat_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. }
                if *codepoint == smufl::ACCIDENTAL_FLAT =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render the flat accidental");

    let (_, _, cw, _) = smufl::glyph_bbox(smufl::CAESURA);
    let caesura_right = caesura_x + cw * sp;
    assert!(
        caesura_right <= flat_x + 0.01 * sp,
        "Caesura right edge ({:.1}px) overlaps the next note's flat (x={:.1}px)",
        caesura_right,
        flat_x,
    );
}

#[test]
fn test_caesura_ignores_centered_full_bar_rest_in_other_voice() {
    // Regression (Rhapsody, Percussion m485 before reh. 39): a caesura carried
    // by an inner-beat note in one voice must anchor to the NEXT ONSET, not to a
    // full-bar rest sitting in another voice. A half/whole rest filling the bar
    // is drawn CENTERED near the measure middle even though its onset is beat 0;
    // an x-based "next event" search mistook that centered glyph for the next
    // event and placed the caesura LEFT of its own carrier. The caesura must
    // land in the gap AFTER the carrier note and BEFORE the following rest.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"voice": "v1", "content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "D", "octave": 5}}],
                     "markings": {"_x": {"viritura": {"caesura": {}}}}},
                    {"duration": {"base": "eighth"}, "rest": {}}
                ]},
                {"voice": "v2", "content": [
                    {"duration": {"base": "half"}, "rest": {}}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let caesura_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::CAESURA => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render a caesura glyph");

    // Carrier = the rightmost (latest-onset) notehead in the bar (the D5 eighth).
    let carrier_x = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if smufl::is_notehead(*codepoint) => {
                Some(*x)
            }
            _ => None,
        })
        .fold(f64::MIN, f64::max);

    // The eighth rest (beat 1.5) in voice 1 — the genuine next onset.
    let eighth_rest_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::REST_8TH => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render the eighth rest");

    assert!(
        caesura_x > carrier_x,
        "Caesura (x={caesura_x:.1}) must sit AFTER its carrier note (x={carrier_x:.1}), \
         not be pulled left by the centered full-bar rest in the other voice",
    );
    assert!(
        caesura_x < eighth_rest_x,
        "Caesura (x={caesura_x:.1}) must sit BEFORE the following eighth rest (x={eighth_rest_x:.1})",
    );
}

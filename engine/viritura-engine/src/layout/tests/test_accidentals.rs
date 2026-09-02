// Auto-generated from tests.rs — test_accidentals
// 3 test(s)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::resolve::resolve_measures;
use crate::layout::spacing::{accidental_bbox_gap, build_log_spacing_for_resolved_measure};
use crate::layout::{layout_full_score, layout_score, layout_with_mnx_scores};
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

fn condensed_accidental_count(dl: &DisplayList, config: &LayoutConfig) -> usize {
    let bounds = dl
        .measure_bounds
        .iter()
        .find(|bounds| bounds.staff_index == 0 && !bounds.is_expansion)
        .expect("condensed staff bounds");
    dl.commands
        .iter()
        .zip(&dl.element_ids)
        .filter(|(command, id)| {
            let in_staff_band = match command {
                RenderCommand::DrawGlyph { y, .. } => {
                    *y >= bounds.y - 4.0 * config.sp
                        && *y <= bounds.y + bounds.height + 4.0 * config.sp
                }
                _ => false,
            };
            in_staff_band && id.as_deref().is_some_and(|id| id.contains("/acc"))
        })
        .count()
}

#[test]
fn test_condensed_accidentals_do_not_depend_on_expansion_visibility() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "layouts": [
            {"id": "condensed", "content": [
                {"type": "staff", "sources": [{"part": "p1"}, {"part": "p2"}]}
            ]},
            {"id": "expanded", "content": [
                {"type": "staff", "sources": [{"part": "p1"}, {"part": "p2"}]},
                {"type": "staff", "sources": [{"part": "p1"}], "_expansion": true},
                {"type": "staff", "sources": [{"part": "p2"}], "_expansion": true}
            ]}
        ],
        "scores": [
            {"name": "Condensed", "layout": "condensed"},
            {"name": "Expanded", "layout": "expanded"}
        ],
        "parts": [
            {"id": "p1", "measures": [{"sequences": [{"content": [
                {"id": "one", "duration": {"base": "whole"},
                 "notes": [{"pitch": {"step": "B", "octave": 4}}]}
            ]}]}]},
            {"id": "p2", "measures": [{"sequences": [{"content": [
                {"id": "two", "duration": {"base": "whole"},
                 "notes": [{"pitch": {"step": "B", "octave": 4, "alter": -1},
                            "accidentalDisplay": {"show": true}}]}
            ]}]}]}
        ]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let collapsed = layout_with_mnx_scores(&score, &config, 0);
    let expanded = layout_with_mnx_scores(&score, &config, 1);

    assert_eq!(
        condensed_accidental_count(&collapsed, &config),
        condensed_accidental_count(&expanded, &config),
        "diagnostic expansion staves must not alter condensed accidental content"
    );
}

#[test]
fn test_accidental_rendered_left_of_notehead() {
    // A sharp on F#4 should produce an accidental glyph to the left of the notehead
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find accidental and notehead glyphs
    let acc = dl.commands.iter().find(|c| is_accidental_glyph(c));
    assert!(
        acc.is_some(),
        "Expected an accidental glyph in display list"
    );

    // The accidental X must be strictly less than the notehead X
    if let (
        Some(RenderCommand::DrawGlyph { x: acc_x, .. }),
        Some(RenderCommand::DrawGlyph {
            x: note_x,
            codepoint: _,
            ..
        }),
    ) = (
        acc,
        dl.commands.iter().find(
            |c| matches!(c, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == 0xE0A4),
        ),
    ) {
        assert!(
            *acc_x < *note_x,
            "Accidental x ({}) must be left of notehead x ({})",
            acc_x,
            note_x
        );
    }
}

#[test]
fn test_accidental_uses_actual_glyph_width() {
    // Sharp and flat should be positioned at different X offsets from their noteheads
    // because they have different widths (sharp=0.996sp, flat=0.904sp)
    let json_sharp = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}}]}
        ]}]}]}]
    }"#;
    let json_flat = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4, "alter": -1}, "accidentalDisplay": {"show": true}}]}
        ]}]}]}]
    }"#;

    let config = LayoutConfig::default();
    let sp = config.sp;

    let dl_sharp = layout_score(&parse_mnx(json_sharp).unwrap(), 0, &config);
    let dl_flat = layout_score(&parse_mnx(json_flat).unwrap(), 0, &config);

    // Extract accidental-to-notehead gap for each
    let gap_for = |dl: &DisplayList| -> f64 {
        let note_x = dl
            .commands
            .iter()
            .find_map(|c| match c {
                RenderCommand::DrawGlyph { x, codepoint, .. }
                    if *codepoint == 0xE0A2 || *codepoint == 0xE0A4 =>
                {
                    Some(*x)
                }
                _ => None,
            })
            .unwrap();
        let acc_x = dl
            .commands
            .iter()
            .find_map(|c| match c {
                RenderCommand::DrawGlyph { x, codepoint, .. }
                    if (0xE260..=0xE264).contains(codepoint) =>
                {
                    Some(*x)
                }
                _ => None,
            })
            .unwrap();
        note_x - acc_x
    };

    let sharp_gap = gap_for(&dl_sharp);
    let flat_gap = gap_for(&dl_flat);

    // Sharp is wider than flat, so the gap should be larger
    assert!(
        sharp_gap > flat_gap,
        "Sharp gap ({:.3}) should be larger than flat gap ({:.3}) due to different glyph widths",
        sharp_gap,
        flat_gap
    );

    // Verify gaps are roughly correct: width + 0.12*sp
    let expected_sharp = (0.996 + 0.12) * sp;
    let expected_flat = (0.904 + 0.12) * sp;
    assert!(
        (sharp_gap - expected_sharp).abs() < 0.1 * sp,
        "Sharp gap {:.3} should be ~{:.3}",
        sharp_gap,
        expected_sharp
    );
    assert!(
        (flat_gap - expected_flat).abs() < 0.1 * sp,
        "Flat gap {:.3} should be ~{:.3}",
        flat_gap,
        expected_flat
    );
}

#[test]
fn test_accidentals_mnx_file_renders_accidentals() {
    // Load accidentals.mnx and verify accidental glyphs are produced
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/format/fixtures/mnx/accidentals.mnx");
    let json = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("Cannot read {:?}", path));

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let acc_count = dl
        .commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .count();
    // accidentals.mnx has G#4 (m1), Db5 (m2 accidentalDisplay), D-natural (m3 accidentalDisplay)
    // plus key signature Bb/Eb. Expect at least 3 accidentals on notes.
    assert!(
        acc_count >= 3,
        "Expected at least 3 accidental glyphs from accidentals.mnx, got {}",
        acc_count
    );
}

#[test]
fn test_accidental_display_show_false_suppresses() {
    // A sharp on C#5 in C major — normally should show, but show:false suppresses it
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5, "alter": 1}, "accidentalDisplay": {"show": false}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let acc_count = dl
        .commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .count();
    assert_eq!(
        acc_count, 0,
        "show:false should suppress the accidental, got {} accidental glyphs",
        acc_count
    );
}

#[test]
fn test_accidental_display_force_bypasses_dedup() {
    // Two C#5 notes in C major — second should normally be suppressed by dedup,
    // but force:true on the second should make it display anyway
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5, "alter": 1}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5, "alter": 1}, "accidentalDisplay": {"show": true, "force": true}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let acc_count = dl
        .commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .count();
    assert_eq!(
        acc_count, 2,
        "force:true should bypass dedup — expected 2 accidentals, got {}",
        acc_count
    );
}

#[test]
fn test_accidental_enclosure_parentheses() {
    // A sharp with parentheses enclosure should render: left-paren + accidental + right-paren
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"id": "enclosed", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true, "enclosure": {"symbol": "parentheses"}}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have exactly 1 accidental glyph
    let acc_count = dl
        .commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .count();
    assert_eq!(
        acc_count, 1,
        "Expected 1 accidental glyph, got {}",
        acc_count
    );

    // Should have exactly 2 enclosure glyphs (left + right parenthesis)
    let enc_count = dl
        .commands
        .iter()
        .filter(|c| is_accidental_enclosure_glyph(c))
        .count();
    assert_eq!(
        enc_count, 2,
        "Expected 2 enclosure glyphs (left+right paren), got {}",
        enc_count
    );

    // Verify the specific codepoints: left paren, then accidental, then right paren
    let parens_left_count = dl.commands.iter().filter(|c| matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_PARENS_LEFT
    )).count();
    let parens_right_count = dl.commands.iter().filter(|c| matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_PARENS_RIGHT
    )).count();
    assert_eq!(parens_left_count, 1, "Expected 1 left parenthesis glyph");
    assert_eq!(parens_right_count, 1, "Expected 1 right parenthesis glyph");
    let accidental_shapes: Vec<_> = dl
        .element_shapes
        .iter()
        .filter(|shape| shape.kind == ElementKind::Accidental)
        .collect();
    assert_eq!(
        accidental_shapes.len(),
        3,
        "body and both enclosure glyphs must publish exact shapes"
    );
    assert!(accidental_shapes
        .iter()
        .all(|shape| shape.element_id.starts_with("enclosed/accidental/")));
}

#[test]
fn test_accidental_enclosure_brackets() {
    // A flat with brackets enclosure should render: left-bracket + accidental + right-bracket
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4, "alter": -1}, "accidentalDisplay": {"show": true, "enclosure": {"symbol": "brackets"}}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have 2 bracket enclosure glyphs
    let bracket_left_count = dl.commands.iter().filter(|c| matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_BRACKET_LEFT
    )).count();
    let bracket_right_count = dl.commands.iter().filter(|c| matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_BRACKET_RIGHT
    )).count();
    assert_eq!(bracket_left_count, 1, "Expected 1 left bracket glyph");
    assert_eq!(bracket_right_count, 1, "Expected 1 right bracket glyph");
}

#[test]
fn test_accidental_enclosure_ordering() {
    // Parenthesized accidental: left paren X < accidental X < right paren X
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true, "enclosure": {"symbol": "parentheses"}}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let left_paren_x = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::ACCIDENTAL_PARENS_LEFT =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Expected left paren glyph");

    let acc_x = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if (0xE260..=0xE264).contains(codepoint) =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Expected accidental glyph");

    let right_paren_x = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::ACCIDENTAL_PARENS_RIGHT =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Expected right paren glyph");

    assert!(
        left_paren_x < acc_x,
        "Left paren x ({}) should be < accidental x ({})",
        left_paren_x,
        acc_x
    );
    assert!(
        acc_x < right_paren_x,
        "Accidental x ({}) should be < right paren x ({})",
        acc_x,
        right_paren_x
    );
}

#[test]
fn test_transposed_instrument_no_spurious_accidentals() {
    // Bb clarinet playing concert D major scale (D E F# G A B C# D).
    // Written pitch: E major scale (E F# G# A B C# D# E).
    // The display key is E major (4 sharps: F# C# G# D#).
    // All written notes are diatonic to E major — NO accidentals should appear.
    use crate::layout::mnx_layout::layout_with_mnx_scores;

    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}}]},
        "layouts": [{"id": "L", "content": [{"type": "staff", "sources": [{"part": "cl"}]}]}],
        "scores": [{"name": "Cl", "layout": "L", "useWritten": true}],
        "parts": [{
            "id": "cl",
            "name": "Clarinet in Bb",
            "transposition": {"interval": {"halfSteps": 2, "staffDistance": 1}},
            "measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]}]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Count note accidentals only (exclude key signature accidentals).
    // Note accidentals are NOT tagged with element IDs matching "keySig",
    // while key sig accidentals are within the prefix area.
    // Use x-position: note accidentals appear after the prefix (clef + key sig + time sig).
    let _prefix_end = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::ACCIDENTAL_SHARP
                    || *codepoint == smufl::ACCIDENTAL_FLAT =>
            {
                Some(*x)
            }
            _ => None,
        })
        .fold(0.0f64, f64::min); // key sig accidentals are at the left

    // Find where notes start (first notehead)
    let first_notehead_x = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_BLACK
                    || *codepoint == smufl::NOTEHEAD_WHOLE
                    || *codepoint == smufl::NOTEHEAD_HALF =>
            {
                Some(*x)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);

    // Count accidentals that appear at or after the first notehead area (note accidentals)
    let note_accidental_count = dl
        .commands
        .iter()
        .filter(|c| {
            match c {
                RenderCommand::DrawGlyph { x, codepoint, .. }
                    if (*codepoint == smufl::ACCIDENTAL_SHARP
                        || *codepoint == smufl::ACCIDENTAL_FLAT
                        || *codepoint == smufl::ACCIDENTAL_NATURAL
                        || *codepoint == smufl::ACCIDENTAL_DOUBLE_SHARP
                        || *codepoint == smufl::ACCIDENTAL_DOUBLE_FLAT)
                        && *x >= first_notehead_x - 50.0 =>
                {
                    true
                } // note accidentals are near noteheads
                _ => false,
            }
        })
        .count();

    assert_eq!(
        note_accidental_count, 0,
        "Bb clarinet D major scale (written E major) should have NO note accidentals, found {}",
        note_accidental_count
    );
}

#[test]
fn test_cut_out_kerning_sharps_interlock() {
    // Two sharps on adjacent notes (e.g., F#4 and G#4, positions 2 half-spaces apart)
    // should benefit from cut-out kerning — the sharp glyph has all 4 cut-outs.
    // With cut-outs, the second sharp's column should be closer to the notehead
    // than it would be with simple bbox-only collision.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [
                {"pitch": {"step": "F", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}},
                {"pitch": {"step": "G", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find all sharp accidental glyphs
    let sharp_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::ACCIDENTAL_SHARP =>
            {
                Some(*x)
            }
            _ => None,
        })
        .collect();

    assert_eq!(
        sharp_xs.len(),
        2,
        "Expected 2 sharp accidentals, found {}",
        sharp_xs.len()
    );

    // Both sharps should be to the left of noteheads (basic sanity)
    let notehead_x = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_WHOLE =>
            {
                Some(*x)
            }
            _ => None,
        })
        .unwrap();

    for &sx in &sharp_xs {
        assert!(
            sx < notehead_x,
            "Sharp at {:.1} should be left of notehead at {:.1}",
            sx,
            notehead_x
        );
    }
}

#[test]
fn test_cut_out_data_matches_bravura() {
    // Bravura stores cut-outs as coordinates; the engine exposes dimensions
    // measured inward from each corresponding glyph-bounding-box corner.
    let flat_cuts = smufl::accidental_cut_outs(-1);
    assert_eq!(flat_cuts.ne, Some((0.652, 1.100)));
    assert_eq!(flat_cuts.se, Some((0.400, 0.224)));
    assert!(flat_cuts.nw.is_none());
    assert!(flat_cuts.sw.is_none());

    let nat_cuts = smufl::accidental_cut_outs(0);
    assert_eq!(nat_cuts.ne, Some((0.480, 0.588)));
    assert_eq!(nat_cuts.sw, Some((0.476, 0.512)));
    assert!(nat_cuts.nw.is_none());
    assert!(nat_cuts.se.is_none());

    // Sharp: all four corners
    let sharp_cuts = smufl::accidental_cut_outs(1);
    assert_eq!(sharp_cuts.ne, Some((0.156, 0.504)));
    assert_eq!(sharp_cuts.nw, Some((0.144, 0.832)));
    assert_eq!(sharp_cuts.se, Some((0.156, 0.796)));
    assert_eq!(sharp_cuts.sw, Some((0.144, 0.496)));

    // Double sharp: no cut-outs
    let dbl_sharp_cuts = smufl::accidental_cut_outs(2);
    assert!(dbl_sharp_cuts.ne.is_none());
    assert!(dbl_sharp_cuts.se.is_none());
    assert!(dbl_sharp_cuts.nw.is_none());
    assert!(dbl_sharp_cuts.sw.is_none());

    // Double flat: NE and SE only
    let dbl_flat_cuts = smufl::accidental_cut_outs(-2);
    assert_eq!(dbl_flat_cuts.ne, Some((0.656, 1.104)));
    assert_eq!(dbl_flat_cuts.se, Some((0.308, 0.304)));
    assert!(dbl_flat_cuts.nw.is_none());
    assert!(dbl_flat_cuts.sw.is_none());
}

#[test]
fn test_cut_out_kerning_flat_and_sharp_interlock() {
    // A flat (Bb4) and a sharp (F#4) in the same chord — vertically far enough apart
    // that the sharp's NW/SW cut-outs should allow the flat to tuck in closer.
    // The flat's SE cut-out and the sharp's NE cut-out should also help.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [
                {"pitch": {"step": "F", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}},
                {"pitch": {"step": "B", "octave": 4, "alter": -1}, "accidentalDisplay": {"show": true}}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find the accidental glyphs
    let acc_glyphs: Vec<(f64, u32)> = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::ACCIDENTAL_SHARP
                    || *codepoint == smufl::ACCIDENTAL_FLAT =>
            {
                Some((*x, *codepoint))
            }
            _ => None,
        })
        .collect();

    assert_eq!(
        acc_glyphs.len(),
        2,
        "Expected 2 accidentals, found {}",
        acc_glyphs.len()
    );

    // Both should be left of noteheads
    let notehead_x = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_WHOLE =>
            {
                Some(*x)
            }
            _ => None,
        })
        .unwrap();

    for (ax, _) in &acc_glyphs {
        assert!(
            *ax < notehead_x,
            "Accidental at {:.1} should be left of notehead at {:.1}",
            ax,
            notehead_x
        );
    }
}

/// Count note accidental glyphs (sharp/flat/natural/double) in the display list.
fn count_accidentals(dl: &DisplayList) -> usize {
    dl.commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .count()
}

#[test]
fn test_natural_cancels_earlier_sharp_in_measure() {
    // C major. Bar: F#4 (quarter) then F4-natural (quarter), same octave.
    // The F# must show a sharp; the following natural F must show a NATURAL
    // to cancel the in-measure sharp. Standard engraving practice.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    let sharps = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_SHARP)
        })
        .count();
    let naturals = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_NATURAL)
        })
        .count();
    assert_eq!(sharps, 1, "Expected 1 sharp on F#4, got {}", sharps);
    assert_eq!(
        naturals, 1,
        "Expected 1 natural cancelling the in-measure sharp on F4, got {}",
        naturals
    );
}

#[test]
fn test_in_measure_accidental_overrides_key_for_later_note() {
    // G major (F is sharp by key). Bar: F4 explicitly flattened (alter -1),
    // then a later F4 carrying the key's alter +1. The first must show a flat;
    // the second must show a SHARP, because the earlier in-measure flat — not
    // the key — is what's in effect. Without running measure state this second
    // note would silently render with no glyph and be misread as F-flat.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 1}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": -1}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    let flats = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_FLAT)
        })
        .count();
    let sharps = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_SHARP)
        })
        .count();
    // 1 key-signature sharp (F#) in the prefix + 1 sharp on the second F4.
    assert_eq!(flats, 1, "Expected 1 flat on the first F4, got {}", flats);
    assert_eq!(
        sharps, 2,
        "Expected key-sig sharp + 1 sharp restoring the later F4, got {}",
        sharps
    );
}

#[test]
fn test_accidental_propagation_is_octave_specific() {
    // C major. F#4 (quarter) then F5-natural (quarter): different octave.
    // The sharp on F4 must NOT force a natural on F5 — accidentals propagate
    // only within the same staff position (step + octave).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    // Only the F#4 sharp — the F5 in a different octave needs no natural.
    assert_eq!(
        count_accidentals(&dl),
        1,
        "Octave-specific propagation: only F#4 should carry an accidental"
    );
}

#[test]
fn test_repeated_accidental_suppressed_in_measure() {
    // C major. Two F#4 in the same measure: the second is implied by the first
    // and must NOT redraw the sharp.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    assert_eq!(
        count_accidentals(&dl),
        1,
        "Repeated F#4 in the same measure should show the sharp only once"
    );
}

#[test]
fn test_accidental_resets_at_barline() {
    // C major. Measure 1: F#4. Measure 2: F4 (natural by key). The barline
    // resets accidental state, but the first return to F natural receives a
    // parenthesized courtesy cancellation for the preceding measure's F#.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    assert_eq!(
        count_accidentals(&dl),
        2,
        "The first F natural after a barline must cancel the preceding F# with a courtesy natural"
    );
    let parens = dl
        .commands
        .iter()
        .filter(|command| {
            matches!(command,
            RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::ACCIDENTAL_PARENS_LEFT
                    || *codepoint == smufl::ACCIDENTAL_PARENS_RIGHT)
        })
        .count();
    assert_eq!(parens, 2, "The cancellation natural must be parenthesized");
}

#[test]
fn test_transposed_instrument_shows_needed_accidentals() {
    // Bb clarinet playing concert C natural — written D natural.
    // Display key: D major (F# C#). D natural is diatonic — no accidental.
    // But concert C# (written D#) should show a sharp since D# is not in D major.
    use crate::layout::mnx_layout::layout_with_mnx_scores;

    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 0}}]},
        "layouts": [{"id": "L", "content": [{"type": "staff", "sources": [{"part": "cl"}]}]}],
        "scores": [{"name": "Cl", "layout": "L", "useWritten": true}],
        "parts": [{
            "id": "cl",
            "name": "Clarinet in Bb",
            "transposition": {"interval": {"halfSteps": 2, "staffDistance": 1}},
            "measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4, "alter": 1}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
            ]}]}]
        }]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Concert C natural → written D natural (in D major key = diatonic, no accidental)
    // Concert C# → written D# (D# not in D major = needs sharp accidental)
    // Key sig has 2 sharps (F# C#) — exclude those from note accidental count.
    // Find first notehead x to distinguish key sig accidentals from note accidentals.
    let first_notehead_x = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_BLACK
                    || *codepoint == smufl::NOTEHEAD_WHOLE
                    || *codepoint == smufl::NOTEHEAD_HALF =>
            {
                Some(*x)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);

    let note_sharp_count = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { x, codepoint, .. }
            if *codepoint == smufl::ACCIDENTAL_SHARP && *x >= first_notehead_x - 50.0)
        })
        .count();

    assert_eq!(
        note_sharp_count, 1,
        "Concert C# (written D#) in C major (written D major) should show 1 note sharp, found {}",
        note_sharp_count
    );
}

#[test]
fn test_tied_accidental_not_repeated_across_barline() {
    // C major. Measure 1: whole-note F#4 tied into Measure 2's whole-note F#4
    // on the same system. Standard engraving practice: the accidental shows
    // once (measure 1) and is NOT repeated on the tied continuation. Without
    // the tie-aware suppression the measure-2 note would redraw the sharp
    // because the running accidental state resets at every barline.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "ties": [{"target": "n2"}]}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"id": "n2", "pitch": {"step": "F", "octave": 4, "alter": 1}}]}
            ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    assert_eq!(
        count_accidentals(&dl),
        1,
        "Tied F#4 continuation must not repeat the sharp across the barline"
    );

    // The single accidental drawn must be a plain sharp (no courtesy parens),
    // since the tie does not wrap onto a new system.
    let parens = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c,
        RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ACCIDENTAL_PARENS_LEFT
                || *codepoint == smufl::ACCIDENTAL_PARENS_RIGHT)
        })
        .count();
    assert_eq!(
        parens, 0,
        "A within-system tied accidental must be suppressed, not parenthesized"
    );
}

#[test]
fn test_tied_accidental_not_repeated_in_chain_after_barline() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "ties": [{"target": "continuation-1"}]}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"id": "continuation-1", "pitch": {"step": "F", "octave": 4, "alter": 1}, "ties": [{"target": "continuation-2"}]}]},
                {"duration": {"base": "half"}, "notes": [{"id": "continuation-2", "pitch": {"step": "F", "octave": 4, "alter": 1}}]}
            ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    assert_eq!(
        count_accidentals(&dl),
        1,
        "every continuation in a tie chain must suppress its repeated accidental"
    );
}

#[test]
fn test_same_measure_tie_at_system_start_has_no_courtesy_accidental() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "ties": [{"target": "continuation"}]}]},
                {"duration": {"base": "half"}, "notes": [{"id": "continuation", "pitch": {"step": "F", "octave": 4, "alter": 1}}]}
            ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    assert_eq!(
        count_accidentals(&dl),
        1,
        "a same-measure tie does not cross the system break at the measure start"
    );
}

#[test]
fn test_tied_continuation_does_not_establish_new_measure_accidental_state() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "ties": [{"target": "continuation"}]}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"id": "continuation", "pitch": {"step": "F", "octave": 4, "alter": 1}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]}
            ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    assert_eq!(
        count_accidentals(&dl),
        2,
        "the tied continuation is suppressed, but the next independent F# must restate its sharp"
    );
}

#[test]
fn test_post_tie_sharp_then_next_measure_natural_gets_courtesy() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}, {}]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "ties": [{"target": "continuation"}]}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"id": "continuation", "pitch": {"step": "F", "octave": 4, "alter": 1}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    assert_eq!(
        count_accidentals(&dl),
        3,
        "source F#, independent post-tie F#, and next-measure courtesy natural must all render"
    );
}

#[test]
fn test_hidden_tied_continuation_does_not_reserve_accidental_ink_space() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 2, "unit": 4}},
            {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [
                {"id": "source", "duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1},
                            "ties": [{"target": "continuation"}]}]}
             ]}]},
            {"sequences": [{"content": [
                {"id": "lead", "duration": {"base": "eighth"},
                 "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"id": "target", "duration": {"base": "eighth"},
                 "notes": [{"id": "continuation",
                            "pitch": {"step": "F", "octave": 4, "alter": 1}}]},
                {"id": "tail", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let resolved = resolve_measures(&score, 0);
    let config = LayoutConfig::default();
    let hidden = build_log_spacing_for_resolved_measure(&resolved[1], 2.0, 0.5, &config, false);
    let courtesy = build_log_spacing_for_resolved_measure(&resolved[1], 2.0, 0.5, &config, true);
    let onset_gap =
        |spacing: &crate::layout::spacing::LogSpacing| spacing.mapping[1].1 - spacing.mapping[0].1;
    assert!(
        onset_gap(&hidden) < onset_gap(&courtesy),
        "a suppressed tied continuation must not keep the courtesy accidental's ink reservation"
    );
}

#[test]
fn test_accidental_clears_prev_event_displaced_second_notehead() {
    // A chord containing a SECOND displaces one notehead a full notehead width
    // to one side of the stem. The NEXT event's accidental must clear that
    // displaced notehead — the spacing builder reserves an extra notehead width
    // after a second-cluster for exactly this. Regression for the Rhapsody
    // piano m32 collision (fast chromatic run: an A#/G# second-chord followed by
    // a natural whose accidental overlapped the displaced notehead).
    //
    // Two eighths in 2/4: a high second-cluster (C6 + D6, stem-down → C6 lower
    // notehead pushed LEFT) then a note (B5) carrying a natural accidental.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "eighth"}, "notes": [
                {"pitch": {"step": "C", "octave": 6, "alter": 1}, "accidentalDisplay": {"show": true}},
                {"pitch": {"step": "D", "octave": 6, "alter": 1}, "accidentalDisplay": {"show": true}}
            ]},
            {"duration": {"base": "eighth"}, "notes": [
                {"pitch": {"step": "B", "octave": 5}, "accidentalDisplay": {"show": true}}
            ]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect notehead rects and accidental rects.
    let sp = config.sp;
    let mut noteheads: Vec<(f64, f64, f64, f64)> = Vec::new(); // xl,xr,yt,yb
    let mut accidentals: Vec<(f64, f64, f64, f64)> = Vec::new();
    for c in &dl.commands {
        if let RenderCommand::DrawGlyph {
            x, y, codepoint, ..
        } = c
        {
            if (0xE0A0..=0xE0A4).contains(codepoint) {
                let w = smufl::notehead_width(*codepoint) * sp;
                noteheads.push((*x, *x + w, *y - 0.5 * sp, *y + 0.5 * sp));
            } else if (0xE260..=0xE264).contains(codepoint) {
                // accidental glyph; approximate width by sharp/flat/natural
                let w = 1.0 * sp;
                accidentals.push((*x, *x + w, *y - 1.4 * sp, *y + 1.4 * sp));
            }
        }
    }

    // No accidental may horizontally + vertically overlap any notehead.
    let eps = 0.05 * sp;
    for &(al, ar, at, ab) in &accidentals {
        for &(nl, nr, nt, nb) in &noteheads {
            let xov = al < nr - eps && nl < ar - eps;
            let yov = at < nb - eps && nt < ab - eps;
            assert!(
                !(xov && yov),
                "accidental [{al:.1}..{ar:.1}] must not overlap notehead [{nl:.1}..{nr:.1}] \
                 (displaced second-notehead clearance)"
            );
        }
    }
}

#[test]
fn test_accidental_clears_other_voice_notehead_same_staff() {
    // Two voices on ONE staff. Voice 2 (lower) plays an eighth on beat 1.5 whose
    // notehead sits in the horizontal slot just left of voice 1's beat-2 note.
    // Voice 1's beat-2 note carries an accidental; its column is placed from
    // voice 1's geometry alone, so without cross-event awareness the accidental
    // lands on voice 2's notehead. This guards the cross-event notehead
    // clearance in `render_accidentals_stacked`: the accidental column shifts
    // left to clear ANY other event's notehead on the same staff, not just its
    // own. Pitches are chosen so the two collide vertically (both near the
    // middle of the staff) and horizontally (adjacent beats).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [
            {"staff": 1, "voice": "1", "content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4, "alter": -1}, "accidentalDisplay": {"show": true}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]},
            {"staff": 1, "voice": "2", "content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}
            ]}
        ]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Pair each glyph with its element id so overlaps can be attributed to
    // events (an accidental and the notehead it qualifies share an event id;
    // a cross-event collision is the bug).
    let event_of = |id: &str| -> String {
        let p: Vec<&str> = id.split('/').collect();
        if p.len() >= 4 {
            p[..4].join("/")
        } else {
            id.to_string()
        }
    };
    let mut accs: Vec<(f64, f64, f64, f64, String)> = Vec::new();
    let mut nhs: Vec<(f64, f64, f64, f64, String)> = Vec::new();
    for (i, c) in dl.commands.iter().enumerate() {
        let id = dl
            .element_ids
            .get(i)
            .and_then(|o| o.clone())
            .unwrap_or_default();
        if let RenderCommand::DrawGlyph {
            x, y, codepoint, ..
        } = c
        {
            if (0xE260..=0xE264).contains(codepoint) {
                let w = smufl::accidental_width(-1) * sp; // flat width
                                                          // narrow vertical core to avoid bbox false positives
                accs.push((*x, *x + w, *y - 0.8 * sp, *y + 0.8 * sp, id));
            } else if (0xE0A0..=0xE0A4).contains(codepoint) {
                let w = smufl::notehead_width(*codepoint) * sp;
                nhs.push((*x, *x + w, *y - 0.5 * sp, *y + 0.5 * sp, id));
            }
        }
    }
    assert!(!accs.is_empty(), "expected at least one accidental");

    let eps = 0.05 * sp;
    for (al, ar, at, ab, aid) in &accs {
        let (al, ar, at, ab) = (*al, *ar, *at, *ab);
        for (nl, nr, nt, nb, nid) in &nhs {
            let (nl, nr, nt, nb) = (*nl, *nr, *nt, *nb);
            let xov = al < nr - eps && nl < ar - eps;
            let yov = at < nb - eps && nt < ab - eps;
            if xov && yov {
                assert_eq!(
                    event_of(aid),
                    event_of(nid),
                    "accidental of {aid} overlaps a DIFFERENT event's notehead {nid} \
                     (cross-event notehead clearance failed)"
                );
            }
        }
    }
}

#[test]
fn test_accidental_clears_other_voice_accidental_same_staff() {
    // Two voices on ONE staff, each with an accidental at the SAME onset (beat
    // 1). Each chord lays out its accidental column against its OWN noteheads,
    // so without cross-event awareness the two columns land in the same x and
    // collide vertically. This guards the cross-event accidental clearance in
    // `render_accidentals_stacked` (fed by the system-scoped `acc_obstacles`
    // accumulator): the later-rendered chord's column fans left to clear the
    // earlier one's already-placed accidentals. Pitches are stacked so the two
    // accidentals share a vertical span and must occupy different columns.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [
            {"staff": 1, "voice": "1", "content": [
                {"duration": {"base": "half"}, "notes": [
                    {"pitch": {"step": "E", "octave": 5, "alter": -1}, "accidentalDisplay": {"show": true}},
                    {"pitch": {"step": "G", "octave": 5, "alter": -1}, "accidentalDisplay": {"show": true}}
                ]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]},
            {"staff": 1, "voice": "2", "content": [
                {"duration": {"base": "half"}, "notes": [
                    {"pitch": {"step": "F", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}},
                    {"pitch": {"step": "A", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}}
                ]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}
        ]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let event_of = |id: &str| -> String {
        let p: Vec<&str> = id.split('/').collect();
        if p.len() >= 4 {
            p[..4].join("/")
        } else {
            id.to_string()
        }
    };
    // (x_left, x_right, top, bottom, id) using the renderer's half-space
    // vertical-extent convention (`above * 0.5 * sp`).
    let mut accs: Vec<(f64, f64, f64, f64, String)> = Vec::new();
    for (i, c) in dl.commands.iter().enumerate() {
        let id = dl
            .element_ids
            .get(i)
            .and_then(|o| o.clone())
            .unwrap_or_default();
        if let RenderCommand::DrawGlyph {
            x, y, codepoint, ..
        } = c
        {
            if (0xE260..=0xE26F).contains(codepoint) {
                let alter = match codepoint {
                    0xE260 => -1,
                    0xE262 => 1,
                    0xE263 => -2,
                    0xE264 => 2,
                    _ => 0,
                };
                let w = smufl::accidental_width(alter) * sp;
                let (above, below) = smufl::accidental_vertical_extent(alter);
                accs.push((*x, *x + w, *y - above * 0.5 * sp, *y + below * 0.5 * sp, id));
            }
        }
    }

    assert!(accs.len() >= 4, "expected at least 4 accidentals");

    let eps = 0.05 * sp;
    for i in 0..accs.len() {
        let (al, ar, at, ab, aid) = &accs[i];
        for (bl, br, bt, bb, bid) in accs.iter().skip(i + 1) {
            let xov = *al < *br - eps && *bl < *ar - eps;
            let yov = *at < *bb - eps && *bt < *ab - eps;
            if xov && yov {
                assert_eq!(
                    event_of(aid),
                    event_of(bid),
                    "accidental of {aid} overlaps a DIFFERENT event's accidental {bid} \
                     (cross-event accidental clearance failed)"
                );
            }
        }
    }
}

#[test]
fn test_natural_after_flag_reserves_shared_onset_space() {
    // Beethoven 5, movement 1: an isolated G eighth is followed by a beamed
    // E-natural onset. The up-flag reaches farther right than its notehead and
    // used to cut into the natural. A second staff verifies that the clearance
    // is reserved in the shared rhythmic grid rather than nudging one staff.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [
            {"id": "oboe", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"id": "isolated", "duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                    {"id": "natural", "duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "E", "octave": 5},
                                "accidentalDisplay": {"show": true}}]},
                    {"id": "beam-two", "duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                    {"id": "beam-three", "duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]}],
                "beams": [{"events": ["natural", "beam-two", "beam-three"]}]
            }]},
            {"id": "aligned", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"id": "aligned-one", "duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"id": "aligned-target", "duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"id": "aligned-three", "duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                    {"id": "aligned-four", "duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                ]}]
            }]}
        ]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_full_score(&parse_mnx(json).unwrap(), &config);

    let find_glyph = |id_fragment: &str, codepoint: u32| {
        dl.commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| {
                let id = dl
                    .element_ids
                    .get(index)
                    .and_then(|element_id| element_id.as_deref())?;
                matches!(
                    command,
                    RenderCommand::DrawGlyph {
                        codepoint: actual,
                        ..
                    } if *actual == codepoint && id.contains(id_fragment)
                )
                .then_some(command)
            })
            .unwrap_or_else(|| panic!("missing glyph {codepoint:#X} for {id_fragment}"))
    };
    let natural = find_glyph("/natural/acc0", smufl::ACCIDENTAL_NATURAL)
        .bbox()
        .expect("natural bbox");
    let flag = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let id = dl
                .element_ids
                .get(index)
                .and_then(|element_id| element_id.as_deref())?;
            matches!(
                command,
                RenderCommand::DrawGlyph { codepoint, .. }
                    if (smufl::FLAG_8TH_UP..=smufl::FLAG_1024TH_DOWN).contains(codepoint)
                        && id.contains("/isolated")
            )
            .then(|| command.bbox())
            .flatten()
        })
        .expect("isolated eighth flag bbox");
    assert!(
        natural.x >= flag.x + flag.width + 0.49 * config.sp,
        "natural left={:.3} must clear flag right={:.3} by the reserved approach gap",
        natural.x,
        flag.x + flag.width
    );

    let natural_onset_x = match find_glyph("/natural/", smufl::NOTEHEAD_BLACK) {
        RenderCommand::DrawGlyph { x, .. } => *x,
        _ => unreachable!(),
    };
    let isolated_onset_x = match find_glyph("/isolated/", smufl::NOTEHEAD_BLACK) {
        RenderCommand::DrawGlyph { x, .. } => *x,
        _ => unreachable!(),
    };
    let aligned_onset_x = match find_glyph("/aligned-target/", smufl::NOTEHEAD_BLACK) {
        RenderCommand::DrawGlyph { x, .. } => *x,
        _ => unreachable!(),
    };
    let aligned_previous_x = match find_glyph("/aligned-one/", smufl::NOTEHEAD_BLACK) {
        RenderCommand::DrawGlyph { x, .. } => *x,
        _ => unreachable!(),
    };
    assert!(
        (natural_onset_x - aligned_onset_x).abs() < 0.01,
        "shared beat onset drifted: natural={natural_onset_x:.3}, aligned={aligned_onset_x:.3}"
    );
    let required_gap =
        (flag.x + flag.width - isolated_onset_x) + (natural_onset_x - natural.x) + 0.50 * config.sp;
    let aligned_gap = aligned_onset_x - aligned_previous_x;
    assert!(
        aligned_gap >= required_gap - 0.01,
        "other staff received only {aligned_gap:.3}px; shared ink reservation needs {required_gap:.3}px"
    );
}

#[test]
fn organ_layout_simultaneous_natural_and_sharp_keep_column_gap() {
    let score = parse_mnx(include_str!(
        "../../../../../packages/format/fixtures/mnx/organ-layout.mnx"
    ))
    .unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 1);

    let accidental_bbox = |event_id: &str, codepoint: u32| {
        dl.commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| {
                let id = dl
                    .element_ids
                    .get(index)
                    .and_then(|element_id| element_id.as_deref())?;
                (id.contains(event_id)
                    && matches!(
                        command,
                        RenderCommand::DrawGlyph {
                            codepoint: actual,
                            ..
                        } if *actual == codepoint
                    ))
                .then(|| command.bbox())
                .flatten()
            })
            .unwrap_or_else(|| panic!("missing accidental {codepoint:#X} for {event_id}"))
    };

    let sharp = accidental_bbox(
        "019e62f6-e631-7151-b526-bc35a59480ba",
        smufl::ACCIDENTAL_SHARP,
    );
    let natural = accidental_bbox(
        "019e62f6-e631-7e3b-a839-85c0ad98a973",
        smufl::ACCIDENTAL_NATURAL,
    );
    assert!(
        natural.y < sharp.y + sharp.height && sharp.y < natural.y + natural.height,
        "fixture accidentals must overlap vertically to exercise separate columns"
    );
    let bbox_gap = sharp.x - (natural.x + natural.width);
    let required_bbox_gap = accidental_bbox_gap(
        0,
        (natural.y, natural.y + natural.height),
        1,
        (sharp.y, sharp.y + sharp.height),
        0.2 * config.sp,
        config.sp,
    );
    assert!(
        bbox_gap >= required_bbox_gap - 0.01,
        "interlocking natural/sharp cavities must preserve 0.2sp ink clearance"
    );
    assert!(
        bbox_gap < 0.0,
        "complementary natural/sharp cavities should overlap their bounding boxes"
    );

    let previous_note = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let id = dl
                .element_ids
                .get(index)
                .and_then(|element_id| element_id.as_deref())?;
            (id.contains("019e62f6-e631-7ebc-afd2-353ce036b67d")
                && matches!(
                    command,
                    RenderCommand::DrawGlyph {
                        codepoint: smufl::NOTEHEAD_BLACK,
                        ..
                    }
                ))
            .then(|| command.bbox())
            .flatten()
        })
        .expect("previous upper-voice notehead");
    assert!(
        natural.x >= previous_note.x + previous_note.width + 0.5 * config.sp - 0.01,
        "combined accidental stack must stay after the previous note column"
    );
}

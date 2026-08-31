// Ledger line centering and spacing tests

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

/// Find all horizontal DrawLine commands that look like ledger lines:
/// short horizontal lines (≤ 3sp wide) near but outside the 5 staff lines.
fn find_ledger_lines(dl: &DisplayList, sp: f64) -> Vec<(f64, f64, f64, f64)> {
    // Staff lines span the full width (very long), ledger lines are short
    dl.commands
        .iter()
        .filter_map(|cmd| {
            match cmd {
            RenderCommand::DrawLine { x1, y1, x2, y2, width, color }
                if (y1 - y2).abs() < 0.01
                    && *color == "#000000"
                    && (x2 - x1).abs() < 5.0 * sp  // short line, not a staff line
                    && *width < 0.5 * sp  // thin
                => Some((*x1, *y1, *x2, *y2)),
            _ => None,
        }
        })
        .collect()
}

/// Find all notehead glyphs and return (x, y, codepoint).
fn find_noteheads(dl: &DisplayList) -> Vec<(f64, f64, u32)> {
    dl.commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if (0xE0A0..=0xE0A4).contains(codepoint) => Some((*x, *y, *codepoint)),
            _ => None,
        })
        .collect()
}

#[test]
fn test_ledger_line_centered_on_quarter_note() {
    // C4 in treble clef = 1 ledger line below staff
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let ledgers = find_ledger_lines(&dl, sp);
    assert!(
        !ledgers.is_empty(),
        "C4 should have a ledger line below staff"
    );

    let noteheads = find_noteheads(&dl);
    assert!(!noteheads.is_empty(), "Should have a notehead");

    // The notehead for C4 is a whole note (codepoint 0xE0A2)
    let whole_nh = noteheads
        .iter()
        .find(|(_, _, cp)| *cp == smufl::NOTEHEAD_WHOLE);
    assert!(whole_nh.is_some(), "Should have a whole notehead glyph");

    let (nh_x, _nh_y, _) = whole_nh.unwrap();
    let whole_w = smufl::notehead_width(smufl::NOTEHEAD_WHOLE) * sp;
    let nh_center = nh_x + whole_w / 2.0;

    // Check that the ledger line is centered on the notehead
    let (lx1, _, lx2, _) = ledgers[0];
    let ledger_center = (lx1 + lx2) / 2.0;

    assert!(
        (ledger_center - nh_center).abs() < 0.5,
        "Ledger line center ({:.2}) should be near notehead center ({:.2})",
        ledger_center,
        nh_center
    );
}

#[test]
fn test_ledger_line_wider_for_whole_note() {
    // Whole note has wider notehead (1.66sp vs 1.18sp), ledger line should match
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let ledgers = find_ledger_lines(&dl, sp);
    assert!(
        !ledgers.is_empty(),
        "C4 whole note should have a ledger line"
    );

    let (lx1, _, lx2, _) = ledgers[0];
    let ledger_width = lx2 - lx1;
    let expected_width =
        smufl::notehead_width(smufl::NOTEHEAD_WHOLE) * sp + 2.0 * config.ledger_extension * sp;

    assert!(
        (ledger_width - expected_width).abs() < 0.5,
        "Whole-note ledger line width ({:.2}) should be ~{:.2} (notehead 1.66sp + 2×ext)",
        ledger_width,
        expected_width
    );
}

#[test]
fn test_adjacent_ledger_lines_dont_overlap() {
    // Four adjacent quarter notes on C4 — all need ledger lines
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let mut ledgers = find_ledger_lines(&dl, sp);
    // Sort by x1 (left edge)
    ledgers.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    assert!(
        ledgers.len() >= 4,
        "4 quarter notes on C4 should produce 4 ledger lines, got {}",
        ledgers.len()
    );

    // Check that adjacent ledger lines don't overlap
    for i in 0..ledgers.len() - 1 {
        let (_, _, right_edge, _) = ledgers[i];
        let (left_edge, _, _, _) = ledgers[i + 1];
        assert!(
            left_edge >= right_edge - 0.01,
            "Ledger line {} (right={:.2}) overlaps with ledger line {} (left={:.2})",
            i,
            right_edge,
            i + 1,
            left_edge
        );
    }
}

#[test]
fn test_min_note_spacing_prevents_ledger_overlap() {
    // Eight sixteenth notes on C4 — closely spaced, but min_note_spacing
    // should prevent their ledger lines from intersecting
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let mut config = LayoutConfig::default();
    let sp = config.sp;
    // Use a wide page so all 16 notes fit on one system
    config.page_width = Some(120.0 * sp);
    let dl = layout_score(&score, 0, &config);

    let mut ledgers = find_ledger_lines(&dl, sp);
    ledgers.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    assert!(
        ledgers.len() >= 16,
        "16 sixteenth notes on C4 should produce ≥16 ledger lines, got {}",
        ledgers.len()
    );

    // Verify no overlap between adjacent ledger lines
    for i in 0..ledgers.len() - 1 {
        let (_, _, right_edge, _) = ledgers[i];
        let (left_edge, _, _, _) = ledgers[i + 1];
        assert!(
            left_edge >= right_edge - 0.01,
            "16th note ledger line {} (right={:.2}) overlaps with {} (left={:.2})",
            i,
            right_edge,
            i + 1,
            left_edge
        );
    }
}

#[test]
fn test_smufl_notehead_width_values() {
    // Verify notehead_width returns correct values from SMuFL bbox data
    assert!(
        (smufl::notehead_width(smufl::NOTEHEAD_BLACK) - 1.18).abs() < 0.01,
        "Black notehead width should be 1.18sp"
    );
    assert!(
        (smufl::notehead_width(smufl::NOTEHEAD_HALF) - 1.18).abs() < 0.01,
        "Half notehead width should be 1.18sp"
    );
    assert!(
        (smufl::notehead_width(smufl::NOTEHEAD_WHOLE) - 1.66).abs() < 0.01,
        "Whole notehead width should be 1.66sp"
    );
    assert!(
        (smufl::notehead_width(smufl::NOTEHEAD_DOUBLE_WHOLE) - 2.02).abs() < 0.01,
        "Double-whole notehead width should be 2.02sp"
    );
}

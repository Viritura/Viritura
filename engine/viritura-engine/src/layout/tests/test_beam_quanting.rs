// Auto-generated from tests.rs — test_beam_quanting
// standard beam positioning tests

use super::test_helpers::*;
use crate::layout::beams::*;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::parse::parse_mnx;

// ═══════════════════════════════════════════
// Beam positioning tests (standard)
// ═══════════════════════════════════════════

#[test]
fn test_max_slope_table() {
    // Verify max slope increases with beam width
    assert_eq!(get_max_slope(2.0), 1); // narrow beam
    assert_eq!(get_max_slope(4.0), 2);
    assert_eq!(get_max_slope(6.0), 3);
    assert_eq!(get_max_slope(9.0), 4);
    assert_eq!(get_max_slope(12.0), 5);
    assert_eq!(get_max_slope(18.0), 6);
    assert_eq!(get_max_slope(25.0), 7); // very wide beam
}

#[test]
fn test_valid_beam_position_floater_rejected() {
    // Floater positions (between staff lines, inside staff) should be invalid
    // In quarter-spaces, positions 2, 6, 10 etc. are floaters
    // Adding 8 to handle modulo: (2+8)%4 = 2 → floater
    assert!(
        !is_valid_beam_position(true, 2, true, true, false, 5, true),
        "Floater at qs=2 should be invalid"
    );
    assert!(
        !is_valid_beam_position(true, 6, true, true, false, 5, true),
        "Floater at qs=6 should be invalid"
    );
}

#[test]
fn test_valid_beam_position_on_line_accepted() {
    // On-line positions (qs % 4 == 0) should be valid
    assert!(
        is_valid_beam_position(true, 0, true, true, false, 5, true),
        "On-line at qs=0 should be valid"
    );
    assert!(
        is_valid_beam_position(true, 4, true, true, false, 5, true),
        "On-line at qs=4 should be valid"
    );
    assert!(
        is_valid_beam_position(true, 8, true, true, false, 5, true),
        "On-line at qs=8 should be valid"
    );
}

#[test]
fn test_valid_beam_position_flat_accepts_non_floater() {
    // For flat beams, any non-floater position inside staff is valid
    assert!(
        is_valid_beam_position(true, 1, true, true, true, 5, true),
        "Flat beam on non-floater should be valid"
    );
    assert!(
        is_valid_beam_position(true, 3, true, true, true, 5, true),
        "Flat beam on non-floater should be valid"
    );
}

#[test]
fn test_slope_constraint_same_endpoints_flat() {
    // Same start/end line should always be flat
    let lines = vec![4, 2, 4];
    assert_eq!(
        get_slope_constraint(&lines, true, 4, 4),
        SlopeConstraint::Flat
    );
}

#[test]
fn test_slope_constraint_inner_note_beyond_endpoints_flat() {
    // Inner note higher than both endpoints (stem up) → flat
    let lines = vec![4, 0, 6]; // inner note (0) is higher than both endpoints
    assert_eq!(
        get_slope_constraint(&lines, true, 4, 6),
        SlopeConstraint::Flat
    );
}

#[test]
fn test_slope_constraint_normal_ascending_unconstrained() {
    // Normal ascending pattern with no inner notes beyond endpoints
    let lines = vec![6, 4, 2]; // ascending, no inner beyond
    assert_eq!(
        get_slope_constraint(&lines, true, 6, 2),
        SlopeConstraint::NoConstraint
    );
}

#[test]
fn test_quant_beam_concave_becomes_horizontal() {
    // Concave pattern: outer notes high, inner note low → should flatten
    // standard: inner note on same line as endpoint → FLAT slope constraint
    let sp = 12.0;
    let config = LayoutConfig::default();
    let staff_y = config.margin_top * sp;

    // C5, A4, C5 pattern (concave when stems up)
    // C5 = staff position -2, A4 = 1, C5 = -2
    let note_info = vec![
        (100.0, staff_y + (-2.0) * sp * 0.5), // C5 high
        (140.0, staff_y + 1.0 * sp * 0.5),    // A4 lower
        (180.0, staff_y + (-2.0) * sp * 0.5), // C5 high
    ];

    let (_, slope, _) = compute_quantized_beam(&note_info, true, sp, &config, staff_y, 1);
    // Same endpoints → flat beam
    assert!(
        slope.abs() < 0.01,
        "Concave beam should be horizontal, got slope={:.4}",
        slope
    );
}

#[test]
fn test_quant_beam_ascending_preserves_direction() {
    // Test that ascending pattern produces a slanted beam
    let sp = 12.0;
    let config = LayoutConfig::default();
    let staff_y = 60.0;

    // Two notes with different pitches, separated enough for non-zero slope
    let note_info = vec![
        (100.0, staff_y + 5.0 * sp * 0.5), // low note (pos 5)
        (200.0, staff_y + -sp * 0.5),      // high note (pos -1)
    ];

    let (_, slope, _) = compute_quantized_beam(&note_info, true, sp, &config, staff_y, 1);
    // Ascending pattern should have negative Y slope (going up = lower Y)
    assert!(
        slope < -0.001,
        "Ascending beam should have negative Y slope, got slope={:.4}",
        slope
    );
}

#[test]
fn test_quant_beam_minimum_stem_length() {
    // Verify all stems meet minimum length requirements
    let sp = 12.0;
    let config = LayoutConfig::default();
    let staff_y = config.margin_top * sp;

    let note_info = vec![
        (100.0, staff_y + 2.0 * sp),
        (140.0, staff_y + 0.0),
        (180.0, staff_y + 4.0 * sp),
    ];

    let (beam_y_first, slope, _) =
        compute_quantized_beam(&note_info, true, sp, &config, staff_y, 1);

    let first_x = note_info[0].0;
    // min_stem_length_qs for 1 beam = 11 quarter-spaces = 2.75 sp
    let min_stem = 2.75 * sp;
    let tolerance = 1.0 * sp; // generous tolerance for position adjustments
    for (i, &(sx, ny)) in note_info.iter().enumerate() {
        let beam_y = beam_y_first + slope * (sx - first_x);
        let stem_len = ny - beam_y;
        assert!(
            stem_len >= min_stem - tolerance,
            "Stem {} too short: {:.1}px (min ~{:.1}px)",
            i,
            stem_len,
            min_stem
        );
    }
}

#[test]
fn test_beam_quanting_integration_renders_correctly() {
    // Full integration test: beamed eighth notes render with beam positioning
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [{"events": ["e1", "e2", "e3", "e4"]}],
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "e3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should produce beam polygons
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert!(
        poly_count >= 1,
        "Expected beam polygons, got {}",
        poly_count
    );

    // Should not produce flag glyphs for beamed notes
    let flag_count = dl.commands.iter().filter(|c| is_flag_glyph(c)).count();
    assert_eq!(
        flag_count, 0,
        "Beamed notes should have no flags, got {}",
        flag_count
    );
}

#[test]
fn test_min_stem_length_qs_values() {
    // Verify minimum stem length lookup matches expected values.
    // Single/double beams raised to 14qs (3.5sp) per standard engraving minimum.
    assert_eq!(min_stem_length_qs(1), 14); // 1 beam (was 11, raised to match config.stem_length)
    assert_eq!(min_stem_length_qs(2), 14); // 2 beams (was 13, raised)
    assert_eq!(min_stem_length_qs(3), 15); // 3 beams
    assert_eq!(min_stem_length_qs(4), 18); // 4 beams
}

#[test]
fn test_beam_inside_staff() {
    // Test staff boundary checking
    assert!(
        is_beam_inside_staff(0, 5, false),
        "Top staff line should be inside"
    );
    assert!(
        is_beam_inside_staff(8, 5, false),
        "Second line should be inside"
    );
    assert!(
        is_beam_inside_staff(16, 5, false),
        "Bottom staff line should be inside"
    );
    assert!(
        !is_beam_inside_staff(-4, 5, false),
        "Far above should be outside"
    );
    assert!(
        !is_beam_inside_staff(20, 5, false),
        "Far below should be outside"
    );
    // With floater allowed, slightly outside is still "inside"
    assert!(
        is_beam_inside_staff(-1, 5, true),
        "Just above with floater should be inside"
    );
}

#[test]
fn test_target_staff_line_stem_up() {
    // For stem-up beams with 1 beam, target should be near middle of staff
    // (staff_lines-1)*4 - beam_overlap + 1 = 16 - 8 + 1 = 9
    let target = get_target_staff_line(true, 5, 1);
    assert_eq!(target, 9, "Stem-up target for 1 beam should be 9 qs");
}

#[test]
fn test_target_staff_line_stem_down() {
    // For stem-down beams with 1 beam, target should be near middle of staff
    // beam_overlap - 1 = 8 - 1 = 7
    let target = get_target_staff_line(false, 5, 1);
    assert_eq!(target, 7, "Stem-down target for 1 beam should be 7 qs");
}

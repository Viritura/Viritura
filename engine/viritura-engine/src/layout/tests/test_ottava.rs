// Auto-generated from tests.rs — test_ottava
// 4 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::{layout_score, layout_with_mnx_scores};
use crate::render::*;
use std::collections::HashSet;

#[test]
fn test_ottava_chunked_horizon_bounds_are_not_clipped() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig {
        sp: 8.0,
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let min_bbox_y = dl
        .element_bboxes
        .iter()
        .map(|element| element.bbox.y)
        .fold(f64::INFINITY, f64::min);
    let max_bbox_y = dl
        .element_bboxes
        .iter()
        .map(|element| element.bbox.y + element.bbox.height)
        .fold(f64::NEG_INFINITY, f64::max);

    assert!(
        min_bbox_y >= 0.0 && max_bbox_y <= dl.height,
        "ottava Horizon element bounds {min_bbox_y}..{max_bbox_y} exceed display height {}",
        dl.height
    );
}

#[test]
fn test_ottava_8va_render() {
    use crate::render::smufl::smufl;

    // Load ottavas-8va.mnx: 8va marking spanning from m1 beat 1/2 to m2 beat 1/2
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Should have a DrawGlyph with the 8va SMuFL codepoint above the staff
    let glyph_cmds: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::OTTAVA_ALTA)
    }).collect();
    assert_eq!(
        glyph_cmds.len(),
        1,
        "Expected exactly 1 ottava alta glyph, got {}",
        glyph_cmds.len()
    );

    // The glyph should be above the top staff line
    if let RenderCommand::DrawGlyph { y, .. } = glyph_cmds[0] {
        assert!(
            *y < staff_y,
            "8va glyph at y={} should be above staff at y={}",
            y,
            staff_y
        );
    }

    // Should have dashed lines (multiple short horizontal segments above staff)
    let dash_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, x1, x2, .. } = cmd {
                // Horizontal lines above staff (not staff lines, not barlines)
                let is_horizontal = (*y1 - *y2).abs() < 0.01;
                let above_staff = *y1 < staff_y;
                let short_segment = (*x2 - *x1).abs() < 2.0 * sp;
                is_horizontal && above_staff && short_segment
            } else {
                false
            }
        })
        .collect();
    assert!(
        dash_lines.len() >= 2,
        "Expected at least 2 dash segments, got {}",
        dash_lines.len()
    );

    // Should have a vertical hook line at the end
    let hook_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = cmd {
                let is_vertical = (*x1 - *x2).abs() < 0.01;
                let above_staff = *y1 < staff_y || *y2 < staff_y;
                let short = (*y2 - *y1).abs() < 1.5 * sp;
                is_vertical && above_staff && short
            } else {
                false
            }
        })
        .collect();
    assert!(
        !hook_lines.is_empty(),
        "Expected at least 1 vertical hook line, got {}",
        hook_lines.len()
    );
}

#[test]
fn test_ottava_explicit_orient_below() {
    use crate::model::Orientation;
    use crate::render::smufl::smufl;

    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let mut score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");
    score.parts[0].measures[0].ottavas.as_mut().unwrap()[0].orient = Some(Orientation::Below);

    let config = LayoutConfig::default();
    let staff_bottom = (config.margin_top + 4.0) * config.sp;
    let dl = layout_score(&score, 0, &config);
    let glyph_y = dl.commands.iter().find_map(|command| match command {
        RenderCommand::DrawGlyph {
            y,
            codepoint: smufl::OTTAVA_ALTA,
            ..
        } => Some(*y),
        _ => None,
    });

    assert!(
        glyph_y.is_some_and(|y| y > staff_bottom),
        "explicit below ottava should render below the staff"
    );
}

#[test]
fn test_ottava_8va_display_transposition() {
    // Verify that notes under an 8va marking are displayed one octave lower
    // than their sounding pitch. The MNX file has C7 (sounding) under 8va,
    // which should display as C6 on the staff.
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Treble clef: G4 is reference, line_from_bottom=1
    // C6 diatonic=42, clef_ref=32, pos_from_clef_line=10, pos_from_top=(4-1)*2-10=6-10=-4
    // C7 diatonic=49, clef_ref=32, pos_from_clef_line=17, pos_from_top=6-17=-11
    // Under 8va, C7 should display as C6 (pos_from_top=-4)
    let c6_y = staff_y + (-4.0) * sp * 0.5; // C6 position
    let c7_y = staff_y + (-11.0) * sp * 0.5; // C7 position (without transposition)

    // Collect all noteheads (DrawGlyph with notehead codepoints)
    let noteheads: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } = cmd
            {
                // Notehead codepoints: U+E0A2 (filled), U+E0A3 (half), U+E0A4 (whole)
                if *codepoint == 0xE0A2 || *codepoint == 0xE0A3 || *codepoint == 0xE0A4 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    // Notes under 8va should NOT be at C7 position (very high up)
    for (_, y) in &noteheads {
        assert!(
            *y > c7_y + sp,
            "Note at y={:.1} is too high — near C7 position ({:.1}). \
             Ottava display transposition may not be applied.",
            y,
            c7_y
        );
    }

    // The third note (C7 sounding → C6 display) should be near C6 position
    // C6 is 2 ledger lines above staff: y = staff_y + (-4.0) * 0.5 * sp
    assert!(noteheads.len() >= 3, "Expected at least 3 noteheads");
    let third_note_y = noteheads[2].1;
    assert!(
        (third_note_y - c6_y).abs() < 1.0 * sp,
        "Third note (C7 under 8va) at y={:.1} should be near C6 display position ({:.1})",
        third_note_y,
        c6_y
    );
}

#[test]
fn test_ottava_collision_avoidance() {
    use crate::render::smufl::smufl;

    // Load ottavas-8va.mnx: notes under 8va may have high positions
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Find the ottava glyph
    let ottava_glyph: Vec<_> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if *codepoint == smufl::OTTAVA_ALTA {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    assert_eq!(
        ottava_glyph.len(),
        1,
        "Expected exactly 1 ottava alta glyph"
    );

    let ottava_y = ottava_glyph[0];

    // Find the highest notehead (smallest Y value)
    let min_note_y = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if *codepoint == 0xE0A2 || *codepoint == 0xE0A3 || *codepoint == 0xE0A4 {
                    return Some(*y);
                }
            }
            None
        })
        .fold(f64::INFINITY, f64::min);

    // The ottava line should be above the highest note
    assert!(
        ottava_y < min_note_y,
        "Ottava Y ({:.1}) should be above highest note Y ({:.1})",
        ottava_y,
        min_note_y
    );

    // The ottava line should be above the staff
    assert!(
        ottava_y < staff_y,
        "Ottava Y ({:.1}) should be above staff Y ({:.1})",
        ottava_y,
        staff_y
    );
}

#[test]
fn test_ottava_smufl_glyph_values() {
    use crate::render::smufl::smufl;

    // Verify the ottava glyph lookup returns correct codepoints and widths
    let (cp, w) = smufl::ottava_glyph(1);
    assert_eq!(cp, 0xE511, "8va should use ottavaAlta codepoint");
    assert!((w - 3.54).abs() < 0.01, "8va width should be ~3.54sp");

    let (cp, w) = smufl::ottava_glyph(2);
    assert_eq!(cp, 0xE515, "15ma should use quindicesimaAlta codepoint");
    assert!((w - 5.26).abs() < 0.01, "15ma width should be ~5.26sp");

    let (cp, w) = smufl::ottava_glyph(-1);
    assert_eq!(cp, 0xE51C, "8vb should use ottavaBassaVb codepoint");
    assert!((w - 3.184).abs() < 0.01, "8vb width should be ~3.184sp");

    let (cp, w) = smufl::ottava_glyph(-2);
    assert_eq!(cp, 0xE51D, "15mb should use quindicesimaBassaMb codepoint");
    assert!((w - 4.924).abs() < 0.01, "15mb width should be ~4.924sp");

    let (cp, w) = smufl::ottava_glyph(3);
    assert_eq!(cp, 0xE518, "22ma should use ventiduesimaAlta codepoint");
    assert!((w - 5.712).abs() < 0.01, "22ma width should be ~5.712sp");

    let (cp, w) = smufl::ottava_glyph(-3);
    assert_eq!(cp, 0xE51E, "22mb should use ventiduesimaBassaMb codepoint");
    assert!((w - 5.34).abs() < 0.01, "22mb width should be ~5.34sp");
}

#[test]
fn test_ottava_element_ids_tagged() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Ottava should be tagged with element IDs like "p0/m0/ottava0"
    let ottava_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/ottava"))
        .collect();
    assert!(
        !ottava_ids.is_empty(),
        "Ottava render commands should have element IDs"
    );

    // Verify format: p{N}/m{N}/ottava{N}
    for id in &ottava_ids {
        assert!(
            id.starts_with("p"),
            "Ottava ID should start with 'p': {}",
            id
        );
        assert!(id.contains("/m"), "Ottava ID should contain '/m': {}", id);
        assert!(
            id.contains("/ottava"),
            "Ottava ID should contain '/ottava': {}",
            id
        );
    }

    // All commands for one ottava should share the same ID
    // (glyph + dashes + hook)
    let unique: HashSet<_> = ottava_ids.iter().collect();
    assert_eq!(
        unique.len(),
        1,
        "All commands for a single ottava should share the same element ID, got {:?}",
        unique
    );

    // Should have at least 3 tagged commands (glyph + at least 1 dash + hook)
    assert!(
        ottava_ids.len() >= 3,
        "Expected at least 3 tagged ottava commands, got {}",
        ottava_ids.len()
    );
}

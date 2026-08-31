// Shared test helper functions

use crate::render::smufl::smufl;
use crate::render::*;

/// Parse the smallest useful score shell for a spacing invariant.
///
/// New spacing regressions should keep the musical trigger in `parts_json`
/// minimal and assert a rule, rather than snapshotting a large display list.
pub(super) fn minimal_spacing_score(parts_json: &str) -> crate::model::Score {
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
            "parts": {parts_json}
        }}"#
    );
    crate::parse::parse_mnx(&json).expect("minimal spacing fixture must parse")
}

pub(super) fn is_flag_glyph(cmd: &RenderCommand) -> bool {
    match cmd {
        RenderCommand::DrawGlyph { codepoint, .. } => {
            // SMuFL flag codepoints: 0xE240 – 0xE247
            (0xE240..=0xE247).contains(codepoint)
        }
        _ => false,
    }
}

pub(super) fn is_beam_polygon(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawPolygon { .. })
}

pub(super) fn is_stem_line(cmd: &RenderCommand) -> bool {
    match cmd {
        RenderCommand::DrawLine { x1, x2, width, .. } => (x1 - x2).abs() < 0.001 && *width < 2.0,
        _ => false,
    }
}

pub(super) fn is_draw_bezier(cmd: &RenderCommand) -> bool {
    matches!(
        cmd,
        RenderCommand::DrawBezier { .. } | RenderCommand::DrawFilledBezier { .. }
    )
}

pub(super) fn is_tuplet_number_glyph(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if (0xE880..=0xE889).contains(codepoint))
}

pub(super) fn is_notehead_glyph(cmd: &RenderCommand) -> bool {
    match cmd {
        RenderCommand::DrawGlyph { codepoint, .. } => (0xE0A0..=0xE0A4).contains(codepoint),
        RenderCommand::DrawEllipse { .. } => true,
        _ => false,
    }
}

pub(super) fn is_repeat_barline_glyph(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
        if *codepoint == smufl::REPEAT_LEFT
        || *codepoint == smufl::REPEAT_RIGHT
        || *codepoint == smufl::REPEAT_RIGHT_LEFT)
}

pub(super) fn is_thick_barline_glyph(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
        if *codepoint == smufl::BARLINE_FINAL
        || *codepoint == smufl::BARLINE_HEAVY
        || *codepoint == smufl::BARLINE_REVERSE_FINAL
        || *codepoint == smufl::BARLINE_HEAVY_HEAVY
        || *codepoint == smufl::REPEAT_LEFT
        || *codepoint == smufl::REPEAT_RIGHT
        || *codepoint == smufl::REPEAT_RIGHT_LEFT)
}

pub(super) fn is_repeat_barline_glyph_codepoint(cp: u32) -> bool {
    cp == smufl::REPEAT_LEFT || cp == smufl::REPEAT_RIGHT || cp == smufl::REPEAT_RIGHT_LEFT
}

pub(super) fn is_accidental_glyph(cmd: &RenderCommand) -> bool {
    match cmd {
        RenderCommand::DrawGlyph { codepoint, .. } => (0xE260..=0xE264).contains(codepoint),
        _ => false,
    }
}

pub(super) fn is_accidental_enclosure_glyph(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
        if *codepoint == smufl::ACCIDENTAL_PARENS_LEFT || *codepoint == smufl::ACCIDENTAL_PARENS_RIGHT
        || *codepoint == smufl::ACCIDENTAL_BRACKET_LEFT || *codepoint == smufl::ACCIDENTAL_BRACKET_RIGHT)
}

// ---- Slur/tie geometry helpers (added 2026-05-17) -----------------
// Used by test_slurs.rs to assert rule-level invariants on filled
// bezier shapes (slurs + ties). All helpers operate on the OUTER
// contour (the side away from the staff) since that's where curve
// direction and clearance are defined.

/// True if the command is a DrawFilledBezier (slur/tie).
#[allow(dead_code)] // currently-unused helper kept alongside related slur/tie helpers.
pub(super) fn is_filled_bezier(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawFilledBezier { .. })
}

/// Outer-contour endpoint Ys (y1, y2) of a filled bezier.
pub(super) fn bezier_endpoints_y(cmd: &RenderCommand) -> (f64, f64) {
    match cmd {
        RenderCommand::DrawFilledBezier { y1, y2, .. } => (*y1, *y2),
        _ => panic!("not a filled bezier"),
    }
}

/// Outer-contour endpoint Xs (x1, x2) of a filled bezier.
pub(super) fn bezier_endpoints_x(cmd: &RenderCommand) -> (f64, f64) {
    match cmd {
        RenderCommand::DrawFilledBezier { x1, x2, .. } => (*x1, *x2),
        _ => panic!("not a filled bezier"),
    }
}

/// Apex Y of the OUTER cubic at t=0.5 (the visible peak/valley of the slur).
pub(super) fn bezier_apex_y(cmd: &RenderCommand) -> f64 {
    match cmd {
        RenderCommand::DrawFilledBezier {
            y1, ocy1, ocy2, y2, ..
        } => 0.125 * y1 + 0.375 * ocy1 + 0.375 * ocy2 + 0.125 * y2,
        _ => panic!("not a filled bezier"),
    }
}

pub(super) fn bezier_outer_y_at_x(cmd: &RenderCommand, target_x: f64) -> f64 {
    let RenderCommand::DrawFilledBezier {
        x1,
        y1,
        ocx1,
        ocy1,
        ocx2,
        ocy2,
        x2,
        y2,
        ..
    } = cmd
    else {
        panic!("not a filled bezier");
    };
    let mut nearest = (*x1, *y1);
    for sample in 1..=512 {
        let t = sample as f64 / 512.0;
        let mt = 1.0 - t;
        let x = mt.powi(3) * x1
            + 3.0 * mt.powi(2) * t * ocx1
            + 3.0 * mt * t.powi(2) * ocx2
            + t.powi(3) * x2;
        let y = mt.powi(3) * y1
            + 3.0 * mt.powi(2) * t * ocy1
            + 3.0 * mt * t.powi(2) * ocy2
            + t.powi(3) * y2;
        if (x - target_x).abs() < (nearest.0 - target_x).abs() {
            nearest = (x, y);
        }
    }
    nearest.1
}

pub(super) fn bezier_inner_y_at_x(cmd: &RenderCommand, target_x: f64) -> f64 {
    let RenderCommand::DrawFilledBezier {
        ix1,
        iy1,
        icx1,
        icy1,
        icx2,
        icy2,
        ix2,
        iy2,
        ..
    } = cmd
    else {
        panic!("not a filled bezier");
    };
    let mut nearest = (*ix1, *iy1);
    for sample in 1..=512 {
        let t = sample as f64 / 512.0;
        let mt = 1.0 - t;
        let x = mt.powi(3) * ix1
            + 3.0 * mt.powi(2) * t * icx1
            + 3.0 * mt * t.powi(2) * icx2
            + t.powi(3) * ix2;
        let y = mt.powi(3) * iy1
            + 3.0 * mt.powi(2) * t * icy1
            + 3.0 * mt * t.powi(2) * icy2
            + t.powi(3) * iy2;
        if (x - target_x).abs() < (nearest.0 - target_x).abs() {
            nearest = (x, y);
        }
    }
    nearest.1
}

/// True if the outer curve sits ABOVE its endpoints (smaller Y).
pub(super) fn is_curve_above(cmd: &RenderCommand) -> bool {
    match cmd {
        RenderCommand::DrawFilledBezier {
            y1, ocy1, y2, ocy2, ..
        } => ocy1 + ocy2 < y1 + y2,
        _ => panic!("not a filled bezier"),
    }
}

/// True for any of the ARTIC_* SMuFL codepoints (0xE4A0–0xE4C5 covers
/// staccato, tenuto, accent, marcato, staccatissimo, stress, etc).
#[allow(dead_code)]
pub(super) fn is_articulation_glyph(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if (0xE4A0..=0xE4C5).contains(codepoint))
}

/// Glyph (x, y) anchor. SMuFL glyphs anchor at their reference origin
/// (per-glyph; close to centre-baseline for most articulations).
#[allow(dead_code)]
pub(super) fn glyph_xy(cmd: &RenderCommand) -> Option<(f64, f64)> {
    match cmd {
        RenderCommand::DrawGlyph { x, y, .. } => Some((*x, *y)),
        _ => None,
    }
}

/// Y of the topmost (smallest Y) notehead in the display list.
pub(super) fn topmost_notehead_y(dl: &crate::render::DisplayList) -> f64 {
    dl.commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawEllipse { cy, .. } => Some(*cy),
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if (0xE0A0..=0xE0A4).contains(codepoint) =>
            {
                Some(*y)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min)
}

/// Y of the bottommost (largest Y) notehead in the display list.
pub(super) fn bottommost_notehead_y(dl: &crate::render::DisplayList) -> f64 {
    dl.commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawEllipse { cy, .. } => Some(*cy),
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if (0xE0A0..=0xE0A4).contains(codepoint) =>
            {
                Some(*y)
            }
            _ => None,
        })
        .fold(f64::NEG_INFINITY, f64::max)
}

#[allow(dead_code)]
pub(super) fn is_rest_glyph(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
        if (smufl::REST_MAXIMA..=smufl::REST_256TH).contains(codepoint))
}

pub(super) fn is_arpeggio_glyph(cmd: &RenderCommand) -> bool {
    matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
        if *codepoint == smufl::WIGGLE_ARPEGGIATO_UP
        || *codepoint == smufl::WIGGLE_ARPEGGIATO_DOWN
        || *codepoint == smufl::WIGGLE_ARPEGGIATO_UP_ARROW
        || *codepoint == smufl::WIGGLE_ARPEGGIATO_DOWN_ARROW
        || *codepoint == smufl::WIGGLE_ARPEGGIATO_UP_SWASH
        || *codepoint == smufl::WIGGLE_ARPEGGIATO_DOWN_SWASH)
}

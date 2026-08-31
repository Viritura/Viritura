//! Brace geometry for staff groups.
//!
//! SMuFL cuts the brace glyph one em tall — the height of a single five-line
//! staff — to be scaled to the height of the staves it encompasses. Scaling it
//! proportionally is right at the spacing the design assumes, but two things
//! pull against a naive "stretch the one glyph to fit":
//!
//! * A brace over many staves turns too wide and too bold if the single design
//!   is simply blown up. Fonts answer this with stylistic alternates cut for
//!   progressively taller spans — five designs covering one staff up to ten or
//!   more — so which design is used follows the number of staves joined.
//! * Vertical justification pushes staves apart well past the distance any
//!   design anticipates. Stretching the brace to reach is correct; thickening
//!   it is not. The weight of the stroke belongs to the staff size, not to how
//!   far apart the staves happen to land on a given page. So the horizontal
//!   scale freezes at the width the group would have at nominal spacing, and
//!   any extra distance stretches the glyph vertically alone.

use crate::render::smufl::smufl;

/// Staff height in staff spaces — four spaces between five lines.
const STAFF_HEIGHT_SP: f64 = 4.0;

/// The inter-staff gap the page layout aims for before justification stretches
/// it (see `layout::page`). Braces treat it as the spacing their design
/// assumes: at this distance the glyph is drawn proportionally, and beyond it
/// only the height grows.
const NOMINAL_STAFF_GAP_SP: f64 = 7.0;

/// A brace's chosen glyph and the transform that fits it to a staff group.
pub(crate) struct BraceGeometry {
    /// The stylistic alternate carrying this span.
    pub codepoint: u32,
    /// Font size (px per em) that gives the glyph the group's exact height.
    pub size: f64,
    /// Horizontal scale about the glyph origin. 1.0 means proportional;
    /// smaller values hold the width at its nominal-spacing value.
    pub scale_x: f64,
    /// Rendered width in px, with `scale_x` already applied.
    pub width: f64,
}

/// The brace glyph cut for a group of `staff_count` staves, with its design
/// width in staff spaces.
///
/// The five cuts are the same height and differ only in width and depth of
/// curve, from the widest (a single staff) to the flattest (the tallest
/// groups), so picking one is entirely a question of how much height it has to
/// carry.
fn brace_glyph(staff_count: usize) -> (u32, f64) {
    let codepoint = match staff_count {
        0 | 1 => smufl::BRACE_SMALL,
        2 => smufl::BRACE,
        3 => smufl::BRACE_LARGE,
        4 | 5 => smufl::BRACE_LARGER,
        _ => smufl::BRACE_FLAT,
    };
    (codepoint, brace_design_width(codepoint))
}

/// Width of a brace cut at its design size, in staff spaces.
pub(crate) fn brace_design_width(codepoint: u32) -> f64 {
    match codepoint {
        smufl::BRACE_SMALL => smufl::BRACE_SMALL_WIDTH,
        smufl::BRACE_LARGE => smufl::BRACE_LARGE_WIDTH,
        smufl::BRACE_LARGER => smufl::BRACE_LARGER_WIDTH,
        smufl::BRACE_FLAT => smufl::BRACE_FLAT_WIDTH,
        _ => smufl::BRACE_GLYPH_WIDTH,
    }
}

/// True when `codepoint` is any of the brace cuts. Used by the layout tests to
/// find a brace without pinning which cut a given group happens to take.
#[cfg(test)]
pub(crate) fn is_brace_glyph(codepoint: u32) -> bool {
    matches!(
        codepoint,
        smufl::BRACE
            | smufl::BRACE_SMALL
            | smufl::BRACE_LARGE
            | smufl::BRACE_LARGER
            | smufl::BRACE_FLAT
    )
}

/// Geometry for a brace spanning `span_height` px across `staff_count` staves.
pub(crate) fn brace_geometry(span_height: f64, staff_count: usize, sp: f64) -> BraceGeometry {
    let (codepoint, design_width) = brace_glyph(staff_count);

    // The glyph sits on its baseline and rises one em, so a font size of
    // `4 * height / design_height` makes it exactly `height` tall.
    let size = STAFF_HEIGHT_SP * span_height / smufl::BRACE_GLYPH_HEIGHT;
    let proportional_width = design_width * size / STAFF_HEIGHT_SP;

    let nominal_height = nominal_span_height(staff_count, sp);
    let nominal_size = STAFF_HEIGHT_SP * nominal_height / smufl::BRACE_GLYPH_HEIGHT;
    let width = proportional_width.min(design_width * nominal_size / STAFF_HEIGHT_SP);
    let scale_x = if proportional_width > 0.0 {
        width / proportional_width
    } else {
        1.0
    };

    BraceGeometry {
        codepoint,
        size,
        scale_x,
        width,
    }
}

/// Height of a group of `staff_count` staves at the spacing the layout aims
/// for, before justification pulls them apart.
fn nominal_span_height(staff_count: usize, sp: f64) -> f64 {
    let staves = staff_count.max(1) as f64;
    (staves * STAFF_HEIGHT_SP + (staves - 1.0) * NOMINAL_STAFF_GAP_SP) * sp
}

#[cfg(test)]
mod tests {
    use super::*;

    const SP: f64 = 10.0;
    /// A grand staff at the spacing the layout aims for: two staves, one gap.
    const NOMINAL_GRAND_STAFF: f64 = (2.0 * STAFF_HEIGHT_SP + NOMINAL_STAFF_GAP_SP) * SP;

    #[test]
    fn glyph_follows_the_number_of_staves() {
        assert_eq!(brace_geometry(60.0, 1, SP).codepoint, smufl::BRACE_SMALL);
        assert_eq!(brace_geometry(150.0, 2, SP).codepoint, smufl::BRACE);
        assert_eq!(brace_geometry(260.0, 3, SP).codepoint, smufl::BRACE_LARGE);
        assert_eq!(brace_geometry(370.0, 4, SP).codepoint, smufl::BRACE_LARGER);
        assert_eq!(brace_geometry(700.0, 8, SP).codepoint, smufl::BRACE_FLAT);
    }

    #[test]
    fn spans_exactly_the_requested_height() {
        let g = brace_geometry(NOMINAL_GRAND_STAFF, 2, SP);
        let drawn_height = smufl::BRACE_GLYPH_HEIGHT * g.size / STAFF_HEIGHT_SP;
        assert!((drawn_height - NOMINAL_GRAND_STAFF).abs() < 1e-9);
    }

    #[test]
    fn draws_proportionally_at_nominal_spacing() {
        let g = brace_geometry(NOMINAL_GRAND_STAFF, 2, SP);
        assert!((g.scale_x - 1.0).abs() < 1e-9);
        let proportional = smufl::BRACE_GLYPH_WIDTH * g.size / STAFF_HEIGHT_SP;
        assert!((g.width - proportional).abs() < 1e-9);
    }

    #[test]
    fn stretches_without_thickening_when_staves_are_pushed_apart() {
        let nominal = brace_geometry(NOMINAL_GRAND_STAFF, 2, SP);
        let stretched = brace_geometry(NOMINAL_GRAND_STAFF * 2.0, 2, SP);
        // Twice as tall …
        assert!((stretched.size - nominal.size * 2.0).abs() < 1e-9);
        // … and no wider than it was at nominal spacing.
        assert!((stretched.width - nominal.width).abs() < 1e-9);
        assert!((stretched.scale_x - 0.5).abs() < 1e-9);
    }

    #[test]
    fn stays_proportional_when_staves_sit_closer_than_nominal() {
        let squished = brace_geometry(NOMINAL_GRAND_STAFF * 0.7, 2, SP);
        assert!((squished.scale_x - 1.0).abs() < 1e-9);
        assert!(squished.width < brace_geometry(NOMINAL_GRAND_STAFF, 2, SP).width);
    }

    #[test]
    fn a_tall_group_is_no_wider_than_a_short_one() {
        // The alternates exist so that spanning more staves doesn't mean a
        // heavier brace: each cut is narrower than the one before it.
        let two = brace_geometry(NOMINAL_GRAND_STAFF, 2, SP);
        let ten = brace_geometry(nominal_span_height(10, SP), 10, SP);
        assert!(ten.width < ten.size * smufl::BRACE_GLYPH_WIDTH / STAFF_HEIGHT_SP);
        assert!(ten.width > two.width, "a taller brace is still taller");
    }
}

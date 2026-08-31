// Extracted from render_measure.rs — render_barlines

use super::config::LayoutConfig;
use super::types::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;

/// What to draw at a barline position. Combines the MNX `barline-type` enum
/// (which describes the line/dash/heavy style of a barline) with the three
/// repeat-marker kinds (`RepeatStart`, `RepeatEnd`, `RepeatBoth`) that MNX
/// represents as separate `measure.repeatStart` / `measure.repeatEnd` sibling
/// objects. This is a layout-internal type — the data model preserves the
/// wire shape (see `crate::model::barline::BarlineType` and the per-measure
/// repeat fields); the renderer takes the combined view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BarlineKind {
    Regular,
    Dotted,
    Dashed,
    Heavy,
    Double,
    Final,
    HeavyLight,
    HeavyHeavy,
    Tick,
    Short,
    NoBarline,
    RepeatStart,
    RepeatEnd,
    RepeatBoth,
}

impl From<BarlineType> for BarlineKind {
    fn from(bt: BarlineType) -> Self {
        match bt {
            BarlineType::Regular => BarlineKind::Regular,
            BarlineType::Dotted => BarlineKind::Dotted,
            BarlineType::Dashed => BarlineKind::Dashed,
            BarlineType::Heavy => BarlineKind::Heavy,
            BarlineType::Double => BarlineKind::Double,
            BarlineType::Final => BarlineKind::Final,
            BarlineType::HeavyLight => BarlineKind::HeavyLight,
            BarlineType::HeavyHeavy => BarlineKind::HeavyHeavy,
            BarlineType::Tick => BarlineKind::Tick,
            BarlineType::Short => BarlineKind::Short,
            BarlineType::NoBarline => BarlineKind::NoBarline,
        }
    }
}

impl From<&BarlineType> for BarlineKind {
    fn from(bt: &BarlineType) -> Self {
        BarlineKind::from(*bt)
    }
}

impl BarlineKind {
    /// Resolve the barline to draw at a measure boundary, given the previous
    /// measure's `repeat_end` presence, the next measure's `repeat_start`
    /// presence, and the previous measure's wire `barline.type` (if any).
    /// Falls back to the supplied default when no `barline` is set.
    pub(crate) fn at_boundary(
        prev_has_repeat_end: bool,
        next_has_repeat_start: bool,
        prev_barline_type: Option<&BarlineType>,
        fallback: BarlineType,
    ) -> Self {
        match (prev_has_repeat_end, next_has_repeat_start) {
            (true, true) => BarlineKind::RepeatBoth,
            (true, false) => BarlineKind::RepeatEnd,
            (false, true) => BarlineKind::RepeatStart,
            (false, false) => BarlineKind::from(prev_barline_type.copied().unwrap_or(fallback)),
        }
    }
}

/// Horizontal distance (in pixels) a barline's ink extends to the LEFT of its
/// anchor x. A preceding mid-system change clef is right-aligned against this
/// edge (not the anchor) so the clef clears wide barlines (double, final,
/// heavy) instead of overhanging their leftmost stroke. Mirrors the geometry in
/// `render_barline`.
pub(crate) fn barline_left_extent(bt: &BarlineKind, config: &LayoutConfig, sp: f64) -> f64 {
    let thin = config.barline_width * sp;
    let thick = 0.5 * sp;
    let sep = 0.4 * sp;
    match bt {
        // Single thick bar, right edge at x.
        BarlineKind::Heavy => thick,
        // Two thin lines centered on x ± (sep+thin)/2; leftmost ink a further thin/2.
        BarlineKind::Double => (sep + thin) * 0.5 + thin * 0.5,
        // Thin (left) + thick (right edge at x): thin center at x-thick-sep.
        BarlineKind::Final => thick + sep + thin * 0.5,
        // Thick (left) + thin (right edge at x): thick left edge at x-thin-sep-thick.
        BarlineKind::HeavyLight => thin + sep + thick,
        // Two thick bars, right bar right edge at x; left bar left edge x-2*thick-sep.
        BarlineKind::HeavyHeavy => 2.0 * thick + sep,
        // Repeat glyphs are drawn with their pre-x advance to the left of x.
        BarlineKind::RepeatEnd => 1.468 * sp,
        BarlineKind::RepeatBoth => 1.216 * sp,
        BarlineKind::NoBarline => 0.0,
        // Single thin strokes centered on x (Regular, Dotted, Dashed, Tick,
        // Short): ink reaches only half a line-width left.
        // RepeatStart's SMuFL glyph is anchored at x and has no left ink.
        BarlineKind::RepeatStart => 0.0,
        _ => thin * 0.5,
    }
}

/// Total horizontal ink width of a barline. Measure layout reserves the width
/// beyond a regular stroke so a structural boundary does not consume the
/// preceding measure's rhythmic space.
pub(crate) fn barline_ink_width(bt: &BarlineKind, config: &LayoutConfig, sp: f64) -> f64 {
    let thin = config.barline_width * sp;
    let thick = 0.5 * sp;
    let sep = 0.4 * sp;
    match bt {
        BarlineKind::Heavy => thick,
        BarlineKind::Double => 2.0 * thin + sep,
        BarlineKind::Final | BarlineKind::HeavyLight => thin + sep + thick,
        BarlineKind::HeavyHeavy => 2.0 * thick + sep,
        BarlineKind::RepeatStart => 1.472 * sp,
        BarlineKind::RepeatEnd => 1.468 * sp,
        BarlineKind::RepeatBoth => 2.432 * sp,
        BarlineKind::NoBarline => 0.0,
        _ => thin,
    }
}

/// Width beyond a regular stroke reserved at this measure's trailing boundary.
pub(crate) fn trailing_barline_extra_width(
    rm: &ResolvedMeasure,
    config: &LayoutConfig,
    sp: f64,
) -> f64 {
    let kind = BarlineKind::at_boundary(
        rm.global.repeat_end.is_some(),
        rm.next_has_repeat_start,
        rm.global
            .barline
            .as_ref()
            .map(|barline| &barline.barline_type),
        BarlineType::Regular,
    );
    let regular_width = barline_ink_width(&BarlineKind::Regular, config, sp);
    (barline_ink_width(&kind, config, sp) - regular_width).max(0.0)
}

/// Space already present between the rhythmic content boundary and the
/// trailing barline's left ink edge, in staff spaces.
///
/// A final-onset spacing constraint subtracts this structural buffer from the
/// ink clearance it must preserve inside the rhythmic content width.
pub(crate) fn trailing_barline_content_buffer_sp(
    rm: &ResolvedMeasure,
    config: &LayoutConfig,
) -> f64 {
    let kind = BarlineKind::at_boundary(
        rm.global.repeat_end.is_some(),
        rm.next_has_repeat_start,
        rm.global
            .barline
            .as_ref()
            .map(|barline| &barline.barline_type),
        BarlineType::Regular,
    );
    let ink_width = barline_ink_width(&kind, config, 1.0);
    let regular = barline_ink_width(&BarlineKind::Regular, config, 1.0);
    let extra = (ink_width - regular).max(0.0);
    (super::measure::MEASURE_TRAILING_PADDING_SP + extra - barline_left_extent(&kind, config, 1.0))
        .max(0.0)
}

pub(crate) fn regular_trailing_barline_content_buffer_sp(config: &LayoutConfig) -> f64 {
    super::measure::MEASURE_TRAILING_PADDING_SP
        - barline_left_extent(&BarlineKind::Regular, config, 1.0)
}

/// Note-bearing width, excluding prefix, trailing padding, and structural
/// barline overhead. Position-bearing annotations share this coordinate space.
pub(crate) fn rhythmic_content_width(ml: &MeasureLayout, sp: f64) -> f64 {
    (ml.width
        - ml.prefix_width
        - super::measure::MEASURE_TRAILING_PADDING_SP * sp
        - ml.trailing_barline_extra)
        .max(0.0)
}

pub(crate) fn render_barline(
    dl: &mut DisplayList,
    x: f64,
    staff_y: f64,
    staff_height: f64,
    sp: f64,
    config: &LayoutConfig,
    bt: &BarlineKind,
) {
    let font_size = 4.0 * sp;
    // SMuFL barline glyphs: origin at bottom staff line, extending upward
    let glyph_y = staff_y + staff_height;
    let thin = config.barline_width * sp;
    let thick = 0.5 * sp;
    // Bravura engraving defaults: barlineSeparation = 0.4sp (gap between thin/thick lines)
    let sep = 0.4 * sp;

    match bt {
        BarlineKind::Final => {
            // Thin + thick drawn with primitives for pixel-perfect connector alignment.
            // Thick bar right edge at x; thin line to the left of it.
            // Total width: thin + sep + thick
            let thin_center = x - thick - sep;
            dl.barline(thin_center, staff_y, staff_y + staff_height, thin);
            dl.push(RenderCommand::DrawRect {
                x: x - thick,
                y: staff_y,
                w: thick,
                h: staff_height,
                color: "#000000".into(),
            });
        }
        BarlineKind::Double => {
            // Two thin lines separated by the same edge-to-edge gap as the
            // final barline (barlineSeparation = 0.4sp). Center separation is
            // that gap plus one line thickness so the visible white space
            // between the lines matches the final barline.
            let center_sep = sep + thin;
            dl.barline(x - center_sep * 0.5, staff_y, staff_y + staff_height, thin);
            dl.barline(x + center_sep * 0.5, staff_y, staff_y + staff_height, thin);
        }
        BarlineKind::RepeatEnd => {
            // SMuFL repeatRight: advance width 1.468sp
            dl.push(RenderCommand::DrawGlyph {
                x: x - 1.468 * sp,
                y: glyph_y,
                codepoint: smufl::REPEAT_RIGHT,
                font: "Bravura".into(),
                size: font_size,
                color: "#000000".into(),
                rotation: 0.0,
            });
        }
        BarlineKind::RepeatStart => {
            // SMuFL repeatLeft: advance width 1.472sp
            dl.push(RenderCommand::DrawGlyph {
                x,
                y: glyph_y,
                codepoint: smufl::REPEAT_LEFT,
                font: "Bravura".into(),
                size: font_size,
                color: "#000000".into(),
                rotation: 0.0,
            });
        }
        BarlineKind::RepeatBoth => {
            // SMuFL repeatRightLeft: advance width 2.432sp, centered on x
            dl.push(RenderCommand::DrawGlyph {
                x: x - 1.216 * sp,
                y: glyph_y,
                codepoint: smufl::REPEAT_RIGHT_LEFT,
                font: "Bravura".into(),
                size: font_size,
                color: "#000000".into(),
                rotation: 0.0,
            });
        }
        BarlineKind::Dashed => {
            // SMuFL engraving defaults: dash=0.5sp, gap=0.25sp, thickness=0.16sp
            let dash_len = 0.5 * sp;
            let gap_len = 0.25 * sp;
            let thickness = config.barline_width * sp;
            let mut y = staff_y;
            let y_end = staff_y + staff_height;
            while y < y_end {
                let seg_end = (y + dash_len).min(y_end);
                dl.barline(x, y, seg_end, thickness);
                y = seg_end + gap_len;
            }
        }
        BarlineKind::Tick => {
            // Short line at top of staff, 1 staff space tall
            let thickness = config.barline_width * sp;
            dl.barline(x, staff_y, staff_y + sp, thickness);
        }
        BarlineKind::Short => {
            // Spans only staff lines 2–4 (middle half of a 5-line staff)
            // Line 2 is at 1sp from top, line 4 is at 3sp from top
            let thickness = config.barline_width * sp;
            let y_top = staff_y + sp;
            let y_bottom = staff_y + 3.0 * sp;
            dl.barline(x, y_top, y_bottom, thickness);
        }
        BarlineKind::Heavy => {
            // Single thick bar, right edge at x.
            dl.push(RenderCommand::DrawRect {
                x: x - thick,
                y: staff_y,
                w: thick,
                h: staff_height,
                color: "#000000".into(),
            });
        }
        BarlineKind::Dotted => {
            // Dotted barline: series of dots at regular intervals.
            // Bravura engraving defaults: dot period ~1sp
            let dot_r = thin * 0.8;
            let period = sp;
            let mut y = staff_y + period * 0.5;
            let y_end = staff_y + staff_height;
            while y <= y_end {
                dl.dot(x, y, dot_r);
                y += period;
            }
        }
        BarlineKind::HeavyLight => {
            // Thick + thin (reverse final). Thick bar left edge, thin right edge at x.
            let thin_center = x - thin * 0.5;
            let thick_left = x - thin - sep - thick;
            dl.push(RenderCommand::DrawRect {
                x: thick_left,
                y: staff_y,
                w: thick,
                h: staff_height,
                color: "#000000".into(),
            });
            dl.barline(thin_center, staff_y, staff_y + staff_height, thin);
        }
        BarlineKind::HeavyHeavy => {
            // Two thick bars. Right bar right edge at x.
            dl.push(RenderCommand::DrawRect {
                x: x - thick - sep - thick,
                y: staff_y,
                w: thick,
                h: staff_height,
                color: "#000000".into(),
            });
            dl.push(RenderCommand::DrawRect {
                x: x - thick,
                y: staff_y,
                w: thick,
                h: staff_height,
                color: "#000000".into(),
            });
        }
        BarlineKind::NoBarline => {}
        BarlineKind::Regular => {
            dl.barline(
                x,
                staff_y,
                staff_y + staff_height,
                config.barline_width * sp,
            );
        }
    }
}

/// Render a barline connector between staves (gap region).
/// Extends the barline lines through the inter-staff gap without dots or glyphs.
/// Uses identical positioning to render_barline for pixel-perfect alignment.
pub(crate) fn render_barline_connector(
    dl: &mut DisplayList,
    x: f64,
    y_top: f64,
    y_bottom: f64,
    sp: f64,
    config: &LayoutConfig,
    bt: &BarlineKind,
) {
    let thin = config.barline_width * sp;
    let thick = 0.5 * sp;
    let sep = 0.4 * sp;
    let h = y_bottom - y_top;
    match bt {
        BarlineKind::Final => {
            let thin_center = x - thick - sep;
            dl.barline(thin_center, y_top, y_bottom, thin);
            dl.push(RenderCommand::DrawRect {
                x: x - thick,
                y: y_top,
                w: thick,
                h,
                color: "#000000".into(),
            });
        }
        BarlineKind::Double => {
            let center_sep = sep + thin;
            dl.barline(x - center_sep * 0.5, y_top, y_bottom, thin);
            dl.barline(x + center_sep * 0.5, y_top, y_bottom, thin);
        }
        BarlineKind::Heavy => {
            dl.push(RenderCommand::DrawRect {
                x: x - thick,
                y: y_top,
                w: thick,
                h,
                color: "#000000".into(),
            });
        }
        BarlineKind::HeavyLight => {
            let thin_center = x - thin * 0.5;
            let thick_left = x - thin - sep - thick;
            dl.push(RenderCommand::DrawRect {
                x: thick_left,
                y: y_top,
                w: thick,
                h,
                color: "#000000".into(),
            });
            dl.barline(thin_center, y_top, y_bottom, thin);
        }
        BarlineKind::HeavyHeavy => {
            dl.push(RenderCommand::DrawRect {
                x: x - thick - sep - thick,
                y: y_top,
                w: thick,
                h,
                color: "#000000".into(),
            });
            dl.push(RenderCommand::DrawRect {
                x: x - thick,
                y: y_top,
                w: thick,
                h,
                color: "#000000".into(),
            });
        }
        BarlineKind::RepeatEnd => {
            // thin + thick lines only (no dots in gap)
            let thin_center = x - thick - sep;
            dl.barline(thin_center, y_top, y_bottom, thin);
            dl.push(RenderCommand::DrawRect {
                x: x - thick,
                y: y_top,
                w: thick,
                h,
                color: "#000000".into(),
            });
        }
        BarlineKind::RepeatStart => {
            // thick + thin lines only (no dots in gap)
            let thin_center = x + thick + sep;
            dl.push(RenderCommand::DrawRect {
                x,
                y: y_top,
                w: thick,
                h,
                color: "#000000".into(),
            });
            dl.barline(thin_center, y_top, y_bottom, thin);
        }
        BarlineKind::RepeatBoth => {
            // thin | thick | thin (no dots in gap)
            let cx = x;
            dl.barline(cx - thick * 0.5 - sep, y_top, y_bottom, thin);
            dl.push(RenderCommand::DrawRect {
                x: cx - thick * 0.5,
                y: y_top,
                w: thick,
                h,
                color: "#000000".into(),
            });
            dl.barline(cx + thick * 0.5 + sep, y_top, y_bottom, thin);
        }
        BarlineKind::Dashed => {
            // Continue dashes through inter-staff gap
            let dash_len = 0.5 * sp;
            let gap_len = 0.25 * sp;
            let mut y = y_top;
            while y < y_bottom {
                let seg_end = (y + dash_len).min(y_bottom);
                dl.barline(x, y, seg_end, thin);
                y = seg_end + gap_len;
            }
        }
        BarlineKind::Tick | BarlineKind::Short | BarlineKind::NoBarline => {
            // These barline types do not connect between staves
        }
        _ => {
            // Regular, etc: single thin line
            dl.barline(x, y_top, y_bottom, thin);
        }
    }
}

/// One inter-staff gap a barline has to bridge, in page coordinates.
pub(crate) struct BarlineGap {
    /// Barline centre X, matching the per-staff segments above and below.
    pub x: f64,
    /// Bottom line of the staff above.
    pub y_top: f64,
    /// Top line of the staff below.
    pub y_bottom: f64,
}

/// Draw a barline connector across one inter-staff gap and register it as part
/// of the barline named by `element_id`.
///
/// The run between staves is the same barline as the runs on them, so it has to
/// answer to selection the same way: highlighting the barline lights the whole
/// vertical line rather than leaving gaps where the staves aren't, and the gap
/// is as clickable as the staff — often more so, since nothing else is drawn
/// there to compete for the click.
pub(crate) fn render_tagged_barline_connector(
    dl: &mut DisplayList,
    gap: BarlineGap,
    sp: f64,
    config: &LayoutConfig,
    bt: &BarlineKind,
    element_id: &str,
) {
    let first_cmd = dl.commands.len();
    render_barline_connector(dl, gap.x, gap.y_top, gap.y_bottom, sp, config, bt);
    // Tick, short and absent barlines don't cross the gap; with nothing drawn
    // there is nothing to select either.
    if dl.commands.len() == first_cmd {
        return;
    }
    for ci in first_cmd..dl.commands.len() {
        dl.tag_command(ci, element_id.to_string());
    }
    let hit_width = barline_hit_width(bt, sp, config);
    dl.push_element_bbox_with_shape(ElementBBox {
        element_id: element_id.to_string(),
        bbox: BoundingBox::new(
            gap.x - hit_width * 0.5,
            gap.y_top,
            hit_width,
            gap.y_bottom - gap.y_top,
        ),
    });
}

/// Clickable width of a barline: its drawn width, but never narrower than
/// 1.5sp, so a hairline stays easy to aim at. Mirrors the per-staff hit region.
fn barline_hit_width(bt: &BarlineKind, sp: f64, config: &LayoutConfig) -> f64 {
    let thin = config.barline_width * sp;
    let thick = 0.5 * sp;
    let sep = 0.4 * sp;
    let drawn = match bt {
        BarlineKind::Double => thin * 2.0 + sep,
        BarlineKind::Heavy => thick,
        BarlineKind::HeavyHeavy => thick * 2.0 + sep,
        BarlineKind::Final | BarlineKind::HeavyLight | BarlineKind::RepeatStart => {
            thin + sep + thick
        }
        BarlineKind::RepeatEnd => thin + sep + thick,
        BarlineKind::RepeatBoth => thin * 2.0 + sep * 2.0 + thick,
        _ => thin,
    };
    drawn.max(1.5 * sp)
}

/// Render repeat count text (e.g., "4x") above a repeat-end barline when times > 2.
pub(crate) fn render_repeat_count(dl: &mut DisplayList, x: f64, staff_y: f64, sp: f64, times: u32) {
    dl.push(RenderCommand::DrawText {
        x,
        y: staff_y - 0.5 * sp,
        text: format!("{}x", times),
        font: "serif".into(),
        size: 1.2 * sp,
        color: "#000000".into(),
        align: TextAlign::Right,
        baseline: TextBaseline::Bottom,
    });
}

/// Render repeat count labels for all measures that have `repeat_end.times > 2`.
pub(crate) fn render_repeat_counts(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
) {
    for (i, ml) in measure_layouts.iter().enumerate() {
        if let Some(ref re) = ml.resolved.global.repeat_end {
            let times = re.times.unwrap_or(2);
            if times > 2 {
                // Barline x: end of last measure, or start of next measure
                let barline_x = if i + 1 < measure_layouts.len() {
                    measure_layouts[i + 1].x
                } else {
                    ml.x + ml.width
                };
                render_repeat_count(dl, barline_x, staff_y, sp, times);
            }
        }
    }
}

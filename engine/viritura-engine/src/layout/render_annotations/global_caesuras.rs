use super::{shift_marking_x, DisplayList, MeasureLayout};
use crate::layout::config::LayoutConfig;
use crate::render::{smufl::smufl, ElementKind};

/// Reserve the same barline-local ink column before staff/page positions freeze.
pub(crate) fn global_caesura_top(ml: &MeasureLayout, sp: f64, config: &LayoutConfig) -> f64 {
    let Some(caesura) = &ml.resolved.global.caesura else {
        return 0.0;
    };
    let glyph = smufl::caesura_glyph(&caesura.marking.style, caesura.marking.marks);
    let (_, _, width, height) = smufl::glyph_bbox(glyph);
    let metrics = config.placement.resolve(ElementKind::Caesura);
    let right = ml.x + ml.width - 0.25 * sp;
    let top = -height * 0.5 * sp;
    let substrate =
        super::highest_point_in_range(ml, 0.0, sp, config.stem_length, right - width * sp, right);
    if substrate < 0.0 {
        top.min(substrate - (metrics.padding.vertical + height) * sp)
    } else {
        top
    }
}

/// A change clef may precede the incoming barline. Use its exported visible
/// coordinate rather than the preceding rhythmic measure's frozen right edge.
pub(super) fn align_barline_caesuras(
    dl: &mut DisplayList,
    staff_cmd_start: usize,
    measures: &[MeasureLayout],
    staff_y: f64,
) {
    for pair in measures.windows(2) {
        let (outgoing, incoming) = (&pair[0], &pair[1]);
        if outgoing.resolved.global.caesura.is_none() || incoming.is_first_on_system {
            continue;
        }
        let Some(bound) = dl.measure_bounds.iter().find(|bound| {
            bound.index == incoming.resolved.index && (bound.y - staff_y).abs() < 1e-6
        }) else {
            continue;
        };
        let dx = bound.x - (outgoing.x + outgoing.width);
        shift_marking_x(
            dl,
            staff_cmd_start,
            &format!("m{}/caesura", outgoing.resolved.index),
            dx,
        );
    }
}

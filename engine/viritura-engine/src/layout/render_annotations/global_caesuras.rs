use super::{shift_marking_x, DisplayList, MeasureLayout};
use crate::render::smufl::smufl;

/// Reserve the caesura's fixed extent above the top staff line.
pub(crate) fn global_caesura_top(ml: &MeasureLayout, sp: f64) -> f64 {
    let Some(caesura) = &ml.resolved.global.caesura else {
        return 0.0;
    };
    let glyph = smufl::caesura_glyph(&caesura.marking.style, caesura.marking.marks);
    let (_, _, _, height) = smufl::glyph_bbox(glyph);
    -height * 0.5 * sp
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

use crate::layout::config::LayoutConfig;
use crate::layout::types::MeasureLayout;
use crate::render::DisplayList;

pub(crate) fn render_hairpins(
    dl: &mut DisplayList,
    layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    part_index: usize,
    command_start: usize,
    slur_start: usize,
    offsets: Option<&[f64]>,
) {
    let has_tuplets = dl
        .element_ids
        .iter()
        .skip(command_start)
        .flatten()
        .any(|id| id.contains("/tuplet"));
    if has_tuplets {
        let hairpin_count = layouts
            .iter()
            .filter_map(|layout| layout.resolved.part.dynamics.as_ref())
            .flatten()
            .filter(|dynamic| dynamic.is_gradual())
            .count();
        // A shared endpoint can carry an outward adjustment back through each
        // connected wedge. Settle the chain before publishing its ink geometry.
        if hairpin_count > 1 {
            for _ in 0..=hairpin_count {
                if !super::render_hairpins_pass(
                    dl,
                    layouts,
                    staff_y,
                    sp,
                    config,
                    part_index,
                    command_start,
                    slur_start,
                    offsets,
                    false,
                ) {
                    break;
                }
            }
        }
    }
    super::render_hairpins_pass(
        dl,
        layouts,
        staff_y,
        sp,
        config,
        part_index,
        command_start,
        slur_start,
        offsets,
        true,
    );
}

use super::super::config::LayoutConfig;
use super::super::full_score::FlatStaff;
use super::super::slurs::{GlobalSlurEvent, SystemSlurBounds};
use super::super::ties::GlobalTieNote;
use super::super::types::MeasureLayout;
use std::collections::HashMap;

/// Collect cross-system curve events and per-staff bounds without rendering.
#[allow(clippy::too_many_arguments)] // collection boundary: system geometry and outputs are independent inputs
pub(super) fn collect_system_slur_data(
    all_staff_layouts: &[Vec<MeasureLayout>],
    flat_staves: &[FlatStaff],
    staff_y_offsets: &[f64],
    margin_left: f64,
    sp: f64,
    config: &LayoutConfig,
    system_index: usize,
    slur_bounds: &mut HashMap<(usize, usize, usize), SystemSlurBounds>,
    global_slur_events: &mut Vec<GlobalSlurEvent>,
    global_tie_notes: &mut Vec<GlobalTieNote>,
) {
    for (staff_index, measure_layouts) in all_staff_layouts.iter().enumerate() {
        let staff_y = staff_y_offsets[staff_index];
        let part_index = flat_staves
            .get(staff_index)
            .and_then(|staff| staff.sources.first())
            .map_or(staff_index, |source| source.part_index);
        let right_x = measure_layouts
            .last()
            .map_or(margin_left, |layout| layout.x + layout.width);
        slur_bounds.insert(
            (system_index, part_index, staff_index),
            SystemSlurBounds {
                left_x: margin_left,
                right_x,
            },
        );
        super::super::slurs::collect_global_slur_events(
            measure_layouts,
            staff_y,
            Some(staff_y_offsets),
            sp,
            config,
            system_index,
            part_index,
            staff_index,
            global_slur_events,
        );
        super::super::ties::collect_global_tie_notes(
            measure_layouts,
            staff_y,
            Some(staff_y_offsets),
            sp,
            config,
            system_index,
            part_index,
            staff_index,
            global_tie_notes,
        );
    }
}

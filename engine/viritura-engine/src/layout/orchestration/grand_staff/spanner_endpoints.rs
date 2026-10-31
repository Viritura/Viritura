use crate::layout::config::LayoutConfig;
use crate::layout::slurs::{collect_global_slur_events, GlobalSlurEvent, SystemSlurBounds};
use crate::layout::ties::{collect_global_tie_notes, GlobalTieNote};
use crate::layout::types::MeasureLayout;
use std::collections::HashMap;

#[allow(clippy::too_many_arguments)] // one staff's geometry and global endpoint stores
pub(super) fn collect_staff_spanner_endpoints(
    layouts: &[MeasureLayout],
    staff_y_offsets: &[f64],
    sp: f64,
    config: &LayoutConfig,
    route: (usize, usize, usize),
    bounds: SystemSlurBounds,
    slur_bounds: &mut HashMap<(usize, usize, usize), SystemSlurBounds>,
    global_slur_events: &mut Vec<GlobalSlurEvent>,
    global_tie_notes: &mut Vec<GlobalTieNote>,
) {
    let (system_index, part_index, staff_index) = route;
    let staff_y = staff_y_offsets[staff_index];
    slur_bounds.insert(route, bounds);
    collect_global_slur_events(
        layouts,
        staff_y,
        Some(staff_y_offsets),
        sp,
        config,
        system_index,
        part_index,
        staff_index,
        global_slur_events,
    );
    collect_global_tie_notes(
        layouts,
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

use crate::layout::{config::LayoutConfig, debug, types::MeasureLayout};
use crate::render::{LayoutDebugInfo, PageLayout, StaffPairDebug, SystemDebug};

pub(super) struct SystemDebugInputs<'a> {
    pub config: &'a LayoutConfig,
    pub pages: &'a [PageLayout],
    pub layouts: &'a [Vec<Vec<MeasureLayout>>],
    pub positions: &'a [f64],
    pub extras: &'a [(f64, f64)],
    pub bottom_staff_y: &'a [f64],
    pub staff_pairs: &'a [Vec<StaffPairDebug>],
    pub max_widths: &'a [f64],
}

pub(super) fn build_system_debug(input: SystemDebugInputs<'_>) -> LayoutDebugInfo {
    let c = input.config;
    let sp = c.sp;
    let mut systems = Vec::with_capacity(input.layouts.len());
    for (index, staves) in input.layouts.iter().enumerate() {
        let top_staff = staves.first().map_or(&[][..], Vec::as_slice);
        let bottom_staff = staves.last().map_or(&[][..], Vec::as_slice);
        let staff_top = input.positions[index];
        let (above_extra, below_extra) = input.extras[index];
        let staff_bottom_y = input.bottom_staff_y[index] + 4.0 * sp;
        let x_start = top_staff.first().map_or(0.0, |ml| ml.x);
        let x_end = top_staff.last().map_or(x_start, |ml| ml.x + ml.width);
        systems.push(SystemDebug {
            index,
            page_index: debug::page_for_system(input.pages, index),
            bbox_top_y: staff_top - above_extra,
            staff_top_y: staff_top,
            staff_bottom_y,
            bbox_bottom_y: staff_bottom_y + below_extra,
            x_start,
            x_end,
            above_extra,
            above_breakdown: debug::above_breakdown(top_staff, sp, c.stem_length),
            below_extra,
            below_breakdown: debug::below_breakdown(bottom_staff, sp, c.stem_length),
            measure_extremes: debug::measure_extremes(top_staff, sp, c.stem_length),
            staff_pairs: input.staff_pairs.get(index).cloned().unwrap_or_default(),
            measure_spacings: debug::measure_spacings(top_staff, |idx| {
                input.max_widths.get(idx).copied()
            }),
            inter_system_gap_to_next: None,
        });
    }
    debug::link_inter_system_gaps(&mut systems, sp);
    LayoutDebugInfo {
        pagination: None,
        systems,
        sp,
        staff_height: 4.0 * sp,
        min_note_spacing: c.min_note_spacing * sp,
        shortest_duration_space: c.shortest_duration_space * sp,
        spacing_increment: c.spacing_increment * sp,
        placement: debug::build_placement_debug(c, sp),
    }
}

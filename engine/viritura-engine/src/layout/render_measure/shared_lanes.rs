use super::super::config::LayoutConfig;
use super::super::render_annotations::AboveGlyphBox;
use super::super::types::MeasureLayout;
use super::multimeasure_rest_number_extent;

pub(crate) struct SharedStaffLane {
    pub is_top: bool,
    pub is_bottom: bool,
    pub center_y: Option<f64>,
}

pub(crate) fn shared_staff_lane(
    staff_y: f64,
    sp: f64,
    staff_y_offsets: Option<&[f64]>,
) -> SharedStaffLane {
    let shared = staff_y_offsets.filter(|offsets| offsets.len() > 1);
    SharedStaffLane {
        is_top: shared.is_none_or(|offsets| (staff_y - offsets[0]).abs() < 0.01),
        is_bottom: shared.is_none_or(|offsets| {
            offsets
                .last()
                .is_some_and(|bottom| (staff_y - bottom).abs() < 0.01)
        }),
        center_y: shared.map(|offsets| {
            (offsets[0] + offsets.last().copied().unwrap_or(offsets[0]) + 4.0 * sp) * 0.5
        }),
    }
}

pub(crate) fn above_measure_obstacles(
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) -> Vec<AboveGlyphBox> {
    measure_layouts
        .iter()
        .filter_map(|ml| multimeasure_rest_number_extent(ml, staff_y, sp))
        .chain(measure_layouts.iter().filter_map(|ml| {
            super::super::time_signatures::above_staff_extent(
                ml,
                staff_y,
                sp,
                config.time_signature_settings,
            )
        }))
        .collect()
}

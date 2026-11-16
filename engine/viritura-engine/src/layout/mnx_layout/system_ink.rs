//! Final staff ink used by page fitting, including dependent collision flow.

use super::super::config::LayoutConfig;
use super::super::full_score::FlatStaff;
use super::super::page::vertical_ink_extent;
use super::super::types::MeasureLayout;
use super::shared::render_system_staff_content;
use crate::model::Score;
use crate::render::DisplayList;

pub(super) fn outer_extents(
    layouts: &[Vec<MeasureLayout>],
    staves: &[FlatStaff],
    offsets: &[f64],
    score: &Score,
    config: &LayoutConfig,
) -> (f64, f64) {
    let Some((&first_y, &last_y)) = offsets.first().zip(offsets.last()) else {
        return (0.0, 0.0);
    };
    let clef_changes = super::super::render_measure::clef_change_measure_set_from_layouts(layouts);
    let mut scratch = DisplayList::new(0.0, 0.0);
    let mut accidentals = Vec::new();
    for staff in 0..layouts.len() {
        render_system_staff_content(
            &mut scratch,
            layouts,
            staves,
            None,
            offsets,
            score,
            None,
            config.sp,
            config,
            0,
            2,
            false,
            0,
            &clef_changes,
            None,
            staff,
            &mut accidentals,
        );
    }
    let ink = scratch.commands.iter().filter_map(vertical_ink_extent);
    ink.fold((0.0_f64, 0.0_f64), |(above, below), (top, bottom)| {
        (
            above.max(first_y - top),
            below.max(bottom - last_y - 4.0 * config.sp),
        )
    })
}

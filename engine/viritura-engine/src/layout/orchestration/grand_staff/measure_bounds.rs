use crate::layout::beat_anchors::build_beat_anchors;
use crate::layout::render_measure;
use crate::layout::types::MeasureLayout;
use crate::render::DisplayList;
use std::collections::HashSet;

pub(super) fn push_grand_staff_measure_bounds(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    part_index: usize,
    staff_index: usize,
    system_index: usize,
    clef_change_measures: &HashSet<usize>,
) {
    let (total_beats, beat_anchors) = build_beat_anchors(ml);
    let leading_clef_gap = render_measure::measure_leading_clef_gap(ml, sp, clef_change_measures);
    let (x, width, prefix_width) = render_measure::measure_bounds_geometry(ml, leading_clef_gap);
    dl.measure_bounds.push(crate::render::MeasureBounds {
        index: ml.resolved.index,
        measure_id: ml.resolved.global.id.clone(),
        part_index,
        part_id: dl.parts[0].id.clone(),
        source_part_indices: Vec::new(),
        staff_index,
        system_index,
        x,
        width,
        y: staff_y,
        height: 4.0 * sp,
        prefix_width,
        total_beats,
        beat_anchors,
        ghost_staff: false,
        is_hidden: false,
        has_music_hidden: false,
        is_expansion: false,
    });
}

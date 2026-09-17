use super::super::full_score::FlatStaff;
use crate::render::MeasureBounds;
use std::collections::HashMap;

pub(super) fn shared_lane_staff_offsets(
    flat_staves: &[FlatStaff],
    staff_y_offsets: &[f64],
    part_index: usize,
) -> Vec<f64> {
    flat_staves
        .iter()
        .enumerate()
        .filter(|(_, staff)| {
            staff
                .sources
                .first()
                .is_some_and(|source| source.part_index == part_index)
        })
        .map(|(index, _)| staff_y_offsets[index])
        .collect()
}

pub(super) fn assign_measure_sources(
    bounds: &mut [MeasureBounds],
    staff: Option<&FlatStaff>,
    measure_staves: Option<&HashMap<usize, &FlatStaff>>,
) {
    for bounds in bounds {
        let Some(staff) = measure_staves
            .and_then(|staves| staves.get(&bounds.index).copied())
            .or(staff)
        else {
            continue;
        };
        if let Some(source) = staff.sources.first() {
            bounds.part_index = source.part_index;
        }
        bounds.source_part_indices.clear();
        for source in &staff.sources {
            if !bounds.source_part_indices.contains(&source.part_index) {
                bounds.source_part_indices.push(source.part_index);
            }
        }
        if bounds.source_part_indices.len() == 1 {
            bounds.source_part_indices.clear();
        }
    }
}

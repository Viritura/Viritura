use super::super::full_score::FlatStaff;
use super::super::types::MeasureLayout;
use super::super::volta::render_ottavas_across_chunks;
use super::staff_placement::StaffYPlacement;
use crate::render::DisplayList;

pub(super) fn render(
    dl: &mut DisplayList,
    chunks: &[Vec<Vec<MeasureLayout>>],
    flat_staves: &[FlatStaff],
    placement: &StaffYPlacement,
    sp: f64,
) {
    for (staff_index, staff) in flat_staves.iter().enumerate() {
        let measures: Vec<_> = chunks
            .iter()
            .enumerate()
            .flat_map(|(chunk_index, staves)| {
                staves[staff_index]
                    .iter()
                    .map(move |measure| (chunk_index, measure))
            })
            .collect();
        let part_index = staff
            .sources
            .first()
            .map_or(staff_index, |source| source.part_index);
        // Placed layouts remain available even when patch rendering omits
        // retained chunks from the current display list.
        render_ottavas_across_chunks(
            dl,
            &measures,
            placement.offsets[staff_index],
            sp,
            part_index,
        );
    }
}

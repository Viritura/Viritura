use crate::layout::config::LayoutConfig;
use crate::layout::page::{compute_page_breaks_with_extras, compute_system_y_positions};
use crate::layout::types::ResolvedOttavaRange;
use crate::layout::{
    compute_above_staff_extra, compute_below_staff_extra_from_layouts, layout_measure,
};
use crate::model::ResolvedMeasure;
use crate::render::PageLayout;

pub(super) struct GrandStaffPages {
    pub(super) pages: Vec<PageLayout>,
    pub(super) positions: Vec<f64>,
    pub(super) gaps: Vec<f64>,
    pub(super) total_height: f64,
}

pub(super) fn position_grand_staff_pages(
    config: &LayoutConfig,
    systems: &[Vec<usize>],
    resolved: &[Vec<ResolvedMeasure>],
    ottavas: &[Vec<ResolvedOttavaRange>],
    shortest_beats: f64,
    staff_height: f64,
    staff_gap: f64,
) -> GrandStaffPages {
    let system_count = systems.len();
    let staff_count = resolved.len();
    let system_height =
        staff_count as f64 * staff_height + staff_count.saturating_sub(1) as f64 * staff_gap;
    let extras: Vec<_> = systems
        .iter()
        .map(|system| {
            if config.page_width.is_none() {
                return (0.0, 0.0);
            }
            let outer_layouts = |staff: usize| {
                system
                    .iter()
                    .enumerate()
                    .map(|(index, &measure)| {
                        let mut layout = layout_measure(
                            &resolved[staff][measure],
                            config.sp,
                            0.0,
                            config,
                            None,
                            &ottavas[staff],
                            shortest_beats,
                        );
                        layout.is_first_on_system = index == 0;
                        layout
                    })
                    .collect::<Vec<_>>()
            };
            let top = outer_layouts(0);
            let bottom = outer_layouts(staff_count - 1);
            let measures: Vec<_> = top.iter().map(|layout| &layout.resolved).collect();
            (
                compute_above_staff_extra(
                    &measures,
                    Some(&top),
                    config.sp,
                    config.stem_length,
                    config,
                ),
                compute_below_staff_extra_from_layouts(
                    &bottom,
                    config.sp,
                    config.stem_length,
                    config,
                ),
            )
        })
        .collect();
    let heights: Vec<_> = extras
        .iter()
        .map(|(above, below)| system_height + above + below)
        .collect();
    let pages = compute_page_breaks_with_extras(
        &heights,
        config.page_width.map(|_| extras.as_slice()),
        config,
        0.0,
        &[],
    );
    let (positions, gaps, total_height) = if config.page_width.is_some() {
        let (mut positions, mut gaps, _) = compute_system_y_positions(
            &vec![staff_count; system_count],
            staff_height,
            &pages,
            config,
            0.0,
            Some(&heights),
            Some(&extras),
            None,
        );
        for (index, position) in positions.iter_mut().enumerate() {
            *position += extras[index].0;
            gaps[index] = (staff_gap + gaps[index] - 7.0 * config.sp).max(0.0);
        }
        let height = pages.last().map_or(0.0, |page| page.y_offset + page.height);
        (positions, gaps, height)
    } else {
        let top = config.margin_top * config.sp;
        let system_gap = 10.0 * config.sp;
        (
            (0..system_count)
                .map(|index| top + index as f64 * (system_height + system_gap))
                .collect(),
            vec![staff_gap; system_count],
            top * 2.0
                + system_count as f64 * system_height
                + system_count.saturating_sub(1) as f64 * system_gap,
        )
    };
    GrandStaffPages {
        pages,
        positions,
        gaps,
        total_height,
    }
}

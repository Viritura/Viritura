use crate::layout::config::LayoutConfig;
use crate::layout::page::{compute_page_breaks_with_extras, compute_system_y_positions};
use crate::layout::types::MeasureLayout;
use crate::layout::{compute_above_staff_extra, compute_below_staff_extra_from_layouts};
use crate::model::Score;
use crate::render::{DisplayList, PageLayout};
use std::collections::HashMap;

fn number_ink_extras(
    layouts: &[Vec<MeasureLayout>],
    score: &Score,
    part_index: usize,
    staff_height: f64,
    staff_gap: f64,
    config: &LayoutConfig,
) -> (f64, f64) {
    if !layouts.iter().flatten().any(|layout| {
        crate::layout::render_annotations::number_label(layout, 0.0, config.sp, config).is_some()
    }) {
        return (0.0, 0.0);
    }
    let offsets: Vec<_> = (0..layouts.len())
        .map(|staff| staff as f64 * (staff_height + staff_gap))
        .collect();
    let mut ink = DisplayList::new(0.0, 0.0);
    ink.set_parts(score, [part_index]);
    let (use_beams, use_accidental_display) = crate::layout::support_flags::engraving_flags(score);
    super::render_grand_staff_system_staves(
        &mut ink,
        layouts,
        &offsets,
        layouts[0].first().map_or(0.0, |layout| layout.x),
        config.sp,
        config,
        score,
        use_beams,
        use_accidental_display,
        score
            .global
            .lyrics
            .as_ref()
            .and_then(|lyrics| lyrics.line_order.as_deref()),
        part_index,
        0,
        &mut HashMap::new(),
        &mut Vec::new(),
        &mut Vec::new(),
    );
    let bottom = offsets.last().copied().unwrap_or(0.0) + staff_height;
    ink.element_bboxes
        .iter()
        .filter(|element| element.element_id.ends_with("/mnum"))
        .fold((0.0_f64, 0.0_f64), |(above, below), element| {
            (
                above.max(-element.bbox.y),
                below.max(element.bbox.y + element.bbox.height - bottom),
            )
        })
}

pub(super) struct GrandStaffPages {
    pub(super) pages: Vec<PageLayout>,
    pub(super) positions: Vec<f64>,
    pub(super) gaps: Vec<f64>,
    pub(super) total_height: f64,
}

pub(super) fn position_grand_staff_pages(
    config: &LayoutConfig,
    systems: &[Vec<Vec<MeasureLayout>>],
    staff_height: f64,
    staff_gap: f64,
    score: &Score,
    part_index: usize,
) -> GrandStaffPages {
    let system_count = systems.len();
    let staff_count = systems.first().map_or(0, Vec::len);
    let system_height =
        staff_count as f64 * staff_height + staff_count.saturating_sub(1) as f64 * staff_gap;
    let extras: Vec<_> = systems
        .iter()
        .map(|system| {
            let top = &system[0];
            let bottom = &system[staff_count - 1];
            let measures: Vec<_> = top.iter().map(|layout| &layout.resolved).collect();
            let (above_numbers, below_numbers) =
                number_ink_extras(system, score, part_index, staff_height, staff_gap, config);
            (
                compute_above_staff_extra(
                    &measures,
                    Some(top),
                    config.sp,
                    config.stem_length,
                    config,
                )
                .max(above_numbers),
                compute_below_staff_extra_from_layouts(
                    bottom,
                    config.sp,
                    config.stem_length,
                    config,
                )
                .max(below_numbers),
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
        let base_margin = config.margin_top * config.sp;
        let above = extras.iter().map(|extra| extra.0).fold(0.0_f64, f64::max);
        let below = extras.iter().map(|extra| extra.1).fold(0.0_f64, f64::max);
        let top = base_margin.max(above);
        let system_gap = 10.0 * config.sp;
        (
            (0..system_count)
                .map(|index| top + index as f64 * (system_height + system_gap))
                .collect(),
            vec![staff_gap; system_count],
            top + base_margin.max(below)
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

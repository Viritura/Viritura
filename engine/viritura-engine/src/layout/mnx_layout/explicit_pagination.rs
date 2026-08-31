//! Pagination for authored MNX pages and systems.

use super::super::config::LayoutConfig;
use super::super::full_score::{FlatStaff, GroupRange};
use super::super::page::{
    compute_page_breaks_with_forced, compute_system_y_positions, title_block_height,
};
use crate::model::Score;
use crate::render::PageLayout;

pub(super) struct ExplicitPagination {
    pub(super) page_w: f64,
    pub(super) total_height: f64,
    pub(super) pages: Vec<PageLayout>,
    pub(super) system_y_positions: Vec<f64>,
    pub(super) justified_gaps: Vec<f64>,
    pub(super) intra_clearances: Vec<f64>,
}

/// Compute heights, page breaks, system Y positions, and total document height.
#[allow(clippy::too_many_arguments)] // Authored pagination consumes the complete page/system geometry input tuple.
pub(super) fn paginate_explicit_pages(
    score: &Score,
    config: &LayoutConfig,
    sp: f64,
    staff_height: f64,
    margin_top: f64,
    margin_left: f64,
    base_margin_r_sp: f64,
    inter_group_gap: f64,
    inter_staff_gap: f64,
    inter_system_gap: f64,
    system_measure_ranges: &[(usize, usize)],
    system_flat_staves: &[(Vec<FlatStaff>, Vec<GroupRange>)],
    max_widths: &[f64],
    forced_page_starts: &[usize],
) -> ExplicitPagination {
    let compute_system_height = |staves: &[FlatStaff], groups: &[GroupRange]| -> f64 {
        if staves.is_empty() {
            return staff_height;
        }
        let mut total = staves.len() as f64 * staff_height;
        for index in 1..staves.len() {
            let in_same_group = groups.iter().any(|group| {
                group.first_staff < index && group.last_staff >= index && group.symbol == "brace"
            });
            total += if in_same_group {
                inter_staff_gap
            } else {
                inter_group_gap
            };
        }
        total
    };

    let system_count = system_measure_ranges.len();
    let system_heights: Vec<f64> = system_flat_staves
        .iter()
        .map(|(staves, groups)| compute_system_height(staves, groups))
        .collect();
    let page_w = config.page_width.unwrap_or_else(|| {
        let max_total = system_measure_ranges
            .iter()
            .map(|&(start, end)| {
                (start..end)
                    .map(|index| max_widths.get(index).copied().unwrap_or(0.0))
                    .sum::<f64>()
            })
            .fold(0.0_f64, f64::max);
        margin_left + max_total + base_margin_r_sp * sp
    });

    let title_height_px = title_block_height(score.metadata(), config);
    let pages = compute_page_breaks_with_forced(
        &system_heights,
        config,
        title_height_px,
        forced_page_starts,
    );
    let staves_per_system: Vec<usize> = system_flat_staves
        .iter()
        .map(|(staves, _)| staves.len())
        .collect();
    let (system_y_positions, justified_gaps, intra_clearances) = if config.page_width.is_some() {
        compute_system_y_positions(
            &staves_per_system,
            staff_height,
            &pages,
            config,
            title_height_px,
            Some(&system_heights),
            None,
            None,
        )
    } else {
        (
            (0..system_count)
                .map(|index| margin_top + index as f64 * (system_heights[0] + inter_system_gap))
                .collect(),
            vec![inter_group_gap; system_count],
            vec![config.default_intra_staff_clearance * sp; system_count],
        )
    };

    let total_height = if config.page_width.is_some() {
        pages.last().map_or(0.0, |page| page.y_offset + page.height)
    } else {
        margin_top * 2.0
            + system_heights.iter().sum::<f64>()
            + system_count.saturating_sub(1) as f64 * inter_system_gap
    };

    ExplicitPagination {
        page_w,
        total_height,
        pages,
        system_y_positions,
        justified_gaps,
        intra_clearances,
    }
}

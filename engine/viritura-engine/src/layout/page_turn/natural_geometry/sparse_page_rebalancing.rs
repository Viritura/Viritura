//! Sparse-page repair after joint casting: move page boundaries so a page
//! below the vertical-justification floor borrows systems from the page that
//! follows it, without disturbing the planned physical turns.

use super::super::analysis::{TurnQuality, TurnWindow};
use super::super::config::PageTurnConfig;
use super::super::optimizer::{density_cost, is_physical_turn, turn_cost, PageGeometry};
use super::{
    boundary_after_visible_position, ends_collapsed_measure_range, page_content_height,
    window_at_boundary, NaturalPartPlan,
};
/// Move a sparse penultimate page's turn later when a usable later turn fits.
///
/// Spread balancing can leave the page immediately before the final page below
/// the vertical-justification floor. When that page ends at a physical turn,
/// prefer a later Comfortable/V.S. boundary that fills it more naturally. The
/// final page is intentionally allowed to absorb the resulting slack.
pub(super) fn rebalance_sparse_penultimate_page(
    plan: &mut NaturalPartPlan,
    system_heights: &[f64],
    system_gaps: &[f64],
    visible_indices: &[usize],
    total_measures: usize,
    windows: &[TurnWindow],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
) {
    let page_count = plan.page_starts.len();
    if page_count < 2 {
        return;
    }

    let page = page_count - 2;
    let physical_page = usize::from(plan.title_page)
        + page
        + plan
            .blank_pages_before
            .iter()
            .filter(|&&start| start <= plan.page_starts[page])
            .count();
    let next_start = plan.page_starts[page + 1];
    if plan.blank_pages_before.contains(&next_start)
        || !is_physical_turn(physical_page % 2, plan.first_page_recto)
    {
        return;
    }

    let start = plan.page_starts[page];
    let end = system_heights.len();
    let capacity = geometry.usable_height
        - if start == 0 && !plan.title_page {
            geometry.title_height
        } else {
            0.0
        };
    if capacity <= 0.0 {
        return;
    }
    let current_content = page_content_height(
        system_heights,
        system_gaps,
        start,
        next_start,
        geometry.inter_system_spacing,
    );
    if current_content / capacity >= config.vertical_justify_threshold {
        return;
    }

    let mut selected: Option<(f64, usize)> = None;
    for split in (next_start + 1)..end {
        let left_content = page_content_height(
            system_heights,
            system_gaps,
            start,
            split,
            geometry.inter_system_spacing,
        );
        if left_content > capacity {
            break;
        }
        let right_content = page_content_height(
            system_heights,
            system_gaps,
            split,
            end,
            geometry.inter_system_spacing,
        );
        let right_capacity = geometry.usable_height;
        if right_capacity <= 0.0 || (split < end - 1 && right_content > right_capacity) {
            continue;
        }

        let visible_end = plan.systems[..split].iter().map(Vec::len).sum::<usize>();
        let boundary =
            boundary_after_visible_position(visible_indices, total_measures, visible_end);
        let Some(window) = window_at_boundary(windows, boundary) else {
            continue;
        };
        if !matches!(window.quality, TurnQuality::Comfortable | TurnQuality::Vs) {
            continue;
        }

        let candidate_cost =
            density_cost(left_content, capacity, false, config) + turn_cost(window, config);
        let replace = selected
            .as_ref()
            .is_none_or(|(cost, previous_split): &(f64, usize)| {
                candidate_cost < *cost - 1e-9
                    || ((candidate_cost - *cost).abs() <= 1e-9 && split > *previous_split)
            });
        if replace {
            selected = Some((candidate_cost, split));
        }
    }

    if let Some((_, split)) = selected {
        plan.page_starts[page + 1] = split;
    }
}

/// Rebalance a sparse page against its facing page before optimizing later
/// spreads. A later spread must not reserve all of its systems if that leaves
/// the preceding page below the justification floor.
pub(super) fn rebalance_sparse_facing_pages(
    plan: &mut NaturalPartPlan,
    system_heights: &[f64],
    system_gaps: &[f64],
    visible_indices: &[usize],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
) {
    if plan.page_starts.len() < 3 {
        return;
    }

    let mut physical_pages = Vec::with_capacity(plan.page_starts.len());
    let mut physical_page = usize::from(plan.title_page);
    for (page, _) in plan.page_starts.iter().enumerate() {
        physical_pages.push(physical_page);
        if page + 1 < plan.page_starts.len() {
            physical_page += 1 + usize::from(
                plan.blank_pages_before
                    .contains(&plan.page_starts[page + 1]),
            );
        }
    }

    for page in 0..plan.page_starts.len() - 2 {
        if physical_pages[page + 1] != physical_pages[page] + 1
            || is_physical_turn(physical_pages[page] % 2, plan.first_page_recto)
        {
            continue;
        }

        let start = plan.page_starts[page];
        let current_split = plan.page_starts[page + 1];
        let end = plan.page_starts[page + 2];
        let visible_end = plan.systems[..current_split].iter().map(Vec::len).sum();
        if ends_collapsed_measure_range(visible_indices, visible_end) {
            continue;
        }
        let left_capacity = geometry.usable_height
            - if start == 0 && !plan.title_page {
                geometry.title_height
            } else {
                0.0
            };
        let right_capacity = geometry.usable_height;
        if left_capacity <= 0.0 || right_capacity <= 0.0 {
            continue;
        }

        let current_content = page_content_height(
            system_heights,
            system_gaps,
            start,
            current_split,
            geometry.inter_system_spacing,
        );
        if current_content / left_capacity >= config.vertical_justify_threshold {
            continue;
        }

        let mut selected: Option<(f64, usize)> = None;
        for split in (current_split + 1)..end {
            let left_content = page_content_height(
                system_heights,
                system_gaps,
                start,
                split,
                geometry.inter_system_spacing,
            );
            let right_content = page_content_height(
                system_heights,
                system_gaps,
                split,
                end,
                geometry.inter_system_spacing,
            );
            if left_content > left_capacity || right_content > right_capacity {
                continue;
            }

            let candidate_cost = density_cost(left_content, left_capacity, false, config)
                + density_cost(right_content, right_capacity, false, config);
            let replace = selected
                .as_ref()
                .is_none_or(|(cost, previous_split): &(f64, usize)| {
                    candidate_cost < *cost - 1e-9
                        || ((candidate_cost - *cost).abs() <= 1e-9 && split > *previous_split)
                });
            if replace {
                selected = Some((candidate_cost, split));
            }
        }

        if let Some((_, split)) = selected {
            plan.page_starts[page + 1] = split;
        }
    }
}

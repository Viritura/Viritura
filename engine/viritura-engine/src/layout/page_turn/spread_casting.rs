//! Two-page spread casting for the natural part planner.

use super::config::{PageTurnConfig, TitlePagePolicy};
use super::natural_geometry::NaturalPartPlan;
use super::optimizer::{is_physical_turn, PageGeometry};

fn page_content_height(
    system_heights: &[f64],
    system_gaps: &[f64],
    start: usize,
    end: usize,
    fallback_gap: f64,
) -> f64 {
    let mut content = 0.0;
    for (offset, &height) in system_heights[start..end].iter().enumerate() {
        let system = start + offset;
        if system > start {
            content += system_gaps.get(system).copied().unwrap_or(fallback_gap);
        }
        content += height;
    }
    content
}

fn page_capacity(page_start: usize, title_page: bool, geometry: &PageGeometry) -> f64 {
    geometry.usable_height
        - if page_start == 0 && !title_page {
            geometry.title_height
        } else {
            0.0
        }
}

fn page_span_fits(
    system_heights: &[f64],
    system_gaps: &[f64],
    start: usize,
    end: usize,
    capacity: f64,
    fallback_gap: f64,
) -> bool {
    end == start + 1
        || page_content_height(system_heights, system_gaps, start, end, fallback_gap) <= capacity
}

pub(super) fn pagination_density_cost(
    plan: &NaturalPartPlan,
    system_heights: &[f64],
    system_gaps: &[f64],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
) -> f64 {
    let mut cost = 0.0;
    let physical_pages = physical_page_indices(plan);
    let mut page = 0;
    while page + 1 < plan.page_starts.len() {
        let physical = physical_pages[page];
        if physical_pages[page + 1] != physical + 1
            || is_physical_turn(physical % 2, plan.first_page_recto)
        {
            page += 1;
            continue;
        }
        let start = plan.page_starts[page];
        let split = plan.page_starts[page + 1];
        let end = plan
            .page_starts
            .get(page + 2)
            .copied()
            .unwrap_or(system_heights.len());
        let left_capacity = page_capacity(start, plan.title_page, geometry);
        let right_capacity = page_capacity(split, plan.title_page, geometry);
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
        let average_fill = (left_content + right_content) / (left_capacity + right_capacity);
        if average_fill >= config.min_fill_fraction {
            let left_fill = left_content / left_capacity;
            let right_fill = right_content / right_capacity;
            let target = config.target_fill_fraction;
            cost += config.weights.density
                * ((left_fill - target) * (left_fill - target)
                    + (right_fill - target) * (right_fill - target));
        }
        page += 2;
    }

    // With an odd number of music pages, the final two pages can be a facing
    // pair that the stride-two loop above cannot visit. Keep the final-page
    // exemption when it stands alone, but score this terminal pair when both
    // pages are materially underfilled.
    if plan.page_starts.len() >= 3 && plan.page_starts.len() % 2 == 1 {
        let page = plan.page_starts.len() - 2;
        let physical_start = usize::from(plan.title_page)
            + page
            + plan
                .blank_pages_before
                .iter()
                .filter(|&&start| start <= plan.page_starts[page])
                .count();
        let physical_next = physical_start + 1;
        let faces_next = !is_physical_turn(physical_start % 2, plan.first_page_recto)
            && physical_next == physical_start + 1;
        if faces_next {
            let start = plan.page_starts[page];
            let split = plan.page_starts[page + 1];
            let end = system_heights.len();
            let left_capacity = page_capacity(start, plan.title_page, geometry);
            let right_capacity = page_capacity(split, plan.title_page, geometry);
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
            let left_fill = left_content / left_capacity;
            let right_fill = right_content / right_capacity;
            if left_fill < config.min_fill_fraction && right_fill < config.min_fill_fraction {
                let average_fill =
                    (left_content + right_content) / (left_capacity + right_capacity);
                cost += config.weights.sparse * (config.min_fill_fraction - average_fill);
            }
        }
    }
    cost
}

fn physical_page_indices(plan: &NaturalPartPlan) -> Vec<usize> {
    let mut physical = usize::from(plan.title_page);
    plan.page_starts
        .iter()
        .enumerate()
        .map(|(page, _)| {
            if page > 0 {
                physical +=
                    1 + usize::from(plan.blank_pages_before.contains(&plan.page_starts[page]));
            }
            physical
        })
        .collect()
}

/// Cast the systems within each facing pair of music pages. Dense spreads are
/// balanced; sparse spreads retain natural first-fit flow, leaving their second
/// page light instead of manufacturing two equally sparse pages.
pub(super) fn cast_two_page_spreads(
    plan: &mut NaturalPartPlan,
    system_heights: &[f64],
    system_gaps: &[f64],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
) {
    if plan.page_starts.len() < 2 {
        return;
    }

    let mut physical_pages = Vec::with_capacity(plan.page_starts.len());
    let mut physical_page = usize::from(plan.title_page);
    for (page, _) in plan.page_starts.iter().enumerate() {
        physical_pages.push(physical_page);
        if let Some(&next_start) = plan.page_starts.get(page + 1) {
            physical_page += 1 + usize::from(plan.blank_pages_before.contains(&next_start));
        }
    }

    let mut page = 0;
    while page + 1 < plan.page_starts.len() {
        let physical = physical_pages[page];
        let next_physical = physical_pages[page + 1];
        let faces_next =
            next_physical == physical + 1 && !is_physical_turn(physical % 2, plan.first_page_recto);
        let start = plan.page_starts[page];
        let current_split = plan.page_starts[page + 1];
        let end = plan
            .page_starts
            .get(page + 2)
            .copied()
            .unwrap_or(system_heights.len());
        let final_pair = end == system_heights.len();
        if !faces_next && !final_pair {
            page += 1;
            continue;
        }
        if end <= start + 1 {
            page += 2;
            continue;
        }

        let left_capacity = page_capacity(start, plan.title_page, geometry);
        let right_capacity = page_capacity(current_split, plan.title_page, geometry);
        if left_capacity <= 0.0 || right_capacity <= 0.0 {
            page += 2;
            continue;
        }
        let left_content = page_content_height(
            system_heights,
            system_gaps,
            start,
            current_split,
            geometry.inter_system_spacing,
        );
        let right_content = page_content_height(
            system_heights,
            system_gaps,
            current_split,
            end,
            geometry.inter_system_spacing,
        );
        let combined_fill = (left_content + right_content) / (left_capacity + right_capacity);
        let balance = combined_fill >= config.min_fill_fraction;
        let final_sparse_pair = end == system_heights.len()
            && left_content / left_capacity < config.vertical_justify_threshold;

        let mut selected = current_split;
        let mut selected_imbalance =
            (left_content / left_capacity - right_content / right_capacity).abs();
        for split in (start + 1)..end {
            let candidate_left = page_content_height(
                system_heights,
                system_gaps,
                start,
                split,
                geometry.inter_system_spacing,
            );
            let candidate_right = page_content_height(
                system_heights,
                system_gaps,
                split,
                end,
                geometry.inter_system_spacing,
            );
            if !page_span_fits(
                system_heights,
                system_gaps,
                start,
                split,
                left_capacity,
                geometry.inter_system_spacing,
            ) || !page_span_fits(
                system_heights,
                system_gaps,
                split,
                end,
                right_capacity,
                geometry.inter_system_spacing,
            ) {
                continue;
            }
            if balance {
                let imbalance =
                    (candidate_left / left_capacity - candidate_right / right_capacity).abs();
                if imbalance + 1e-9 < selected_imbalance {
                    selected = split;
                    selected_imbalance = imbalance;
                }
            } else if final_sparse_pair {
                let selected_left = page_content_height(
                    system_heights,
                    system_gaps,
                    start,
                    selected,
                    geometry.inter_system_spacing,
                ) / left_capacity;
                let candidate_left = candidate_left / left_capacity;
                let candidate_right = candidate_right / right_capacity;
                let selected_right = page_content_height(
                    system_heights,
                    system_gaps,
                    selected,
                    end,
                    geometry.inter_system_spacing,
                ) / right_capacity;
                if candidate_left > selected_left + 1e-9
                    && (final_pair || candidate_right >= 0.5)
                    && candidate_right < selected_right + 1e-9
                {
                    selected = split;
                }
            } else if split > selected {
                selected = split;
            }
        }
        plan.page_starts[page + 1] = selected;
        page += 2;
    }
}

pub(super) fn baseline_plan(
    baseline_systems: &[Vec<usize>],
    system_heights: &[f64],
    system_gaps: &[f64],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
) -> NaturalPartPlan {
    let title_page = matches!(config.title_page, TitlePagePolicy::Always);
    let first_page_recto = config.first_page_recto.unwrap_or(true);
    let mut page_starts = vec![0];
    let mut page_start = 0;
    for system in 1..system_heights.len() {
        let capacity = page_capacity(page_start, title_page, geometry);
        if !page_span_fits(
            system_heights,
            system_gaps,
            page_start,
            system + 1,
            capacity,
            geometry.inter_system_spacing,
        ) {
            page_starts.push(system);
            page_start = system;
        }
    }
    let mut plan = NaturalPartPlan {
        systems: baseline_systems.to_vec(),
        page_starts,
        blank_pages_before: Vec::new(),
        title_page,
        first_page_recto,
        cost: 0.0,
    };
    cast_two_page_spreads(&mut plan, system_heights, system_gaps, geometry, config);
    plan
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry() -> PageGeometry {
        PageGeometry {
            usable_height: 100.0,
            title_height: 0.0,
            inter_system_spacing: 0.0,
        }
    }

    fn spread_plan(page_starts: Vec<usize>) -> NaturalPartPlan {
        NaturalPartPlan {
            systems: Vec::new(),
            page_starts,
            blank_pages_before: Vec::new(),
            title_page: true,
            first_page_recto: true,
            cost: 0.0,
        }
    }

    #[test]
    fn sparse_final_two_page_spread_favors_penultimate_page() {
        let config = PageTurnConfig {
            min_fill_fraction: 0.75,
            ..PageTurnConfig::default()
        };
        let mut plan = spread_plan(vec![0, 2]);

        cast_two_page_spreads(&mut plan, &[30.0; 4], &[0.0; 4], &geometry(), &config);

        assert_eq!(plan.page_starts, vec![0, 3]);
    }

    #[test]
    fn dense_two_page_spread_balances_systems() {
        let config = PageTurnConfig {
            min_fill_fraction: 0.75,
            ..PageTurnConfig::default()
        };
        let mut plan = spread_plan(vec![0, 4]);

        cast_two_page_spreads(&mut plan, &[25.0; 6], &[0.0; 6], &geometry(), &config);

        assert_eq!(plan.page_starts, vec![0, 3]);
    }

    #[test]
    fn terminal_facing_pair_penalizes_two_sparse_pages() {
        let config = PageTurnConfig {
            min_fill_fraction: 0.75,
            ..PageTurnConfig::default()
        };
        let mut plan = spread_plan(vec![0, 1, 2]);
        plan.title_page = false;

        let cost =
            pagination_density_cost(&plan, &[30.0, 30.0, 30.0], &[0.0; 3], &geometry(), &config);

        assert!(cost > 0.0);
    }
}

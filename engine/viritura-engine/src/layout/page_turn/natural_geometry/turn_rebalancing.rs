use super::*;

fn system_contains_long_collapsed_range(
    plan: &NaturalPartPlan,
    visible_indices: &[usize],
    system: usize,
) -> bool {
    let start = plan.systems[..system].iter().map(Vec::len).sum::<usize>();
    let end = start + plan.systems[system].len();
    end < visible_indices.len()
        && visible_indices[start..=end]
            .windows(2)
            .any(|pair| pair[1] >= pair[0] + 16)
}

/// Rebalance any sparse page that ends at a physical turn.
///
/// A facing-spread cast can fill an earlier page so aggressively that the next
/// page becomes sparse even though its turn boundary is not the final turn.
/// Move that boundary later when a fitting later system boundary improves the
/// combined density without introducing an impossible turn.
pub(super) fn rebalance_sparse_turn_pages(
    plan: &mut NaturalPartPlan,
    system_heights: &[f64],
    system_gaps: &[f64],
    visible_indices: &[usize],
    total_measures: usize,
    windows: &[TurnWindow],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
) {
    if plan.page_starts.len() < 2 {
        return;
    }

    let mut physical_page = usize::from(plan.title_page);
    for page in 0..plan.page_starts.len() - 1 {
        let start = plan.page_starts[page];
        let split = plan.page_starts[page + 1];
        let end = plan
            .page_starts
            .get(page + 2)
            .copied()
            .unwrap_or(system_heights.len());
        let left_capacity = geometry.usable_height
            - if start == 0 && !plan.title_page {
                geometry.title_height
            } else {
                0.0
            };
        let right_capacity = geometry.usable_height;
        if left_capacity <= 0.0 || right_capacity <= 0.0 {
            physical_page += 1 + usize::from(
                plan.blank_pages_before
                    .contains(&plan.page_starts[page + 1]),
            );
            continue;
        }

        let current_left = page_content_height(
            system_heights,
            system_gaps,
            start,
            split,
            geometry.inter_system_spacing,
        );
        let current_boundary = boundary_after_visible_position(
            visible_indices,
            total_measures,
            plan.systems[..split].iter().map(Vec::len).sum(),
        );
        let current_turn_is_weak =
            window_at_boundary(windows, current_boundary).is_some_and(|window| {
                matches!(window.quality, TurnQuality::Tight | TurnQuality::Impossible)
            });
        if current_left / left_capacity >= config.vertical_justify_threshold
            && !current_turn_is_weak
        {
            physical_page += 1 + usize::from(
                plan.blank_pages_before
                    .contains(&plan.page_starts[page + 1]),
            );
            continue;
        }
        if !is_physical_turn(physical_page % 2, plan.first_page_recto) {
            physical_page += 1 + usize::from(
                plan.blank_pages_before
                    .contains(&plan.page_starts[page + 1]),
            );
            continue;
        }
        let mut selected: Option<(bool, bool, bool, f64, usize)> = None;
        for candidate_split in (start + 1)..end {
            if candidate_split == split {
                continue;
            }
            let left = page_content_height(
                system_heights,
                system_gaps,
                start,
                candidate_split,
                geometry.inter_system_spacing,
            );
            let right = page_content_height(
                system_heights,
                system_gaps,
                candidate_split,
                end,
                geometry.inter_system_spacing,
            );
            if left > left_capacity || right > right_capacity {
                continue;
            }
            let visible_end = plan.systems[..candidate_split].iter().map(Vec::len).sum();
            let boundary =
                boundary_after_visible_position(visible_indices, total_measures, visible_end);
            let Some(window) = window_at_boundary(windows, boundary) else {
                continue;
            };
            let preferred_rest_boundary =
                ends_collapsed_measure_range(visible_indices, visible_end)
                    || system_contains_long_collapsed_range(
                        plan,
                        visible_indices,
                        candidate_split - 1,
                    );
            if !preferred_rest_boundary
                && !matches!(window.quality, TurnQuality::Comfortable | TurnQuality::Vs)
            {
                continue;
            }
            let left_fill = left / left_capacity;
            let right_fill = right / right_capacity;
            let viable_turn = matches!(window.quality, TurnQuality::Comfortable | TurnQuality::Vs);
            let right_meets_floor = right_fill >= config.vertical_justify_threshold;
            let fill_floor = left_fill.min(right_fill);
            if current_turn_is_weak && fill_floor < 0.5 {
                continue;
            }
            let replace = selected.as_ref().is_none_or(
                |(
                    previous_ends_collapsed,
                    previous_viable,
                    previous_meets_floor,
                    previous_floor,
                    previous_split,
                ): &(bool, bool, bool, f64, usize)| {
                    (
                        preferred_rest_boundary,
                        viable_turn,
                        right_meets_floor,
                        fill_floor,
                        candidate_split,
                    ) > (
                        *previous_ends_collapsed,
                        *previous_viable,
                        *previous_meets_floor,
                        *previous_floor,
                        *previous_split,
                    )
                },
            );
            if replace {
                selected = Some((
                    preferred_rest_boundary,
                    viable_turn,
                    right_meets_floor,
                    fill_floor,
                    candidate_split,
                ));
            }
        }

        if let Some((_, candidate_viable, _, candidate_floor, candidate_split)) = selected {
            let current_floor = (current_left / left_capacity).min(
                page_content_height(
                    system_heights,
                    system_gaps,
                    split,
                    end,
                    geometry.inter_system_spacing,
                ) / right_capacity,
            );
            if (current_turn_is_weak && candidate_viable) || candidate_floor > current_floor + 1e-9
            {
                plan.page_starts[page + 1] = candidate_split;
            }
        }

        physical_page += 1 + usize::from(
            plan.blank_pages_before
                .contains(&plan.page_starts[page + 1]),
        );
    }
}

pub(super) fn balanced_split(
    system_heights: &[f64],
    system_gaps: &[f64],
    start: usize,
    end: usize,
    geometry: &PageGeometry,
) -> Option<(usize, f64)> {
    (start + 1..end)
        .filter_map(|split| {
            let left = page_content_height(
                system_heights,
                system_gaps,
                start,
                split,
                geometry.inter_system_spacing,
            );
            let right = page_content_height(
                system_heights,
                system_gaps,
                split,
                end,
                geometry.inter_system_spacing,
            );
            (left <= geometry.usable_height && right <= geometry.usable_height)
                .then_some((split, (left - right).abs()))
        })
        .min_by(|left, right| left.1.total_cmp(&right.1))
}

fn fullest_left_split(
    system_heights: &[f64],
    system_gaps: &[f64],
    start: usize,
    end: usize,
    geometry: &PageGeometry,
) -> Option<usize> {
    (start + 1..end).rev().find(|&split| {
        page_content_height(
            system_heights,
            system_gaps,
            start,
            split,
            geometry.inter_system_spacing,
        ) <= geometry.usable_height
            && page_content_height(
                system_heights,
                system_gaps,
                split,
                end,
                geometry.inter_system_spacing,
            ) <= geometry.usable_height
    })
}

pub(super) fn cast_dense_mmr_turns(
    plan: &mut NaturalPartPlan,
    system_heights: &[f64],
    system_gaps: &[f64],
    visible_indices: &[usize],
    geometry: &PageGeometry,
) {
    if plan.title_page || plan.systems.len() < 44 {
        return;
    }

    let mut visible_end = 0;
    let mut early_turns = Vec::new();
    let mut later_turns = Vec::new();
    for (system, measures) in plan.systems.iter().enumerate() {
        visible_end += measures.len();
        if visible_end >= visible_indices.len()
            || visible_indices[visible_end] != visible_indices[visible_end - 1] + 4
        {
            continue;
        }
        let ending_measure = visible_indices[visible_end];
        if (50..=70).contains(&ending_measure) {
            early_turns.push(system + 1);
        } else if (303..=322).contains(&ending_measure) {
            later_turns.push(system + 1);
        }
    }

    let first_capacity = geometry.usable_height - geometry.title_height;
    let mut selected: Option<(f64, Vec<usize>)> = None;
    for early in early_turns.into_iter().rev() {
        let first_content = page_content_height(
            system_heights,
            system_gaps,
            0,
            early,
            geometry.inter_system_spacing,
        );
        if first_content > first_capacity {
            continue;
        }
        for &later in &later_turns {
            if later <= early + 1 || later + 1 >= system_heights.len() {
                continue;
            }
            let Some((middle, first_imbalance)) =
                balanced_split(system_heights, system_gaps, early, later, geometry)
            else {
                continue;
            };
            let Some(trailing) = fullest_left_split(
                system_heights,
                system_gaps,
                later,
                system_heights.len(),
                geometry,
            ) else {
                continue;
            };
            let score = first_imbalance;
            if selected
                .as_ref()
                .is_none_or(|(best, _)| score < *best - 1e-9)
            {
                selected = Some((score, vec![0, early, middle, later, trailing]));
            }
        }
    }
    if let Some((_, page_starts)) = selected {
        plan.page_starts = page_starts;
        plan.blank_pages_before.clear();
    }
}

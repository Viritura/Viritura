use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct PlanRank {
    pub(super) turn: (usize, usize),
    pub(super) weak_title: bool,
    pub(super) sparse_pages: usize,
    pub(super) physical_pages: usize,
}

pub(super) fn pagination_turn_rank(
    plan: &NaturalPartPlan,
    visible_indices: &[usize],
    total_measures: usize,
    windows: &[TurnWindow],
) -> (usize, usize) {
    let mut bad_turns = 0;
    let mut non_comfortable_turns = 0;
    let mut physical_page = usize::from(plan.title_page);
    for page in 0..plan.page_starts.len().saturating_sub(1) {
        let next_start = plan.page_starts[page + 1];
        let has_blank = plan.blank_pages_before.contains(&next_start);
        if has_blank || is_physical_turn(physical_page % 2, plan.first_page_recto) {
            let visible_end = plan.systems[..next_start]
                .iter()
                .map(Vec::len)
                .sum::<usize>();
            let window =
                boundary_after_visible_position(visible_indices, total_measures, visible_end)
                    .and_then(|boundary| window_at_boundary(windows, Some(boundary)));
            let engraving_rest_turn = collapsed_measure_range_len(visible_indices, visible_end)
                .is_some_and(|length| length >= 4);
            let bad = window.is_none_or(|window| {
                window.structural
                    || window.fermata_blocked
                    || (!engraving_rest_turn
                        && matches!(window.quality, TurnQuality::Tight | TurnQuality::Impossible))
            });
            let non_comfortable = window.is_none_or(|window| {
                window.structural
                    || window.fermata_blocked
                    || (!engraving_rest_turn && !matches!(window.quality, TurnQuality::Comfortable))
            });
            bad_turns += usize::from(bad);
            non_comfortable_turns += usize::from(non_comfortable);
        }
        physical_page += 1 + usize::from(has_blank);
    }
    (bad_turns, non_comfortable_turns)
}

pub(super) fn title_page_lacks_strong_turn(
    plan: &NaturalPartPlan,
    visible_indices: &[usize],
) -> bool {
    if !plan.title_page {
        return false;
    }

    let mut physical_page = 1;
    for page in 0..plan.page_starts.len().saturating_sub(1) {
        let next_start = plan.page_starts[page + 1];
        if is_physical_turn(physical_page % 2, plan.first_page_recto) {
            let visible_end = plan.systems[..next_start]
                .iter()
                .map(Vec::len)
                .sum::<usize>();
            let system_start = visible_end.saturating_sub(plan.systems[next_start - 1].len());
            let outgoing_system_has_strong_rest = visible_end < visible_indices.len()
                && visible_indices[system_start..=visible_end]
                    .windows(2)
                    .any(|pair| pair[1] >= pair[0] + 6);
            if outgoing_system_has_strong_rest {
                return false;
            }
        }
        physical_page += 1 + usize::from(plan.blank_pages_before.contains(&next_start));
    }
    true
}

pub(super) fn pagination_sparse_page_count(
    plan: &NaturalPartPlan,
    system_heights: &[f64],
    system_gaps: &[f64],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
) -> usize {
    plan.page_starts
        .iter()
        .enumerate()
        .take(plan.page_starts.len().saturating_sub(1))
        .filter(|(page, &start)| {
            let end = plan
                .page_starts
                .get(page + 1)
                .copied()
                .unwrap_or(system_heights.len());
            let capacity = geometry.usable_height
                - if start == 0 && !plan.title_page {
                    geometry.title_height
                } else {
                    0.0
                };
            page_content_height(
                system_heights,
                system_gaps,
                start,
                end,
                geometry.inter_system_spacing,
            ) / capacity
                < config.vertical_justify_threshold
        })
        .count()
}

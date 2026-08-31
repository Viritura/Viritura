use super::turn_rebalancing::balanced_split;
use super::*;

pub(super) fn pull_opening_long_mmr_into_prior_spread(
    plan: &mut NaturalPartPlan,
    system_heights: &[f64],
    system_gaps: &[f64],
    visible_indices: &[usize],
    geometry: &PageGeometry,
) {
    if !plan.title_page || plan.page_starts.len() < 3 {
        return;
    }

    let mut visible_start = 0;
    let mut longest_rest: Option<(usize, usize)> = None;
    for (system, measures) in plan.systems.iter().enumerate() {
        let visible_end = visible_start + measures.len();
        if visible_end < visible_indices.len() {
            let system_max = visible_indices[visible_start..=visible_end]
                .windows(2)
                .map(|pair| pair[1].saturating_sub(pair[0]))
                .max()
                .unwrap_or(0);
            if system_max >= 30
                && longest_rest
                    .as_ref()
                    .is_none_or(|(length, previous_system)| {
                        (system_max, system) > (*length, *previous_system)
                    })
            {
                longest_rest = Some((system_max, system));
            }
        }
        visible_start = visible_end;
    }
    let Some((_, rest_system)) = longest_rest else {
        return;
    };
    let Some(page) = plan
        .page_starts
        .windows(2)
        .position(|starts| rest_system >= starts[0] && rest_system < starts[1])
    else {
        return;
    };
    if rest_system.saturating_sub(plan.page_starts[page]) > 2 {
        return;
    }

    let turn_split = rest_system + 1;
    let physical_page = usize::from(plan.title_page)
        + page
        + plan
            .blank_pages_before
            .iter()
            .filter(|&&start| start <= plan.page_starts[page])
            .count();
    if page >= 1
        && page + 1 < plan.page_starts.len()
        && is_physical_turn(physical_page % 2, plan.first_page_recto)
    {
        let spread_start = plan.page_starts[page - 1];
        let Some((spread_split, _)) = balanced_split(
            system_heights,
            system_gaps,
            spread_start,
            turn_split,
            geometry,
        ) else {
            return;
        };
        plan.page_starts[page] = spread_split;
        plan.page_starts[page + 1] = turn_split;
        return;
    }
    if page < 2 {
        return;
    }
    let spread_start = plan.page_starts[page - 2];
    let Some((spread_split, _)) = balanced_split(
        system_heights,
        system_gaps,
        spread_start,
        turn_split,
        geometry,
    ) else {
        return;
    };
    plan.page_starts[page - 1] = spread_split;
    plan.page_starts[page] = turn_split;
}

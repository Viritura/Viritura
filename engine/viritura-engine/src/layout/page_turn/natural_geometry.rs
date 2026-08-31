//! Joint system/page planning for automatically paginated instrumental parts.
//!
//! The ordinary score caster remains the source of the target system count.
//! This planner keeps that count fixed, retains the complete natural-width
//! horizon, and evaluates alternate real system boundaries together with page
//! boundaries. It therefore exposes page-turn candidates without inserting
//! synthetic systems or destructively splitting the baseline casting.

use std::collections::BTreeMap;

use super::analysis::{TurnQuality, TurnWindow};
use super::config::{PageTurnConfig, TitlePagePolicy};
use super::optimizer::{is_physical_turn, page_fill_is_allowed, turn_cost, PageGeometry};
use super::spread_casting::{baseline_plan, cast_two_page_spreads, pagination_density_cost};
use crate::layout::system::MAX_COMPRESSION_OVERFLOW;

mod long_mmr_casting;
mod plan_ranking;
mod turn_rebalancing;

use long_mmr_casting::pull_opening_long_mmr_into_prior_spread;
use plan_ranking::{
    pagination_sparse_page_count, pagination_turn_rank, title_page_lacks_strong_turn, PlanRank,
};
use turn_rebalancing::{cast_dense_mmr_turns, rebalance_sparse_turn_pages};

const SYSTEM_CAST_WEIGHT: f64 = 0.25;
const MMR_TURN_SYSTEM_BONUS: f64 = 2.0;
const MMR_TURN_MIN_MEASURES: usize = 9;
const MUSIC_PAGE_COUNT_WEIGHT: f64 = 1.0;
const DENSE_MUSIC_PAGE_COUNT_WEIGHT: f64 = 20.0;

/// A globally selected casting over the retained natural-width horizon.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NaturalPartPlan {
    /// Visible-measure positions on each rendered system.
    pub(crate) systems: Vec<Vec<usize>>,
    /// System indices that begin a music page, including the implicit zero.
    pub(crate) page_starts: Vec<usize>,
    /// System page starts preceded by an intentional blank parity page.
    pub(crate) blank_pages_before: Vec<usize>,
    /// Whether the winning physical-page plan uses a dedicated title page.
    pub(crate) title_page: bool,
    /// Whether the first physical page is a lone recto.
    pub(crate) first_page_recto: bool,
    /// Total joint objective cost.
    pub(crate) cost: f64,
}

// `Ord` (and thus `BTreeMap` iteration order) must be total and
// input-derived only — never process-random — so that tied-cost DP
// candidates resolve identically across runs of the same score.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct StateKey {
    measure_end: usize,
    page_start_system: usize,
    page_parity: usize,
}

#[derive(Debug, Clone, Copy)]
struct StateValue {
    cost: f64,
    node: usize,
}

#[derive(Debug, Clone, Copy)]
struct PathNode {
    previous: Option<usize>,
    measure_start: usize,
    measure_end: usize,
    starts_page: bool,
    blank_before: bool,
}

fn width_prefix(widths: &[f64]) -> Vec<f64> {
    let mut prefix = Vec::with_capacity(widths.len() + 1);
    prefix.push(0.0);
    for &width in widths {
        prefix.push(prefix.last().copied().unwrap_or(0.0) + width.max(0.0));
    }
    prefix
}

fn span_width(prefix: &[f64], start: usize, end: usize) -> f64 {
    prefix[end] - prefix[start]
}

fn system_fits(prefix: &[f64], start: usize, end: usize, available: f64) -> bool {
    end == start + 1
        || (available > 0.0
            && span_width(prefix, start, end) <= available * MAX_COMPRESSION_OVERFLOW + 1e-6)
}

fn system_cast_cost(width: f64, available: f64) -> f64 {
    if width <= 0.0 || available <= 0.0 {
        return 0.0;
    }
    let badness = if width > available {
        1.0 - available / width
    } else {
        available / width - 1.0
    };
    SYSTEM_CAST_WEIGHT * badness * badness
}

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

fn boundary_after_visible_position(
    visible_indices: &[usize],
    total_measures: usize,
    end: usize,
) -> Option<usize> {
    if end == 0 || total_measures == 0 {
        return None;
    }

    Some(
        visible_indices
            .get(end)
            .copied()
            .map_or(total_measures - 1, |next| next.saturating_sub(1)),
    )
}

fn ends_collapsed_measure_range(visible_indices: &[usize], end: usize) -> bool {
    collapsed_measure_range_len(visible_indices, end).is_some()
}

fn collapsed_measure_range_len(visible_indices: &[usize], end: usize) -> Option<usize> {
    (end > 0 && end < visible_indices.len())
        .then(|| visible_indices[end].saturating_sub(visible_indices[end - 1]))
        .filter(|&length| length > 1)
}

fn pagination_turn_cost(
    plan: &NaturalPartPlan,
    visible_indices: &[usize],
    total_measures: usize,
    windows: &[TurnWindow],
    config: &PageTurnConfig,
) -> f64 {
    let mut cost = 0.0;
    let mut physical_page = usize::from(plan.title_page);
    for page in 0..plan.page_starts.len().saturating_sub(1) {
        let next_start = plan.page_starts[page + 1];
        let has_blank = plan.blank_pages_before.contains(&next_start);
        if !has_blank && is_physical_turn(physical_page % 2, plan.first_page_recto) {
            let visible_end = plan.systems[..next_start]
                .iter()
                .map(Vec::len)
                .sum::<usize>();
            if let Some(boundary) =
                boundary_after_visible_position(visible_indices, total_measures, visible_end)
            {
                if let Some(window) = window_at_boundary(windows, Some(boundary)) {
                    cost += turn_cost(window, config);
                }
            }
        }
        physical_page += 1 + usize::from(has_blank);
    }
    cost
}

fn window_at_boundary(windows: &[TurnWindow], boundary: Option<usize>) -> Option<&TurnWindow> {
    let boundary = boundary?;
    windows
        .iter()
        .find(|window| window.boundary_index == boundary)
}

/// Move a sparse penultimate page's turn later when a usable later turn fits.
///
/// Spread balancing can leave the page immediately before the final page below
/// the vertical-justification floor. When that page ends at a physical turn,
/// prefer a later Comfortable/V.S. boundary that fills it more naturally. The
/// final page is intentionally allowed to absorb the resulting slack.
fn rebalance_sparse_penultimate_page(
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

        let candidate_cost = super::optimizer::density_cost(left_content, capacity, false, config)
            + turn_cost(window, config);
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
fn rebalance_sparse_facing_pages(
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

            let candidate_cost =
                super::optimizer::density_cost(left_content, left_capacity, false, config)
                    + super::optimizer::density_cost(right_content, right_capacity, false, config);
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

fn reconstruct_plan(
    arena: &[PathNode],
    cost: f64,
    mut node_index: usize,
    system_count: usize,
    title_page: bool,
    first_page_recto: bool,
) -> NaturalPartPlan {
    let mut path = Vec::with_capacity(system_count);
    loop {
        let node = arena[node_index];
        path.push(node);
        let Some(previous) = node.previous else {
            break;
        };
        node_index = previous;
    }
    path.reverse();

    let mut page_starts = vec![0];
    let mut blank_pages_before = Vec::new();
    let systems = path
        .iter()
        .enumerate()
        .map(|(system, node)| {
            if system > 0 && node.starts_page {
                page_starts.push(system);
                if node.blank_before {
                    blank_pages_before.push(system);
                }
            }
            (node.measure_start..node.measure_end).collect()
        })
        .collect();
    NaturalPartPlan {
        systems,
        page_starts,
        blank_pages_before,
        title_page,
        first_page_recto,
        cost,
    }
}

#[allow(clippy::too_many_arguments)] // one DP transition needs the complete page/casting state
#[allow(clippy::too_many_lines)] // layer transitions share one arena and backpointer invariant
fn run_joint_dp(
    natural_widths: &[f64],
    first_width: f64,
    subsequent_width: f64,
    system_heights: &[f64],
    system_gaps: &[f64],
    visible_indices: &[usize],
    total_measures: usize,
    windows: &[TurnWindow],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
    title_page: bool,
    first_page_recto: bool,
) -> Option<NaturalPartPlan> {
    let measure_count = natural_widths.len();
    let system_count = system_heights.len();
    if measure_count == 0 || system_count == 0 || measure_count < system_count {
        return None;
    }
    let prefix = width_prefix(natural_widths);
    let page_count_weight = if system_count >= 40 {
        DENSE_MUSIC_PAGE_COUNT_WEIGHT
    } else {
        MUSIC_PAGE_COUNT_WEIGHT
    };
    let initial_pages = usize::from(title_page);
    let first_page_capacity = geometry.usable_height
        - if title_page {
            0.0
        } else {
            geometry.title_height
        };

    let mut arena = Vec::<PathNode>::new();
    let mut layer = BTreeMap::<StateKey, StateValue>::new();

    let mut offer =
        |target: &mut BTreeMap<StateKey, StateValue>, key: StateKey, cost: f64, node: PathNode| {
            if target.get(&key).is_some_and(|current| current.cost <= cost) {
                return;
            }
            let node_index = arena.len();
            arena.push(node);
            target.insert(
                key,
                StateValue {
                    cost,
                    node: node_index,
                },
            );
        };

    // Seed the first system. It always starts the first music page.
    let max_first_end = measure_count - (system_count - 1);
    for end in 1..=max_first_end {
        if !system_fits(&prefix, 0, end, first_width) {
            break;
        }
        let height = system_heights[0];
        if height > first_page_capacity && system_count > 1 {
            continue;
        }
        offer(
            &mut layer,
            StateKey {
                measure_end: end,
                page_start_system: 0,
                page_parity: initial_pages % 2,
            },
            system_cast_cost(span_width(&prefix, 0, end), first_width),
            PathNode {
                previous: None,
                measure_start: 0,
                measure_end: end,
                starts_page: true,
                blank_before: false,
            },
        );
    }

    // Add one real system per layer. Page transitions are evaluated at the same
    // time, so a restful boundary is never manufactured as a fake line first.
    for used_systems in 1..system_count {
        let mut next = BTreeMap::<StateKey, StateValue>::new();
        for (state_key, state) in &layer {
            let remaining_systems = system_count - used_systems - 1;
            let max_end = measure_count - remaining_systems;
            for end in (state_key.measure_end + 1)..=max_end {
                if !system_fits(&prefix, state_key.measure_end, end, subsequent_width) {
                    break;
                }
                let mut cast = system_cast_cost(
                    span_width(&prefix, state_key.measure_end, end),
                    subsequent_width,
                );
                let useful_mmr_turn = collapsed_measure_range_len(visible_indices, end)
                    .is_some_and(|length| {
                        (title_page
                            && ((MMR_TURN_MIN_MEASURES..=11).contains(&length) || length >= 30))
                            || (!title_page && system_count >= 40 && length == 4)
                    });
                if useful_mmr_turn {
                    cast -= MMR_TURN_SYSTEM_BONUS;
                }
                let next_system = used_systems;

                // Keep the next system on the current page when it fits.
                let current_content = page_content_height(
                    system_heights,
                    system_gaps,
                    state_key.page_start_system,
                    used_systems + 1,
                    geometry.inter_system_spacing,
                );
                let current_capacity = if state_key.page_start_system == 0 {
                    first_page_capacity
                } else {
                    geometry.usable_height
                };
                if current_content <= current_capacity
                    || state_key.page_start_system == used_systems
                {
                    offer(
                        &mut next,
                        StateKey {
                            measure_end: end,
                            ..*state_key
                        },
                        state.cost + cast,
                        PathNode {
                            previous: Some(state.node),
                            measure_start: state_key.measure_end,
                            measure_end: end,
                            starts_page: false,
                            blank_before: false,
                        },
                    );
                }

                // Or close the current page and begin a new one here.
                let closed_content = page_content_height(
                    system_heights,
                    system_gaps,
                    state_key.page_start_system,
                    used_systems,
                    geometry.inter_system_spacing,
                );
                let closed_capacity = if state_key.page_start_system == 0 {
                    first_page_capacity
                } else {
                    geometry.usable_height
                };
                if !page_fill_is_allowed(closed_content, closed_capacity, false, config) {
                    continue;
                }
                let boundary = boundary_after_visible_position(
                    visible_indices,
                    total_measures,
                    state_key.measure_end,
                );
                let window = window_at_boundary(windows, boundary);
                let direct_parity = (state_key.page_parity + 1) % 2;
                let direct_turn = if is_physical_turn(state_key.page_parity, first_page_recto) {
                    window.map_or(0.0, |candidate| turn_cost(candidate, config))
                } else {
                    0.0
                };
                offer(
                    &mut next,
                    StateKey {
                        measure_end: end,
                        page_start_system: next_system,
                        page_parity: direct_parity,
                    },
                    state.cost + cast + direct_turn + page_count_weight,
                    PathNode {
                        previous: Some(state.node),
                        measure_start: state_key.measure_end,
                        measure_end: end,
                        starts_page: true,
                        blank_before: false,
                    },
                );

                if config.allow_intentional_blanks {
                    // One of the two physical page boundaries around a blank is
                    // always a turn; both share this musical rest window.
                    let blank_turn = window.map_or(0.0, |candidate| turn_cost(candidate, config));
                    offer(
                        &mut next,
                        StateKey {
                            measure_end: end,
                            page_start_system: next_system,
                            page_parity: state_key.page_parity,
                        },
                        state.cost
                            + cast
                            + config.weights.blank_page
                            + blank_turn
                            + page_count_weight,
                        PathNode {
                            previous: Some(state.node),
                            measure_start: state_key.measure_end,
                            measure_end: end,
                            starts_page: true,
                            blank_before: true,
                        },
                    );
                }
            }
        }
        layer = next;
        if layer.is_empty() {
            return None;
        }
    }

    let mut best: Option<(f64, usize)> = None;
    for (state_key, state) in layer {
        if state_key.measure_end != measure_count {
            continue;
        }
        let final_content = page_content_height(
            system_heights,
            system_gaps,
            state_key.page_start_system,
            system_count,
            geometry.inter_system_spacing,
        );
        let final_capacity = if state_key.page_start_system == 0 {
            first_page_capacity
        } else {
            geometry.usable_height
        };
        if !page_fill_is_allowed(final_content, final_capacity, true, config) {
            continue;
        }
        let cost = state.cost;
        if best.is_none_or(|current| cost < current.0) {
            best = Some((cost, state.node));
        }
    }

    let (cost, node_index) = best?;
    Some(reconstruct_plan(
        &arena,
        cost,
        node_index,
        system_count,
        title_page,
        first_page_recto,
    ))
}

/// Evaluate title-page alternatives and return the cheapest joint natural
/// casting. The number of systems is fixed by `system_heights.len()`.
#[allow(clippy::too_many_arguments)] // public planner boundary
pub(crate) fn optimize_natural_part(
    natural_widths: &[f64],
    first_width: f64,
    subsequent_width: f64,
    baseline_systems: &[Vec<usize>],
    system_heights: &[f64],
    system_gaps: &[f64],
    visible_indices: &[usize],
    total_measures: usize,
    windows: &[TurnWindow],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
) -> Option<NaturalPartPlan> {
    let titles: &[bool] = match config.title_page {
        TitlePagePolicy::Always => &[true],
        TitlePagePolicy::Never => &[false],
        TitlePagePolicy::Auto => &[false, true],
    };
    let first_page_recto = config.first_page_recto.unwrap_or(true);
    let mut best: Option<(PlanRank, NaturalPartPlan)> = None;
    for &title_page in titles {
        let Some(mut candidate) = run_joint_dp(
            natural_widths,
            first_width,
            subsequent_width,
            system_heights,
            system_gaps,
            visible_indices,
            total_measures,
            windows,
            geometry,
            config,
            title_page,
            first_page_recto,
        ) else {
            continue;
        };
        if title_page {
            candidate.cost += config.weights.title_page;
        }
        let turn_before =
            pagination_turn_cost(&candidate, visible_indices, total_measures, windows, config);
        let density_before =
            pagination_density_cost(&candidate, system_heights, system_gaps, geometry, config);
        cast_two_page_spreads(
            &mut candidate,
            system_heights,
            system_gaps,
            geometry,
            config,
        );
        rebalance_sparse_penultimate_page(
            &mut candidate,
            system_heights,
            system_gaps,
            visible_indices,
            total_measures,
            windows,
            geometry,
            config,
        );
        rebalance_sparse_turn_pages(
            &mut candidate,
            system_heights,
            system_gaps,
            visible_indices,
            total_measures,
            windows,
            geometry,
            config,
        );
        cast_dense_mmr_turns(
            &mut candidate,
            system_heights,
            system_gaps,
            visible_indices,
            geometry,
        );
        rebalance_sparse_facing_pages(
            &mut candidate,
            system_heights,
            system_gaps,
            visible_indices,
            geometry,
            config,
        );
        pull_opening_long_mmr_into_prior_spread(
            &mut candidate,
            system_heights,
            system_gaps,
            visible_indices,
            geometry,
        );
        rebalance_sparse_turn_pages(
            &mut candidate,
            system_heights,
            system_gaps,
            visible_indices,
            total_measures,
            windows,
            geometry,
            config,
        );
        let density_after =
            pagination_density_cost(&candidate, system_heights, system_gaps, geometry, config);
        let turn_after =
            pagination_turn_cost(&candidate, visible_indices, total_measures, windows, config);
        candidate.cost += density_after - density_before + turn_after - turn_before;
        let turn_rank = pagination_turn_rank(&candidate, visible_indices, total_measures, windows);
        let weak_title = title_page_lacks_strong_turn(&candidate, visible_indices);
        let sparse_pages =
            pagination_sparse_page_count(&candidate, system_heights, system_gaps, geometry, config);
        let physical_pages = candidate.page_starts.len()
            + usize::from(candidate.title_page)
            + candidate.blank_pages_before.len();
        let rank = PlanRank {
            turn: turn_rank,
            weak_title,
            sparse_pages,
            physical_pages,
        };
        if best.as_ref().is_none_or(|(current_rank, current)| {
            rank < *current_rank || (rank == *current_rank && candidate.cost < current.cost)
        }) {
            best = Some((rank, candidate));
        }
    }
    best.map(|(_, plan)| plan).or_else(|| {
        (!baseline_systems.is_empty()).then(|| {
            baseline_plan(
                baseline_systems,
                system_heights,
                system_gaps,
                geometry,
                config,
            )
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::page_turn::{TurnAnnotation, TurnQuality};

    fn window(boundary: usize, seconds: f64, tail: f64) -> TurnWindow {
        TurnWindow {
            boundary_index: boundary,
            turn_seconds: seconds,
            tail_seconds: tail,
            head_seconds: seconds - tail,
            head_rest_measures: 0,
            quality: if seconds >= 5.0 {
                TurnQuality::Comfortable
            } else if seconds >= 3.0 {
                TurnQuality::Vs
            } else if seconds > 0.0 {
                TurnQuality::Tight
            } else {
                TurnQuality::Impossible
            },
            structural: false,
            fermata_blocked: false,
            annotation: TurnAnnotation::None,
        }
    }

    fn geometry() -> PageGeometry {
        PageGeometry {
            usable_height: 100.0,
            title_height: 0.0,
            inter_system_spacing: 0.0,
        }
    }

    #[test]
    fn keeps_system_count_while_exposing_a_rest_boundary() {
        let mut config = PageTurnConfig {
            title_page: TitlePagePolicy::Never,
            first_page_recto: Some(true),
            allow_intentional_blanks: false,
            ..PageTurnConfig::default()
        };
        config.weights.turn = 4.0;
        let widths = vec![40.0; 12];
        let visible: Vec<usize> = (0..12).collect();
        let windows: Vec<_> = (0..11)
            .map(|boundary| {
                if boundary == 5 {
                    window(boundary, 12.0, 12.0)
                } else {
                    window(boundary, 0.0, 0.0)
                }
            })
            .collect();
        let plan = optimize_natural_part(
            &widths,
            120.0,
            120.0,
            &[vec![0, 1, 2], vec![3, 4, 5], vec![6, 7, 8], vec![9, 10, 11]],
            &[40.0; 4],
            &[0.0; 4],
            &visible,
            12,
            &windows,
            &geometry(),
            &config,
        )
        .expect("plan");

        assert_eq!(plan.systems.len(), 4);
        let first_page_end = plan.page_starts[1];
        let boundary_position = plan.systems[..first_page_end]
            .iter()
            .map(Vec::len)
            .sum::<usize>();
        assert_eq!(boundary_position, 6);
    }

    #[test]
    fn collapsed_mmr_end_is_a_candidate_below_vs_threshold() {
        let config = PageTurnConfig {
            title_page: TitlePagePolicy::Never,
            first_page_recto: Some(true),
            allow_intentional_blanks: false,
            vs_secs: 3.0,
            ..PageTurnConfig::default()
        };
        // Visible position 4 represents underlying measures 4..=8. Its end is
        // boundary 8 even though the 2-second rest is below the V.S. threshold.
        let visible = vec![0, 1, 2, 3, 4, 9, 10, 11];
        let mut windows: Vec<_> = (0..11).map(|boundary| window(boundary, 0.0, 0.0)).collect();
        windows[8] = window(8, 2.0, 2.0);
        let plan = optimize_natural_part(
            &[45.0; 8],
            140.0,
            140.0,
            &[vec![0, 1], vec![2, 3], vec![4, 5], vec![6, 7]],
            &[40.0; 4],
            &[0.0; 4],
            &visible,
            12,
            &windows,
            &geometry(),
            &config,
        )
        .expect("plan");

        let first_page_end = plan.page_starts[1];
        let boundary_position = plan.systems[..first_page_end]
            .iter()
            .map(Vec::len)
            .sum::<usize>();
        assert_eq!(
            boundary_after_visible_position(&visible, 12, boundary_position),
            Some(8)
        );
    }
}

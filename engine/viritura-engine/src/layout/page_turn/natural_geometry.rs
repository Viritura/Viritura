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
use crate::layout::system::{first_tempo_overflow, MAX_COMPRESSION_OVERFLOW};

mod long_mmr_casting;
mod plan_ranking;
mod sparse_page_rebalancing;
mod system_height;
mod turn_rebalancing;

pub(crate) use system_height::{MeasureInk, SystemHeights};

use long_mmr_casting::pull_opening_long_mmr_into_prior_spread;
use plan_ranking::{
    pagination_sparse_page_count, pagination_turn_rank, title_page_lacks_strong_turn, turn_grade,
    PlanRank,
};
use sparse_page_rebalancing::{rebalance_sparse_facing_pages, rebalance_sparse_penultimate_page};
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
    /// `(bad, non_comfortable)` physical turns so far. Turn playability
    /// dominates every density and casting cost, matching [`PlanRank`].
    turns: (usize, usize),
    cost: f64,
    node: usize,
    /// Content height of the open page, carried along the path because
    /// content-derived system heights and gaps are not a function of the key.
    content: f64,
    /// Extent of the last system on the open page.
    last: MeasureInk,
}

impl StateValue {
    /// Prefer more playable turns, then the cheaper path, then the one
    /// leaving more room on the open page.
    fn improves_on(&self, current: &Self) -> bool {
        match self.turns.cmp(&current.turns) {
            std::cmp::Ordering::Less => true,
            std::cmp::Ordering::Greater => false,
            std::cmp::Ordering::Equal => {
                self.cost < current.cost
                    || (self.cost <= current.cost && self.content < current.content - 1e-9)
            }
        }
    }
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

/// Whether every tempo marking in the system fits; the measured layout would
/// otherwise split it and silently recast all later systems and page turns.
fn tempo_fits(widths: &[f64], tempo: &[f64], start: usize, end: usize, available: f64) -> bool {
    tempo.is_empty() || first_tempo_overflow(start..end, widths, tempo, available).is_none()
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
    tempo_widths: &[f64],
    first_width: f64,
    subsequent_width: f64,
    heights: &SystemHeights<'_>,
    system_count: usize,
    visible_indices: &[usize],
    total_measures: usize,
    windows: &[TurnWindow],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
    title_page: bool,
    first_page_recto: bool,
    avoid_sparse_pages: bool,
) -> Option<NaturalPartPlan> {
    let measure_count = natural_widths.len();
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

    let mut offer = |target: &mut BTreeMap<StateKey, StateValue>,
                     key: StateKey,
                     value: StateValue,
                     node: PathNode| {
        if target
            .get(&key)
            .is_some_and(|current| !value.improves_on(current))
        {
            return;
        }
        let node_index = arena.len();
        arena.push(node);
        target.insert(
            key,
            StateValue {
                node: node_index,
                ..value
            },
        );
    };

    // Seed the first system. It always starts the first music page.
    let max_first_end = measure_count - (system_count - 1);
    let mut running = None;
    for end in 1..=max_first_end {
        if !system_fits(&prefix, 0, end, first_width) {
            break;
        }
        let extent = heights.extend(running, end - 1);
        running = Some(extent);
        if !tempo_fits(natural_widths, tempo_widths, 0, end, first_width) {
            continue;
        }
        let height = extent.height();
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
            StateValue {
                turns: (0, 0),
                cost: system_cast_cost(span_width(&prefix, 0, end), first_width),
                node: 0,
                content: height,
                last: extent,
            },
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
            let mut running = None;
            for end in (state_key.measure_end + 1)..=max_end {
                if !system_fits(&prefix, state_key.measure_end, end, subsequent_width) {
                    break;
                }
                let extent = heights.extend(running, end - 1);
                running = Some(extent);
                let start = state_key.measure_end;
                if !tempo_fits(natural_widths, tempo_widths, start, end, subsequent_width) {
                    continue;
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
                let current_content =
                    state.content + heights.gap(state.last, extent) + extent.height();
                let current_capacity = if state_key.page_start_system == 0 {
                    first_page_capacity
                } else {
                    geometry.usable_height
                };
                if current_content <= current_capacity {
                    offer(
                        &mut next,
                        StateKey {
                            measure_end: end,
                            ..*state_key
                        },
                        StateValue {
                            turns: state.turns,
                            cost: state.cost + cast,
                            node: 0,
                            content: current_content,
                            last: extent,
                        },
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
                let closed_content = state.content;
                let closed_capacity = current_capacity;
                if !page_fill_is_allowed(closed_content, closed_capacity, false, config)
                    || (avoid_sparse_pages
                        && closed_capacity > 0.0
                        && closed_content < closed_capacity * config.vertical_justify_threshold)
                {
                    continue;
                }
                let opened = StateValue {
                    turns: state.turns,
                    cost: 0.0,
                    node: 0,
                    content: extent.height(),
                    last: extent,
                };
                let boundary = boundary_after_visible_position(
                    visible_indices,
                    total_measures,
                    state_key.measure_end,
                );
                let window = window_at_boundary(windows, boundary);
                let direct_parity = (state_key.page_parity + 1) % 2;
                let grade = turn_grade(window, visible_indices, state_key.measure_end);
                let add_grade = |(bad, rough): (usize, usize)| (bad + grade.0, rough + grade.1);
                let direct_is_turn = is_physical_turn(state_key.page_parity, first_page_recto);
                let direct_turn = if direct_is_turn {
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
                    StateValue {
                        turns: if direct_is_turn {
                            add_grade(state.turns)
                        } else {
                            state.turns
                        },
                        cost: state.cost + cast + direct_turn + page_count_weight,
                        ..opened
                    },
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
                        StateValue {
                            turns: add_grade(state.turns),
                            cost: state.cost
                                + cast
                                + config.weights.blank_page
                                + blank_turn
                                + page_count_weight,
                            ..opened
                        },
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

    let mut best: Option<StateValue> = None;
    for (state_key, state) in layer {
        if state_key.measure_end != measure_count {
            continue;
        }
        let final_content = state.content;
        let final_capacity = if state_key.page_start_system == 0 {
            first_page_capacity
        } else {
            geometry.usable_height
        };
        if !page_fill_is_allowed(final_content, final_capacity, true, config) {
            continue;
        }
        if best.is_none_or(|current| state.improves_on(&current)) {
            best = Some(state);
        }
    }

    let StateValue {
        cost,
        node: node_index,
        ..
    } = best?;
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
/// casting. The number of systems is fixed by `baseline_systems.len()`.
#[allow(clippy::too_many_arguments)] // public planner boundary
pub(crate) fn optimize_natural_part(
    natural_widths: &[f64],
    tempo_widths: &[f64],
    first_width: f64,
    subsequent_width: f64,
    baseline_systems: &[Vec<usize>],
    heights: &SystemHeights<'_>,
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
    let mut candidates: Vec<_> = titles.iter().rev().map(|&title| (title, false)).collect();
    while let Some((title_page, avoid_sparse_pages)) = candidates.pop() {
        let Some(mut candidate) = run_joint_dp(
            natural_widths,
            tempo_widths,
            first_width,
            subsequent_width,
            heights,
            baseline_systems.len(),
            visible_indices,
            total_measures,
            windows,
            geometry,
            config,
            title_page,
            first_page_recto,
            avoid_sparse_pages,
        ) else {
            continue;
        };
        if title_page {
            candidate.cost += config.weights.title_page;
        }
        // Later passes only move page boundaries, so the DP's casting fixes
        // every system's height and leading gap.
        let (system_heights, system_gaps) = heights.for_systems(&candidate.systems);
        let (system_heights, system_gaps) = (system_heights.as_slice(), system_gaps.as_slice());
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
        if !avoid_sparse_pages && sparse_pages > 0 && config.allow_partial_pages {
            // A denser recast may retain the same turn quality while
            // leaving the remaining slack on the last page.
            candidates.push((title_page, true));
        }
    }
    best.map(|(_, plan)| plan).or_else(|| {
        (!baseline_systems.is_empty()).then(|| {
            let (system_heights, system_gaps) = heights.for_systems(baseline_systems);
            baseline_plan(
                baseline_systems,
                &system_heights,
                &system_gaps,
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

    /// Uniform measure heights with no inter-system gap (a zero staff space
    /// collapses the gap floor).
    fn uniform_heights(ink: &[MeasureInk]) -> SystemHeights<'_> {
        SystemHeights { ink, sp: 0.0 }
    }

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
            &[],
            120.0,
            120.0,
            &[vec![0, 1, 2], vec![3, 4, 5], vec![6, 7, 8], vec![9, 10, 11]],
            &uniform_heights(
                &[MeasureInk {
                    core: 40.0,
                    ..MeasureInk::default()
                }; 16],
            ),
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
            &[],
            140.0,
            140.0,
            &[vec![0, 1], vec![2, 3], vec![4, 5], vec![6, 7]],
            &uniform_heights(
                &[MeasureInk {
                    core: 40.0,
                    ..MeasureInk::default()
                }; 16],
            ),
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

    #[test]
    fn sparse_page_is_kept_when_denser_turns_are_unsafe() {
        let config = PageTurnConfig {
            title_page: TitlePagePolicy::Never,
            first_page_recto: Some(true),
            allow_intentional_blanks: false,
            ..PageTurnConfig::default()
        };
        let visible: Vec<usize> = (0..14).collect();
        let windows: Vec<_> = (0..13)
            .map(|boundary| {
                if boundary == 5 {
                    window(boundary, 12.0, 12.0)
                } else {
                    window(boundary, 0.0, 0.0)
                }
            })
            .collect();
        let baseline: Vec<_> = (0..7)
            .map(|system| vec![system * 2, system * 2 + 1])
            .collect();
        let plan = optimize_natural_part(
            &[50.0; 14],
            &[],
            100.0,
            100.0,
            &baseline,
            &uniform_heights(
                &[MeasureInk {
                    core: 20.0,
                    ..MeasureInk::default()
                }; 16],
            ),
            &visible,
            14,
            &windows,
            &geometry(),
            &config,
        )
        .expect("plan");

        assert_eq!(plan.page_starts, vec![0, 3]);
        assert_eq!(pagination_turn_rank(&plan, &visible, 14, &windows), (0, 0));
    }

    fn single_page_config() -> PageTurnConfig {
        PageTurnConfig {
            title_page: TitlePagePolicy::Never,
            first_page_recto: Some(true),
            allow_intentional_blanks: false,
            ..PageTurnConfig::default()
        }
    }

    #[test]
    fn rejects_systems_whose_tempo_text_would_force_a_split() {
        let visible: Vec<usize> = (0..6).collect();
        let windows: Vec<_> = (0..5).map(|boundary| window(boundary, 0.0, 0.0)).collect();
        let ink = [MeasureInk {
            core: 40.0,
            ..MeasureInk::default()
        }; 6];
        let plan_with = |tempo: &[f64]| {
            optimize_natural_part(
                &[30.0; 6],
                tempo,
                100.0,
                100.0,
                &[vec![0, 1, 2], vec![3, 4, 5]],
                &uniform_heights(&ink),
                &visible,
                6,
                &windows,
                &geometry(),
                &single_page_config(),
            )
            .expect("plan")
        };
        assert_eq!(plan_with(&[]).systems, vec![vec![0, 1, 2], vec![3, 4, 5]]);
        // Measure 4's tempo text cannot fit after measure 3 on one line, so the
        // measured layout would split [3, 4, 5]; the planner starts a system
        // at measure 4 instead.
        let tempo = [0.0, 0.0, 0.0, 0.0, 70.0, 0.0];
        assert_eq!(
            plan_with(&tempo).systems,
            vec![vec![0, 1, 2, 3], vec![4, 5]]
        );
    }

    #[test]
    fn page_capacity_uses_the_ink_of_each_systems_measures() {
        let visible: Vec<usize> = (0..8).collect();
        let windows: Vec<_> = (0..7)
            .map(|boundary| window(boundary, 12.0, 12.0))
            .collect();
        let mut ink = [MeasureInk {
            core: 30.0,
            ..MeasureInk::default()
        }; 8];
        // A tall marking in measure 2 makes its whole system 70 high, so only
        // two systems fit on the first page.
        ink[2].above = 40.0;
        let heights = uniform_heights(&ink);
        let baseline: Vec<_> = (0..4).map(|s| vec![s * 2, s * 2 + 1]).collect();
        let plan = optimize_natural_part(
            &[50.0; 8],
            &[],
            100.0,
            100.0,
            &baseline,
            &heights,
            &visible,
            8,
            &windows,
            &geometry(),
            &single_page_config(),
        )
        .expect("plan");

        assert_eq!(plan.page_starts, vec![0, 2]);
        let (system_heights, system_gaps) = heights.for_systems(&plan.systems);
        assert_eq!(system_heights, vec![30.0, 70.0, 30.0, 30.0]);
        assert!(
            page_content_height(&system_heights, &system_gaps, 0, 2, 0.0)
                <= geometry().usable_height
        );
    }
}

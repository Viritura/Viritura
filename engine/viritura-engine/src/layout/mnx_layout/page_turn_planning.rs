#![allow(unused_imports)]

use super::super::*;
use super::mmr_grouping::MmrPlan;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) fn single_source_part_index(flat_staves: &[FlatStaff]) -> Option<usize> {
    let mut part_index = None;
    for staff in flat_staves {
        for source in &staff.sources {
            match part_index {
                None => part_index = Some(source.part_index),
                Some(current) if current == source.part_index => {}
                Some(_) => return None,
            }
        }
    }
    part_index
}

/// Recast an auto-paginated part from the retained whole-part natural-width
/// horizon. The ordinary greedy casting supplies only the target system count;
/// the joint planner evaluates real alternative system/page boundaries without
/// inserting synthetic lines. Full scores and authored pagination never call
/// this path.
#[allow(clippy::too_many_arguments)] // integration boundary for the natural geometry planner
pub(super) fn globally_plan_part_systems(
    score: &Score,
    config: &LayoutConfig,
    sp: f64,
    flat_staves: &[FlatStaff],
    baseline_systems: &[Vec<usize>],
    natural_widths: &[f64],
    visible_indices: &[usize],
    content_width_first: Option<f64>,
    content_width_subseq: Option<f64>,
    title_height_px: f64,
) -> Option<page_turn::NaturalPartPlan> {
    if !config.page_turns.enabled || config.page_width.is_none() {
        return None;
    }
    let part_index = single_source_part_index(flat_staves)?;
    let part = score.parts.get(part_index)?;
    let first_width = content_width_first.filter(|width| *width > 0.0)?;
    let subsequent_width = content_width_subseq.filter(|width| *width > 0.0)?;
    if natural_widths.len() < 2 || baseline_systems.len() < 2 {
        return None;
    }
    let mut page_turns = config.page_turns.clone();
    if matches!(page_turns.title_page, page_turn::TitlePagePolicy::Auto)
        && !score.metadata().is_some_and(|metadata| {
            [
                &metadata.title,
                &metadata.subtitle,
                &metadata.composer,
                &metadata.lyricist,
                &metadata.arranger,
                &metadata.copyright,
            ]
            .into_iter()
            .any(|value| value.as_deref().is_some_and(|text| !text.trim().is_empty()))
        })
    {
        page_turns.title_page = page_turn::TitlePagePolicy::Never;
    }
    let windows = page_turn::analyze_turn_windows_for_visible_blocks(
        &score.global.measures,
        &part.measures,
        visible_indices,
        &page_turns,
    );
    // Before exact system layouts exist, estimate each system from the complete
    // staff geometry rather than from a nominal measures-per-line count. The
    // exact packer later honors these boundaries and only adds a safety break
    // when measured content would overflow.
    let staff_count = flat_staves.len().max(1) as f64;
    let nominal_system_height = (staff_count * 4.0 + (staff_count - 1.0).max(0.0) * 7.0 + 8.0) * sp;
    let system_heights = vec![nominal_system_height; baseline_systems.len()];
    let mut system_gaps = vec![sp; baseline_systems.len()];
    if let Some(first) = system_gaps.first_mut() {
        *first = 0.0;
    }
    let usable_height =
        (config.page_height - config.page_margin_top - config.page_margin_bottom) * sp;
    let geometry = page_turn::PageGeometry {
        usable_height,
        title_height: title_height_px + config.first_page_footer_height,
        inter_system_spacing: sp,
    };
    page_turn::optimize_natural_part(
        natural_widths,
        first_width,
        subsequent_width,
        baseline_systems,
        &system_heights,
        &system_gaps,
        visible_indices,
        score.global.measures.len(),
        &windows,
        &geometry,
        &page_turns,
    )
}

fn system_measure_ranges(
    systems: &[Vec<usize>],
    visible_indices: &[usize],
    total_measures: usize,
) -> Vec<(usize, usize)> {
    systems
        .iter()
        .filter_map(|system| {
            page_turn::system_measure_range(
                *system.first()?,
                *system.last()?,
                total_measures,
                |position| visible_indices.get(position).copied(),
            )
        })
        .collect()
}

/// Describe warnings and hints for the final measured page membership.
#[allow(clippy::too_many_arguments)] // pipeline boundary for selected pagination metadata
fn describe_auto_flow_pagination(
    score: &Score,
    config: &LayoutConfig,
    flat_staves: &[FlatStaff],
    systems: &[Vec<usize>],
    visible_indices: &[usize],
    page_starts: Vec<usize>,
    natural_plan: Option<&page_turn::NaturalPartPlan>,
) -> super::super::page_turn::ForcedPagination {
    let empty = || page_turn::ForcedPagination {
        page_starts: Vec::new(),
        warnings: None,
        hints: Vec::new(),
        blank_pages_before: Vec::new(),
        title_page: false,
        first_page_recto: false,
    };
    let Some(natural_plan) = natural_plan else {
        return empty();
    };
    // Single-part gate: every flat staff source must reference the same part.
    let Some(part_index) = single_source_part_index(flat_staves) else {
        return empty();
    };
    let Some(part) = score.parts.get(part_index) else {
        return empty();
    };
    let system_ranges =
        system_measure_ranges(systems, visible_indices, score.global.measures.len());
    page_turn::describe_selected_pagination(
        &score.global.measures,
        &part.measures,
        visible_indices,
        &system_ranges,
        page_starts,
        natural_plan.blank_pages_before.clone(),
        natural_plan.title_page,
        natural_plan.first_page_recto,
        &config.page_turns,
    )
}

/// Final physical page sequence and vertical placement for automatic flow.
pub(super) struct AutoFlowPages {
    pub(super) pages: Vec<PageLayout>,
    pub(super) intentional_blank_pages: Vec<usize>,
    pub(super) warnings: Option<Vec<PageTurnWarning>>,
    pub(super) hints: Vec<page_turn::PageTurnHint>,
    pub(super) dedicated_title_page: bool,
    pub(super) system_y_positions: Vec<f64>,
    pub(super) justified_gaps: Vec<f64>,
    pub(super) intra_clearances: Vec<f64>,
}

fn repaginate_measured_part(
    score: &Score,
    config: &LayoutConfig,
    flat_staves: &[FlatStaff],
    systems: &[Vec<usize>],
    visible_indices: &[usize],
    system_heights: &[f64],
    protrusion_extras: &[(f64, f64)],
    title_height: f64,
    title_page: bool,
) -> Option<page_turn::TurnPlan> {
    let part = score.parts.get(single_source_part_index(flat_staves)?)?;
    let windows = page_turn::analyze_turn_windows_for_visible_blocks(
        &score.global.measures,
        &part.measures,
        visible_indices,
        &config.page_turns,
    );
    let ranges = system_measure_ranges(systems, visible_indices, score.global.measures.len());
    let gaps: Vec<_> = (0..system_heights.len())
        .map(|system| {
            if system == 0 {
                0.0
            } else {
                super::super::page::effective_system_gap(
                    protrusion_extras
                        .get(system - 1)
                        .map_or(0.0, |extra| extra.1),
                    protrusion_extras.get(system).map_or(0.0, |extra| extra.0),
                    config.sp,
                )
            }
        })
        .collect();
    let mut page_turns = config.page_turns.clone();
    page_turns.title_page = if title_page {
        page_turn::TitlePagePolicy::Always
    } else {
        page_turn::TitlePagePolicy::Never
    };
    let geometry = page_turn::PageGeometry {
        usable_height: (config.page_height - config.page_margin_top - config.page_margin_bottom)
            * config.sp,
        title_height: title_height + config.first_page_footer_height,
        inter_system_spacing: config.sp,
    };
    page_turn::optimize(
        system_heights,
        &gaps,
        &geometry,
        &page_turns,
        &ranges,
        &windows,
    )
}

/// Position automatic-flow pages. The exact page-turn additions are gated to a
/// single part; full scores retain the established packing and positioning.
#[allow(clippy::too_many_arguments)] // exact positioning consumes all engraved system geometry
pub(super) fn position_auto_flow_pages(
    score: &Score,
    config: &LayoutConfig,
    flat_staves: &[FlatStaff],
    systems: &[Vec<usize>],
    visible_indices: &[usize],
    system_heights: &[f64],
    protrusion_extras: &[(f64, f64)],
    title_height: f64,
    chunked: bool,
    natural_plan: Option<&page_turn::NaturalPartPlan>,
    forced_page_starts: &[usize],
) -> AutoFlowPages {
    let sp = config.sp;
    let page_starts = natural_plan
        .map(|plan| plan.page_starts.clone())
        .unwrap_or_else(|| forced_page_starts.to_vec());
    let title_page = natural_plan.is_some_and(|plan| plan.title_page);
    let dedicated_title_page = title_page && config.page_width.is_some() && !chunked;
    let music_config = dedicated_title_page.then(|| {
        let mut config = config.clone();
        config.first_page_footer_height = 0.0;
        config
    });
    let config = music_config.as_ref().unwrap_or(config);
    let break_title_height = if dedicated_title_page {
        0.0
    } else {
        title_height
    };
    let mut packed_pages = if natural_plan.is_some() {
        super::super::page::compute_page_breaks_preserving_membership(
            system_heights,
            Some(protrusion_extras),
            config,
            break_title_height,
            &page_starts,
        )
    } else {
        super::super::page::compute_page_breaks_with_extras(
            system_heights,
            Some(protrusion_extras),
            config,
            break_title_height,
            &page_starts,
        )
    };
    let mut packed_page_starts = packed_pages
        .iter()
        .filter_map(|page| page.system_indices.first().copied())
        .collect();
    let membership_changed = packed_page_starts != page_starts
        || natural_plan.is_some_and(|plan| plan.systems != systems);
    let mut metadata_plan = natural_plan.cloned();
    if let Some(plan) = metadata_plan.as_mut().filter(|_| membership_changed) {
        // An overflow invalidates the estimated page fits. Keeping the old
        // break immediately after a safety break can strand a single line.
        // Re-plan pages, not systems, using the packer's measured geometry.
        plan.blank_pages_before.clear();
        if let Some(refined) = repaginate_measured_part(
            score,
            config,
            flat_staves,
            systems,
            visible_indices,
            system_heights,
            protrusion_extras,
            break_title_height,
            title_page,
        ) {
            plan.page_starts = refined.page_starts;
            plan.blank_pages_before = refined.blank_pages_before;
            packed_pages = super::super::page::compute_page_breaks_preserving_membership(
                system_heights,
                Some(protrusion_extras),
                config,
                break_title_height,
                &plan.page_starts,
            );
            packed_page_starts = packed_pages
                .iter()
                .filter_map(|page| page.system_indices.first().copied())
                .collect();
        }
    }
    let page_turn::ForcedPagination {
        warnings,
        hints,
        blank_pages_before,
        first_page_recto,
        ..
    } = describe_auto_flow_pagination(
        score,
        config,
        flat_staves,
        systems,
        visible_indices,
        packed_page_starts,
        metadata_plan.as_ref(),
    );
    let natural_page_ends: HashSet<usize> =
        if warnings.is_some() && config.page_turns.allow_partial_pages {
            super::super::page::compute_page_breaks_preserving_membership(
                system_heights,
                Some(protrusion_extras),
                config,
                break_title_height,
                &[],
            )
            .iter()
            .filter_map(|page| page.system_indices.last().copied())
            .collect()
        } else {
            HashSet::new()
        };
    let mut pages: Vec<_> = if chunked {
        packed_pages
            .into_iter()
            .map(|mut page| {
                page.system_indices = vec![0];
                page
            })
            .collect()
    } else {
        packed_pages
    };
    let mut intentional_blank_pages = if blank_pages_before.is_empty() {
        Vec::new()
    } else {
        super::super::page::insert_blank_pages_before_systems(
            &mut pages,
            &blank_pages_before,
            config,
        )
    };
    if dedicated_title_page {
        super::super::page::prepend_title_page(&mut pages, config);
        for page_number in &mut intentional_blank_pages {
            *page_number += 1;
        }
    }

    let ragged_turn_pages = if warnings.is_some() && config.page_turns.allow_partial_pages {
        sparse_turn_pages(
            &pages,
            system_heights,
            protrusion_extras,
            config,
            break_title_height,
            &natural_page_ends,
        )
    } else {
        Vec::new()
    };
    let system_count = systems.len();
    let staves_per_system = vec![flat_staves.len(); system_count];
    let (mut system_y_positions, justified_gaps, intra_clearances) = if config.page_width.is_some()
    {
        let partners = warnings
            .is_some()
            .then(|| super::super::page::spread_partners(pages.len(), first_page_recto));
        super::super::page::compute_system_y_positions_with_ragged_pages(
            &staves_per_system,
            4.0 * sp,
            &pages,
            config,
            break_title_height,
            Some(system_heights),
            Some(protrusion_extras),
            partners.as_deref(),
            Some(&ragged_turn_pages),
        )
    } else {
        let max_system_height = system_heights.iter().copied().fold(0.0_f64, f64::max);
        (
            (0..system_count)
                .map(|system| {
                    if chunked {
                        config.page_margin_top * sp
                    } else {
                        config.page_margin_top * sp + system as f64 * (max_system_height + 7.0 * sp)
                    }
                })
                .collect(),
            vec![7.0 * sp; system_count],
            vec![config.default_intra_staff_clearance * sp; system_count],
        )
    };
    if config.page_width.is_some() {
        for (system, y) in system_y_positions.iter_mut().enumerate() {
            *y += protrusion_extras.get(system).map_or(0.0, |extra| extra.0);
        }
    }

    AutoFlowPages {
        pages,
        intentional_blank_pages,
        warnings,
        hints,
        dedicated_title_page,
        system_y_positions,
        justified_gaps,
        intra_clearances,
    }
}

/// Preserve natural vertical spacing only for a below-floor partial page that
/// was introduced to improve a physical turn. Dense pages still justify: page
/// turn planning changes the break, not the standard vertical page finish.
fn sparse_turn_pages(
    pages: &[PageLayout],
    system_heights: &[f64],
    protrusion_extras: &[(f64, f64)],
    config: &LayoutConfig,
    title_height: f64,
    natural_page_ends: &HashSet<usize>,
) -> Vec<usize> {
    let capacity =
        (config.page_height - config.page_margin_top - config.page_margin_bottom) * config.sp;
    pages
        .iter()
        .enumerate()
        .filter_map(|(page_index, page)| {
            if page_index + 1 == pages.len() || page.system_indices.is_empty() {
                return None;
            }
            let mut content = 0.0;
            for (position, &system) in page.system_indices.iter().enumerate() {
                if position > 0 {
                    let previous = page.system_indices[position - 1];
                    let below_previous =
                        protrusion_extras.get(previous).map_or(0.0, |extra| extra.1);
                    let above_current = protrusion_extras.get(system).map_or(0.0, |extra| extra.0);
                    content += super::super::page::effective_system_gap(
                        below_previous,
                        above_current,
                        config.sp,
                    );
                }
                content += system_heights[system];
            }
            let page_capacity = capacity
                - if page.page_number == 0 {
                    config.first_page_footer_height
                } else {
                    0.0
                }
                - if page.system_indices.first() == Some(&0) {
                    title_height
                } else {
                    0.0
                };
            let fill = if page_capacity > 0.0 {
                content / page_capacity
            } else {
                1.0
            };
            let changes_natural_boundary = page
                .system_indices
                .last()
                .is_some_and(|last| !natural_page_ends.contains(last));
            (changes_natural_boundary && fill < config.page_turns.vertical_justify_threshold)
                .then_some(page_index)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measured_pagination_repairs_overflow_without_recasting_fitting_pages() {
        let mut global = vec![serde_json::json!({}); 20];
        global[0] = serde_json::json!({"time": {"count": 4, "unit": 4}});
        let measure = serde_json::json!({
            "sequences": [{"content": [{
                "duration": {"base": "whole"},
                "notes": [{"pitch": {"step": "C", "octave": 4}}]
            }]}]
        });
        let score = crate::parse::parse_mnx(
            &serde_json::json!({
                "mnx": {"version": 1},
                "global": {"measures": global},
                "parts": [{"id": "p1", "measures": vec![measure; 20]}]
            })
            .to_string(),
        )
        .expect("synthetic score parses");
        let flat_staves = vec![FlatStaff {
            sources: vec![FlatSource::whole_part(0)],
            label: None,
            short_label: None,
            resolved_full_label: None,
            resolved_short_label: None,
            expansion: false,
            condensed_numbers: Vec::new(),
            chord_symbol_source: None,
            chord_symbol_transposition: None,
        }];
        let mut config = LayoutConfig {
            sp: 1.0,
            page_width: Some(100.0),
            page_height: 100.0,
            page_margin_top: 0.0,
            page_margin_bottom: 0.0,
            ..LayoutConfig::default()
        };
        config.page_turns.enabled = true;
        config.page_turns.allow_intentional_blanks = false;
        let visible: Vec<_> = (0..20).collect();
        let systems: Vec<_> = visible.iter().map(|&measure| vec![measure]).collect();
        for title_page in [false, true] {
            for overflow in [false, true] {
                let plan = page_turn::NaturalPartPlan {
                    systems: systems.clone(),
                    page_starts: if overflow {
                        vec![0, 6, 12, 18]
                    } else {
                        vec![0, 4, 8, 12, 16]
                    },
                    blank_pages_before: Vec::new(),
                    title_page,
                    first_page_recto: true,
                    cost: 0.0,
                };
                let result = position_auto_flow_pages(
                    &score,
                    &config,
                    &flat_staves,
                    &systems,
                    &visible,
                    &[13.0; 20],
                    &[(0.0, 0.0); 20],
                    0.0,
                    false,
                    Some(&plan),
                    &[],
                );
                let music: Vec<_> = result
                    .pages
                    .iter()
                    .filter(|page| !page.system_indices.is_empty())
                    .collect();
                let counts: Vec<_> = music.iter().map(|page| page.system_indices.len()).collect();
                assert_eq!(
                    counts,
                    if overflow { vec![5; 4] } else { vec![4; 5] },
                    "cover={title_page}, overflow={overflow}"
                );
                assert_eq!(
                    music
                        .iter()
                        .flat_map(|page| page.system_indices.iter().copied())
                        .collect::<Vec<_>>(),
                    visible,
                    "measured pagination must keep every system in order"
                );
                assert_eq!(result.dedicated_title_page, title_page);
            }
        }
    }
}

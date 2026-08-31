#![allow(clippy::too_many_arguments, unused_imports)]

use super::super::*;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{hash_map::DefaultHasher, HashMap, HashSet};
use std::hash::{Hash, Hasher};

pub(super) fn render_head(
    dl: &mut DisplayList,
    score: &Score,
    config: &LayoutConfig,
    pages: &[PageLayout],
    page_width: f64,
    dedicated_title_page: bool,
    sp: f64,
    intentional_blank_pages: &[usize],
) {
    if config.page_width.is_none() {
        return;
    }
    let commands = if dedicated_title_page {
        super::super::page::render_title_page(
            score.metadata(),
            config,
            0.0,
            config.page_height * sp,
            page_width,
        )
    } else {
        render_title_block(
            score.metadata(),
            config,
            config.page_margin_top * sp,
            page_width,
        )
    };
    dl.commands.extend(commands);
    super::super::page::render_page_numbers_excluding(
        dl,
        pages,
        config,
        page_width,
        intentional_blank_pages,
    );
}

pub(super) fn score_render_salt(
    sp: f64,
    staff_height: f64,
    barline_width: f64,
    lyric_line_order: Option<&[String]>,
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
) -> u64 {
    let mut hasher = DefaultHasher::new();
    sp.to_bits().hash(&mut hasher);
    staff_height.to_bits().hash(&mut hasher);
    barline_width.to_bits().hash(&mut hasher);
    lyric_line_order.hash(&mut hasher);
    for staff in flat_staves {
        staff.label.hash(&mut hasher);
        staff.short_label.hash(&mut hasher);
        staff.expansion.hash(&mut hasher);
        staff.condensed_numbers.hash(&mut hasher);
        for source in &staff.sources {
            source.part_index.hash(&mut hasher);
            source.staff_number.hash(&mut hasher);
            source.voice_filter.hash(&mut hasher);
            source.stem_direction.hash(&mut hasher);
        }
    }
    for group in group_ranges {
        group.first_staff.hash(&mut hasher);
        group.last_staff.hash(&mut hasher);
        group.symbol.hash(&mut hasher);
        group.label.hash(&mut hasher);
        group.depth.hash(&mut hasher);
    }
    hasher.finish()
}

pub(super) fn horizon_tie_maps(
    chunked: bool,
    dirty_region: Option<&cache::DirtyRegion>,
    flat_staves: &[FlatStaff],
    precomputed: &[Vec<Vec<MeasureLayout>>],
    mut layout_cache: Option<&mut cache::LayoutCache>,
) -> (Option<Vec<HashMap<String, bool>>>, usize) {
    if !chunked {
        return (None, 0);
    }
    let prior = layout_cache
        .as_mut()
        .map(|layout_cache| layout_cache.take_horizon_tie_maps())
        .unwrap_or_default();
    let prior_valid = prior.len() == flat_staves.len();
    let mut prior: Vec<Option<HashMap<String, bool>>> = prior.into_iter().map(Some).collect();
    let mut reused = 0;
    let maps = (0..flat_staves.len())
        .map(|staff_index| {
            let affected = dirty_region
                .map(|region| region.affects_flat_staff(staff_index))
                .unwrap_or(true);
            if prior_valid && !affected {
                reused += 1;
                return prior[staff_index].take().expect("validated prior tie map");
            }
            let measures: Vec<&MeasureLayout> = precomputed
                .iter()
                .filter_map(|system| system.get(staff_index))
                .flatten()
                .collect();
            super::super::render_events::compute_tie_accidental_map_refs(&measures)
        })
        .collect();
    (Some(maps), reused)
}

pub(super) fn salt_with_tie_maps(
    render_salt: u64,
    maps: Option<&Vec<HashMap<String, bool>>>,
) -> u64 {
    let Some(maps) = maps else { return render_salt };
    let mut hasher = DefaultHasher::new();
    render_salt.hash(&mut hasher);
    for map in maps {
        let mut entries: Vec<(&String, bool)> =
            map.iter().map(|(key, &value)| (key, value)).collect();
        entries.sort_unstable();
        entries.hash(&mut hasher);
    }
    hasher.finish()
}

pub(super) fn system_break_plan_hash(
    render_salt: u64,
    systems: &[Vec<usize>],
    visible_indices: &[usize],
    margins: &[f64],
    chunked: bool,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    render_salt.hash(&mut hasher);
    systems.len().hash(&mut hasher);
    for system in systems {
        system.len().hash(&mut hasher);
        for &visible_index in system {
            visible_indices[visible_index].hash(&mut hasher);
        }
    }
    if !chunked {
        for margin in margins {
            margin.to_bits().hash(&mut hasher);
        }
    }
    hasher.finish()
}

pub(super) fn dirty_system_flags(
    systems: &[Vec<usize>],
    visible_indices: &[usize],
    dirty_range: Option<(usize, usize)>,
) -> Vec<bool> {
    systems
        .iter()
        .map(|system| {
            system.iter().any(|&visible_index| {
                let measure_index = visible_indices[visible_index];
                matches!(dirty_range, Some((start, end)) if measure_index >= start && measure_index <= end)
            })
        })
        .collect()
}

pub(super) fn clef_change_hash(measures: &HashSet<usize>) -> u64 {
    let mut measures: Vec<_> = measures.iter().copied().collect();
    measures.sort_unstable();
    let mut hasher = DefaultHasher::new();
    measures.hash(&mut hasher);
    hasher.finish()
}

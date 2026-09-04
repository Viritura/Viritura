#![allow(unused_imports)]

use super::super::*;
use super::resolve_condensing::ResolvedStaffSnapshot;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) type MmrPlan = cache::CachedMmrPlan;

fn detect_all_staff_mmr_groups(
    all_staff_resolved: &[ResolvedStaffSnapshot],
) -> Vec<(usize, usize)> {
    let Some(first_staff) = all_staff_resolved.first() else {
        return Vec::new();
    };
    let measure_is_empty = |index: usize| {
        all_staff_resolved.iter().all(|staff| {
            staff.get(index).is_some_and(|measure| {
                !measure.measure_repeat_covered
                    && super::super::resolve::is_full_measure_rest(measure)
            })
        })
    };
    let mut groups = Vec::new();
    let mut index = 0;
    while index < first_staff.len() {
        if !measure_is_empty(index) {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        while index < first_staff.len()
            && measure_is_empty(index)
            && !super::super::resolve::starts_new_mmr_group(first_staff, index)
        {
            index += 1;
        }
        let count = index - start;
        if count >= 2 {
            groups.push((start, count));
        }
    }
    groups
}

/// Decide which measures collapse into multi-measure rests. Caller-supplied
/// `mmr_start_map`/`skip_measures` win; otherwise auto-detect from the first
/// staff's resolved measures when `config.multimeasure_rests` is on.
pub(super) fn resolve_mmr_grouping(
    config: &LayoutConfig,
    all_staff_resolved: &[ResolvedStaffSnapshot],
    mmr_start_map: &HashMap<usize, u32>,
    skip_measures: &HashSet<usize>,
    measure_count: usize,
    mut cache: Option<&mut cache::LayoutCache>,
) -> Arc<MmrPlan> {
    let input_signature = {
        let mut hasher = DefaultHasher::new();
        config.multimeasure_rests.hash(&mut hasher);
        measure_count.hash(&mut hasher);
        let mut authored: Vec<_> = mmr_start_map
            .iter()
            .map(|(&start, &count)| (start, count))
            .collect();
        authored.sort_unstable();
        authored.hash(&mut hasher);
        let mut skipped: Vec<_> = skip_measures.iter().copied().collect();
        skipped.sort_unstable();
        skipped.hash(&mut hasher);
        hasher.finish()
    };
    let cache_eligible = !mmr_start_map.is_empty() || all_staff_resolved.len() <= 1;
    if let (Some(first_staff), Some(layout_cache)) = (
        all_staff_resolved.first(),
        cache.as_deref_mut().filter(|_| cache_eligible),
    ) {
        if let Some(plan) = layout_cache.cached_mmr_plan(first_staff, input_signature) {
            return plan;
        }
    }

    let (start_map, skip_measures) = if !mmr_start_map.is_empty() {
        // Caller-supplied (authored) ranges. Split each at any interior tempo
        // change, fermata, caesura, or other structural break so the player
        // still sees those markings — an export tool may author one long rest
        // straight across them. Falls back to the raw map if no resolved
        // measures are available to test against.
        if let Some(first) = all_staff_resolved.first() {
            split_authored_mmr_ranges(mmr_start_map, first)
        } else {
            (mmr_start_map.clone(), skip_measures.clone())
        }
    } else if config.multimeasure_rests {
        let groups = detect_all_staff_mmr_groups(all_staff_resolved);
        let mut sm = HashMap::new();
        let mut sk = HashSet::new();
        for &(start, count) in &groups {
            sm.insert(start, count as u32);
            for j in (start + 1)..(start + count) {
                sk.insert(j);
            }
        }
        (sm, sk)
    } else {
        (HashMap::new(), HashSet::new())
    };
    let visible_indices: Vec<usize> = (0..measure_count)
        .filter(|i| !skip_measures.contains(i))
        .collect();
    let plan = Arc::new(MmrPlan {
        start_map,
        skip_measures,
        visible_indices,
    });
    if let (Some(first_staff), Some(layout_cache)) =
        (all_staff_resolved.first(), cache.filter(|_| cache_eligible))
    {
        layout_cache.set_cached_mmr_plan(first_staff, input_signature, Arc::clone(&plan));
    }
    plan
}

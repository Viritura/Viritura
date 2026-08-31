#![allow(unused_imports)]

use super::super::*;
use super::mmr_grouping::MmrPlan;
use super::resolve_condensing::ResolvedStaffSnapshot;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) struct MeasureWidthBudget {
    /// Un-stretched max width per measure (cross-staff max), indexed by
    /// measure index (skipped measures are 0).
    pub(super) max_widths: Vec<f64>,
    /// Stretched widths (max_widths ├ù stretch) for ONLY visible measures, in
    /// the order of `visible_indices` ΓÇö what the greedy line-breaker consumes.
    pub(super) natural_widths: Vec<f64>,
    /// Shortest common note duration in beats, used as the log-spacing base
    /// for measure layouts downstream.
    pub(super) common_shortest_beats: f64,
}

fn terminal_dependency_range(
    dirty_range: Option<(usize, usize)>,
    measure_count: usize,
) -> Option<(usize, usize)> {
    let (start, end) = dirty_range?;
    Some((
        start.saturating_sub(1),
        end.min(measure_count.saturating_sub(1)),
    ))
}

/// Compute the per-measure natural width budget across all staves. Uses the
/// optional [`cache::LayoutCache`] to skip re-laying out unchanged measures
/// (keyed by content hash). Returns the unstretched maxima plus the stretched
/// "breathing room" widths used by the line-breaker.
#[allow(clippy::too_many_lines)] // single natural-width pass (collect → per-staff max → clef-column growth); cohesive
pub(super) fn compute_natural_measure_widths(
    config: &LayoutConfig,
    all_staff_resolved: &[ResolvedStaffSnapshot],
    all_ottavas: &[Arc<[ResolvedOttavaRange]>],
    duration_histogram: &DurationHistogram,
    mmr: &MmrPlan,
    measure_count: usize,
    dirty_region: Option<&cache::DirtyRegion>,
    mut cache: Option<&mut cache::LayoutCache>,
) -> MeasureWidthBudget {
    let sp = config.sp;
    let common_shortest_beats = detect_common_shortest_from_histogram(duration_histogram);

    // Phase C: when `scoped_precompute` is on AND we have a surviving dirty
    // range, measures OUTSIDE `[dirty_start, dirty_end]` can't have changed
    // since the prior pass — so the cached natural width is still valid and
    // we can skip the per-measure `measure_content_hash` (the ~6 µs JSON
    // serialization is the dominant cost on warm rebuilds).
    let scope_on = cache
        .as_deref()
        .map(|c| c.range_scope().scoped_precompute)
        .unwrap_or(false);
    let effective_range = if scope_on {
        cache::LayoutCache::effective_dirty_range(
            dirty_region.map(cache::DirtyRegion::measure_range),
            measure_count,
            cache::DEFAULT_RANGE_SCOPE_K,
        )
    } else {
        None
    };
    let width_range = terminal_dependency_range(effective_range, measure_count);

    if let Some(ref mut c) = cache {
        c.check_config(config);
        c.reset_stats();
    }
    // Phase P: take the cached max_widths so we can splice in just the
    // dirty-range entries instead of recomputing all 1300 from scratch.
    // Engages only when (1) we have a cache, (2) scoped_precompute is on,
    // (3) a dirty range survives, and (4) the cached vector matches the
    // current measure_count. Falls back to a fresh zeroed vector otherwise.
    let scoped_max_widths = effective_range.is_some()
        && cache
            .as_deref()
            .is_some_and(cache::LayoutCache::last_mmr_plan_reused)
        && cache
            .as_deref()
            .map(|c| c.range_scope().scoped_precompute)
            .unwrap_or(false);
    let mut max_widths = if scoped_max_widths {
        cache
            .as_deref_mut()
            .and_then(|c| c.take_cached_max_widths(measure_count))
            .unwrap_or_else(|| vec![0.0f64; measure_count])
    } else {
        vec![0.0f64; measure_count]
    };
    // When splicing from cache, zero out only the dirty range's slots so the
    // in-range loop below correctly accumulates the cross-staff max from
    // scratch (the cached values were the max across all staves on the
    // PRIOR pass; an in-range edit might lower the max).
    if scoped_max_widths {
        if let Some((s, e)) = width_range {
            let end = e.min(measure_count.saturating_sub(1));
            max_widths[s..=end].fill(0.0);
        }
    }
    // Per-measure maximum freshly-computed width. A positive value marks the
    // measures that need cross-staff merged-spacing reconciliation below.
    let mut max_base: Vec<f64> = vec![0.0f64; measure_count];
    let mut width_span = 0usize;
    for (si, resolved) in all_staff_resolved.iter().enumerate() {
        let staff_affected = dirty_region
            .map(|region| region.affects_flat_staff(si))
            .unwrap_or(true);
        let mut x_cursor = 0.0;
        let scan_range = scoped_max_widths
            .then_some(width_range)
            .flatten()
            .map(|(start, end)| {
                start.min(resolved.len())..end.saturating_add(1).min(resolved.len())
            });
        let resolved_slice = scan_range
            .as_ref()
            .map_or(resolved.as_ref(), |range| &resolved[range.clone()]);
        for rm in resolved_slice {
            if mmr.skip_measures.contains(&rm.index) {
                continue;
            }
            let cache_key = rm.index * 1000 + si;
            // Phase C fast path: outside the dirty range, trust the cache
            // without re-hashing the measure's content. Safe because
            // outside-range measures can't have been edited since the prior
            // pass populated the cache. `measure_content_hash` is the ~6 µs
            // per-measure JSON serialize that adds up to most of the
            // natural_widths cost.
            let outside_range = width_range
                .map(|(s, e)| rm.index < s || rm.index > e)
                .unwrap_or(false);
            // Within a dirty measure, only affected staves need content-hash
            // validation/layout. Unaffected staves still contribute their
            // cached width to the new cross-staff maximum, which correctly
            // handles an affected former-maximum becoming narrower.
            let trust_cached_width =
                outside_range || (effective_range.is_some() && !staff_affected);

            // Phase P: when scoped_max_widths is engaged AND this measure is
            // outside the dirty range AND not an MMR start, the max_widths
            // slot already carries the correct value from the cache — skip
            // both the per-measure width re-lookup AND the per-measure
            // label-width computation. Still need to advance x_cursor so
            // downstream geometry stays consistent.
            if scoped_max_widths && outside_range && !mmr.start_map.contains_key(&rm.index) {
                let cached_w = cache
                    .as_deref_mut()
                    .and_then(|c| c.get_natural_width_unchecked(cache_key));
                if let Some(w) = cached_w {
                    x_cursor += w;
                    continue;
                }
                // Cold cache for this (mi, staff) — fall through.
            }

            if !trust_cached_width {
                width_span += 1;
            }
            let w = if let Some(&count) = mmr.start_map.get(&rm.index) {
                // Lay the MMR start measure out to read its clef/key/time
                // prefix, then reserve that prefix on top of a count-scaled
                // H-bar body. The prefix term is essential: the first measure
                // of the piece carries the clef and time signature, so a flat
                // body that ignored the prefix would have almost its entire
                // width eaten by it, leaving a stub H-bar — the reason the very
                // first multimeasure rest rendered far thinner than mid-score
                // ones (which carry no prefix).
                let ml = layout_measure(
                    rm,
                    sp,
                    x_cursor,
                    config,
                    None,
                    &all_ottavas[si],
                    common_shortest_beats,
                );
                super::super::render_measure::multimeasure_rest_natural_width(
                    ml.prefix_width,
                    count,
                    sp,
                )
            } else if trust_cached_width {
                // Phase C: trust the cache, skip hash.
                if let Some(ref mut c) = cache {
                    if let Some(cached_w) = c.get_natural_width_unchecked(cache_key) {
                        cached_w
                    } else {
                        // Cache miss even though we're outside range — rare
                        // (cold cache for this measure on a scoped pass).
                        // Fall back to the hashed path so the cache is
                        // populated for subsequent edits.
                        let content_hash = measure_content_hash(rm);
                        let ml = layout_measure(
                            rm,
                            sp,
                            x_cursor,
                            config,
                            None,
                            &all_ottavas[si],
                            common_shortest_beats,
                        );
                        c.set_natural_width(cache_key, content_hash, ml.width);
                        ml.width
                    }
                } else {
                    let ml = layout_measure(
                        rm,
                        sp,
                        x_cursor,
                        config,
                        None,
                        &all_ottavas[si],
                        common_shortest_beats,
                    );
                    ml.width
                }
            } else if let Some(ref mut c) = cache {
                let content_hash = measure_content_hash(rm);
                if let Some(cached_w) = c.get_natural_width(cache_key, content_hash) {
                    cached_w
                } else {
                    let ml = layout_measure(
                        rm,
                        sp,
                        x_cursor,
                        config,
                        None,
                        &all_ottavas[si],
                        common_shortest_beats,
                    );
                    c.set_natural_width(cache_key, content_hash, ml.width);
                    ml.width
                }
            } else {
                let ml = layout_measure(
                    rm,
                    sp,
                    x_cursor,
                    config,
                    None,
                    &all_ottavas[si],
                    common_shortest_beats,
                );
                ml.width
            };
            if rm.index < measure_count {
                max_widths[rm.index] = max_widths[rm.index].max(w);
                max_base[rm.index] = max_base[rm.index].max(w);
                // Reserve room for an above-staff rehearsal mark so its box
                // can't overhang into the next bar. A co-located tempo is NOT
                // reserved here — it may overhang following bars and is kept
                // inside the right page margin by a render-time left-nudge.
                let label_w =
                    super::super::render_annotations::measure_above_label_reserved_width(rm, sp);
                if label_w > 0.0 {
                    max_widths[rm.index] = max_widths[rm.index].max(label_w);
                }
            }
            x_cursor += w;
        }
    }

    // Cross-staff merged-spacing width floor. Events are positioned with the
    // SYSTEM-wide MERGED log spacing (the union of every staff's onsets +
    // accidental clearance), but the per-staff `max_widths` above only sees one
    // staff's spacing at a time. In a measure dense with accidentals across many
    // staves the merged spacing's *rigid* (incompressible accidental-column)
    // width can approach or exceed a single staff's natural width, so the
    // measure ends up too narrow to hold it — the elastic note spacing then
    // collapses toward zero and notes (e.g. a beat's triplet) pile into one
    // column. Mirror `compute_system_spacing`: build the same merged spacing per
    // measure and widen the measure to its natural pixel width (prefix + merged
    // content) so the events lay out at full proportional spacing. Only fresh,
    // multi-staff measures need this (`max_base > 0`; single-staff merged ==
    // per-staff); scoped fast-path measures keep their cached, already-floored
    // width.
    if all_staff_resolved.len() > 1 {
        for mi in 0..measure_count {
            if max_base[mi] <= 0.0 {
                continue;
            }
            let measures: Vec<&ResolvedMeasure> = all_staff_resolved
                .iter()
                .filter_map(|staff| staff.get(mi))
                .collect();
            if measures.len() < 2 {
                continue;
            }
            let total_beats = all_staff_resolved
                .iter()
                .filter_map(|staff| staff.get(mi))
                .map(crate::layout::measure::layout_total_beats)
                .reduce(f64::max)
                .unwrap_or(4.0);
            let merged = build_merged_log_spacing_for_resolved_measures(
                &measures,
                total_beats,
                common_shortest_beats,
                config,
                true,
            );
            // Preserve the rhythmic width already budgeted behind the largest
            // staff-local prefix when independently aligned prefix regions
            // make the shared prefix wider than every local prefix.
            let included_prefix = all_staff_resolved
                .iter()
                .filter_map(|staff| staff.get(mi))
                .map(|rm| compute_prefix_width(rm, sp, mi == 0, config))
                .fold(0.0f64, f64::max);
            let aligned_prefix = compute_max_prefix_width(
                all_staff_resolved.iter().filter_map(|staff| staff.get(mi)),
                sp,
                mi == 0,
                config,
            );
            max_widths[mi] =
                natural_width_with_aligned_prefix(max_widths[mi], included_prefix, aligned_prefix);
            // `layout_measure_inner` subtracts the fixed trailing padding and
            // structural barline overhead. The events still need content_width
            // >= merged.total_width * sp to avoid elastic collapse.
            let trailing_barline_extra = all_staff_resolved
                .iter()
                .filter_map(|staff| staff.get(mi))
                .map(|rm| {
                    crate::layout::render_barlines::trailing_barline_extra_width(rm, config, sp)
                })
                .fold(0.0f64, f64::max);
            let needed = aligned_prefix.width
                + merged.total_width * sp
                + MEASURE_TRAILING_PADDING_SP * sp
                + trailing_barline_extra;
            max_widths[mi] = max_widths[mi].max(needed);
        }
    }

    // Apply a stretch factor for line-breaking so the greedy algorithm leaves
    // breathing room instead of cramming measures at maximum compression.
    // The actual layout uses max_widths (un-stretched) for proportional scaling.
    let stretch = 1.15;
    let natural_widths: Vec<f64> = mmr
        .visible_indices
        .iter()
        .map(|&mi| max_widths.get(mi).copied().unwrap_or(0.0) * stretch)
        .collect();

    // Phase P: re-store max_widths for the next scoped pass to reuse. Always
    // store (not only when scoped_max_widths was on this pass) so a cold
    // pass populates the cache for a subsequent scoped patch edit.
    if let Some(c) = cache {
        c.set_last_width_span(width_span, all_staff_resolved.len() * measure_count);
        c.set_cached_max_widths(max_widths.clone());
    }

    MeasureWidthBudget {
        max_widths,
        natural_widths,
        common_shortest_beats,
    }
}

#[cfg(test)]
mod tests {
    use super::terminal_dependency_range;

    #[test]
    fn terminal_dependency_recomputes_measure_before_dirty_range() {
        assert_eq!(terminal_dependency_range(Some((4, 4)), 8), Some((3, 4)));
        assert_eq!(terminal_dependency_range(Some((0, 2)), 8), Some((0, 2)));
    }
}

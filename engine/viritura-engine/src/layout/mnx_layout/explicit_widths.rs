//! Natural measure widths for authored MNX page layouts.

use super::super::cache::{measure_content_hash, LayoutCache};
use super::super::config::LayoutConfig;
use super::super::measure::{
    compute_max_prefix_width, compute_prefix_width, layout_measure,
    natural_width_with_aligned_prefix,
};
use super::super::render_annotations::measure_above_label_reserved_width;
use super::super::render_measure::multimeasure_rest_natural_width;
use super::super::types::ResolvedOttavaRange;
use crate::model::ResolvedMeasure;
use std::collections::{HashMap, HashSet};

/// Compute cache-aware per-measure maximum widths for displayed parts.
#[allow(clippy::too_many_arguments)] // Width collection consumes resolved staves, MMR visibility, and cache inputs.
pub(super) fn compute_explicit_max_widths(
    config: &LayoutConfig,
    sp: f64,
    measure_count: usize,
    all_resolved: &[Vec<ResolvedMeasure>],
    all_resolved_ottavas: &[Vec<ResolvedOttavaRange>],
    common_shortest_beats: f64,
    mmr_start_map: &HashMap<usize, u32>,
    skip_measures: &HashSet<usize>,
    shown_parts: &HashSet<usize>,
    mut cache: Option<&mut LayoutCache>,
) -> Vec<f64> {
    if let Some(cache) = cache.as_deref_mut() {
        cache.check_config(config);
        cache.reset_stats();
    }
    let mut max_widths = vec![0.0_f64; measure_count];
    for (part_index, resolved) in all_resolved.iter().enumerate() {
        if !shown_parts.contains(&part_index) {
            continue;
        }
        let mut x_cursor = 0.0;
        for measure in resolved {
            if skip_measures.contains(&measure.index) {
                continue;
            }
            let content_hash = measure_content_hash(measure);
            let cache_key = measure.index * 1000 + part_index;
            let width = if let Some(&count) = mmr_start_map.get(&measure.index) {
                let layout = layout_measure(
                    measure,
                    sp,
                    x_cursor,
                    config,
                    None,
                    &all_resolved_ottavas[part_index],
                    common_shortest_beats,
                );
                multimeasure_rest_natural_width(layout.prefix_width, count, sp)
            } else if let Some(cache) = cache.as_deref_mut() {
                if let Some(cached) = cache.get_natural_width(cache_key, content_hash) {
                    cached
                } else {
                    let layout = layout_measure(
                        measure,
                        sp,
                        x_cursor,
                        config,
                        None,
                        &all_resolved_ottavas[part_index],
                        common_shortest_beats,
                    );
                    cache.set_natural_width(cache_key, content_hash, layout.width);
                    layout.width
                }
            } else {
                layout_measure(
                    measure,
                    sp,
                    x_cursor,
                    config,
                    None,
                    &all_resolved_ottavas[part_index],
                    common_shortest_beats,
                )
                .width
            };
            if measure.index < measure_count {
                max_widths[measure.index] = max_widths[measure.index].max(width);
                let label_width = measure_above_label_reserved_width(measure, sp);
                if label_width > 0.0 {
                    max_widths[measure.index] = max_widths[measure.index].max(label_width);
                }
            }
            x_cursor += width;
        }
    }
    for (measure_index, natural_width) in max_widths.iter_mut().enumerate() {
        if *natural_width <= 0.0 || skip_measures.contains(&measure_index) {
            continue;
        }
        let shown_measures = || {
            all_resolved
                .iter()
                .enumerate()
                .filter(|(part_index, _)| shown_parts.contains(part_index))
                .filter_map(|(_, resolved)| resolved.get(measure_index))
        };
        let included_prefix = shown_measures()
            .map(|measure| compute_prefix_width(measure, sp, false, config))
            .fold(0.0_f64, f64::max);
        let aligned_prefix = compute_max_prefix_width(shown_measures(), sp, false, config);
        *natural_width =
            natural_width_with_aligned_prefix(*natural_width, included_prefix, aligned_prefix);
    }
    max_widths
}

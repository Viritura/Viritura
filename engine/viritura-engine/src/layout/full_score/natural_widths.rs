//! Natural-width collection for the legacy full-score layout path.

use super::super::cache::{measure_content_hash, LayoutCache};
use super::super::config::LayoutConfig;
use super::super::measure::layout_measure;
use super::super::types::ResolvedOttavaRange;
use crate::model::ResolvedMeasure;

/// Compute per-(visual-staff, measure) natural widths and content hashes,
/// populating the layout cache when present.
pub(super) fn compute_natural_widths_grid(
    all_resolved: &[Vec<ResolvedMeasure>],
    all_resolved_ottavas: &[Vec<ResolvedOttavaRange>],
    sp: f64,
    config: &LayoutConfig,
    common_shortest_beats: f64,
    mut cache: Option<&mut LayoutCache>,
) -> (Vec<Vec<f64>>, Vec<Vec<u64>>) {
    let mut natural_widths = Vec::new();
    let mut content_hash_grid = Vec::new();
    for (visual_staff, resolved) in all_resolved.iter().enumerate() {
        let mut widths = Vec::new();
        let mut hashes = Vec::new();
        for measure in resolved {
            let content_hash = measure_content_hash(measure);
            hashes.push(content_hash);
            let cache_key = measure.index * 1000 + visual_staff;
            let width = if let Some(cache) = cache.as_deref_mut() {
                if let Some(cached) = cache.get_natural_width(cache_key, content_hash) {
                    cached
                } else {
                    let layout = layout_measure(
                        measure,
                        sp,
                        0.0,
                        config,
                        None,
                        &all_resolved_ottavas[visual_staff],
                        common_shortest_beats,
                    );
                    cache.set_natural_width(cache_key, content_hash, layout.width);
                    layout.width
                }
            } else {
                layout_measure(
                    measure,
                    sp,
                    0.0,
                    config,
                    None,
                    &all_resolved_ottavas[visual_staff],
                    common_shortest_beats,
                )
                .width
            };
            widths.push(width);
        }
        natural_widths.push(widths);
        content_hash_grid.push(hashes);
    }
    (natural_widths, content_hash_grid)
}

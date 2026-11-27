use super::*;

pub(in crate::layout) fn compute_grand_staff_natural_widths(
    all_resolved: &[Vec<ResolvedMeasure>],
    all_resolved_ottavas: &[Vec<ResolvedOttavaRange>],
    sp: f64,
    config: &LayoutConfig,
    common_shortest_beats: f64,
    mut cache: Option<&mut cache::LayoutCache>,
) -> (Vec<Vec<f64>>, Vec<Vec<u64>>) {
    let mut natural_widths_per_staff: Vec<Vec<f64>> = Vec::new();
    let mut gs_content_hash_grid: Vec<Vec<u64>> = Vec::new();
    for (si, resolved) in all_resolved.iter().enumerate() {
        let mut widths = Vec::new();
        let mut hashes = Vec::new();
        for rm in resolved {
            let content_hash = measure_content_hash(rm);
            hashes.push(content_hash);
            // Staff-specific cache key: combine measure index with staff index
            let cache_key = rm.index * 100 + si;

            let width = if let Some(ref mut c) = cache {
                if let Some(cached_w) = c.get_natural_width(cache_key, content_hash) {
                    cached_w
                } else {
                    let ml = layout_measure(
                        rm,
                        sp,
                        0.0,
                        config,
                        None,
                        &all_resolved_ottavas[si],
                        common_shortest_beats,
                    );
                    c.set_natural_width(cache_key, content_hash, ml.width);
                    ml.width
                }
            } else {
                let ml = layout_measure(
                    rm,
                    sp,
                    0.0,
                    config,
                    None,
                    &all_resolved_ottavas[si],
                    common_shortest_beats,
                );
                ml.width
            };

            widths.push(width);
        }
        natural_widths_per_staff.push(widths);
        gs_content_hash_grid.push(hashes);
    }
    (natural_widths_per_staff, gs_content_hash_grid)
}

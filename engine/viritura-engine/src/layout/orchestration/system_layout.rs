use super::super::*;

pub(in crate::layout) fn compute_justified_system_widths(
    natural_widths: &[f64],
    avail_w: f64,
    page_mode: bool,
    is_last_system: bool,
    lock_from_stretch: &[bool],
    text_demands: &[f64],
) -> Vec<f64> {
    if natural_widths.is_empty() {
        return Vec::new();
    }

    let natural_total: f64 = natural_widths.iter().sum();
    if !page_mode || natural_total <= 0.0 {
        return natural_widths.to_vec();
    }

    if crate::layout::system::should_preserve_natural_final_width(
        natural_total,
        avail_w,
        is_last_system,
    ) {
        // A short final system sits at natural width with slack to the right
        // margin, so a left-anchored marking can't overrun it — no text-demand
        // reservation needed.
        return natural_widths.to_vec();
    }

    let scale = avail_w / natural_total;
    let base: Vec<f64> = if scale <= 1.0 || lock_from_stretch.iter().all(|&locked| !locked) {
        natural_widths.iter().map(|w| w * scale).collect()
    } else {
        let locked_total: f64 = natural_widths
            .iter()
            .zip(lock_from_stretch.iter())
            .filter_map(|(w, &locked)| if locked { Some(*w) } else { None })
            .sum();
        let stretch_total = natural_total - locked_total;
        if stretch_total <= 1e-9 {
            natural_widths.to_vec()
        } else {
            let extra = avail_w - natural_total;
            natural_widths
                .iter()
                .zip(lock_from_stretch.iter())
                .map(|(w, &locked)| {
                    if locked {
                        *w
                    } else {
                        *w + extra * (*w / stretch_total)
                    }
                })
                .collect()
        }
    };

    // Strategy 1 — extra compression for right-margin text fit. When a measure
    // carries a left-anchored marking (tempo / direction text) that, at the
    // proportional justified position, would run past the system's right edge,
    // squeeze the bars BEFORE it so the marking's measure starts further left
    // and its text fits inside the margin. The squeeze is bounded by
    // `MIN_HEAD_SCALE` (a "reasonable degree"); when that floor is not enough
    // the system planner has already broken or pulled bars to a prior line, so
    // this is always feasible here. No demand ⇒ byte-identical to proportional.
    reserve_text_demand(base, natural_widths, text_demands, avail_w)
}

/// Redistribute justified width so each measure carrying a left-anchored text
/// demand `text_demands[k] > 0` keeps at least that much room from its left
/// edge to the system's right edge — by compressing the bars before it (down to
/// `MIN_HEAD_SCALE` of their natural width) and handing the freed width to the
/// bars from `k` onward. The system total is preserved (width only moves right),
/// so justification is undisturbed. Returns `widths` unchanged when no measure
/// has a positive demand (the overwhelming common case), keeping every ordinary
/// system byte-identical to plain proportional justification.
pub(in crate::layout) fn reserve_text_demand(
    widths: Vec<f64>,
    natural: &[f64],
    text_demands: &[f64],
    avail_w: f64,
) -> Vec<f64> {
    let n = widths.len();
    if avail_w <= 0.0 || !text_demands.iter().take(n).any(|&d| d > 0.0) {
        return widths;
    }
    let mut f = widths;
    // Resolve demands tightest-first; pulling the head left for the worst
    // offender often satisfies milder ones to its right in the same pass.
    for _ in 0..n {
        // Prefix sums of the current widths.
        let mut prefix = vec![0.0; n + 1];
        for i in 0..n {
            prefix[i + 1] = prefix[i] + f[i];
        }
        // Worst tail-reservation violation: prefix(k) above the allowed cap.
        let mut worst_k: Option<usize> = None;
        let mut worst_excess = 1e-6;
        // `k` escapes via `worst_k = Some(k)` and indexes both `prefix` and
        // `text_demands`, so a plain iterator won't do.
        #[allow(clippy::needless_range_loop)]
        for k in 0..n {
            let d = text_demands.get(k).copied().unwrap_or(0.0);
            if d <= 0.0 {
                continue;
            }
            let cap = avail_w - d; // max prefix(k) so the tail covers the demand
            let excess = prefix[k] - cap;
            if excess > worst_excess {
                worst_excess = excess;
                worst_k = Some(k);
            }
        }
        let Some(k) = worst_k else { break };
        if k == 0 {
            break; // marking on the first bar — nothing before it to compress
        }
        let head_natural: f64 = natural[..k].iter().sum();
        let head_now: f64 = prefix[k];
        let floor_sum = crate::layout::system::MIN_HEAD_SCALE * head_natural;
        let target_head = (avail_w - text_demands[k]).max(floor_sum);
        if target_head >= head_now - 1e-6 {
            break; // already within the cap (or floor reached)
        }
        let removed = head_now - target_head;
        let head_scale = target_head / head_now;
        for w in f[..k].iter_mut() {
            *w *= head_scale;
        }
        let tail_now: f64 = f[k..].iter().sum();
        if tail_now > 1e-9 {
            for w in f[k..].iter_mut() {
                *w += removed * (*w / tail_now);
            }
        }
    }
    f
}

/// Layout a single part of the score and produce a DisplayList.
pub(in crate::layout) fn precompute_system_layouts(
    systems: &[Vec<usize>],
    natural_widths: &[f64],
    text_demands: &[f64],
    visible_resolved: &[&ResolvedMeasure],
    content_hashes: &[u64],
    content_width: Option<f64>,
    margin_left: f64,
    sp: f64,
    config: &LayoutConfig,
    resolved_ottavas: &[ResolvedOttavaRange],
    common_shortest_beats: f64,
    mmr_start_map: &HashMap<usize, u32>,
    part_index: usize,
    mut cache: Option<&mut cache::LayoutCache>,
) -> Vec<Vec<MeasureLayout>> {
    let system_count = systems.len();
    let mut precomp_sys_layouts: Vec<Vec<MeasureLayout>> = Vec::with_capacity(system_count);

    for (sys_idx, sys_measures) in systems.iter().enumerate() {
        let natural_total: f64 = sys_measures.iter().map(|&mi| natural_widths[mi]).sum();
        let avail_w = content_width.unwrap_or(natural_total);
        let natural_sys_widths: Vec<f64> =
            sys_measures.iter().map(|&mi| natural_widths[mi]).collect();
        let demand_sys: Vec<f64> = sys_measures
            .iter()
            .map(|&mi| text_demands.get(mi).copied().unwrap_or(0.0))
            .collect();
        let lock_from_stretch: Vec<bool> = sys_measures
            .iter()
            .map(|&mi| {
                let rm = visible_resolved[mi];
                rm.index == 0 && matches!(rm.global.number, Some(0))
            })
            .collect();
        let forced_sys_widths = compute_justified_system_widths(
            &natural_sys_widths,
            avail_w,
            config.page_width.is_some(),
            sys_idx == system_count - 1,
            &lock_from_stretch,
            &demand_sys,
        );

        let mut sys_x = margin_left;
        let mut sys_measure_layouts: Vec<MeasureLayout> = Vec::new();
        for (local_idx, &mi) in sys_measures.iter().enumerate() {
            let rm = visible_resolved[mi];
            let forced_w = forced_sys_widths[local_idx];
            let compound_hash = {
                let mut hasher = DefaultHasher::new();
                content_hashes[mi].hash(&mut hasher);
                forced_w.to_bits().hash(&mut hasher);
                hasher.finish()
            };
            let cached_hit = if let Some(ref c) = cache {
                c.get_full_layout(rm.index, compound_hash)
            } else {
                None
            };
            let mut ml = if let Some(cached_layout) = cached_hit {
                let mut ml = MeasureLayout {
                    x: 0.0,
                    width: cached_layout.width,
                    resolved: rm.clone(),
                    voice_layouts: cached_layout.voice_layouts,
                    prefix_width: cached_layout.prefix_width,
                    first_onset_padding: cached_layout.first_onset_padding,
                    time_signature_x_offset: cached_layout.time_signature_x_offset,
                    trailing_barline_extra:
                        crate::layout::render_barlines::trailing_barline_extra_width(rm, config, sp),
                    mid_clef_changes: cached_layout.mid_clef_changes,
                    multimeasure_rest_count: None,
                    multimeasure_rest_label: None,
                    part_index: 0,
                    is_first_on_system: false,
                    show_system_objects: true,
                    is_first_staff: true,
                };
                ml.translate_x(sys_x);
                ml
            } else {
                let ml = layout_measure(
                    rm,
                    sp,
                    0.0,
                    config,
                    Some(forced_w),
                    resolved_ottavas,
                    common_shortest_beats,
                );
                if let Some(ref mut c) = cache {
                    c.set_full_layout(
                        rm.index,
                        compound_hash,
                        ml.width,
                        &ml.voice_layouts,
                        ml.prefix_width,
                        ml.first_onset_padding,
                        ml.time_signature_x_offset,
                        &ml.mid_clef_changes,
                    );
                }
                let mut ml = ml;
                ml.translate_x(sys_x);
                ml
            };
            ml.part_index = part_index;
            ml.is_first_on_system = local_idx == 0;
            if let Some(&count) = mmr_start_map.get(&rm.index) {
                ml.multimeasure_rest_count = Some(count);
            }
            sys_x += ml.width;
            sys_measure_layouts.push(ml);
        }
        precomp_sys_layouts.push(sys_measure_layouts);
    }

    precomp_sys_layouts
}

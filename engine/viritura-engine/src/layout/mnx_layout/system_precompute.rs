#![allow(unused_imports)]

use super::super::*;
use super::break_planning::SystemBreakPlan;
use super::measure_widths::MeasureWidthBudget;
use super::mmr_grouping::MmrPlan;
use super::resolve_condensing::ResolvedStaffSnapshot;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) struct PrecomputedSystems {
    /// Indexed `[system_idx][staff_idx][measure_in_system_idx]`.
    pub(super) layouts: Vec<Vec<Vec<MeasureLayout>>>,
    /// Per-system left margin (`margin_left_first` for system 0, else
    /// `margin_left_subseq`).
    pub(super) margins: Vec<f64>,
    /// Per-measure content hashes, parallel to `layouts`
    /// (`[system_idx][staff_idx][measure_in_system_idx]`). Captured here so the
    /// render loop's segment-retention hash can reuse them instead of paying
    /// the `measure_content_hash` serde cost a second time.
    pub(super) content_hashes: Vec<Vec<Vec<u64>>>,
    /// Per-measure `(cache_key, compound_hash)` parallel to `layouts`, used by
    /// the caller to re-store each assembled measure into the move-based
    /// retention store after the render loop so the next pass can *move* an
    /// unchanged measure back in (skipping the voice-layout clone).
    pub(super) restore_meta: Vec<Vec<Vec<(usize, u64)>>>,
    /// Step 4 (B-full): per-system whole-system `layout_signature`, parallel to
    /// `layouts` (indexed by system). When the per-system wholesale store is
    /// enabled, the caller pairs this with `margins` + `content_hashes` +
    /// `restore_meta` to re-store each assembled system after the render loop.
    pub(super) sys_signatures: Vec<u64>,
}

/// Pass 1 of the auto-flow pipeline.
///
/// Pre-compute measure layouts for ALL systems so the caller can measure
/// actual below/above-staff protrusions before determining Y positions.
/// Measure layouts depend only on X positions (margin, widths), not Y, so
/// this pass is independent of the page/system Y allocation that follows.
///
/// Uses [`cache::LayoutCache`] hits keyed by content + forced-width compound
/// hash to skip unchanged measures across re-layouts.
#[allow(clippy::too_many_arguments)] // immutable inputs threaded through one coherent pass
#[allow(clippy::too_many_lines)] // one cohesive three-phase pass (prep → reuse → assemble); splitting would scatter the shared per-system state
pub(super) fn precompute_system_layouts(
    config: &LayoutConfig,
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
    all_staff_resolved: &[ResolvedStaffSnapshot],
    mmr: &MmrPlan,
    mmr_label_map: &HashMap<usize, String>,
    budget: &MeasureWidthBudget,
    plan: &SystemBreakPlan,
    chunked: bool,
    reusable_system_sources: Option<&[Option<usize>]>,
    mut cache: Option<&mut cache::LayoutCache>,
) -> PrecomputedSystems {
    let sp = config.sp;
    let system_count = plan.systems.len();

    // System-level mid-measure clef columns: a clef change on any staff of ANY
    // part must open the same horizontal gap on EVERY staff in the system at
    // that beat, so the measure grows globally and notes at the same beat stay
    // vertically aligned across the whole score (not just within a grand staff).
    // Precompute, per measure index, the union of mid-measure clef-change beats
    // across ALL staves. Empty entries (the common case) leave the compound
    // hash unchanged, so non-clef measures keep their cache validity.
    let sys_clef_beats: HashMap<usize, Vec<f64>> = {
        let mut map: HashMap<usize, Vec<f64>> = HashMap::new();
        for resolved in all_staff_resolved.iter() {
            for rm in resolved.iter() {
                let Some(clefs) = &rm.part.clefs else {
                    continue;
                };
                for pc in clefs {
                    let beat = pc.position.as_ref().map_or(0.0, |p| p.beats());
                    if beat > 0.001 {
                        map.entry(rm.index).or_default().push(beat);
                    }
                }
            }
        }
        for beats in map.values_mut() {
            beats.sort_by(f64::total_cmp);
            beats.dedup_by(|a, b| (*a - *b).abs() < 0.001);
        }
        map
    };
    let start_clef_change_measures: HashSet<usize> = all_staff_resolved
        .iter()
        .flat_map(|resolved| resolved.iter())
        .filter(|rm| {
            rm.index != 0
                && rm
                    .part
                    .clefs
                    .as_ref()
                    .is_some_and(|clefs| clefs.iter().any(|clef| clef.position.is_none()))
        })
        .map(|rm| rm.index)
        .collect();
    let mut layouts: Vec<Vec<Vec<MeasureLayout>>> = Vec::with_capacity(system_count);
    let mut margins: Vec<f64> = Vec::with_capacity(system_count);
    let mut content_hashes: Vec<Vec<Vec<u64>>> = Vec::with_capacity(system_count);
    let mut restore_meta: Vec<Vec<Vec<(usize, u64)>>> = Vec::with_capacity(system_count);

    // Sub-timing probe (step 4 / Lever 2): split the precompute cost into the
    // spacing solver vs the move-based retention assembly buckets so we can see
    // how much of the warm precompute is the HashMap::remove + MeasureLayout
    // reconstruction churn the position-indexed retention skip would replace.
    // Gated on `timing::is_enabled()` so the normal path pays only one bool
    // load per sampled region. Each bucket is emitted once at the end via
    // `record_split(label, now - accumulated)`.
    let timing_on = crate::timing::is_enabled();
    macro_rules! now_ms {
        () => {{
            if timing_on {
                crate::timing::now_ms()
            } else {
                0.0
            }
        }};
    }
    let mut t_solver = 0.0f64;
    let mut t_sig = 0.0f64;
    let mut t_hash = 0.0f64;
    let mut t_reuse = 0.0f64;
    let mut t_fresh = 0.0f64;
    let mut t_crossstaff = 0.0f64;

    // Move-based per-measure retention is independent of the render-debug flag
    // (layouts carry no debug payload) but is gated the same way so debug and
    // non-debug passes don't mix through the shared store. The store is drained
    // here and repopulated by the caller after the render loop; measures dropped
    // by an edit are simply not re-stored.
    //
    // Step 4 (B-full): when the per-system wholesale-reuse store is enabled it
    // REPLACES the per-measure store — `retain` goes false so `old_measures`
    // stays empty (every measure inside a *dirty* system is rebuilt fresh), and
    // `sys_retain` drains the per-system store instead. The two stores are
    // mutually exclusive so a single owner holds each assembled measure.
    let sys_reuse = cache
        .as_deref()
        .map(|c| c.system_layout_reuse_enabled())
        .unwrap_or(false);
    let retain = cache.is_some() && !config.emit_layout_debug && !sys_reuse;
    let sys_retain = cache.is_some() && !config.emit_layout_debug && sys_reuse;
    let mut old_measures = if retain {
        cache
            .as_mut()
            .map(|c| c.take_retained_measures())
            .unwrap_or_default()
    } else {
        HashMap::new()
    };
    let mut old_sys_layouts: Vec<Option<cache::CachedSystemLayout>> = if sys_retain {
        cache
            .as_mut()
            .map(|c| c.take_cached_system_layouts())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    // Per-system `(layout_signature, margin_left)` carried out so the caller can
    // re-store each assembled system into the wholesale-reuse store after the
    // render loop (parallel to `restore_meta` for the per-measure store).
    let mut sys_signatures: Vec<u64> = Vec::with_capacity(system_count);

    // Stitched-horizon (`chunked`) lays every chunk on ONE galley row at
    // continuous x: chunk N starts where chunk N-1 ended, not at the left
    // margin. `galley_x` tracks that running origin. Because per-measure widths
    // are independent of which chunk a measure lands in (the spacing solver
    // keys off global `common_shortest_beats`, not the system's measure set),
    // each chunk's measures land at exactly their single-system x — the basis
    // for byte-identity with the un-chunked layout.
    let mut galley_x = plan.margin_left_first;
    for (sys_idx, sys_vis_indices) in plan.systems.iter().enumerate() {
        // A seam continuation is any chunk after the first in stitched horizon:
        // it carries no system-start furniture (clef/key restatement, barline,
        // labels, brackets) so the galley reads as one continuous system.
        let seam_continuation = chunked && sys_idx > 0;
        let margin_left = if sys_idx == 0 {
            plan.margin_left_first
        } else if chunked {
            galley_x
        } else {
            plan.margin_left_subseq
        };
        margins.push(margin_left);

        let sys_measure_indices: Vec<usize> = sys_vis_indices
            .iter()
            .map(|&vi| mmr.visible_indices[vi])
            .collect();

        // Membership has reconverged and no measure in this system belongs to
        // the dirty island. Config changes invalidate the store before this
        // point, so the prior whole-system layout can move back immediately —
        // no staff/measure signature walk, spacing solve, or compound hashing.
        if sys_retain {
            let prior_sys_idx = reusable_system_sources
                .and_then(|sources| sources.get(sys_idx))
                .copied()
                .flatten();
            if let Some(mut entry) = prior_sys_idx
                .and_then(|index| old_sys_layouts.get_mut(index))
                .and_then(Option::take)
            {
                let delta = margin_left - entry.margin_left;
                if delta != 0.0 {
                    for staff_layouts in &mut entry.all_staff_layouts {
                        for measure_layout in staff_layouts {
                            measure_layout.translate_x(delta);
                        }
                    }
                }
                if chunked {
                    galley_x = entry
                        .all_staff_layouts
                        .iter()
                        .filter_map(|staff| staff.last())
                        .map(|measure| measure.x + measure.width)
                        .fold(galley_x, f64::max);
                }
                sys_signatures.push(entry.signature);
                if let Some(layout_cache) = cache.as_deref_mut() {
                    layout_cache.bump_system_layout_reuse();
                }
                layouts.push(entry.all_staff_layouts);
                content_hashes.push(entry.content_hashes);
                restore_meta.push(entry.restore_meta);
                continue;
            }
        }

        // Compute justified widths
        let natural_total: f64 = sys_measure_indices
            .iter()
            .map(|&mi| budget.max_widths.get(mi).copied().unwrap_or(0.0))
            .sum();
        let content_width = if sys_idx == 0 {
            plan.content_width_first
        } else {
            plan.content_width_subseq
        };
        let avail_w = content_width.unwrap_or(natural_total);

        let system_object_staves = compute_system_object_staves(group_ranges, flat_staves.len());

        // Phase G/H: cache the per-system output of `compute_system_spacing`
        // (the per-measure log-spacing solver, dominant cost in the precompute
        // pass on warm rebuilds). The signature folds in everything the solver
        // depends on: the system's measure indices + each measure's content
        // hash (read from the natural-widths cache, NOT recomputed) + sp +
        // common_shortest_beats + chunked. Any signature mismatch — content
        // edit, re-break, config change — falls through to a fresh compute.
        let mut sys_sig_hasher = DefaultHasher::new();
        let _t_sig = now_ms!();
        sys_idx.hash(&mut sys_sig_hasher);
        sys_measure_indices.hash(&mut sys_sig_hasher);
        sp.to_bits().hash(&mut sys_sig_hasher);
        budget
            .common_shortest_beats
            .to_bits()
            .hash(&mut sys_sig_hasher);
        chunked.hash(&mut sys_sig_hasher);
        if sys_measure_indices.iter().any(|&mi| {
            all_staff_resolved
                .first()
                .and_then(|resolved| resolved.get(mi))
                .is_some_and(|measure| measure.global.time.is_some())
        }) {
            time_signature_aware_hash(0, true, config.time_signature_settings)
                .hash(&mut sys_sig_hasher);
        }
        let mut sig_complete = true;
        'sig: for &mi in &sys_measure_indices {
            // The natural-widths pass before us populates content hashes for
            // every (measure, staff) pair; any missing entry (cold cache, MMR
            // interior we don't render) forces the safe fall-through path.
            // `natural_widths` is keyed by `cache_key = mi * 1000 + staff_idx`.
            for staff_idx in 0..flat_staves.len() {
                let key = mi * 1000 + staff_idx;
                match cache
                    .as_deref()
                    .and_then(|c| c.natural_width_content_hash(key))
                {
                    Some(h) => h.hash(&mut sys_sig_hasher),
                    None => {
                        sig_complete = false;
                        break 'sig;
                    }
                }
            }
        }
        let sys_signature = sys_sig_hasher.finish();
        if timing_on {
            t_sig += now_ms!() - _t_sig;
        }

        let _t_solver = now_ms!();
        let (merged_spacings, mut sys_prefix_widths) = if sig_complete
            && cache
                .as_deref()
                .and_then(|c| c.get_cached_system_spacing(sys_idx, sys_signature))
                .is_some()
        {
            // Cache hit: splice merged_spacings + sys_prefix_widths from the
            // prior pass. The solver is skipped entirely.
            let cached = cache
                .as_deref()
                .and_then(|c| c.get_cached_system_spacing(sys_idx, sys_signature))
                .expect("cache hit just confirmed");
            let out = (
                cached.merged_spacings.clone(),
                cached.sys_prefix_widths.clone(),
            );
            if let Some(c) = cache.as_deref_mut() {
                c.bump_system_spacing_reuse();
            }
            out
        } else {
            let out = compute_system_spacing(
                all_staff_resolved,
                &sys_measure_indices,
                sp,
                budget.common_shortest_beats,
                config,
                // Auto-flow already resolves only the layout's staves, so every
                // entry of `all_staff_resolved` is shown — no filter needed.
                None,
            );
            if sig_complete {
                if let Some(c) = cache.as_deref_mut() {
                    c.set_cached_system_spacing(
                        sys_idx,
                        cache::CachedSystemSpacing {
                            signature: sys_signature,
                            merged_spacings: out.0.clone(),
                            sys_prefix_widths: out.1.clone(),
                        },
                    );
                }
            }
            out
        };
        if timing_on {
            t_solver += now_ms!() - _t_solver;
        }

        // On a stitched seam the first measure is mid-galley, not a true system
        // start: recompute its prefix with `is_system_start = false` so it
        // reserves no clef/key restatement width. This makes its width — and
        // therefore every following measure's x — match the single-system
        // layout byte-for-byte (and zeroes `first_extra_prefix` below).
        if seam_continuation {
            if let Some(slot) = sys_prefix_widths.first_mut() {
                if let Some(&first_mi) = sys_measure_indices.first() {
                    *slot = compute_max_prefix_width(
                        all_staff_resolved
                            .iter()
                            .filter_map(|resolved| resolved.get(first_mi)),
                        sp,
                        false,
                        config,
                    );
                }
            }
        }

        // The first measure on a system carries a clef + key-signature prefix
        // (re-drawn at the head of every system) that the natural-width budget —
        // computed from standalone measures with their mid-stream prefix — never
        // reserved. Left unreserved, the proportional stretch hands this measure
        // the same total width as an identical mid-system measure, and the
        // oversized system-start prefix eats the note area, cramming the notes
        // (e.g. a bar of 4 quarters landing first on a system rendered nearly
        // touching while identical mid-system bars breathed). Reserve only the
        // *extra* prefix (system-start minus the natural prefix already budgeted)
        // as fixed overhead off the top, stretch the remainder proportionally,
        // then hand the reserved width back to the first measure. Standard
        // engraving practice: clef/key "furniture" is fixed, not stretchable.
        let first_extra_prefix = match sys_measure_indices.first() {
            Some(&first_mi) => {
                let sys_start_prefix = sys_prefix_widths.first().copied().unwrap_or_default().width;
                let natural_prefix = compute_max_prefix_width(
                    all_staff_resolved
                        .iter()
                        .filter_map(|resolved| resolved.get(first_mi)),
                    sp,
                    false,
                    config,
                )
                .width;
                (sys_start_prefix - natural_prefix).max(0.0)
            }
            None => 0.0,
        };

        let scale = if natural_total > 0.0 && config.page_width.is_some() && avail_w > 0.0 {
            if crate::layout::system::should_preserve_natural_final_width(
                natural_total,
                avail_w,
                sys_idx == system_count - 1,
            ) {
                1.0
            } else {
                (avail_w - first_extra_prefix).max(1.0) / natural_total
            }
        } else {
            1.0
        };

        // Step 4 (B-full): the whole-system layout signature. `sys_signature`
        // already folds the system's measure membership + per-measure content
        // hashes + sp + common_shortest_beats + chunked; we extend it with the
        // remaining inputs that determine the assembled per-measure geometry —
        // the width-stretch factor `scale`, the fixed `first_extra_prefix`, the
        // seam flag, and `system_count` (which selects the last-system scale
        // special case). `margin_left` is intentionally EXCLUDED: it only
        // x-translates the whole system, handled by the reuse-path shift.
        // `merged_spacings`/`sys_prefix_widths` are not folded directly because
        // they are produced by the spacing solver under this same
        // `sys_signature`, so a signature match implies identical spacing too.
        let layout_signature = {
            let mut h = DefaultHasher::new();
            sys_signature.hash(&mut h);
            scale.to_bits().hash(&mut h);
            first_extra_prefix.to_bits().hash(&mut h);
            seam_continuation.hash(&mut h);
            system_count.hash(&mut h);
            h.finish()
        };
        sys_signatures.push(layout_signature);

        // Step 4 (B-full) wholesale reuse: when the per-system store is enabled
        // and the cached entry's signature matches, the entire system is moved
        // back in and uniformly x-translated by the margin delta (0 in paged
        // mode) — skipping the per-measure reuse loop, the compound-hash
        // recompute, and the cross-staff fix entirely. Byte-identical because a
        // matching signature guarantees every measure would have reused
        // unchanged on the per-measure path (and the fresh==reuse invariant
        // holds), with only a rigid x-shift between passes.
        let mut prior_dirty_system = if sys_retain {
            old_sys_layouts.get_mut(sys_idx).and_then(Option::take)
        } else {
            None
        };
        if let Some(entry) = prior_dirty_system.as_ref() {
            if entry.signature == layout_signature {
                let mut entry = prior_dirty_system.take().expect("matching retained system");
                let _t_reuse = now_ms!();
                let delta = margin_left - entry.margin_left;
                if delta != 0.0 {
                    for staff_layouts in entry.all_staff_layouts.iter_mut() {
                        for ml in staff_layouts.iter_mut() {
                            ml.translate_x(delta);
                        }
                    }
                }
                if chunked {
                    galley_x = entry
                        .all_staff_layouts
                        .iter()
                        .filter_map(|s| s.last())
                        .map(|ml| ml.x + ml.width)
                        .fold(galley_x, f64::max);
                }
                if timing_on {
                    t_reuse += now_ms!() - _t_reuse;
                }
                if let Some(c) = cache.as_deref_mut() {
                    c.bump_system_layout_reuse();
                }
                layouts.push(entry.all_staff_layouts);
                content_hashes.push(entry.content_hashes);
                restore_meta.push(entry.restore_meta);
                continue;
            }
        }

        let (mut prior_staff_layouts, prior_staff_restore) = if let Some(entry) = prior_dirty_system
        {
            (
                entry
                    .all_staff_layouts
                    .into_iter()
                    .map(|staff| staff.into_iter().map(Some).collect())
                    .collect::<Vec<Vec<Option<MeasureLayout>>>>(),
                entry.restore_meta,
            )
        } else {
            (Vec::new(), Vec::new())
        };

        // ── Assembly: reuse retained measures (move) or build fresh ──
        // The cross-staff fix is a whole-system O(events) scan. When every
        // measure in the system is reused unchanged, the stored measures already
        // carry the fix from when they were last built fresh, and that fix is
        // translation-invariant — so the scan can be skipped entirely. Any fresh
        // (or compound-hash-changed) measure clears the flag and forces it.
        let mut system_all_reused = retain || !prior_staff_layouts.is_empty();
        let mut all_staff_layouts: Vec<Vec<MeasureLayout>> = Vec::with_capacity(flat_staves.len());
        let mut all_staff_hashes: Vec<Vec<u64>> = Vec::with_capacity(flat_staves.len());
        let mut all_staff_restore: Vec<Vec<(usize, u64)>> = Vec::with_capacity(flat_staves.len());
        for (staff_idx, flat_staff) in flat_staves.iter().enumerate() {
            // Ottavas are only needed to lay a measure out fresh; on the reuse
            // path (the common case during editing) they are never read, so
            // compute them lazily — `resolve_all_ottavas` scans the whole staff
            // and, run per-staff-per-system every pass, would dominate the warm
            // cost otherwise.
            let mut staff_ottavas: Option<Vec<ResolvedOttavaRange>> = None;
            let mut sys_x = margin_left;
            let mut measure_layouts = Vec::with_capacity(sys_measure_indices.len());
            let mut measure_hashes: Vec<u64> = Vec::with_capacity(sys_measure_indices.len());
            let mut measure_restore: Vec<(usize, u64)> =
                Vec::with_capacity(sys_measure_indices.len());

            for (si, &mi) in sys_measure_indices.iter().enumerate() {
                let rm = &all_staff_resolved[staff_idx][mi];
                let forced_width = budget.max_widths.get(mi).copied().unwrap_or(10.0) * scale
                    + if si == 0 { first_extra_prefix } else { 0.0 }
                    + if start_clef_change_measures.contains(&mi) {
                        1.2 * sp
                    } else {
                        0.0
                    };
                let fw = Some(forced_width);
                let fp = sys_prefix_widths.get(si).copied();
                let _t_hash = now_ms!();
                // Phase G/H: reuse the per-(measure, staff) content hash that
                // `compute_natural_measure_widths` just computed and stored in
                // the natural-widths cache, instead of redoing the per-measure
                // serde JSON serialize here. Falls back to computing fresh on
                // cold-cache misses (rare; MMR-interior measures, first pass).
                let nw_key = mi * 1000 + staff_idx;
                let content_hash = cache
                    .as_deref()
                    .and_then(|c| c.natural_width_content_hash(nw_key))
                    .unwrap_or_else(|| measure_content_hash(rm));
                let content_hash = time_signature_aware_hash(
                    content_hash,
                    rm.global.time.is_some(),
                    config.time_signature_settings,
                );
                let prefix = fp.unwrap_or_default();
                let empty_beats: Vec<f64> = Vec::new();
                let pmcb = sys_clef_beats.get(&mi).map_or(&empty_beats[..], |v| &v[..]);
                let compound_hash = compound_layout_hash(
                    content_hash,
                    forced_width,
                    &merged_spacings[si],
                    prefix,
                    pmcb,
                );
                // Stable per-(measure, staff) key; survives edits to other
                // measures so an unchanged measure can be moved back in.
                let cache_key = 2_000_000 + mi * 1000 + staff_idx;
                if timing_on {
                    t_hash += now_ms!() - _t_hash;
                }

                let _t_asm = now_ms!();
                // Reuse only when the trusted compound key matches; a stale
                // entry is removed (evicted) by `remove` regardless.
                let partial_reused = prior_staff_restore
                    .get(staff_idx)
                    .and_then(|staff| staff.get(si))
                    .filter(|&&(prior_key, prior_hash)| {
                        prior_key == cache_key && prior_hash == compound_hash
                    })
                    .and_then(|_| {
                        prior_staff_layouts
                            .get_mut(staff_idx)
                            .and_then(|staff| staff.get_mut(si))
                            .and_then(Option::take)
                    });
                let reused = if partial_reused.is_none() && retain {
                    old_measures
                        .remove(&cache_key)
                        .filter(|m| m.compound_hash == compound_hash)
                } else {
                    None
                };
                let was_reused = partial_reused.is_some() || reused.is_some();

                let mut ml = if let Some(mut layout) = partial_reused {
                    let delta = sys_x - layout.x;
                    if delta != 0.0 {
                        layout.translate_x(delta);
                    }
                    if let Some(layout_cache) = cache.as_deref_mut() {
                        layout_cache.bump_system_measure_reuse();
                    }
                    layout
                } else if let Some(entry) = reused {
                    // Move the retained measure in. It is stored at its prior
                    // final x; shift by the delta (0 when upstream widths are
                    // unchanged → byte-identical) instead of re-cloning. The
                    // stored `resolved` is this same measure's from the prior
                    // pass (cache_key is measure+staff scoped), so it is moved
                    // back in too — no deep ResolvedMeasure clone.
                    let trailing_barline_extra =
                        crate::layout::render_barlines::trailing_barline_extra_width(
                            &entry.resolved,
                            config,
                            sp,
                        );
                    let mut ml = MeasureLayout {
                        x: entry.x,
                        width: entry.width,
                        resolved: entry.resolved,
                        voice_layouts: entry.voice_layouts,
                        prefix_width: entry.prefix_width,
                        first_onset_padding: entry.first_onset_padding,
                        time_signature_x_offset: entry.time_signature_x_offset,
                        trailing_barline_extra,
                        mid_clef_changes: entry.mid_clef_changes,
                        multimeasure_rest_count: None,
                        multimeasure_rest_label: None,
                        part_index: 0,
                        is_first_on_system: false,
                        show_system_objects: true,
                        is_first_staff: false,
                    };
                    let delta = sys_x - ml.x;
                    if delta != 0.0 {
                        ml.translate_x(delta);
                    }
                    ml
                } else {
                    system_all_reused = false;
                    let staff_ottavas = staff_ottavas
                        .get_or_insert_with(|| resolve_all_ottavas(&all_staff_resolved[staff_idx]));
                    let mut ml = layout_measure_with_shared_spacing(
                        rm,
                        sp,
                        0.0,
                        config,
                        fw,
                        staff_ottavas,
                        budget.common_shortest_beats,
                        &merged_spacings[si],
                        fp,
                        pmcb,
                        si == 0,
                    );
                    ml.translate_x(sys_x);
                    ml
                };
                if timing_on {
                    if was_reused {
                        t_reuse += now_ms!() - _t_asm;
                    } else {
                        t_fresh += now_ms!() - _t_asm;
                    }
                }

                if let Some(&count) = mmr.start_map.get(&mi) {
                    ml.multimeasure_rest_count = Some(count);
                    ml.multimeasure_rest_label = mmr_label_map.get(&mi).cloned();
                }
                ml.part_index = flat_staff.sources.first().map_or(0, |s| s.part_index);
                // On a stitched seam, the first measure is NOT a system start —
                // matching the single-system layout where only global measure 0
                // is first-on-system. This suppresses the render-side clef/key
                // restatement and system-start measure number.
                ml.is_first_on_system = si == 0 && !seam_continuation;
                ml.show_system_objects = system_object_staves.contains(&staff_idx);
                ml.is_first_staff = staff_idx == 0;
                sys_x += ml.width;

                measure_hashes.push(content_hash);
                measure_restore.push((cache_key, compound_hash));
                measure_layouts.push(ml);
            }
            all_staff_layouts.push(measure_layouts);
            all_staff_hashes.push(measure_hashes);
            all_staff_restore.push(measure_restore);
        }

        // Fix cross-staff note positions. The fix recomputes note positions
        // from source and sets idempotent flags, so re-applying it to reused
        // (already-fixed) measures reproduces the same geometry — letting a mix
        // of fresh and moved-in measures end up byte-identical to a full-fresh
        // pass. Skipped when the whole system was reused unchanged (the stored
        // measures already carry the translation-invariant fix).
        let _t_cs = now_ms!();
        if !system_all_reused {
            let vs: Vec<(usize, u32)> = flat_staves
                .iter()
                .map(|fs| {
                    let pi = fs.sources.first().map_or(0, |s| s.part_index);
                    let sn = fs.sources.first().and_then(|s| s.staff_number).unwrap_or(1);
                    (pi, sn)
                })
                .collect();
            fix_cross_staff_note_positions(&mut all_staff_layouts, &vs, sp, config);
        }
        if timing_on {
            t_crossstaff += now_ms!() - _t_cs;
        }

        // Advance the galley origin to the right edge of this chunk so the next
        // chunk abuts it seamlessly (continuous-x). Computed before the move
        // into `layouts` below.
        if chunked {
            galley_x = all_staff_layouts
                .iter()
                .filter_map(|s| s.last())
                .map(|ml| ml.x + ml.width)
                .fold(galley_x, f64::max);
        }

        layouts.push(all_staff_layouts);
        content_hashes.push(all_staff_hashes);
        restore_meta.push(all_staff_restore);
    }

    // Phase G/H: drop trailing cached system-spacing entries beyond the
    // current system count so a layout that shrinks the system list doesn't
    // leave stale tail entries.
    if let Some(c) = cache {
        c.truncate_cached_system_spacings(system_count);
    }

    // Emit the sub-timing buckets once (each `record_split` reconstructs the
    // accumulated duration via `now - bucket`). These nest under the parent
    // "pass1 precompute_system_layouts" split recorded by the caller.
    if timing_on {
        let n = crate::timing::now_ms();
        crate::timing::record_split("  precompute.sig_hash", n - t_sig);
        crate::timing::record_split("  precompute.solver", n - t_solver);
        crate::timing::record_split("  precompute.hash", n - t_hash);
        crate::timing::record_split("  precompute.reuse_move", n - t_reuse);
        crate::timing::record_split("  precompute.fresh_build", n - t_fresh);
        crate::timing::record_split("  precompute.crossstaff", n - t_crossstaff);
    }

    PrecomputedSystems {
        layouts,
        margins,
        content_hashes,
        restore_meta,
        sys_signatures,
    }
}

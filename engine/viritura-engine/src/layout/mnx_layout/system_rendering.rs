#![allow(clippy::too_many_arguments, clippy::too_many_lines, unused_imports)]

use super::super::*;
use super::inter_staff_barlines::render_inter_staff_barlines;
use super::render_hashing::*;
use super::resolve_condensing::ResolvedStaffSnapshot;
use super::retained_segments::*;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) struct SystemRenderContext<'a> {
    pub dl: &'a mut DisplayList,
    pub score: &'a Score,
    pub config: &'a LayoutConfig,
    pub flat_staves: &'a [FlatStaff],
    pub group_ranges: &'a [GroupRange],
    pub systems: &'a [Vec<usize>],
    pub visible_indices: &'a [usize],
    pub precomp_margins: &'a [f64],
    pub system_y_positions: &'a [f64],
    pub precomp_layouts: &'a [Vec<Vec<MeasureLayout>>],
    pub precomp_content_hashes: &'a [Vec<Vec<u64>>],
    pub prior_system_indices: &'a [Option<usize>],
    pub reusable_system_sources: &'a [Option<usize>],
    pub dirty_systems: &'a [bool],
    pub gaps_stable: &'a [bool],
    pub justified_gaps: &'a [f64],
    pub intra_clearances: &'a [f64],
    pub all_staff_resolved: &'a [ResolvedStaffSnapshot],
    pub chunked_global_offsets: Option<&'a StaffYPlacement>,
    pub prior_staff_y_rel: &'a [Vec<f64>],
    pub fresh_staff_y_rel: &'a mut [Vec<f64>],
    pub dbg_bottom_staff_y: &'a mut Vec<f64>,
    pub dbg_staff_pairs: &'a mut Vec<Vec<crate::render::StaffPairDebug>>,
    pub global_slur_events: &'a mut Vec<super::super::slurs::GlobalSlurEvent>,
    pub global_tie_notes: &'a mut Vec<super::super::ties::GlobalTieNote>,
    pub slur_bounds: &'a mut HashMap<(usize, usize, usize), super::super::slurs::SystemSlurBounds>,
    pub old_retained: &'a mut HashMap<u64, cache::RetainedSegment>,
    pub new_retained: &'a mut HashMap<u64, cache::RetainedSegment>,
    pub prev_order: &'a [u64],
    pub prev_order_map: &'a HashMap<u64, usize>,
    pub patch_placements: &'a mut Vec<cache::SystemPlacement>,
    pub patch_order: &'a mut Vec<u64>,
    pub patch_valid: &'a mut bool,
    pub global_tie_maps: Option<&'a [HashMap<String, bool>]>,
    pub clef_change_measures: &'a HashSet<usize>,
    pub lyric_line_order: Option<&'a [String]>,
    pub render_salt: u64,
    pub clef_change_hash: u64,
    pub sp: f64,
    pub staff_height: f64,
    pub barline_w: f64,
    pub page_w: f64,
    pub total_height: f64,
    pub system_count: usize,
    pub chunked: bool,
    pub retention_enabled: bool,
    pub skip_enabled: bool,
    pub patch_skip_append_safe: bool,
    pub ret_hits: &'a mut usize,
    pub ret_misses: &'a mut usize,
    pub render_hash_skips: &'a mut usize,
    pub staff_content_reuses: &'a mut usize,
    pub staff_content_reuse_runs: &'a mut usize,
}

pub(super) fn render_auto_flow_systems(context: SystemRenderContext<'_>) {
    let SystemRenderContext {
        dl,
        score,
        config,
        flat_staves,
        group_ranges,
        systems,
        visible_indices,
        precomp_margins,
        system_y_positions,
        precomp_layouts,
        precomp_content_hashes,
        prior_system_indices,
        reusable_system_sources,
        dirty_systems,
        gaps_stable,
        justified_gaps,
        intra_clearances,
        all_staff_resolved,
        chunked_global_offsets,
        prior_staff_y_rel,
        fresh_staff_y_rel,
        dbg_bottom_staff_y,
        dbg_staff_pairs,
        global_slur_events,
        global_tie_notes,
        slur_bounds,
        old_retained,
        new_retained,
        prev_order,
        prev_order_map,
        patch_placements,
        patch_order,
        patch_valid,
        global_tie_maps,
        clef_change_measures,
        lyric_line_order,
        render_salt,
        clef_change_hash,
        sp,
        staff_height,
        barline_w,
        page_w,
        total_height,
        system_count,
        chunked,
        retention_enabled,
        skip_enabled,
        patch_skip_append_safe,
        ret_hits: _ret_hits,
        ret_misses: _ret_misses,
        render_hash_skips,
        staff_content_reuses,
        staff_content_reuse_runs,
    } = context;
    for (sys_idx, _sys_vis_indices) in systems.iter().enumerate() {
        let margin_left = precomp_margins[sys_idx];
        let sys_y_base = system_y_positions[sys_idx];
        let all_staff_layouts = &precomp_layouts[sys_idx];
        let current_x0 = all_staff_layouts
            .first()
            .and_then(|staff| staff.first())
            .map_or(margin_left, |measure| measure.x);

        // Lever 1: this system is "clean" — provably byte-identical to last
        // pass — when the break plan is stable, its OWN justification
        // (`justified_gap` + `intra_clearance`) is unchanged, it lies outside
        // the patch's dirty range, and its successor is also clean (its render
        // hash folds the next system's courtesy clef). The successor only needs
        // unchanged *content* (covered by `dirty_systems[i+1]`), not unchanged
        // gaps — its gaps affect its own hash, not this system's. Drives BOTH
        // the staff-offset reuse below and the render-hash reuse further down.
        // Exact prior membership is also useful for the DIRTY system: it lets
        // that system recover unchanged staff layers around the edited staff.
        // Whole-system skipping below still requires `reusable_system_sources`
        // (which excludes the dirty island).
        let prior_sys_idx = prior_system_indices[sys_idx];
        let reusable_prior_sys_idx = reusable_system_sources[sys_idx];
        let successor_stable = sys_idx + 1 >= system_count
            || (reusable_system_sources[sys_idx + 1].is_some() && !dirty_systems[sys_idx + 1]);
        let skippable = skip_enabled
            && reusable_prior_sys_idx.is_some()
            && gaps_stable[sys_idx]
            && !dirty_systems[sys_idx]
            && successor_stable;

        // Stitched-horizon chunks after the first carry no system-start
        // furniture (barline, brackets, labels) and no courtesy clef on the
        // prior chunk, so the galley reads as one continuous system.
        let seam_continuation = chunked && sys_idx > 0;

        // ── Phase 2: Compute dynamic staff Y offsets based on content ──
        //
        // Page-fit's `system_heights_px` pre-simulates `content_y.max(standard_y)`
        // per pair, so the sum here can never exceed the page allotment.
        // Using `content_y.max(standard_y)` lets the system reclaim space when
        // content is shorter than the upper-bound estimate.
        let StaffYPlacement {
            offsets: staff_y_offsets,
            pair_debug: sys_pair_dbg,
        } = if let Some(global) = chunked_global_offsets {
            (*global).clone()
        } else if let Some(rel) = prior_sys_idx
            .and_then(|index| prior_staff_y_rel.get(index))
            .filter(|_| skippable)
            .filter(|rel| rel.len() == flat_staves.len())
        {
            // Lever 1: clean system — its protrusions and justification are
            // unchanged, so its relative staff offsets are byte-identical to
            // last pass. Reconstruct the absolute offsets without re-running the
            // O(staves × measures) protrusion scan. `pair_debug` is empty here,
            // which is sound because retention (hence this skip) is disabled
            // whenever `emit_layout_debug` is on.
            StaffYPlacement {
                offsets: rel.iter().map(|r| r + sys_y_base).collect(),
                pair_debug: Vec::new(),
            }
        } else {
            let staff_view: Vec<Vec<&MeasureLayout>> = all_staff_layouts
                .iter()
                .map(|measures| measures.iter().collect())
                .collect();
            compute_staff_y_offsets_for_system(
                &staff_view,
                flat_staves,
                group_ranges,
                sys_y_base,
                justified_gaps[sys_idx],
                intra_clearances[sys_idx],
                sp,
                staff_height,
                config,
                false, // auto-flow path never squish-clamps (page-fit pre-simulates)
            )
        };

        let shared_staff_offsets_stable = !chunked
            || reusable_prior_sys_idx
                .and_then(|index| prior_staff_y_rel.get(index))
                .filter(|prior| prior.len() == staff_y_offsets.len())
                .is_some_and(|prior| {
                    let base = staff_y_offsets.first().copied().unwrap_or(0.0);
                    prior
                        .iter()
                        .zip(&staff_y_offsets)
                        .all(|(old, current)| old.to_bits() == (current - base).to_bits())
                });

        // Stash this system's relative offsets for the next pass. Stitched
        // Horizon repeats the shared vector per chunk so a clean chunk can
        // prove that reusing its prior hash will not retain stale staff rows.
        if !staff_y_offsets.is_empty() {
            if let Some(slot) = fresh_staff_y_rel.get_mut(sys_idx) {
                *slot = staff_y_offsets.iter().map(|y| y - sys_y_base).collect();
            }
        }

        if config.emit_layout_debug {
            dbg_bottom_staff_y.push(staff_y_offsets.last().copied().unwrap_or(sys_y_base));
            dbg_staff_pairs.push(sys_pair_dbg);
        }

        // ΓöÇΓöÇ Phase 3: render staff lines + per-staff contents + slur capture ΓöÇΓöÇ
        // Precompute next-system courtesy clef per staff: look up the first
        // visible measure of the next system in this staff's resolved measures.
        let next_sys_mi: Option<usize> = if chunked {
            // No courtesy clef at a stitched seam — the next chunk continues the
            // same galley row.
            None
        } else {
            systems
                .get(sys_idx + 1)
                .and_then(|next_vis| next_vis.first())
                .map(|&vi| visible_indices[vi])
        };
        let next_sys_clef_per_staff: Vec<Option<&Clef>> = (0..flat_staves.len())
            .map(|staff_idx| {
                next_sys_mi.and_then(|next_mi| {
                    all_staff_resolved
                        .get(staff_idx)
                        .and_then(|rms| rms.get(next_mi))
                        .and_then(|rm| rm.part.clefs.as_ref())
                        .and_then(|clefs| clefs.iter().find(|c| c.position.is_none()))
                        .map(|pc| &pc.clef)
                })
            })
            .collect();

        // Phase 1 segmentation: render this system into its own segment, then
        // `dl.append(seg)`. `DisplayList::append` re-bases shape command
        // indices, so the assembled list is byte-identical to rendering
        // straight into `dl`. Skyline read-backs (hairpins/pedals/slurs) stay
        // correct because the loop never queries future systems and
        // vertically-disjoint prior systems are filtered out by the query's
        // y_ref.
        //
        // Segment retention: when a system is unchanged from the previous pass
        // (same render-identity hash), reuse its rendered segment — rigidly
        // shifted by Δy — instead of re-rendering. The slur-capture pass still
        // runs for reused systems so `global_slur_events` / `slur_bounds` stay
        // byte-identical for the cross-system slur post-pass.
        let render_hash = if retention_enabled && !staff_y_offsets.is_empty() {
            // Lever 1 skip: a clean system (see `skippable` above) reuses its
            // prior-pass hash instead of re-walking its measures.
            if skippable && shared_staff_offsets_stable {
                *render_hash_skips += 1;
                Some(
                    prev_order[reusable_prior_sys_idx.expect("skippable system has a prior index")],
                )
            } else {
                Some(system_render_hash(
                    all_staff_layouts,
                    &precomp_content_hashes[sys_idx],
                    &staff_y_offsets,
                    &next_sys_clef_per_staff,
                    margin_left,
                    sys_idx,
                    sys_idx == system_count - 1,
                    render_salt,
                ))
            }
        } else {
            None
        };

        if let Some(hash) = render_hash {
            if let Some(retained) = old_retained.remove(&hash) {
                *_ret_hits += 1;
                let dx = current_x0 - retained.rendered_x0;
                let dy = staff_y_offsets[0] - retained.rendered_y0;

                // Phase M: prefer the cached slur/tie collection output over
                // re-running `collect_system_slur_data`. Saves ~5-15 µs per
                // staff × 285 reused systems × N staves on Rhapsody. Falls
                // back to fresh collection when the cache predates Phase M
                // (`slur_data: None`).
                if let Some(slur_data) = retained.slur_data.as_ref() {
                    splice_retained_slur_data(
                        slur_data,
                        dx,
                        dy,
                        slur_bounds,
                        global_slur_events,
                        global_tie_notes,
                    );
                } else {
                    collect_system_slur_data(
                        all_staff_layouts,
                        flat_staves,
                        &staff_y_offsets,
                        margin_left,
                        sp,
                        config,
                        sys_idx,
                        slur_bounds,
                        global_slur_events,
                        global_tie_notes,
                    );
                }
                if *patch_valid {
                    match prev_order_map.get(&hash) {
                        Some(&prev_index) => {
                            patch_placements.push(cache::SystemPlacement::Reuse {
                                prev_index,
                                dx,
                                dy,
                            });
                            patch_order.push(hash);
                        }
                        // The retained segment exists but the prior pass didn't
                        // record a system order for this hash. This happens when
                        // the seed was a *cached* full layout
                        // (`compute_full_score_layout_cached`): it populates
                        // `retained_segments` but isn't patch-frame-enabled, so
                        // `last_system_order` stays empty. Rather than invalidate
                        // the whole frame (which would fall back to a full decode
                        // forever, since the invalidation path also clears the
                        // order), emit this reused system as a Fresh placement
                        // carrying its segment at its current position. That
                        // re-seeds the order so the NEXT edit can Reuse properly —
                        // the first post-seed patch is effectively all-Fresh
                        // (one large frame), exactly like the first patch after a
                        // non-cached `full_layout`.
                        None => {
                            let mut fresh_seg = retained.segment.as_ref().clone();
                            if dx != 0.0 || dy != 0.0 {
                                fresh_seg.translate(dx, dy);
                            }
                            patch_placements.push(cache::SystemPlacement::Fresh {
                                segment: Arc::new(fresh_seg),
                            });
                            patch_order.push(hash);
                        }
                    }
                }
                // Phase K: on the patch path the assembled full `dl` is thrown
                // away (the wasm entry returns only the patch frame), so the
                // expensive clone + translate + append is pure waste for
                // reused systems. Skip it when `patch_skip_append_safe` holds
                // (every system in this layout will have a render_hash, so
                // `patch_valid` cannot flip false mid-loop and leave us with
                // a corrupted `dl`).
                if !patch_skip_append_safe || !*patch_valid {
                    let mut seg = retained.segment.as_ref().clone();
                    if dx != 0.0 || dy != 0.0 {
                        seg.translate(dx, dy);
                    }
                    dl.append(seg);
                }
                // Carry the original (untranslated) segment forward so the next
                // pass can reuse it again from its own rendered base.
                new_retained.insert(hash, retained);
                continue;
            }
        }

        *_ret_misses += 1;
        // A changed system has a new whole-system hash, but under stable break
        // membership its prior ordinal still names the exact same system. Take
        // that old segment so compact staff ranges can reuse an unchanged
        // prefix before the first staff whose identity differs.
        let prior_staff_source = prior_sys_idx
            .and_then(|index| prev_order.get(index))
            .and_then(|prior_hash| old_retained.remove(prior_hash));
        let mut seg = DisplayList::new(page_w, total_height);
        // Phase M: snapshot the global slur/tie/bounds stores so the fresh-
        // system render below can capture *just* this system's contribution
        // into the retained-segment cache. Events/notes appended after this
        // call must be sliced [pre_events_len..]; the bounds map can grow by
        // new keys only (insert-only API), so we record its key set and diff
        // by key after the call.
        let pre_events_len = global_slur_events.len();
        let pre_notes_len = global_tie_notes.len();
        let pre_bounds_keys: std::collections::HashSet<(usize, usize, usize)> =
            slur_bounds.keys().copied().collect();
        render_system_staff_lines(
            &mut seg,
            all_staff_layouts,
            flat_staves,
            &staff_y_offsets,
            margin_left,
            sp,
            config,
        );

        let mut accidental_obstacles: Vec<AccidentalObstacle> = Vec::new();
        let mut fresh_staff_layers = Vec::with_capacity(all_staff_layouts.len());
        let prior_layers = prior_staff_source
            .as_ref()
            .and_then(|retained| retained.staff_content_layers.as_ref());
        let independent_staff_layers = !system_has_cross_staff_events(all_staff_layouts);
        let staff_hashes: Vec<u64> = (0..all_staff_layouts.len())
            .map(|staff_idx| {
                staff_content_render_hash(
                    &all_staff_layouts[staff_idx],
                    &precomp_content_hashes[sys_idx][staff_idx],
                    &staff_y_offsets,
                    next_sys_clef_per_staff[staff_idx],
                    margin_left,
                    sys_idx,
                    staff_idx,
                    sys_idx == system_count - 1,
                    clef_change_hash,
                    render_salt,
                )
            })
            .collect();
        let mut prefix_reusable = prior_layers.is_some();
        let reusable_staffs: Vec<bool> = staff_hashes
            .iter()
            .enumerate()
            .map(|(staff_idx, hash)| {
                let matches = prior_layers
                    .and_then(|layers| layers.get(staff_idx))
                    .is_some_and(|layer| layer.render_hash == *hash);
                if !independent_staff_layers && !matches {
                    prefix_reusable = false;
                }
                matches && (independent_staff_layers || prefix_reusable)
            })
            .collect();

        let mut staff_idx = 0usize;
        while staff_idx < all_staff_layouts.len() {
            if reusable_staffs[staff_idx] {
                let run_start = staff_idx;
                let run_layer =
                    &prior_layers.expect("reusable staff requires prior layers")[run_start];
                let run_dx = current_x0 - run_layer.rendered_x0;
                let run_dy = staff_y_offsets[run_start] - run_layer.rendered_y;
                let mut run_end = run_start + 1;
                while run_end < all_staff_layouts.len()
                    && reusable_staffs[run_end]
                    && (current_x0 - prior_layers.unwrap()[run_end].rendered_x0).to_bits()
                        == run_dx.to_bits()
                    && (staff_y_offsets[run_end] - prior_layers.unwrap()[run_end].rendered_y)
                        .to_bits()
                        == run_dy.to_bits()
                {
                    run_end += 1;
                }
                if let (Some(source), Some(layers)) = (prior_staff_source.as_ref(), prior_layers) {
                    let source_start = layers[run_start].start;
                    let source_end = layers[run_end - 1].end;
                    if let Some(mut run_segment) = extract_display_list_range(
                        &source.segment,
                        source_start,
                        source_end,
                        page_w,
                        total_height,
                    ) {
                        let destination_start = display_list_store_marker(&seg);
                        if run_dx != 0.0 || run_dy != 0.0 {
                            run_segment.translate(-run_layer.rendered_x0, -run_layer.rendered_y);
                            run_segment.translate(current_x0, staff_y_offsets[run_start]);
                        }
                        seg.append(run_segment);
                        for layer_idx in run_start..run_end {
                            let layer = &layers[layer_idx];
                            debug_assert_eq!(
                                (staff_y_offsets[layer_idx] - layer.rendered_y).to_bits(),
                                run_dy.to_bits(),
                                "reused staff run must share one rigid system translation"
                            );
                            let translated_obstacles: Vec<_> = layer
                                .accidental_obstacles
                                .iter()
                                .map(|obstacle| AccidentalObstacle {
                                    visual_staff: obstacle.visual_staff,
                                    top: (obstacle.top - layer.rendered_y)
                                        + staff_y_offsets[layer_idx],
                                    bottom: (obstacle.bottom - layer.rendered_y)
                                        + staff_y_offsets[layer_idx],
                                    left: (obstacle.left - layer.rendered_x0) + current_x0,
                                    right: (obstacle.right - layer.rendered_x0) + current_x0,
                                    is_accidental: obstacle.is_accidental,
                                    alter: obstacle.alter,
                                })
                                .collect();
                            accidental_obstacles.extend(translated_obstacles.iter().copied());
                            fresh_staff_layers.push(cache::RetainedStaffContentLayer {
                                render_hash: staff_hashes[layer_idx],
                                rendered_x0: current_x0,
                                rendered_y: staff_y_offsets[layer_idx],
                                start: remap_store_marker(
                                    destination_start,
                                    layer.start,
                                    source_start,
                                ),
                                end: remap_store_marker(destination_start, layer.end, source_start),
                                accidental_obstacles: translated_obstacles,
                            });
                        }
                        *staff_content_reuses += run_end - run_start;
                        *staff_content_reuse_runs += 1;
                        staff_idx = run_end;
                        continue;
                    }
                }
            }

            let start = display_list_store_marker(&seg);
            let obstacle_start = accidental_obstacles.len();
            render_system_staff_content(
                &mut seg,
                all_staff_layouts,
                flat_staves,
                &staff_y_offsets,
                &next_sys_clef_per_staff,
                score,
                lyric_line_order,
                sp,
                config,
                sys_idx,
                system_count,
                chunked && sys_idx < system_count - 1,
                if chunked { 0 } else { sys_idx },
                clef_change_measures,
                global_tie_maps,
                staff_idx,
                &mut accidental_obstacles,
            );
            let end = display_list_store_marker(&seg);
            fresh_staff_layers.push(cache::RetainedStaffContentLayer {
                render_hash: staff_hashes[staff_idx],
                rendered_x0: current_x0,
                rendered_y: staff_y_offsets[staff_idx],
                start,
                end,
                accidental_obstacles: accidental_obstacles[obstacle_start..].to_vec(),
            });
            staff_idx += 1;
        }

        // System-wide pass: a harp/keyboard gliss can join two staves of one
        // part, so both endpoints must be visible to one call. It is emitted
        // outside the retained per-staff layers because it belongs to no
        // single staff.
        let gliss_staves: Vec<super::super::glissando::GlissandoStaff<'_>> = all_staff_layouts
            .iter()
            .enumerate()
            .map(|(idx, layouts)| (layouts.as_slice(), staff_y_offsets[idx]))
            .collect();
        super::super::render_glissandos(
            &mut seg,
            &gliss_staves,
            sp,
            config,
            Some(&staff_y_offsets),
        );
        collect_system_slur_data(
            all_staff_layouts,
            flat_staves,
            &staff_y_offsets,
            margin_left,
            sp,
            config,
            sys_idx,
            slur_bounds,
            global_slur_events,
            global_tie_notes,
        );
        // Phase M: capture this system's contribution to the slur/tie collection
        // for later splicing on reuse. We only build the cache when this system
        // will have a `render_hash` (the cache key); other systems pay no cost.
        let fresh_slur_data: Option<cache::RetainedSlurData> = if render_hash.is_some() {
            let new_events = global_slur_events[pre_events_len..].to_vec();
            let new_notes = global_tie_notes[pre_notes_len..].to_vec();
            let mut new_bounds: Vec<(
                (usize, usize, usize),
                super::super::slurs::SystemSlurBounds,
            )> = Vec::new();
            for (&k, &v) in slur_bounds.iter() {
                if !pre_bounds_keys.contains(&k) {
                    new_bounds.push((k, v));
                }
            }
            Some(cache::RetainedSlurData {
                bounds: new_bounds,
                events: new_events,
                notes: new_notes,
            })
        } else {
            None
        };

        if flat_staves.len() > 1 {
            if let Some(first_layouts) = all_staff_layouts.first() {
                render_inter_staff_barlines(
                    &mut seg,
                    first_layouts,
                    &staff_y_offsets,
                    group_ranges,
                    staff_height,
                    sp,
                    config,
                    sys_idx == system_count - 1,
                    clef_change_measures,
                    chunked && sys_idx < system_count - 1,
                );
            }

            // System start barline — suppressed at a stitched seam so the galley
            // shows no internal system-start barline.
            if !staff_y_offsets.is_empty() && !seam_continuation {
                let system_top = staff_y_offsets[0];
                let system_bottom =
                    staff_y_offsets.last().copied().unwrap_or(system_top) + staff_height;
                seg.push(RenderCommand::DrawLine {
                    x1: margin_left,
                    y1: system_top,
                    x2: margin_left,
                    y2: system_bottom,
                    width: barline_w * 1.5,
                    color: "#000000".into(),
                });
            }

            // Render group brackets and braces — suppressed at a stitched seam.
            if !seam_continuation {
                render_group_brackets_and_braces(
                    &mut seg,
                    group_ranges,
                    &staff_y_offsets,
                    margin_left,
                    staff_height,
                    sp,
                    config,
                    true, // auto-flow path renders brace labels on every system
                );
            }

            // Render staff labels. Single-staff layouts (a part / solo score)
            // carry no margin gutter, so skip the instrument name there to
            // match `plan_system_breaks` and avoid drawing over the music.
            // Suppressed at a stitched seam (no per-chunk label restatement).
            if flat_staves.len() > 1 && !seam_continuation {
                render_staff_labels(
                    &mut seg,
                    flat_staves,
                    group_ranges,
                    &staff_y_offsets,
                    margin_left - 2.8 * sp,
                    staff_height,
                    sp,
                    sys_idx,
                    config
                        .text_styles
                        .resolve(crate::layout::text_styles::TextRole::StaffLabel),
                );
            }
        }

        // Group-spanning meters: drawn once per bracket group here, where the
        // staves' final positions are known. The per-staff prefix reserved the
        // slot but engraved nothing under this style.
        crate::layout::time_signatures::spanning::render_system_group_meters(
            &mut seg,
            all_staff_layouts,
            group_ranges,
            &staff_y_offsets,
            config,
        );

        // Retain this freshly-rendered segment (keyed by its render identity)
        // so an unchanged later pass can reuse it without re-rendering.
        //
        // On a valid patch path the assembled full `dl` is discarded by WASM,
        // just as it is for reused systems above. Keep one clone for retention
        // and move the original segment directly into the Fresh placement;
        // this avoids both a second deep clone and an O(segment) append into a
        // list that no caller observes. The precomputed safety gate guarantees
        // `patch_valid` cannot fail after an earlier system was omitted.
        if let Some(hash) = render_hash {
            let shared_segment = Arc::new(seg);
            new_retained.insert(
                hash,
                cache::RetainedSegment {
                    rendered_x0: current_x0,
                    rendered_y0: staff_y_offsets[0],
                    segment: Arc::clone(&shared_segment),
                    // Phase M: carry the captured slur/tie data so the reuse
                    // path can splice it instead of re-collecting.
                    slur_data: fresh_slur_data,
                    staff_content_layers: Some(fresh_staff_layers),
                },
            );
            if *patch_valid {
                patch_order.push(hash);
                if patch_skip_append_safe {
                    patch_placements.push(cache::SystemPlacement::Fresh {
                        segment: shared_segment,
                    });
                    continue;
                }
                patch_placements.push(cache::SystemPlacement::Fresh {
                    segment: Arc::clone(&shared_segment),
                });
            }
            seg = shared_segment.as_ref().clone();
        } else if *patch_valid {
            // No render identity ⇒ cannot describe this system as a delta.
            *patch_valid = false;
        }

        dl.append(seg);
    }
}

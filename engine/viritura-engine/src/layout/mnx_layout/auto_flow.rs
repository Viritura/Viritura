// File-private to the `mnx_layout` folder module.
// Imports mirror the original `mnx_layout.rs` top block, adjusted for the
// extra folder hop (super::super::… to reach the `layout` module).

#![allow(unused_imports)]

use super::super::cache::{self, measure_content_hash};
use super::super::condensing::{
    analyze_merge_mode, find_partial_unison_onset_beat, find_unison_onset_beat,
    label_for_mode_styled, LabelStyle, MergeMode,
};
use super::super::config::LayoutConfig;
use super::super::full_score::{
    compute_system_object_staves, layout_full_score, FlatSource, FlatStaff, GroupRange,
};
use super::super::measure::*;
use super::super::page::*;
use super::super::page::{render_page_numbers, render_title_block, title_block_height};
use super::super::page_turn;
use super::super::render_barlines::render_barline_connector;
use super::super::resolve::*;
use super::super::spacing::LogSpacing;
use super::super::spacing::*;
use super::super::system::*;
use super::super::types::*;
use super::super::{
    compute_above_staff_extra, compute_below_staff_extra_from_layouts, render_system_contents,
};
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use super::break_planning::*;
use super::measure_widths::*;
use super::mmr_grouping::*;
use super::page_turn_planning::*;
use super::render_hashing::*;
use super::render_setup::*;
use super::resolve_condensing::*;
use super::retained_segments::*;
use super::shared::*;
use super::system_extras::*;
use super::system_precompute::*;
use super::system_rendering::*;

/// Per-staff resolve pass: for every flat staff, walk the score's measures
/// building [`ResolvedMeasure`]s (virtual part measures with clef carry-forward
/// and transposed key signatures), then place condensing labels (`a 2`, `1.`,
/// `Unis.`, `Div.`, etc.) using both same-measure and look-back-onto-previous-
/// measure rules. Pure data-flow leaf ΓÇö no `DisplayList` writes, no cache.
/// Turn time (seconds) of the boundary *after* each visible-measure position,
/// for rest-aware system breaking. Returns `None` unless page turns are enabled
/// for a single-part paged layout. Structural/fermata boundaries score 0 so the
/// breaker never aligns a turn onto them.
#[allow(clippy::too_many_lines)] // automatic-flow pipeline currently coordinates extracted phase modules
pub(super) fn layout_auto_flow_mnx_score(
    score: &Score,
    config: &LayoutConfig,
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
    mmr_start_map: &HashMap<usize, u32>,
    skip_measures: &HashSet<usize>,
    mmr_label_map: &HashMap<usize, String>,
    use_written: bool,
    mut dirty_region: Option<cache::DirtyRegion>,
    mut cache: Option<&mut cache::LayoutCache>,
) -> DisplayList {
    let sp = config.sp;
    let staff_height = 4.0 * sp;
    let barline_w = config.barline_width * sp;
    let measure_count = score.global.measures.len();

    // Resolve the model-part mask against the active flattened layout. This is
    // deliberately computed after flattening: condensed, divisi, expansion,
    // and cross-staff layouts may map one part to multiple visible staves or
    // several parts to one staff. Marking every FlatStaff whose source set
    // intersects the patch's parts is conservative and captures all of them.
    if let Some(region) = dirty_region.as_mut() {
        region.affected_flat_staves = flat_staves
            .iter()
            .map(|staff| {
                staff
                    .sources
                    .iter()
                    .any(|source| region.affects_part(source.part_index))
            })
            .collect();
    }
    let dirty_range = dirty_region.as_ref().map(cache::DirtyRegion::measure_range);

    // P1 plumbing: `dirty_range` is the range carried forward from
    // `apply_patch_and_layout_*` (taken from the cache + cleared by the
    // top-level entry point that called us). Threaded into the front-half
    // passes that support range-scoping (Phase A `resolve_staves` below; B–D
    // will follow). Each scoped pass calls
    // [`LayoutCache::effective_dirty_range`] itself with the same `K` guard,
    // so a `None` here ⇒ full path everywhere.

    // Phase A: hoist `check_config` to the top of the pass so a config change
    // invalidates the resolve cache *before* resolve writes a fresh entry. The
    // duplicate `check_config` inside `compute_natural_measure_widths` is a
    // no-op after this (config_hash already matches).
    if let Some(ref mut c) = cache {
        c.check_config(config);
    }

    // Env-gated phase timing probe (no-op unless VIRITURA_LAYOUT_TIMING is set).
    // NOTE: `Instant::now()` panics on wasm32-unknown-unknown ("time not
    // implemented on this platform"), so it must only ever be constructed when
    // timing is actually enabled — which it never is under wasm (`env::var`
    // returns `Err`). Hence the `Option`, not an eager `Instant::now()`.
    //
    // Phase Q+: in addition to the env-gated native eprintln, push splits
    // into `crate::timing` (WASM-safe; uses `js_sys::Date::now()` on
    // wasm32). The wasm wrapper drains those splits via
    // `take_collected_splits` to expose them to JS profilers without needing
    // a stderr (which doesn't exist in the browser).
    let timing = std::env::var("VIRITURA_LAYOUT_TIMING").is_ok();
    let mut _tck = if timing {
        Some(std::time::Instant::now())
    } else {
        None
    };
    // Independent of the env-gated native probe: collect WASM-safe splits
    // when the global `timing::is_enabled()` flag is on (the wasm wrapper
    // sets it via `set_wasm_timing`). On native this is also harmless —
    // tests can flip it on if they want machine-readable splits.
    let wasm_timing = crate::timing::is_enabled();
    let mut _wt_last = if wasm_timing {
        crate::timing::now_ms()
    } else {
        0.0
    };
    macro_rules! tick {
        ($label:expr) => {
            if timing {
                if let Some(t) = _tck {
                    eprintln!(
                        "[timing] {}: {:.2} ms",
                        $label,
                        t.elapsed().as_secs_f64() * 1000.0
                    );
                }
                _tck = Some(std::time::Instant::now());
            }
            if wasm_timing {
                // The label is a `&'static str` literal at every call site;
                // we pass it straight into `record_split` which keeps the
                // hot path allocation-free.
                crate::timing::record_split($label, _wt_last);
                _wt_last = crate::timing::now_ms();
            }
        };
    }

    // Phase A: resolve per-staff measures + place condensing labels. Threads
    // the dirty range so the cache-aware scoped path can engage when
    // `RangeScope::scoped_resolve` is on AND no staff is condensing AND a
    // prior cache exists. Falls back to full resolve otherwise.
    let ResolvedStaffSet {
        measures: all_staff_resolved,
        ottavas: all_staff_ottavas,
        duration_histogram,
    } = resolve_staves_with_condensing_labels(
        score,
        flat_staves,
        use_written,
        dirty_region.as_ref(),
        cache.as_deref_mut(),
    );

    // Phase B: MMR grouping (explicit map wins; else auto-detect)
    let mmr = resolve_mmr_grouping(
        config,
        &all_staff_resolved,
        mmr_start_map,
        skip_measures,
        measure_count,
        cache.as_deref_mut(),
    );
    tick!("  resolve_staves + mmr_grouping");

    // Phase C+D: natural measure widths (cache-aware) + duration data
    let budget = compute_natural_measure_widths(
        config,
        &all_staff_resolved,
        &all_staff_ottavas,
        &duration_histogram,
        &mmr,
        measure_count,
        dirty_region.as_ref(),
        cache.as_deref_mut(),
    );
    tick!("  natural_widths");

    // Phase E: label-aware baseline casting. Auto-paginated single parts then
    // evaluate alternate real boundaries over the retained natural-width
    // horizon while keeping this baseline system count fixed.
    let mut plan = plan_system_breaks(config, flat_staves, &budget, &mmr, cache.as_deref_mut());
    let title_height_px = title_block_height(score.metadata(), config);
    let natural_part_plan = globally_plan_part_systems(
        score,
        config,
        sp,
        flat_staves,
        &plan.systems,
        &budget.natural_widths,
        &mmr.visible_indices,
        plan.content_width_first,
        plan.content_width_subseq,
        title_height_px,
    );
    if let Some(global_plan) = &natural_part_plan {
        plan.systems.clone_from(&global_plan.systems);
    }
    tick!("  plan_system_breaks");

    // Stitched-horizon: un-paged view with a chunk width set. The galley is
    // split into chunks (above) but rendered as ONE continuous row — same y,
    // continuous x, seam furniture suppressed — so the output stays
    // byte-identical to the single-system galley.
    let chunked =
        config.page_width.is_none() && config.horizon_chunk_width.is_some_and(|w| w > 0.0);

    // Unpack into the local names the downstream pipeline expects (refs only,
    // so we can still pass `&mmr`/`&budget`/`&plan` to extracted helpers).
    let visible_indices = &mmr.visible_indices;
    let max_widths = &budget.max_widths;
    let natural_widths = &budget.natural_widths;
    let systems = &plan.systems;
    let margin_left_first = plan.margin_left_first;
    let margin_top = plan.margin_top;
    // One extra staff space covers glyph extents that rise just beyond the
    // standard 5sp galley headroom (for example an 8va glyph).
    let galley_offset_y = margin_top + sp;
    let base_margin_r = plan.base_margin_r;
    let inter_system_gap = plan.inter_system_gap;

    let system_count = systems.len();
    let prior_system_indices = cache
        .as_deref_mut()
        .map(|layout_cache| layout_cache.update_system_membership(systems))
        .unwrap_or_else(|| vec![None; system_count]);
    let reusable_system_sources: Vec<Option<usize>> = systems
        .iter()
        .enumerate()
        .map(|(system_index, system)| {
            let clean = dirty_range.is_some()
                && !system.iter().any(|&visible_index| {
                    let measure_index = visible_indices[visible_index];
                    matches!(dirty_range, Some((start, end)) if measure_index >= start && measure_index <= end)
                });
            clean.then(|| prior_system_indices[system_index]).flatten()
        })
        .collect();

    // Pass 1: pre-compute measure layouts for ALL systems so we can measure
    // actual below/above-staff protrusions before determining Y positions.
    let PrecomputedSystems {
        layouts: precomp_layouts,
        margins: precomp_margins,
        content_hashes: precomp_content_hashes,
        restore_meta: precomp_restore_meta,
        sys_signatures: precomp_sys_signatures,
    } = precompute_system_layouts(
        config,
        flat_staves,
        group_ranges,
        &all_staff_resolved,
        &mmr,
        mmr_label_map,
        &budget,
        &plan,
        chunked,
        Some(&reusable_system_sources),
        cache.as_deref_mut(),
    );
    tick!("pass1 precompute_system_layouts");

    // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
    // Per-system extras + content-aware heights (for page breaking).
    // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
    let SystemExtras {
        below_staff_extras,
        above_staff_extras,
        system_heights_px,
    } = compute_system_extras(
        &precomp_layouts,
        &precomp_content_hashes,
        sp,
        config,
        staff_height,
        Some(&reusable_system_sources),
        cache.as_deref_mut(),
    );

    let extras_pairs: Vec<(f64, f64)> = above_staff_extras
        .iter()
        .zip(below_staff_extras.iter())
        .map(|(&a, &b)| (a, b))
        .collect();

    let AutoFlowPages {
        pages,
        intentional_blank_pages,
        warnings: page_turn_warnings,
        hints: pt_hints,
        dedicated_title_page,
        system_y_positions,
        justified_gaps,
        intra_clearances,
    } = position_auto_flow_pages(
        score,
        config,
        flat_staves,
        systems,
        visible_indices,
        &system_heights_px,
        &extras_pairs,
        title_height_px,
        chunked,
        natural_part_plan.as_ref(),
    );

    // ── Stitched-horizon chunks: one global vertical metric ──
    //
    // Inter-staff gaps depend on per-staff content protrusion (lowest/highest
    // points across a system's measures). When the galley is split into render
    // chunks, computing offsets per chunk lets the bass staff land at a
    // different Y in each chunk (tamer content ⇒ tighter gap), so staff lines
    // stop being collinear across seams. Compute ONE offset vector from the
    // union of every chunk's measures (== the single-system content) and reuse
    // it for every chunk, so chunked output is byte-identical to single-system.
    //
    // Computed here (before `total_height`) so the galley paper is sized from
    // the SAME global offsets that position the staves — see the chunked branch
    // of `total_height` below.
    let chunked_global_offsets: Option<StaffYPlacement> = if chunked {
        if config.emit_layout_debug {
            let staff_count = flat_staves.len();
            let mut global_view: Vec<Vec<&MeasureLayout>> = vec![Vec::new(); staff_count];
            for sys in &precomp_layouts {
                for (s, staff_measures) in sys.iter().enumerate() {
                    if s < staff_count {
                        global_view[s].extend(staff_measures.iter());
                    }
                }
            }
            Some(compute_staff_y_offsets_for_system(
                &global_view,
                flat_staves,
                group_ranges,
                system_y_positions.first().copied().unwrap_or(margin_top),
                justified_gaps[0],
                intra_clearances[0],
                sp,
                staff_height,
                config,
                false,
            ))
        } else {
            Some(compute_chunked_global_offsets(
                &precomp_layouts,
                flat_staves,
                group_ranges,
                dirty_region.as_ref(),
                system_y_positions.first().copied().unwrap_or(margin_top),
                justified_gaps[0],
                intra_clearances[0],
                sp,
                staff_height,
                config,
                cache.as_deref_mut(),
            ))
        }
    } else {
        None
    };

    let page_w = config.page_width.unwrap_or_else(|| {
        let total_natural: f64 = natural_widths.iter().sum();
        margin_left_first + total_natural + config.margin_right * sp
    });
    let total_height = if config.page_width.is_some() && pages.len() > 1 {
        pages.last().map_or(0.0, |p| p.y_offset + p.height)
    } else if config.page_width.is_some() && !chunked {
        // Single paged page: span the full page so the canvas contains
        // vertically-justified systems spread to the page bottom.
        pages.last().map_or(0.0, |p| p.y_offset + p.height)
    } else if chunked {
        // One galley row regardless of chunk count. Staves are placed with
        // `chunked_global_offsets` (built from the UNION of every chunk's
        // measures), so a tall passage anywhere in the galley pushes every
        // staff down. Per-chunk `system_heights_px` only sees its own measures
        // and would under-size the paper, letting the lowest staves overflow
        // below it. Size the galley from that SAME global offset vector plus
        // the worst-case above/below protrusion across all chunks, mirroring
        // the single-system slack semantics (`2·margin_top + system_height`).
        let go = chunked_global_offsets
            .as_ref()
            .expect("chunked ⇒ chunked_global_offsets is Some");
        let first_staff_y = go.offsets.first().copied().unwrap_or(margin_top);
        let global_intra = go.offsets.last().copied().unwrap_or(first_staff_y) - first_staff_y;
        let global_above = above_staff_extras.iter().copied().fold(0.0f64, f64::max);
        let global_below = below_staff_extras.iter().copied().fold(0.0f64, f64::max);
        // Preserve a full lower margin after applying the fixed galley offset.
        margin_top * 4.0 + sp + staff_height + global_intra + global_below + global_above
    } else {
        let max_sys_h = system_heights_px.iter().copied().fold(0.0f64, f64::max);
        // Preserve a full lower margin after applying the fixed galley offset.
        margin_top * 4.0
            + sp
            + system_count as f64 * max_sys_h
            + if system_count > 1 {
                (system_count - 1) as f64 * inter_system_gap
            } else {
                0.0
            }
    };

    let mut dl = DisplayList::new(page_w, total_height);

    render_head(
        &mut dl,
        score,
        config,
        &pages,
        page_w,
        dedicated_title_page,
        sp,
        &intentional_blank_pages,
    );

    let lyric_line_order = score
        .global
        .lyrics
        .as_ref()
        .and_then(|gl| gl.line_order.as_deref());

    // Debug capture: per-system staff-pair gap reasoning + bottom-staff Y.
    let mut dbg_staff_pairs: Vec<Vec<crate::render::StaffPairDebug>> = if config.emit_layout_debug {
        Vec::with_capacity(system_count)
    } else {
        Vec::new()
    };
    let mut dbg_bottom_staff_y: Vec<f64> = if config.emit_layout_debug {
        Vec::with_capacity(system_count)
    } else {
        Vec::new()
    };

    // Accumulators for the cross-system slur post-pass. `render_system_contents`
    // calls per-staff `render_slurs`, which silently drops slurs whose target
    // lives in a different system; we capture all events globally here and
    // render the cross-system slurs as two half-beziers after the loop ends.
    let mut global_slur_events: Vec<super::super::slurs::GlobalSlurEvent> = Vec::new();
    let mut global_tie_notes: Vec<super::super::ties::GlobalTieNote> = Vec::new();
    let mut slur_bounds: HashMap<(usize, usize, usize), super::super::slurs::SystemSlurBounds> =
        HashMap::new();

    // ── Render-segment retention ────────────────────────────────────────────
    // Score-global render inputs that don't vary between systems are folded
    // into a salt mixed into every system's render-identity hash, so a change
    // to any of them busts all retained segments.
    let render_salt = score_render_salt(
        sp,
        staff_height,
        barline_w,
        lyric_line_order,
        flat_staves,
        group_ranges,
    );

    // Stitched-horizon only: build a GLOBAL per-staff tie-accidental suppression
    // map across every chunk, so a tie crossing a chunk seam keeps its
    // accidental suppressed (a per-chunk map can't see the target note in the
    // next chunk and would spuriously restate the accidental at the seam). For
    // non-chunked layouts each system already renders all its measures in one
    // pass, so the per-system map is already global — `None` there.
    let (global_tie_maps, global_tie_maps_reused) = horizon_tie_maps(
        chunked,
        dirty_region.as_ref(),
        flat_staves,
        &precomp_layouts,
        cache.as_deref_mut(),
    );

    // Fold the global tie maps into the segment-retention salt so a tie edit at
    // a seam (which changes the suppression of a note in a DIFFERENT chunk than
    // the edited source note) correctly invalidates the affected segment — the
    // target measure's own content hash wouldn't otherwise change.
    let render_salt = salt_with_tie_maps(render_salt, global_tie_maps.as_ref());

    // Drain last pass's retained segments; survivors are re-inserted into a
    // fresh map (so reflowed systems can't leak across the session). Disabled in
    // debug-emit mode to avoid mixing debug/non-debug segments.
    let retention_enabled = cache.is_some() && !config.emit_layout_debug;
    let mut old_retained = cache
        .as_deref_mut()
        .map(|c| c.take_retained_segments())
        .unwrap_or_default();
    let mut new_retained: HashMap<u64, cache::RetainedSegment> = HashMap::new();

    // Patch-frame delta recording. Enabled when explicitly requested (note-input
    // path), retention is active, and the layout is either paged OR chunked
    // horizon. Plain (unchunked) horizon is excluded: it's one monolithic
    // system, so there's nothing to reuse. Chunked horizon ships per-chunk
    // segments at their PRE-fit y; the constant galley vertical offset
    // (`fit_unpaged_bounds`'s shift, now a config constant) is carried as the
    // patch frame's `galley_offset_y` scalar and applied by the client at
    // assembly — keeping the engine's per-chunk coordinates stable across edits.
    let patch_enabled = retention_enabled
        && (config.page_width.is_some() || chunked)
        && cache
            .as_deref()
            .map(|c| c.patch_frame_enabled())
            .unwrap_or(false);
    let prev_order_map: HashMap<u64, usize> = if patch_enabled {
        cache
            .as_deref()
            .map(|c| {
                c.last_system_order()
                    .iter()
                    .enumerate()
                    .map(|(i, &h)| (h, i))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        HashMap::new()
    };
    let mut patch_placements: Vec<cache::SystemPlacement> = Vec::new();
    let mut patch_order: Vec<u64> = Vec::new();
    let mut patch_valid = patch_enabled;

    // ── Stitched-horizon chunks: one global vertical metric ──
    //
    // `chunked_global_offsets` is computed earlier (just before `total_height`)
    // so the galley paper can be sized from the same global offset vector that
    // positions the staves. Reused unchanged for every chunk here.

    tick!("pass2 Yalloc+extras+pageturn+retention-setup");

    // Phase K: precondition for the "skip dl.append on reuse path when
    // patch_enabled" optimization. The optimization is unsafe if `patch_valid`
    // might flip false mid-loop — then the assembled `dl` would have gaps in
    // place of the skipped reuses and the fall-back to a full frame would
    // ship corrupted output. `patch_valid` only flips false when a system
    // has no `render_hash`, which requires `staff_y_offsets.is_empty()`. We
    // can detect that up front from precomp_layouts: if any system has zero
    // staves, the optimization is disabled and we fall back to the
    // clone+translate+append path on the reuse branch.
    let patch_skip_append_safe = patch_enabled
        && precomp_layouts
            .iter()
            .all(|sys| sys.first().is_some_and(|s| !s.is_empty()));

    // Patch prefix: at this point `dl` holds only the head content rendered
    // before the per-system loop (title block / title page, page numbers).
    // Snapshot it so reconstruction can prepend it ahead of the system
    // placements. Cheap — the head is a handful of commands.
    let patch_prefix = if patch_enabled {
        Some(dl.clone())
    } else {
        None
    };

    let mut _ret_hits = 0usize;
    let mut _ret_misses = 0usize;

    // ── Lever 1: per-region render-hash skip ─────────────────────────────────
    // Recompute the system-break membership hash and compare it to the previous
    // pass. When it matches, *exactly the same measures land in exactly the same
    // systems* as last pass (a width-changing edit would shift a break and bust
    // the hash). Combined with the patch's dirty range, every system OUTSIDE
    // that range then has byte-identical Pass-1 output — the resolve,
    // natural-width, system-spacing (G/H) and extras (T) caches already
    // guarantee it — so its `system_render_hash` is provably unchanged. We reuse
    // it from `last_system_order` instead of re-walking the system's measures
    // (the dominant cost of this loop on a large score).
    //
    // A system is skippable only when both it AND its successor are clean,
    // because `system_render_hash` folds in the *next* system's courtesy clef.
    // The skip changes no layout data — it only avoids recomputing a hash of
    // data that is already identical — so the byte-identity oracle holds.
    //
    // The GLOBAL stability hash captures the inputs that, if changed, make
    // "clean" meaningless across the whole score:
    //   • break membership — which measures land in which system (a width edit
    //     moves a break and busts this);
    //   • per-system margins (`precomp_margins`).
    // The justification outputs `justified_gaps` + `intra_clearances` feed the
    // *relative* staff offsets inside each system and are the ONLY remaining
    // per-system input to a clean system's `system_render_hash`. They are
    // checked PER SYSTEM below (not folded into this global hash): a height-
    // changing edit (ledger lines, accidentals/dynamics above the staff)
    // re-justifies only the page(s) it lands on, so systems on UNAFFECTED pages
    // keep byte-identical gaps and stay skippable. Folding the whole vectors in
    // here would have disabled the skip globally on any single-page re-justify —
    // the dominant case for moving a note across ledger lines. (`system_y_positions`
    // only sets each segment's absolute base, i.e. the reuse `dy`, which is
    // recomputed every pass, so it is intentionally excluded.)
    let break_plan_hash = system_break_plan_hash(
        render_salt,
        systems,
        visible_indices,
        &precomp_margins,
        chunked,
    );
    let prev_order: Vec<u64> = cache
        .as_deref()
        .map(|c| c.last_system_order().to_vec())
        .unwrap_or_default();
    let _plan_stable = cache
        .as_deref_mut()
        .map(|c| c.update_break_plan_stability(break_plan_hash))
        .unwrap_or(false);
    // Per-system justification stability: a clean system is reusable only when
    // its OWN `(justified_gap, intra_clearance)` is byte-identical to last pass.
    // Compared via `to_bits` for exact equality. `false` for every system when
    // the prior vector is absent or a different length (cold cache / system
    // count changed).
    let prior_gaps: Vec<(f64, f64)> = cache
        .as_deref_mut()
        .map(|c| c.take_system_gaps())
        .unwrap_or_default();
    let fresh_gaps: Vec<(f64, f64)> = justified_gaps
        .iter()
        .zip(intra_clearances.iter())
        .map(|(&g, &c)| (g, c))
        .collect();
    let gaps_stable: Vec<bool> = fresh_gaps
        .iter()
        .enumerate()
        .map(|(sys_idx, cur)| {
            reusable_system_sources[sys_idx]
                .and_then(|prior_idx| prior_gaps.get(prior_idx))
                .is_some_and(|prev| {
                    cur.0.to_bits() == prev.0.to_bits() && cur.1.to_bits() == prev.1.to_bits()
                })
        })
        .collect();
    // Sound only when retention is on, the patch named a dirty range, and a
    // prior placement order exists. Per-system membership mapping below finds
    // the exact prior ordinal after an earlier width change reconverges.
    let skip_enabled = retention_enabled && dirty_range.is_some() && !prev_order.is_empty();
    // A system is dirty if any of its visible measures maps to a raw measure
    // index inside the patch's dirty range.
    let dirty_systems = dirty_system_flags(systems, visible_indices, dirty_range);
    let mut render_hash_skips = 0usize;
    // Lever 1: per-system relative staff offsets carried from the prior pass
    // (taken out so the loop can read them while rebuilding a fresh vector to
    // re-store). A clean system reuses its entry (reconstructing absolute
    // offsets as `rel + sys_y_base`), skipping the protrusion scan; every other
    // system recomputes and overwrites its slot.
    let prior_staff_y_rel: Vec<Vec<f64>> = cache
        .as_deref_mut()
        .map(|c| c.take_staff_y_rel())
        .unwrap_or_default();
    let mut fresh_staff_y_rel: Vec<Vec<f64>> = vec![Vec::new(); system_count];

    // Clef-change measure set scoped to the SHOWN staves (not the whole score):
    // a start-of-measure clef change shifts the shared barline, but only the
    // staves present in this layout share that barline. In an individual-part
    // view (`all_staff_resolved` holds just that part's staves) a clef change in
    // another part must NOT reserve a gap here. Used for both the inter-staff
    // connectors and the per-staff barlines/clefs/rehearsal marks so render and
    // the (already staff-scoped) width budget agree.
    let clef_change_measures =
        super::super::render_measure::clef_change_measure_set_resolved(&all_staff_resolved);
    let clef_change_hash = clef_change_hash(&clef_change_measures);
    let mut staff_content_reuses = 0usize;
    let mut staff_content_reuse_runs = 0usize;

    render_auto_flow_systems(SystemRenderContext {
        dl: &mut dl,
        score,
        config,
        flat_staves,
        group_ranges,
        systems,
        visible_indices,
        precomp_margins: &precomp_margins,
        system_y_positions: &system_y_positions,
        precomp_layouts: &precomp_layouts,
        precomp_content_hashes: &precomp_content_hashes,
        prior_system_indices: &prior_system_indices,
        reusable_system_sources: &reusable_system_sources,
        dirty_systems: &dirty_systems,
        gaps_stable: &gaps_stable,
        justified_gaps: &justified_gaps,
        intra_clearances: &intra_clearances,
        all_staff_resolved: &all_staff_resolved,
        chunked_global_offsets: chunked_global_offsets.as_ref(),
        prior_staff_y_rel: &prior_staff_y_rel,
        fresh_staff_y_rel: &mut fresh_staff_y_rel,
        dbg_bottom_staff_y: &mut dbg_bottom_staff_y,
        dbg_staff_pairs: &mut dbg_staff_pairs,
        global_slur_events: &mut global_slur_events,
        global_tie_notes: &mut global_tie_notes,
        slur_bounds: &mut slur_bounds,
        old_retained: &mut old_retained,
        new_retained: &mut new_retained,
        prev_order: &prev_order,
        prev_order_map: &prev_order_map,
        patch_placements: &mut patch_placements,
        patch_order: &mut patch_order,
        patch_valid: &mut patch_valid,
        global_tie_maps: global_tie_maps.as_deref(),
        clef_change_measures: &clef_change_measures,
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
        ret_hits: &mut _ret_hits,
        ret_misses: &mut _ret_misses,
        render_hash_skips: &mut render_hash_skips,
        staff_content_reuses: &mut staff_content_reuses,
        staff_content_reuse_runs: &mut staff_content_reuse_runs,
    });
    tick!("pass3 render loop");
    if timing {
        eprintln!(
            "[timing]   retention: hits={} misses={} (total systems={})",
            _ret_hits, _ret_misses, system_count
        );
    }

    let full_spanner_bound_count = slur_bounds.len();
    compact_cross_system_dependencies(
        &mut global_slur_events,
        &mut global_tie_notes,
        &mut slur_bounds,
        &mut new_retained,
    );

    // Install the rebuilt retention store for the next pass.
    if retention_enabled {
        if let Some(c) = cache.as_mut() {
            c.set_spanner_bound_counts(full_spanner_bound_count, slur_bounds.len());
            c.set_retained_segments(new_retained);
        }
    }
    if let Some(c) = cache.as_mut() {
        if let Some(maps) = global_tie_maps {
            c.set_horizon_tie_maps(maps, global_tie_maps_reused);
        }
        c.set_render_hash_skips(render_hash_skips);
        c.set_staff_content_reuses(staff_content_reuses);
        c.set_staff_content_reuse_runs(staff_content_reuse_runs);
        c.set_staff_y_rel(fresh_staff_y_rel);
        c.set_system_gaps(fresh_gaps);
    }

    // Capture the command/store lengths at the end of the per-system loop so
    // the global content appended below (cross-system slurs/ties, page-turn
    // hints) can be sliced out as a standalone `overlay` segment for the patch
    // frame — without perturbing the non-patch assembly (tail-slice is read-only
    // over `dl`). Paged-only, so `fit_unpaged_bounds` never runs here.
    let overlay_marker = if patch_valid {
        Some((
            dl.commands.len(),
            dl.element_ids.len(),
            dl.element_bboxes.len(),
            dl.element_shapes.len(),
            dl.slur_geometries.len(),
            dl.measure_bounds.len(),
        ))
    } else {
        None
    };

    // Phase R: cache the cross-system slur+tie overlay keyed on a complete hash
    // of its rendering inputs. Page-turn hints are deliberately NOT part of
    // this cache: they are cheap, have their own inputs, and must be rendered
    // exactly once per pass. (The former combined cache appended old hint
    // commands on a hit and then rendered current hints again.)
    // A patch-valid pass has one render identity per system. Those identities
    // already cover measure content (including slur/tie style + manual shape),
    // geometry, relative staff offsets, courtesy state, and the global render
    // salt. Hashing them here avoids a second O(all events/notes) identity
    // walk. Absolute system Y is added because `system_render_hash` deliberately
    // excludes rigid vertical translation while the overlay emits absolute Y.
    let overlay_signature: Option<u64> = patch_valid.then(|| {
        let mut h = DefaultHasher::new();
        patch_order.len().hash(&mut h);
        for hash in &patch_order {
            hash.hash(&mut h);
        }
        system_y_positions.len().hash(&mut h);
        for y in &system_y_positions {
            y.to_bits().hash(&mut h);
        }
        // Bounds — sort keys for deterministic hash since HashMap iteration
        // is undefined.
        let mut bound_keys: Vec<_> = slur_bounds.keys().copied().collect();
        bound_keys.sort();
        for k in &bound_keys {
            k.hash(&mut h);
            let b = slur_bounds[k];
            b.left_x.to_bits().hash(&mut h);
            b.right_x.to_bits().hash(&mut h);
        }
        // Continuation geometry differs at stitched-horizon chunk seams.
        chunked.hash(&mut h);
        sp.to_bits().hash(&mut h);
        h.finish()
    });

    let cached_overlay_hit: Option<DisplayList> = cache
        .as_deref()
        .and_then(|c| overlay_signature.and_then(|sig| c.get_cached_overlay(sig).cloned()));

    if let Some(overlay_dl) = cached_overlay_hit {
        // Splice only cached cross-system spanners. Current page-turn hints
        // are rendered below, exactly once.
        super::super::slurs::append_cross_system_overlay(&mut dl, overlay_dl, sp);
        tick!("  overlay (cached)");
    } else {
        super::super::ties::render_cross_system_ties(
            &mut dl,
            &global_tie_notes,
            &slur_bounds,
            sp,
            config,
            chunked,
        );
        tick!("  cross_system_ties");
        super::super::slurs::render_cross_system_slurs(
            &mut dl,
            &global_slur_events,
            &slur_bounds,
            sp,
            config,
            chunked,
        );
        tick!("  cross_system_slurs");

        // Store only the fresh cross-system tail. The patch-frame overlay
        // extracted later still includes both these commands and the current
        // page-turn hints; this smaller cache is solely the reusable expensive
        // post-pass.
        if let (Some(marker), Some(signature), Some(c)) =
            (overlay_marker, overlay_signature, cache.as_mut())
        {
            let cross_system_overlay = extract_overlay_segment(&dl, marker, page_w, total_height);
            c.set_cached_overlay(signature, cross_system_overlay);
        }
    }

    dl.pages = pages;
    dl.page_turn_warnings = page_turn_warnings;

    if config.page_width.is_some() && !pt_hints.is_empty() {
        crate::layout::render_measure::render_page_turn_hints(&mut dl, &pt_hints, page_w, config);
    }

    // Assemble + store the patch-frame delta (paged path only; the unpaged
    // `fit_unpaged_bounds` below never runs when `patch_valid`).
    if let (true, Some(marker)) = (patch_valid, overlay_marker) {
        let overlay = extract_overlay_segment(&dl, marker, page_w, total_height);
        let patch = cache::PatchFrame {
            width: dl.width,
            height: dl.height,
            // Chunked horizon ships per-chunk segments at their PRE-fit y; the
            // client adds this constant offset (the `fit_unpaged_bounds` shift)
            // at assembly so the result matches the full-frame galley. Paged
            // layouts position systems absolutely → 0.
            galley_offset_y: if config.page_width.is_none() {
                galley_offset_y
            } else {
                0.0
            },
            prefix: patch_prefix.unwrap_or_else(|| DisplayList::new(page_w, total_height)),
            placements: std::mem::take(&mut patch_placements),
            pages: dl.pages.clone(),
            overlay,
            page_turn_warnings: dl.page_turn_warnings.clone(),
        };
        if let Some(c) = cache.as_mut() {
            c.set_pending_patch(Some(patch));
            c.set_last_system_order(std::mem::take(&mut patch_order));
        }
    } else if patch_enabled {
        // Patch recording was requested but could not produce a valid delta
        // (e.g. a system lacked a render identity). Clear any stale frame so the
        // caller falls back to a full frame, and reset the recorded order.
        if let Some(c) = cache.as_mut() {
            c.set_pending_patch(None);
            c.set_last_system_order(Vec::new());
        }
    }

    if config.emit_layout_debug {
        use super::super::debug;
        let mut systems_dbg: Vec<crate::render::SystemDebug> = (0..system_count)
            .map(|sys_idx| {
                let staff_top = system_y_positions[sys_idx];
                let above_extra = above_staff_extras[sys_idx];
                let below_extra = below_staff_extras[sys_idx];
                let bottom_staff_y = dbg_bottom_staff_y[sys_idx];
                let top_staff = precomp_layouts[sys_idx]
                    .first()
                    .map(|s| s.as_slice())
                    .unwrap_or(&[]);
                let bottom_staff = precomp_layouts[sys_idx]
                    .last()
                    .map(|s| s.as_slice())
                    .unwrap_or(&[]);
                let x_start = top_staff.first().map_or(0.0, |ml| ml.x);
                let x_end = top_staff.last().map_or(x_start, |ml| ml.x + ml.width);
                let staff_bottom_y = bottom_staff_y + staff_height;
                crate::render::SystemDebug {
                    index: sys_idx,
                    page_index: debug::page_for_system(&dl.pages, sys_idx),
                    bbox_top_y: staff_top - above_extra,
                    staff_top_y: staff_top,
                    staff_bottom_y,
                    bbox_bottom_y: staff_bottom_y + below_extra,
                    x_start,
                    x_end,
                    above_extra,
                    above_breakdown: debug::above_breakdown(top_staff, sp, config.stem_length),
                    below_extra,
                    below_breakdown: debug::below_breakdown(bottom_staff, sp, config.stem_length),
                    measure_extremes: debug::measure_extremes(top_staff, sp, config.stem_length),
                    staff_pairs: dbg_staff_pairs.get(sys_idx).cloned().unwrap_or_default(),
                    measure_spacings: debug::measure_spacings(top_staff, |idx| {
                        max_widths.get(idx).copied()
                    }),
                    inter_system_gap_to_next: None,
                }
            })
            .collect();
        debug::link_inter_system_gaps(&mut systems_dbg, sp);
        dl.layout_debug = Some(crate::render::LayoutDebugInfo {
            systems: systems_dbg,
            sp,
            staff_height,
            min_note_spacing: config.min_note_spacing * sp,
            shortest_duration_space: config.shortest_duration_space * sp,
            spacing_increment: config.spacing_increment * sp,
            placement: debug::build_placement_debug(config, sp),
        });
    }

    tick!("slurs+ties+pages+debug");

    // Galley/horizon view: translate stores so above-staff protrusion fits inside
    // the white workspace, then trim width/height to tightly wrap actual content.
    // Skipped on the patch path: the patch frame is extracted PRE-fit and the
    // full `dl` is discarded, so running the O(commands) fit over it is wasted
    // work — the client applies the constant `galley_offset_y` at assembly.
    if config.page_width.is_none() && !patch_valid {
        fit_unpaged_bounds(&mut dl, galley_offset_y, base_margin_r);
    }

    // Re-store the assembled measures (keyed by their stable per-(measure,staff)
    // cache_key, carrying the compound hash as the next pass's reuse key) so an
    // unchanged measure can be *moved* back in instead of re-cloned. Each measure
    // is stored at its final x; the next pass shifts it by the new-vs-old x delta
    // (0 when upstream widths are unchanged → byte-identical). Placed after the
    // debug emission (the last reader of `precomp_layouts`); the
    // `!emit_layout_debug` gate and the debug block are mutually exclusive.
    //
    // Step 4 (B-full): when the per-system wholesale store is enabled, re-store
    // each assembled SYSTEM (keyed by `layout_signature`) instead of per-measure
    // — so the next pass can move a whole clean system back in. The two stores
    // are mutually exclusive (a single owner holds each assembled measure).
    let sys_reuse_enabled = cache
        .as_deref()
        .map(|c| c.system_layout_reuse_enabled())
        .unwrap_or(false);
    if cache.is_some() && !config.emit_layout_debug && sys_reuse_enabled {
        let mut new_sys_layouts: Vec<Option<cache::CachedSystemLayout>> =
            Vec::with_capacity(precomp_layouts.len());
        let zipped = precomp_layouts
            .into_iter()
            .zip(precomp_content_hashes)
            .zip(precomp_restore_meta)
            .zip(precomp_margins)
            .zip(precomp_sys_signatures);
        for ((((sys_layouts, sys_hashes), sys_restore), margin_left), signature) in zipped {
            new_sys_layouts.push(Some(cache::CachedSystemLayout {
                signature,
                margin_left,
                all_staff_layouts: sys_layouts,
                content_hashes: sys_hashes,
                restore_meta: sys_restore,
            }));
        }
        if let Some(c) = cache.as_mut() {
            c.set_cached_system_layouts(new_sys_layouts);
        }
    } else if cache.is_some() && !config.emit_layout_debug {
        // Phase N: pre-size to expected total so the HashMap doesn't rehash
        // through O(log N) doublings. The total is exactly `Σ Σ |staff_layouts|`
        // which equals (visible measures × staves) — we can upper-bound it from
        // the precomp shape cheaply.
        let measure_count_estimate: usize = precomp_layouts
            .iter()
            .map(|sys| sys.iter().map(|staff| staff.len()).sum::<usize>())
            .sum();
        let mut new_measures: HashMap<usize, cache::RetainedMeasure> =
            HashMap::with_capacity(measure_count_estimate);
        for (sys_layouts, sys_restore) in precomp_layouts.into_iter().zip(precomp_restore_meta) {
            for (staff_layouts, staff_restore) in sys_layouts.into_iter().zip(sys_restore) {
                for (ml, (cache_key, compound_hash)) in staff_layouts.into_iter().zip(staff_restore)
                {
                    new_measures.insert(
                        cache_key,
                        cache::RetainedMeasure {
                            compound_hash,
                            x: ml.x,
                            width: ml.width,
                            prefix_width: ml.prefix_width,
                            first_onset_padding: ml.first_onset_padding,
                            time_signature_x_offset: ml.time_signature_x_offset,
                            resolved: ml.resolved,
                            voice_layouts: ml.voice_layouts,
                            mid_clef_changes: ml.mid_clef_changes,
                        },
                    );
                }
            }
        }
        if let Some(c) = cache.as_mut() {
            c.set_retained_measures(new_measures);
        }
    }

    tick!("restore measures+fit");
    dl
}

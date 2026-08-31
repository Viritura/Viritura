#![allow(unused_imports)]

use super::super::condensing::*;
use super::super::*;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) type ResolvedStaffSnapshot = Arc<[ResolvedMeasure]>;
pub(super) struct ResolvedStaffSet {
    pub(super) measures: Vec<ResolvedStaffSnapshot>,
    pub(super) ottavas: Vec<Arc<[ResolvedOttavaRange]>>,
    pub(super) duration_histogram: DurationHistogram,
}

pub(super) fn build_resolved_staff_aux(
    resolved: &[ResolvedMeasure],
) -> (Arc<[ResolvedOttavaRange]>, DurationHistogram) {
    (
        resolve_all_ottavas(resolved).into(),
        collect_duration_histogram(resolved),
    )
}

pub(super) fn merge_duration_histogram(into: &mut DurationHistogram, from: &DurationHistogram) {
    for (target, value) in into.iter_mut().zip(from) {
        *target += *value;
    }
}

#[allow(clippy::too_many_lines)] // single resolve pass; natural extent exceeds the 200-line threshold
pub(super) fn resolve_staves_with_condensing_labels(
    score: &Score,
    flat_staves: &[FlatStaff],
    use_written: bool,
    dirty_region: Option<&cache::DirtyRegion>,
    mut cache: Option<&mut cache::LayoutCache>,
) -> ResolvedStaffSet {
    let measure_count = score.global.measures.len();
    let full_span = flat_staves.len() * measure_count;

    // Phase A scoped path is engaged only when (1) the cache exists, (2) the
    // `scoped_resolve` toggle is on, (3) a dirty range survives the `|dirty|>K`
    // guard, and (4) we hold a prior cache under the matching salt. Dirty
    // condensing staves still run a full per-staff resolve because their label
    // sequence depends on prior merge modes; unaffected condensing staves are
    // safe to reuse wholesale.
    let scope_on = cache
        .as_deref()
        .map(|c| c.range_scope().scoped_resolve)
        .unwrap_or(false);
    let effective_range = cache::LayoutCache::effective_dirty_range(
        dirty_region.map(cache::DirtyRegion::measure_range),
        measure_count,
        cache::DEFAULT_RANGE_SCOPE_K,
    );
    let salt = resolve_staves_salt(flat_staves, use_written, measure_count);
    let resolved_content_unchanged =
        dirty_region.is_some_and(|region| !region.flags.contains(cache::DirtyFlags::CONTENT));

    let prior_cache: Option<Vec<cache::CachedResolvedStaff>> =
        if scope_on && (effective_range.is_some() || resolved_content_unchanged) {
            cache
                .as_deref_mut()
                .and_then(|c| c.take_resolved_staves(salt))
        } else {
            None
        };

    // Phase O: convert `prior_cache` (Option<Vec<CachedResolvedStaff>>) into
    // a Vec<Option<...>> so we can `.take()` per-staff entries and pass them
    // by value into `resolve_staff_scoped`. Owned access lets the scoped path
    // move (not clone) the prefix/suffix ResolvedMeasures.
    let mut prior_cache_drain: Vec<Option<cache::CachedResolvedStaff>> = prior_cache
        .map(|v| v.into_iter().map(Some).collect())
        .unwrap_or_default();

    let mut resolved_span = 0usize;
    let mut staff_aux_reuses = 0usize;
    let mut all_staff_resolved: Vec<ResolvedStaffSnapshot> = Vec::with_capacity(flat_staves.len());
    let mut all_staff_ottavas: Vec<Arc<[ResolvedOttavaRange]>> =
        Vec::with_capacity(flat_staves.len());
    let mut duration_histogram = [0usize; 12];
    let mut fresh_cache: Vec<cache::CachedResolvedStaff> = Vec::with_capacity(flat_staves.len());

    for (staff_idx, flat_staff) in flat_staves.iter().enumerate() {
        // Compute transposition for this staff's primary part
        let (transposition, key_fifths_flip_at) =
            compute_flat_staff_transposition(flat_staff, score, use_written);

        // Decide scoped vs full for THIS staff. Scoped requires no condensing
        // for this staff AND a matching prior entry AND a surviving range.
        let prior_owned: Option<cache::CachedResolvedStaff> = prior_cache_drain
            .get_mut(staff_idx)
            .and_then(|slot| slot.take());
        let prior_valid = prior_owned.is_some()
            && prior_owned.as_ref().unwrap().resolved.len() == measure_count
            && prior_owned.as_ref().unwrap().transposition == transposition
            && prior_owned.as_ref().unwrap().key_fifths_flip_at == key_fifths_flip_at;
        let affected = dirty_region
            .map(|region| region.affects_flat_staff(staff_idx))
            .unwrap_or(true);

        if resolved_content_unchanged && prior_valid {
            let prior = prior_owned.expect("valid prior checked");
            let resolved = Arc::clone(&prior.resolved);
            let ottavas = Arc::clone(&prior.ottavas);
            merge_duration_histogram(&mut duration_histogram, &prior.duration_histogram);
            fresh_cache.push(prior);
            all_staff_resolved.push(resolved);
            all_staff_ottavas.push(ottavas);
            continue;
        }

        // The common orchestral fast path: a patch in one part leaves every
        // unrelated staff's complete resolved snapshot and carried-state cache
        // untouched. Arc cloning is pointer-only; no measure is visited.
        if scope_on && !affected && prior_valid {
            let prior = prior_owned.expect("valid prior checked");
            let resolved = Arc::clone(&prior.resolved);
            let ottavas = Arc::clone(&prior.ottavas);
            merge_duration_histogram(&mut duration_histogram, &prior.duration_histogram);
            fresh_cache.push(prior);
            all_staff_resolved.push(resolved);
            all_staff_ottavas.push(ottavas);
            continue;
        }

        let initial_state = cache::BoundaryState {
            active_time: TimeSignature::default(),
            active_key: KeySignature {
                fifths: 0,
                ..Default::default()
            },
            last_clef: None,
            prev_display_key: KeySignature::default(),
        };

        // Affected non-condensing staff: restart at the dirty boundary and stop
        // at carried-state convergence. `Arc::make_mut` in the helper is
        // zero-copy here because the prior pass's consumer snapshot is gone and
        // the cache owns the sole strong reference.
        if affected && !flat_staff.is_condensing() && prior_valid {
            let (dirty_start, dirty_end) = effective_range.expect("prior cache requires range");
            let prior = prior_owned.expect("valid prior checked");
            let (
                resolved,
                ottavas,
                staff_duration_histogram,
                staff_aux_reused,
                boundary_states,
                boundary_fps,
                this_span,
            ) = resolve_staff_scoped(
                score,
                flat_staff,
                transposition,
                key_fifths_flip_at,
                dirty_start,
                dirty_end,
                measure_count,
                prior,
            );
            resolved_span += this_span;
            staff_aux_reuses += usize::from(staff_aux_reused);
            merge_duration_histogram(&mut duration_histogram, &staff_duration_histogram);
            fresh_cache.push(cache::CachedResolvedStaff {
                resolved: Arc::clone(&resolved),
                ottavas: Arc::clone(&ottavas),
                duration_histogram: staff_duration_histogram,
                boundary_fps,
                boundary_states,
                initial_state,
                transposition,
                key_fifths_flip_at,
            });
            all_staff_resolved.push(resolved);
            all_staff_ottavas.push(ottavas);
            continue;
        }

        // Cold cache, full/global fallback, or an affected condensing staff.
        // Condensing labels depend on the complete merge-mode history, so the
        // conservative per-staff full pass is required until that history is
        // retained as a separate dependency node.
        let (mut resolved, boundary_states, boundary_fps, condensing_modes) = resolve_staff_full(
            score,
            flat_staff,
            transposition,
            key_fifths_flip_at,
            measure_count,
            &initial_state,
            scope_on,
        );
        resolved_span += measure_count;

        // Phase 2: condensing labels. Skip entirely for non-condensing staves
        // (the loop is a no-op — `mode` is `None` for every measure — so it's
        // safe to short-circuit). Phase A's scoped path only engages for
        // non-condensing staves, so skipping is correct on the fast path.
        if flat_staff.is_condensing() {
            apply_condensing_labels(
                &mut resolved,
                flat_staff,
                score,
                &condensing_modes,
                measure_count,
            );
        }
        let resolved: ResolvedStaffSnapshot = resolved.into();
        let (ottavas, staff_duration_histogram) = build_resolved_staff_aux(&resolved);
        merge_duration_histogram(&mut duration_histogram, &staff_duration_histogram);

        // Cache and current pass share the immutable measure slice. This keeps
        // the previously-expensive `resolved_mut.clone()` out of both cold and
        // scoped paths while preserving independent carried-state vectors.
        if scope_on {
            fresh_cache.push(cache::CachedResolvedStaff {
                resolved: Arc::clone(&resolved),
                ottavas: Arc::clone(&ottavas),
                duration_histogram: staff_duration_histogram,
                boundary_fps,
                boundary_states,
                initial_state,
                transposition,
                key_fifths_flip_at,
            });
        }

        all_staff_resolved.push(resolved);
        all_staff_ottavas.push(ottavas);
    }

    if scope_on {
        if let Some(c) = cache {
            c.set_resolved_staves(salt, fresh_cache);
            c.set_last_resolved_span(resolved_span, full_span);
            c.set_staff_aux_reuses(staff_aux_reuses);
        }
    }

    ResolvedStaffSet {
        measures: all_staff_resolved,
        ottavas: all_staff_ottavas,
        duration_histogram,
    }
}

/// Hash identifying the flat-staff layout structure. When this salt changes,
/// the cached resolve is dropped (different staff set, different transposition
/// regime, different measure count). Excludes per-measure content so an edit
/// preserves the salt.
pub(super) fn resolve_staves_salt(
    flat_staves: &[FlatStaff],
    use_written: bool,
    measure_count: usize,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    use_written.hash(&mut hasher);
    measure_count.hash(&mut hasher);
    flat_staves.len().hash(&mut hasher);
    for s in flat_staves {
        s.sources.len().hash(&mut hasher);
        for src in &s.sources {
            src.part_index.hash(&mut hasher);
            src.staff_number.hash(&mut hasher);
            src.voice_filter.hash(&mut hasher);
            src.stem_direction.hash(&mut hasher);
        }
    }
    hasher.finish()
}

/// Full per-staff Phase 1 resolve. Returns `(resolved, boundary_states,
/// boundary_fps, condensing_modes)`. When `track_state == false`, the
/// `boundary_states` and `boundary_fps` vectors are returned empty — saving
/// the per-measure JSON-into-hash cost (~20 ms total on Rhapsody) on the
/// today's full path where no future scoped resolve will consume them.
pub(super) fn resolve_staff_full(
    score: &Score,
    flat_staff: &FlatStaff,
    transposition: Option<(i32, i32)>,
    key_fifths_flip_at: Option<i32>,
    measure_count: usize,
    initial: &cache::BoundaryState,
    track_state: bool,
) -> (
    Vec<ResolvedMeasure>,
    Vec<cache::BoundaryState>,
    Vec<u64>,
    Vec<Option<MergeMode>>,
) {
    let mut state = initial.clone();
    let mut resolved = Vec::with_capacity(measure_count);
    let mut condensing_modes: Vec<Option<MergeMode>> = Vec::with_capacity(measure_count);
    let mut boundary_states: Vec<cache::BoundaryState> = if track_state {
        Vec::with_capacity(measure_count)
    } else {
        Vec::new()
    };
    let mut boundary_fps: Vec<u64> = if track_state {
        Vec::with_capacity(measure_count)
    } else {
        Vec::new()
    };
    for mi in 0..measure_count {
        let (rm, mode) = resolve_one_measure_phase1(
            mi,
            score,
            flat_staff,
            transposition,
            key_fifths_flip_at,
            &mut state,
        );
        resolved.push(rm);
        condensing_modes.push(mode);
        if track_state {
            boundary_states.push(state.clone());
            boundary_fps.push(cache::boundary_state_fingerprint(
                &state,
                transposition,
                key_fifths_flip_at,
            ));
        }
    }
    (resolved, boundary_states, boundary_fps, condensing_modes)
}

/// Output of [`resolve_staff_scoped`]: the same four arrays as
/// [`resolve_staff_full`] needed by a non-condensing staff (resolved measures,
/// boundary states, boundary fingerprints) plus the count of measures that
/// actually re-ran (the "resolved span").
pub(super) type ScopedResolveResult = (
    ResolvedStaffSnapshot,
    Arc<[ResolvedOttavaRange]>,
    DurationHistogram,
    bool,
    Vec<cache::BoundaryState>,
    Vec<u64>,
    usize,
);

/// Range-scoped per-staff Phase 1 resolve. Restarts at `dirty_start` from the
/// cached carried state, runs forward, and at each `mi >= dirty_end + 1`
/// compares the carried-state fingerprint against the cached one — on match
/// the suffix `[mi+1..]` is spliced from the cache verbatim and the pass
/// stops. Returns the same shape as [`resolve_staff_full`] plus the count of
/// measures that actually re-ran (the "resolved span") so the oracle can prove
/// non-vacuous engagement.
///
/// Phase O: `prior` is taken by VALUE so the prefix/suffix ResolvedMeasures
/// are MOVED (not cloned). The clone of a single ResolvedMeasure dominates the
/// per-call cost on Rhapsody (the PartMeasure carries Vec<Sequence>), so
/// avoiding it on the ~99% of measures that are unchanged is essential.
pub(super) fn resolve_staff_scoped(
    score: &Score,
    flat_staff: &FlatStaff,
    transposition: Option<(i32, i32)>,
    key_fifths_flip_at: Option<i32>,
    dirty_start: usize,
    dirty_end: usize,
    measure_count: usize,
    prior: cache::CachedResolvedStaff,
) -> ScopedResolveResult {
    let retained_ottavas = Arc::clone(&prior.ottavas);
    let mut duration_histogram = prior.duration_histogram;
    let mut ottavas_unchanged = true;
    // Restart state going INTO `dirty_start` is the cached boundary state
    // AFTER `dirty_start - 1` (or the initial state if `dirty_start == 0`).
    let mut state = if dirty_start == 0 {
        prior.initial_state.clone()
    } else {
        prior
            .boundary_states
            .get(dirty_start - 1)
            .cloned()
            .unwrap_or_else(|| prior.initial_state.clone())
    };

    // Phase O: move prior into mutable owned vectors so the prefix below is
    // a zero-cost truncate and the suffix is a zero-cost append-back. The
    // dirty range will be overwritten via index assignment.
    let mut resolved = prior.resolved;
    let mut boundary_states = prior.boundary_states;
    let mut boundary_fps = prior.boundary_fps;
    let resolved_mut = Arc::make_mut(&mut resolved);

    let mut converged_at: Option<usize> = None;
    for mi in dirty_start..measure_count {
        let (rm, mode) = resolve_one_measure_phase1(
            mi,
            score,
            flat_staff,
            transposition,
            key_fifths_flip_at,
            &mut state,
        );
        let old_duration = collect_duration_histogram(std::slice::from_ref(&resolved_mut[mi]));
        let new_duration = collect_duration_histogram(std::slice::from_ref(&rm));
        for ((total, old), new) in duration_histogram
            .iter_mut()
            .zip(old_duration)
            .zip(new_duration)
        {
            *total = total.saturating_sub(old) + new;
        }
        ottavas_unchanged &= resolved_mut[mi].part.ottavas == rm.part.ottavas;
        // Phase O: in-place overwrite of the cached entries for the re-run
        // range, instead of building parallel Vecs and clone-extending.
        resolved_mut[mi] = rm;
        debug_assert!(mode.is_none(), "scoped resolver is non-condensing only");
        boundary_states[mi] = state.clone();
        let fp = cache::boundary_state_fingerprint(&state, transposition, key_fifths_flip_at);
        let prior_fp = boundary_fps[mi];
        boundary_fps[mi] = fp;

        // Convergence check: only after we've crossed the dirty range. A
        // boundary fingerprint match means the carried state going INTO mi+1
        // matches the prior pass, so the suffix is byte-identical — already
        // in place (we wrote nothing past `mi`).
        if mi >= dirty_end && prior_fp == fp {
            converged_at = Some(mi);
            break;
        }
    }

    let this_span = converged_at
        .map(|c| c - dirty_start + 1)
        .unwrap_or(measure_count - dirty_start);

    let ottavas = if ottavas_unchanged {
        retained_ottavas
    } else {
        resolve_all_ottavas(&resolved).into()
    };

    (
        resolved,
        ottavas,
        duration_histogram,
        ottavas_unchanged,
        boundary_states,
        boundary_fps,
        this_span,
    )
}

/// Pure per-measure Phase 1 helper. Reads `state` (the carried clef/key/time/
/// prev-display-key), mutates it for the next measure, and returns the
/// `ResolvedMeasure` and the staff's per-measure condensing mode (for Phase 2).
pub(super) fn resolve_one_measure_phase1(
    mi: usize,
    score: &Score,
    flat_staff: &FlatStaff,
    transposition: Option<(i32, i32)>,
    key_fifths_flip_at: Option<i32>,
    state: &mut cache::BoundaryState,
) -> (ResolvedMeasure, Option<MergeMode>) {
    let global = score
        .global
        .measures
        .get(mi)
        .cloned()
        .unwrap_or(GlobalMeasure {
            id: None,
            number: None,
            time: None,
            key: None,
            barline: None,
            repeat_start: None,
            repeat_end: None,
            ending: None,
            tempos: None,
            segno: None,
            fine: None,
            jump: None,
            extensions: None,
        });
    if let Some(ref t) = global.time {
        state.active_time = t.clone();
    }
    if let Some(ref k) = global.key {
        state.active_key = k.clone();
    }
    let (mut virtual_pm, condensing_mode) = build_virtual_part_measure(flat_staff, mi, score);

    // Carry forward clefs: inject last active clef when measure has none.
    let has_start_clef = virtual_pm.clefs.as_ref().is_some_and(|clefs| {
        clefs.iter().any(|pc| {
            let (n, _) = pc.position.as_ref().map(|p| p.fraction).unwrap_or((0, 1));
            n == 0
        })
    });
    if !has_start_clef {
        if let Some(ref inherited) = state.last_clef {
            let mut start_clef = inherited.clone();
            start_clef.position = Some(RhythmicPosition { fraction: (0, 1) });
            let clefs = virtual_pm.clefs.get_or_insert_with(Vec::new);
            clefs.insert(0, start_clef);
        }
    }
    if let Some(ref clefs) = virtual_pm.clefs {
        if let Some(c) = clefs.last() {
            state.last_clef = Some(c.clone());
        }
    }

    // Transpose key signature when transposition is active.
    let display_key = if state.active_key.atonal == Some(true) {
        state.active_key.clone()
    } else if let Some((_, half_steps)) = transposition {
        state.active_key.transpose(half_steps, key_fifths_flip_at)
    } else {
        state.active_key.clone()
    };
    let rm = ResolvedMeasure {
        index: mi,
        global,
        part: virtual_pm,
        measure_repeat_covered: flat_staff.sources.iter().any(|source| {
            score.parts.get(source.part_index).is_some_and(|part| {
                crate::layout::resolve::measure_is_covered_by_repeat(&part.measures, mi)
            })
        }),
        next_has_repeat_start: score
            .global
            .measures
            .get(mi + 1)
            .is_some_and(|measure| measure.repeat_start.is_some()),
        active_time: state.active_time.clone(),
        active_key: display_key.clone(),
        prev_key: state.prev_display_key.clone(),
        tie_continuation_ids: Vec::new(),
        transposition,
        condensing_change: false, // set in Phase 2 (condensing staves only)
        kit: flat_staff
            .sources
            .first()
            .and_then(|s| score.parts.get(s.part_index))
            .and_then(|p| p.kit.clone()),
    };
    state.prev_display_key = display_key;
    (rm, condensing_mode)
}

/// Phase 2: place condensing labels. Extracted from the original
/// `resolve_staves_with_condensing_labels` for clarity; only invoked for
/// condensing staves (the non-condensing case is a no-op).
pub(super) fn apply_condensing_labels(
    resolved: &mut [ResolvedMeasure],
    flat_staff: &FlatStaff,
    score: &Score,
    condensing_modes: &[Option<MergeMode>],
    measure_count: usize,
) {
    let source_count = flat_staff.sources.len() as u32;
    // Detect label style from the staff's instrument family. String sections
    // use Unis./Div. idioms; everything else (winds, brass, etc.) uses the
    // orchestral a 2 / 1. / 2. / +2 idiom.
    let label_style = {
        let is_string_section = flat_staff.sources.iter().all(|src| {
            let name = score
                .parts
                .get(src.part_index)
                .map(|p| p.name.as_str())
                .unwrap_or("")
                .to_lowercase();
            name.contains("violin")
                || name.contains("viola")
                || name.contains("violoncello")
                || name.contains("cello")
                || name.contains("contrabass")
                || name.contains("double bass")
        });
        if is_string_section && source_count >= 2 {
            LabelStyle::StringSection
        } else {
            LabelStyle::Orchestral
        }
    };
    let mut prev_mode: Option<&MergeMode> = None;
    let mut a2_placed: HashSet<usize> = HashSet::new();
    for mi in 0..measure_count {
        let mode = condensing_modes[mi].as_ref();
        let is_condensing_change = if let Some(m) = mode {
            let mode_changed = prev_mode != Some(m);
            if mode_changed {
                let label = label_for_mode_styled(m, source_count, prev_mode, label_style);
                if let Some(text) = label.text() {
                    let placed_early = if mi > 0 && matches!(m, MergeMode::Unison) {
                        let prev_pms: Vec<Option<&PartMeasure>> = flat_staff
                            .sources
                            .iter()
                            .map(|src| {
                                let part = &score.parts[src.part_index];
                                if mi - 1 < part.measures.len() {
                                    Some(&part.measures[mi - 1])
                                } else {
                                    None
                                }
                            })
                            .collect();
                        let available: Vec<&PartMeasure> =
                            prev_pms.iter().filter_map(|pm| *pm).collect();
                        if available.len() > 1 && !a2_placed.contains(&(mi - 1)) {
                            if let Some(onset_beat) = find_unison_onset_beat(&available) {
                                let active_ts = &resolved[mi - 1].active_time;
                                let total_beats =
                                    active_ts.count as f64 * 4.0 / active_ts.unit as f64;
                                let frac_num = (onset_beat * 1000.0).round() as u32;
                                let frac_den = (total_beats * 1000.0).round() as u32;
                                resolved[mi - 1]
                                    .part
                                    .expressions
                                    .get_or_insert_with(Vec::new)
                                    .push(TextExpression {
                                        text: text.clone(),
                                        position: RhythmicPosition {
                                            fraction: (frac_num, frac_den),
                                        },
                                        placement: Some(ExpressionPlacement::Above),
                                        staff: None,
                                        voice: None,
                                        source_part_index: None,
                                        source_expression_index: None,
                                        manual_offset: None,
                                        avoid_collisions: None,
                                    });
                                a2_placed.insert(mi - 1);
                                true
                            } else {
                                false
                            }
                        } else {
                            available.len() > 1 && a2_placed.contains(&(mi - 1))
                        }
                    } else {
                        false
                    };
                    if !placed_early {
                        resolved[mi]
                            .part
                            .expressions
                            .get_or_insert_with(Vec::new)
                            .push(TextExpression {
                                text,
                                position: RhythmicPosition { fraction: (0, 1) },
                                placement: Some(ExpressionPlacement::Above),
                                staff: None,
                                voice: None,
                                source_part_index: None,
                                source_expression_index: None,
                                manual_offset: None,
                                avoid_collisions: None,
                            });
                    }
                }
            }
            mode_changed && prev_mode.is_some()
        } else {
            false
        };
        if is_condensing_change {
            resolved[mi].condensing_change = true;
        }

        if !a2_placed.contains(&mi) {
            let active_time = resolved[mi].active_time.clone();
            if append_partial_unison_label(
                &mut resolved[mi].part,
                mode,
                flat_staff,
                score,
                mi,
                &active_time,
            ) {
                a2_placed.insert(mi);
            }
        }

        prev_mode = mode;
    }
}

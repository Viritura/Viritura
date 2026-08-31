#![allow(unused_imports)]

use super::super::*;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) struct SystemExtras {
    /// Below-staff protrusion (px) at the bottom staff of each system.
    pub(super) below_staff_extras: Vec<f64>,
    /// Above-staff protrusion (px) at the top staff of each system.
    pub(super) above_staff_extras: Vec<f64>,
    /// Total system height (px) including content-aware inter-staff inflation
    /// (pre-simulates Phase 2's `content_y.max(standard_y)` accumulation so
    /// page-break allocation is an upper bound on actual extent).
    pub(super) system_heights_px: Vec<f64>,
}

pub(super) fn compute_system_extras(
    precomp_layouts: &[Vec<Vec<MeasureLayout>>],
    precomp_content_hashes: &[Vec<Vec<u64>>],
    sp: f64,
    config: &LayoutConfig,
    staff_height: f64,
    reusable_system_sources: Option<&[Option<usize>]>,
    mut cache: Option<&mut cache::LayoutCache>,
) -> SystemExtras {
    let system_count = precomp_layouts.len();
    let mut below_staff_extras: Vec<f64> = Vec::with_capacity(system_count);
    let mut above_staff_extras: Vec<f64> = Vec::with_capacity(system_count);
    let mut content_aware_intra_total: Vec<f64> = Vec::with_capacity(system_count);

    // Phase T: per-system signature folds the content hashes of every
    // (staff, measure) in the system plus the layout knobs the extras
    // computation depends on. When this matches the prior pass's signature
    // for the same `sys_idx`, the three extras values are byte-identical and
    // we reuse them without touching the underlying measure layouts \u2014 the
    // single biggest unscoped O(score) pass before this change.
    //
    // `default_intra_staff_clearance` is not currently in `config_content_hash`
    // (which invalidates the whole cache); fold it into the signature
    // defensively so a future config knob change can't surface stale extras.
    let sig_knobs: u64 = {
        let mut h = DefaultHasher::new();
        sp.to_bits().hash(&mut h);
        config.stem_length.to_bits().hash(&mut h);
        config.default_intra_staff_clearance.to_bits().hash(&mut h);
        h.finish()
    };

    let default_inter = 7.0 * sp;

    // `sys_idx` indexes `precomp_layouts` and `precomp_content_hashes.get`
    // together; a single iterator can't span both.
    #[allow(clippy::needless_range_loop)]
    for sys_idx in 0..system_count {
        let sys_layouts = &precomp_layouts[sys_idx];
        let sys_hashes = precomp_content_hashes.get(sys_idx);

        // Membership reconverged and this system lies outside the patch's
        // measure range: its complete extras dependency island is unchanged.
        // Reuse by index without re-walking every staff/measure hash.
        if let Some(prior_sys_idx) = reusable_system_sources
            .and_then(|sources| sources.get(sys_idx))
            .copied()
            .flatten()
        {
            if let Some(c) = cache.as_deref_mut() {
                if let Some(entry) = c.get_cached_system_extras_unchecked(prior_sys_idx) {
                    let below = entry.below_staff_extra;
                    let above = entry.above_staff_extra;
                    let intra = (entry.system_height_px - staff_height - below - above).max(0.0);
                    below_staff_extras.push(below);
                    above_staff_extras.push(above);
                    content_aware_intra_total.push(intra);
                    c.bump_system_extras_reuse();
                    continue;
                }
            }
        }

        // Signature: fold the per-(staff, measure) content hashes for the
        // system. Missing hashes (cold cache path inside `precompute_system_layouts`)
        // produce a partial signature \u2014 still safe because a miss only
        // forces a recompute, never a stale reuse.
        let signature: u64 = {
            let mut h = DefaultHasher::new();
            sig_knobs.hash(&mut h);
            if let Some(hashes) = sys_hashes {
                hashes.len().hash(&mut h);
                for staff in hashes {
                    staff.len().hash(&mut h);
                    for &mh in staff {
                        mh.hash(&mut h);
                    }
                }
            } else {
                0u64.hash(&mut h);
            }
            h.finish()
        };

        // Cache hit: reuse the three extras values, skip the per-measure scan.
        if let Some(c) = cache.as_deref_mut() {
            if let Some(entry) = c.get_cached_system_extras(sys_idx, signature) {
                let below = entry.below_staff_extra;
                let above = entry.above_staff_extra;
                let intra = (entry.system_height_px - staff_height - below - above).max(0.0);
                below_staff_extras.push(below);
                above_staff_extras.push(above);
                content_aware_intra_total.push(intra);
                c.bump_system_extras_reuse();
                continue;
            }
        }

        // Miss: compute fresh, then store.
        let below = sys_layouts
            .last()
            .map(|bottom_staff| {
                compute_below_staff_extra_from_layouts(bottom_staff, sp, config.stem_length, config)
            })
            .unwrap_or(0.0);

        let above = if let Some(top_staff) = sys_layouts.first() {
            let sys_measures: Vec<&ResolvedMeasure> =
                top_staff.iter().map(|ml| &ml.resolved).collect();
            compute_above_staff_extra(
                &sys_measures,
                Some(top_staff),
                sp,
                config.stem_length,
                config,
            )
        } else {
            0.0
        };

        // Pre-simulate Phase 2's `content_y.max(standard_y)` per inter-staff
        // pair so the page-break planner receives an upper bound on actual
        // extent. See the longer note in the SystemExtras struct doc above.
        let mut intra: f64 = 0.0;
        if sys_layouts.len() >= 2 {
            for i in 1..sys_layouts.len() {
                let upper = &sys_layouts[i - 1];
                let lower = &sys_layouts[i];
                let staff_bottom = staff_height;
                let mut lowest_above: f64 = staff_bottom;
                for ml in upper {
                    let lp = super::super::render_annotations::lowest_point_in_measure(
                        ml,
                        0.0,
                        sp,
                        config.stem_length,
                    );
                    if lp > lowest_above {
                        lowest_above = lp;
                    }
                }
                let has_dynamics = upper.iter().any(|ml| {
                    ml.resolved
                        .part
                        .dynamics
                        .as_ref()
                        .is_some_and(|d| !d.is_empty())
                });
                let has_lyrics = upper.iter().any(|ml| {
                    ml.resolved.part.sequences.iter().any(|seq| {
                        seq.content.iter().any(|c| {
                            matches!(c, SequenceContent::Event(ev)
                        if ev.lyrics.as_ref().is_some_and(|l|
                            l.lines.as_ref().is_some_and(|ls| !ls.is_empty())))
                        })
                    })
                });
                if has_dynamics {
                    lowest_above = lowest_above.max(staff_bottom + 4.5 * sp);
                }
                if has_lyrics {
                    lowest_above = lowest_above.max(staff_bottom + 5.0 * sp);
                }
                let mut above_protrusion: f64 = 0.0;
                for ml in lower {
                    let hp = super::super::render_annotations::highest_point_in_measure(
                        ml,
                        0.0,
                        sp,
                        config.stem_length,
                    );
                    if hp < 0.0 && (-hp) > above_protrusion {
                        above_protrusion = -hp;
                    }
                }
                let min_clearance = config.default_intra_staff_clearance * sp;
                let content_inter = lowest_above + above_protrusion + min_clearance;
                let standard_inter = staff_height + default_inter;
                intra += content_inter.max(standard_inter);
            }
        }

        let system_height = staff_height + intra + below + above;

        if let Some(c) = cache.as_deref_mut() {
            c.set_cached_system_extras(
                sys_idx,
                cache::CachedSystemExtras {
                    signature,
                    below_staff_extra: below,
                    above_staff_extra: above,
                    system_height_px: system_height,
                },
            );
        }

        below_staff_extras.push(below);
        above_staff_extras.push(above);
        content_aware_intra_total.push(intra);
    }

    let system_heights_px: Vec<f64> = (0..system_count)
        .map(|i| {
            staff_height
                + content_aware_intra_total[i]
                + below_staff_extras[i]
                + above_staff_extras[i]
        })
        .collect();

    if let Some(c) = cache {
        c.truncate_cached_system_extras(system_count);
    }

    SystemExtras {
        below_staff_extras,
        above_staff_extras,
        system_heights_px,
    }
}

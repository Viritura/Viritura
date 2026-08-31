//! Builders for `LayoutDebugInfo` — the vertical-spacing debug sidecar.
//!
//! These helpers reproduce the small amount of bookkeeping needed to populate
//! the structured debug info that the editor's spacing overlay consumes.
//! They intentionally re-scan layouts (instead of refactoring the spacing
//! functions to return breakdowns) so they impose zero cost when
//! `LayoutConfig.emit_layout_debug` is false.

use super::render_annotations::{highest_point_in_measure, lowest_point_in_measure};
use super::types::MeasureLayout;
use crate::model::SequenceContent;
use crate::render::{
    AboveBreakdown, BelowBreakdown, GapInfo, MeasureExtreme, MeasureSpacing, SystemDebug,
};

/// Build the resolved placement-metrics map for the debug sidecar: one entry
/// per dependent kind, with the spatium-relative distances converted to pixels.
/// Lets the overlay draw each dependent's collision box + padding halo directly
/// from the active [`crate::layout::placement_metrics::PlacementTable`].
pub(crate) fn build_placement_debug(
    config: &super::config::LayoutConfig,
    sp: f64,
) -> std::collections::HashMap<String, crate::render::PlacementDebug> {
    use super::placement_metrics::DEPENDENT_KINDS;
    DEPENDENT_KINDS
        .iter()
        .map(|(key, kind)| {
            let m = config.placement.resolve(*kind);
            (
                (*key).to_string(),
                crate::render::PlacementDebug {
                    attach_gap: m.attach_gap * sp,
                    attach_gap_above: m.attach_gap_above() * sp,
                    attach_gap_below: m.attach_gap_below() * sp,
                    stack_gap: m.padding.vertical * sp,
                    stack_rank: m.stack_rank,
                    side_bearing: m.padding.horizontal * sp,
                },
            )
        })
        .collect()
}

/// Compute the breakdown of `compute_above_staff_extra` for a system's
/// top staff. `top_staff_layouts` is the per-measure layouts for staff 0
/// in the system's coordinate space (staff_y = 0 baseline).
pub(crate) fn above_breakdown(
    top_staff_layouts: &[MeasureLayout],
    sp: f64,
    stem_length: f64,
) -> AboveBreakdown {
    let mut has_tempo = false;
    let mut has_rehearsal = false;
    let mut has_jump = false;
    for ml in top_staff_layouts {
        let g = &ml.resolved.global;
        if g.tempos.as_ref().is_some_and(|t| !t.is_empty()) {
            has_tempo = true;
        }
        if g.rehearsal_mark().is_some() {
            has_rehearsal = true;
        }
        if g.segno.is_some() || g.coda().is_some() || g.fine.is_some() || g.jump.is_some() {
            has_jump = true;
        }
    }

    let mut max_protrusion: f64 = 0.0;
    for ml in top_staff_layouts {
        let highest = highest_point_in_measure(ml, 0.0, sp, stem_length);
        if highest < -max_protrusion {
            max_protrusion = -highest;
        }
    }
    let stem_extra = (max_protrusion - 3.5 * sp).max(0.0);

    let tempo_extra = if has_tempo { 3.5 * sp } else { 0.0 };
    let rehearsal_extra = if has_rehearsal { 4.5 * sp } else { 0.0 };
    let jump_extra = if has_jump { 3.0 * sp } else { 0.0 };
    let annotation_extra = tempo_extra.max(rehearsal_extra).max(jump_extra);

    AboveBreakdown {
        stem_extra,
        annotation_extra,
        has_tempo,
        has_rehearsal,
        has_jump,
    }
}

/// Compute the breakdown of `compute_below_staff_extra_from_layouts` for
/// the bottom staff of a system.
pub(crate) fn below_breakdown(
    bottom_staff_layouts: &[MeasureLayout],
    sp: f64,
    stem_length: f64,
) -> BelowBreakdown {
    let staff_bottom = 4.0 * sp;
    let lowest = bottom_staff_layouts
        .iter()
        .map(|ml| lowest_point_in_measure(ml, 0.0, sp, stem_length))
        .fold(staff_bottom, f64::max);
    let protrusion = (lowest - staff_bottom).max(0.0);

    // Below-staff dynamics sit beneath the notes they overlap; reserve per
    // measure so the breakdown matches `compute_below_staff_extra_from_layouts`.
    let mut dynamics_extra = 0.0_f64;
    for ml in bottom_staff_layouts {
        let has_dyn = ml
            .resolved
            .part
            .dynamics
            .as_ref()
            .is_some_and(|d| !d.is_empty());
        if has_dyn {
            let ml_lowest = lowest_point_in_measure(ml, 0.0, sp, stem_length);
            let ml_protrusion = (ml_lowest - staff_bottom).max(0.0);
            let dyn_reserve = (ml_protrusion + 0.5 * sp + 1.78 * sp).max(4.5 * sp);
            dynamics_extra = dynamics_extra.max(dyn_reserve);
        }
    }
    let has_dynamics = dynamics_extra > 0.0;

    let has_lyrics = bottom_staff_layouts.iter().any(|ml| {
        ml.resolved.part.sequences.iter().any(|seq| {
            seq.content.iter().any(|c| {
                matches!(c, SequenceContent::Event(ev)
                if ev.lyrics.as_ref().is_some_and(|l|
                    l.lines.as_ref().is_some_and(|ls| !ls.is_empty())))
            })
        })
    });
    let has_pedals = bottom_staff_layouts.iter().any(|ml| {
        ml.resolved
            .part
            .pedals
            .as_ref()
            .is_some_and(|p| !p.is_empty())
    });

    BelowBreakdown {
        protrusion,
        dynamics: dynamics_extra,
        lyrics: if has_lyrics { 5.0 * sp } else { 0.0 },
        pedals: if has_pedals { 7.0 * sp } else { 0.0 },
        has_dynamics,
        has_lyrics,
        has_pedals,
    }
}

/// Build per-measure protrusion extremes for the top staff of a system.
/// The Y values are in the system's local coordinate space (staff_y = 0).
pub(crate) fn measure_extremes(
    top_staff_layouts: &[MeasureLayout],
    sp: f64,
    stem_length: f64,
) -> Vec<MeasureExtreme> {
    top_staff_layouts
        .iter()
        .map(|ml| MeasureExtreme {
            measure_index: ml.resolved.index,
            x_start: ml.x,
            x_end: ml.x + ml.width,
            highest_point: highest_point_in_measure(ml, 0.0, sp, stem_length),
            lowest_point: lowest_point_in_measure(ml, 0.0, sp, stem_length),
        })
        .collect()
}

/// Build per-measure horizontal spacing breakdown for a system. For each
/// measure we record the natural (un-justified) width, the justified width,
/// the resulting scale factor, and the per-event onset Xs gathered across
/// all voices. `natural_for` returns the cached natural width for a given
/// measure index (returns None if unknown — falls back to justified width).
pub(crate) fn measure_spacings<F>(
    sys_layouts: &[MeasureLayout],
    mut natural_for: F,
) -> Vec<MeasureSpacing>
where
    F: FnMut(usize) -> Option<f64>,
{
    sys_layouts
        .iter()
        .map(|ml| {
            let justified_width = ml.width;
            let natural_width = natural_for(ml.resolved.index).unwrap_or(justified_width);
            let scale = if natural_width > 0.0 {
                justified_width / natural_width
            } else {
                1.0
            };

            // Collect event onset Xs across all voices, dedup (within 0.01 px).
            let mut xs: Vec<f64> = Vec::new();
            for vl in &ml.voice_layouts {
                for ev in 0..vl.events.len() {
                    xs.push(vl.events.x(ev));
                }
            }
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            xs.dedup_by(|a, b| (*a - *b).abs() < 0.01);

            let mut min_gap = f64::INFINITY;
            let mut max_gap = 0.0_f64;
            for w in xs.windows(2) {
                let g = w[1] - w[0];
                if g < min_gap {
                    min_gap = g;
                }
                if g > max_gap {
                    max_gap = g;
                }
            }
            if !min_gap.is_finite() {
                min_gap = 0.0;
            }

            MeasureSpacing {
                measure_index: ml.resolved.index,
                x_start: ml.x,
                x_end: ml.x + ml.width,
                natural_width,
                justified_width,
                scale,
                event_xs: xs,
                min_gap,
                max_gap,
            }
        })
        .collect()
}

/// Build a `SystemDebug` for a single-staff system.
pub(crate) fn system_debug_single_staff(
    sys_idx: usize,
    page_index: usize,
    sys_layouts: &[MeasureLayout],
    staff_top_y: f64,
    above_extra: f64,
    below_extra: f64,
    sp: f64,
    stem_length: f64,
    natural_widths_by_index: &std::collections::HashMap<usize, f64>,
) -> SystemDebug {
    let staff_height = 4.0 * sp;
    let x_start = sys_layouts.first().map_or(0.0, |ml| ml.x);
    let x_end = sys_layouts.last().map_or(x_start, |ml| ml.x + ml.width);
    let staff_bottom_y = staff_top_y + staff_height;
    SystemDebug {
        index: sys_idx,
        page_index,
        bbox_top_y: staff_top_y - above_extra,
        staff_top_y,
        staff_bottom_y,
        bbox_bottom_y: staff_bottom_y + below_extra,
        x_start,
        x_end,
        above_extra,
        above_breakdown: above_breakdown(sys_layouts, sp, stem_length),
        below_extra,
        below_breakdown: below_breakdown(sys_layouts, sp, stem_length),
        measure_extremes: measure_extremes(sys_layouts, sp, stem_length),
        staff_pairs: Vec::new(),
        measure_spacings: measure_spacings(sys_layouts, |idx| {
            natural_widths_by_index.get(&idx).copied()
        }),
        inter_system_gap_to_next: None,
    }
}

/// Compute an inter-system `GapInfo` from two consecutive systems on the
/// same page. Returns `None` for systems on different pages.
pub(crate) fn inter_system_gap(
    current_bbox_bottom_y: f64,
    next_bbox_top_y: f64,
    current_page: usize,
    next_page: usize,
    sp: f64,
) -> Option<GapInfo> {
    if current_page != next_page {
        return None;
    }
    let actual = (next_bbox_top_y - current_bbox_bottom_y).max(0.0);
    let default_gap = 7.0 * sp;
    Some(GapInfo {
        default_gap,
        actual_gap: actual,
        // Justified when the actual gap is meaningfully larger than the default
        // (within 0.1sp tolerance to account for fp jitter).
        justified: actual > default_gap + 0.1 * sp,
    })
}

/// Resolve `system_idx` → `page_index` from a `pages: &[PageLayout]`.
pub(crate) fn page_for_system(pages: &[crate::render::PageLayout], system_idx: usize) -> usize {
    for p in pages {
        if p.system_indices.contains(&system_idx) {
            return p.page_number;
        }
    }
    0
}

/// Wire `inter_system_gap_to_next` for each system in a complete debug list.
/// Call after all systems have been built.
pub(crate) fn link_inter_system_gaps(systems: &mut [SystemDebug], sp: f64) {
    for i in 0..systems.len() {
        if i + 1 >= systems.len() {
            continue;
        }
        let cur_bottom = systems[i].bbox_bottom_y;
        let cur_page = systems[i].page_index;
        let next_top = systems[i + 1].bbox_top_y;
        let next_page = systems[i + 1].page_index;
        systems[i].inter_system_gap_to_next =
            inter_system_gap(cur_bottom, next_top, cur_page, next_page, sp);
    }
}

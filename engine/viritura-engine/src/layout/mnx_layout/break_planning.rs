#![allow(unused_imports)]

use super::super::*;
use super::measure_widths::MeasureWidthBudget;
use super::mmr_grouping::MmrPlan;
use super::page_turn_planning::single_source_part_index;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) struct SystemBreakPlan {
    /// Each entry lists the indices INTO `MeasureWidthBudget.natural_widths`
    /// (i.e. visible-measure positions) belonging to that system.
    pub(super) systems: Vec<Vec<usize>>,
    /// Left margin for the first system (includes full-label gutter).
    pub(super) margin_left_first: f64,
    /// Left margin for subsequent systems (uses short-label gutter).
    pub(super) margin_left_subseq: f64,
    /// Top page margin in px.
    pub(super) margin_top: f64,
    /// Base right page margin.
    pub(super) base_margin_r: f64,
    /// Width available for measures on the first system, if page width is set.
    pub(super) content_width_first: Option<f64>,
    /// Width available for measures on subsequent systems, if page width is set.
    pub(super) content_width_subseq: Option<f64>,
    /// Standard inter-system vertical gap.
    pub(super) inter_system_gap: f64,
}

/// Deterministic stitched-horizon partition sized by accumulated **natural**
/// measure widths. Chunk seams are suppressed downstream, so their only job is
/// bounding retention/transfer work.
///
/// This deliberately measures real content rather than assuming a nominal
/// per-measure budget. A fixed nominal width has to be expressed in sp while
/// `chunk_width` is in px, so measures-per-chunk changed with the zoom level —
/// which silently re-partitioned the galley and could move a spanner from the
/// in-system path onto the cross-system one purely because the user zoomed.
///
/// Edit stability (a width change must not shift every downstream boundary) is
/// handled by `LayoutCache::stabilize_horizon_chunks`, which reconciles this
/// candidate against the previously accepted partition.
pub(super) fn stable_horizon_chunks(
    visible_count: usize,
    chunk_width: f64,
    sp: f64,
    natural_widths: &[f64],
) -> Vec<Vec<usize>> {
    if visible_count == 0 {
        return vec![Vec::new()];
    }
    // Fall back to a nominal budget only when real widths aren't available.
    if natural_widths.len() < visible_count {
        let nominal_measure_width = (64.0 * sp).max(1.0);
        let measures_per_chunk = (chunk_width / nominal_measure_width).floor().max(1.0) as usize;
        return (0..visible_count)
            .collect::<Vec<_>>()
            .chunks(measures_per_chunk)
            .map(<[usize]>::to_vec)
            .collect();
    }
    let budget = chunk_width.max(1.0);
    let mut chunks: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut used = 0.0;
    for (index, &natural) in natural_widths.iter().enumerate().take(visible_count) {
        let width = natural.max(0.0);
        // Always keep at least one measure per chunk, so a single measure wider
        // than the budget forms its own chunk instead of an empty one.
        if !current.is_empty() && used + width > budget {
            chunks.push(std::mem::take(&mut current));
            used = 0.0;
        }
        current.push(index);
        used += width;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Compute label-aware margins, then greedily break the visible measures
/// into systems sized to the page. Falls back to a single system when no
/// page width is configured (galley / unpaged view).
pub(super) fn plan_system_breaks(
    config: &LayoutConfig,
    flat_staves: &[FlatStaff],
    budget: &MeasureWidthBudget,
    mmr: &MmrPlan,
    cache: Option<&mut cache::LayoutCache>,
) -> SystemBreakPlan {
    let sp = config.sp;
    let label_style = config
        .text_styles
        .resolve(crate::layout::text_styles::TextRole::StaffLabel);
    // Add label margin for part names and brackets.
    // First system uses full labels; subsequent systems use short (abbreviated) labels.
    // Single-staff layouts (an extracted part, or a solo score) are NOT indented
    // with an instrument name in the margin — standard engraving practice places
    // the name in the header instead. Only reserve the gutter when there are two
    // or more staves to disambiguate.
    let has_labels = flat_staves.len() > 1 && flat_staves.iter().any(|s| s.label.is_some());
    // Gap between the right edge of the instrument name and the system's left
    // margin (where brackets/braces sit). Matches `render_staff_labels`, which
    // right-anchors labels at `margin_left - 2.8 sp`. Sizing the gutter as
    // `widest_label_extent + LABEL_GAP` makes the longest name hug the left
    // margin exactly, with no wasted space.
    const LABEL_GAP_SP: f64 = 2.8;
    let label_gap = LABEL_GAP_SP * sp;
    let first_label_margin = if has_labels {
        flat_staves
            .iter()
            .filter_map(|s| s.label.as_ref().map(|l| (l, &s.condensed_numbers)))
            .map(|(l, cn)| label_gutter_extent(l, cn, sp, label_style))
            .fold(0.0_f64, f64::max)
            + label_gap
    } else {
        0.0
    };
    let subseq_label_margin = if has_labels {
        flat_staves
            .iter()
            .filter_map(|s| {
                s.short_label
                    .as_ref()
                    .or(s.label.as_ref())
                    .map(|l| (l, &s.condensed_numbers))
            })
            .map(|(l, cn)| label_gutter_extent(l, cn, sp, label_style))
            .fold(0.0_f64, f64::max)
            + label_gap
    } else {
        0.0
    };
    let base_margin_l = if config.page_width.is_some() {
        config.page_margin_left * sp
    } else {
        config.margin_left * sp
    };
    let base_margin_r = if config.page_width.is_some() {
        config.page_margin_right * sp
    } else {
        config.margin_right * sp
    };
    // First-system indent: when laying out a single part (every staff drawn
    // from the same part — an extracted part book, not a full score), the first
    // system is indented to signal the start of the music. Full scores get this
    // visual cue for free from the instrument-name gutter, so they are not
    // indented here. Indent ≈ one staff height (4 sp), a standard engraving
    // amount. Only meaningful in paged mode; galley/horizon modes lay the music
    // on a single continuous row where a left indent would just be dead padding.
    let first_system_indent =
        if config.page_width.is_some() && single_source_part_index(flat_staves).is_some() {
            4.0 * sp
        } else {
            0.0
        };
    let margin_left_first = base_margin_l + first_label_margin + first_system_indent;
    let margin_left_subseq = base_margin_l + subseq_label_margin;
    let margin_top = config.margin_top * sp;
    let content_width_first = config
        .page_width
        .map(|pw| pw - margin_left_first - base_margin_r);
    let content_width_subseq = config
        .page_width
        .map(|pw| pw - margin_left_subseq - base_margin_r);
    let systems = if let Some(avail_first) = content_width_first {
        let avail_subseq = content_width_subseq.unwrap_or(avail_first);
        if avail_first > 0.0 && avail_subseq > 0.0 {
            break_into_systems_dual_width(&budget.natural_widths, avail_first, avail_subseq)
        } else {
            vec![(0..mmr.visible_indices.len()).collect()]
        }
    } else if let Some(chunk_w) = config.horizon_chunk_width.filter(|w| *w > 0.0) {
        // Stitched horizon: break the single galley into independently-retainable
        // chunks sized to `chunk_w` (using NATURAL, un-justified widths). The
        // chunks are laid out at continuous x / shared y with all seam furniture
        // suppressed downstream, so the rendered result is byte-identical to the
        // single-system galley below — chunking exists only so per-system
        // retention and viewport culling re-engage on heavy scores.
        let candidate = stable_horizon_chunks(
            mmr.visible_indices.len(),
            chunk_w,
            sp,
            &budget.natural_widths,
        );
        let mut hasher = DefaultHasher::new();
        chunk_w.to_bits().hash(&mut hasher);
        mmr.visible_indices.hash(&mut hasher);
        let salt = hasher.finish();
        cache.map_or(candidate.clone(), |layout_cache| {
            layout_cache.stabilize_horizon_chunks(salt, candidate)
        })
    } else {
        vec![(0..mmr.visible_indices.len()).collect()]
    };
    SystemBreakPlan {
        systems,
        margin_left_first,
        margin_left_subseq,
        margin_top,
        base_margin_r,
        content_width_first,
        content_width_subseq,
        inter_system_gap: config.inter_system_spacing * sp,
    }
}

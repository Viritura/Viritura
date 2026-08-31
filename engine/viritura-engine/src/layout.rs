//! Layout engine — compute spatial positions and produce a DisplayList.
//!
//! Takes a parsed Score model, computes spacing for each measure,
//! positions events on the staff, determines stem direction, and
//! emits render commands into a DisplayList.
//!
//! This module orchestrates the layout pipeline. Each stage lives
//! in its own submodule for parallel development.

mod arena;
mod beams;
pub mod cache;
mod condensing;
pub mod config;
mod cross_system;
mod curves;
mod debug;
pub mod dependent_stacking;
pub(crate) mod element_id;
mod glissando;
mod grace;
mod hairpins;
mod measure;
mod orchestration;
mod page;
pub mod page_turn;
mod pedals;
pub mod placement_metrics;
mod render_annotations;
mod render_articulations;
mod render_barlines;
mod render_events;
mod render_geometry;
mod render_lyrics;
mod render_measure;
mod render_signatures;
mod render_tremolos;
mod resolve;
pub mod skyline;
mod slur_preview;
mod slurs;
mod space_requests;
mod spacing;
mod staff_brace;
mod system;
pub mod text_styles;
mod ties;
mod time_signatures;
mod tuplets;
mod types;
mod volta;

#[cfg(test)]
mod tests;

pub use config::LayoutConfig;
pub use page::compute_page_breaks;
pub use slur_preview::{
    compute_slur_preview, SlurPreview, SlurPreviewHandle, SlurPreviewInput, SlurPreviewMode,
};

use crate::model::*;
use crate::render::*;
use beams::*;
use cache::measure_content_hash;
use glissando::*;
use hairpins::*;
use measure::*;
use orchestration::*;
use page::*;
use render_events::compute_tie_accidental_map;
use render_measure::*;
use resolve::*;
use slurs::*;
use spacing::*;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use system::*;
use ties::*;
use types::*;
use volta::*;

/// Build beat→X anchor pairs from a measure's voice layouts.
/// Uses the first voice (voice 0) to extract event positions and their beat offsets.
///
/// For full-measure rests (all events are rests and there's only one, centered),
/// use evenly-spaced anchors across the content area instead of the centered
/// rest position. For mixed content, include all events (notes AND rests)
/// since in-measure rests use the same proportional spacing as notes.
pub(crate) fn build_beat_anchors(ml: &MeasureLayout) -> (f64, Vec<(f64, f64)>) {
    let total_beats = layout_total_beats(&ml.resolved);
    let content_left = ml.x + ml.prefix_width;
    let content_right = ml.x + ml.width;

    // Use voice 0 events to build anchors (primary voice determines note positions)
    if let Some(vl) = ml.voice_layouts.first() {
        let event_count = vl.events.len();
        // Only treat as "rest-only" when ALL events are rests — this means
        // it's a full-measure rest or a measure with only rests, where the
        // rest glyph is centered and doesn't represent a beat position.
        let all_rests = (0..event_count).all(|i| vl.events.event(i).is_rest());

        if all_rests || event_count == 0 {
            let anchors = vec![(0.0, content_left), (total_beats, content_right)];
            return (total_beats, anchors);
        }

        // Mixed or all-note content: include ALL events (notes and rests)
        // as anchors since they all use proportional spacing from the engine.
        // Use the stored beat_position which correctly accounts for tuplet scaling.
        let mut anchors: Vec<(f64, f64)> = Vec::new();
        for i in 0..event_count {
            anchors.push((vl.events.beat_position(i), vl.events.x(i)));
        }
        // Add end anchor at measure right edge
        anchors.push((total_beats, content_right));

        (total_beats, anchors)
    } else {
        let anchors = vec![(0.0, content_left), (total_beats, content_right)];
        (total_beats, anchors)
    }
}
use pedals::*;
use render_barlines::*;
use render_geometry::*;
use render_signatures::render_change_clef;

pub fn layout_score(score: &Score, part_index: usize, config: &LayoutConfig) -> DisplayList {
    layout_score_cached(score, part_index, config, None)
}

/// Clone `config` with the document's `_x.viritura` layout overrides merged over
/// the defaults, or `None` when the document has no overrides (so the common
/// case avoids a `LayoutConfig` clone). Currently merges `textStyles` and
/// `placement`.
#[allow(clippy::too_many_lines)] // single-part cached layout pipeline; staged passes share orchestration state
pub fn layout_score_cached(
    score: &Score,
    part_index: usize,
    config: &LayoutConfig,
    mut cache: Option<&mut cache::LayoutCache>,
) -> DisplayList {
    // P1: consume any patch-side dirty range so the cache invariant
    // "after any cached layout pass `pending_dirty_range` is `None`" holds for
    // non-MNX layouts too. The single-staff path does not yet honor the range
    // (Phases A–D scope only the MNX auto-flow path), so we discard.
    let _ = cache
        .as_deref_mut()
        .and_then(|c| c.take_pending_dirty_range());

    // Apply per-document overrides (`_x.viritura.textStyles`, `placement`,
    // `timeSignatures`) over the engine defaults. Done once here, the single
    // layout chokepoint, so the merged values flow into every downstream site
    // (including the grand-staff delegation below). This entry point renders
    // the document itself rather than an extracted part, so it resolves the
    // document's score-side style.
    let merged_config = config_with_document_overrides(score, config, LayoutContext::Score);
    let config = merged_config.as_ref().unwrap_or(config);

    let part = &score.parts[part_index];

    // Grand staff: delegate to multi-staff renderer
    if part.staves >= 2 {
        return layout_grand_staff_score_cached(score, part_index, config, cache);
    }

    let _use_beams = score
        .mnx
        .support
        .as_ref()
        .and_then(|s| s.use_beams)
        .unwrap_or(false);
    let _use_accidental_display = score
        .mnx
        .support
        .as_ref()
        .and_then(|s| s.use_accidental_display)
        .unwrap_or(false);
    let sp = config.sp;

    // Resolve measures (merge global + part data, inherit time/key)
    let resolved = resolve_measures(score, part_index);
    let resolved_ottavas = resolve_all_ottavas(&resolved);

    // Detect common shortest duration for logarithmic spacing
    let all_durations = collect_all_event_durations(&resolved);
    let common_shortest_beats = detect_common_shortest_duration(&all_durations);

    // In page mode, page margins replace the default system margins
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
    let margin_left = base_margin_l;
    let margin_top = config.margin_top * sp;
    let staff_height = 4.0 * sp; // 5 lines = 4 spaces

    // Detect multimeasure rest groups when enabled.
    // Auto-enable if any score definition declares explicit `multimeasureRests` ranges,
    // mirroring the auto-flow path in `layout_with_mnx_scores` (mnx_layout.rs).
    let any_score_mmr = score
        .scores
        .iter()
        .any(|sd| !sd.multimeasure_rests.is_empty());
    let mmr_enabled = config.multimeasure_rests || any_score_mmr;
    let mmr_groups = if mmr_enabled {
        detect_multimeasure_rest_groups(&resolved)
    } else {
        Vec::new()
    };

    // Build skip set and map: which measures to skip, which to expand
    let mut skip_measures: HashSet<usize> = HashSet::new();
    let mut mmr_start_map: HashMap<usize, u32> = HashMap::new();
    for &(start, count) in &mmr_groups {
        mmr_start_map.insert(start, count as u32);
        for j in (start + 1)..(start + count) {
            skip_measures.insert(j);
        }
    }

    // Compute natural measure widths (without final positioning)
    let visible_resolved: Vec<&ResolvedMeasure> = resolved
        .iter()
        .filter(|rm| !skip_measures.contains(&rm.index))
        .collect();

    // Check config and reset cache stats
    if let Some(ref mut c) = cache {
        c.check_config(config);
        c.reset_stats();
    }

    let (natural_widths, content_hashes, x_cursor) = compute_natural_widths(
        &visible_resolved,
        &mmr_start_map,
        margin_left,
        sp,
        config,
        &resolved_ottavas,
        common_shortest_beats,
        part_index,
        cache.as_deref_mut(),
    );

    // Determine system breaks
    let content_width = config.page_width.map(|pw| pw - margin_left - base_margin_r);
    // Rightward reach of each measure's widest left-anchored marking (tempo /
    // direction text). Drives both the overflow planner (system breaking) and
    // the justifier's in-place compression so a wide marking never runs past
    // the right page margin. Indexed identically to `natural_widths`.
    let text_demands = render_annotations::resolved_tempo_widths(&visible_resolved, config, sp);
    let systems = if let Some(avail) = content_width {
        if avail > 0.0 {
            // A wide marking must not run past the right margin. The planner
            // balances three remedies (extra compression, pulling bars to the
            // previous system, or a system break) and picks the least
            // disruptive per overflow; the justifier then realizes the
            // in-place compression case.
            let systems = break_into_systems(&natural_widths, avail);
            system::plan_text_overflow(systems, &natural_widths, &text_demands, avail)
        } else {
            vec![(0..visible_resolved.len()).collect()]
        }
    } else {
        // Single system: all measures
        vec![(0..visible_resolved.len()).collect()]
    };

    let system_count = systems.len();
    let inter_system_gap = config.inter_system_spacing * sp;

    // ══════════════════════════════════════════════════════════════════════
    // Pass 1: Pre-compute measure layouts for ALL systems so we can measure
    // actual below-staff protrusions before determining Y positions.
    // ══════════════════════════════════════════════════════════════════════
    let precomp_sys_layouts: Vec<Vec<MeasureLayout>> = precompute_system_layouts(
        &systems,
        &natural_widths,
        &text_demands,
        &visible_resolved,
        &content_hashes,
        content_width,
        margin_left,
        sp,
        config,
        &resolved_ottavas,
        common_shortest_beats,
        &mmr_start_map,
        part_index,
        cache,
    );

    // Compute per-system below/above-staff extras from ACTUAL layouts
    let below_staff_extras: Vec<f64> = precomp_sys_layouts
        .iter()
        .map(|layouts| {
            compute_below_staff_extra_from_layouts(layouts, sp, config.stem_length, config)
        })
        .collect();

    let above_staff_extras: Vec<f64> = precomp_sys_layouts
        .iter()
        .map(|layouts| {
            let sys_measures: Vec<&ResolvedMeasure> =
                layouts.iter().map(|ml| &ml.resolved).collect();
            compute_above_staff_extra(&sys_measures, Some(layouts), sp, config.stem_length, config)
        })
        .collect();

    // Per-system heights for page breaking
    let system_heights_px: Vec<f64> = (0..system_count)
        .map(|i| staff_height + below_staff_extras[i] + above_staff_extras[i])
        .collect();

    // Auto page-turn pagination (opt-in via `config.page_turns.enabled`).
    // Choose page breaks that balance page density against page-turn quality;
    // when disabled or infeasible this yields an empty forced set, leaving the
    // greedy packer's behavior byte-for-byte unchanged.
    let (forced_page_starts, page_turn_warnings, page_turn_hints, first_page_recto): (
        Vec<usize>,
        Option<Vec<PageTurnWarning>>,
        Vec<page_turn::PageTurnHint>,
        Option<bool>,
    ) = if config.page_turns.enabled && config.page_width.is_some() {
        let pt_part = &score.parts[part_index];
        let system_ranges: Vec<(usize, usize)> = systems
            .iter()
            .filter_map(|sys| {
                // The last visible block on a system may be a collapsed
                // multimeasure rest spanning several underlying measures;
                // the turn boundary sits after its LAST bar (see
                // `system_measure_range`).
                page_turn::system_measure_range(*sys.first()?, *sys.last()?, resolved.len(), |p| {
                    visible_resolved.get(p).map(|rm| rm.index)
                })
            })
            .collect();
        let base_usable =
            (config.page_height - config.page_margin_top - config.page_margin_bottom) * sp;
        let geometry = page_turn::PageGeometry {
            usable_height: base_usable,
            title_height: 0.0,
            inter_system_spacing: 7.0 * sp,
        };
        // This path renders no title block, so it cannot emit a dedicated
        // title page — forbid the optimizer from reserving one. It also
        // packs with the flat inter-system gap (no protrusion extras), so
        // the optimizer uses the same flat spacing (empty per-system gaps).
        let plan = page_turn::plan_forced_starts(
            &score.global.measures,
            &pt_part.measures,
            &system_heights_px,
            &[],
            &system_ranges,
            &geometry,
            &config.page_turns,
            /* allow_title_page = */ false,
        );
        (
            plan.page_starts,
            plan.warnings,
            plan.hints,
            Some(plan.first_page_recto),
        )
    } else {
        (Vec::new(), None, Vec::new(), None)
    };
    let pages =
        compute_page_breaks_with_forced(&system_heights_px, config, 0.0, &forced_page_starts);
    let staves_per_system = vec![1_usize; system_count];
    let system_y_positions: Vec<f64> = if config.page_width.is_some() {
        let extras: Vec<(f64, f64)> = above_staff_extras
            .iter()
            .zip(below_staff_extras.iter())
            .map(|(&a, &b)| (a, b))
            .collect();
        // Per-spread frame insets (band model) only when a page-turn plan ran
        // (it fixes the recto/verso parity); otherwise standalone — byte-
        // identical to the pre-band layout.
        let partners = first_page_recto.map(|fpr| spread_partners(pages.len(), fpr));
        let (positions, _gaps, _clearances) = compute_system_y_positions(
            &staves_per_system,
            staff_height,
            &pages,
            config,
            0.0,
            Some(&system_heights_px),
            Some(&extras),
            partners.as_deref(),
        );
        // Offset: positions are bounding-box tops; staff sits below above_extras
        positions
            .iter()
            .enumerate()
            .map(|(i, &p)| p + above_staff_extras[i])
            .collect()
    } else {
        let max_sys_h = system_heights_px.iter().copied().fold(0.0f64, f64::max);
        (0..system_count)
            .map(|i| margin_top + i as f64 * (max_sys_h + inter_system_gap))
            .collect()
    };

    let page_w = config
        .page_width
        .unwrap_or(x_cursor + config.margin_right * sp);
    let total_width = if config.page_width.is_some() {
        page_w
    } else {
        x_cursor + config.margin_right * sp
    };
    let total_height = if config.page_width.is_some() {
        // Paged mode: the canvas spans the full page grid so it always
        // contains vertically-justified systems spread to the page bottom.
        pages.last().map_or(0.0, |p| p.y_offset + p.height)
    } else {
        let max_sys_h = system_heights_px.iter().copied().fold(0.0f64, f64::max);
        margin_top * 2.0
            + system_count as f64 * max_sys_h
            + if system_count > 1 {
                (system_count - 1) as f64 * inter_system_gap
            } else {
                0.0
            }
    };

    let mut dl = DisplayList::new(total_width, total_height);

    let lyric_line_order = score
        .global
        .lyrics
        .as_ref()
        .and_then(|gl| gl.line_order.as_deref());

    // ══════════════════════════════════════════════════════════════════════
    // Pass 2: Render using pre-computed layouts and actual Y positions.
    // ══════════════════════════════════════════════════════════════════════
    render_systems_pass2(
        &mut dl,
        &precomp_sys_layouts,
        &system_y_positions,
        &systems,
        &visible_resolved,
        margin_left,
        sp,
        config,
        score,
        lyric_line_order,
        part_index,
    );

    dl.pages = pages;
    dl.page_turn_warnings = page_turn_warnings;

    if !page_turn_hints.is_empty() {
        render_measure::render_page_turn_hints(&mut dl, &page_turn_hints, total_width, config);
    }

    if config.emit_layout_debug {
        emit_layout_debug(
            &mut dl,
            &visible_resolved,
            &natural_widths,
            &precomp_sys_layouts,
            &system_y_positions,
            &above_staff_extras,
            &below_staff_extras,
            sp,
            staff_height,
            config,
        );
    }

    dl
}

/// Grand-staff helper — compute the per-staff per-measure "natural"
/// (un-justified) widths, populating the cache when supplied. Returns
/// `(natural_widths_per_staff, content_hash_grid)`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn compute_below_staff_extra_from_layouts(
    layouts: &[MeasureLayout],
    sp: f64,
    stem_length: f64,
    config: &LayoutConfig,
) -> f64 {
    let staff_bottom = 4.0 * sp;

    // Note/stem protrusion below the staff, and the extent of any below-staff
    // dynamic. A dynamic is engraved *beneath* the notes it overlaps, so in a
    // measure that has both deep notes and a dynamic the dynamic reaches lower
    // than either alone. Reserve per measure (dynamic tied to the notes in its
    // own bar) so a dynamic under a low passage doesn't intrude into the next
    // system's space above its staff.
    let mut protrusion_extra = 0.0_f64;
    let mut dynamics_extra = 0.0_f64;
    for ml in layouts {
        let lowest = render_annotations::lowest_point_in_measure(ml, 0.0, sp, stem_length);
        // Articulations (accents, staccato, marcato, …) stack below the notes
        // they decorate and reach past the bare note/stem extreme; reserve for
        // their true bottom edge so they don't intrude into the next system.
        let (_artic_top, artic_bottom) =
            render_geometry::measure_articulation_extent(ml, 0.0, sp, config);
        let lowest = lowest.max(artic_bottom);
        let protrusion = (lowest - staff_bottom).max(0.0);
        protrusion_extra = protrusion_extra.max(protrusion);

        let has_dynamics = ml
            .resolved
            .part
            .dynamics
            .as_ref()
            .is_some_and(|d| !d.is_empty());
        if has_dynamics {
            // The dynamic glyph clears the lowest overlapping note by
            // `clearance` and then rises `glyph_ascent` from its baseline.
            // Floor at the standard below-staff dynamic distance for measures
            // whose notes stay on the staff.
            let clearance = 0.5 * sp;
            let glyph_ascent = 1.78 * sp;
            let dyn_reserve = (protrusion + clearance + glyph_ascent).max(4.5 * sp);
            dynamics_extra = dynamics_extra.max(dyn_reserve);
        }
    }

    // Check for below-staff annotations
    let has_lyrics = layouts.iter().any(|ml| {
        ml.resolved.part.sequences.iter().any(|seq| {
            seq.content.iter().any(|c| matches!(c, SequenceContent::Event(ev) if ev.lyrics.as_ref().is_some_and(|l| l.lines.as_ref().is_some_and(|ls| !ls.is_empty()))))
        })
    });
    let has_pedals = layouts.iter().any(|ml| {
        ml.resolved
            .part
            .pedals
            .as_ref()
            .is_some_and(|p| !p.is_empty())
    });

    let lyrics_extra = if has_lyrics { 5.0 * sp } else { 0.0 };
    let pedals_extra = if has_pedals { 7.0 * sp } else { 0.0 };

    // Below-staff bar numbers are real ink that protrudes below the staff and
    // must be cleared by the NEXT system's above-staff content (the
    // inter-system gap is built from this reservation). A system-start number
    // sits over the clef, so when a treble clef's tail descends below the
    // bottom line the number drops further with it. A collapsed multimeasure
    // rest prints a `{start}–{end}` range label one line below the staff. Both
    // were previously omitted, so a system whose only below-staff ink was its
    // bar number under-reserved and the following system crowded it.
    let font_size = 2.0 * sp;
    let mut number_extra = 0.0_f64;
    for ml in layouts {
        if ml.multimeasure_rest_count.is_some() {
            // Range label: fixed one-line-below position (no clef-tail clear).
            let bottom = staff_bottom + 0.5 * sp + font_size;
            number_extra = number_extra.max((bottom - staff_bottom).max(0.0));
        } else if render_annotations::measure_number_to_display(ml).is_some() {
            // System-start bar number (clef-tail aware). staff_y = 0 convention.
            let top = render_annotations::below_staff_number_top_y(ml, 0.0, sp, config);
            let bottom = top + font_size; // TextBaseline::Top
            number_extra = number_extra.max((bottom - staff_bottom).max(0.0));
        }
    }

    // The clef itself is real ink: a system-start clef whose tail descends below
    // the bottom staff line (the treble clef reaches ~1.68sp under line 5) must
    // be reserved so it doesn't spill into the next system / page margin. On a
    // resting (multimeasure-rest) system the clef tail is often the lowest ink
    // present, so without this the bbox bottom clips it. Clefs that stay inside
    // the staff (bass/alto) contribute nothing here. staff_y = 0 convention.
    let mut clef_extra = 0.0_f64;
    for ml in layouts {
        let renders_clef = ml.is_first_on_system || ml.resolved.index == 0;
        if !renders_clef {
            continue;
        }
        if let Some(clef) = render_annotations::start_clef(ml) {
            let clef_bottom = render_signatures::clef_bottom_y(clef, 0.0, sp);
            clef_extra = clef_extra.max((clef_bottom - staff_bottom).max(0.0));
        }
    }

    protrusion_extra
        .max(dynamics_extra)
        .max(lyrics_extra)
        .max(pedals_extra)
        .max(number_extra)
        .max(clef_extra)
}

/// Compute extra height needed above the top staff for system objects
/// (tempo, rehearsal marks, jump markers) and notes/stems that protrude
/// above the standard staff region.
///
/// Returns the extra space (in pixels) that should be added above the
/// top staff's Y position so that above-staff content doesn't collide
/// with the previous system's below-staff content.
///
/// This scans resolved measures for:
///  1. Stem-up notes above the staff (ledger-line space)
///  2. Tempo markings (text height + clearance)
///  3. Rehearsal marks (boxed text height + clearance)
///  4. Jump markers (segno/coda glyphs)
pub(crate) fn compute_above_staff_extra(
    measures: &[&ResolvedMeasure],
    measure_layouts: Option<&[MeasureLayout]>,
    sp: f64,
    stem_length: f64,
    config: &LayoutConfig,
) -> f64 {
    let mut has_tempo = false;
    let mut has_rehearsal = false;
    let mut has_jump = false;

    for rm in measures {
        if rm.global.tempos.as_ref().is_some_and(|t| !t.is_empty()) {
            has_tempo = true;
        }
        if rm.global.rehearsal_mark().is_some() {
            has_rehearsal = true;
        }
        if rm.global.segno.is_some()
            || rm.global.coda().is_some()
            || rm.global.fine.is_some()
            || rm.global.jump.is_some()
        {
            has_jump = true;
        }
    }

    // Find highest stem/note protrusion above the staff from measure layouts
    // (staff_y=0 convention: protrusion above staff is negative)
    let mut max_protrusion: f64 = 0.0;
    if let Some(mls) = measure_layouts {
        for ml in mls {
            let highest = render_annotations::highest_point_in_measure(ml, 0.0, sp, stem_length);
            // Articulations stacked above the notes reach past the bare
            // note/stem extreme; include their true top edge.
            let (artic_top, _artic_bottom) =
                render_geometry::measure_articulation_extent(ml, 0.0, sp, config);
            let highest = highest.min(artic_top);
            // An above-staff meter is engraved over the top line, so it is
            // part of the protrusion the system above has to clear.
            let highest = match time_signatures::above_staff_extent(
                ml,
                0.0,
                sp,
                config.time_signature_settings,
            ) {
                Some((_left, _right, top)) => highest.min(top),
                None => highest,
            };
            // highest < 0 means above the staff
            if highest < -max_protrusion {
                max_protrusion = -highest;
            }
        }
    }

    // Full note/stem/articulation protrusion above the top staff line. This
    // mirrors the below-staff side, which reserves the *full* extent below the
    // staff (no deadband) — keeping the system bbox and the inter-system
    // skyline-clearance math symmetric so above-staff content (ledger notes,
    // stems, accents) is reserved as accurately as below-staff content. The
    // default 7sp inter-staff gap still absorbs typical protrusions because the
    // gap is only inflated when `below_i + above_{i+1} + clearance` exceeds it.
    let stem_extra = max_protrusion.max(0.0);

    // Annotations sit ABOVE any note/stem protrusion: when notes reach high
    // above the staff the marking is pushed up with them, so its reserved
    // height must track the protrusion rather than assume the marking sits at
    // its minimum offset — otherwise the system above leaves too little room
    // and the marking collides with it. Each value below is the marking's full
    // top extent above the top staff line, mirroring the placement math in its
    // renderer (`render_tempo_markings`, `render_rehearsal_marks`,
    // `render_jump_markers`), and is floored at the previous fixed estimate so
    // this can only ever reserve more space, never less.
    let half_text = 1.2 * sp;
    // Jump markers: segno/coda glyph anchor gap + lift clearance from the
    // placement table (`segno.attachGap` / `.padding.vertical`), mirroring
    // `render_jump_markers`.
    let segno_metrics = config.placement.resolve(crate::render::ElementKind::Segno);
    let jump_attach_gap = segno_metrics.attach_gap;
    let jump_clearance = segno_metrics.padding.vertical * sp;
    // Tempo / rehearsal anchor gap + lift clearance from the placement table,
    // mirroring `resolve_tempo_placement` / `rehearsal_mark_placement` so the
    // reservation tracks the (edge-anchored) placement exactly.
    let tempo_attach_gap = config
        .placement
        .resolve(crate::render::ElementKind::Tempo)
        .attach_gap;
    let tempo_clearance = config
        .placement
        .resolve(crate::render::ElementKind::Tempo)
        .padding
        .vertical
        * sp;

    // Tempo: the reservation must equal the marking's ACTUAL rendered top, which
    // is x-aware — a tempo only lifts over obstacles that overlap *its own
    // x-span*, not the tallest obstacle anywhere in the system. A per-system
    // scalar built from a global obstacle over-reserves (a tempo at the system
    // start gets headroom for an MMR count number centred elsewhere) — the gap
    // shows once the frame pins the bbox top to the page margin. So compute each
    // tempo's top from `highest_point_in_range` over its x-span (plus a
    // multimeasure-rest count number only when it overlaps), mirroring
    // `resolve_tempo_placement`'s vertical math exactly. Falls back to the
    // protrusion-only estimate when measure layouts aren't available.
    let tempo_top = if !has_tempo {
        0.0
    } else if let Some(mls) = measure_layouts {
        let mut top = 0.0_f64;
        let scan_pad = 0.5 * sp;
        let notehead_w = 1.18 * sp;
        for (rm, ml) in measures.iter().zip(mls.iter()) {
            let Some(tempos) = rm.global.tempos.as_ref() else {
                continue;
            };
            let total_beats = ml.resolved.active_time.measure_beats();
            let content_width = ml.width - ml.prefix_width - 1.0 * sp;
            let x_origin = ml.x + ml.prefix_width;
            for tempo in tempos {
                let beat = tempo.location.as_ref().map_or(0.0, |loc| loc.beats());
                let tempo_x = if beat == 0.0 {
                    x_origin
                } else {
                    x_origin + (beat / total_beats) * content_width + notehead_w * 0.5
                };
                let width = render_annotations::tempo_marking_width(tempo, config, sp);
                let left = tempo_x - scan_pad;
                let right = tempo_x + width + scan_pad;
                let mut highest = render_annotations::highest_point_in_range(
                    ml,
                    0.0,
                    sp,
                    stem_length,
                    left,
                    right,
                );
                if let Some((nx_l, nx_r, ntop)) =
                    render_measure::multimeasure_rest_number_extent(ml, 0.0, sp)
                {
                    if nx_r >= left && nx_l <= right && ntop < highest {
                        highest = ntop;
                    }
                }
                let obstacle = (-highest).max(0.0);
                // Reserved top = text_size + max(attach_gap, obstacle+clearance),
                // edge-anchored: the tempo's ink bottom sits `attach_gap` above
                // the staff by default, or `clearance` above the obstacle when
                // lifted (see `resolve_tempo_placement`). `2*half_text` = the
                // full tempo text height.
                let this_top =
                    2.0 * half_text + (tempo_attach_gap * sp).max(obstacle + tempo_clearance);
                top = top.max(this_top);
            }
        }
        top
    } else {
        // No layouts: protrusion-only estimate (x-agnostic upper bound).
        2.0 * half_text + (tempo_attach_gap * sp).max(max_protrusion + tempo_clearance)
    };

    // Rehearsal: boxed cap-height text. Baseline-anchored from the placement
    // table (`rehearsalMark.attachGap` = staff→baseline), mirroring
    // `rehearsal_mark_placement`: the text baseline sits `attach_gap` above the
    // staff by default (so the box bottom dips a further `padding_y` toward the
    // staff), or the box bottom clears an obstacle by `clearance` when lifted.
    // Rehearsal marks anchor in a narrow box at the measure start, away from a
    // centred MMR count number, so they sit above the bare note/stem protrusion
    // only.
    let rehearsal_top = if has_rehearsal {
        let cap_height = 0.7 * 2.8 * sp;
        let padding_y = 0.4 * sp;
        let box_half = cap_height * 0.5 + padding_y;
        let r = config
            .placement
            .resolve(crate::render::ElementKind::RehearsalMark);
        // Resting box-bottom gap = baseline (`attach_gap`) minus the box's
        // internal `padding_y` (the border dips below the baseline). When lifted
        // the box bottom clears the protrusion by `padding.vertical` instead.
        2.0 * box_half
            + (r.attach_gap * sp - padding_y).max(max_protrusion + r.padding.vertical * sp)
    } else {
        0.0
    };

    // Jump markers: segno/coda glyph (~3sp tall), anchored `segno.attachGap`
    // above the staff (or lifted `segno.padding.vertical` over an obstacle).
    let jump_top = if has_jump {
        let glyph_half = 1.5 * sp;
        ((jump_attach_gap * sp).max(max_protrusion + jump_clearance + glyph_half) + glyph_half)
            .max(3.0 * sp)
    } else {
        0.0
    };

    // A collapsed multimeasure rest centers its big count number above the
    // H-bar (`{count}` as a time-signature digit, top ~2.5sp above the staff).
    // It is real ink that must sit inside the system box even when NO tempo
    // overlaps it — the tempo scan above only folds the count in as an obstacle
    // for a tempo at the same x, so a resting system carrying just the count
    // number would otherwise under-reserve and let it spill into the margin.
    // The clef's upper curl (the treble clef reaches ~1sp above line 5) is
    // likewise reserved on a system-start measure. staff_y = 0 convention.
    let mut glyph_top = 0.0_f64;
    if let Some(mls) = measure_layouts {
        for ml in mls {
            if let Some((_l, _r, top)) =
                render_measure::multimeasure_rest_number_extent(ml, 0.0, sp)
            {
                glyph_top = glyph_top.max((-top).max(0.0));
            }
            let renders_clef = ml.is_first_on_system || ml.resolved.index == 0;
            if renders_clef {
                if let Some(clef) = render_annotations::start_clef(ml) {
                    let clef_top = render_signatures::clef_top_y(clef, 0.0, sp);
                    glyph_top = glyph_top.max((-clef_top).max(0.0));
                }
            }
        }
    }

    // The single highest reserved point above the staff: the tallest marking
    // (each already includes the protrusion it sits above) or, when no marking
    // is present, the discounted stem protrusion.
    stem_extra
        .max(tempo_top)
        .max(rehearsal_top)
        .max(jump_top)
        .max(glyph_top)
}

/// Render the contents of a single system (staff lines already drawn by caller).
/// `next_system_clef` is the explicit start clef of the next system's first measure, if any.
/// When provided, a small courtesy clef is drawn at the end of this system before the barline.
pub(crate) fn render_system_contents(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    score: &Score,
    lyric_line_order: Option<&[String]>,
    is_last_system: bool,
    part_idx: usize,
    staff_y_offsets: Option<&[f64]>,
    next_system_clef: Option<&Clef>,
    staff_idx: Option<usize>,
    system_index: usize,
    is_expansion: bool,
    // Stitched-horizon: suppress the system-end barline on a non-final chunk.
    // The next chunk's first measure draws the boundary barline (same x, same
    // element_id), so emitting it here would double-draw it at the seam.
    suppress_final_barline: bool,
    // Clef-change measure set scoped to the staves SHOWN in this view (built by
    // the caller from the laid-out staves, not the whole score). A start-of-
    // measure clef change shifts the shared barline; in an individual-part view
    // only the shown part's changes count, so a clef change in an unrelated part
    // must not reserve a gap here.
    clef_change_measures: &HashSet<usize>,
    // Shared cross-measure accidental obstacle accumulator, threaded across all
    // staves of a system so two simultaneous chords on one staff (rendered by
    // separate per-staff/voice `render_system_contents` calls) clear each
    // other's accidentals. `(visual_staff, top, bottom, x_left, x_right)` px.
    acc_obstacles: &mut Vec<(u32, f64, f64, f64, f64)>,
    // Optional precomputed tie-accidental suppression map. When `None` the map
    // is built from THIS call's `measure_layouts` (correct for a single-system
    // render). Stitched-horizon callers pass `Some(global_map)` built over the
    // whole galley so a tie crossing a chunk seam keeps its accidental
    // suppressed — a per-chunk map can't see the target note in the next chunk.
    tie_accidentals_override: Option<&HashMap<String, bool>>,
) {
    let staff_height = 4.0 * sp;
    let use_beams = score
        .mnx
        .support
        .as_ref()
        .and_then(|s| s.use_beams)
        .unwrap_or(false);
    let use_accidental_display = score
        .mnx
        .support
        .as_ref()
        .and_then(|s| s.use_accidental_display)
        .unwrap_or(false);
    let staff_shape_start = dl.element_shapes.len();
    let staff_cmd_start = dl.commands.len();

    let global_beamed_ids = collect_all_beamed_event_ids(measure_layouts, use_beams);
    let explicit_beamed_ids = collect_explicit_beamed_event_ids(measure_layouts);
    let slur_map = collect_slur_participation(measure_layouts);
    let local_tie_accidentals;
    let tie_accidentals: &HashMap<String, bool> = match tie_accidentals_override {
        Some(global) => global,
        None => {
            local_tie_accidentals = compute_tie_accidental_map(measure_layouts);
            &local_tie_accidentals
        }
    };
    let mmr_number_extents: Vec<render_annotations::AboveGlyphBox> = measure_layouts
        .iter()
        .filter_map(|ml| render_measure::multimeasure_rest_number_extent(ml, staff_y, sp))
        .chain(measure_layouts.iter().filter_map(|ml| {
            time_signatures::above_staff_extent(ml, staff_y, sp, config.time_signature_settings)
        }))
        .collect();

    for (i, ml) in measure_layouts.iter().enumerate() {
        let prev_has_repeat_end = if i > 0 {
            measure_layouts[i - 1].resolved.global.repeat_end.is_some()
        } else {
            false
        };
        let prev_barline_type = if i > 0 {
            measure_layouts[i - 1]
                .resolved
                .global
                .barline
                .as_ref()
                .map(|b| &b.barline_type)
        } else {
            None
        };
        render_measure(
            dl,
            ml,
            render_measure::measure_repeat_span_right(measure_layouts, i),
            staff_y,
            sp,
            config,
            prev_has_repeat_end,
            prev_barline_type,
            &global_beamed_ids,
            &explicit_beamed_ids,
            lyric_line_order,
            staff_y_offsets,
            use_beams,
            use_accidental_display,
            Some(&slur_map),
            Some(tie_accidentals),
            &mmr_number_extents,
            clef_change_measures,
            acc_obstacles,
        );
        // Compute and collect bounding boxes for this measure's elements
        let bboxes = compute_measure_bboxes(
            ml,
            staff_y,
            sp,
            config,
            part_idx,
            Some(&slur_map),
            &global_beamed_ids,
            render_measure::measure_leading_clef_gap(ml, sp, clef_change_measures),
        );
        dl.extend_element_bboxes_with_shapes(bboxes);

        // Export measure layout bounds for cursor/ruler positioning
        dl.measure_bounds.push({
            let (total_beats, beat_anchors) = build_beat_anchors(ml);
            let leading_clef_gap =
                render_measure::measure_leading_clef_gap(ml, sp, clef_change_measures);
            let (bounds_x, bounds_width, bounds_prefix) =
                render_measure::measure_bounds_geometry(ml, leading_clef_gap);
            crate::render::MeasureBounds {
                index: ml.resolved.index,
                measure_id: ml.resolved.global.id.clone(),
                part_index: part_idx,
                staff_index: staff_idx.unwrap_or(part_idx),
                system_index,
                x: bounds_x,
                width: bounds_width,
                y: staff_y,
                height: 4.0 * sp,
                prefix_width: bounds_prefix,
                total_beats,
                beat_anchors,
                ghost_staff: false,
                is_hidden: false,
                has_music_hidden: false,
                is_expansion,
            }
        });
    }

    render_cross_barline_beams(dl, measure_layouts, staff_y, sp, config);
    render_ties(dl, measure_layouts, staff_y, sp, config, staff_y_offsets);
    let slur_geom_start = dl.slur_geometries.len();
    render_slurs(
        dl,
        measure_layouts,
        staff_y,
        sp,
        config,
        staff_y_offsets,
        staff_shape_start,
    );
    render_annotations::push_fermatas_clear_of_curves(dl, staff_cmd_start, slur_geom_start, sp);
    render_annotations::flow_above_staff_dependents(
        dl,
        staff_cmd_start,
        slur_geom_start,
        measure_layouts,
        &config.placement,
        staff_y,
        sp,
    );
    render_annotations::push_below_dynamics_under_slurs(
        dl,
        measure_layouts,
        staff_y,
        sp,
        slur_geom_start,
    );
    render_volta_brackets(dl, measure_layouts, staff_y, sp, part_idx);
    render_ottavas(dl, measure_layouts, staff_y, sp, part_idx);
    render_hairpins(
        dl,
        measure_layouts,
        staff_y,
        sp,
        config,
        part_idx,
        staff_cmd_start,
        slur_geom_start,
        None,
    );
    render_pedals(dl, measure_layouts, staff_y, sp, config, part_idx);

    // Final barline for this system
    if let Some(last) = measure_layouts.last().filter(|_| !suppress_final_barline) {
        let end_x = last.x + last.width;

        // Courtesy clef: draw a small 2/3-size clef before the system-end
        // barline when the next system starts with a different clef.
        if let Some(clef) = next_system_clef {
            let courtesy_x = end_x - 1.7 * sp;
            render_change_clef(dl, courtesy_x, staff_y, sp, clef);
        }

        let barline_kind = if last.resolved.global.repeat_end.is_some() {
            BarlineKind::RepeatEnd
        } else if is_last_system {
            BarlineKind::from(
                last.resolved
                    .global
                    .barline
                    .as_ref()
                    .map(|b| b.barline_type)
                    .unwrap_or(BarlineType::Final),
            )
        } else {
            BarlineKind::Regular
        };

        let barline_tag = element_id::barline(last.resolved.index + 1);
        let cmd_idx = dl.commands.len();
        render_barline(dl, end_x, staff_y, staff_height, sp, config, &barline_kind);
        for ci in cmd_idx..dl.commands.len() {
            dl.tag_command(ci, barline_tag.clone());
        }

        // Add selectable bbox for the final barline
        let barline_w = config.barline_width * sp;
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: barline_tag,
            bbox: BoundingBox::new(
                end_x - barline_w * 0.5,
                staff_y,
                barline_w.max(1.0 * sp),
                staff_height,
            ),
        });
    }

    render_repeat_counts(dl, measure_layouts, staff_y, sp);
}

mod full_score;
mod mnx_layout;
pub use full_score::*;
pub use mnx_layout::*;

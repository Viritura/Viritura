//! Tie rendering — bezier curves connecting tied notes.
//!
//! Ties share the same curve rendering pipeline as slurs (see `curves.rs`),
//! differing only in parameters: ties are thinner, flatter, and hug notehead
//! edges rather than centering on noteheads.

mod notehead_geometry;

use super::config::LayoutConfig;
use super::curves::{compute_filled_bezier, FilledBezierParams};
use super::element_id;
use super::slurs::tuning as slur_tuning;
use super::slurs::SystemSlurBounds;
use super::types::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

const TIE_STEM_INWARD_TUCK_SP: f64 = 0.25;
const TIE_CHAIN_TIP_GAP_SP: f64 = 0.4;

pub(crate) struct NoteRenderInfo {
    x: f64,
    stem_x: f64,
    y_pos: f64,       // staff position (half-spaces from top line)
    eff_staff_y: f64, // effective staff_y (cross-staff aware)
    stem_up: bool,
    inner_chord_note: bool,
    continues_tie: bool,
    notehead_center_offset: f64,
    measure_idx: usize,
}

/// Snapshot of one tied note captured per (system, part, staff) and
/// accumulated globally so a post-pass can resolve tie targets that the
/// per-staff `render_ties` call would miss when they land on another system.
///
/// Mirrors `slurs::GlobalSlurEvent`: `render_ties` only builds a note map for
/// the single staff it is handed, so a tie whose target note lives on the next
/// system (or page) is silently dropped. We accumulate every note here and run
/// `render_cross_system_ties` once after all systems are laid out, emitting the
/// tie as two half-curves at the system edges (standard engraving practice).
#[derive(Clone)]
pub(crate) struct GlobalTieNote {
    // Lever 2: `Rc<str>` (not `String`) so the per-edit retention path
    // (`splice_retained_slur_data` clones every retained note on reuse) is a
    // refcount bump instead of a heap alloc + copy. Byte-identity-transparent
    // (derefs to `&str`, so id equality / hashing / element-id construction is
    // unchanged).
    pub note_id: Rc<str>,
    /// Absolute X of the parent event (left edge of notehead).
    pub x: f64,
    pub stem_x: f64,
    /// This note's staff position (half-spaces from top line).
    pub y_pos: f64,
    /// Effective staff Y in absolute pixels (cross-staff aware).
    pub eff_staff_y: f64,
    pub stem_up: bool,
    pub num_voices: usize,
    pub notehead_center_offset: f64,
    /// All note staff-positions in the parent event (for `chord_tie_dir`).
    pub chord_positions: Vec<f64>,
    pub system_idx: usize,
    pub part_index: usize,
    pub staff_idx: usize,
    /// Ties originating on this note (empty for plain or target notes).
    pub ties: Vec<crate::model::event::Tie>,
}

fn has_continuing_tie(ties: &[crate::model::event::Tie]) -> bool {
    ties.iter()
        .any(|tie| tie.lv != Some(true) && tie.target.is_some())
}

/// Render tie curves across all measures.
///
/// Walks every note that has `ties` defined, locates the target note by ID,
/// and emits a `DrawBezier` command. The curve arcs below the notes when stems
/// point up and above when stems point down.
pub(crate) fn render_ties(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    staff_y_offsets: Option<&[f64]>,
) {
    let notehead_w = config.notehead_rx * 2.0 * sp;

    // Build note-ID → rendered-position map across all measures
    let mut note_map: HashMap<String, NoteRenderInfo> = HashMap::new();
    let mut incoming_tie_targets: HashSet<String> = HashSet::new();

    for (mi, ml) in measure_layouts.iter().enumerate() {
        for vl in &ml.voice_layouts {
            for ev in 0..vl.events.len() {
                let event = vl.events.event(ev);
                let eff_staff_y = super::render_measure::cross_staff_y_scalar(
                    event.staff,
                    vl.events.sequence_staff(ev),
                    staff_y,
                    staff_y_offsets,
                );
                let note_positions = vl.events.note_positions(ev);
                let note_x_offsets = vl.events.note_x_offsets(ev);
                let ex = vl.events.x(ev);
                let stem_up = vl.events.stem_up(ev);
                for (i, note) in event.notes().iter().enumerate() {
                    incoming_tie_targets.extend(
                        note.ties
                            .iter()
                            .flatten()
                            .filter(|tie| tie.lv != Some(true))
                            .filter_map(|tie| tie.target.clone()),
                    );
                    if let Some(ref id) = note.id {
                        if i < note_positions.len() {
                            note_map.insert(
                                id.clone(),
                                NoteRenderInfo {
                                    x: ex
                                        + note_x_offsets.get(i).copied().unwrap_or(0.0)
                                            * notehead_w,
                                    stem_x: if stem_up { ex + notehead_w } else { ex },
                                    y_pos: note_positions[i],
                                    eff_staff_y,
                                    stem_up,
                                    inner_chord_note: is_inner_chord_note(
                                        note_positions[i],
                                        note_positions,
                                    ),
                                    continues_tie: note
                                        .ties
                                        .as_deref()
                                        .is_some_and(has_continuing_tie),
                                    notehead_center_offset: notehead_geometry::center_offset(
                                        &event.duration.base,
                                        sp,
                                    ),
                                    measure_idx: mi,
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    // Emit bezier curves for each tied note pair
    for (mi, ml) in measure_layouts.iter().enumerate() {
        for vl in &ml.voice_layouts {
            let events: Vec<EventLayout> = (0..vl.events.len())
                .map(|i| vl.events.to_event_layout(i))
                .collect();
            for (ei, el) in events.iter().enumerate() {
                let src_staff_y =
                    super::render_measure::cross_staff_y(el, staff_y, staff_y_offsets);
                for (i, note) in el.event.notes().iter().enumerate() {
                    if let Some(ref ties) = note.ties {
                        if i >= el.note_positions.len() {
                            continue;
                        }
                        for tie in ties {
                            // Determine curve side override from tie.side
                            let side_override = tie.side.as_deref();

                            if tie.lv == Some(true) {
                                // Laissez vibrer: short trailing curve with no target
                                let src_note_id = note.id.as_deref().unwrap_or("");
                                // Compute right boundary: next event's x or measure right edge
                                let max_x = if ei + 1 < events.len() {
                                    events[ei + 1].x
                                } else {
                                    ml.x + ml.width
                                };
                                emit_lv_tie_bezier(
                                    dl,
                                    el,
                                    i,
                                    side_override,
                                    src_note_id,
                                    src_staff_y,
                                    sp,
                                    notehead_w,
                                    config,
                                    max_x,
                                );
                            } else if let Some(ref target_id) = tie.target {
                                if let Some(target) = note_map.get(target_id) {
                                    let src_note_id = note.id.as_deref().unwrap_or("");
                                    if has_repeat_end_between(
                                        measure_layouts,
                                        mi,
                                        target.measure_idx,
                                    ) {
                                        // Tie crosses a repeat barline: draw a partial
                                        // incoming tie from the target measure's left edge.
                                        let target_measure_x =
                                            measure_layouts[target.measure_idx].x;
                                        emit_incoming_tie_bezier(
                                            dl,
                                            target,
                                            side_override,
                                            target_measure_x,
                                            sp,
                                            config,
                                            el.stem_up,
                                            el.num_voices > 1,
                                            &el.note_positions,
                                            i,
                                            src_note_id,
                                            target_id,
                                        );
                                    } else {
                                        emit_tie_bezier(
                                            dl,
                                            el,
                                            i,
                                            target,
                                            incoming_tie_targets.contains(src_note_id),
                                            side_override,
                                            src_staff_y,
                                            sp,
                                            notehead_w,
                                            config,
                                            src_note_id,
                                            target_id,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Determine tie curve direction for a note within a chord.
///
/// Standard engraving rule: in chords the outermost ties curve outward
/// (top note up, bottom note down). Inner notes fall back to stem-based
/// direction. For single notes the stem-opposite rule applies.
///
/// In multi-voice writing this is overridden: every tie follows its voice's
/// stem direction so the upper voice's ties arch up and the lower voice's
/// arch down, fanning the voices apart (matching the slur/beam convention).
fn chord_tie_dir(note_pos: f64, all_positions: &[f64], stem_up: bool, multi_voice: bool) -> f64 {
    if multi_voice {
        // Tie follows the stem: stem-up voice curves above, stem-down below.
        return if stem_up { -1.0 } else { 1.0 };
    }
    if all_positions.len() <= 1 {
        // Single note: stem-opposite direction
        if stem_up {
            1.0
        } else {
            -1.0
        }
    } else {
        let min_pos = all_positions.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_pos = all_positions
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);
        if (note_pos - min_pos).abs() < 0.01 {
            // Top note (lowest staff position = highest on staff) → curve above
            -1.0
        } else if (note_pos - max_pos).abs() < 0.01 {
            // Bottom note (highest staff position = lowest on staff) → curve below
            1.0
        } else {
            // Inner note: stem-based default
            if stem_up {
                1.0
            } else {
                -1.0
            }
        }
    }
}

fn is_inner_chord_note(note_pos: f64, all_positions: &[f64]) -> bool {
    if all_positions.len() < 3 {
        return false;
    }
    let min_pos = all_positions.iter().copied().fold(f64::INFINITY, f64::min);
    let max_pos = all_positions
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    (note_pos - min_pos).abs() >= 0.01 && (note_pos - max_pos).abs() >= 0.01
}

#[allow(clippy::too_many_arguments)] // Endpoint placement needs note, stem, curve, span, and scale context.
fn tie_endpoint_x(
    note_x: f64,
    notehead_center_offset: f64,
    stem_x: f64,
    stem_up: bool,
    inner_chord_note: bool,
    curve_dir: f64,
    is_source: bool,
    chained: bool,
    span_dir: f64,
    sp: f64,
) -> f64 {
    let center_x = note_x + notehead_center_offset;
    if chained {
        let side = if is_source { 1.0 } else { -1.0 };
        return center_x + side * span_dir * TIE_CHAIN_TIP_GAP_SP * sp * 0.5;
    }
    let stem_side = (curve_dir < 0.0) == stem_up;
    let stem_between_note_and_span = if is_source {
        (stem_x - center_x) * span_dir > 0.0
    } else {
        (center_x - stem_x) * span_dir > 0.0
    };
    if stem_side || (inner_chord_note && stem_between_note_and_span) {
        let tuck = TIE_STEM_INWARD_TUCK_SP * sp;
        if is_source {
            stem_x + span_dir * tuck
        } else {
            stem_x - span_dir * tuck
        }
    } else {
        center_x
    }
}

/// Emit a single tie bezier between a source note and its target.
/// Uses the shared filled-bezier curve pipeline (same as slurs) with
/// tie-specific parameters for a thinner, flatter crescent.
///
/// Tie endpoints hug notehead edges (inset from sides), unlike slurs
/// which center on the notehead.
///
/// When `side_override` is Some("up") or Some("down"), it forces the curve
/// direction regardless of stem direction — used for MNX tie `side` field.
pub(crate) fn emit_tie_bezier(
    dl: &mut DisplayList,
    src_event: &EventLayout,
    src_note_idx: usize,
    target: &NoteRenderInfo,
    source_has_incoming_tie: bool,
    side_override: Option<&str>,
    staff_y: f64,
    sp: f64,
    notehead_w: f64,
    config: &LayoutConfig,
    src_note_id: &str,
    target_note_id: &str,
) {
    let src_pos = src_event.note_positions[src_note_idx];
    let src_y = staff_y + src_pos * sp * 0.5;
    let tgt_y = target.eff_staff_y + target.y_pos * sp * 0.5;

    // Curve direction: side override takes priority, then chord-aware per-note rule
    let curve_dir = match side_override {
        Some("up") => -1.0,  // "up" = above staff = negative Y
        Some("down") => 1.0, // "down" = below staff = positive Y
        _ => chord_tie_dir(
            src_pos,
            &src_event.note_positions,
            src_event.stem_up,
            src_event.num_voices > 1,
        ),
    };

    // Notehead-side endpoints stay centered. On the stem side, spring from
    // just beyond the stem and tuck inward into the inter-note space so the
    // tie cannot visually cross or merge with the stem.
    let src_note_x = src_event.x
        + src_event
            .note_x_offsets
            .get(src_note_idx)
            .copied()
            .unwrap_or(0.0)
            * notehead_w;
    let src_notehead_center_offset =
        notehead_geometry::center_offset(&src_event.event.duration.base, sp);
    let src_center_x = src_note_x + src_notehead_center_offset;
    let tgt_center_x = target.x + target.notehead_center_offset;
    let dir_x = if tgt_center_x >= src_center_x {
        1.0
    } else {
        -1.0
    };
    let x1 = tie_endpoint_x(
        src_note_x,
        src_notehead_center_offset,
        if src_event.stem_up {
            src_event.x + notehead_w
        } else {
            src_event.x
        },
        src_event.stem_up,
        is_inner_chord_note(src_pos, &src_event.note_positions),
        curve_dir,
        true,
        source_has_incoming_tie,
        dir_x,
        sp,
    );
    let x2 = tie_endpoint_x(
        target.x,
        target.notehead_center_offset,
        target.stem_x,
        target.stem_up,
        target.inner_chord_note,
        curve_dir,
        false,
        target.continues_tie,
        dir_x,
        sp,
    );

    // Y-offset: place endpoints just above/below the notehead
    let y_offset = curve_dir * slur_tuning::TIE_NOTEHEAD_STANDOFF_SP * sp;
    let y1 = src_y + y_offset;
    let y2 = tgt_y + y_offset;

    let eid = element_id::tie(src_note_id, target_note_id);
    let tie_params = FilledBezierParams {
        x1,
        y1,
        x2,
        y2,
        curve_dir,
        height_inf: config.tie_height_inf,
        rise_rate: config.tie_rise_rate,
        cp_indent: config.tie_cp_indent,
        thickness: config.tie_thickness * sp,
        min_thickness: config.tie_min_thickness * sp,
        endpoint_thickness: config.tie_endpoint_thickness * sp,
        sp,
        line_style: 0,
    };
    let band = super::curves::filled_bezier_band(&tie_params);
    dl.push_tagged(compute_filled_bezier(&tie_params), eid.clone());
    dl.push_shape_band(band, eid, ElementKind::Tie, None, None);
}

/// meaning the tie would visually cross a repeat boundary.
fn has_repeat_end_between(
    measure_layouts: &[MeasureLayout],
    src_idx: usize,
    tgt_idx: usize,
) -> bool {
    if src_idx >= tgt_idx {
        return false;
    }
    for ml in &measure_layouts[src_idx..tgt_idx] {
        if ml.resolved.global.repeat_end.is_some() {
            return true;
        }
    }
    false
}

/// Emit a partial incoming tie from the left edge of a measure to a target note.
/// Used when a tie crosses a repeat barline — the second ending shows a short
/// tie from the barline to the target notehead.
fn emit_incoming_tie_bezier(
    dl: &mut DisplayList,
    target: &NoteRenderInfo,
    side_override: Option<&str>,
    measure_x: f64,
    sp: f64,
    config: &LayoutConfig,
    src_stem_up: bool,
    src_multi_voice: bool,
    src_note_positions: &[f64],
    src_note_idx: usize,
    src_note_id: &str,
    target_note_id: &str,
) {
    let tgt_y = target.eff_staff_y + target.y_pos * sp * 0.5;

    let src_pos = if src_note_idx < src_note_positions.len() {
        src_note_positions[src_note_idx]
    } else {
        target.y_pos
    };
    let curve_dir = match side_override {
        Some("up") => -1.0,
        Some("down") => 1.0,
        _ => chord_tie_dir(src_pos, src_note_positions, src_stem_up, src_multi_voice),
    };

    // Start just inside the measure (past the barline)
    let x1 = measure_x + 0.3 * sp;
    let x2 = tie_endpoint_x(
        target.x,
        target.notehead_center_offset,
        target.stem_x,
        target.stem_up,
        target.inner_chord_note,
        curve_dir,
        false,
        target.continues_tie,
        1.0,
        sp,
    );

    let y_nudge = curve_dir * 0.2 * sp;
    let y1 = tgt_y + y_nudge;
    let y2 = tgt_y + y_nudge;

    let distance = (x2 - x1).abs();
    if distance < 0.5 * sp {
        return;
    }

    let eid = element_id::tie(src_note_id, target_note_id);
    let tie_params = FilledBezierParams {
        x1,
        y1,
        x2,
        y2,
        curve_dir,
        height_inf: config.tie_height_inf,
        rise_rate: config.tie_rise_rate,
        cp_indent: config.tie_cp_indent,
        thickness: config.tie_thickness * sp,
        min_thickness: config.tie_min_thickness * sp,
        endpoint_thickness: config.tie_endpoint_thickness * sp,
        sp,
        line_style: 0,
    };
    let band = super::curves::filled_bezier_band(&tie_params);
    dl.push_tagged(compute_filled_bezier(&tie_params), eid.clone());
    dl.push_shape_band(band, eid, ElementKind::Tie, None, None);
}
/// Emit a laissez vibrer (l.v.) tie— a short trailing curve with no target.
/// Uses the shared filled-bezier curve pipeline with l.v.-specific thickness.
/// `max_x` is the right boundary (next event x or measure edge) to avoid collision.
pub(crate) fn emit_lv_tie_bezier(
    dl: &mut DisplayList,
    src_event: &EventLayout,
    src_note_idx: usize,
    side_override: Option<&str>,
    src_note_id: &str,
    staff_y: f64,
    sp: f64,
    notehead_w: f64,
    config: &LayoutConfig,
    max_x: f64,
) {
    let src_pos = src_event.note_positions[src_note_idx];
    let src_y = staff_y + src_pos * sp * 0.5;

    let curve_dir = match side_override {
        Some("up") => -1.0,
        Some("down") => 1.0,
        _ => chord_tie_dir(
            src_pos,
            &src_event.note_positions,
            src_event.stem_up,
            src_event.num_voices > 1,
        ),
    };

    // L.v. tie should be ~3.5 sp long. Clamp against the next element to avoid
    // collision but enforce a clear minimum so the curve is always visible —
    // even when the following event is densely packed (e.g. a rest).
    let gap = 0.15 * sp;
    let x1 = src_event.x + notehead_w + gap;
    let desired_x2 = x1 + 3.5 * sp;
    let min_x2 = x1 + 2.0 * sp;
    let clamped = desired_x2.min((max_x - gap).max(min_x2));
    let x2 = clamped.max(min_x2);

    let y_nudge = curve_dir * 0.2 * sp;
    let y1 = src_y + y_nudge;
    let y2 = src_y + y_nudge;

    let eid = element_id::tie_lv(src_note_id);
    let lv_params = FilledBezierParams {
        x1,
        y1,
        x2,
        y2,
        curve_dir,
        height_inf: config.tie_height_inf,
        rise_rate: config.tie_rise_rate,
        cp_indent: config.tie_cp_indent,
        thickness: config.lv_tie_thickness * sp,
        // Use full thickness as minimum so short LV curves aren't scaled down
        min_thickness: config.lv_tie_thickness * sp,
        endpoint_thickness: config.tie_endpoint_thickness * sp,
        sp,
        line_style: 0,
    };
    let band = super::curves::filled_bezier_band(&lv_params);
    dl.push_tagged(compute_filled_bezier(&lv_params), eid.clone());
    dl.push_shape_band(band, eid, ElementKind::Tie, None, None);
}

// ═══════════════════════════════════════════
// Cross-system tie rendering
// ═══════════════════════════════════════════
//
// A tie whose source and target notes lie on different systems is dropped by
// `render_ties` (its note map is per (system, part, staff)). We add a second
// pass — run once after every system has been laid out — that emits the tie as
// two half-curves: one trailing off the right edge of the source system and
// one leading in from the left edge of the target system. This mirrors the
// cross-system slur pass and is standard engraving practice for ties broken by
// a system or page break.

/// Walk one staff's measure layouts and append a `GlobalTieNote` for every
/// note carrying an MNX id. Idempotent — call once per (system, part, staff)
/// tuple from the layout driver, alongside `collect_global_slur_events`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn collect_global_tie_notes(
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    staff_y_offsets: Option<&[f64]>,
    sp: f64,
    config: &LayoutConfig,
    system_idx: usize,
    part_index: usize,
    staff_idx: usize,
    out: &mut Vec<GlobalTieNote>,
) {
    let notehead_w = config.notehead_rx * 2.0 * sp;
    for ml in measure_layouts {
        for vl in &ml.voice_layouts {
            for ei in 0..vl.events.len() {
                let eff_staff_y = super::render_measure::cross_staff_y_scalar(
                    vl.events.event(ei).staff,
                    vl.events.sequence_staff(ei),
                    staff_y,
                    staff_y_offsets,
                );
                let ev_note_positions = vl.events.note_positions(ei);
                let note_x_offsets = vl.events.note_x_offsets(ei);
                let event_x = vl.events.x(ei);
                let stem_up = vl.events.stem_up(ei);
                for (i, note) in vl.events.event(ei).notes().iter().enumerate() {
                    let Some(ref id) = note.id else { continue };
                    if i >= ev_note_positions.len() {
                        continue;
                    }
                    out.push(GlobalTieNote {
                        note_id: Rc::from(id.as_str()),
                        x: event_x + note_x_offsets.get(i).copied().unwrap_or(0.0) * notehead_w,
                        stem_x: if stem_up {
                            event_x + notehead_w
                        } else {
                            event_x
                        },
                        y_pos: ev_note_positions[i],
                        eff_staff_y,
                        stem_up: vl.events.stem_up(ei),
                        num_voices: vl.events.num_voices(ei),
                        notehead_center_offset: notehead_geometry::center_offset(
                            &vl.events.event(ei).duration.base,
                            sp,
                        ),
                        chord_positions: ev_note_positions.to_vec(),
                        system_idx,
                        part_index,
                        staff_idx,
                        ties: note.ties.clone().unwrap_or_default(),
                    });
                }
            }
        }
    }
}

/// Render the *cross-system* portion of every tie in the score.
///
/// Same-system ties are already drawn (with the repeat-barline handling) by
/// the per-staff `render_ties` call inside the system loop; this pass only adds
/// the ties whose endpoints don't share a single (system, part, staff) triple.
///
/// `stitched_horizon` is set in chunked horizon mode (`page_width = None`,
/// `horizon_chunk_width > 0`), where the "systems" are retention chunks laid on
/// ONE continuous galley row rather than real page/system breaks. A tie across a
/// chunk seam must then be drawn as a single continuous curve (byte-identical to
/// the un-chunked galley), NOT the two trailing half-curves used at real breaks.
pub(crate) fn render_cross_system_ties(
    dl: &mut DisplayList,
    notes: &[GlobalTieNote],
    bounds: &HashMap<(usize, usize, usize), SystemSlurBounds>,
    sp: f64,
    config: &LayoutConfig,
    stitched_horizon: bool,
) {
    // Phase D early-exit: if no note carries any tie at all, skip the O(notes)
    // map build entirely.
    if notes.iter().all(|n| n.ties.is_empty()) {
        return;
    }

    // Lever 2 (alloc bucket): collect the note-ids actually referenced as tie
    // targets before building the lookup map. The map is only queried via
    // `idx_map.get(tie.target)`, so non-target notes never need an entry — yet
    // the old code inserted every note, allocating one `Vec<usize>` per distinct
    // id. Scoping to referenced targets is output-identical (every `get` below
    // looks up only a `target`, which is in this set by construction). LV ties
    // carry no target, so they contribute nothing.
    let mut referenced: std::collections::HashSet<&str> =
        std::collections::HashSet::with_capacity(notes.len() / 16 + 1);
    for n in notes {
        for tie in &n.ties {
            if tie.lv == Some(true) {
                continue;
            }
            if let Some(ref target_id) = tie.target {
                referenced.insert(target_id.as_str());
            }
        }
    }

    // note_id → candidate indices, scoped to referenced targets. Condensed-
    // expansion staves duplicate note IDs across the condensed + ghost staves,
    // so a single `id -> index` map would let an expansion copy win; keep all
    // candidates (mirrors the slur pass).
    let mut idx_map: HashMap<&str, Vec<usize>> = HashMap::with_capacity(referenced.len());
    for (i, n) in notes.iter().enumerate() {
        let id = n.note_id.as_ref();
        if referenced.contains(id) {
            idx_map.entry(id).or_default().push(i);
        }
    }

    for src in notes {
        for tie in &src.ties {
            // Laissez-vibrer ties are short trailing curves fully drawn
            // in-system (mirrors the `tie.lv == Some(true)` branch in
            // `render_ties`); they never connect to a target.
            if tie.lv == Some(true) {
                continue;
            }
            let Some(ref target_id) = tie.target else {
                continue;
            };
            let Some(target_indices) = idx_map.get(target_id.as_str()) else {
                continue;
            };

            // If any matching target is on the SAME system, the per-staff
            // `render_ties` pass already drew it (this also guards against
            // same-system condensed/expansion duplicates).
            if target_indices
                .iter()
                .any(|&i| notes[i].system_idx == src.system_idx)
            {
                continue;
            }

            // Resolve the target, preferring the same staff, then the same
            // part, then any candidate (shared with the slur pass).
            let Some(tgt_i) = super::cross_system::prefer_target(
                target_indices,
                src.part_index,
                src.staff_idx,
                |i| notes[i].part_index,
                |i| notes[i].staff_idx,
            ) else {
                continue;
            };

            emit_cross_system_tie(
                dl,
                src,
                &notes[tgt_i],
                referenced.contains(src.note_id.as_ref()),
                tie.side.as_deref(),
                bounds,
                sp,
                config,
                stitched_horizon,
            );
        }
    }
}

/// Emit a single CONTINUOUS tie between two notes that the per-staff
/// `render_ties` pass split across a stitched-horizon chunk seam.
///
/// Replicates `emit_tie_bezier`'s geometry exactly from the two `GlobalTieNote`
/// snapshots, so a tie spanning a chunk boundary renders identically to the
/// un-chunked single-system galley (the byte-identity contract for stitched
/// horizon). Unlike `emit_cross_system_tie`, it draws one curve from the source
/// notehead straight to the target notehead — there is no real break to span.
fn emit_stitched_tie(
    dl: &mut DisplayList,
    src: &GlobalTieNote,
    tgt: &GlobalTieNote,
    source_has_incoming_tie: bool,
    side_override: Option<&str>,
    sp: f64,
    config: &LayoutConfig,
) {
    let src_y = src.eff_staff_y + src.y_pos * sp * 0.5;
    let tgt_y = tgt.eff_staff_y + tgt.y_pos * sp * 0.5;

    let curve_dir = match side_override {
        Some("up") => -1.0,
        Some("down") => 1.0,
        _ => chord_tie_dir(
            src.y_pos,
            &src.chord_positions,
            src.stem_up,
            src.num_voices > 1,
        ),
    };

    let src_center_x = src.x + src.notehead_center_offset;
    let tgt_center_x = tgt.x + tgt.notehead_center_offset;
    let span_dir = if tgt_center_x >= src_center_x {
        1.0
    } else {
        -1.0
    };
    let x1 = tie_endpoint_x(
        src.x,
        src.notehead_center_offset,
        src.stem_x,
        src.stem_up,
        is_inner_chord_note(src.y_pos, &src.chord_positions),
        curve_dir,
        true,
        source_has_incoming_tie,
        span_dir,
        sp,
    );
    let x2 = tie_endpoint_x(
        tgt.x,
        tgt.notehead_center_offset,
        tgt.stem_x,
        tgt.stem_up,
        is_inner_chord_note(tgt.y_pos, &tgt.chord_positions),
        curve_dir,
        false,
        has_continuing_tie(&tgt.ties),
        span_dir,
        sp,
    );

    let y_offset = curve_dir * slur_tuning::TIE_NOTEHEAD_STANDOFF_SP * sp;
    let y1 = src_y + y_offset;
    let y2 = tgt_y + y_offset;

    let eid = element_id::tie(&src.note_id, &tgt.note_id);
    let tie_params = FilledBezierParams {
        x1,
        y1,
        x2,
        y2,
        curve_dir,
        height_inf: config.tie_height_inf,
        rise_rate: config.tie_rise_rate,
        cp_indent: config.tie_cp_indent,
        thickness: config.tie_thickness * sp,
        min_thickness: config.tie_min_thickness * sp,
        endpoint_thickness: config.tie_endpoint_thickness * sp,
        sp,
        line_style: 0,
    };
    let band = super::curves::filled_bezier_band(&tie_params);
    dl.push_tagged(compute_filled_bezier(&tie_params), eid.clone());
    dl.push_shape_band(band, eid, ElementKind::Tie, None, None);
}

/// Emit the two half-curves for one cross-system tie: the source half trails
/// off the right edge of the source system, the target half leads in from the
/// left edge of the target system. Ties are nearly horizontal, so each half is
/// drawn flat at its notehead's Y (unlike the arcing slur halves).
fn emit_cross_system_tie(
    dl: &mut DisplayList,
    src: &GlobalTieNote,
    tgt: &GlobalTieNote,
    source_has_incoming_tie: bool,
    side_override: Option<&str>,
    bounds: &HashMap<(usize, usize, usize), SystemSlurBounds>,
    sp: f64,
    config: &LayoutConfig,
    stitched_horizon: bool,
) {
    // Stitched-horizon chunk seam: the two "systems" are one continuous galley
    // row, so draw a single continuous tie (byte-identical to the un-chunked
    // single-system layout) rather than two trailing half-curves.
    if stitched_horizon {
        emit_stitched_tie(
            dl,
            src,
            tgt,
            source_has_incoming_tie,
            side_override,
            sp,
            config,
        );
        return;
    }

    let Some(&src_b) = bounds.get(&(src.system_idx, src.part_index, src.staff_idx)) else {
        return;
    };
    let Some(&tgt_b) = bounds.get(&(tgt.system_idx, tgt.part_index, tgt.staff_idx)) else {
        return;
    };

    // Direction is computed once from the source note's chord context and used
    // for BOTH halves so the broken tie reads as a single curve.
    let curve_dir = match side_override {
        Some("up") => -1.0,
        Some("down") => 1.0,
        _ => chord_tie_dir(
            src.y_pos,
            &src.chord_positions,
            src.stem_up,
            src.num_voices > 1,
        ),
    };

    let y_offset = curve_dir * slur_tuning::TIE_NOTEHEAD_STANDOFF_SP * sp;
    let src_y = src.eff_staff_y + src.y_pos * sp * 0.5 + y_offset;
    let tgt_y = tgt.eff_staff_y + tgt.y_pos * sp * 0.5 + y_offset;

    // Reading order, not absolute X. The two notes sit on different systems, so
    // their x coordinates are not comparable: a system's last note lies far
    // right while the next system's first note lies far left. A tie broken by a
    // system break always runs left-to-right in reading order, so derive the
    // span from system order.
    let span_dir = if tgt.system_idx >= src.system_idx {
        1.0
    } else {
        -1.0
    };
    let src_x = tie_endpoint_x(
        src.x,
        src.notehead_center_offset,
        src.stem_x,
        src.stem_up,
        is_inner_chord_note(src.y_pos, &src.chord_positions),
        curve_dir,
        true,
        source_has_incoming_tie,
        span_dir,
        sp,
    );
    let tgt_x = tie_endpoint_x(
        tgt.x,
        tgt.notehead_center_offset,
        tgt.stem_x,
        tgt.stem_up,
        is_inner_chord_note(tgt.y_pos, &tgt.chord_positions),
        curve_dir,
        false,
        has_continuing_tie(&tgt.ties),
        span_dir,
        sp,
    );

    // Inner endpoints. The source (outgoing) half trails off toward the right
    // margin (0.5sp inset). The target (incoming) half begins a short reach
    // before the notehead rather than sweeping in from the system start across
    // the clef/key signature (standard engraving practice), clamped so it never
    // crosses the system's left content edge for a note hard against the margin.
    const CONTINUATION_REACH_SP: f64 = 2.5;
    let src_end_x = (src_b.right_x - 0.5 * sp).max(src_x + 1.0 * sp);
    let tgt_start_x = (tgt_x - CONTINUATION_REACH_SP * sp).max(tgt_b.left_x + 0.5 * sp);

    let eid = element_id::tie(&src.note_id, &tgt.note_id);
    let params = |x1: f64, x2: f64, y: f64| FilledBezierParams {
        x1,
        y1: y,
        x2,
        y2: y,
        curve_dir,
        height_inf: config.tie_height_inf,
        rise_rate: config.tie_rise_rate,
        cp_indent: config.tie_cp_indent,
        thickness: config.tie_thickness * sp,
        min_thickness: config.tie_min_thickness * sp,
        endpoint_thickness: config.tie_endpoint_thickness * sp,
        sp,
        line_style: 0,
    };

    // Source half: source notehead → near right edge of source system.
    let lh_id = format!("{}/lh", eid);
    let lh_params = params(src_x, src_end_x, src_y);
    let lh_band = super::curves::filled_bezier_band(&lh_params);
    dl.push_tagged(compute_filled_bezier(&lh_params), lh_id.clone());
    dl.push_shape_band(lh_band, lh_id, ElementKind::Tie, None, None);

    // Target half: near left edge of target system → target notehead.
    let rh_id = format!("{}/rh", eid);
    let rh_params = params(tgt_start_x, tgt_x, tgt_y);
    let rh_band = super::curves::filled_bezier_band(&rh_params);
    dl.push_tagged(compute_filled_bezier(&rh_params), rh_id.clone());
    dl.push_shape_band(rh_band, rh_id, ElementKind::Tie, None, None);
}

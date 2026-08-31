use super::super::config::LayoutConfig;
use super::super::element_id;
use super::broken_segments::{
    default_cp_indent_for_chord, default_shoulder_for_chord, emit_middle_segments,
    plan_broken_segments, shape_note_bound_segment,
};
use super::continuation_dependents::resolve_cross_system_slur_dependents;
use super::global_endpoints::{GlobalSlurEvent, SystemSlurBounds};
use super::obstacle_shapes::collect_seam_span_tie_obstacles;
use super::participation::*;
use super::participation_roles::compute_slur_direction;
use super::render::*;
use super::scorer::{select_slur_candidate, SlurShapeInput};
use super::tie_chains::TieChainIndex;
use super::tie_lanes::tie_endpoint_lane;
use super::tuning;
use crate::render::*;
use std::collections::HashMap;

// ═══════════════════════════════════════════
// Cross-system slur rendering
// ═══════════════════════════════════════════
//
// A slur whose source and target lie on different (system, part, staff)
// triples is dropped by `render_slurs` (its `event_map` is per-staff only).
// We add a second pass that runs once after every system has been laid out
// and rendered, emitting the slur as two half-beziers — one trailing off
// the right edge of the source system, one leading in from the left edge
// of the target system. This is standard engraving practice for slurs that
// cross a system or page break
//
// Same-system slurs are already rendered with collision avoidance by
// `render_slurs` and are skipped here to avoid double-drawing.

/// Render the *cross-system* portion of every slur in the score.
///
/// Same-staff/same-system slurs are already rendered (with full collision
/// avoidance) by the per-staff `render_slurs` call inside the system loop.
/// This pass only adds the slurs whose endpoints don't share a single
/// (system, part, staff) triple — those would otherwise be silently dropped.
///
/// `stitched_horizon` is set in chunked horizon mode (`page_width = None`,
/// `horizon_chunk_width > 0`), where the "systems" are retention chunks laid on
/// ONE continuous galley row rather than real page/system breaks. A slur across
/// a chunk seam is drawn as one continuous, obstacle-aware arc (NOT the two
/// trailing half-curves used at real breaks). The bounded snapshot slice feeds
/// the same encompass and candidate-scoring model as an ordinary slur.
pub(crate) fn render_cross_system_slurs(
    dl: &mut DisplayList,
    events: &[GlobalSlurEvent],
    bounds: &HashMap<(usize, usize, usize), SystemSlurBounds>,
    sp: f64,
    config: &LayoutConfig,
    stitched_horizon: bool,
) {
    if events.iter().all(|event| event.slurs.is_empty()) {
        return;
    }

    let mut tie_chains = TieChainIndex::default();
    for event in events {
        tie_chains.add_event(
            &event.event_id,
            event
                .note_positions
                .iter()
                .map(|(note_id, _, _)| note_id.as_ref()),
            event
                .tie_links
                .iter()
                .map(|(source, target)| (source.as_ref(), target.as_ref())),
        );
    }

    // Lever 2 (alloc bucket): in ONE pass collect (a) the event-ids referenced
    // as slur targets and (b) the note-ids referenced by start_note/end_note
    // overrides. The lookup maps below are only ever queried for these ids, so
    // every other event/note can be skipped — avoiding the per-id `Vec`/`String`
    // allocations the old "insert everything" code paid (~95K on Rhapsody). An
    // empty `referenced` set means no event carries a slur, which subsumes the
    // old `all(|e| e.slurs.is_empty())` early-exit scan (one fewer O(events) pass).
    let mut referenced: std::collections::HashSet<String> =
        std::collections::HashSet::with_capacity(events.len() / 16 + 1);
    let mut referenced_notes: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in events {
        for slur in &e.slurs {
            let source = tie_chains.resolve(&e.event_id, slur.start_note.as_deref(), true);
            let target = tie_chains.resolve_slur_target(
                &slur.target,
                slur.end_note.as_deref(),
                e.endpoint.mag < 1.0,
            );
            referenced.insert(source.event_id);
            referenced.insert(target.event_id);
            if let Some(note_id) = source.note_id {
                referenced_notes.insert(note_id);
            }
            if let Some(note_id) = target.note_id {
                referenced_notes.insert(note_id);
            }
        }
    }

    // Global event_id → candidate indices lookup, scoped to referenced targets.
    // Condensed expansion staves intentionally duplicate source event IDs
    // (condensed staff + source ghost staves), so a single `event_id -> index`
    // map would let the last duplicate win and can redirect a normal same-staff
    // slur to an expansion copy. Keep all candidates and prefer the source
    // event's own rendered staff before emitting any continuation halves.
    let mut idx_map: HashMap<&str, Vec<usize>> = HashMap::with_capacity(referenced.len());
    for (i, e) in events.iter().enumerate() {
        let id = e.event_id.as_ref();
        if referenced.contains(id) {
            idx_map.entry(id).or_default().push(i);
        }
    }

    // Precompute (leftmost_idx, rightmost_idx) per (system, part, staff).
    // Lets `emit_cross_system_slur` look up the extremal event in O(1)
    // instead of scanning every global event twice per cross-system slur.
    let mut extremes: HashMap<(usize, usize, usize), (usize, usize)> = HashMap::new();
    for (i, e) in events.iter().enumerate() {
        let key = (e.system_idx, e.part_index, e.staff_idx);
        extremes
            .entry(key)
            .and_modify(|(lo, hi)| {
                if e.x < events[*lo].x {
                    *lo = i;
                }
                if e.x > events[*hi].x {
                    *hi = i;
                }
            })
            .or_insert((i, i));
    }

    // Build the note-id → (y_pos, eff_staff_y) lookup lazily — only when at
    // least one cross-system slur actually carries a `start_note` /
    // `end_note` reference. The map is `O(global_notes)` regardless of slur
    // count, and most scores have zero cross-system slurs at all.
    let mut note_map: HashMap<String, (f64, f64)> = HashMap::new();
    let mut note_map_built = false;
    let dependent_shape_end = dl.element_shapes.len();
    let slur_geometry_start = dl.slur_geometries.len();

    for src in events {
        for slur in &src.slurs {
            let resolved_source =
                tie_chains.resolve(&src.event_id, slur.start_note.as_deref(), true);
            let resolved_target = tie_chains.resolve_slur_target(
                &slur.target,
                slur.end_note.as_deref(),
                src.endpoint.mag < 1.0,
            );
            let Some(source_indices) = idx_map.get(resolved_source.event_id.as_str()) else {
                continue;
            };
            let Some(src_i) = crate::layout::cross_system::prefer_target(
                source_indices,
                src.part_index,
                src.staff_idx,
                |i| events[i].part_index,
                |i| events[i].staff_idx,
            ) else {
                continue;
            };
            let effective_src = &events[src_i];
            let Some(target_indices) = idx_map.get(resolved_target.event_id.as_str()) else {
                continue;
            };
            let src_key = (
                effective_src.system_idx,
                effective_src.part_index,
                effective_src.staff_idx,
            );

            // This pass renders open-ended continuation halves at system
            // edges. If any matching target is on the same system, emitting
            // here would produce the visual bug where a same-line slur wraps
            // toward the margin and then back to a duplicate expansion staff.
            if target_indices
                .iter()
                .any(|&i| events[i].system_idx == effective_src.system_idx)
            {
                continue;
            }

            // If the target exists on the same rendered staff, the per-staff
            // slur pass already emitted it. This is also the crucial duplicate-
            // ID guard for condensed staff expansion.
            if target_indices.iter().any(|&i| {
                let tgt = &events[i];
                (tgt.system_idx, tgt.part_index, tgt.staff_idx) == src_key
            }) {
                continue;
            }

            let Some(tgt_i) = crate::layout::cross_system::prefer_target(
                target_indices,
                effective_src.part_index,
                effective_src.staff_idx,
                |i| events[i].part_index,
                |i| events[i].staff_idx,
            ) else {
                continue;
            };
            let tgt = &events[tgt_i];

            // Lazy note_map build on first cross-system slur encountered, scoped
            // to only the note-ids referenced by start_note/end_note overrides
            // (Lever 2: avoid cloning all ~95K note ids when a handful — often
            // zero — are actually looked up). `note_map` is read only via
            // get(start_note/end_note), so this stays output-identical.
            if !note_map_built {
                if !referenced_notes.is_empty() {
                    for e in events {
                        for (nid, y, eff) in &e.note_positions {
                            if referenced_notes.contains(nid.as_ref()) {
                                note_map.insert(nid.to_string(), (*y, *eff));
                            }
                        }
                    }
                }
                note_map_built = true;
            }

            let mut resolved_slur = slur.clone();
            resolved_slur.start_note = resolved_source.note_id;
            resolved_slur.end_note = resolved_target.note_id;
            emit_cross_system_slur(
                dl,
                effective_src,
                tgt,
                &resolved_slur,
                &src.event_id,
                events,
                &extremes,
                &note_map,
                bounds,
                sp,
                config,
                stitched_horizon,
            );
        }
    }

    resolve_cross_system_slur_dependents(dl, dependent_shape_end, slur_geometry_start, sp);
}

fn stitched_span_obstacles(
    events: &[GlobalSlurEvent],
    source: &GlobalSlurEvent,
    target: &GlobalSlurEvent,
    sp: f64,
    config: &LayoutConfig,
) -> Vec<SlurObstacle> {
    let x_lo = source.x.min(target.x);
    let x_hi = source.x.max(target.x);
    let notehead_half_height = config.notehead_ry * sp;
    let mut obstacles = Vec::new();
    for event in events {
        if event.part_index != source.part_index
            || event.staff_idx != source.staff_idx
            || event.x <= x_lo
            || event.x >= x_hi
        {
            continue;
        }
        let note_top = event.eff_staff_y + event.y_pos * sp * 0.5 - notehead_half_height;
        let note_bottom = event.eff_staff_y + event.y_pos_bottom * sp * 0.5 + notehead_half_height;
        let (mut top, mut bottom) = if event.stem_up {
            (
                note_top.min(event.eff_staff_y + event.y_pos * sp * 0.5 - config.stem_length * sp),
                note_bottom,
            )
        } else {
            (
                note_top,
                note_bottom.max(
                    event.eff_staff_y + event.y_pos_bottom * sp * 0.5 + config.stem_length * sp,
                ),
            )
        };
        if let Some(beam_top) = event.beam_top_y {
            top = top.min(beam_top);
        }
        if let Some(beam_bottom) = event.beam_bottom_y {
            bottom = bottom.max(beam_bottom);
        }
        obstacles.push(SlurObstacle {
            event_id: Some(event.event_id.to_string()),
            voice_idx: event.voice_idx,
            x: event.x + event.notehead_w * 0.5,
            y_top: top,
            y_bottom: bottom,
            notehead_y_top: Some(note_top),
            notehead_y_bottom: Some(note_bottom),
            is_tie: false,
            is_articulation: false,
        });
        if let Some((articulation_top, articulation_bottom)) = event.articulation_extent {
            obstacles.push(SlurObstacle {
                event_id: Some(event.event_id.to_string()),
                voice_idx: event.voice_idx,
                x: event.x + event.notehead_w * 0.5,
                y_top: articulation_top,
                y_bottom: articulation_bottom,
                notehead_y_top: None,
                notehead_y_bottom: None,
                is_tie: false,
                is_articulation: true,
            });
        }
    }
    obstacles.sort_by(|left, right| left.x.total_cmp(&right.x));
    obstacles
}

#[allow(clippy::too_many_arguments)]
fn publish_cross_system_segment(
    dl: &mut DisplayList,
    command: RenderCommand,
    element_id: String,
    p0: (f64, f64),
    spine: (f64, f64, f64, f64),
    p3: (f64, f64),
    thickness: f64,
    curve_dir: f64,
    sp: f64,
    system_idx: usize,
    staff_idx: usize,
) {
    dl.slur_geometries.push(SlurGeometry {
        element_id: element_id.clone(),
        p0_x: p0.0,
        p0_y: p0.1,
        p1_x: spine.0,
        p1_y: spine.1,
        p2_x: spine.2,
        p2_y: spine.3,
        p3_x: p3.0,
        p3_y: p3.1,
        thickness,
        curve_dir,
        sp,
    });
    let band = crate::layout::curves::sample_cubic_band(
        p0,
        (spine.0, spine.1),
        (spine.2, spine.3),
        p3,
        thickness,
    );
    dl.push_shape_band(
        band,
        element_id.clone(),
        ElementKind::Slur,
        Some(system_idx as u32),
        Some(staff_idx as u32),
    );
    dl.push_tagged(command, element_id);
}

/// Emit the two half-beziers for one cross-system slur.
///
/// Each half is a real bezier whose:
///   • **outer endpoint** sits at the source/target notehead (same Y rules
///     as the in-system path);
///   • **inner endpoint X** is just inside the system edge (past the final
///     barline / before the clef);
///   • **inner endpoint Y** follows the *extremal note column on that
///     system*, offset 0.5sp away from the music in the slur direction
///     (standard engraving practice) and capped to ±2.5sp from the outer
///     endpoint so a continuation does not acquire an extreme slope;
///   • **shoulder height + CP indent** are computed from the half's own
///     chord length using the same schedule as full in-system slurs, so each
///     half arcs naturally instead of running flat.
///
/// Standard engraving practice: continuation-slur Y offset ~0.4 sp,
/// extremal-column Y with ~0.5 sp offset (-1.5 sp if stem matches slur
/// direction).
#[allow(clippy::too_many_arguments, clippy::too_many_lines)] // one continuation-geometry pipeline
pub(super) fn emit_cross_system_slur(
    dl: &mut DisplayList,
    src: &GlobalSlurEvent,
    tgt: &GlobalSlurEvent,
    slur: &crate::model::event::Slur,
    authored_source_id: &str,
    all_events: &[GlobalSlurEvent],
    extremes: &HashMap<(usize, usize, usize), (usize, usize)>,
    note_map: &HashMap<String, (f64, f64)>,
    bounds: &HashMap<(usize, usize, usize), SystemSlurBounds>,
    sp: f64,
    config: &LayoutConfig,
    stitched_horizon: bool,
) {
    let pieces = plan_broken_segments(
        src.system_idx,
        tgt.system_idx,
        src.part_index,
        src.staff_idx,
        bounds,
        extremes,
    );
    let (Some(src_piece), Some(tgt_piece)) = (pieces.first(), pieces.last()) else {
        return;
    };

    // ── Curve direction & line style (same rules as in-system path) ────
    // Direction is computed once and used for BOTH halves so the broken
    // slur reads as a single arc (standard engraving practice: post-break
    // half inherits direction from the pre-break half).
    // S3: shared helper applies multi-voice parity when num_voices > 1.
    let grace_slur = src.mag < 1.0 || tgt.mag < 1.0;
    let grace_collision_above = grace_slur
        && (src.y_pos <= -2.0
            || src.y_pos_bottom >= 10.0
            || tgt.y_pos <= -2.0
            || tgt.y_pos_bottom >= 10.0
            || (src.mag >= 1.0 && src.accidental_right_x.is_some())
            || (tgt.mag >= 1.0 && tgt.accidental_right_x.is_some()));
    let curve_above = match slur.side.as_deref() {
        Some("up") => true,
        Some("down") => false,
        _ if grace_collision_above => true,
        _ if grace_slur && src.num_voices > 1 => src.voice_idx % 2 == 1,
        _ if grace_slur => false,
        _ if src.num_voices > 1 && src.voice_idx == tgt.voice_idx => src.voice_idx % 2 == 1,
        _ if src.stem_up != tgt.stem_up => true,
        _ if src.outgoing_tie && src.note_count == 1 && src.num_voices == 1 => true,
        _ => compute_slur_direction(None, src.voice_idx, src.num_voices, src.stem_up),
    };
    // ── S11: Cross-system + cross-staff direction ────────────────
    // When the slur spans both a system break AND different staves (e.g.
    // cross-staff piano slur broken across a system), default to curve_below
    // matching the in-system S6 rule so both halves read consistently.
    let cross_staff_global =
        slur.side.is_none() && (src.staff_idx != tgt.staff_idx || src.staff_move != tgt.staff_move);
    let curve_above = if cross_staff_global && !grace_collision_above {
        false
    } else {
        curve_above
    };
    let curve_dir: f64 = if curve_above { -1.0 } else { 1.0 };
    let line_style: u8 = match slur.line_type {
        Some(crate::model::event::SlurLineType::Dashed) => 1,
        Some(crate::model::event::SlurLineType::Dotted) => 2,
        _ => 0,
    };

    // ── Outer endpoints ────────────────────────────────────────────────
    // `startNote` / `endNote` overrides let MNX point the slur at a specific
    // note within a chord; default to the chord's top (above) or bottom
    // (below) note.
    let nh_h = 0.45 * sp;
    let notehead_side_offset = nh_h * 1.55;

    let (src_y_pos, src_eff_y) = slur
        .start_note
        .as_ref()
        .and_then(|id| note_map.get(id).copied())
        .unwrap_or((
            if curve_above {
                src.y_pos
            } else {
                src.y_pos_bottom
            },
            src.eff_staff_y,
        ));
    let (tgt_y_pos, tgt_eff_y) = slur
        .end_note
        .as_ref()
        .and_then(|id| note_map.get(id).copied())
        .unwrap_or((
            if (src.mag < 1.0 && tgt.note_count > 1) || curve_above {
                tgt.y_pos
            } else {
                tgt.y_pos_bottom
            },
            tgt.eff_staff_y,
        ));

    let notehead_w = src.notehead_w;
    let src_center_x = src.x + notehead_w * 0.5;
    let tgt_center_x = tgt.x + notehead_w * 0.5;
    let src_targets_note = slur.start_note.is_some();
    let tgt_targets_note = slur.end_note.is_some();
    let src_stem_side =
        !grace_slur && src.has_stem && !src_targets_note && curve_above == src.stem_up;
    let tgt_stem_side =
        !grace_slur && tgt.has_stem && !tgt_targets_note && curve_above == tgt.stem_up;
    let src_targets_outer_stem_note = !src_targets_note
        || if src.stem_up {
            (src_y_pos - src.y_pos).abs() < 1.0e-6
        } else {
            (src_y_pos - src.y_pos_bottom).abs() < 1.0e-6
        };
    let tgt_targets_outer_stem_note = !tgt_targets_note
        || if tgt.stem_up {
            (tgt_y_pos - tgt.y_pos).abs() < 1.0e-6
        } else {
            (tgt_y_pos - tgt.y_pos_bottom).abs() < 1.0e-6
        };
    let src_stem_side_x =
        !grace_slur && src.has_stem && curve_above == src.stem_up && src_targets_outer_stem_note;
    let tgt_stem_side_x =
        !grace_slur && tgt.has_stem && curve_above == tgt.stem_up && tgt_targets_outer_stem_note;
    let stem_tuck = tuning::STEM_INWARD_TUCK_SP * sp;
    let src_x = if src_stem_side_x {
        (if src.stem_up {
            src.x + src.notehead_w
        } else {
            src.x
        }) + stem_tuck
    } else {
        src_center_x
    };
    let tgt_x = if tgt_stem_side_x {
        (if tgt.stem_up {
            tgt.x + tgt.notehead_w
        } else {
            tgt.x
        }) - stem_tuck
    } else {
        tgt_center_x
    };
    let grace_offset = 0.65 * notehead_side_offset;
    let src_offset = if grace_slur {
        grace_offset
    } else {
        notehead_side_offset
    };
    let tgt_offset = if src.mag < 1.0 && tgt.note_count > 1 && slur.end_note.is_none() {
        0.10 * sp
    } else if grace_slur {
        grace_offset
    } else {
        notehead_side_offset
    };
    let src_y_base = src_eff_y
        + src_y_pos * sp * 0.5
        + curve_dir
            * if src_stem_side {
                (config.stem_length + tuning::STEM_EXTENSION_SP) * sp
            } else {
                src_offset
            };
    let src_y = if src_stem_side && curve_dir < 0.0 {
        src.beam_top_y.map_or(src_y_base, |beam_top| {
            src_y_base.min(beam_top - tuning::BEAM_TIP_CLEARANCE_SP * sp)
        })
    } else if src_stem_side {
        src.beam_bottom_y.map_or(src_y_base, |beam_bottom| {
            src_y_base.max(beam_bottom + tuning::BEAM_TIP_CLEARANCE_SP * sp)
        })
    } else {
        src_y_base
    };
    let tgt_y_base = tgt_eff_y
        + tgt_y_pos * sp * 0.5
        + curve_dir
            * if tgt_stem_side {
                (config.stem_length + tuning::STEM_EXTENSION_SP) * sp
            } else {
                tgt_offset
            };
    let tgt_y = if tgt_stem_side && curve_dir < 0.0 {
        tgt.beam_top_y.map_or(tgt_y_base, |beam_top| {
            tgt_y_base.min(beam_top - tuning::BEAM_TIP_CLEARANCE_SP * sp)
        })
    } else if tgt_stem_side {
        tgt.beam_bottom_y.map_or(tgt_y_base, |beam_bottom| {
            tgt_y_base.max(beam_bottom + tuning::BEAM_TIP_CLEARANCE_SP * sp)
        })
    } else {
        tgt_y_base
    };

    // ── Inner endpoint X ───────────────────────────────────────────────
    // The source (outgoing) half trails off toward the right margin (0.5sp
    // inset). The target (incoming) half, however, must *not* sweep in from
    // the system start across the clef/key signature — standard engraving
    // practice draws the continuation from an imaginary hanger before the
    // first event on the new system. A fixed reach alone can land directly on
    // an intervening tied continuation when the slur targets the next note,
    // making the slur appear to originate from that notehead.
    const CONTINUATION_REACH_SP: f64 = 3.0;
    let src_end_x = (src_piece.bounds.right_x - 0.5 * sp).max(src_x + 2.0 * sp);
    let first_target_event_x = all_events[tgt_piece.first_event_idx].x;
    let tgt_start_x = (tgt_x - CONTINUATION_REACH_SP * sp)
        .min(first_target_event_x - 0.5 * sp)
        .max(tgt_piece.bounds.left_x + 0.5 * sp);

    // ── Inner endpoint Y — extremal-column Y on that half's system ─────
    // For each half, find the rightmost / leftmost event on the half's own
    // (system, part, staff) and use ITS curve-side note Y as the inner
    // endpoint, blended toward the opposite endpoint's notehead Y. The inner endpoint
    // then sits above the *last* chord on the source system (for the source
    // half) and above the *first* chord on the target system (for the
    // target half), so each half arcs over the music rather than running
    // flat to the margin.
    //
    // Cap |inner_y - outer_y| to 2.5sp (standard engraving practice)
    // so a steep cross-page jump doesn't produce a wildly tilted half.
    const MAX_HALF_SLOPE: f64 = 2.5;
    const INNER_EDGE_OFFSET_SP: f64 = 0.5;
    let src_inner_y = {
        let extremal = &all_events[src_piece.last_event_idx];
        let y_pos = if curve_above {
            extremal.y_pos
        } else {
            extremal.y_pos_bottom
        };
        let raw = extremal.eff_staff_y
            + y_pos * sp * 0.5
            + curve_dir * notehead_side_offset
            + curve_dir * INNER_EDGE_OFFSET_SP * sp;
        let dy = raw - src_y;
        let cap = MAX_HALF_SLOPE * sp;
        src_y + dy.clamp(-cap, cap)
    };

    let tgt_inner_y = {
        let extremal = &all_events[tgt_piece.first_event_idx];
        let y_pos = if curve_above {
            extremal.y_pos
        } else {
            extremal.y_pos_bottom
        };
        let raw = extremal.eff_staff_y
            + y_pos * sp * 0.5
            + curve_dir * notehead_side_offset
            + curve_dir * INNER_EDGE_OFFSET_SP * sp;
        let dy = raw - tgt_y;
        let cap = MAX_HALF_SLOPE * sp;
        tgt_y + dy.clamp(-cap, cap)
    };

    let thickness = config.slur_thickness * sp;
    let endpoint_thickness = (config.slur_endpoint_thickness * sp).clamp(0.001, thickness);

    // ── Engrave-mode handle deltas on the outer endpoints ───────────────
    let shape = slur.shape.as_ref();
    let (mut src_x_e, mut src_y_e) = (src_x, src_y);
    let (mut tgt_x_e, mut tgt_y_e) = (tgt_x, tgt_y);
    if let Some(s) = shape {
        if let Some(p) = s.p0 {
            src_x_e += p[0] * sp;
            src_y_e += p[1] * sp;
        }
        if let Some(p) = s.p3 {
            tgt_x_e += p[0] * sp;
            tgt_y_e += p[1] * sp;
        }
    }

    let eid = element_id::slur(authored_source_id, &slur.target);

    // ── Stitched-horizon chunk seam: one continuous arc ─────────────────
    // The two "systems" are one continuous galley row, so a slur across a
    // chunk seam is a single arc from the source notehead to the target
    // notehead (NOT two trailing halves), shaped against the bounded global
    // event slice so retention seams use ordinary encompass semantics.
    if stitched_horizon {
        let mut stitched_y1 = src_y_e;
        let mut stitched_y2 = tgt_y_e;
        let mut obstacles = stitched_span_obstacles(all_events, src, tgt, sp, config);
        // The global event slice carries noteheads and stems but no ties, so
        // sweep the published tie bands across this span and give the endpoints
        // the same lane the in-system pass would have applied. Without this a
        // seam-spanning slur has no idea it encloses a tie.
        let (src_tips, tgt_tips) = collect_seam_span_tie_obstacles(
            dl,
            &mut obstacles,
            (src.eff_staff_y + tgt.eff_staff_y) * 0.5,
            src_x_e,
            tgt_x_e,
            sp,
        );
        if shape.is_none() {
            stitched_y1 = tie_endpoint_lane(stitched_y1, src_tips, curve_dir, 0, sp);
            stitched_y2 = tie_endpoint_lane(stitched_y2, tgt_tips, curve_dir, 0, sp);
        }
        let dx = tgt_x_e - src_x_e;
        let dy = stitched_y2 - stitched_y1;
        let chord_len = (dx * dx + dy * dy).sqrt().max(0.01);
        let default_shoulder = default_shoulder_for_chord(chord_len, sp, config);
        let cp_indent = default_cp_indent_for_chord(chord_len, sp, config);
        let (mut shoulder, mut apex_shift) = (default_shoulder, 0.0);
        if shape.is_none() {
            let collision = compute_shoulder_and_apex(
                src_x_e,
                tgt_x_e,
                stitched_y1,
                stitched_y2,
                chord_len,
                curve_above,
                curve_dir,
                sp,
                config,
                &obstacles,
                &src.event_id,
                &tgt.event_id,
                false,
                false,
            );
            shoulder = collision.needed_shoulder;
            apex_shift = collision.apex_shift_frac;
            stitched_y1 = collision.y1;
            stitched_y2 = collision.y2;
            let selected = select_slur_candidate(&SlurShapeInput {
                x1: src_x_e,
                y1: stitched_y1,
                x2: tgt_x_e,
                y2: stitched_y2,
                curve_dir,
                cp_indent,
                heuristic_shoulder: shoulder,
                heuristic_apex_shift: apex_shift,
                default_shoulder,
                shoulder_cap: config.slur_shoulder_max * sp,
                staff_y: (src.eff_staff_y + tgt.eff_staff_y) * 0.5,
                sp,
                obstacles: &obstacles,
                source_event_id: &src.event_id,
                target_event_id: &tgt.event_id,
                has_manual_shape: false,
            });
            shoulder = selected.candidate.shoulder;
            apex_shift = selected.candidate.apex_shift;
        }
        let (cmd, spine) = compute_slur_bezier(
            src_x_e,
            stitched_y1,
            tgt_x_e,
            stitched_y2,
            curve_dir,
            shoulder,
            cp_indent,
            apex_shift,
            thickness,
            endpoint_thickness,
            line_style,
            None,
        );
        publish_cross_system_segment(
            dl,
            cmd,
            eid,
            (src_x_e, stitched_y1),
            spine,
            (tgt_x_e, stitched_y2),
            thickness,
            curve_dir,
            sp,
            src.system_idx,
            src.staff_idx,
        );
        return;
    }

    // ── Source half: source notehead → near right edge of source system ─
    let source_handles = shape.as_ref().map(|shape| {
        (
            None,
            shape.p1.map(|point| (point[0] * sp, point[1] * sp)),
            None,
            None,
        )
    });
    let source_segment = shape_note_bound_segment(
        dl,
        src_piece,
        all_events,
        &src.event_id,
        &tgt.event_id,
        src_x_e,
        src_y_e,
        src_end_x,
        src_inner_y,
        curve_dir,
        line_style,
        thickness,
        endpoint_thickness,
        source_handles,
        true,
        false,
        sp,
        config,
    );
    publish_cross_system_segment(
        dl,
        source_segment.command,
        format!("{}/lh", eid),
        source_segment.p0,
        source_segment.spine,
        source_segment.p3,
        thickness,
        curve_dir,
        sp,
        src.system_idx,
        src.staff_idx,
    );

    emit_middle_segments(
        dl,
        &pieces,
        all_events,
        &eid,
        curve_dir,
        line_style,
        thickness,
        endpoint_thickness,
        sp,
        config,
    );

    // ── Target half: near left edge of target system → target notehead ──
    let target_handles = shape.as_ref().map(|shape| {
        (
            None,
            None,
            shape.p2.map(|point| (point[0] * sp, point[1] * sp)),
            None,
        )
    });
    let target_segment = shape_note_bound_segment(
        dl,
        tgt_piece,
        all_events,
        &src.event_id,
        &tgt.event_id,
        tgt_start_x,
        tgt_inner_y,
        tgt_x_e,
        tgt_y_e,
        curve_dir,
        line_style,
        thickness,
        endpoint_thickness,
        target_handles,
        false,
        true,
        sp,
        config,
    );
    publish_cross_system_segment(
        dl,
        target_segment.command,
        format!("{}/rh", eid),
        target_segment.p0,
        target_segment.spine,
        target_segment.p3,
        thickness,
        curve_dir,
        sp,
        tgt.system_idx,
        tgt.staff_idx,
    );
}

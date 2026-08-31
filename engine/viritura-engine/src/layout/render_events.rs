// Extracted from render_measure.rs — render_events

use super::arena::EventArena;
use super::beams::*;
use super::config::LayoutConfig;
use super::element_id;
use super::render_articulations::*;
use super::render_measure::MIDDLE_LINE_POS;
use super::skyline::{Skyline, SkylineDirection};
use super::types::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

#[path = "render_events/accidental_shapes.rs"]
mod accidental_shapes;
use accidental_shapes::{register_accidental_shape, tag_accidental, AccidentalPlacement};
#[path = "render_events/tie_accidentals.rs"]
mod tie_accidentals;
pub(crate) use tie_accidentals::{compute_tie_accidental_map, compute_tie_accidental_map_refs};

/// Compute the stem tip Y, ensuring stems on ledger-line notes extend at least
/// to the middle staff line (standard engraving rule).
fn stem_tip_y(note_edge_pos: f64, stem_up: bool, staff_y: f64, sp: f64, stem_length: f64) -> f64 {
    let middle_y = staff_y + MIDDLE_LINE_POS * sp * 0.5;
    if stem_up {
        let tip = staff_y + note_edge_pos * sp * 0.5 - stem_length * sp;
        tip.min(middle_y)
    } else {
        let tip = staff_y + note_edge_pos * sp * 0.5 + stem_length * sp;
        tip.max(middle_y)
    }
}

/// Pick the SMuFL stem-attachment anchors for the notehead the stem actually
/// touches: an up-stem attaches to the lowest notehead (max staff position), a
/// down-stem to the highest (min). For shaped drum noteheads (X, triangle,
/// diamond, slash) the per-shape anchor differs from the oval default — see
/// `smufl::stem_anchors`. `cp_at` returns the per-note glyph codepoint.
fn extreme_stem_anchor(
    note_positions: &[f64],
    stem_up: bool,
    cp_at: impl Fn(usize) -> u32,
) -> smufl::StemAnchors {
    let idx = note_positions
        .iter()
        .enumerate()
        .reduce(|acc, cur| {
            let take = if stem_up {
                cur.1 > acc.1
            } else {
                cur.1 < acc.1
            };
            if take {
                cur
            } else {
                acc
            }
        })
        .map(|(i, _)| i)
        .unwrap_or(0);
    smufl::stem_anchors(cp_at(idx))
}

/// Compute per-note dot Y offsets for augmentation dots.
///
/// When a note is on a staff line and has a second above or below, shift its
/// dot to avoid colliding with the adjacent note's dot space. Notes in spaces
/// keep their dots at the note position unless an adjacent line-note's dot
/// has displaced into the same slot.
///
/// standard engraving practice `layoutChords3` lines 2653-2707 and
/// `placeDots()` lines 2476-2564.
fn compute_dot_y_offsets(positions: &[f64], sp: f64) -> Vec<f64> {
    let n = positions.len();
    let mut offsets = vec![0.0_f64; n];
    let mut occupied_slots: Vec<i32> = Vec::new();
    for i in 0..n {
        let pos = positions[i];
        let pos_int = pos.round() as i32;
        let on_line = pos_int % 2 == 0;

        if on_line {
            let interval_above = if i > 0 {
                (pos - positions[i - 1]).round() as i32
            } else {
                1000
            };
            let interval_below = if i + 1 < n {
                (positions[i + 1] - pos).round() as i32
            } else {
                1000
            };

            let mut dot_dir: i32 = -1;
            if interval_above == 1 && interval_below != 1 {
                dot_dir = 1;
            }
            // Otherwise (interval_below == 1 && interval_above != 1, or both,
            // or neither) the default `-1` already gives the correct result.

            let target_slot = pos_int + dot_dir;
            if occupied_slots.contains(&target_slot) {
                dot_dir = -dot_dir;
            }

            occupied_slots.push(pos_int + dot_dir);
            offsets[i] = dot_dir as f64 * 0.5 * sp;
        } else {
            let target_slot = pos_int;
            if occupied_slots.contains(&target_slot) {
                offsets[i] = -0.5 * sp;
                occupied_slots.push(pos_int - 1);
            } else {
                occupied_slots.push(target_slot);
            }
        }
    }
    offsets
}

/// Draw ledger lines above/below the staff for a note at staff-position `pos`
/// (half-spaces from the top staff line).
#[allow(clippy::too_many_arguments)]
fn draw_ledger_lines_for_note(
    dl: &mut DisplayList,
    pos: f64,
    note_x: f64,
    staff_y: f64,
    sp: f64,
    ledger_w: f64,
    ledger_left_ext: f64,
    ledger_right_ext: f64,
    ledger_line_width: f64,
) {
    // Ledger lines above staff
    if pos < 0.0 {
        let mut ledger = -2.0;
        while ledger >= pos {
            let ly = staff_y + ledger * sp * 0.5;
            dl.ledger_line(
                note_x - ledger_left_ext * sp,
                ly,
                ledger_w + (ledger_left_ext + ledger_right_ext) * sp,
                ledger_line_width * sp,
            );
            ledger -= 2.0;
        }
    }

    // Ledger lines below staff
    if pos > 8.0 {
        let mut ledger = 10.0;
        while ledger <= pos {
            let ly = staff_y + ledger * sp * 0.5;
            dl.ledger_line(
                note_x - ledger_left_ext * sp,
                ly,
                ledger_w + (ledger_left_ext + ledger_right_ext) * sp,
                ledger_line_width * sp,
            );
            ledger += 2.0;
        }
    }
}

/// Decide whether this note needs an accidental glyph and, if so, return the
/// `(pos, note_y, alter, codepoint, enclosure)` tuple ready for stacked
/// rendering. Updates `measure_acc` with this note's alter so later notes in
/// the same measure compare against the running accidental state.
///
/// `measure_acc` maps `(step, octave)` to the alteration currently in effect
/// for that staff position within the measure. It is seeded lazily from the
/// key signature: a position absent from the map implies the key's alteration.
/// A glyph is drawn whenever a note's alteration differs from the value in
/// effect — which naturally handles key-implied accidentals, intra-measure
/// propagation (no repeat), and cancellation (e.g. a natural after an earlier
/// sharp, or a sharp after an earlier flat in the same bar), following standard
/// engraving practice.
///
/// Kit-notes are skipped (percussion noteheads never carry accidentals).
/// Uses the display pitch (written pitch under transposition) so accidentals
/// are relative to the display key signature, not the concert key.
fn collect_one_note_accidental_info(
    note: &Note,
    note_index: usize,
    pos: f64,
    note_y: f64,
    display_pitch_override: Option<&Pitch>,
    active_key: &KeySignature,
    use_accidental_display: bool,
    measure_acc: &mut HashMap<(String, i32), i32>,
    tie_accidentals: Option<&HashMap<String, bool>>,
) -> Option<AccidentalPlacement> {
    let placement =
        |alter: i32, codepoint: u32, enclosure: Option<AccidentalEnclosure>| AccidentalPlacement {
            note_index,
            pos,
            note_y,
            alter,
            codepoint,
            enclosure,
        };
    if note.kit_component.is_some() {
        return None;
    }
    let display_pitch = display_pitch_override.unwrap_or(&note.pitch);
    let display_alter = display_pitch.alter.unwrap_or(0);
    let display_step = &display_pitch.step;

    let ad = note.accidental_display.as_ref();
    let explicitly_shown = ad.is_some_and(|a| a.show);
    let explicitly_hidden = ad.is_some_and(|a| !a.show);
    let forced = ad.is_some_and(|a| a.force.unwrap_or(false));
    let enclosure = ad.and_then(|a| a.enclosure.as_ref());

    // When the note carries an explicit accidental-display directive we honor
    // it verbatim and only draw when `show` is set. The running measure state
    // is still updated so subsequent auto-mode notes compare correctly.
    if use_accidental_display {
        if explicitly_shown {
            if let Some(cp) = smufl::accidental_glyph(display_alter) {
                return Some(placement(display_alter, cp, enclosure.cloned()));
            }
        }
        return None;
    }

    let key_alter = active_key.alteration_for_step(display_step);
    let pos_key = (display_step.clone(), display_pitch.octave);
    let in_effect = measure_acc.get(&pos_key).copied().unwrap_or(key_alter);
    let differs = display_alter != in_effect;
    let tie_continuation = if ad.is_none() {
        note.id
            .as_deref()
            .and_then(|id| tie_accidentals.and_then(|map| map.get(id)).copied())
    } else {
        None
    };

    // This note's sounding alteration is now the value in effect for the rest
    // of the measure at this staff position, regardless of whether a glyph is
    // drawn (e.g. an explicitly-hidden accidental still propagates its pitch).
    // A tied continuation is the exception: it belongs to the previous note's
    // duration and must not establish accidental state in the new measure.
    if tie_continuation.is_none() {
        measure_acc.insert(pos_key, display_alter);
    }

    // Tie continuation across a barline. Standard engraving practice: an
    // accidental is not repeated on the continuation of a note tied over a
    // barline. When the tie wraps onto a new system the continuation instead
    // shows a parenthesized courtesy accidental as a reminder of the pitch.
    // Only applies to genuinely altered notes (relative to the key) and only
    // when the note carries no explicit accidental-display directive.
    if ad.is_none() && display_alter != key_alter {
        if let Some(courtesy) = tie_continuation {
            if courtesy {
                return smufl::accidental_glyph(display_alter).map(|cp| {
                    placement(
                        display_alter,
                        cp,
                        Some(AccidentalEnclosure {
                            symbol: AccidentalEnclosureSymbol::Parentheses,
                        }),
                    )
                });
            }
            return None;
        }
    }

    if !explicitly_hidden && (explicitly_shown || forced || differs) {
        if let Some(cp) = smufl::accidental_glyph(display_alter) {
            return Some(placement(display_alter, cp, enclosure.cloned()));
        }
    }
    None
}

/// Render the chord's accidentals using a vertical skyline for kerning.
///
/// Tracks each placed accidental's left boundary in a skyline indexed by
/// staff position (half-spaces), allowing vertically distant accidentals to
/// share a column. Honors per-glyph NE/SE/NW/SW cut-outs for interlocking
/// (Bravura). Seeds barriers for left-displaced noteheads (seconds) so
/// accidentals overlapping vertically must clear them.
///
/// Compute the outside-in, alternating top/bottom placement order for a chord's
/// accidentals. Indices are sorted by staff position (top = smallest `pos`)
/// then picked alternately from the top and bottom of the remaining range, so
/// the greedy leftward packer reuses columns instead of fanning the cluster
/// into a diagonal staircase.
fn alternating_outside_in_order(acc_infos: &[AccidentalPlacement]) -> Vec<usize> {
    let mut sorted: Vec<usize> = (0..acc_infos.len()).collect();
    sorted.sort_by(|&a, &b| {
        acc_infos[a]
            .pos
            .partial_cmp(&acc_infos[b].pos)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut order = Vec::with_capacity(sorted.len());
    let mut lo: isize = 0;
    let mut hi: isize = sorted.len() as isize - 1;
    let mut pick_top = true;
    while lo <= hi {
        if pick_top {
            order.push(sorted[lo as usize]);
            lo += 1;
        } else {
            order.push(sorted[hi as usize]);
            hi -= 1;
        }
        pick_top = !pick_top;
    }
    order
}

/// Shift one accidental column left until it clears every OTHER event's
/// glyph on the same staff that it overlaps.
///
/// Accidental columns are placed per event from that event's own geometry, so
/// an accidental can land on a glyph belonging to a DIFFERENT event on the
/// same staff. Two kinds of obstacle matter:
///
/// - **Noteheads** — another voice (dense two-voice piano writing) or a close
///   neighbour in the same voice (fast chromatic run).
/// - **Accidentals** — two chords at the SAME onset on one staff (e.g. an
///   upper and lower voice) each lay out their accidentals against their own
///   noteheads, so the two stacks land in the same column and collide
///   vertically. The later-rendered event clears the earlier one's already
///   placed accidentals, fanning the combined stack out to the left.
///
/// We react only to ACTUAL overlap of the column's current rect with an
/// obstacle, then move the column left to clear it; an obstacle that does not
/// intrude has no effect, which avoids over-pushing. Each step strictly
/// decreases the right edge, so the loop is bounded by the obstacle count.
///
/// `group_x` is the column's current left edge, `barrier` its current right
/// edge. `band` is the accidental's `(top, bottom)` vertical footprint in px.
/// `noteheads` are `(center_y, x_left, x_right)` (±0.5sp band); `accidentals`
/// are `(top, bottom, x_left, x_right)` rects. All in absolute pixels. Returns
/// the new left edge.
#[allow(clippy::too_many_arguments)]
fn clear_sibling_obstacles(
    mut group_x: f64,
    barrier: f64,
    total_width: f64,
    band: (f64, f64),
    acc_note_gap: f64,
    sp: f64,
    noteheads: &[(f64, f64, f64)],
    accidentals: &[(f64, f64, f64, f64)],
) -> f64 {
    let (v_top_px, v_bottom_px) = band;
    let mut acc_right = barrier;
    let mut guard = 0;
    let total = noteheads.len() + accidentals.len();
    loop {
        let mut min_block: Option<f64> = None;
        let mut consider = |top: f64, bottom: f64, sleft: f64, sright: f64| {
            // Vertical overlap with the accidental's footprint.
            if bottom <= v_top_px || top >= v_bottom_px {
                return;
            }
            // Horizontal overlap with the accidental's current rect.
            if sright > group_x + 0.01 && sleft < acc_right - 0.01 {
                let cand = sleft - acc_note_gap;
                min_block = Some(min_block.map_or(cand, |b: f64| b.min(cand)));
            }
        };
        for &(scy, sleft, sright) in noteheads {
            consider(scy - 0.5 * sp, scy + 0.5 * sp, sleft, sright);
        }
        for &(top, bottom, sleft, sright) in accidentals {
            consider(top, bottom, sleft, sright);
        }
        match min_block {
            Some(b) if b < acc_right - 0.01 => {
                acc_right = b;
                group_x = b - total_width;
            }
            _ => break,
        }
        guard += 1;
        if guard > total + 1 {
            break;
        }
    }
    group_x
}

/// Render the chord's accidentals using a vertical skyline for kerning.
///
/// Tracks each placed accidental's left boundary in a skyline indexed by
/// staff position (half-spaces), allowing vertically distant accidentals to
/// share a column. Honors per-glyph NE/SE/NW/SW cut-outs for interlocking
/// (Bravura). Seeds barriers for left-displaced noteheads (seconds) so
/// accidentals overlapping vertically must clear them.
///
/// Standard engraving practice: include chord shapes in the obstacle field and
/// preserve vertical clearance between accidentals and nearby chord ink.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)] // one stateful accidental-skyline placement pass
fn render_accidentals_stacked(
    dl: &mut DisplayList,
    events: &EventArena,
    ei: usize,
    x: f64,
    sp: f64,
    notehead_w: f64,
    ledger_left_ext: f64,
    glyph_size: f64,
    acc_infos: &[AccidentalPlacement],
    // Element id of the event owning these accidentals; each accidental is
    // tagged as a sibling of the event's noteheads so it selects on its own.
    event_element_id: &str,
    // Noteheads of OTHER events on the same staff (any voice), as absolute-pixel
    // rects `(center_y, x_left, x_right)`. Used to keep this event's accidental
    // column from landing on another event's notehead. Empty when none nearby.
    sibling_noteheads: &[(f64, f64, f64)],
    // Already-placed accidentals of OTHER events on the same staff (any voice),
    // as absolute-pixel rects `(top, bottom, x_left, x_right)`. Used to keep
    // this event's accidental column from colliding with another event's
    // accidental stack at the same onset (simultaneous chords). Empty when none
    // nearby.
    sibling_accidentals: &[(f64, f64, f64, f64)],
) {
    let note_positions = events.note_positions(ei);
    let note_x_offsets = events.note_x_offsets(ei);
    // Minimum clear gap between an accidental and the notehead it qualifies.
    // This is the hard floor the barrier skyline enforces, so it must match the
    // spacing reservation in `accidental_padding_sp`. A tight 0.12sp reads as a
    // collision at typical zoom; standard engraving practice leaves a clear
    // quarter-space-ish gap so the accidental never touches the notehead.
    let acc_note_gap = 0.20 * sp;
    let acc_stack_gap = 0.10 * sp;
    // Sharps and naturals are thin and may tuck slightly INTO a ledger line;
    // 0.10sp preserves optical separation without wasting a full column.
    // Flats and double-flats keep the full notehead gap.
    let acc_ledger_kern = 0.10 * sp;

    let initial_barrier = x - acc_note_gap;
    let mut barrier_skyline = Skyline::new(SkylineDirection::Down);
    barrier_skyline.add_building(-50.0, 50.0, initial_barrier);

    // Seed barriers for displaced noteheads (seconds).
    for (i, &pos) in note_positions.iter().enumerate() {
        let offset = note_x_offsets.get(i).copied().unwrap_or(0.0);
        if offset < 0.0 {
            let note_left_x = x + offset * notehead_w;
            let nh_barrier = note_left_x - acc_note_gap;
            barrier_skyline.add_building(pos - 1.3, pos + 1.3, nh_barrier);
        }
    }

    // Seed barriers for ledger lines. Ledger lines extend a notehead width
    // plus `ledger_left_ext` to the LEFT of the note, well past the notehead's
    // own left edge, so an accidental at a ledger's vertical position collides
    // with the ledger long before it would touch the notehead. Without these
    // barriers the column ignores ledgers entirely and overlaps them (the root
    // cause of the dense-chord collisions). Standard engraving practice treats
    // ledger lines as chord obstacles when kerning accidentals. The ledger
    // positions match
    // `draw_ledger_lines_for_note`: even half-spaces beyond the staff
    // (-2, -4, … above for notes above the staff; 10, 12, … below). The barrier
    // is given a small vertical band (±0.5 half-space) so only accidentals that
    // actually overlap the thin ledger line are pushed.
    //
    // Each entry is the ledger's left edge x and staff position (half-spaces),
    // reused below to grant sharps/naturals the ledger kern-in relief.
    let mut ledger_positions: Vec<(f64, f64)> = Vec::new();
    for (i, &pos) in note_positions.iter().enumerate() {
        let offset = note_x_offsets.get(i).copied().unwrap_or(0.0);
        let note_left_x = x + offset * notehead_w;
        let ledger_left = note_left_x - ledger_left_ext * sp;
        if pos < 0.0 {
            let mut ledger = -2.0;
            while ledger >= pos {
                ledger_positions.push((ledger_left, ledger));
                ledger -= 2.0;
            }
        }
        if pos > 8.0 {
            let mut ledger = 10.0;
            while ledger <= pos {
                ledger_positions.push((ledger_left, ledger));
                ledger += 2.0;
            }
        }
    }
    for &(ledger_left, ledger_pos) in &ledger_positions {
        // Conservative (full-gap) barrier; sharps/naturals reclaim the kern at
        // query time via the ledger kern-in relief below.
        barrier_skyline.add_building(
            ledger_pos - 0.5,
            ledger_pos + 0.5,
            ledger_left - acc_note_gap,
        );
    }

    // Place accidentals from the outside in, alternating top/bottom of the
    // cluster. The greedy leftward packing below assigns each accidental to the
    // nearest free column at its vertical range. Processing in a monotonic
    // top-to-bottom order makes every accidental stack just left of its
    // immediate predecessor — even when a free column exists further out —
    // so the cluster fans out into a diagonal staircase. Visiting the outermost
    // accidentals first lets an inner one tuck back into the same column as a
    // non-overlapping outer accidental, keeping the column count minimal.
    let order = alternating_outside_in_order(acc_infos);
    let mut placed_accidentals: Vec<(f64, f64, f64, f64)> = Vec::with_capacity(acc_infos.len());

    for &idx in &order {
        let info = &acc_infos[idx];
        let (pos, note_y, alter, codepoint) = (info.pos, info.note_y, info.alter, info.codepoint);
        let enclosure = &info.enclosure;
        let acc_width = smufl::accidental_width(alter) * sp;
        let (above, below) = smufl::accidental_vertical_extent(alter);
        let v_top = pos - above;
        let v_bottom = pos + below;

        // Total width including enclosure glyphs (parens / brackets).
        let enc_gap = 0.06 * sp;
        let (total_width, left_enc, right_enc) = if let Some(enc) = enclosure {
            let is_parens = matches!(enc.symbol, AccidentalEnclosureSymbol::Parentheses);
            let enc_w = smufl::accidental_enclosure_width(is_parens) * sp;
            let left_cp = if is_parens {
                smufl::ACCIDENTAL_PARENS_LEFT
            } else {
                smufl::ACCIDENTAL_BRACKET_LEFT
            };
            let right_cp = if is_parens {
                smufl::ACCIDENTAL_PARENS_RIGHT
            } else {
                smufl::ACCIDENTAL_BRACKET_RIGHT
            };
            (
                enc_w + enc_gap + acc_width + enc_gap + enc_w,
                Some((left_cp, enc_w)),
                Some((right_cp, enc_w)),
            )
        } else {
            (acc_width, None, None)
        };

        // Query barrier with NE/SE cut-out aware interlocking.
        let cut_outs = smufl::accidental_cut_outs(alter);
        let incoming_ne_h = cut_outs.ne.map_or(0.0, |(_, h)| h * 2.0);
        let incoming_se_h = cut_outs.se.map_or(0.0, |(_, h)| h * 2.0);

        let core_top = v_top + incoming_ne_h;
        let core_bottom = v_bottom - incoming_se_h;
        let barrier = if core_top < core_bottom {
            let body_barrier = barrier_skyline
                .min_height_in_range(core_top, core_bottom)
                .unwrap_or(initial_barrier);
            let ne_width_savings = cut_outs.ne.map_or(0.0, |(w, _)| w) * sp;
            let se_width_savings = cut_outs.se.map_or(0.0, |(w, _)| w) * sp;
            let ne_barrier = if incoming_ne_h > 0.0 {
                barrier_skyline
                    .min_height_in_range(v_top, core_top)
                    .map(|b| b + ne_width_savings)
                    .unwrap_or(initial_barrier)
            } else {
                f64::INFINITY
            };
            let se_barrier = if incoming_se_h > 0.0 {
                barrier_skyline
                    .min_height_in_range(core_bottom, v_bottom)
                    .map(|b| b + se_width_savings)
                    .unwrap_or(initial_barrier)
            } else {
                f64::INFINITY
            };
            body_barrier.min(ne_barrier).min(se_barrier)
        } else {
            barrier_skyline
                .min_height_in_range(v_top, v_bottom)
                .unwrap_or(initial_barrier)
        };

        // Ledger kern-in relief: a thin sharp or natural may tuck slightly into
        // a ledger line it overlaps (standard engraving practice). If the
        // binding barrier for this accidental sits at a ledger's left edge (the
        // ledger is the most-restrictive obstacle in range) and the glyph is a
        // sharp or natural, move it right by `acc_ledger_kern` — but never past
        // the notehead obstacle, which is enforced because the relief is capped
        // at the ledger barrier plus the kern (a ledger always extends further
        // left than its own notehead, so the kern can't cross the notehead).
        let is_sharp_or_natural = alter == 0 || alter == 1;
        let barrier = if is_sharp_or_natural {
            let binds_on_ledger = ledger_positions.iter().any(|&(ledger_left, ledger_pos)| {
                ledger_pos > v_top - 0.5
                    && ledger_pos < v_bottom + 0.5
                    && (barrier - (ledger_left - acc_note_gap)).abs() < 0.01 * sp
            });
            if binds_on_ledger {
                barrier + acc_ledger_kern
            } else {
                barrier
            }
        } else {
            barrier
        };

        let mut group_x = barrier - total_width;

        // SMuFL corner cut-outs permit optical interlocking, but mixed glyphs
        // (especially sharp/natural stacks) can fuse into one unreadable mark.
        // Preserve column reuse for vertically separate symbols while keeping
        // a visible horizontal gap whenever their bounding boxes overlap.
        for &(placed_pos, placed_top, placed_bottom, placed_left) in &placed_accidentals {
            if (pos - placed_pos).abs() < 2.0 && v_top < placed_bottom && placed_top < v_bottom {
                group_x = group_x.min(placed_left - acc_stack_gap - total_width);
            }
        }

        // Cross-event clearance: shift the column left so it clears any OTHER
        // event's notehead OR already-placed accidental on this staff that it
        // overlaps (see `clear_sibling_obstacles`).
        if !sibling_noteheads.is_empty() || !sibling_accidentals.is_empty() {
            let v_top_px = note_y - above * 0.5 * sp;
            let v_bottom_px = note_y + below * 0.5 * sp;
            group_x = clear_sibling_obstacles(
                group_x,
                barrier,
                total_width,
                (v_top_px, v_bottom_px),
                acc_note_gap,
                sp,
                sibling_noteheads,
                sibling_accidentals,
            );
        }

        // Update skyline with NW/SW cut-out-aware segments so the next
        // accidental can tuck closer.
        let base_barrier = group_x - acc_stack_gap;
        let nw_h = cut_outs.nw.map_or(0.0, |(_, h)| h * 2.0);
        let sw_h = cut_outs.sw.map_or(0.0, |(_, h)| h * 2.0);
        let nw_w = cut_outs.nw.map_or(0.0, |(w, _)| w) * sp;
        let sw_w = cut_outs.sw.map_or(0.0, |(w, _)| w) * sp;

        if nw_h > 0.0 && v_top + nw_h < v_bottom {
            barrier_skyline.add_building(v_top, v_top + nw_h, base_barrier + nw_w);
            barrier_skyline.add_building(v_top + nw_h, v_bottom - sw_h.max(0.0), base_barrier);
        } else {
            barrier_skyline.add_building(v_top, v_bottom - sw_h.max(0.0), base_barrier);
        }
        if sw_h > 0.0 && v_bottom - sw_h > v_top {
            barrier_skyline.add_building(v_bottom - sw_h, v_bottom, base_barrier + sw_w);
        }

        let mut cursor_x = group_x;
        let mut acc_cmds: Vec<usize> = Vec::with_capacity(3);

        if let Some((left_cp, enc_w)) = left_enc {
            let cmd_idx = dl.commands.len();
            dl.push(RenderCommand::DrawGlyph {
                x: cursor_x,
                y: note_y,
                codepoint: left_cp,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            });
            register_accidental_shape(dl, cmd_idx, events.id(ei), idx, "left");
            acc_cmds.push(cmd_idx);
            cursor_x += enc_w + enc_gap;
        }

        let acc_cmd_idx = dl.commands.len();
        dl.push(RenderCommand::DrawGlyph {
            x: cursor_x,
            y: note_y,
            codepoint,
            font: "Bravura".into(),
            size: glyph_size,
            color: "#000000".into(),
            rotation: 0.0,
        });
        register_accidental_shape(dl, acc_cmd_idx, events.id(ei), idx, "body");
        acc_cmds.push(acc_cmd_idx);
        cursor_x += acc_width;

        if let Some((right_cp, _enc_w)) = right_enc {
            cursor_x += enc_gap;
            let cmd_idx = dl.commands.len();
            dl.push(RenderCommand::DrawGlyph {
                x: cursor_x,
                y: note_y,
                codepoint: right_cp,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            });
            register_accidental_shape(dl, cmd_idx, events.id(ei), idx, "right");
            acc_cmds.push(cmd_idx);
        }

        tag_accidental(dl, &acc_cmds, event_element_id, info.note_index);
        placed_accidentals.push((pos, v_top, v_bottom, group_x));
    }
}

pub(crate) fn render_event(
    dl: &mut DisplayList,
    events: &EventArena,
    ei: usize,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    beamed_ids: &HashSet<String>,
    active_key: &KeySignature,
    measure_acc: &mut HashMap<(String, i32), i32>,
    use_accidental_display: bool,
    element_id: &str,
    ledger_left_ext: f64,
    ledger_right_ext: f64,
    kit: Option<&std::collections::HashMap<String, KitComponent>>,
    slur_map: Option<&super::slurs::SlurParticipationMap>,
    tie_accidentals: Option<&HashMap<String, bool>>,
    voice_index: usize,
    // Noteheads of OTHER events on the same visual staff that this event's
    // accidental column must clear: `(center_y, x_left, x_right)` in absolute
    // pixels. Empty when none are near.
    sibling_noteheads: &[(f64, f64, f64)],
    // Already-placed accidentals of OTHER events on the same visual staff that
    // this event's accidental column must clear: `(top, bottom, x_left,
    // x_right)` in absolute pixels. Empty when none are near.
    sibling_accidentals: &[(f64, f64, f64, f64)],
    measure_beats: f64,
) {
    // Lever 2: read this event's columns directly from the arena (no
    // `to_event_layout` deep clone of the model `Event` + per-note Vecs).
    let event = events.event(ei);
    let x = events.x(ei);
    let stem_up = events.stem_up(ei);
    let note_positions = events.note_positions(ei);
    let note_x_offsets = events.note_x_offsets(ei);
    let shared_noteheads = events.shared_noteheads(ei);
    let display_pitches = events.display_pitches(ei);

    if event.is_rest() {
        // Skip shared rests — the other voice renders this rest
        if events.shared_rest(ei) {
            return;
        }
        let staff_pos = event.rest.as_ref().and_then(|r| r.staff_position);
        let centered = events.is_centered_bar_rest(ei, measure_beats);
        render_rest(dl, x, staff_y, sp, &event.duration, staff_pos, centered);
        return;
    }

    let notes = event.notes();
    if notes.is_empty() {
        return;
    }

    let notehead_w = config.notehead_rx * 2.0 * sp;
    let _notehead_h = config.notehead_ry * sp;
    let _is_whole = !event.duration.base.has_stem();
    let notehead_codepoint = smufl::notehead_glyph(&event.duration.base);
    let glyph_size = 4.0 * sp; // SMuFL fonts are designed at 4x staff space

    // Accidental info collected during note loop for post-loop stacking
    let mut acc_infos: Vec<AccidentalPlacement> = Vec::new();

    // Per-note notehead codepoint: kit-notes may override the shape via their
    // KitComponent.notehead (Viritura vendor extension). Used both when drawing
    // the noteheads and when picking the per-shape stem-attachment anchor.
    let per_note_cp = |i: usize| -> u32 {
        if let Some(note) = notes.get(i) {
            if let Some(kc_id) = &note.kit_component {
                let shape = kit
                    .and_then(|k| k.get(kc_id.as_str()))
                    .and_then(|c| c.notehead.as_ref());
                return smufl::percussion_notehead_glyph(shape, &event.duration.base);
            }
        }
        notehead_codepoint
    };

    // Compute the rightmost notehead edge for dot X alignment.
    // Ref: standard engraving practice layoutChords3() — all dots in a chord
    // align to a single X column (the rightmost notehead's right edge).
    let dot_align_x = {
        let mut max_right = f64::NEG_INFINITY;
        for (i, &_pos) in note_positions.iter().enumerate() {
            let offset = note_x_offsets.get(i).copied().unwrap_or(0.0) * notehead_w;
            let right = x + offset + smufl::notehead_right_extent(per_note_cp(i)) * sp;
            if right > max_right {
                max_right = right;
            }
        }
        max_right.max(x + smufl::notehead_right_extent(notehead_codepoint) * sp)
    };

    // Pre-compute dot Y adjustments for seconds.
    let dot_y_offsets = compute_dot_y_offsets(note_positions, sp);

    // Draw noteheads + ledger lines
    // Use the actual glyph width for ledger line centering — whole notes are
    // wider than quarter/half noteheads (1.66sp vs 1.18sp).
    let ledger_w = smufl::notehead_width(notehead_codepoint) * sp;

    for (i, &pos) in note_positions.iter().enumerate() {
        // Skip shared noteheads — the other voice renders this notehead
        if shared_noteheads.get(i).copied().unwrap_or(false) {
            continue;
        }

        // Per-note notehead codepoint: kit-notes may override the shape via
        // their KitComponent.notehead (Viritura vendor extension).
        let per_note_codepoint = per_note_cp(i);

        let note_y = staff_y + pos * sp * 0.5;
        let note_x_offset = note_x_offsets.get(i).copied().unwrap_or(0.0) * notehead_w;
        let note_x = x + note_x_offset;

        // Ledger lines above/below the staff for this note.
        draw_ledger_lines_for_note(
            dl,
            pos,
            note_x,
            staff_y,
            sp,
            ledger_w,
            ledger_left_ext,
            ledger_right_ext,
            config.ledger_line_width,
        );

        // Notehead (SMuFL glyph) — tagged with per-note sub-element ID
        // Apply noteheadOrigin offset for breve/double-whole so its body
        // aligns with the rhythmic column (Bravura noteheadOrigin = 0.36sp).
        let nh_x = if per_note_codepoint == smufl::NOTEHEAD_DOUBLE_WHOLE {
            note_x - smufl::NOTEHEAD_DOUBLE_WHOLE_ORIGIN.0 * sp
        } else {
            note_x
        };
        let notehead_cmd_idx = dl.commands.len();
        dl.push(RenderCommand::DrawGlyph {
            x: nh_x,
            y: note_y,
            codepoint: per_note_codepoint,
            font: "Bravura".into(),
            size: glyph_size,
            color: "#000000".into(),
            rotation: 0.0,
        });
        // Tag this notehead with a per-note sub-element ID for chord note selection
        let nh_eid = element_id::source_notehead(element_id, notes.get(i), i);
        dl.tag_command(notehead_cmd_idx, nh_eid.clone());
        // Register as a Cmd shape (zero geometry duplication; bbox derived
        // from SMuFL metrics via DrawGlyph::bbox()).
        dl.push_shape_cmd(notehead_cmd_idx, nh_eid, ElementKind::Notehead, None, None);

        // Augmentation dots (SMuFL glyph)
        // Ref: standard engraving practice — dots align to rightmost notehead X,
        // Y adjusted to avoid staff lines and second collisions.
        if let Some(dots) = event.duration.dots {
            for d in 0..dots {
                let dot_x = dot_align_x + (0.4 + d as f64 * 0.5) * sp;
                let dot_y = note_y
                    + dot_y_offsets.get(i).copied().unwrap_or_else(|| {
                        // Fallback: simple staff-line nudge
                        if (pos as i32) % 2 == 0 {
                            -0.25 * sp
                        } else {
                            0.0
                        }
                    });
                let dot_idx = dl.commands.len();
                dl.push(RenderCommand::DrawGlyph {
                    x: dot_x,
                    y: dot_y,
                    codepoint: smufl::AUGMENTATION_DOT,
                    font: "Bravura".into(),
                    size: glyph_size,
                    color: "#000000".into(),
                    rotation: 0.0,
                });
                dl.push_shape_cmd(
                    dot_idx,
                    format!("{element_id}/dot/{i}/{d}"),
                    ElementKind::AugmentationDot,
                    None,
                    None,
                );
            }
        }

        // Collect accidental info for post-loop stacking.
        if let Some(info) = collect_one_note_accidental_info(
            &notes[i],
            i,
            pos,
            note_y,
            display_pitches.get(i),
            active_key,
            use_accidental_display,
            measure_acc,
            tie_accidentals,
        ) {
            acc_infos.push(info);
        }
    }

    // Render accidentals with skyline-based placement for better kerning.
    render_accidentals_stacked(
        dl,
        events,
        ei,
        x,
        sp,
        notehead_w,
        ledger_left_ext,
        glyph_size,
        &acc_infos,
        element_id,
        sibling_noteheads,
        sibling_accidentals,
    );

    // Stem
    if event.duration.base.has_stem() && !note_positions.is_empty() {
        let top_pos = note_positions.iter().cloned().fold(f64::INFINITY, f64::min);
        let bottom_pos = note_positions
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);

        // Check if this event is beamed (suppress flags AND stems — beams redraw stems)
        let is_beamed = events.id(ei).is_some_and(|id| beamed_ids.contains(id));

        // Beamed notes: stems are drawn by render_beams with correct beam-connected length.
        // Only draw stems here for non-beamed notes.
        if !is_beamed {
            let stem_w = config.stem_width * sp;
            // Lengthen stem for flagged notes so the flag's curl tip clears the
            // notehead body. Bravura's flag glyphs extend ~3.24sp back toward the
            // notehead from the stem tip; with the default 3.5sp stem the flag
            // overlaps the notehead. Engraving rule:
            // flagged stems are lengthened to keep the flag clear.
            // Required: stem_length >= flag_inward_extent + notehead_ry + clearance.
            let flag_count = event.duration.base.flag_count();
            let stem_length = if flag_count > 0 {
                let needed =
                    smufl::flag_inward_extent(flag_count, stem_up) + config.notehead_ry + 0.25; // clearance margin
                config.stem_length.max(needed)
            } else {
                config.stem_length
            };
            // Per-shape stem anchors: the notehead the stem attaches to drives
            // the attachment point. For shaped drum noteheads (X, triangle,
            // diamond, slash) this differs from the oval default.
            let a = extreme_stem_anchor(note_positions, stem_up, per_note_cp);
            if stem_up {
                // SMuFL stemUpSE anchor: right edge of stem at notehead's stemUpSE.x
                let stem_x = x + a.up_se.0 * sp - stem_w * 0.5;
                let stem_bottom = staff_y + bottom_pos * sp * 0.5 + a.up_se.1 * sp;
                let flag_y = stem_tip_y(top_pos, true, staff_y, sp, stem_length);
                // Extend stem through flag glyph (Bravura stemUpNW anchor)
                let ext = smufl::flag_stem_extension(flag_count, true) * sp;
                let stem_top = flag_y - ext;
                dl.stem(stem_x, stem_top, stem_bottom, config.stem_width * sp);
                render_flags(dl, stem_x, flag_y, sp, &event.duration.base, true);
            } else {
                // SMuFL stemDownNW anchor: left edge of stem at notehead's stemDownNW.x
                let stem_x = x + a.down_nw.0 * sp + stem_w * 0.5;
                let stem_top = staff_y + top_pos * sp * 0.5 + a.down_nw.1 * sp;
                let flag_y = stem_tip_y(bottom_pos, false, staff_y, sp, stem_length);
                // Extend stem through flag glyph (Bravura stemDownSW anchor)
                let ext = smufl::flag_stem_extension(flag_count, false) * sp;
                let stem_bottom = flag_y + ext;
                dl.stem(stem_x, stem_top, stem_bottom, config.stem_width * sp);
                render_flags(dl, stem_x, flag_y, sp, &event.duration.base, false);
            }
        }
    }

    // Articulation markings (staccato, accent, tenuto, marcato)
    render_articulations(
        dl,
        events,
        ei,
        staff_y,
        sp,
        config,
        element_id,
        slur_map,
        voice_index,
    );

    // Tremolo slashes on the stem
    render_tremolo(dl, events, ei, staff_y, sp, config, element_id);
}

pub(crate) fn render_flags(
    dl: &mut DisplayList,
    x: f64,
    y: f64,
    sp: f64,
    duration: &NoteValueBase,
    stem_up: bool,
) {
    let flag_count = duration.flag_count();
    if flag_count == 0 {
        return;
    }

    // Use SMuFL flag glyph — one glyph per flag count (not stacked)
    if let Some(flag_codepoint) = smufl::flag_glyph(flag_count, stem_up) {
        dl.push(RenderCommand::DrawGlyph {
            x,
            y,
            codepoint: flag_codepoint,
            font: "Bravura".into(),
            size: 4.0 * sp,
            color: "#000000".into(),
            rotation: 0.0,
        });
    }
}

/// Articulation category for the 3-pass layout algorithm.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum ArticCategory {
    /// Close-to-note: staccato, tenuto, accent (Pass 1).
    CloseToNote,
    /// Staff-anchored: marcato / strong accent and out-of-slur staccatissimo (Pass 2).
    StaffAnchored,
}

/// A pending articulation glyph with metadata for multi-pass placement.
pub(super) struct ArticGlyph {
    pub(super) above: u32,
    pub(super) below: u32,
    pub(super) category: ArticCategory,
    /// Marking field(s) this glyph draws, in MNX `markings` spelling. Combos
    /// name both constituents joined by `.` because the ligature is a single
    /// glyph standing for both. Used to name the element id, so a click can be
    /// resolved back to the marking(s) without replaying placement.
    pub(super) name: &'static str,
    /// True when this is a staccato glyph (for staccato+accent kerning).
    pub(super) is_staccato: bool,
    /// True when this is an accent glyph (for staccato+accent kerning).
    pub(super) is_accent: bool,
    /// Explicit endpoint relationship used by the slur/articulation resolver.
    pub(super) endpoint_relation: super::slurs::EndpointArticulationRelation,
}

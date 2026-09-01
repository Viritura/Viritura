#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::resolve::*;
use super::super::skyline::{Skyline, SkylineDirection};
use super::super::spacing::*;
use super::super::types::*;
use super::helpers::*;
use super::orchestrate::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Recompute note positions for cross-staff events using the target staff's clef.
///
/// When an event has `event.staff` overriding the parent sequence's staff, its note
/// positions were computed using the source staff's clef. This function corrects them
/// by looking up the target staff's clef from the other visual staves' layouts.
/// Ref: MNX spec — event-level staff override for cross-staff notation.
///
/// `visual_staves` maps each index in `all_layouts` to (part_index, staff_number).
pub(crate) fn fix_cross_staff_note_positions(
    all_layouts: &mut [Vec<MeasureLayout>],
    visual_staves: &[(usize, u32)],
    sp: f64,
    config: &LayoutConfig,
) {
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let clef_map = build_cross_staff_clef_map(all_layouts, visual_staves);
    let (receiving_staves, receiving_beat_ranges, receiving_from_above) =
        cross_staff_fix_note_positions(all_layouts, visual_staves, &clef_map);
    cross_staff_flip_native_stems(
        all_layouts,
        visual_staves,
        &receiving_staves,
        &receiving_from_above,
    );
    cross_staff_suppress_covered_rests(all_layouts, visual_staves, &receiving_beat_ranges);
    cross_staff_displace_colliding_notes(all_layouts, visual_staves, &receiving_staves, notehead_w);
}

/// Per-staff clef-change list keyed by `(part_index, staff_number, measure_index)`.
pub(super) type ClefChangeMap = HashMap<(usize, u32, usize), Vec<(f64, Clef)>>;

/// Phase 1 of `fix_cross_staff_note_positions`: collect each staff's clef
/// changes keyed by `(part_index, staff_number, measure_index)`. A default
/// G/F clef is injected for staves that lack any clef definition so that
/// later phases can always resolve a clef.
pub(super) fn build_cross_staff_clef_map(
    all_layouts: &[Vec<MeasureLayout>],
    visual_staves: &[(usize, u32)],
) -> ClefChangeMap {
    let mut clef_map: ClefChangeMap = HashMap::new();
    for (vi, measure_layouts) in all_layouts.iter().enumerate() {
        let (part_idx, staff_num) = visual_staves[vi];
        for ml in measure_layouts.iter() {
            let measure_index = ml.resolved.index;
            let mut clef_changes: Vec<(f64, Clef)> = Vec::new();
            if let Some(clefs) = &ml.resolved.part.clefs {
                for pc in clefs {
                    let beat = pc.position.as_ref().map_or(0.0, |pos| pos.beats());
                    clef_changes.push((beat, pc.clef.clone()));
                }
            }
            if clef_changes.is_empty() {
                let default_clef = if staff_num <= 1 {
                    Clef {
                        sign: ClefSign::G,
                        staff_position: -2,
                        color: None,
                        glyph: None,
                        octave: None,
                        show_octave: None,
                    }
                } else {
                    Clef {
                        sign: ClefSign::F,
                        staff_position: 2,
                        color: None,
                        glyph: None,
                        octave: None,
                        show_octave: None,
                    }
                };
                clef_changes.push((0.0, default_clef));
            }
            clef_changes.sort_by(|a, b| a.0.total_cmp(&b.0));
            clef_map.insert((part_idx, staff_num, measure_index), clef_changes);
        }
    }
    clef_map
}

/// Cross-staff bookkeeping map keyed by `(part_idx, staff_num, measure_idx)`,
/// listing (x, x) or (beat_start, beat_end) ranges of arriving cross-staff
/// notes for each receiving staff.
pub(super) type ReceivingRangeMap = HashMap<(usize, u32, usize), Vec<(f64, f64)>>;

/// Per receiving `(part, staff, measure)`, whether the arriving cross-staff
/// voice descends from a *higher* staff (i.e. `sequence_staff < target_staff`).
/// `true` → the arriving voice came from above, so the receiving staff's native
/// voice must flip stems *down* to clear it; `false` → it rose from below, so
/// the native voice flips stems *up* (the original behavior).
pub(super) type ReceivingDirMap = HashMap<(usize, u32, usize), bool>;

/// Phase 2: recompute note positions for events whose `event.staff` differs
/// from their sequence's staff using the destination staff's clef. Returns
/// `(receiving_staves, receiving_beat_ranges)`:
/// - `receiving_staves` maps a receiving `(part, staff, measure)` to the
///   list of `(x, x)` placeholder ranges (used downstream as a presence flag).
/// - `receiving_beat_ranges` maps the same key to the beat intervals covered
///   by arriving cross-staff notes (consumed by the rest-suppression phase).
pub(super) fn cross_staff_fix_note_positions(
    all_layouts: &mut [Vec<MeasureLayout>],
    visual_staves: &[(usize, u32)],
    clef_map: &ClefChangeMap,
) -> (ReceivingRangeMap, ReceivingRangeMap, ReceivingDirMap) {
    let mut receiving_staves: ReceivingRangeMap = HashMap::new();
    let mut receiving_beat_ranges: ReceivingRangeMap = HashMap::new();
    let mut receiving_from_above: ReceivingDirMap = HashMap::new();
    for (vi, measure_layouts) in all_layouts.iter_mut().enumerate() {
        let (part_idx, _staff_num) = visual_staves[vi];
        for ml in measure_layouts.iter_mut() {
            let measure_index = ml.resolved.index;
            let transposition = ml.resolved.display_transposition();
            for vl in &mut ml.voice_layouts {
                for i in 0..vl.events.len() {
                    let event = vl.events.event(i);
                    let Some(target_staff) = event.staff else {
                        continue;
                    };
                    if target_staff == vl.events.sequence_staff(i) || event.is_rest() {
                        continue;
                    }
                    let Some(clef_changes) = clef_map.get(&(part_idx, target_staff, measure_index))
                    else {
                        continue;
                    };
                    let clef = active_clef_at_beat(clef_changes, 0.0);
                    let new_positions: Vec<f64> = event
                        .notes()
                        .iter()
                        .map(|note| {
                            let diatonic = display_diatonic(note, transposition);
                            let clef_ref = clef.reference_diatonic();
                            let clef_line = clef.line_from_bottom();
                            let pos_from_clef_line = diatonic - clef_ref;
                            (4 - clef_line) as f64 * 2.0 - pos_from_clef_line as f64
                        })
                        .collect();
                    let ex = vl.events.x(i);
                    let beat_start = vl.events.beat_position(i);
                    let beat_end = beat_start + event.duration.total_beats();
                    let sequence_staff = vl.events.sequence_staff(i);
                    // Cross-staff note reposition keeps note count; write in place.
                    let slot = vl.events.note_positions_mut(i);
                    if slot.len() == new_positions.len() {
                        slot.copy_from_slice(&new_positions);
                    }
                    let rkey = (part_idx, target_staff, measure_index);
                    receiving_staves.entry(rkey).or_default().push((ex, ex));
                    receiving_beat_ranges
                        .entry(rkey)
                        .or_default()
                        .push((beat_start, beat_end));
                    // Record the arrival direction. A voice whose home
                    // (`sequence_staff`) sits above the target descends onto it
                    // from above; once any such descent is seen for this
                    // staff/measure the native voice yields downward.
                    let from_above = sequence_staff < target_staff;
                    *receiving_from_above.entry(rkey).or_insert(from_above) |= from_above;
                }
            }
        }
    }
    (
        receiving_staves,
        receiving_beat_ranges,
        receiving_from_above,
    )
}

/// Phase 3: a cross-staff voice acts as an additional voice on the target
/// staff. Per standard engraving practice, the existing native voice yields so
/// the arriving cross-staff stems have clear space:
/// - when the arriving voice rose from a *lower* staff it occupies the lower
///   position, so the native voice flips **stems-up**;
/// - when it descended from a *higher* staff it occupies the upper position, so
///   the native voice flips **stems-down**.
///
/// Only events without an explicit user direction override are flipped.
pub(super) fn cross_staff_flip_native_stems(
    all_layouts: &mut [Vec<MeasureLayout>],
    visual_staves: &[(usize, u32)],
    receiving_staves: &ReceivingRangeMap,
    receiving_from_above: &ReceivingDirMap,
) {
    for (vi, measure_layouts) in all_layouts.iter_mut().enumerate() {
        let (part_idx, staff_num) = visual_staves[vi];
        for ml in measure_layouts.iter_mut() {
            let measure_index = ml.resolved.index;
            let key = (part_idx, staff_num, measure_index);
            if !receiving_staves.contains_key(&key) {
                continue;
            };
            // Arrivals from above push the native voice down; from below, up.
            let native_stem_up = !receiving_from_above.get(&key).copied().unwrap_or(false);
            // The receiving staff now hosts a second (cross-staff) voice, so its
            // native voice's articulations must sit on the OUTER side, away from
            // the arriving voice — the same place the flipped stem points. From
            // below → native is the UPPER voice → articulations ABOVE; from
            // above → native is the LOWER voice → articulations BELOW.
            let force_artic_below = !native_stem_up;
            for vl in &mut ml.voice_layouts {
                for i in 0..vl.events.len() {
                    let event = vl.events.event(i);
                    let is_native = event.staff.is_none() || event.staff == Some(staff_num);
                    if !is_native {
                        continue;
                    }
                    if event.is_rest() {
                        continue;
                    }
                    let stem_forced = event.stem_direction.is_some()
                        || event.orient.and_then(|o| o.force_stem_up()).is_some();
                    // Articulation side follows the native voice's outer side
                    // regardless of a forced stem (a forced stem keeps the user's
                    // stem look but the marking still belongs outside).
                    vl.events.set_artic_force_below(i, Some(force_artic_below));
                    if stem_forced {
                        continue;
                    }
                    vl.events.set_stem_up(i, native_stem_up);
                }
            }
        }
    }
}

/// Phase 4: suppress home-staff rests fully covered by arriving cross-staff
/// notes (standard engraving practice). Reuses the existing `shared_rest` flag — the
/// event renderer already skips events with that flag set.
pub(super) fn cross_staff_suppress_covered_rests(
    all_layouts: &mut [Vec<MeasureLayout>],
    visual_staves: &[(usize, u32)],
    receiving_beat_ranges: &ReceivingRangeMap,
) {
    for (vi, measure_layouts) in all_layouts.iter_mut().enumerate() {
        let (part_idx, staff_num) = visual_staves[vi];
        for ml in measure_layouts.iter_mut() {
            let measure_index = ml.resolved.index;
            let key = (part_idx, staff_num, measure_index);
            let Some(ranges) = receiving_beat_ranges.get(&key) else {
                continue;
            };
            for vl in &mut ml.voice_layouts {
                for i in 0..vl.events.len() {
                    let event = vl.events.event(i);
                    if !event.is_rest() {
                        continue;
                    }
                    if vl.events.shared_rest(i) {
                        continue;
                    }
                    let is_native = event.staff.is_none() || event.staff == Some(staff_num);
                    if !is_native {
                        continue;
                    }
                    let r_start = vl.events.beat_position(i);
                    let r_end = r_start + event.duration.total_beats();
                    let covered = ranges
                        .iter()
                        .any(|&(s, e)| s <= r_start + 1e-6 && e >= r_end - 1e-6);
                    if covered {
                        vl.events.set_shared_rest(i, true);
                    }
                }
            }
        }
    }
}

/// Phase 5: cross-voice notehead displacement on receiving staves. When a
/// cross-staff event lands at the same X as a native event and the chords
/// form unisons or seconds, shift the cross-staff chord right by one notehead
/// width (standard engraving practice `layoutChords3`).
pub(super) fn cross_staff_displace_colliding_notes(
    all_layouts: &mut [Vec<MeasureLayout>],
    visual_staves: &[(usize, u32)],
    receiving_staves: &ReceivingRangeMap,
    notehead_w: f64,
) {
    /// Map of `(part_index, staff_num, measure_index)` → list of native
    /// `(x, note_positions)` pairs used during cross-staff displacement.
    type NativeEventsMap = HashMap<(usize, u32, usize), Vec<(f64, Vec<f64>)>>;
    let mut native_events: NativeEventsMap = HashMap::new();
    for (vi, measure_layouts) in all_layouts.iter().enumerate() {
        let (part_idx, staff_num) = visual_staves[vi];
        for ml in measure_layouts.iter() {
            let measure_index = ml.resolved.index;
            let key = (part_idx, staff_num, measure_index);
            if !receiving_staves.contains_key(&key) {
                continue;
            }
            for vl in &ml.voice_layouts {
                for i in 0..vl.events.len() {
                    let event = vl.events.event(i);
                    let is_native = event.staff.is_none() || event.staff == Some(staff_num);
                    if !is_native {
                        continue;
                    }
                    if event.is_rest() {
                        continue;
                    }
                    let note_positions = vl.events.note_positions(i);
                    if note_positions.is_empty() {
                        continue;
                    }
                    native_events
                        .entry(key)
                        .or_default()
                        .push((vl.events.x(i), note_positions.to_vec()));
                }
            }
        }
    }

    for (vi, measure_layouts) in all_layouts.iter_mut().enumerate() {
        let (part_idx, _staff_num) = visual_staves[vi];
        for ml in measure_layouts.iter_mut() {
            let measure_index = ml.resolved.index;
            for vl in &mut ml.voice_layouts {
                for i in 0..vl.events.len() {
                    let Some(target_staff) = vl.events.event(i).staff else {
                        continue;
                    };
                    if target_staff == vl.events.sequence_staff(i) {
                        continue;
                    }
                    if vl.events.event(i).is_rest() {
                        continue;
                    }
                    let note_positions = vl.events.note_positions(i);
                    if note_positions.is_empty() {
                        continue;
                    }
                    let key = (part_idx, target_staff, measure_index);
                    let Some(natives) = native_events.get(&key) else {
                        continue;
                    };
                    let ex = vl.events.x(i);
                    let collides = natives.iter().any(|(nx, npositions)| {
                        if (*nx - ex).abs() > 0.001 {
                            return false;
                        }
                        npositions
                            .iter()
                            .any(|&p0| note_positions.iter().any(|&p1| (p0 - p1).abs() <= 1.0))
                    });
                    if collides {
                        vl.events.set_x(i, ex + notehead_w);
                    }
                }
            }
        }
    }
}

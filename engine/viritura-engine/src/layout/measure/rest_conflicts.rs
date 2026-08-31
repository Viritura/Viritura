use super::super::types::{EventLayout, VoiceLayout};
use crate::model::{NoteValueBase, Rest};

/// Default rest staff position (MNX convention: 0 = middle line, positive = up).
fn default_rest_staff_position(base: &NoteValueBase) -> i32 {
    match base {
        NoteValueBase::Whole => 2, // Hangs from 4th line (one space above middle)
        _ => 0,                    // Middle line
    }
}

/// Vertical extent of a rest glyph in half-space units (above, below) from its reference position.
/// Returns (extent_up, extent_down) where both are positive values.
fn rest_vertical_extent(base: &NoteValueBase) -> (i32, i32) {
    match base {
        NoteValueBase::Whole => (1, 1),
        NoteValueBase::Half => (1, 1),
        NoteValueBase::Quarter => (3, 3),
        NoteValueBase::Eighth => (1, 2),
        NoteValueBase::Sixteenth => (1, 3),
        NoteValueBase::ThirtySecond => (2, 3),
        NoteValueBase::SixtyFourth => (2, 4),
        _ => (1, 1),
    }
}

/// Minimum clearance in half-spaces between a rest and notes/rests in another voice.
fn rest_clearance(base: &NoteValueBase) -> i32 {
    match base {
        NoteValueBase::Whole | NoteValueBase::Half => 2, // 0.55sp ≈ 1.1 half-spaces → 2
        _ => 1,                                          // 0.35sp ≈ 0.7 half-spaces → 1
    }
}

/// Resolve vertical rest conflicts in multi-voice measures.
///
/// When multiple voices share a staff, rests may collide with notes or rests
/// in other voices. This function shifts rests vertically to avoid overlaps:
/// - Voice 0 rests push UP (away from voice 1 notes below)
/// - Voice 1 rests push DOWN (away from voice 0 notes above)
pub(super) fn resolve_voice_rest_conflicts(voice_layouts: &mut [VoiceLayout]) {
    if voice_layouts.len() < 2 {
        return;
    }

    // Materialize every voice's events once, operate on the owned buffers, and
    // refreeze into the arena at the end. The conflict solver mixes
    // cross-voice immutable reads with per-voice mutation, which is awkward to
    // express against the columnar arena directly.
    let mut all: Vec<Vec<EventLayout>> = voice_layouts
        .iter()
        .map(|vl| vl.events.to_events())
        .collect();

    // First pass: detect shared rests. When both voices have a rest at the
    // same beat with the same duration, suppress voice 1's rest (voice 0
    // renders it at the default centered position).
    {
        let v0_rests: Vec<(f64, NoteValueBase, Option<u32>)> = all[0]
            .iter()
            .filter(|el| el.event.is_rest())
            .map(|el| {
                (
                    el.beat_position,
                    el.event.duration.base.clone(),
                    el.event.duration.dots,
                )
            })
            .collect();
        for el in all[1].iter_mut() {
            if !el.event.is_rest() {
                continue;
            }
            if v0_rests.iter().any(|(beat, base, dots)| {
                (beat - el.beat_position).abs() < 0.001
                    && *base == el.event.duration.base
                    && *dots == el.event.duration.dots
            }) {
                el.shared_rest = true;
            }
        }
    }

    // Second pass: hide trailing rests in non-primary voices.
    // After the last note in voice 1+, all remaining rests are suppressed
    // since voice 0 already defines the measure's rhythmic structure.
    for vl in all.iter_mut().skip(1) {
        let last_note_beat = vl
            .iter()
            .filter(|el| !el.event.is_rest())
            .map(|el| el.beat_position)
            .fold(f64::NEG_INFINITY, f64::max);
        if last_note_beat == f64::NEG_INFINITY {
            // Voice has no notes at all — hide all rests (full-measure rest
            // in a secondary voice is redundant)
            for el in vl.iter_mut() {
                if el.event.is_rest() {
                    el.shared_rest = true;
                }
            }
        } else {
            for el in vl.iter_mut() {
                if el.event.is_rest() && el.beat_position > last_note_beat + 0.001 {
                    el.shared_rest = true;
                }
            }
        }
    }

    // Collect note positions from each voice: Vec<(x, note_positions_in_hfs_from_top)>
    let voice_note_info: Vec<Vec<(f64, Vec<f64>)>> = all
        .iter()
        .map(|vl| {
            vl.iter()
                .filter(|el| !el.event.is_rest())
                .map(|el| (el.x, el.note_positions.clone()))
                .collect()
        })
        .collect();

    // Collect rest positions from each voice for rest-to-rest collision detection.
    // We'll process voice 0 first, then voice 1, storing adjusted positions.
    let mut rest_positions: Vec<Vec<(f64, i32)>> = vec![Vec::new(); all.len()];

    for vi in 0..all.len().min(2) {
        let other_vi = 1 - vi;
        let other_notes = &voice_note_info[other_vi];

        for el in all[vi].iter_mut() {
            if !el.event.is_rest() {
                continue;
            }
            // Skip shared rests — they won't be rendered
            if el.shared_rest {
                continue;
            }
            // Skip rests with explicit staff position from MNX (user-specified)
            if let Some(pos) = el.event.rest.as_ref().and_then(|r| r.staff_position) {
                rest_positions[vi].push((el.x, pos));
                continue;
            }

            let base = &el.event.duration.base;
            let default_pos = default_rest_staff_position(base);
            let (ext_up, ext_down) = rest_vertical_extent(base);
            let clearance = rest_clearance(base);

            // Convert default staff position (MNX) to half-spaces from top
            // hfs_from_top = 4 - mnx_pos
            let mut current_pos = default_pos;

            // Check collision with notes in the other voice
            let mut collides = true;
            let max_iterations = 16; // prevent infinite loops
            let mut iterations = 0;

            while collides && iterations < max_iterations {
                collides = false;
                let rest_hfs = 4 - current_pos; // half-spaces from top
                let rest_top = rest_hfs - ext_up; // top extent in hfs from top (smaller = higher)
                let rest_bottom = rest_hfs + ext_down; // bottom extent in hfs from top

                // Check against notes in the other voice at the same x
                for (nx, note_positions) in other_notes {
                    if (*nx - el.x).abs() > 0.001 {
                        continue;
                    }
                    for &note_pos in note_positions {
                        // note_pos is in half-spaces from top
                        let note_hfs = note_pos as i32;
                        // A notehead occupies roughly ±1 half-space
                        let note_top = note_hfs - 1;
                        let note_bottom = note_hfs + 1;

                        // Check overlap with clearance
                        if rest_top - clearance <= note_bottom
                            && rest_bottom + clearance >= note_top
                        {
                            collides = true;
                            break;
                        }
                    }
                    if collides {
                        break;
                    }
                }

                // Check against rests already placed in the other voice
                if !collides {
                    for &(rx, rpos) in &rest_positions[other_vi] {
                        if (rx - el.x).abs() > 0.001 {
                            continue;
                        }
                        let other_hfs = 4 - rpos;
                        // Use rest-to-rest clearance of 2 half-spaces
                        let rest_to_rest_clearance = 2;
                        if (rest_hfs - other_hfs).abs() < ext_up + ext_down + rest_to_rest_clearance
                        {
                            collides = true;
                            break;
                        }
                    }
                }

                if collides {
                    // Move in staff-line increments (2 half-spaces)
                    if vi == 0 {
                        current_pos += 2; // push up
                    } else {
                        current_pos -= 2; // push down
                    }
                }
                iterations += 1;
            }

            // Apply the adjusted position if it changed
            if current_pos != default_pos {
                if let Some(ref mut rest) = el.event.rest {
                    rest.staff_position = Some(current_pos);
                } else {
                    el.event.rest = Some(Rest {
                        staff_position: Some(current_pos),
                    });
                }
            }

            rest_positions[vi].push((el.x, current_pos));
        }
    }

    // Refreeze the mutated event buffers back into each voice's arena.
    for (vl, evs) in voice_layouts.iter_mut().zip(all) {
        vl.events = super::super::arena::EventArena::from_events(evs);
    }
}

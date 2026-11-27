use super::super::config::LayoutConfig;
use super::super::types::{EventLayout, MeasureLayout};
use crate::model::{NoteValueBase, Rest};

mod ink;
use ink::{clear_own_ink, note_ink, rest_ink, StaffInk};

/// Default rest staff position (MNX convention: 0 = middle line, positive = up).
fn default_rest_staff_position(base: &NoteValueBase) -> i32 {
    match base {
        NoteValueBase::Whole => 2, // Hangs from 4th line (one space above middle)
        _ => 0,                    // Middle line
    }
}

/// Resolve vertical rest conflicts in multi-voice measures.
///
/// When multiple voices share a staff, rests may collide with notes or rests
/// in other voices. This function shifts rests vertically to avoid overlaps:
/// Upper-voice rests move up and lower-voice rests move down, following the
/// resolved voice direction (including condensed sources and direction hints).
pub(super) fn resolve_voice_rest_conflicts(
    measure: &mut MeasureLayout,
    sp: f64,
    config: &LayoutConfig,
) {
    if measure.voice_layouts.len() < 2 {
        return;
    }

    // Materialize every voice's events once, operate on the owned buffers, and
    // refreeze into the arena at the end. The conflict solver mixes
    // cross-voice immutable reads with per-voice mutation, which is awkward to
    // express against the columnar arena directly.
    let mut all: Vec<Vec<EventLayout>> = measure
        .voice_layouts
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

    place_visible_rests(measure, &mut all, sp, config);

    // Refreeze the mutated event buffers back into each voice's arena.
    for (vl, evs) in measure.voice_layouts.iter_mut().zip(all) {
        vl.events = super::super::arena::EventArena::from_events(evs);
    }
}

fn place_visible_rests(
    measure: &MeasureLayout,
    all: &mut [Vec<EventLayout>],
    sp: f64,
    config: &LayoutConfig,
) {
    if !all.iter().flatten().any(|event| {
        event.event.is_rest()
            && !event.shared_rest
            && event
                .event
                .rest
                .as_ref()
                .and_then(|rest| rest.staff_position)
                .is_none()
    }) {
        return;
    }
    let notes = note_ink(measure, all, sp, config);
    let total_beats = super::layout_total_beats(&measure.resolved);
    let mut rests: Vec<Vec<Option<StaffInk>>> = all
        .iter()
        .enumerate()
        .map(|(vi, events)| {
            let centered = measure.voice_layouts[vi].is_centered_bar_rest(total_beats);
            events
                .iter()
                .map(|event| {
                    (event.event.is_rest() && !event.shared_rest).then(|| StaffInk {
                        staff: event.event.staff.unwrap_or(event.sequence_staff),
                        bounds: rest_ink(
                            event,
                            event
                                .event
                                .rest
                                .as_ref()
                                .and_then(|r| r.staff_position)
                                .unwrap_or_else(|| {
                                    default_rest_staff_position(&event.event.duration.base)
                                }),
                            centered,
                            sp,
                        ),
                    })
                })
                .collect()
        })
        .collect();
    for (vi, events) in all.iter_mut().enumerate() {
        for (ei, event) in events.iter_mut().enumerate() {
            let Some(rest) = &rests[vi][ei] else { continue };
            if event
                .event
                .rest
                .as_ref()
                .and_then(|rest| rest.staff_position)
                .is_some()
            {
                continue;
            }
            let mut dy = 0.0_f64;
            let clearance = if matches!(
                event.event.duration.base,
                NoteValueBase::Whole | NoteValueBase::Half
            ) {
                0.55 * sp
            } else {
                0.35 * sp
            };
            for other in 0..notes.len() {
                if other == vi {
                    continue;
                }
                for obstacle in notes[other].iter().chain(rests[other].iter().flatten()) {
                    if obstacle.staff != rest.staff
                        || obstacle.bounds.x >= rest.bounds.x + rest.bounds.width
                        || obstacle.bounds.x + obstacle.bounds.width <= rest.bounds.x
                    {
                        continue;
                    }
                    // Standard engraving practice keeps upper-voice rests above lower-voice ink,
                    // and lower-voice rests below upper-voice ink, even when pitches cross.
                    if event.stem_up {
                        dy = dy.min(
                            obstacle.bounds.y - clearance - rest.bounds.y - rest.bounds.height,
                        );
                    } else {
                        dy = dy.max(
                            obstacle.bounds.y + obstacle.bounds.height + clearance - rest.bounds.y,
                        );
                    }
                }
            }
            dy = dy.signum() * (dy.abs() / sp).ceil() * sp;
            dy = clear_own_ink(rest, &notes[vi], event.stem_up, clearance, sp, dy);
            let steps = (dy.abs() / sp).round() as i32;
            if steps > 0 {
                let position = default_rest_staff_position(&event.event.duration.base)
                    + if event.stem_up { 2 * steps } else { -2 * steps };
                event.event.rest = Some(Rest {
                    staff_position: Some(position),
                });
                let centered = measure.voice_layouts[vi].is_centered_bar_rest(total_beats);
                rests[vi][ei].as_mut().expect("visible rest").bounds =
                    rest_ink(event, position, centered, sp);
            }
        }
    }
}

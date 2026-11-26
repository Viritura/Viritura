//! Shared stem direction for beam groups.
//!
//! Each event's stem is first resolved on its own; a beam then imposes one
//! direction on every member of its group.

use super::helpers::compute_seconds_displacement;
use super::stem_direction::{
    beam_group_stem_up_from_pitch, contesting_voice_count, sequence_stem_intent, StemContext,
};
use crate::layout::types::VoiceLayout;
use crate::model::event::StemDirection;
use crate::model::{Beam, ResolvedMeasure};
use std::collections::HashSet;

/// Normalize stem direction across beam groups.
///
/// Each event's `stem_up` is first computed independently from its own notes,
/// but a beam carries one direction for the whole group: `render_beams` reads
/// `beam_events[0].stem_up`, and slurs and articulations read each event's
/// value (standard engraving convention: slur is opposite the stem). Resolve
/// the group's direction once and propagate it to every event in the group.
pub(super) fn normalize_beam_group_stem_directions(
    voice_layouts: &mut [VoiceLayout],
    rm: &ResolvedMeasure,
) -> HashSet<String> {
    let spanning_ids: HashSet<String> = rm
        .spanning_beams
        .iter()
        .flat_map(|spanning| spanning.beam.events.iter().cloned())
        .collect();
    let beams_owned: Vec<Beam>;
    let beams: &[Beam] = if let Some(b) = rm.part.beams.as_ref() {
        b.as_slice()
    } else {
        beams_owned = crate::layout::beams::auto_beam_groups(
            voice_layouts,
            rm.effective_beat_meter(),
            &spanning_ids,
        );
        &beams_owned
    };
    let mut beamed_ids: HashSet<String> = beams
        .iter()
        .flat_map(|beam| beam.events.iter().cloned())
        .collect();
    beamed_ids.extend(spanning_ids.iter().cloned());
    for beam in beams {
        if beam.events.iter().any(|id| spanning_ids.contains(id)) {
            continue;
        }
        let Some(stem_up) = beam_group_stem_up(beam, voice_layouts, rm) else {
            continue;
        };
        apply_group_stem_up(voice_layouts, &beam.events, stem_up);
    }
    // A barline-crossing group shares the direction resolved for its whole
    // length; without one, its first member in this measure leads.
    for spanning in &rm.spanning_beams {
        let stem_up = spanning.stem_up.or_else(|| {
            spanning
                .beam
                .events
                .iter()
                .find_map(|id| event_stem_up(voice_layouts, id))
        });
        if let Some(stem_up) = stem_up {
            apply_group_stem_up(voice_layouts, &spanning.beam.events, stem_up);
        }
    }
    beamed_ids
}

fn event_stem_up(voice_layouts: &[VoiceLayout], id: &str) -> Option<bool> {
    voice_layouts.iter().find_map(|vl| {
        (0..vl.events.len())
            .find(|&i| vl.events.id(i) == Some(id))
            .map(|i| vl.events.stem_up(i))
    })
}

fn apply_group_stem_up(voice_layouts: &mut [VoiceLayout], events: &[String], stem_up: bool) {
    for id in events {
        for vl in voice_layouts.iter_mut() {
            for i in 0..vl.events.len() {
                if vl.events.id(i) == Some(id.as_str()) {
                    // Flipping the stem direction also flips which side of
                    // the stem a second-interval notehead is displaced to
                    // (stem-up displaces the upper note right, stem-down the
                    // lower note left). The `note_x_offsets` were computed in
                    // `layout_sequence_content` with this event's ORIGINAL
                    // stem direction; if the beam-group normalization changes
                    // it, recompute them or the displaced noteheads end up on
                    // the wrong side, detached from the stem by a notehead
                    // width (standard engraving practice; the cause of
                    // "floating" cluster noteheads in beamed chords).
                    if vl.events.stem_up(i) != stem_up {
                        vl.events.set_stem_up(i, stem_up);
                        let positions = vl.events.note_positions(i).to_vec();
                        let new_offsets = compute_seconds_displacement(&positions, stem_up);
                        vl.events
                            .note_x_offsets_mut(i)
                            .copy_from_slice(&new_offsets);
                    }
                }
            }
        }
    }
}

/// The stem direction shared by one beam group.
///
/// An explicit `stemDirection` on any member wins, then sequence-level intent
/// (forced stems or contested voices, already applied to each member). Only an
/// uncontested, single-staff group lying wholly in this measure is decided
/// from the group's pitches; cross-staff and cross-barline groups keep the
/// first member's direction, which their dedicated renderers expect.
fn beam_group_stem_up(
    beam: &Beam,
    voice_layouts: &[VoiceLayout],
    rm: &ResolvedMeasure,
) -> Option<bool> {
    let members: Vec<(usize, usize)> = beam
        .events
        .iter()
        .filter_map(|id| {
            voice_layouts.iter().enumerate().find_map(|(vi, vl)| {
                (0..vl.events.len())
                    .find(|&i| vl.events.id(i) == Some(id.as_str()))
                    .map(|i| (vi, i))
            })
        })
        .collect();
    let &(first_vi, first_ei) = members.first()?;
    let first_stem_up = voice_layouts[first_vi].events.stem_up(first_ei);
    if let Some(explicit) = members
        .iter()
        .find_map(|&(vi, ei)| voice_layouts[vi].events.event(ei).stem_direction.as_ref())
    {
        return Some(matches!(explicit, StemDirection::Up));
    }
    let contesting = contesting_voice_count(&rm.part.sequences);
    let has_sequence_intent = members.iter().any(|&(vi, _)| {
        rm.part.sequences.get(vi).is_some_and(|sequence| {
            sequence_stem_intent(StemContext::for_sequence(sequence, contesting), vi).is_some()
        })
    });
    let staves: HashSet<u32> = members
        .iter()
        .map(|&(vi, ei)| {
            let events = &voice_layouts[vi].events;
            events.event(ei).staff.unwrap_or(events.sequence_staff(ei))
        })
        .collect();
    if has_sequence_intent || members.len() < beam.events.len() || staves.len() > 1 {
        return Some(first_stem_up);
    }
    let positions = members
        .iter()
        .map(|&(vi, ei)| voice_layouts[vi].events.note_positions(ei));
    Some(beam_group_stem_up_from_pitch(positions).unwrap_or(first_stem_up))
}

//! Authored beams whose members cross barlines.
//!
//! Each measure is laid out on its own, so a beam that continues into the
//! next measure (and possibly onto the next system) needs one decision that
//! every touched measure shares: which events it joins, which way its stems
//! point, and how many beams each member carries. Resolution records that
//! decision on every touched measure, so measure layout and the system
//! renderer read the same group and editing one measure invalidates the
//! cached layout of its partners.

use crate::layout::measure::{
    beam_group_stem_up_from_pitch, compute_note_staff_positions, contesting_voice_count,
    sequence_stem_intent, StemContext,
};
use crate::model::event::StemDirection;
use crate::model::measure::SpanningBeam;
use crate::model::*;
use std::collections::{HashMap, HashSet};

struct Member<'a> {
    position: usize,
    voice_index: usize,
    staff: u32,
    event: &'a Event,
}

/// Record every valid barline-crossing beam on each measure it touches.
///
/// A group qualifies when it joins at least two distinct events that all
/// resolve on this staff, run forward through consecutive measures, share one
/// staff, and touch more than one measure. Anything else keeps the
/// single-measure handling. Returns the first and last positions whose
/// records changed.
pub(crate) fn attach_spanning_beams(measures: &mut [ResolvedMeasure]) -> Option<(usize, usize)> {
    let mut attached: Vec<Vec<SpanningBeam>> = vec![Vec::new(); measures.len()];
    for (positions, spanning) in find_spanning_beams(measures) {
        for position in positions {
            attached[position].push(spanning.clone());
        }
    }
    let mut changed: Option<(usize, usize)> = None;
    for (position, (measure, spanning)) in measures.iter_mut().zip(attached).enumerate() {
        if measure.spanning_beams != spanning {
            measure.spanning_beams = spanning;
            changed = Some(changed.map_or((position, position), |(start, _)| (start, position)));
        }
    }
    changed
}

/// Attach spanning groups to one authored system's re-resolved measures.
/// Groups found on the system itself are kept; groups whose partners fall on
/// another system come from the whole-score resolution of each source part.
/// Only groups with a member in the measure are added.
pub(crate) fn attach_system_spanning_beams(
    measures: &mut [ResolvedMeasure],
    whole_score: &[Vec<ResolvedMeasure>],
    sources: &[crate::layout::full_score::FlatSource],
) {
    attach_spanning_beams(measures);
    for measure in measures {
        for part_index in sources.iter().map(|source| source.part_index) {
            if let Some(whole) = whole_score
                .get(part_index)
                .and_then(|part| part.get(measure.index))
            {
                inherit_measure_spanning_beams(measure, &whole.spanning_beams);
            }
        }
    }
}

fn inherit_measure_spanning_beams(measure: &mut ResolvedMeasure, source: &[SpanningBeam]) {
    if source.is_empty() {
        return;
    }
    let mut ids = HashSet::new();
    for sequence in &measure.part.sequences {
        collect_ids(&sequence.content, &mut ids);
    }
    let inherited: Vec<SpanningBeam> = source
        .iter()
        .filter(|candidate| {
            !measure.spanning_beams.iter().any(|existing| {
                existing.declaring_measure == candidate.declaring_measure
                    && existing.beam_index == candidate.beam_index
            }) && candidate
                .beam
                .events
                .iter()
                .any(|id| ids.contains(id.as_str()))
        })
        .cloned()
        .collect();
    measure.spanning_beams.extend(inherited);
}

fn find_spanning_beams(measures: &[ResolvedMeasure]) -> Vec<(Vec<usize>, SpanningBeam)> {
    let mut index: Option<HashMap<&str, Member<'_>>> = None;
    let mut found = Vec::new();
    for measure in measures {
        let Some(beams) = measure.part.beams.as_deref() else {
            continue;
        };
        let mut local: Option<HashSet<&str>> = None;
        for (beam_index, beam) in beams.iter().enumerate() {
            if beam.events.len() < 2 {
                continue;
            }
            let local = local.get_or_insert_with(|| {
                let mut ids = HashSet::new();
                for sequence in &measure.part.sequences {
                    collect_ids(&sequence.content, &mut ids);
                }
                ids
            });
            if beam.events.iter().all(|id| local.contains(id.as_str())) {
                continue;
            }
            let index = index.get_or_insert_with(|| event_index(measures));
            if let Some(spanning) = spanning_beam(measures, index, measure.index, beam_index, beam)
            {
                found.push(spanning);
            }
        }
    }
    found
}

fn collect_ids<'a>(content: &'a [SequenceContent], ids: &mut HashSet<&'a str>) {
    for item in content {
        match item {
            SequenceContent::Event(event) => {
                if let Some(id) = event.id.as_deref() {
                    ids.insert(id);
                }
            }
            SequenceContent::Tuplet(tuplet) => collect_ids(&tuplet.content, ids),
            _ => {}
        }
    }
}

fn event_index(measures: &[ResolvedMeasure]) -> HashMap<&str, Member<'_>> {
    let mut index = HashMap::new();
    for (position, measure) in measures.iter().enumerate() {
        for (voice_index, sequence) in measure.part.sequences.iter().enumerate() {
            index_content(
                &sequence.content,
                position,
                voice_index,
                sequence.staff.unwrap_or(1),
                &mut index,
            );
        }
    }
    index
}

fn index_content<'a>(
    content: &'a [SequenceContent],
    position: usize,
    voice_index: usize,
    sequence_staff: u32,
    index: &mut HashMap<&'a str, Member<'a>>,
) {
    for item in content {
        match item {
            SequenceContent::Event(event) => {
                if let Some(id) = event.id.as_deref() {
                    index.entry(id).or_insert(Member {
                        position,
                        voice_index,
                        staff: event.staff.unwrap_or(sequence_staff),
                        event,
                    });
                }
            }
            SequenceContent::Tuplet(tuplet) => {
                index_content(
                    &tuplet.content,
                    position,
                    voice_index,
                    sequence_staff,
                    index,
                );
            }
            _ => {}
        }
    }
}

fn spanning_beam(
    measures: &[ResolvedMeasure],
    index: &HashMap<&str, Member<'_>>,
    declaring_measure: usize,
    beam_index: usize,
    beam: &Beam,
) -> Option<(Vec<usize>, SpanningBeam)> {
    let members: Vec<&Member<'_>> = beam
        .events
        .iter()
        .map(|id| index.get(id.as_str()))
        .collect::<Option<_>>()?;
    let distinct: HashSet<&str> = beam.events.iter().map(String::as_str).collect();
    if distinct.len() != members.len() {
        return None;
    }
    let mut positions: Vec<usize> = Vec::new();
    for member in &members {
        match positions.last() {
            Some(&last) if member.position == last => {}
            Some(&last) if member.position != last + 1 => return None,
            _ => positions.push(member.position),
        }
    }
    let staves: HashSet<u32> = members.iter().map(|member| member.staff).collect();
    if positions.len() < 2 || staves.len() > 1 {
        return None;
    }
    let spanning = SpanningBeam {
        declaring_measure,
        beam_index,
        beam: beam.clone(),
        stem_up: shared_stem_up(measures, &members),
        member_levels: members
            .iter()
            .map(|member| member.event.duration.base.flag_count())
            .collect(),
    };
    Some((positions, spanning))
}

/// The stem direction shared by a barline-crossing group.
///
/// Standard engraving practice: a beam keeps one stem direction for its whole
/// length, even across a barline or a system break. An explicit
/// `stemDirection` on any member wins; sequence-level intent (forced stems,
/// contested voices) is left to each member; otherwise the group's pitches
/// decide, judged against the clef at the start of each member's measure.
fn shared_stem_up(measures: &[ResolvedMeasure], members: &[&Member<'_>]) -> Option<bool> {
    if let Some(explicit) = members
        .iter()
        .find_map(|member| member.event.stem_direction.as_ref())
    {
        return Some(matches!(explicit, StemDirection::Up));
    }
    for member in members {
        let measure = &measures[member.position];
        let contesting = contesting_voice_count(&measure.part.sequences);
        let sequence = measure.part.sequences.get(member.voice_index)?;
        let context = StemContext::for_sequence(sequence, contesting);
        if sequence_stem_intent(context, member.voice_index).is_some() {
            return None;
        }
        let staves: HashSet<u32> = measure
            .part
            .sequences
            .iter()
            .map(|sequence| sequence.staff.unwrap_or(1))
            .collect();
        if staves.len() > 1 {
            return None;
        }
    }
    let positions: Vec<Vec<f64>> = members
        .iter()
        .map(|member| {
            let measure = &measures[member.position];
            compute_note_staff_positions(
                member.event.notes(),
                &start_clef(measure),
                0,
                measure.display_transposition(),
                measure.kit.as_ref(),
            )
        })
        .collect();
    beam_group_stem_up_from_pitch(positions.iter().map(Vec::as_slice))
}

fn start_clef(measure: &ResolvedMeasure) -> Clef {
    measure
        .part
        .clefs
        .as_deref()
        .unwrap_or_default()
        .iter()
        .find(|clef| clef.position.as_ref().is_none_or(|p| p.fraction.0 == 0))
        .map(|clef| clef.clef.clone())
        .unwrap_or(Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: None,
            show_octave: None,
            hide: None,
        })
}

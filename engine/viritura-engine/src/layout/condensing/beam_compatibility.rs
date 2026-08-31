use crate::model::{Beam, BeamHookDirection, PartMeasure, SequenceContent};
use std::collections::HashMap;

#[derive(PartialEq)]
struct BeamTopology {
    events: Vec<Option<usize>>,
    beams: Vec<BeamTopology>,
    direction: Option<BeamHookDirection>,
}

fn record_event_id(event_id: &Option<String>, positions: &mut HashMap<String, usize>) {
    if let Some(id) = event_id {
        let next_position = positions.len();
        positions.insert(id.clone(), next_position);
    }
}

fn record_content_event_ids(content: &[SequenceContent], positions: &mut HashMap<String, usize>) {
    for item in content {
        match item {
            SequenceContent::Event(event) => record_event_id(&event.id, positions),
            SequenceContent::Tuplet(tuplet) => record_content_event_ids(&tuplet.content, positions),
            SequenceContent::Grace(grace) => {
                for event in &grace.content {
                    record_event_id(&event.id, positions);
                }
            }
            SequenceContent::MultiNoteTremolo(tremolo) => {
                for event in &tremolo.content {
                    record_event_id(&event.id, positions);
                }
            }
            SequenceContent::Space(_) | SequenceContent::Other(_) => {}
        }
    }
}

fn event_positions(measure: &PartMeasure) -> HashMap<String, usize> {
    let mut positions = HashMap::new();
    for sequence in &measure.sequences {
        record_content_event_ids(&sequence.content, &mut positions);
    }
    positions
}

fn beam_topology(beam: &Beam, positions: &HashMap<String, usize>) -> BeamTopology {
    BeamTopology {
        events: beam
            .events
            .iter()
            .map(|event_id| positions.get(event_id).copied())
            .collect(),
        beams: beam
            .beams
            .iter()
            .map(|inner| beam_topology(inner, positions))
            .collect(),
        direction: beam.direction,
    }
}

fn measure_beam_topology(measure: &PartMeasure) -> Vec<BeamTopology> {
    let positions = event_positions(measure);
    measure
        .beams
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|beam| beam_topology(beam, &positions))
        .collect()
}

/// Standard engraving practice: parts can share one condensed voice only when
/// their authored beam grouping agrees, including nested beams and beamlets.
pub(super) fn beam_groups_compatible(a: &PartMeasure, b: &PartMeasure) -> bool {
    measure_beam_topology(a) == measure_beam_topology(b)
}

#[cfg(test)]
mod tests {
    use super::super::labels::{analyze_merge_mode, MergeMode};
    use super::*;
    use crate::model::{
        Duration, Event, Note, NoteValueBase, PartMeasure, Pitch, Sequence, SequenceContent,
    };

    fn event(id: &str, step: &str) -> SequenceContent {
        SequenceContent::Event(Event {
            duration: Duration {
                base: NoteValueBase::Eighth,
                dots: None,
            },
            id: Some(id.to_string()),
            notes: Some(vec![Note {
                pitch: Pitch {
                    step: step.to_string(),
                    octave: 5,
                    alter: None,
                },
                id: None,
                ties: None,
                accidental_display: None,
                written: None,
                staff: None,
                source_part_index: None,
                kit_component: None,
                perform: None,
                source_note_index: None,
                source_event_id: None,
            }]),
            rest: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        })
    }

    fn measure(prefix: &str, beam_events: Option<&[usize]>) -> PartMeasure {
        let ids: Vec<String> = (0..3).map(|index| format!("{prefix}{index}")).collect();
        PartMeasure {
            sequences: vec![Sequence {
                content: vec![
                    event(&ids[0], "C"),
                    event(&ids[1], "D"),
                    event(&ids[2], "E"),
                ],
                full_measure: None,
                staff: None,
                voice: None,
                orient: None,
                forced_stem_up: None,
                source_part_index: None,
                source_seq_index: None,
            }],
            clefs: None,
            arpeggios: None,
            non_arpeggios: None,
            beams: beam_events.map(|indices| {
                vec![Beam {
                    events: indices.iter().map(|index| ids[*index].clone()).collect(),
                    beams: Vec::new(),
                    direction: None,
                }]
            }),
            dynamics: None,
            ottavas: None,
            measure_repeat: None,
            pedals: None,
            chord_symbols: None,
            expressions: None,
            condensing_override: None,
        }
    }

    #[test]
    fn matching_beam_groups_ignore_source_event_ids() {
        assert!(beam_groups_compatible(
            &measure("a", Some(&[0, 1, 2])),
            &measure("b", Some(&[0, 1, 2])),
        ));
    }

    #[test]
    fn missing_or_different_beam_groups_are_incompatible() {
        let beamed = measure("a", Some(&[0, 1, 2]));
        assert!(!beam_groups_compatible(&beamed, &measure("b", None)));
        assert!(!beam_groups_compatible(
            &beamed,
            &measure("b", Some(&[0, 1])),
        ));
    }

    #[test]
    fn incompatible_beam_groups_force_separate_condensed_voices() {
        let beamed = measure("a", Some(&[0, 1, 2]));
        let unbeamed = measure("b", None);
        assert_eq!(analyze_merge_mode(&[&beamed, &unbeamed]), MergeMode::Divisi);
    }
}

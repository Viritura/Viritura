use super::MeasureLayout;
use std::collections::HashMap;

/// Map tie targets to whether they need a courtesy accidental because the
/// continuation crosses into a new system.
pub(crate) fn compute_tie_accidental_map(
    measure_layouts: &[MeasureLayout],
) -> HashMap<String, bool> {
    let refs: Vec<&MeasureLayout> = measure_layouts.iter().collect();
    compute_tie_accidental_map_refs(&refs)
}

/// Reference-slice variant used by stitched horizon layout, where tie sources
/// and targets may live in different retained chunks.
pub(crate) fn compute_tie_accidental_map_refs(
    measure_layouts: &[&MeasureLayout],
) -> HashMap<String, bool> {
    let mut note_measure: HashMap<String, usize> = HashMap::new();
    for (measure_index, measure) in measure_layouts.iter().enumerate() {
        for voice in &measure.voice_layouts {
            for event_index in 0..voice.events.len() {
                for note in voice.events.event(event_index).notes() {
                    if let Some(id) = note.id.as_deref() {
                        note_measure.insert(id.to_string(), measure_index);
                    }
                }
            }
        }
    }

    let mut targets = HashMap::new();
    for (measure_index, measure) in measure_layouts.iter().enumerate() {
        for voice in &measure.voice_layouts {
            for event_index in 0..voice.events.len() {
                for note in voice.events.event(event_index).notes() {
                    let Some(ties) = note.ties.as_ref() else {
                        continue;
                    };
                    for tie in ties {
                        if tie
                            .target_type
                            .as_deref()
                            .is_some_and(|target_type| target_type != "nextNote")
                        {
                            continue;
                        }
                        let Some(target) = tie.target.as_deref() else {
                            continue;
                        };
                        let Some(&target_measure_index) = note_measure.get(target) else {
                            continue;
                        };
                        if target_measure_index < measure_index {
                            continue;
                        }
                        let courtesy = target_measure_index > measure_index
                            && measure_layouts
                                .get(target_measure_index)
                                .is_some_and(|target_measure| target_measure.is_first_on_system);
                        targets.insert(target.to_string(), courtesy);
                    }
                }
            }
        }
    }
    targets
}

//! Beam rendering — beam groups, beam slope, cross-barline beams, grace beams.

use super::{element_id, types};

mod cross_barline;
mod drawing;
mod grouping;
mod quantized_positions;
mod render;
mod rests;
mod scoring;

pub(crate) use cross_barline::*;
pub(crate) use grouping::*;
pub(crate) use render::*;
pub(crate) use rests::*;
#[cfg(test)]
pub(crate) use scoring::*;

fn beam_member_element_ids(measures: &[types::MeasureLayout], event_ids: &[String]) -> Vec<String> {
    let mut members = Vec::new();
    for wanted in event_ids {
        'search: for measure in measures {
            for (voice_index, voice) in measure.voice_layouts.iter().enumerate() {
                for event_index in 0..voice.events.len() {
                    if voice.events.id(event_index) != Some(wanted.as_str()) {
                        continue;
                    }
                    let event = voice.events.event(event_index);
                    let suffix = element_id::event_suffix(Some(wanted), event_index);
                    members.push(element_id::event(
                        voice.part_index_override.unwrap_or(measure.part_index),
                        measure.resolved.index,
                        voice.seq_index_override.unwrap_or(voice_index),
                        &suffix,
                    ));
                    members.extend(
                        event
                            .notes()
                            .iter()
                            .filter_map(|note| note.source_event_id.clone()),
                    );
                    break 'search;
                }
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    members.retain(|member| seen.insert(member.clone()));
    members
}

use super::super::full_score::{FlatStaff, GroupRange};
use crate::model::layout::{AutoHideFirstSystem, ScoreDefinition};
use crate::model::{Event, Markings, PartMeasure, Score, SequenceContent};
use std::collections::{HashMap, HashSet};
use std::ops::Range;

pub(super) struct EmptyStaves {
    empty_measures: HashMap<usize, Vec<bool>>,
    keep_first_system: bool,
    keep_visible: Vec<(usize, HashSet<usize>)>,
}

fn collect_events<'a>(content: &'a [SequenceContent], events: &mut Vec<&'a Event>) {
    for item in content {
        match item {
            SequenceContent::Event(event) => events.push(event),
            SequenceContent::Tuplet(tuplet) => collect_events(&tuplet.content, events),
            SequenceContent::Grace(grace) => events.extend(&grace.content),
            SequenceContent::MultiNoteTremolo(tremolo) => events.extend(&tremolo.content),
            SequenceContent::Space(_) | SequenceContent::Other(_) => {}
        }
    }
}

fn unmarked_rest(content: &SequenceContent) -> bool {
    match content {
        SequenceContent::Space(_) => true,
        SequenceContent::Event(event) => {
            event.notes().is_empty()
                && event
                    .markings
                    .as_ref()
                    .is_none_or(|markings| *markings == Markings::default())
                && event.fermata.is_none()
                && event.lyrics.is_none()
                && event.slurs.as_ref().is_none_or(Vec::is_empty)
                && event.glissandos.as_ref().is_none_or(Vec::is_empty)
        }
        // Tuplet numbers, grace groups, and tremolos are authored notation.
        SequenceContent::Tuplet(_)
        | SequenceContent::Grace(_)
        | SequenceContent::MultiNoteTremolo(_)
        | SequenceContent::Other(_) => false,
    }
}

fn unmarked_measure(measure: &PartMeasure, index: usize) -> bool {
    measure.sequences.iter().all(|sequence| {
        sequence
            .full_measure
            .as_ref()
            .is_none_or(|rest| rest.fermata.is_none())
            && sequence.content.iter().all(unmarked_rest)
    }) && measure.dynamics.as_ref().is_none_or(Vec::is_empty)
        && measure.expressions.as_ref().is_none_or(Vec::is_empty)
        && measure.pedals.as_ref().is_none_or(Vec::is_empty)
        && measure.harp_pedals.as_ref().is_none_or(Vec::is_empty)
        && measure.ottavas.as_ref().is_none_or(Vec::is_empty)
        && measure.arpeggios.as_ref().is_none_or(Vec::is_empty)
        && measure.non_arpeggios.as_ref().is_none_or(Vec::is_empty)
        && measure.beams.as_ref().is_none_or(Vec::is_empty)
        && measure.measure_repeat.is_none()
        && measure
            .instrument_changes
            .as_ref()
            .is_none_or(Vec::is_empty)
        && measure.staff_meters.as_ref().is_none_or(Vec::is_empty)
        && measure
            .grouping_display_overrides
            .as_ref()
            .is_none_or(Vec::is_empty)
        && (index == 0
            || (measure.clefs.as_ref().is_none_or(Vec::is_empty)
                && measure.staff_configs.as_ref().is_none_or(Vec::is_empty)))
}

impl EmptyStaves {
    pub(super) fn new(score: &Score, definition: &ScoreDefinition) -> Self {
        let selected = &definition.auto_hide_empty_parts;
        let measure_indices: HashMap<&str, usize> = score
            .global
            .measures
            .iter()
            .enumerate()
            .filter_map(|(index, measure)| Some((measure.id.as_deref()?, index)))
            .collect();
        let part_indices: HashMap<&str, usize> = score
            .parts
            .iter()
            .enumerate()
            .filter_map(|(index, part)| Some((part.id.as_deref()?, index)))
            .collect();
        let options = definition.auto_hide_empty_staves.as_ref();
        let keep_first_system = options
            .and_then(|options| options.first_system)
            .is_some_and(|policy| policy == AutoHideFirstSystem::Show);
        let keep_visible = options
            .map(|options| {
                options
                    .keep_visible
                    .iter()
                    .filter_map(|entry| {
                        let measure = *measure_indices.get(entry.measure.as_str())?;
                        let parts = entry
                            .parts
                            .iter()
                            .filter_map(|id| part_indices.get(id.as_str()).copied())
                            .collect();
                        Some((measure, parts))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let mut empty_measures = HashMap::new();
        for (part_index, part) in score.parts.iter().enumerate() {
            if !part.id.as_ref().is_some_and(|id| selected.contains(id)) {
                continue;
            }
            let count = score.global.measures.len();
            let events: Vec<Vec<&Event>> = part
                .measures
                .iter()
                .take(count)
                .map(|measure| {
                    let mut events = Vec::new();
                    for sequence in &measure.sequences {
                        collect_events(&sequence.content, &mut events);
                    }
                    events
                })
                .collect();
            let event_measures: HashMap<&str, usize> = events
                .iter()
                .enumerate()
                .flat_map(|(index, events)| {
                    events
                        .iter()
                        .filter_map(move |event| Some((event.id.as_deref()?, index)))
                })
                .collect();
            let mut empty: Vec<bool> = (0..count)
                .map(|index| {
                    part.measures
                        .get(index)
                        .is_none_or(|measure| unmarked_measure(measure, index))
                })
                .collect();
            for (start, measure) in part.measures.iter().enumerate().take(count) {
                let mut protect_span = |end: Option<usize>| {
                    let end = end.unwrap_or(count.saturating_sub(1));
                    if start <= end && start < count {
                        empty[start..=end.min(count - 1)].fill(false);
                    }
                };
                for dynamic in measure.dynamics.iter().flatten() {
                    if let Some(end) = &dynamic.end {
                        protect_span(measure_indices.get(end.measure.as_str()).copied());
                    }
                }
                for pedal in measure.pedals.iter().flatten() {
                    protect_span(measure_indices.get(pedal.end.measure.as_str()).copied());
                }
                for ottava in measure.ottavas.iter().flatten() {
                    protect_span(measure_indices.get(ottava.end.measure.as_str()).copied());
                }
                for event in &events[start] {
                    for slur in event.slurs.iter().flatten() {
                        protect_span(event_measures.get(slur.target.as_str()).copied());
                    }
                    for glissando in event.glissandos.iter().flatten() {
                        protect_span(event_measures.get(glissando.target.as_str()).copied());
                    }
                }
                if let Some(repeat) = &measure.measure_repeat {
                    let end = (start + repeat.number as usize).min(count);
                    empty[start..end].fill(false);
                }
            }
            empty_measures.insert(part_index, empty);
        }
        Self {
            empty_measures,
            keep_first_system,
            keep_visible,
        }
    }

    /// Prunes one system. Explicit keep-visible decisions and the first-system
    /// option exempt parts; staves already omitted by the layout stay omitted.
    pub(super) fn prune(
        &self,
        staves: &mut Vec<FlatStaff>,
        groups: &mut Vec<GroupRange>,
        range: Range<usize>,
        first_system: bool,
    ) {
        if first_system && self.keep_first_system {
            return;
        }
        let exempt: HashSet<usize> = self
            .keep_visible
            .iter()
            .filter(|(measure, _)| range.contains(measure))
            .flat_map(|(_, parts)| parts.iter().copied())
            .collect();
        let hidden: HashSet<usize> = self
            .empty_measures
            .iter()
            .filter(|(part, measures)| {
                !exempt.contains(part) && measures[range.clone()].iter().all(|empty| *empty)
            })
            .map(|(&part, _)| part)
            .collect();
        let mut keep: Vec<bool> = staves
            .iter()
            .map(|staff| {
                staff.sources.is_empty()
                    || staff
                        .sources
                        .iter()
                        .any(|source| !hidden.contains(&source.part_index))
            })
            .collect();
        // Standard engraving practice keeps an instrument to carry the silent system.
        // Retain all of its staves rather than leaving half a keyboard instrument.
        if !keep.iter().any(|keep| *keep) {
            if let Some(first) = staves.first() {
                let parts: HashSet<_> = first
                    .sources
                    .iter()
                    .map(|source| source.part_index)
                    .collect();
                for (index, staff) in staves.iter().enumerate() {
                    keep[index] = staff
                        .sources
                        .iter()
                        .any(|source| parts.contains(&source.part_index));
                }
            }
        }
        let mut next = 0;
        let indices: Vec<Option<usize>> = keep
            .iter()
            .map(|keep| {
                keep.then(|| {
                    let index = next;
                    next += 1;
                    index
                })
            })
            .collect();
        groups.retain_mut(|group| {
            let kept: Vec<_> = indices[group.first_staff..=group.last_staff]
                .iter()
                .flatten()
                .copied()
                .collect();
            let (Some(&first), Some(&last)) = (kept.first(), kept.last()) else {
                return false;
            };
            group.first_staff = first;
            group.last_staff = last;
            true
        });
        let mut index = 0;
        staves.retain(|_| {
            let retain = keep[index];
            index += 1;
            retain
        });
    }
}

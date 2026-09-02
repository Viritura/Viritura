use super::super::config::LayoutConfig;
use super::accidental_ink::ink_snapshot;
use super::collectors::{
    event_accidental_extent_sp_transposed, grace_padding_sp, notes_contain_second,
};
use super::timing::{sequence_timeline, BeatKey, SpacingEvent};
use crate::model::*;
use crate::render::smufl::smufl;
use std::collections::{BTreeSet, HashMap, HashSet};

pub(super) struct SpacingSnapshot<'a> {
    pub onsets: Vec<BeatKey>,
    pub grace_counts: HashMap<BeatKey, usize>,
    pub accidental_extents: HashMap<BeatKey, f64>,
    pub second_onsets: HashSet<BeatKey>,
    pub fermata_widths: HashMap<BeatKey, f64>,
    pub caesura_widths: HashMap<BeatKey, f64>,
    pub cross_staff_onsets: HashSet<BeatKey>,
    pub arpeggio_onsets: HashSet<BeatKey>,
    pub right_ink_extents: HashMap<BeatKey, f64>,
    pub accidental_ink_floors: HashMap<BeatKey, f64>,
    pub clustered_tie_gaps: HashSet<(BeatKey, BeatKey)>,
    pub staff_onsets: Vec<Vec<BeatKey>>,
    pub staff_events: Vec<Vec<SpacingEvent<'a>>>,
}

#[allow(clippy::too_many_arguments)] // snapshot construction receives the complete spacing context once
pub(super) fn build_spacing_snapshot<'a>(
    all_sequences: &[&'a [Sequence]],
    active_keys: &[&KeySignature],
    transpositions: &[Option<(i32, i32)>],
    clef_changes: &[Option<&[(f64, Clef)]>],
    beamed_event_ids: &[HashSet<String>],
    suppressed_note_ids: &[HashSet<String>],
    config: &LayoutConfig,
) -> SpacingSnapshot<'a> {
    let mut snapshot = SpacingSnapshot {
        onsets: Vec::new(),
        grace_counts: HashMap::new(),
        accidental_extents: HashMap::new(),
        second_onsets: HashSet::new(),
        fermata_widths: HashMap::new(),
        caesura_widths: HashMap::new(),
        cross_staff_onsets: HashSet::new(),
        arpeggio_onsets: HashSet::new(),
        right_ink_extents: HashMap::new(),
        accidental_ink_floors: HashMap::new(),
        clustered_tie_gaps: HashSet::new(),
        staff_onsets: Vec::with_capacity(all_sequences.len()),
        staff_events: Vec::with_capacity(all_sequences.len()),
    };
    let mut onset_set = BTreeSet::new();

    for (staff_index, sequences) in all_sequences.iter().enumerate() {
        let mut staff_events = Vec::new();
        let mut staff_onsets = BTreeSet::new();
        let mut measure_accidentals = HashMap::new();
        let default_key = KeySignature::default();
        let active_key = active_keys
            .get(staff_index)
            .copied()
            .unwrap_or(&default_key);
        let changes = clef_changes.get(staff_index).copied().flatten();
        let sequence_count = sequences.len();

        for (sequence_index, sequence) in sequences.iter().enumerate() {
            if sequence.full_measure.is_some() {
                continue;
            }
            let timeline = sequence_timeline(sequence, sequence_index, sequence_count);
            for (key, count) in timeline.grace_before {
                snapshot
                    .grace_counts
                    .entry(key)
                    .and_modify(|current| *current = (*current).max(count))
                    .or_insert(count);
            }
            for (key, count) in timeline.grace_after {
                let extent = 2.0 * config.notehead_rx + grace_padding_sp(count, config);
                max_entry(&mut snapshot.right_ink_extents, key, extent);
            }
            for source in timeline.events {
                onset_set.insert(source.key);
                staff_onsets.insert(source.key);
                collect_event_facts(
                    source,
                    active_key,
                    transpositions.get(staff_index).copied().flatten(),
                    changes,
                    suppressed_note_ids.get(staff_index),
                    config,
                    &mut measure_accidentals,
                    &mut snapshot,
                );
                staff_events.push(source);
            }
        }
        snapshot
            .staff_onsets
            .push(staff_onsets.into_iter().collect());
        snapshot.staff_events.push(staff_events);
    }

    snapshot.onsets = onset_set.into_iter().collect();
    snapshot.clustered_tie_gaps = clustered_tie_gaps(&snapshot.staff_events);
    let ink = ink_snapshot(
        &snapshot.staff_events,
        active_keys,
        transpositions,
        clef_changes,
        beamed_event_ids,
        suppressed_note_ids,
        &snapshot.onsets,
        config,
    );
    snapshot.accidental_ink_floors = ink.accidental_gap_floors;
    for (key, extent) in ink.accidental_extents {
        max_entry(&mut snapshot.accidental_extents, key, extent);
    }
    for (key, right) in ink.right_extents {
        max_entry(&mut snapshot.right_ink_extents, key, right);
    }
    snapshot
}

#[allow(clippy::too_many_arguments)] // each output is a field of the single immutable snapshot
fn collect_event_facts(
    source: SpacingEvent<'_>,
    active_key: &KeySignature,
    transposition: Option<(i32, i32)>,
    clef_changes: Option<&[(f64, Clef)]>,
    suppressed_note_ids: Option<&HashSet<String>>,
    config: &LayoutConfig,
    measure_accidentals: &mut HashMap<(String, i32), i32>,
    snapshot: &mut SpacingSnapshot<'_>,
) {
    let event = source.event;
    if let Some(notes) = &event.notes {
        if notes_contain_second(notes) {
            snapshot.second_onsets.insert(source.key);
        }
        let clef = clef_changes
            .filter(|changes| !changes.is_empty())
            .map(|changes| super::super::resolve::active_clef_at_beat(changes, source.key.beats()));
        let extent = event_accidental_extent_sp_transposed(
            notes,
            active_key,
            transposition,
            measure_accidentals,
            clef,
            config.ledger_extension,
            suppressed_note_ids,
        );
        if extent > 0.0 {
            max_entry(&mut snapshot.accidental_extents, source.key, extent);
        }
    }
    if event
        .staff
        .is_some_and(|staff| staff != source.sequence_staff)
    {
        snapshot.cross_staff_onsets.insert(source.key);
    }
    if event
        .markings
        .as_ref()
        .and_then(|markings| markings.arpeggio.as_ref())
        .is_some()
        && event.notes().len() >= 2
    {
        snapshot.arpeggio_onsets.insert(source.key);
    }
    if let Some(fermata) = &event.fermata {
        let symbol = fermata
            .symbol
            .as_ref()
            .unwrap_or(&crate::model::FermataSymbol::Normal);
        let (above, below) = smufl::fermata_glyph(symbol);
        max_entry(
            &mut snapshot.fermata_widths,
            source.key,
            smufl::glyph_bbox(above).2.max(smufl::glyph_bbox(below).2),
        );
    }
    if let Some(caesura) = event
        .markings
        .as_ref()
        .and_then(|markings| markings.caesura.as_ref())
    {
        max_entry(
            &mut snapshot.caesura_widths,
            source.key,
            smufl::glyph_bbox(smufl::caesura_glyph(&caesura.style)).2,
        );
    }
    if event.is_rest() {
        max_entry(
            &mut snapshot.right_ink_extents,
            source.key,
            rest_right_extent(event),
        );
    }
}

fn rest_right_extent(event: &Event) -> f64 {
    let codepoint = smufl::rest_glyph(&event.duration.base);
    let (bbox_x, _, bbox_width, _) = smufl::glyph_bbox(codepoint);
    let mut right = bbox_x + bbox_width + 0.2;
    if let Some(dots) = event.duration.dots.filter(|dots| *dots > 0) {
        right += 0.4
            + f64::from(dots.saturating_sub(1)) * 0.5
            + smufl::glyph_bbox(smufl::AUGMENTATION_DOT).2;
    }
    right
}

fn max_entry(map: &mut HashMap<BeatKey, f64>, key: BeatKey, value: f64) {
    map.entry(key)
        .and_modify(|current| *current = current.max(value))
        .or_insert(value);
}

fn clustered_tie_gaps(staff_events: &[Vec<SpacingEvent<'_>>]) -> HashSet<(BeatKey, BeatKey)> {
    let mut note_onsets = HashMap::new();
    for event in staff_events.iter().flatten() {
        for note in event.event.notes() {
            if let Some(id) = note.id.as_deref() {
                note_onsets.insert(id, event.key);
            }
        }
    }
    let mut counts = HashMap::new();
    for source in staff_events.iter().flatten() {
        for note in source.event.notes() {
            for tie in note.ties.iter().flatten() {
                if tie.lv == Some(true) {
                    continue;
                }
                let Some(target) = tie
                    .target
                    .as_deref()
                    .and_then(|id| note_onsets.get(id))
                    .copied()
                else {
                    continue;
                };
                if target > source.key {
                    *counts.entry((source.key, target)).or_insert(0) += 1;
                }
            }
        }
    }
    counts
        .into_iter()
        .filter_map(|(pair, count)| (count >= 2).then_some(pair))
        .collect()
}

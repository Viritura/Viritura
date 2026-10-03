//! Instrument-change state and directions shared by every layout path.
//!
//! Intervals follow native MNX semantics: sounding + interval = written.
//! Bar-start changes affect the whole measure and all following measures.
//! The model can resolve other fractions exactly, but promotion explicitly
//! rejects nonzero change positions: engraving has one key/interval per bar.

use crate::model::*;
use std::hash::{Hash, Hasher};

pub(super) fn state_salt(score: &Score, staves: &[super::full_score::FlatStaff], salt: u64) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    salt.hash(&mut hasher);
    for source in staves.iter().flat_map(|staff| &staff.sources) {
        let part = &score.parts[source.part_index];
        serde_json::to_string(&part.instrument_extensions)
            .unwrap_or_default()
            .hash(&mut hasher);
        serde_json::to_string(&part.transposition)
            .unwrap_or_default()
            .hash(&mut hasher);
        for measure in &part.measures {
            serde_json::to_string(&measure.instrument_changes)
                .unwrap_or_default()
                .hash(&mut hasher);
        }
    }
    hasher.finish()
}

pub(super) fn append_instructions(
    measure: &mut PartMeasure,
    part: &Part,
    measure_index: usize,
    source_part_index: usize,
) {
    let Some(authored) = part.measures.get(measure_index) else {
        return;
    };
    for change in ordered_instrument_changes(authored) {
        if change
            .instruction
            .as_ref()
            .is_some_and(|instruction| instruction.hidden == Some(true))
        {
            continue;
        }
        let text = change
            .instruction
            .as_ref()
            .and_then(|instruction| instruction.text.clone())
            .unwrap_or_else(|| {
                let state = ActiveInstrument::at(part, measure_index, change.fraction());
                if change.instrument.is_some() {
                    let name = state
                        .definition
                        .and_then(|instrument| instrument.name.as_deref())
                        .unwrap_or(&part.name);
                    format!("To {name}")
                } else {
                    state
                        .transposition
                        .and_then(|t| super::page::transposition_key_name(t.interval.half_steps))
                        .map_or_else(|| "in C".to_string(), |key| format!("in {key}"))
                }
            });
        if text.is_empty() {
            continue;
        }
        measure
            .expressions
            .get_or_insert_with(Vec::new)
            .push(TextExpression {
                text: text.into(),
                position: change
                    .position
                    .clone()
                    .unwrap_or(RhythmicPosition { fraction: (0, 1) }),
                placement: Some(ExpressionPlacement::Above),
                staff: Some(1),
                voice: None,
                source_part_index: Some(source_part_index),
                source_expression_index: None,
                manual_offset: None,
                avoid_collisions: None,
            });
    }
}

/// A common staff must have a common written signature and interval.
/// Separate incompatible sources instead of transposing all of them as source 1.
pub(super) fn sources_need_separate_staves(
    staff: &super::full_score::FlatStaff,
    score: &Score,
) -> bool {
    let Some(first) = staff.sources.first() else {
        return false;
    };
    if staff.sources.len() < 2 {
        return false;
    }
    // Native static-transposition layouts retain their authored shared staff
    // and single harmony lane. Only provisional instrument state introduces
    // the new requirement to separate incompatible source timelines.
    let has_instrument_state = staff.sources.iter().any(|source| {
        let part = &score.parts[source.part_index];
        part.instrument_extensions.initial_instrument.is_some()
            || !part.instrument_extensions.instruments.is_empty()
            || part.measures.iter().any(|measure| {
                measure
                    .instrument_changes
                    .as_ref()
                    .is_some_and(|changes| !changes.is_empty())
            })
    });
    if !has_instrument_state {
        return false;
    }
    let count = score.global.measures.len();
    (0..count).any(|index| {
        let first = ActiveInstrument::at(&score.parts[first.part_index], index, (0, 1));
        staff.sources.iter().skip(1).any(|source| {
            let other = ActiveInstrument::at(&score.parts[source.part_index], index, (0, 1));
            first.transposition != other.transposition || first.definition != other.definition
        })
    })
}

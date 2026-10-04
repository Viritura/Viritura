//! Instrument-change state and directions shared by every layout path.
//!
//! Intervals follow native MNX semantics: sounding + interval = written.
//! Bar-start changes affect the whole measure and all following measures.
//! The model can resolve other fractions exactly, but promotion explicitly
//! rejects nonzero change positions: engraving has one key/interval per bar.

use crate::model::*;
use std::hash::{Hash, Hasher};

mod reminders;

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
        if part.measures.iter().any(|measure| {
            measure
                .instrument_changes
                .iter()
                .flatten()
                .any(|change| change.reminder.is_some())
        }) {
            serde_json::to_string(&part.measures)
                .unwrap_or_default()
                .hash(&mut hasher);
            serde_json::to_string(&score.global.measures)
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
    score: &Score,
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
            .unwrap_or_else(|| derived_instruction(part, measure_index, change));
        append_expression(
            measure,
            text,
            change
                .position
                .clone()
                .unwrap_or(RhythmicPosition { fraction: (0, 1) }),
            source_part_index,
            false,
        );
    }
    for (change_index, authored) in part.measures.iter().enumerate() {
        for change in ordered_instrument_changes(authored) {
            let Some(reminder) = change.reminder.as_ref().filter(|r| r.hidden != Some(true)) else {
                continue;
            };
            let Some((anchor_index, position, staff)) =
                reminders::anchor(score, part, change_index, change)
            else {
                continue;
            };
            if anchor_index == measure_index {
                let text = reminder
                    .text
                    .clone()
                    .unwrap_or_else(|| derived_instruction(part, change_index, change));
                if !text.is_empty() {
                    append_expression(measure, text, position, source_part_index, true);
                    if let Some(expression) =
                        measure.expressions.as_mut().and_then(|e| e.last_mut())
                    {
                        expression.staff = Some(staff);
                    }
                }
            }
        }
    }
    if measure_index == 0 {
        if let Some(text) = super::page::initial_instrument_instruction(part) {
            append_expression(
                measure,
                text,
                RhythmicPosition { fraction: (0, 1) },
                source_part_index,
                false,
            );
        }
    }
}

fn append_expression(
    measure: &mut PartMeasure,
    text: String,
    position: RhythmicPosition,
    source_part_index: usize,
    instrument_reminder: bool,
) {
    if !text.is_empty() {
        measure
            .expressions
            .get_or_insert_with(Vec::new)
            .push(TextExpression {
                text: text.into(),
                position,
                placement: Some(ExpressionPlacement::Above),
                staff: Some(1),
                voice: None,
                source_part_index: Some(source_part_index),
                source_expression_index: None,
                instrument_reminder,
                manual_offset: None,
                avoid_collisions: None,
            });
    }
}

fn derived_instruction(part: &Part, measure_index: usize, change: &InstrumentChange) -> String {
    let state = ActiveInstrument::at(part, measure_index, change.fraction());
    if change.instrument.is_some() {
        let name = state
            .definition
            .and_then(|instrument| instrument.name.as_deref())
            .unwrap_or(&part.name);
        return format!("To {name}");
    }
    let Some(transposition) = state.transposition else {
        return "in C".to_string();
    };
    let interval = &transposition.interval;
    let diatonic = -i64::from(interval.staff_distance);
    let chromatic = -i64::from(interval.half_steps);
    let letter = diatonic.rem_euclid(7) as usize;
    let natural = [0, 2, 4, 5, 7, 9, 11][letter] + 12 * diatonic.div_euclid(7);
    let accidental = chromatic - natural;
    let suffix = match accidental {
        -2 => "𝄫",
        -1 => "♭",
        0 => "",
        1 => "♯",
        2 => "𝄪",
        _ => {
            return super::page::transposition_key_name(interval.half_steps.rem_euclid(12))
                .map_or_else(|| "in C".to_string(), |key| format!("in {key}"))
        }
    };
    let pitch = ["C", "D", "E", "F", "G", "A", "B"][letter];
    if chromatic != 0 && chromatic.rem_euclid(12) == 0 {
        return format!(
            "sounds {pitch}{suffix}{} for written C4",
            4 + diatonic.div_euclid(7)
        );
    }
    format!("in {pitch}{suffix}")
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

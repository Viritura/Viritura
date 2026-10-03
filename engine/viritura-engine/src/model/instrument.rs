//! Provisional instrument identities and sounding-to-written changes.

use super::{RhythmicPosition, Transposition};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstrumentDefinition {
    pub instrument_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transposition: Option<Transposition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub midi_program: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PartInstrumentExtensions {
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub instruments: HashMap<String, InstrumentDefinition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_instrument: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstrumentChangeInstruction {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstrumentChange {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<RhythmicPosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrument: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transposition: Option<Transposition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instruction: Option<InstrumentChangeInstruction>,
}

impl InstrumentChange {
    pub(crate) fn fraction(&self) -> (u32, u32) {
        self.position.as_ref().map_or((0, 1), |p| p.fraction)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct ActiveInstrument<'a> {
    pub definition: Option<&'a InstrumentDefinition>,
    pub transposition: Option<&'a Transposition>,
}

impl<'a> ActiveInstrument<'a> {
    pub(crate) fn initial(part: &'a super::Part) -> Self {
        let definition = part
            .instrument_extensions
            .initial_instrument
            .as_ref()
            .and_then(|key| part.instrument_extensions.instruments.get(key));
        Self {
            definition,
            transposition: part
                .transposition
                .as_ref()
                .or_else(|| definition.and_then(|instrument| instrument.transposition.as_ref())),
        }
    }

    pub(crate) fn apply(&mut self, part: &'a super::Part, change: &'a InstrumentChange) {
        if let Some(key) = &change.instrument {
            self.definition = part.instrument_extensions.instruments.get(key);
            self.transposition = change.transposition.as_ref().or_else(|| {
                self.definition
                    .and_then(|instrument| instrument.transposition.as_ref())
            });
        } else if let Some(transposition) = &change.transposition {
            self.transposition = Some(transposition);
        }
    }

    pub(crate) fn at(part: &'a super::Part, index: usize, fraction: (u32, u32)) -> Self {
        let mut state = Self::initial(part);
        for (mi, measure) in part.measures.iter().enumerate().take(index + 1) {
            for change in ordered_instrument_changes(measure) {
                let position = change.fraction();
                if mi < index
                    || u64::from(position.0) * u64::from(fraction.1)
                        <= u64::from(fraction.0) * u64::from(position.1)
                {
                    state.apply(part, change);
                }
            }
        }
        state
    }

    pub(crate) fn display_transposition(
        self,
        use_written: bool,
    ) -> (Option<(i32, i32)>, Option<i32>) {
        let transposition = self
            .transposition
            .filter(|t| use_written || t.prefers_written_pitches.unwrap_or(false));
        (
            transposition.map(|t| (t.interval.staff_distance, t.interval.half_steps)),
            transposition.and_then(|t| t.key_fifths_flip_at),
        )
    }
}

pub(crate) fn ordered_instrument_changes(measure: &super::PartMeasure) -> Vec<&InstrumentChange> {
    let mut changes: Vec<_> = measure.instrument_changes.iter().flatten().collect();
    changes.sort_by(|a, b| {
        let (an, ad) = a.fraction();
        let (bn, bd) = b.fraction();
        (u64::from(an) * u64::from(bd)).cmp(&(u64::from(bn) * u64::from(ad)))
    });
    changes
}

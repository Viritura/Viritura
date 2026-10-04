//! Instrument identities and automatic player numbering at system boundaries.

use super::{abbreviate_part_name, build_display_name, transposition_key_name};
use crate::model::Part;
use std::collections::HashMap;

mod required_states;
pub(crate) use required_states::initial_instruction as initial_instrument_instruction;

/// Resolved display info for a part.
pub(crate) struct PartDisplayInfo {
    pub display_name: String,
    pub display_short_name: String,
    /// Name without the auto-number suffix (e.g. "Flute" instead of "Flute 1").
    pub base_name: String,
    /// Short name without the auto-number suffix.
    pub base_short_name: String,
    /// Auto-assigned number within the instrument group (None if only one of its kind).
    pub number: Option<usize>,
}

/// Resolve display names for all parts with auto-transposition and auto-numbering.
/// Groups parts by (name, transposition_key) and numbers duplicates within each group.
pub(crate) fn resolve_part_display_names(parts: &[Part]) -> Vec<PartDisplayInfo> {
    resolve_part_display_names_at(parts, 0)
}

pub(crate) fn resolve_part_display_names_at(
    parts: &[Part],
    measure_index: usize,
) -> Vec<PartDisplayInfo> {
    let active_names = |p: &Part| {
        let required = required_states::names(p);
        if required.len() > 1 {
            return (
                required
                    .iter()
                    .map(|name| name.full.as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
                Some(
                    required
                        .iter()
                        .map(|name| name.short.as_str())
                        .collect::<Vec<_>>()
                        .join("\n"),
                ),
                None,
            );
        }
        let state = crate::model::ActiveInstrument::at(p, measure_index, (0, 1));
        let half_steps = state.transposition.map(|t| t.interval.half_steps);
        let default_half_steps = state
            .definition
            .and_then(|instrument| instrument.transposition.as_ref())
            .or(p.transposition.as_ref())
            .map(|t| t.interval.half_steps);
        let active_name = |name: String| {
            let old_key = default_half_steps.and_then(transposition_key_name);
            if old_key != half_steps.and_then(transposition_key_name) {
                if let Some(key) = old_key {
                    return name.replace(&format!(" in {key}"), "");
                }
            }
            name
        };
        (
            active_name(
                state
                    .definition
                    .and_then(|d| d.name.clone())
                    .unwrap_or_else(|| p.name.clone()),
            ),
            state
                .definition
                .and_then(|d| d.short_name.clone())
                .or_else(|| p.short_name.clone())
                .map(active_name),
            half_steps,
        )
    };
    // Group key = (name, transposition key or "")
    let group_key = |p: &Part| -> (String, String) {
        let (name, _, hs) = active_names(p);
        let key = hs.and_then(transposition_key_name).unwrap_or("");
        (name, key.to_string())
    };

    // Count occurrences per group
    let mut counts: HashMap<(String, String), usize> = HashMap::new();
    for p in parts {
        *counts.entry(group_key(p)).or_insert(0) += 1;
    }

    // Assign numbers
    let mut indices: HashMap<(String, String), usize> = HashMap::new();
    parts
        .iter()
        .map(|p| {
            let key = group_key(p);
            let (name, short_name, hs) = active_names(p);
            let total = counts.get(&key).copied().unwrap_or(1);
            let number = if total > 1 {
                let idx = indices.entry(key).or_insert(0);
                *idx += 1;
                Some(*idx)
            } else {
                None
            };
            let base_name_str = build_display_name(&name, hs, None);
            let short_base = short_name.unwrap_or_else(|| abbreviate_part_name(&name));
            let base_short_name_str = build_display_name(&short_base, hs, None);
            let numbered = |label: &str| {
                label
                    .split('\n')
                    .map(|line| build_display_name(line, hs, number))
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            let display_name = numbered(&name);
            let display_short_name = numbered(&short_base);
            PartDisplayInfo {
                display_name,
                display_short_name,
                base_name: base_name_str,
                base_short_name: base_short_name_str,
                number,
            }
        })
        .collect()
}

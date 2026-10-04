//! Resolve instrument labels at an absolute measure, independent of pagination.

use super::super::super::full_score::FlatStaff;
use super::super::super::page::{resolve_part_display_names, resolve_part_display_names_at};
use crate::model::Score;

pub(in crate::layout::mnx_layout) fn staves_at(
    staves: &[FlatStaff],
    score: &Score,
    measure_index: usize,
) -> Vec<FlatStaff> {
    let initial = resolve_part_display_names(&score.parts);
    let active = resolve_part_display_names_at(&score.parts, measure_index);
    staves
        .iter()
        .map(|staff| {
            let mut result = staff.clone();
            let Some(source) = staff.sources.first() else {
                return result;
            };
            let old = &initial[source.part_index];
            let new = &active[source.part_index];
            let (full, short) = if staff.is_condensing() {
                (&new.base_name, &new.base_short_name)
            } else {
                (&new.display_name, &new.display_short_name)
            };
            if staff
                .label
                .as_ref()
                .is_some_and(|label| label == &old.display_name || label == &old.base_name)
            {
                result.label = Some(full.clone());
            } else if staff.label.as_ref().is_some_and(|label| {
                label == &old.display_short_name || label == &old.base_short_name
            }) {
                result.label = Some(short.clone());
            }
            if staff.short_label.as_ref().is_some_and(|label| {
                label == &old.display_short_name || label == &old.base_short_name
            }) {
                result.short_label = Some(short.clone());
            }
            if staff
                .resolved_full_label
                .as_ref()
                .is_some_and(|label| label == &old.display_name || label == &old.base_name)
            {
                result.resolved_full_label = Some(full.clone());
            }
            if staff.resolved_short_label.as_ref().is_some_and(|label| {
                label == &old.display_short_name || label == &old.base_short_name
            }) {
                result.resolved_short_label = Some(short.clone());
            }
            result
        })
        .collect()
}

pub(in crate::layout::mnx_layout) fn variants(
    staves: &[FlatStaff],
    score: &Score,
) -> Vec<FlatStaff> {
    let mut indices = vec![0];
    for source in staves.iter().flat_map(|staff| &staff.sources) {
        for (index, measure) in score.parts[source.part_index].measures.iter().enumerate() {
            if measure.instrument_changes.is_some() {
                indices.push(index);
                if index + 1 < score.global.measures.len() {
                    indices.push(index + 1);
                }
            }
        }
    }
    indices.sort_unstable();
    indices.dedup();
    indices
        .into_iter()
        .flat_map(|index| staves_at(staves, score, index))
        .collect()
}

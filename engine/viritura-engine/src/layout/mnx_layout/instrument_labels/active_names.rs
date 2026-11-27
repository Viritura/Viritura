//! Resolve instrument labels at an absolute measure, independent of pagination.

use super::super::super::full_score::{FlatLabel, FlatStaff, GroupRange};
use super::super::super::page::{resolve_part_display_names_at, PartDisplayInfo};
use crate::model::Score;
use crate::raw::LabelRefType;
use std::hash::{Hash, Hasher};

pub(in crate::layout::mnx_layout) struct ResolvedLabels {
    pub first: Option<String>,
    pub subsequent: Option<String>,
    pub full: Option<String>,
    pub short: Option<String>,
}

pub(in crate::layout::mnx_layout) fn resolve_components(
    components: &[FlatLabel],
    names: &[PartDisplayInfo],
) -> ResolvedLabels {
    let mut first = Vec::new();
    let mut subsequent = Vec::new();
    let mut full = Vec::new();
    let mut short = Vec::new();
    for component in components {
        match component {
            FlatLabel::Literal(text) => {
                first.push(text.as_str());
                subsequent.push(text.as_str());
                full.push(text.as_str());
                short.push(text.as_str());
            }
            FlatLabel::Part {
                part_index,
                reference,
                base_name,
            } => {
                let display = &names[*part_index];
                let (name, abbreviation) = if *base_name {
                    (&display.base_name, &display.base_short_name)
                } else {
                    (&display.display_name, &display.display_short_name)
                };
                full.push(name.as_str());
                short.push(abbreviation.as_str());
                match reference {
                    Some(LabelRefType::Auto) => {
                        first.push(name.as_str());
                        subsequent.push(abbreviation.as_str());
                    }
                    Some(LabelRefType::Name) => {
                        first.push(name.as_str());
                        subsequent.push(name.as_str());
                    }
                    Some(LabelRefType::ShortName) => {
                        first.push(abbreviation.as_str());
                        subsequent.push(abbreviation.as_str());
                    }
                    None => {}
                }
            }
        }
    }
    let joined = |lines: Vec<&str>| (!lines.is_empty()).then(|| lines.join("\n"));
    ResolvedLabels {
        first: joined(first),
        subsequent: joined(subsequent),
        full: joined(full),
        short: joined(short),
    }
}

pub(in crate::layout::mnx_layout) fn staves_at(
    staves: &[FlatStaff],
    score: &Score,
    measure_index: usize,
) -> Vec<FlatStaff> {
    let active = resolve_part_display_names_at(&score.parts, measure_index);
    staves
        .iter()
        .map(|staff| {
            let mut result = staff.clone();
            let labels = resolve_components(&staff.label_components, &active);
            result.label = labels.first;
            result.short_label = labels.subsequent;
            result.resolved_full_label = labels.full;
            result.resolved_short_label = labels.short;
            result
        })
        .collect()
}

pub(in crate::layout::mnx_layout) fn groups_at(
    groups: &[GroupRange],
    score: &Score,
    measure_index: usize,
) -> Vec<GroupRange> {
    let names = resolve_part_display_names_at(&score.parts, measure_index);
    groups
        .iter()
        .map(|group| {
            let mut result = group.clone();
            let labels = resolve_components(&group.label_components, &names);
            result.label = labels.first;
            result.short_label = labels.subsequent;
            result.resolved_full_label = labels.full;
            result.resolved_short_label = labels.short;
            result
        })
        .collect()
}

pub(in crate::layout::mnx_layout) fn change_indices(score: &Score) -> Vec<usize> {
    let mut indices = vec![0];
    for part in &score.parts {
        for (index, measure) in part.measures.iter().enumerate() {
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
}

pub(in crate::layout::mnx_layout) fn variants(
    staves: &[FlatStaff],
    score: &Score,
) -> Vec<FlatStaff> {
    change_indices(score)
        .into_iter()
        .flat_map(|index| staves_at(staves, score, index))
        .collect()
}

pub(in crate::layout::mnx_layout) fn group_variants(
    groups: &[GroupRange],
    score: &Score,
) -> Vec<GroupRange> {
    change_indices(score)
        .into_iter()
        .flat_map(|index| groups_at(groups, score, index))
        .collect()
}

pub(in crate::layout::mnx_layout) fn dependency_salt(
    score: &Score,
    staves: &[FlatStaff],
    groups: &[GroupRange],
    salt: u64,
) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    salt.hash(&mut hasher);
    for staff in variants(staves, score) {
        staff.label.hash(&mut hasher);
        staff.short_label.hash(&mut hasher);
        staff.resolved_full_label.hash(&mut hasher);
        staff.resolved_short_label.hash(&mut hasher);
    }
    for group in group_variants(groups, score) {
        group.label.hash(&mut hasher);
        group.short_label.hash(&mut hasher);
        group.resolved_full_label.hash(&mut hasher);
        group.resolved_short_label.hash(&mut hasher);
    }
    hasher.finish()
}

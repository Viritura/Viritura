use super::super::full_score::{FlatLabel, FlatSource, FlatStaff, GroupRange};
use super::super::page::{resolve_part_display_names, PartDisplayInfo};
use crate::model::{LayoutContent, Score};
use std::collections::{HashMap, HashSet};

pub(super) fn build_part_id_map(score: &Score) -> HashMap<String, usize> {
    score
        .parts
        .iter()
        .enumerate()
        .filter_map(|(index, part)| part.id.clone().map(|id| (id, index)))
        .collect()
}

pub(super) fn build_measure_id_map(score: &Score) -> HashMap<String, usize> {
    score
        .global
        .measures
        .iter()
        .enumerate()
        .filter_map(|(index, measure)| measure.id.clone().map(|id| (id, index)))
        .collect()
}

/// Compute the written-pitch transposition for a flat staff's primary part.
pub(super) fn compute_flat_staff_transposition(
    flat_staff: &FlatStaff,
    score: &Score,
    use_written: bool,
) -> (Option<(i32, i32)>, Option<i32>) {
    flat_staff_transposition_at(flat_staff, score, use_written, 0)
}

pub(super) fn flat_staff_transposition_at(
    flat_staff: &FlatStaff,
    score: &Score,
    use_written: bool,
    measure_index: usize,
) -> (Option<(i32, i32)>, Option<i32>) {
    let Some(source) = flat_staff.sources.first() else {
        return (None, None);
    };
    let part = &score.parts[source.part_index];
    crate::model::ActiveInstrument::at(part, measure_index, (0, 1))
        .display_transposition(use_written)
}

/// Flatten a layout-content tree into renderable staves and group ranges.
pub(super) fn flatten_layout(
    content: &[LayoutContent],
    part_id_map: &HashMap<String, usize>,
    score: &Score,
) -> (Vec<FlatStaff>, Vec<GroupRange>) {
    flatten_layout_for_measures(content, part_id_map, score, 0..score.global.measures.len())
}

pub(super) fn flatten_layout_for_measures(
    content: &[LayoutContent],
    part_id_map: &HashMap<String, usize>,
    score: &Score,
    measures: std::ops::Range<usize>,
) -> (Vec<FlatStaff>, Vec<GroupRange>) {
    let display_names = resolve_part_display_names(&score.parts);
    let mut staves = Vec::new();
    let mut groups = Vec::new();
    flatten_content_recursive(
        content,
        part_id_map,
        &display_names,
        score,
        &mut staves,
        &mut groups,
        0,
        &measures,
    );
    resolve_chord_symbol_sources(&mut staves, score);
    (staves, groups)
}

fn flatten_content_recursive(
    content: &[LayoutContent],
    part_id_map: &HashMap<String, usize>,
    display_names: &[PartDisplayInfo],
    score: &Score,
    staves: &mut Vec<FlatStaff>,
    groups: &mut Vec<GroupRange>,
    bracket_depth: usize,
    measures: &std::ops::Range<usize>,
) {
    for item in content {
        match item {
            LayoutContent::Group(group) => {
                let first_staff = staves.len();
                let child_depth = if matches!(group.symbol.as_deref(), Some("bracket" | "square")) {
                    bracket_depth + 1
                } else {
                    bracket_depth
                };
                flatten_content_recursive(
                    &group.content,
                    part_id_map,
                    display_names,
                    score,
                    staves,
                    groups,
                    child_depth,
                    measures,
                );
                if staves.len() == first_staff {
                    continue;
                }
                if group.symbol.is_some() || group.label.is_some() || group.label_ref.is_some() {
                    let mut source_parts: Vec<_> = staves[first_staff..]
                        .iter()
                        .flat_map(|staff| &staff.sources)
                        .map(|source| source.part_index)
                        .collect();
                    source_parts.sort_unstable();
                    source_parts.dedup();
                    let default_part = staves[first_staff]
                        .sources
                        .first()
                        .map(|source| source.part_index);
                    let label_components = label_components(
                        group.label.as_deref(),
                        group.label_ref.as_ref(),
                        default_part,
                        false,
                        part_id_map,
                    );
                    let labels = super::instrument_labels::resolve_components(
                        &label_components,
                        display_names,
                    );
                    groups.push(GroupRange {
                        first_staff,
                        last_staff: staves.len() - 1,
                        symbol: group.symbol.clone().unwrap_or_else(|| "noSymbol".into()),
                        label: labels.first,
                        short_label: labels.subsequent,
                        resolved_full_label: labels.full,
                        resolved_short_label: labels.short,
                        label_components,
                        depth: bracket_depth,
                        source_parts,
                    });
                }
            }
            LayoutContent::Staff(staff) => {
                let sources = staff
                    .sources
                    .iter()
                    .filter_map(|source| {
                        part_id_map.get(&source.part).map(|&part_index| FlatSource {
                            part_index,
                            staff_number: source.staff,
                            voice_filter: source.voice.clone(),
                            stem_direction: source.stem.clone(),
                        })
                    })
                    .collect();
                let (label_components, condensed_numbers) =
                    staff_labels(staff, part_id_map, display_names);
                let labels =
                    super::instrument_labels::resolve_components(&label_components, display_names);
                let flat_staff = FlatStaff {
                    sources,
                    label: labels.first,
                    short_label: labels.subsequent,
                    resolved_full_label: labels.full,
                    resolved_short_label: labels.short,
                    label_components,
                    expansion: staff.expansion,
                    condensed_numbers,
                    chord_symbol_source: None,
                    chord_symbol_transposition: None,
                };
                if sources_cover_distinct_staves_of_one_part(&flat_staff)
                    || super::resolve_condensing::has_incompatible_staff_meters(&flat_staff, score)
                    || super::super::instrument_changes::sources_need_separate_staves(
                        &flat_staff,
                        score,
                        measures.clone(),
                    )
                {
                    for (source_index, source) in flat_staff.sources.iter().cloned().enumerate() {
                        let mut split_staff = flat_staff.clone();
                        split_staff.sources = vec![source];
                        if let Some(original_source) = staff
                            .sources
                            .iter()
                            .filter(|source| part_id_map.contains_key(&source.part))
                            .nth(source_index)
                        {
                            let mut split_layout_staff = staff.clone();
                            split_layout_staff.sources = vec![original_source.clone()];
                            let (components, _) =
                                staff_labels(&split_layout_staff, part_id_map, display_names);
                            let labels = super::instrument_labels::resolve_components(
                                &components,
                                display_names,
                            );
                            split_staff.label = labels.first;
                            split_staff.short_label = labels.subsequent;
                            split_staff.resolved_full_label = labels.full;
                            split_staff.resolved_short_label = labels.short;
                            split_staff.label_components = components;
                        }
                        split_staff.condensed_numbers = flat_staff
                            .condensed_numbers
                            .get(source_index)
                            .copied()
                            .into_iter()
                            .collect();
                        staves.push(split_staff);
                    }
                } else {
                    staves.push(flat_staff);
                }
            }
        }
    }
}

fn sources_cover_distinct_staves_of_one_part(staff: &FlatStaff) -> bool {
    staff.sources.iter().enumerate().any(|(index, source)| {
        staff.sources[..index].iter().any(|previous| {
            previous.part_index == source.part_index
                && previous.staff_number.unwrap_or(1) != source.staff_number.unwrap_or(1)
        })
    })
}

pub(super) fn resolve_chord_symbol_sources(staves: &mut [FlatStaff], score: &Score) {
    let mut seen_parts = HashSet::new();
    for staff in staves {
        staff.chord_symbol_source = None;
        for source in &staff.sources {
            let first_staff = seen_parts.insert(source.part_index);
            if first_staff
                && score.parts[source.part_index].shows_chord_symbols()
                && staff.chord_symbol_source.is_none()
            {
                staff.chord_symbol_source = Some(source.part_index);
            }
        }
    }
}

fn label_components(
    label: Option<&str>,
    reference: Option<&crate::model::layout::LayoutLabelRef>,
    default_part: Option<usize>,
    base_name: bool,
    part_id_map: &HashMap<String, usize>,
) -> Vec<FlatLabel> {
    let mut components = Vec::new();
    if let Some(label) = label {
        components.push(FlatLabel::Literal(label.to_string()));
    }
    if let Some(reference) = reference {
        let part_index = match reference.target.as_deref() {
            Some(target) => part_id_map.get(target).copied(),
            None => default_part,
        };
        if let Some(part_index) = part_index {
            components.push(FlatLabel::Part {
                part_index,
                reference: Some(
                    reference
                        .reference
                        .unwrap_or(crate::raw::LabelRefType::Auto),
                ),
                base_name,
            });
        }
    }
    components
}

fn staff_labels(
    staff: &crate::model::LayoutStaff,
    part_id_map: &HashMap<String, usize>,
    display_names: &[PartDisplayInfo],
) -> (Vec<FlatLabel>, Vec<u32>) {
    let default_part = staff
        .sources
        .first()
        .and_then(|source| part_id_map.get(&source.part))
        .copied();
    let source_labels = staff
        .sources
        .iter()
        .flat_map(|source| {
            label_components(
                source.label.as_deref(),
                source.label_ref.as_ref(),
                part_id_map.get(&source.part).copied(),
                false,
                part_id_map,
            )
        })
        .collect::<Vec<_>>();
    let condensed = staff.is_condensing()
        && source_labels.is_empty()
        && staff
            .label_ref
            .as_ref()
            .is_none_or(|reference| reference.target.is_none());
    let mut components = label_components(
        staff.label.as_deref(),
        staff.label_ref.as_ref(),
        default_part,
        condensed,
        part_id_map,
    );
    components.extend(source_labels);
    if components.is_empty() {
        if let Some(part_index) = default_part {
            components.push(FlatLabel::Part {
                part_index,
                reference: None,
                base_name: condensed,
            });
        }
    }
    let numbers = if condensed {
        staff
            .sources
            .iter()
            .filter_map(|source| part_id_map.get(&source.part))
            .filter_map(|&index| display_names[index].number.map(|number| number as u32))
            .collect()
    } else {
        Vec::new()
    };
    (components, numbers)
}

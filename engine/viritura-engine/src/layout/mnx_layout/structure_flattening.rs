use super::super::full_score::{FlatSource, FlatStaff, GroupRange};
use super::super::page::{resolve_part_display_names, PartDisplayInfo};
use crate::model::{LayoutContent, Score};
use std::collections::HashMap;

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
    let Some(source) = flat_staff.sources.first() else {
        return (None, None);
    };
    let part = &score.parts[source.part_index];
    let prefers_written = part
        .transposition
        .as_ref()
        .and_then(|transposition| transposition.prefers_written_pitches)
        .unwrap_or(false);
    if !(use_written || prefers_written) {
        return (None, None);
    }
    let interval = part.transposition.as_ref().map(|transposition| {
        (
            transposition.interval.staff_distance,
            transposition.interval.half_steps,
        )
    });
    let key_fifths_flip_at = part
        .transposition
        .as_ref()
        .and_then(|transposition| transposition.key_fifths_flip_at);
    (interval, key_fifths_flip_at)
}

/// Flatten a layout-content tree into renderable staves and group ranges.
pub(super) fn flatten_layout(
    content: &[LayoutContent],
    part_id_map: &HashMap<String, usize>,
    score: &Score,
) -> (Vec<FlatStaff>, Vec<GroupRange>) {
    let display_names = resolve_part_display_names(&score.parts);
    let mut staves = Vec::new();
    let mut groups = Vec::new();
    flatten_content_recursive(
        content,
        part_id_map,
        &display_names,
        &mut staves,
        &mut groups,
        0,
    );
    (staves, groups)
}

fn flatten_content_recursive(
    content: &[LayoutContent],
    part_id_map: &HashMap<String, usize>,
    display_names: &[PartDisplayInfo],
    staves: &mut Vec<FlatStaff>,
    groups: &mut Vec<GroupRange>,
    bracket_depth: usize,
) {
    for item in content {
        match item {
            LayoutContent::Group(group) => {
                let first_staff = staves.len();
                let child_depth = if group.symbol.as_deref().unwrap_or("bracket") == "bracket" {
                    bracket_depth + 1
                } else {
                    bracket_depth
                };
                flatten_content_recursive(
                    &group.content,
                    part_id_map,
                    display_names,
                    staves,
                    groups,
                    child_depth,
                );
                if staves.len() == first_staff {
                    continue;
                }
                if let Some(symbol) = &group.symbol {
                    groups.push(GroupRange {
                        first_staff,
                        last_staff: staves.len() - 1,
                        symbol: symbol.clone(),
                        label: group.label.clone(),
                        depth: bracket_depth,
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
                let (label, short_label, condensed_numbers) = if staff.is_condensing() {
                    condensed_labels(staff, part_id_map, display_names)
                } else {
                    regular_labels(staff, part_id_map, display_names)
                };
                staves.push(FlatStaff {
                    sources,
                    label,
                    short_label,
                    expansion: staff.expansion,
                    condensed_numbers,
                });
            }
        }
    }
}

fn condensed_labels(
    staff: &crate::model::LayoutStaff,
    part_id_map: &HashMap<String, usize>,
    display_names: &[PartDisplayInfo],
) -> (Option<String>, Option<String>, Vec<u32>) {
    let mut numbers = Vec::new();
    let mut base_label = None;
    let mut base_short = None;
    for source in &staff.sources {
        if let Some(&part_index) = part_id_map.get(&source.part) {
            if base_label.is_none() {
                base_label = Some(display_names[part_index].base_name.clone());
                base_short = Some(display_names[part_index].base_short_name.clone());
            }
            if let Some(number) = display_names[part_index].number {
                numbers.push(number as u32);
            }
        }
    }
    (staff.label.clone().or(base_label), base_short, numbers)
}

fn regular_labels(
    staff: &crate::model::LayoutStaff,
    part_id_map: &HashMap<String, usize>,
    display_names: &[PartDisplayInfo],
) -> (Option<String>, Option<String>, Vec<u32>) {
    let label = staff.label.clone().or_else(|| {
        staff
            .labelref
            .as_ref()
            .zip(staff.sources.first())
            .and_then(|(label_ref, source)| {
                part_id_map
                    .get(&source.part)
                    .and_then(|&index| display_label(label_ref, &display_names[index]))
            })
            .or_else(|| {
                staff.sources.iter().find_map(|source| {
                    source.labelref.as_ref().and_then(|label_ref| {
                        part_id_map
                            .get(&source.part)
                            .and_then(|&index| display_label(label_ref, &display_names[index]))
                    })
                })
            })
    });
    let short_label = label.as_ref().and_then(|_| {
        staff.sources.first().and_then(|source| {
            part_id_map
                .get(&source.part)
                .map(|&index| display_names[index].display_short_name.clone())
        })
    });
    (label, short_label, Vec::new())
}

fn display_label(label_ref: &str, display: &PartDisplayInfo) -> Option<String> {
    match label_ref {
        "name" => Some(display.display_name.clone()),
        "shortName" => Some(display.display_short_name.clone()),
        _ => None,
    }
}

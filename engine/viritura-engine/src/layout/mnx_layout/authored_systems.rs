//! Resolution of authored MNX system anchors and their layout inheritance.

use super::super::full_score::{FlatSource, FlatStaff, GroupRange};
use super::super::page::resolve_part_display_names;
use super::explicit_system_breaks::SystemLayoutChanges;
use super::structure_flattening::flatten_layout;
use crate::model::{LayoutBreakKind, LayoutDefinition, Score, ScoreDefinition, SystemDefinition};
use std::collections::{HashMap, HashSet};

type StaffGroupLayout = (Vec<FlatStaff>, Vec<GroupRange>);

pub(super) fn collect_authored_systems(
    score_def: &ScoreDefinition,
    measure_id_map: &HashMap<String, usize>,
) -> (Vec<SystemDefinition>, Vec<usize>) {
    let mut all_systems: Vec<SystemDefinition> = Vec::new();
    let mut forced_page_measures = HashSet::new();
    for page in &score_def.pages {
        if !all_systems.is_empty() {
            if let Some(system) = page.systems.first() {
                forced_page_measures.insert(system.measure.clone());
            }
        }
        all_systems.extend(page.systems.iter().cloned());
    }
    if !all_systems.is_empty() {
        for layout_break in &score_def.layout_breaks {
            if !measure_id_map.contains_key(&layout_break.measure) {
                continue;
            }
            if layout_break.kind == LayoutBreakKind::Page {
                forced_page_measures.insert(layout_break.measure.clone());
            }
            if !all_systems
                .iter()
                .any(|system| system.measure == layout_break.measure)
            {
                all_systems.push(SystemDefinition {
                    layout: None,
                    measure: layout_break.measure.clone(),
                    layout_changes: Vec::new(),
                });
            }
        }
        all_systems.sort_by_key(|system| {
            measure_id_map
                .get(&system.measure)
                .copied()
                .unwrap_or_default()
        });
        all_systems.dedup_by(|left, right| left.measure == right.measure);
    }
    let forced_page_starts = all_systems
        .iter()
        .enumerate()
        .filter(|(_, system)| forced_page_measures.contains(&system.measure))
        .map(|(index, _)| index)
        .collect();
    (all_systems, forced_page_starts)
}

/// Resolve per-system measure ranges, flattened staves, and layout changes.
///
/// A `system.layout` override applies from its system until the next explicit
/// override. The first authored anchor remains the start of an MNX excerpt.
#[allow(clippy::too_many_arguments)] // Authored-system resolution requires the document lookup maps.
pub(super) fn resolve_explicit_systems_and_layouts(
    score: &Score,
    score_def: &ScoreDefinition,
    all_systems: &[SystemDefinition],
    measure_id_map: &HashMap<String, usize>,
    part_id_map: &HashMap<String, usize>,
    layout_map: &HashMap<String, &LayoutDefinition>,
    measure_count: usize,
) -> (
    Vec<(usize, usize)>,
    Vec<StaffGroupLayout>,
    SystemLayoutChanges,
) {
    let mut system_measure_ranges = Vec::new();
    for (index, system) in all_systems.iter().enumerate() {
        let start = measure_id_map.get(&system.measure).copied().unwrap_or(0);
        let end = all_systems
            .get(index + 1)
            .and_then(|next| measure_id_map.get(&next.measure))
            .copied()
            .unwrap_or(measure_count);
        system_measure_ranges.push((start, end.max(start)));
    }

    let mut system_flat_staves = Vec::new();
    let mut system_layout_changes = Vec::new();
    let mut inherited_layout_id = None;
    for system in all_systems {
        if let Some(layout_id) = system.layout.as_deref() {
            inherited_layout_id = Some(layout_id);
        }
        let layout_id = system
            .layout
            .as_deref()
            .or(inherited_layout_id)
            .or(score_def.layout.as_deref());
        system_flat_staves.push(resolve_layout(layout_id, score, part_id_map, layout_map));

        let mut changes = HashMap::new();
        for change in &system.layout_changes {
            if let (Some(&measure_index), Some(layout)) = (
                measure_id_map.get(&change.location.measure),
                layout_map.get(&change.layout),
            ) {
                changes.insert(
                    measure_index,
                    flatten_layout(&layout.content, part_id_map, score),
                );
            }
        }
        system_layout_changes.push(changes);
    }

    (
        system_measure_ranges,
        system_flat_staves,
        system_layout_changes,
    )
}

fn resolve_layout(
    layout_id: Option<&str>,
    score: &Score,
    part_id_map: &HashMap<String, usize>,
    layout_map: &HashMap<String, &LayoutDefinition>,
) -> StaffGroupLayout {
    layout_id.and_then(|id| layout_map.get(id)).map_or_else(
        || default_flat_staves(score),
        |layout| flatten_layout(&layout.content, part_id_map, score),
    )
}

fn default_flat_staves(score: &Score) -> StaffGroupLayout {
    let display_names = resolve_part_display_names(&score.parts);
    let mut staves: Vec<_> = score
        .parts
        .iter()
        .enumerate()
        .map(|(index, _part)| FlatStaff {
            sources: vec![FlatSource::whole_part(index)],
            label: Some(display_names[index].display_name.clone()),
            short_label: Some(display_names[index].display_short_name.clone()),
            resolved_full_label: Some(display_names[index].display_name.clone()),
            resolved_short_label: Some(display_names[index].display_short_name.clone()),
            expansion: false,
            condensed_numbers: Vec::new(),
            chord_symbol_source: None,
            chord_symbol_transposition: None,
        })
        .collect();
    super::structure_flattening::resolve_chord_symbol_sources(&mut staves, score);
    (staves, Vec::new())
}

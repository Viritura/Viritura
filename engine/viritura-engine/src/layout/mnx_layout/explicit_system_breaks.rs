//! Width-driven subdivision of authored MNX systems.

use super::super::full_score::{FlatStaff, GroupRange};
use super::super::system::break_into_systems;
use std::collections::{HashMap, HashSet};

pub(super) type SystemLayoutChanges = Vec<HashMap<usize, (Vec<FlatStaff>, Vec<GroupRange>)>>;

/// Subdivide authored systems that exceed the available content width.
pub(super) fn expand_oversized_systems_explicit(
    available_width: f64,
    max_widths: &[f64],
    skip_measures: &HashSet<usize>,
    system_measure_ranges: &mut Vec<(usize, usize)>,
    system_flat_staves: &mut Vec<(Vec<FlatStaff>, Vec<GroupRange>)>,
    system_layout_changes: &mut SystemLayoutChanges,
) {
    let mut expanded_ranges = Vec::new();
    let mut expanded_staves = Vec::new();
    let mut expanded_changes = Vec::new();
    let all_skipped = |start: usize, end: usize| {
        start < end && (start..end).all(|index| skip_measures.contains(&index))
    };

    for (system_index, &(start, end)) in system_measure_ranges.iter().enumerate() {
        let natural_widths: Vec<f64> = (start..end)
            .map(|index| max_widths.get(index).copied().unwrap_or(0.0) * 1.15)
            .collect();
        if natural_widths.iter().sum::<f64>() > available_width && end - start > 1 {
            for subsystem in break_into_systems(&natural_widths, available_width) {
                let sub_start = start + subsystem[0];
                let sub_end = start + subsystem.last().copied().unwrap_or(0) + 1;
                if all_skipped(sub_start, sub_end) {
                    continue;
                }
                expanded_ranges.push((sub_start, sub_end));
                expanded_staves.push(system_flat_staves[system_index].clone());
                expanded_changes.push(system_layout_changes[system_index].clone());
            }
        } else {
            expanded_ranges.push((start, end));
            expanded_staves.push(system_flat_staves[system_index].clone());
            expanded_changes.push(system_layout_changes[system_index].clone());
        }
    }

    *system_measure_ranges = expanded_ranges;
    *system_flat_staves = expanded_staves;
    *system_layout_changes = expanded_changes;
}

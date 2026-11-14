//! Automatic system boundaries where doubling changes the physical staff count.

use super::super::full_score::{FlatStaff, GroupRange};
use super::structure_flattening::flatten_layout_for_measures;
use crate::model::{LayoutBreakKind, LayoutContent, Score, ScoreDefinition};
use std::collections::{HashMap, HashSet};

pub(super) struct InstrumentRegions {
    pub ranges: Vec<(usize, usize)>,
    pub staves: Vec<(Vec<FlatStaff>, Vec<GroupRange>)>,
    pub page_starts: Vec<usize>,
}

fn shared_parts(content: &[LayoutContent], parts: &mut HashSet<String>) {
    for node in content {
        match node {
            LayoutContent::Group(group) => shared_parts(&group.content, parts),
            LayoutContent::Staff(staff) if staff.sources.len() > 1 => {
                parts.extend(staff.sources.iter().map(|source| source.part.clone()));
            }
            LayoutContent::Staff(_) => {}
        }
    }
}

fn topology(staves: &[FlatStaff]) -> Vec<Vec<usize>> {
    staves
        .iter()
        .map(|staff| {
            staff
                .sources
                .iter()
                .map(|source| source.part_index)
                .collect()
        })
        .collect()
}

pub(super) fn automatic_instrument_regions(
    content: &[LayoutContent],
    score: &Score,
    definition: &ScoreDefinition,
    part_id_map: &HashMap<String, usize>,
    measure_id_map: &HashMap<String, usize>,
    varying_empty_staves: bool,
) -> Option<InstrumentRegions> {
    let count = score.global.measures.len();
    let varying_empty_staves = varying_empty_staves && {
        let (staves, _) = flatten_layout_for_measures(content, part_id_map, score, 0..count);
        let parts: HashSet<_> = staves
            .iter()
            .flat_map(|staff| staff.sources.iter().map(|source| source.part_index))
            .collect();
        parts.len() > 1
            && parts.iter().any(|&index| {
                score.parts[index]
                    .id
                    .as_ref()
                    .is_some_and(|id| definition.auto_hide_empty_parts.contains(id))
            })
    };
    let mut parts = HashSet::new();
    shared_parts(content, &mut parts);
    let mut boundaries = vec![0];
    for id in parts {
        let Some(&index) = part_id_map.get(&id) else {
            continue;
        };
        for (index, measure) in score.parts[index].measures.iter().enumerate().take(count) {
            if measure
                .instrument_changes
                .as_ref()
                .is_some_and(|changes| !changes.is_empty())
            {
                boundaries.push(index);
            }
        }
    }
    boundaries.sort_unstable();
    boundaries.dedup();
    if boundaries.len() < 2 && !varying_empty_staves {
        return None;
    }
    let mut regions = InstrumentRegions {
        ranges: Vec::new(),
        staves: Vec::new(),
        page_starts: Vec::new(),
    };
    for start in boundaries {
        let layout = flatten_layout_for_measures(content, part_id_map, score, start..start + 1);
        if regions
            .staves
            .last()
            .is_some_and(|previous| topology(&previous.0) == topology(&layout.0))
        {
            continue;
        }
        if let Some(previous) = regions.ranges.last_mut() {
            previous.1 = start;
        }
        regions.ranges.push((start, count));
        regions.staves.push(layout);
    }
    if regions.ranges.len() < 2 && !varying_empty_staves {
        return None;
    }
    // Staff-count changes require real system breaks; authored page/system locks
    // remain additional boundaries inside each compatible instrument region.
    for layout_break in &definition.layout_breaks {
        let Some(&index) = measure_id_map.get(&layout_break.measure) else {
            continue;
        };
        if let Some(region) = regions
            .ranges
            .iter()
            .position(|&(start, end)| start < index && index < end)
        {
            let end = regions.ranges[region].1;
            regions.ranges[region].1 = index;
            regions.ranges.insert(region + 1, (index, end));
            regions
                .staves
                .insert(region + 1, regions.staves[region].clone());
        }
    }
    regions.page_starts = regions
        .ranges
        .iter()
        .enumerate()
        .filter_map(|(region, &(start, _))| {
            definition
                .layout_breaks
                .iter()
                .any(|layout_break| {
                    layout_break.kind == LayoutBreakKind::Page
                        && measure_id_map.get(&layout_break.measure) == Some(&start)
                })
                .then_some(region)
        })
        .collect();
    Some(regions)
}

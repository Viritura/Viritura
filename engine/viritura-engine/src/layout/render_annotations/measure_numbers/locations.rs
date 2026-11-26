use super::*;
use crate::layout::full_score::{FlatStaff, GroupRange};

#[derive(Clone, Copy, Default)]
pub(crate) struct BarNumberRowPositions {
    pub above: Option<f64>,
    pub below: Option<f64>,
}

pub(crate) struct BarNumberStaffContext {
    pub staff_index: usize,
    pub placements: Vec<BarNumberPlacement>,
    pub rows: BarNumberRowPositions,
}

impl BarNumberStaffContext {
    pub(crate) fn simple(
        settings: &BarNumberSettings,
        staff: usize,
        staff_count: usize,
        top_bottom: usize,
    ) -> Self {
        Self {
            staff_index: staff,
            placements: simple_number_locations(settings, staff, staff_count, top_bottom),
            rows: BarNumberRowPositions::default(),
        }
    }
}

pub(crate) fn has_multiple_number_locations(settings: &BarNumberSettings) -> bool {
    settings.placements.is_some() || settings.above_groups.is_some()
}

pub(crate) fn reserves_number_ink(settings: &BarNumberSettings) -> bool {
    settings.on_staff == Some(true)
        || settings.distance.is_some()
        || has_multiple_number_locations(settings)
}

pub(crate) fn simple_number_locations(
    settings: &BarNumberSettings,
    staff: usize,
    staff_count: usize,
    top_instrument_bottom: usize,
) -> Vec<BarNumberPlacement> {
    let placements = settings
        .placements
        .clone()
        .unwrap_or_else(|| vec![settings.placement.unwrap_or_default()]);
    let mut result = Vec::new();
    for placement in placements {
        let target = match placement {
            BarNumberPlacement::AboveSystem => 0,
            BarNumberPlacement::BelowSystem => staff_count.saturating_sub(1),
            BarNumberPlacement::BelowTopInstrument => top_instrument_bottom,
        };
        let side = if placement == BarNumberPlacement::AboveSystem {
            placement
        } else {
            BarNumberPlacement::BelowSystem
        };
        if staff == target && !result.contains(&side) {
            result.push(side);
        }
    }
    result
}

pub(crate) fn number_staff_context(
    settings: &BarNumberSettings,
    staff: usize,
    staves: &[FlatStaff],
    groups: &[GroupRange],
    score: &Score,
    rows: BarNumberRowPositions,
) -> BarNumberStaffContext {
    let top_part = staves
        .first()
        .and_then(|staff| staff.sources.first())
        .map(|source| source.part_index);
    let top_bottom = staves
        .iter()
        .take_while(|staff| {
            staff
                .sources
                .iter()
                .any(|source| Some(source.part_index) == top_part)
        })
        .count()
        .saturating_sub(1);
    let mut placements = simple_number_locations(settings, staff, staves.len(), top_bottom);
    if let Some(selected) = &settings.above_groups {
        let above_group = groups.iter().any(|group| {
            if group.depth != 0
                || !matches!(group.symbol.as_str(), "bracket" | "square")
                || group.first_staff != staff
            {
                return false;
            }
            let members: Vec<_> = staves[group.first_staff..=group.last_staff]
                .iter()
                .flat_map(|staff| &staff.sources)
                .filter_map(|source| score.parts.get(source.part_index))
                .filter_map(|part| part.id.as_ref())
                .collect();
            !members.is_empty()
                && selected
                    .iter()
                    .any(|parts| members.iter().all(|id| parts.contains(id)))
        });
        if above_group && !placements.contains(&BarNumberPlacement::AboveSystem) {
            placements.push(BarNumberPlacement::AboveSystem);
        }
    }
    BarNumberStaffContext {
        staff_index: staff,
        placements,
        rows,
    }
}

pub(crate) fn number_location_key(staff: usize, above: bool) -> String {
    format!("bn{staff}-{}", if above { "above" } else { "below" })
}

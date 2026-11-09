use crate::layout::full_score::FlatStaff;
use crate::model::*;

#[derive(Clone)]
pub(in crate::layout::mnx_layout) struct FlatStaffMeterState {
    pub(in crate::layout::mnx_layout) compatible: bool,
    pub(in crate::layout::mnx_layout) effective: Option<EffectiveStaffMeter>,
    authored_here: bool,
}

impl FlatStaffMeterState {
    pub(in crate::layout::mnx_layout) fn apply_authored_change(&self, measure: &mut PartMeasure) {
        if !self.authored_here {
            return;
        }
        measure.staff_meters = Some(vec![match self.effective.as_ref() {
            Some(effective) => StaffMeterChange::Set {
                staff: 1,
                meter: StaffMeter {
                    count: effective.time_signature.count,
                    unit: effective.time_signature.unit,
                    beat_structure: effective.time_signature.beat_structure.clone(),
                },
                synchronization: effective.synchronization,
            },
            None => StaffMeterChange::Reset { staff: 1 },
        }]);
    }
}

fn same_effective_meter(
    left: Option<&EffectiveStaffMeter>,
    right: Option<&EffectiveStaffMeter>,
) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => {
            left.time_signature == right.time_signature
                && left.synchronization == right.synchronization
                && left.ratio_to_global == right.ratio_to_global
        }
        _ => false,
    }
}

pub(in crate::layout::mnx_layout) fn flat_staff_meter_states(
    flat_staff: &FlatStaff,
    score: &Score,
    measure_count: usize,
) -> Vec<FlatStaffMeterState> {
    let global_time_at = crate::model::effective_time_signature_table(&score.global.measures);
    let source_tables: Vec<_> = flat_staff
        .sources
        .iter()
        .map(|source| {
            let part = &score.parts[source.part_index];
            (
                source.staff_number.unwrap_or(1),
                &part.measures,
                crate::model::staff_meter::resolve_staff_meter_table(
                    &part.measures,
                    &global_time_at,
                )
                .0,
            )
        })
        .collect();

    (0..measure_count)
        .map(|measure_index| {
            let mut first_effective: Option<EffectiveStaffMeter> = None;
            let mut first_displayed: Option<TimeSignature> = None;
            let mut first = true;
            let mut compatible = true;

            for (staff, measures, table) in &source_tables {
                let effective = table
                    .get(measure_index)
                    .and_then(|meters| meters.get(staff));
                let authored_here = measures
                    .get(measure_index)
                    .and_then(|measure| measure.staff_meters.as_ref())
                    .is_some_and(|changes| changes.iter().any(|change| change.staff() == *staff));
                let displayed = if authored_here {
                    effective
                        .map(|meter| meter.time_signature.clone())
                        .or_else(|| global_time_at.get(measure_index).cloned())
                } else if effective.is_some() {
                    None
                } else {
                    score
                        .global
                        .measures
                        .get(measure_index)
                        .and_then(|measure| measure.time.clone())
                };

                if first {
                    first_effective = effective.cloned();
                    first_displayed = displayed;
                    first = false;
                } else if !same_effective_meter(first_effective.as_ref(), effective)
                    || first_displayed != displayed
                {
                    compatible = false;
                }
            }

            if let Some(effective) = first_effective.as_mut() {
                effective.staff = 1;
            }
            let authored_here = compatible
                && first_displayed.is_some()
                && (first_effective.is_some()
                    || score
                        .global
                        .measures
                        .get(measure_index)
                        .is_none_or(|measure| measure.time.is_none()));
            FlatStaffMeterState {
                compatible,
                effective: compatible.then_some(first_effective).flatten(),
                authored_here,
            }
        })
        .collect()
}

pub(in crate::layout::mnx_layout) fn has_incompatible_staff_meters(
    flat_staff: &FlatStaff,
    score: &Score,
) -> bool {
    if flat_staff.sources.len() < 2 {
        return false;
    }
    let has_staff_meter_declaration = flat_staff.sources.iter().any(|source| {
        let staff = source.staff_number.unwrap_or(1);
        score.parts[source.part_index]
            .measures
            .iter()
            .any(|measure| {
                measure
                    .staff_meters
                    .as_ref()
                    .is_some_and(|changes| changes.iter().any(|change| change.staff() == staff))
            })
    });
    has_staff_meter_declaration
        && flat_staff_meter_states(flat_staff, score, score.global.measures.len())
            .iter()
            .any(|state| !state.compatible)
}

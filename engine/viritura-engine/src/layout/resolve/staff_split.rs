//! Per-staff measure splitting for grand-staff/multi-staff parts.
//!
//! A part with more than one staff (piano, organ, condensed grand staff)
//! authors its sequences, clefs, dynamics, chord symbols, and staff-local
//! meter declarations across all its staves in one flat `PartMeasure`. This
//! module derives the single-staff view the layout engine actually lays
//! out: filtering every staff-taggable field down to one staff number, and
//! resolving clef inheritance across measures for that staff.

use crate::model::*;

fn automatic_dynamic_staff(pm: &PartMeasure, group: &DynamicGroup, staff_count: u32) -> u32 {
    if let Some(voice) = group.voice.as_deref() {
        let sequence = pm
            .sequences
            .iter()
            .find(|sequence| sequence.voice.as_deref() == Some(voice))
            .or_else(|| {
                voice
                    .strip_prefix('v')
                    .and_then(|number| number.parse::<usize>().ok())
                    .and_then(|number| number.checked_sub(1))
                    .and_then(|index| pm.sequences.get(index))
            });
        if let Some(sequence) = sequence {
            return sequence.staff.unwrap_or(1);
        }
    }

    match group.orient {
        Some(MultiStaffOrientation::Below) => staff_count,
        // Standard engraving practice: an unscoped keyboard dynamic belongs
        // in the uppermost available inter-staff lane, not on every staff.
        Some(MultiStaffOrientation::Above)
        | Some(MultiStaffOrientation::Between)
        | Some(MultiStaffOrientation::Auto)
        | None => 1,
    }
}

/// Split a PartMeasure's sequences and clefs by staff number.
/// Returns a new PartMeasure containing only sequences and clefs for the given staff.
/// When no clefs match the target staff but the original had clefs, a conventional
/// default is provided: G clef for staff 1, F clef for staff 2+.
#[allow(dead_code)] // Prepared for per-staff incremental resolution; current callers still use the whole-part path.
pub(crate) fn split_part_measure_by_staff(pm: &PartMeasure, staff_num: u32) -> PartMeasure {
    split_part_measure_by_staff_count(pm, staff_num, u32::MAX)
}

pub(super) fn split_part_measure_by_staff_count(
    pm: &PartMeasure,
    staff_num: u32,
    staff_count: u32,
) -> PartMeasure {
    let sequences: Vec<_> = pm
        .sequences
        .iter()
        .filter(|s| s.staff.unwrap_or(1) == staff_num)
        .cloned()
        .collect();
    let clefs = pm.clefs.as_ref().map(|clefs| {
        clefs
            .iter()
            .filter(|c| c.staff.unwrap_or(1) == staff_num)
            .cloned()
            .collect()
    });
    PartMeasure {
        clefs,
        sequences,
        arpeggios: if staff_num == 1 {
            pm.arpeggios.clone()
        } else {
            None
        },
        non_arpeggios: if staff_num == 1 {
            pm.non_arpeggios.clone()
        } else {
            None
        },
        beams: pm.beams.clone(),
        dynamics: pm.dynamics.as_ref().map(|groups| {
            groups
                .iter()
                .filter(|group| {
                    group
                        .staff
                        .unwrap_or_else(|| automatic_dynamic_staff(pm, group, staff_count))
                        == staff_num
                })
                .cloned()
                .map(|mut group| {
                    group.placement_above = group.resolved_placement_above(staff_count, staff_num);
                    group
                })
                .collect()
        }),
        ottavas: pm.ottavas.as_ref().and_then(|ottavas| {
            let filtered: Vec<_> = ottavas
                .iter()
                .filter(|ottava| ottava.staff.unwrap_or(1) == staff_num)
                .cloned()
                .collect();
            (!filtered.is_empty()).then_some(filtered)
        }),
        // A simile sign is engraved on every staff of the part, like a
        // whole-measure rest.
        measure_repeat: pm.measure_repeat.clone(),
        staff_configs: pm.staff_configs.as_ref().and_then(|configs| {
            let filtered: Vec<_> = configs
                .iter()
                .filter(|config| config.staff.unwrap_or(1) == staff_num)
                .cloned()
                .collect();
            (!filtered.is_empty()).then_some(filtered)
        }),
        pedals: pm.pedals.as_ref().and_then(|pedals| {
            let filtered: Vec<_> = pedals
                .iter()
                .filter(|pedal| pedal.staff.unwrap_or(1) == staff_num)
                .cloned()
                .collect();
            (!filtered.is_empty()).then_some(filtered)
        }),
        chord_symbols: pm.chord_symbols.as_ref().and_then(|chords| {
            let filtered: Vec<_> = chords
                .iter()
                .enumerate()
                .filter(|(_, chord)| {
                    chord
                        .display_staff
                        .filter(|display_staff| *display_staff <= staff_count)
                        .unwrap_or(1)
                        == staff_num
                })
                .map(|(index, chord)| {
                    let mut chord = chord.clone();
                    chord.source_index = Some(index);
                    chord
                })
                .collect();
            (!filtered.is_empty()).then_some(filtered)
        }),
        expressions: if staff_num == 1 {
            pm.expressions.clone()
        } else {
            None
        },
        condensing_override: pm.condensing_override.clone(),
        grouping_display_overrides: pm
            .grouping_display_overrides
            .as_ref()
            .and_then(|overrides| {
                let filtered: Vec<_> = overrides
                    .iter()
                    .filter(|o| o.staff == staff_num)
                    .cloned()
                    .collect();
                (!filtered.is_empty()).then_some(filtered)
            }),
        staff_meters: pm.staff_meters.as_ref().and_then(|changes| {
            let filtered: Vec<_> = changes
                .iter()
                .filter(|change| change.staff() == staff_num)
                .cloned()
                .collect();
            (!filtered.is_empty()).then_some(filtered)
        }),
    }
}

/// Returns a conventional default clef for a given staff number.
/// Staff 1: G clef (treble). Staff 2+: F clef (bass).
pub(crate) fn default_clef_for_staff(staff_num: u32) -> PositionedClef {
    if staff_num <= 1 {
        PositionedClef {
            clef: Clef {
                sign: ClefSign::G,
                staff_position: -2,
                color: None,
                glyph: None,
                octave: None,
                show_octave: None,
            },
            position: None,
            staff: Some(staff_num),
        }
    } else {
        PositionedClef {
            clef: Clef {
                sign: ClefSign::F,
                staff_position: 2,
                color: None,
                glyph: None,
                octave: None,
                show_octave: None,
            },
            position: None,
            staff: Some(staff_num),
        }
    }
}

/// Resolve measures for a specific staff of a grand staff part.
/// Inherits clefs across measures: if a measure has no clef for this staff,
/// the last active clef from a previous measure is carried forward.
pub(crate) fn resolve_measures_for_staff(
    score: &Score,
    part_index: usize,
    staff_num: u32,
) -> Vec<ResolvedMeasure> {
    let base = super::resolve_measures(score, part_index);
    let staff_count = score.parts.get(part_index).map_or(1, |part| part.staves);
    let mut last_clef: Option<PositionedClef> = None;
    let mut active_staff_lines = super::super::staff_lines::DEFAULT_STAFF_LINES;

    // Resolve this staff's effective staff-local meter at every measure
    // index up front (declarations inherit until changed/reset — see
    // `crate::model::staff_meter`), from the *unfiltered* part measures so
    // every staff's declarations are visible regardless of resolution order.
    let global_time_at = crate::model::effective_time_signature_table(&score.global.measures);
    let (staff_meter_table, _issues) = score
        .parts
        .get(part_index)
        .map(|part| {
            crate::model::staff_meter::resolve_staff_meter_table(&part.measures, &global_time_at)
        })
        .unwrap_or_else(|| (Vec::new(), Vec::new()));

    base.into_iter()
        .map(|rm| {
            let mut split = split_part_measure_by_staff_count(&rm.part, staff_num, staff_count);

            let mut measure_clefs = split.clefs.take().unwrap_or_default();
            measure_clefs.sort_by(|a, b| {
                let (an, ad) = a.position.as_ref().map(|p| p.fraction).unwrap_or((0, 1));
                let (bn, bd) = b.position.as_ref().map(|p| p.fraction).unwrap_or((0, 1));
                let left = an as i64 * bd as i64;
                let right = bn as i64 * ad as i64;
                left.cmp(&right)
            });

            // Ensure each measure has a beat-0 clef context for pitch mapping.
            // Carried/default clefs are represented with position (0,1) so they
            // participate in active-clef resolution without rendering a start change.
            let has_start_clef = measure_clefs.iter().any(|c| {
                let (n, _) = c.position.as_ref().map(|p| p.fraction).unwrap_or((0, 1));
                n == 0
            });

            if !has_start_clef {
                let mut start_clef = if let Some(ref inherited) = last_clef {
                    inherited.clone()
                } else {
                    default_clef_for_staff(staff_num)
                };
                start_clef.position = Some(RhythmicPosition { fraction: (0, 1) });
                measure_clefs.insert(0, start_clef);
            }

            if let Some(c) = measure_clefs.last() {
                last_clef = Some(c.clone());
            }

            split.clefs = Some(measure_clefs);
            let measure_staff_lines = super::super::staff_lines::resolve_measure_staff_lines(
                &mut active_staff_lines,
                split.staff_configs.as_deref(),
            );

            ResolvedMeasure {
                index: rm.index,
                global: rm.global,
                part: split,
                tie_continuation_ids: rm.tie_continuation_ids.clone(),
                measure_repeat_covered: rm.measure_repeat_covered,
                next_has_repeat_start: rm.next_has_repeat_start,
                active_time: rm.active_time,
                active_key: rm.active_key,
                prev_key: rm.prev_key,
                active_staff_lines: measure_staff_lines,
                transposition: None,
                written_diatonic_adjustment: 0,
                condensing_change: rm.condensing_change,
                kit: rm.kit.clone(),
                staff_has_lyrics: super::part_staff_has_lyrics(&score.parts[part_index], staff_num),
                effective_staff_meter: staff_meter_table
                    .get(rm.index)
                    .and_then(|staves| staves.get(&staff_num))
                    .cloned(),
            }
        })
        .collect()
}

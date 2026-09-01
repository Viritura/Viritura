//! Per-system measure-layout construction for authored MNX systems.

use super::super::condensing::{label_for_mode_styled, LabelStyle, MergeMode};
use super::super::config::LayoutConfig;
use super::super::full_score::{compute_system_object_staves, FlatStaff, GroupRange};
use super::super::measure::{
    compute_system_spacing, fix_cross_staff_note_positions, layout_measure_with_shared_spacing,
};
use super::super::resolve::resolve_all_ottavas;
use super::super::types::MeasureLayout;
use super::shared::{
    append_partial_unison_label, build_virtual_part_measure, compute_flat_staff_transposition,
};
use crate::model::*;
use std::collections::{HashMap, HashSet};

type StaffKey = (usize, u32);

/// Per-physical-staff state carried across explicit system boundaries.
#[derive(Default)]
pub(super) struct PersistentStaffState {
    last_clef: HashMap<StaffKey, PositionedClef>,
    active_time: HashMap<StaffKey, TimeSignature>,
    active_key: HashMap<StaffKey, KeySignature>,
    prev_condensing: HashMap<StaffKey, MergeMode>,
}

/// Build all measure layouts for one explicit system.
#[allow(clippy::too_many_arguments)] // Explicit system construction consumes authored layout, spacing, MMR, and carry state.
#[allow(clippy::too_many_lines)] // One stateful staff-by-measure carry pass; inner policies remain named operations.
pub(super) fn build_explicit_system_layouts(
    score: &Score,
    score_def: &ScoreDefinition,
    config: &LayoutConfig,
    sp: f64,
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
    sys_measure_indices: &[usize],
    m_start: usize,
    lc_map: &HashMap<usize, (Vec<FlatStaff>, Vec<GroupRange>)>,
    all_resolved: &[Vec<ResolvedMeasure>],
    max_widths: &[f64],
    scale: f64,
    margin_left: f64,
    common_shortest_beats: f64,
    mmr_start_map: &HashMap<usize, u32>,
    mmr_label_map: &HashMap<usize, String>,
    state: &mut PersistentStaffState,
) -> Vec<Vec<MeasureLayout>> {
    let mut all_staff_layouts = Vec::new();
    let system_object_staves = compute_system_object_staves(group_ranges, flat_staves.len());
    let shown_parts: HashSet<usize> = flat_staves
        .iter()
        .flat_map(|staff| staff.sources.iter())
        .map(|source| source.part_index)
        .collect();
    let (merged_spacings, max_prefixes) = compute_system_spacing(
        all_resolved,
        sys_measure_indices,
        sp,
        common_shortest_beats,
        config,
        Some(&shown_parts),
    );

    for (staff_index, flat_staff) in flat_staves.iter().enumerate() {
        let use_written = score_def.use_written.unwrap_or(false);
        let staff_key = (
            flat_staff
                .sources
                .first()
                .map_or(0, |source| source.part_index),
            flat_staff
                .sources
                .first()
                .and_then(|source| source.staff_number)
                .unwrap_or(1),
        );
        let mut virtual_resolved = Vec::new();
        let mut active_time = state
            .active_time
            .get(&staff_key)
            .cloned()
            .unwrap_or_default();
        let mut active_key = state
            .active_key
            .get(&staff_key)
            .cloned()
            .unwrap_or(KeySignature {
                fifths: 0,
                ..Default::default()
            });
        let mut active_layout_staves: Option<&Vec<FlatStaff>> = None;
        let mut last_clef = state.last_clef.get(&staff_key).cloned();

        if last_clef.is_none() && m_start > 0 {
            'sources: for source in &flat_staff.sources {
                let Some(part) = score.parts.get(source.part_index) else {
                    continue;
                };
                for measure_index in (0..m_start.min(part.measures.len())).rev() {
                    if let Some(clef) = part.measures[measure_index]
                        .clefs
                        .as_ref()
                        .and_then(|clefs| clefs.last())
                    {
                        last_clef = Some(clef.clone());
                        break 'sources;
                    }
                }
            }
        }
        let mut previous_condensing = state.prev_condensing.get(&staff_key).cloned();
        let mut previous_display_key = active_key.clone();

        for &measure_index in sys_measure_indices {
            if let Some((layout_staves, _)) = lc_map.get(&measure_index) {
                active_layout_staves = Some(layout_staves);
            }
            let effective_staff = active_layout_staves
                .and_then(|staves| staves.get(staff_index))
                .unwrap_or(flat_staff);
            let (transposition, key_fifths_flip_at) =
                compute_flat_staff_transposition(effective_staff, score, use_written);
            let global =
                score
                    .global
                    .measures
                    .get(measure_index)
                    .cloned()
                    .unwrap_or(GlobalMeasure {
                        id: None,
                        number: None,
                        time: None,
                        key: None,
                        barline: None,
                        repeat_start: None,
                        repeat_end: None,
                        ending: None,
                        tempos: None,
                        segno: None,
                        fine: None,
                        jump: None,
                        extensions: None,
                    });
            if let Some(time) = &global.time {
                active_time = time.clone();
            }
            if let Some(key) = &global.key {
                active_key = key.clone();
            }
            let (mut virtual_part, condensing_mode) =
                build_virtual_part_measure(effective_staff, measure_index, score);

            let is_condensing_change = if let Some(mode) = &condensing_mode {
                let changed = previous_condensing.as_ref() != Some(mode);
                if changed {
                    let label = label_for_mode_styled(
                        mode,
                        effective_staff.sources.len() as u32,
                        previous_condensing.as_ref(),
                        LabelStyle::Orchestral,
                    );
                    if let Some(text) = label.text() {
                        virtual_part.expressions.get_or_insert_with(Vec::new).push(
                            TextExpression {
                                text,
                                position: RhythmicPosition { fraction: (0, 1) },
                                placement: Some(ExpressionPlacement::Above),
                                staff: None,
                                voice: None,
                                source_part_index: None,
                                source_expression_index: None,
                                manual_offset: None,
                                avoid_collisions: None,
                            },
                        );
                    }
                }
                changed && previous_condensing.is_some()
            } else {
                false
            };
            previous_condensing = condensing_mode;
            append_partial_unison_label(
                &mut virtual_part,
                previous_condensing.as_ref(),
                effective_staff,
                score,
                measure_index,
                &active_time,
            );

            let has_start_clef = virtual_part.clefs.as_ref().is_some_and(|clefs| {
                clefs.iter().any(|clef| {
                    clef.position
                        .as_ref()
                        .map(|position| position.fraction.0)
                        .unwrap_or(0)
                        == 0
                })
            });
            if !has_start_clef {
                if let Some(inherited) = &last_clef {
                    let mut start_clef = inherited.clone();
                    start_clef.position = Some(RhythmicPosition { fraction: (0, 1) });
                    virtual_part
                        .clefs
                        .get_or_insert_with(Vec::new)
                        .insert(0, start_clef);
                }
            }
            if let Some(clef) = virtual_part.clefs.as_ref().and_then(|clefs| clefs.last()) {
                last_clef = Some(clef.clone());
            }

            let (display_key, diatonic_adjustment) = crate::layout::resolve::resolve_display_key(
                &active_key,
                transposition,
                key_fifths_flip_at,
            );
            virtual_resolved.push(ResolvedMeasure {
                index: measure_index,
                global,
                part: virtual_part,
                measure_repeat_covered: effective_staff.sources.iter().any(|source| {
                    score.parts.get(source.part_index).is_some_and(|part| {
                        crate::layout::resolve::measure_is_covered_by_repeat(
                            &part.measures,
                            measure_index,
                        )
                    })
                }),
                next_has_repeat_start: score
                    .global
                    .measures
                    .get(measure_index + 1)
                    .is_some_and(|measure| measure.repeat_start.is_some()),
                active_time: active_time.clone(),
                active_key: display_key.clone(),
                prev_key: previous_display_key.clone(),
                tie_continuation_ids: Vec::new(),
                transposition,
                written_diatonic_adjustment: diatonic_adjustment,
                condensing_change: is_condensing_change,
                kit: effective_staff
                    .sources
                    .first()
                    .and_then(|source| score.parts.get(source.part_index))
                    .and_then(|part| part.kit.clone()),
            });
            previous_display_key = display_key;
        }

        let staff_ottavas = resolve_all_ottavas(&virtual_resolved);
        let mut system_x = margin_left;
        let mut measure_layouts = Vec::new();
        state.active_time.insert(staff_key, active_time.clone());
        state.active_key.insert(staff_key, active_key.clone());
        if let Some(clef) = last_clef {
            state.last_clef.insert(staff_key, clef);
        }
        if let Some(mode) = previous_condensing {
            state.prev_condensing.insert(staff_key, mode);
        }

        for (local_index, measure) in virtual_resolved.iter().enumerate() {
            let measure_index = sys_measure_indices[local_index];
            let forced_width = Some(max_widths.get(measure_index).copied().unwrap_or(10.0) * scale);
            let forced_prefix = max_prefixes.get(local_index).copied();
            let mut layout = layout_measure_with_shared_spacing(
                measure,
                sp,
                system_x,
                config,
                forced_width,
                &staff_ottavas,
                common_shortest_beats,
                &merged_spacings[local_index],
                forced_prefix,
                &[],
                local_index == 0,
            );
            system_x += layout.width;
            layout.part_index = flat_staff
                .sources
                .first()
                .map_or(0, |source| source.part_index);
            layout.is_first_on_system = local_index == 0;
            layout.show_system_objects = system_object_staves.contains(&staff_index);
            layout.is_first_staff = staff_index == 0;
            if let Some(&count) = mmr_start_map.get(&measure_index) {
                layout.multimeasure_rest_count = Some(count);
                layout.multimeasure_rest_label = mmr_label_map.get(&measure_index).cloned();
            }
            measure_layouts.push(layout);
        }
        all_staff_layouts.push(measure_layouts);
    }

    let visual_staves = flat_staves
        .iter()
        .map(|staff| {
            let part_index = staff.sources.first().map_or(0, |source| source.part_index);
            let staff_number = staff
                .sources
                .first()
                .and_then(|source| source.staff_number)
                .unwrap_or(1);
            (part_index, staff_number)
        })
        .collect::<Vec<_>>();
    fix_cross_staff_note_positions(&mut all_staff_layouts, &visual_staves, sp, config);
    all_staff_layouts
}

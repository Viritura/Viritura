use super::super::config::LayoutConfig;
use super::super::space_requests::{GapFloorConstraint, OnsetPaddingConstraint, SpaceReason};
use super::super::spacing::*;
use super::collectors::*;
use super::geometry_snapshot::{build_spacing_snapshot, SpacingSnapshot};
use super::timing::BeatKey;
use std::collections::{HashMap, HashSet};

/// Extract a measure's clef changes as `(beat, Clef)` pairs, sorted by beat,
/// for the accidental ledger-extent reservation. Returns an empty vector when
/// the measure declares no clefs (callers treat that as "no clef context").
fn clef_changes_for_part_measure(part_measure: &PartMeasure) -> Vec<(f64, Clef)> {
    let mut clef_changes: Vec<(f64, Clef)> = Vec::new();
    if let Some(clefs) = &part_measure.clefs {
        for pc in clefs {
            let beat = pc.position.as_ref().map_or(0.0, |pos| pos.beats());
            clef_changes.push((beat, pc.clef.clone()));
        }
    }
    clef_changes.sort_by(|a, b| a.0.total_cmp(&b.0));
    clef_changes
}

fn displaced_notehead_gap_floor(config: &LayoutConfig) -> f64 {
    let normal_extent = 2.0 * config.notehead_rx;
    let displaced_extent = 2.0 * normal_extent;
    displaced_extent + (config.min_note_spacing - normal_extent).max(0.0)
}

const CLUSTER_TIE_MIN_GAP_SP: f64 = 3.8;

/// Fixed-width material immediately before an onset, in staff spaces.
pub(crate) fn rigid_delta_before(spacing: &LogSpacing, beat: f64) -> f64 {
    let Some(index) = spacing
        .mapping
        .iter()
        .position(|(mapped_beat, _)| (*mapped_beat - beat).abs() < 0.001)
    else {
        return 0.0;
    };
    let current = spacing.rigid_widths.get(index).copied().unwrap_or(0.0);
    let previous = index
        .checked_sub(1)
        .and_then(|previous| spacing.rigid_widths.get(previous))
        .copied()
        .unwrap_or(0.0);
    (current - previous).max(0.0)
}

#[cfg(test)]
pub(crate) fn build_log_spacing_for_part_measure(
    part_measure: &PartMeasure,
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    active_key: &KeySignature,
) -> LogSpacing {
    let arpeggio_set = build_standard_arpeggio_set(&[part_measure]);
    let clef_changes = clef_changes_for_part_measure(part_measure);
    let beamed_ids = super::super::beams::collect_beamed_event_ids(part_measure);
    let suppressed_note_ids = HashSet::new();
    build_log_spacing_with_arpeggios(
        &part_measure.sequences,
        total_beats,
        common_shortest_beats,
        config,
        active_key,
        None,
        Some(&clef_changes),
        &arpeggio_set,
        &beamed_ids,
        &suppressed_note_ids,
        super::super::render_barlines::regular_trailing_barline_content_buffer_sp(config),
    )
}

pub(crate) fn build_log_spacing_for_resolved_measure(
    measure: &ResolvedMeasure,
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    is_system_start: bool,
) -> LogSpacing {
    let arpeggio_set = build_standard_arpeggio_set(&[&measure.part]);
    let clef_changes = clef_changes_for_part_measure(&measure.part);
    let beamed_ids = super::super::beams::collect_beamed_event_ids(&measure.part);
    let suppressed_note_ids = if is_system_start {
        HashSet::new()
    } else {
        measure.tie_continuation_ids.iter().cloned().collect()
    };
    build_log_spacing_with_arpeggios(
        &measure.part.sequences,
        total_beats,
        common_shortest_beats,
        config,
        &measure.active_key,
        measure.transposition,
        Some(&clef_changes),
        &arpeggio_set,
        &beamed_ids,
        &suppressed_note_ids,
        super::super::render_barlines::trailing_barline_content_buffer_sp(measure, config),
    )
}

pub(super) fn build_log_spacing_with_arpeggios(
    sequences: &[Sequence],
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    active_key: &KeySignature,
    transposition: Option<(i32, i32)>,
    clef_changes: Option<&[(f64, Clef)]>,
    standard_arpeggio_set: &HashSet<BeatKey>,
    beamed_event_ids: &HashSet<String>,
    suppressed_note_ids: &HashSet<String>,
    trailing_barline_buffer_sp: f64,
) -> LogSpacing {
    let all_sequences: Vec<&[Sequence]> = vec![sequences];
    let active_keys = [active_key];
    let transpositions = [transposition];
    let clef_changes = [clef_changes];
    let beamed_event_ids = [beamed_event_ids.clone()];
    let suppressed_note_ids = [suppressed_note_ids.clone()];
    build_spacing_from_sequences(
        &all_sequences,
        total_beats,
        common_shortest_beats,
        config,
        &active_keys,
        &transpositions,
        &clef_changes,
        standard_arpeggio_set,
        &beamed_event_ids,
        &suppressed_note_ids,
        trailing_barline_buffer_sp,
    )
}

#[cfg(test)]
pub(crate) fn build_merged_log_spacing_for_part_measures(
    part_measures: &[&PartMeasure],
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    active_keys: &[&KeySignature],
) -> LogSpacing {
    let all_sequences: Vec<&[Sequence]> = part_measures
        .iter()
        .map(|pm| pm.sequences.as_slice())
        .collect();
    let arpeggio_set = build_standard_arpeggio_set(part_measures);
    let clef_change_lists: Vec<Vec<(f64, Clef)>> = part_measures
        .iter()
        .map(|pm| clef_changes_for_part_measure(pm))
        .collect();
    let clef_refs: Vec<Option<&[(f64, Clef)]>> = clef_change_lists
        .iter()
        .map(|c| Some(c.as_slice()))
        .collect();
    let beamed_event_ids: Vec<HashSet<String>> = part_measures
        .iter()
        .map(|measure| super::super::beams::collect_beamed_event_ids(measure))
        .collect();
    let suppressed_note_ids = vec![HashSet::new(); part_measures.len()];
    let transpositions = vec![None; part_measures.len()];
    build_merged_log_spacing_with_arpeggios(
        &all_sequences,
        total_beats,
        common_shortest_beats,
        config,
        active_keys,
        &transpositions,
        &clef_refs,
        &arpeggio_set,
        &beamed_event_ids,
        &suppressed_note_ids,
        super::super::render_barlines::regular_trailing_barline_content_buffer_sp(config),
    )
}

pub(crate) fn build_merged_log_spacing_for_resolved_measures(
    measures: &[&ResolvedMeasure],
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    is_system_start: bool,
) -> LogSpacing {
    let part_measures: Vec<&PartMeasure> = measures.iter().map(|measure| &measure.part).collect();
    let all_sequences: Vec<&[Sequence]> = measures
        .iter()
        .map(|measure| measure.part.sequences.as_slice())
        .collect();
    let active_keys: Vec<&KeySignature> =
        measures.iter().map(|measure| &measure.active_key).collect();
    let transpositions: Vec<Option<(i32, i32)>> = measures
        .iter()
        .map(|measure| measure.transposition)
        .collect();
    let arpeggio_set = build_standard_arpeggio_set(&part_measures);
    let clef_change_lists: Vec<Vec<(f64, Clef)>> = measures
        .iter()
        .map(|measure| clef_changes_for_part_measure(&measure.part))
        .collect();
    let clef_refs: Vec<Option<&[(f64, Clef)]>> = clef_change_lists
        .iter()
        .map(|changes| Some(changes.as_slice()))
        .collect();
    let beamed_event_ids: Vec<HashSet<String>> = measures
        .iter()
        .map(|measure| super::super::beams::collect_beamed_event_ids(&measure.part))
        .collect();
    let suppressed_note_ids: Vec<HashSet<String>> = measures
        .iter()
        .map(|measure| {
            if is_system_start {
                HashSet::new()
            } else {
                measure.tie_continuation_ids.iter().cloned().collect()
            }
        })
        .collect();
    build_merged_log_spacing_with_arpeggios(
        &all_sequences,
        total_beats,
        common_shortest_beats,
        config,
        &active_keys,
        &transpositions,
        &clef_refs,
        &arpeggio_set,
        &beamed_event_ids,
        &suppressed_note_ids,
        measures
            .iter()
            .map(|measure| {
                super::super::render_barlines::trailing_barline_content_buffer_sp(measure, config)
            })
            .reduce(f64::min)
            .unwrap_or_else(|| {
                super::super::render_barlines::regular_trailing_barline_content_buffer_sp(config)
            }),
    )
}

pub(super) fn build_merged_log_spacing_with_arpeggios(
    all_sequences: &[&[Sequence]],
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    active_keys: &[&KeySignature],
    transpositions: &[Option<(i32, i32)>],
    clef_changes: &[Option<&[(f64, Clef)]>],
    standard_arpeggio_set: &HashSet<BeatKey>,
    beamed_event_ids: &[HashSet<String>],
    suppressed_note_ids: &[HashSet<String>],
    trailing_barline_buffer_sp: f64,
) -> LogSpacing {
    build_spacing_from_sequences(
        all_sequences,
        total_beats,
        common_shortest_beats,
        config,
        active_keys,
        transpositions,
        clef_changes,
        standard_arpeggio_set,
        beamed_event_ids,
        suppressed_note_ids,
        trailing_barline_buffer_sp,
    )
}

fn collect_mid_clef_columns(
    snapshot: &SpacingSnapshot<'_>,
    clef_changes: &[Option<&[(f64, Clef)]>],
) -> HashMap<BeatKey, f64> {
    let mut columns = HashMap::new();
    for (staff_index, changes) in clef_changes.iter().enumerate() {
        let Some(changes) = changes else {
            continue;
        };
        let staff_onsets = snapshot.staff_onsets.get(staff_index);
        for (beat, clef) in *changes {
            if *beat <= 0.001 {
                continue;
            }
            let target = staff_onsets
                .into_iter()
                .flatten()
                .copied()
                .find(|onset| onset.beats() >= *beat - 0.001);
            let Some(key) = target else {
                continue;
            };
            let width = super::super::measure::mid_clef_column_width_sp(clef);
            columns
                .entry(key)
                .and_modify(|current: &mut f64| *current = current.max(width))
                .or_insert(width);
        }
    }
    columns
}

fn build_spacing_from_sequences(
    all_sequences: &[&[Sequence]],
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    active_keys: &[&KeySignature],
    transpositions: &[Option<(i32, i32)>],
    clef_changes: &[Option<&[(f64, Clef)]>],
    standard_arpeggio_set: &HashSet<BeatKey>,
    beamed_event_ids: &[HashSet<String>],
    suppressed_note_ids: &[HashSet<String>],
    trailing_barline_buffer_sp: f64,
) -> LogSpacing {
    let snapshot = build_spacing_snapshot(
        all_sequences,
        active_keys,
        transpositions,
        clef_changes,
        beamed_event_ids,
        suppressed_note_ids,
        config,
    );
    let mut arp_set = snapshot.arpeggio_onsets.clone();
    arp_set.extend(standard_arpeggio_set.iter().copied());

    if snapshot.onsets.is_empty() {
        return LogSpacing {
            mapping: vec![(0.0, 0.0)],
            total_width: config.shortest_duration_space,
            rigid_widths: vec![0.0],
            rigid_total: 0.0,
            base_sp: config.sp,
        };
    }

    // Every owning staff maps a mid-measure clef to its next onset; the max
    // column width then applies to the shared rhythmic grid.
    let clef_columns = collect_mid_clef_columns(&snapshot, clef_changes);

    let mut mapping = Vec::new();
    let mut rigid_widths = Vec::new();
    let mut cum_width = 0.0;
    let mut cum_rigid = 0.0;

    for (index, &beat_key) in snapshot.onsets.iter().enumerate() {
        let onset = beat_key.beats();
        // A leading Space can make a positive-beat clef target the first visible
        // onset. There is no preceding rhythmic gap to consume, so reserve its
        // column directly before that onset.
        if index == 0 {
            if let Some(&clef_column) = clef_columns.get(&beat_key) {
                cum_width += clef_column;
                cum_rigid += clef_column;
            }
        }
        if let Some(&count) = snapshot.grace_counts.get(&beat_key) {
            let pad = grace_padding_sp(count, config);
            cum_width += pad;
            cum_rigid += pad;
        }
        if let Some(&width) = snapshot.accidental_extents.get(&beat_key) {
            let pad = accidental_padding_sp(width);
            if index > 0 {
                cum_rigid += pad;
                cum_rigid += 2.0 * config.notehead_rx;
                let previous_key = snapshot.onsets[index - 1];
                if snapshot.second_onsets.contains(&previous_key) {
                    cum_rigid += 2.0 * config.notehead_rx;
                }
            }
        }
        if let Some(&width) = snapshot.fermata_widths.get(&beat_key) {
            cum_width += fermata_left_overhang_sp(width, config);
        }
        if arp_set.contains(&beat_key) {
            let constraint = OnsetPaddingConstraint {
                width: arpeggio_padding_sp(config),
                rigid_floor: 0.0,
                reason: SpaceReason::Arpeggio,
            };
            cum_width += constraint.width;
            cum_rigid += constraint.rigid_floor;
        }

        mapping.push((onset, cum_width));
        rigid_widths.push(cum_rigid);

        let rigid_before_gap = cum_rigid;
        let next_key = snapshot.onsets.get(index + 1).copied();
        let next_onset = next_key.map(BeatKey::beats);
        let gap_beats = next_onset.unwrap_or(total_beats) - onset;
        let gap_width = log_duration_width(gap_beats, common_shortest_beats, config);
        let fermata_min = snapshot
            .fermata_widths
            .get(&beat_key)
            .map(|&width| fermata_min_gap_sp(width, config))
            .unwrap_or(0.0);
        let caesura_constraint =
            snapshot
                .caesura_widths
                .get(&beat_key)
                .map(|&width| GapFloorConstraint {
                    min_advance: caesura_min_gap_sp(width, config),
                    rigid: false,
                    reason: SpaceReason::Caesura,
                });
        let cross_staff_min = if snapshot.cross_staff_onsets.contains(&beat_key)
            || next_key.is_some_and(|key| snapshot.cross_staff_onsets.contains(&key))
        {
            config.min_note_spacing + 0.4
        } else {
            0.0
        };
        let previous_notehead_extent = if snapshot.second_onsets.contains(&beat_key) {
            4.0 * config.notehead_rx
        } else {
            2.0 * config.notehead_rx
        };
        let displaced_floor = if next_onset.is_some() && snapshot.second_onsets.contains(&beat_key)
        {
            displaced_notehead_gap_floor(config)
        } else {
            0.0
        };
        let accidental_floor = next_key
            .and_then(|key| {
                snapshot
                    .accidental_extents
                    .get(&key)
                    .map(|&width| previous_notehead_extent + accidental_padding_sp(width))
            })
            .unwrap_or(0.0);
        let accidental_ink_floor = next_key
            .and_then(|key| snapshot.accidental_ink_floors.get(&key))
            .copied()
            .unwrap_or(0.0);
        let notehead_floor = config
            .shortest_duration_space
            .max(2.0 * config.notehead_rx + 0.5);
        let collision_floor = config
            .min_note_spacing
            .max(notehead_floor)
            .max(cross_staff_min)
            .max(displaced_floor)
            .max(accidental_floor)
            .max(accidental_ink_floor);
        let clef_column = next_key
            .and_then(|key| clef_columns.get(&key))
            .copied()
            .unwrap_or(0.0);
        let clef_floor = if clef_column > 0.0 {
            collision_floor.max(
                snapshot
                    .right_ink_extents
                    .get(&beat_key)
                    .copied()
                    .unwrap_or(previous_notehead_extent),
            ) + clef_column
        } else {
            0.0
        };
        let tie_floor =
            if next_key.is_some_and(|key| snapshot.clustered_tie_gaps.contains(&(beat_key, key))) {
                CLUSTER_TIE_MIN_GAP_SP
            } else {
                0.0
            };

        let base_advance = gap_width
            .max(collision_floor)
            .max(fermata_min)
            .max(clef_floor)
            .max(tie_floor);
        let (mut gap_advance, mut gap_rigid) = caesura_constraint
            .map_or((base_advance, 0.0), |constraint| {
                constraint.reconcile(base_advance)
            });
        if next_onset.is_none() {
            const TRAILING_INK_CLEARANCE_SP: f64 = 0.5;
            let trailing_floor = snapshot
                .right_ink_extents
                .get(&beat_key)
                .copied()
                .unwrap_or(2.0 * config.notehead_rx)
                + TRAILING_INK_CLEARANCE_SP
                - trailing_barline_buffer_sp;
            let trailing = GapFloorConstraint {
                min_advance: trailing_floor.max(0.0),
                rigid: true,
                reason: SpaceReason::TrailingBarline,
            };
            (gap_advance, gap_rigid) = trailing.reconcile(gap_advance);
        }
        cum_width += gap_advance;
        // The clef column is physical ink clearance and must survive system
        // compression; only the surrounding rhythmic spring is elastic.
        cum_rigid += clef_column.min(gap_advance);
        cum_rigid += (accidental_ink_floor - accidental_floor)
            .max(0.0)
            .min(gap_advance);
        if displaced_floor > 0.0
            && next_key.is_none_or(|key| !snapshot.accidental_extents.contains_key(&key))
        {
            cum_rigid += displaced_floor.min(gap_advance);
        }
        let existing_gap_rigid = cum_rigid - rigid_before_gap;
        cum_rigid += (gap_rigid - existing_gap_rigid).max(0.0);
    }

    LogSpacing {
        mapping,
        total_width: cum_width,
        rigid_widths,
        rigid_total: cum_rigid,
        base_sp: config.sp,
    }
}

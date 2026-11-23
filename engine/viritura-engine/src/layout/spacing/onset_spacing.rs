use super::super::config::LayoutConfig;
use super::super::space_requests::{GapFloorConstraint, OnsetPaddingConstraint, SpaceReason};
use super::super::spacing::*;
use super::collectors::*;
use super::geometry_snapshot::{build_spacing_snapshot, SpacingSnapshot};
use super::timing::BeatKey;
use crate::render::smufl::smufl;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy)]
struct TrailingSpace {
    buffer_sp: f64,
    has_caesura: bool,
}

impl TrailingSpace {
    fn regular(config: &LayoutConfig) -> Self {
        Self {
            buffer_sp: super::super::render_barlines::regular_trailing_barline_content_buffer_sp(
                config,
            ),
            has_caesura: false,
        }
    }

    fn for_measure(measure: &ResolvedMeasure, config: &LayoutConfig) -> Self {
        let barline_buffer =
            super::super::render_barlines::trailing_barline_content_buffer_sp(measure, config);
        let Some(caesura) = &measure.global.caesura else {
            return Self {
                buffer_sp: barline_buffer,
                has_caesura: false,
            };
        };
        let glyph = smufl::caesura_glyph(&caesura.marking.style, caesura.marking.marks);
        let (_, _, width, _) = smufl::glyph_bbox(glyph);
        let caesura_buffer = super::super::measure::MEASURE_TRAILING_PADDING_SP
            + super::super::render_barlines::trailing_barline_extra_width(measure, config, 1.0)
            - width
            - super::super::render_articulations::CAESURA_RIGHT_PAD_SP;
        Self {
            buffer_sp: barline_buffer.min(caesura_buffer),
            has_caesura: true,
        }
    }

    fn merge(self, other: Self) -> Self {
        Self {
            buffer_sp: self.buffer_sp.min(other.buffer_sp),
            has_caesura: self.has_caesura || other.has_caesura,
        }
    }

    fn constrain_final_gap(
        self,
        snapshot: &SpacingSnapshot<'_>,
        beat: BeatKey,
        config: &LayoutConfig,
        advance: f64,
    ) -> (f64, f64) {
        const TRAILING_INK_CLEARANCE_SP: f64 = 0.5;
        let mut right_extent = snapshot
            .right_ink_extents
            .get(&beat)
            .copied()
            .unwrap_or(2.0 * config.notehead_rx);
        if let Some(width) = snapshot
            .fermata_widths
            .get(&beat)
            .filter(|_| self.has_caesura)
        {
            right_extent = right_extent.max(config.notehead_rx + width * 0.5);
        }
        let trailing_floor = right_extent + TRAILING_INK_CLEARANCE_SP - self.buffer_sp;
        GapFloorConstraint {
            min_advance: trailing_floor.max(0.0),
            rigid: true,
            reason: if self.has_caesura {
                SpaceReason::Caesura
            } else {
                SpaceReason::TrailingBarline
            },
        }
        .reconcile(advance)
    }
}

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
fn after_grace_gap_floor(
    snapshot: &SpacingSnapshot<'_>,
    beat_key: BeatKey,
    next_key: Option<BeatKey>,
) -> f64 {
    next_key
        .and_then(|key| {
            snapshot.grace_after_extents.get(&beat_key).map(|right| {
                right
                    + snapshot
                        .accidental_extents
                        .get(&key)
                        .map_or(0.3, |width| accidental_padding_sp(*width))
            })
        })
        .unwrap_or(0.0)
}

/// Fixed-width material since the preceding onset, in staff spaces.
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
        1.0,
        total_beats,
        common_shortest_beats,
        config,
        active_key,
        None,
        Some(&clef_changes),
        &arpeggio_set,
        &beamed_ids,
        &HashSet::new(),
        &suppressed_note_ids,
        None,
        TrailingSpace::regular(config),
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
    let auto_beamed_indices =
        super::super::measure::auto_beamed_event_indices_for_spacing(measure, config, total_beats);
    let suppressed_note_ids = if is_system_start {
        HashSet::new()
    } else {
        measure.tie_continuation_ids.iter().cloned().collect()
    };
    let ratio = measure
        .effective_staff_meter
        .as_ref()
        .map(|effective| effective.ratio_to_global.as_f64())
        .unwrap_or(1.0);
    let spacing = build_log_spacing_with_arpeggios(
        &measure.part.sequences,
        ratio,
        total_beats,
        common_shortest_beats,
        config,
        &measure.active_key,
        measure.display_transposition(),
        Some(&clef_changes),
        &arpeggio_set,
        &beamed_ids,
        &auto_beamed_indices,
        &suppressed_note_ids,
        measure.kit.as_ref(),
        TrailingSpace::for_measure(measure, config),
    );
    spacing
}

fn build_log_spacing_with_arpeggios(
    sequences: &[Sequence],
    ratio: f64,
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    active_key: &KeySignature,
    transposition: Option<(i32, i32)>,
    clef_changes: Option<&[(f64, Clef)]>,
    standard_arpeggio_set: &HashSet<BeatKey>,
    beamed_event_ids: &HashSet<String>,
    auto_beamed_indices: &HashSet<(usize, usize)>,
    suppressed_note_ids: &HashSet<String>,
    kit: Option<&HashMap<String, KitComponent>>,
    trailing_space: TrailingSpace,
) -> LogSpacing {
    let all_sequences: Vec<&[Sequence]> = vec![sequences];
    let staff_ratios = [ratio];
    let active_keys = [active_key];
    let transpositions = [transposition];
    let clef_changes = [clef_changes];
    let beamed_event_ids = [beamed_event_ids.clone()];
    let auto_beamed_indices = [auto_beamed_indices.clone()];
    let suppressed_note_ids = [suppressed_note_ids.clone()];
    build_spacing_from_sequences(
        &all_sequences,
        &staff_ratios,
        total_beats,
        common_shortest_beats,
        config,
        &active_keys,
        &transpositions,
        &clef_changes,
        standard_arpeggio_set,
        &beamed_event_ids,
        &auto_beamed_indices,
        &suppressed_note_ids,
        &[kit],
        trailing_space,
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
    let auto_beamed_indices = vec![HashSet::new(); part_measures.len()];
    let suppressed_note_ids = vec![HashSet::new(); part_measures.len()];
    let transpositions = vec![None; part_measures.len()];
    let staff_ratios = vec![1.0; part_measures.len()];
    build_merged_log_spacing_with_arpeggios(
        &all_sequences,
        &staff_ratios,
        total_beats,
        common_shortest_beats,
        config,
        active_keys,
        &transpositions,
        &clef_refs,
        &arpeggio_set,
        &beamed_event_ids,
        &auto_beamed_indices,
        &suppressed_note_ids,
        &vec![None; part_measures.len()],
        TrailingSpace::regular(config),
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
    let staff_ratios: Vec<f64> = measures
        .iter()
        .map(|measure| {
            measure
                .effective_staff_meter
                .as_ref()
                .map(|effective| effective.ratio_to_global.as_f64())
                .unwrap_or(1.0)
        })
        .collect();
    let active_keys: Vec<&KeySignature> =
        measures.iter().map(|measure| &measure.active_key).collect();
    let transpositions: Vec<Option<(i32, i32)>> = measures
        .iter()
        .map(|measure| measure.display_transposition())
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
    let auto_beamed_indices: Vec<HashSet<(usize, usize)>> = measures
        .iter()
        .map(|measure| {
            super::super::measure::auto_beamed_event_indices_for_spacing(
                measure,
                config,
                total_beats,
            )
        })
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
        &staff_ratios,
        total_beats,
        common_shortest_beats,
        config,
        &active_keys,
        &transpositions,
        &clef_refs,
        &arpeggio_set,
        &beamed_event_ids,
        &auto_beamed_indices,
        &suppressed_note_ids,
        &measures
            .iter()
            .map(|measure| measure.kit.as_ref())
            .collect::<Vec<_>>(),
        measures
            .iter()
            .map(|measure| TrailingSpace::for_measure(measure, config))
            .reduce(TrailingSpace::merge)
            .unwrap_or_else(|| TrailingSpace::regular(config)),
    )
}

fn build_merged_log_spacing_with_arpeggios(
    all_sequences: &[&[Sequence]],
    staff_ratios: &[f64],
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    active_keys: &[&KeySignature],
    transpositions: &[Option<(i32, i32)>],
    clef_changes: &[Option<&[(f64, Clef)]>],
    standard_arpeggio_set: &HashSet<BeatKey>,
    beamed_event_ids: &[HashSet<String>],
    auto_beamed_indices: &[HashSet<(usize, usize)>],
    suppressed_note_ids: &[HashSet<String>],
    kits: &[Option<&HashMap<String, KitComponent>>],
    trailing_space: TrailingSpace,
) -> LogSpacing {
    build_spacing_from_sequences(
        all_sequences,
        staff_ratios,
        total_beats,
        common_shortest_beats,
        config,
        active_keys,
        transpositions,
        clef_changes,
        standard_arpeggio_set,
        beamed_event_ids,
        auto_beamed_indices,
        suppressed_note_ids,
        kits,
        trailing_space,
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

fn extend_minimum_width(
    current: &mut f64,
    rigid_before: f64,
    rigid_after: f64,
    rhythmic_floor: f64,
    gap_floor: f64,
) {
    *current = (*current
        + (rigid_after - rigid_before)
            .max(0.0)
            .max(rhythmic_floor)
            .max(gap_floor))
    .max(rigid_after)
}

struct OnsetGapClearance {
    collision_floor: f64,
    previous_notehead_extent: f64,
    displaced_floor: f64,
    accidental_floor: f64,
    accidental_ink_floor: f64,
    rhythmic_ink_floor: f64,
    grace_after_floor: f64,
}

fn onset_gap_clearance(
    snapshot: &SpacingSnapshot<'_>,
    beat_key: BeatKey,
    next_key: Option<BeatKey>,
    config: &LayoutConfig,
) -> OnsetGapClearance {
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
    let note_marking_min = snapshot.note_slide_gap(beat_key, next_key, previous_notehead_extent);
    let displaced_floor = if next_key.is_some() && snapshot.second_onsets.contains(&beat_key) {
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
    let rhythmic_ink_floor = next_key
        .and_then(|key| snapshot.rhythmic_ink_floors.get(&key))
        .copied()
        .unwrap_or(0.0);
    let grace_after_floor = after_grace_gap_floor(snapshot, beat_key, next_key);
    let notehead_floor = config
        .shortest_duration_space
        .max(2.0 * config.notehead_rx + 0.5);
    let collision_floor = config
        .min_note_spacing
        .max(notehead_floor)
        .max(cross_staff_min)
        .max(note_marking_min)
        .max(displaced_floor)
        .max(accidental_floor)
        .max(accidental_ink_floor)
        .max(rhythmic_ink_floor)
        .max(grace_after_floor);
    OnsetGapClearance {
        collision_floor,
        previous_notehead_extent,
        displaced_floor,
        accidental_floor,
        accidental_ink_floor,
        rhythmic_ink_floor,
        grace_after_floor,
    }
}

fn build_spacing_from_sequences(
    all_sequences: &[&[Sequence]],
    staff_ratios: &[f64],
    total_beats: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    active_keys: &[&KeySignature],
    transpositions: &[Option<(i32, i32)>],
    clef_changes: &[Option<&[(f64, Clef)]>],
    standard_arpeggio_set: &HashSet<BeatKey>,
    beamed_event_ids: &[HashSet<String>],
    auto_beamed_indices: &[HashSet<(usize, usize)>],
    suppressed_note_ids: &[HashSet<String>],
    kits: &[Option<&HashMap<String, KitComponent>>],
    trailing_space: TrailingSpace,
) -> LogSpacing {
    let snapshot = build_spacing_snapshot(
        all_sequences,
        staff_ratios,
        active_keys,
        transpositions,
        clef_changes,
        beamed_event_ids,
        auto_beamed_indices,
        suppressed_note_ids,
        kits,
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
            minimum_widths: vec![0.0],
            minimum_total: 0.0,
            base_sp: config.sp,
        };
    }

    // Every owning staff maps a mid-measure clef to its next onset; the max
    // column width then applies to the shared rhythmic grid.
    let clef_columns = collect_mid_clef_columns(&snapshot, clef_changes);

    let mut mapping = Vec::new();
    let mut rigid_widths = Vec::new();
    let mut minimum_widths = Vec::new();
    let mut cum_width = 0.0;
    let mut cum_rigid = 0.0;
    let mut cum_minimum: f64 = 0.0;
    for (index, &beat_key) in snapshot.onsets.iter().enumerate() {
        let onset = beat_key.beats();
        // A leading Space can make a positive-beat clef target the first visible
        // onset. There is no preceding rhythmic gap to consume, so reserve its
        // column directly before that onset.
        if index == 0 {
            if let Some(&slide_left) = snapshot.note_slide_left.get(&beat_key) {
                cum_width += slide_left;
                cum_rigid += slide_left;
            }
            if let Some(&clef_column) = clef_columns.get(&beat_key) {
                cum_width += clef_column;
                cum_rigid += clef_column;
            }
        }
        if let Some(&pad) = snapshot.grace_padding.get(&beat_key) {
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

        cum_minimum = cum_minimum.max(cum_rigid);
        mapping.push((onset, cum_width));
        rigid_widths.push(cum_rigid);
        minimum_widths.push(cum_minimum);

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
        let clearance = onset_gap_clearance(&snapshot, beat_key, next_key, config);
        let clef_column = next_key
            .and_then(|key| clef_columns.get(&key))
            .copied()
            .unwrap_or(0.0);
        let clef_floor = if clef_column > 0.0 {
            clearance.collision_floor.max(
                snapshot
                    .right_ink_extents
                    .get(&beat_key)
                    .copied()
                    .unwrap_or(clearance.previous_notehead_extent),
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
            .max(clearance.collision_floor)
            .max(fermata_min)
            .max(clef_floor)
            .max(tie_floor);
        let (mut gap_advance, mut gap_rigid) = caesura_constraint
            .map_or((base_advance, 0.0), |constraint| {
                constraint.reconcile(base_advance)
            });
        if next_onset.is_none() {
            (gap_advance, gap_rigid) =
                trailing_space.constrain_final_gap(&snapshot, beat_key, config, gap_advance);
        }
        cum_width += gap_advance;
        // The clef column is physical ink clearance and must survive system
        // compression; only the surrounding rhythmic spring is elastic.
        cum_rigid += clef_column.min(gap_advance);
        cum_rigid += (clearance.accidental_ink_floor - clearance.accidental_floor)
            .max(0.0)
            .min(gap_advance);
        if clearance.displaced_floor > 0.0
            && next_key.is_none_or(|key| !snapshot.accidental_extents.contains_key(&key))
        {
            cum_rigid += clearance.displaced_floor.min(gap_advance);
        }
        let existing_gap_rigid = cum_rigid - rigid_before_gap;
        let grace_after_rigid = (clearance.grace_after_floor - clearance.accidental_floor).max(0.0);
        // After-grace ink and a following change clef occupy consecutive columns,
        // so compression must preserve their sum rather than their maximum.
        cum_rigid += (gap_rigid.max(grace_after_rigid + clef_column) - existing_gap_rigid).max(0.0);
        extend_minimum_width(
            &mut cum_minimum,
            rigid_before_gap,
            cum_rigid,
            clearance.rhythmic_ink_floor,
            gap_rigid,
        );
    }

    LogSpacing {
        mapping,
        total_width: cum_width,
        rigid_widths,
        rigid_total: cum_rigid,
        minimum_widths,
        minimum_total: cum_minimum.max(cum_rigid),
        base_sp: config.sp,
    }
}

#![allow(unused_imports)]

use super::super::arena::EventArena;
use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::resolve::*;
use super::super::skyline::{Skyline, SkylineDirection};
use super::super::spacing::*;
use super::super::types::*;
use super::cross_staff::*;
use super::helpers::*;
use super::prefix_width::{compute_max_prefix_width, prefix_layout, AlignedPrefix, PrefixContext};
use super::rest_conflicts::resolve_voice_rest_conflicts;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Padding around a mid-measure change clef. The spacing pass combines these
/// with the actual 2/3-size glyph width and raises the existing inter-onset gap
/// only when its rhythmic spring is too narrow.
pub(crate) const MID_CLEF_LEFT_PAD_SP: f64 = 0.5;
pub(crate) const MID_CLEF_RIGHT_PAD_SP: f64 = 0.4;

pub(crate) fn mid_clef_column_width_sp(clef: &Clef) -> f64 {
    MID_CLEF_LEFT_PAD_SP
        + super::super::render_signatures::change_clef_width_sp(clef)
        + MID_CLEF_RIGHT_PAD_SP
}

fn event_right_edge(
    events: &EventArena,
    index: usize,
    sp: f64,
    config: &LayoutConfig,
    is_beamed: bool,
) -> f64 {
    let event = events.event(index);
    let x = events.x(index);
    let codepoint = if event.is_rest() {
        smufl::rest_glyph(&event.duration.base)
    } else {
        smufl::notehead_glyph(&event.duration.base)
    };
    let glyph_right_extent = if event.is_rest() {
        smufl::glyph_bbox(codepoint).2
    } else {
        smufl::notehead_right_extent(codepoint)
    } * sp;
    let displacement = events
        .note_x_offsets(index)
        .iter()
        .copied()
        .fold(0.0_f64, f64::max)
        * config.notehead_rx
        * 2.0
        * sp;
    let mut right = x + displacement + glyph_right_extent;
    if let Some(dots) = event.duration.dots.filter(|dots| *dots > 0) {
        let dot_width = smufl::glyph_bbox(smufl::AUGMENTATION_DOT).2 * sp;
        right = right.max(
            x + displacement
                + glyph_right_extent
                + (0.4 + (dots - 1) as f64 * 0.5) * sp
                + dot_width,
        );
    }
    if !is_beamed && events.stem_up(index) {
        if let Some(flag) = smufl::flag_glyph(event.duration.base.flag_count(), true) {
            let notehead = smufl::notehead_glyph(&event.duration.base);
            let stem_x =
                x + smufl::stem_anchors(notehead).up_se.0 * sp - config.stem_width * sp * 0.5;
            let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(flag);
            right = right.max(stem_x + (bbox_x + bbox_w) * sp);
        }
    }
    right
}

pub(crate) fn layout_total_beats(rm: &ResolvedMeasure) -> f64 {
    let nominal = rm.active_time.measure_beats();
    if rm
        .global
        .time
        .as_ref()
        .is_some_and(|time| matches!(time.display, Some(TimeSignatureDisplay::SenzaMisura)))
    {
        // Standard engraving practice: senza misura has no fixed bar duration;
        // retain count/unit as the following meter but space all written content.
        return rm
            .part
            .sequences
            .iter()
            .filter(|seq| seq.full_measure.is_none())
            .map(|seq| sequence_content_total_beats(&seq.content, 1.0))
            .fold(nominal, f64::max);
    }
    let is_pickup = rm.index == 0 && matches!(rm.global.number, Some(0));
    if !is_pickup {
        return nominal;
    }

    let actual = rm
        .part
        .sequences
        .iter()
        .filter(|seq| seq.full_measure.is_none())
        .map(|seq| sequence_content_total_beats(&seq.content, 1.0))
        .fold(0.0_f64, f64::max);

    if actual > 1e-9 {
        actual.min(nominal)
    } else {
        nominal
    }
}

// ═══════════════════════════════════════════
// Measure layout
// ═══════════════════════════════════════════

pub(crate) fn layout_measure(
    rm: &ResolvedMeasure,
    sp: f64,
    start_x: f64,
    config: &LayoutConfig,
    forced_width: Option<f64>,
    resolved_ottavas: &[ResolvedOttavaRange],
    common_shortest_beats: f64,
) -> MeasureLayout {
    layout_measure_inner(
        rm,
        sp,
        start_x,
        config,
        forced_width,
        None,
        resolved_ottavas,
        common_shortest_beats,
        None,
        &[],
        true,
    )
}

/// Layout a measure with a shared LogSpacing for cross-staff beat alignment.
/// Optionally accepts a forced prefix width to align content origins across staves.
///
/// `part_mid_clef_beats` carries the union of mid-measure clef-change beats from
/// ALL staves of this measure's part (in quarter-note beats, >0). Every staff
/// opens the same gap at each such beat so a clef change on one staff of a grand
/// staff keeps the others vertically aligned (the glyph still renders only on the
/// owning staff). Pass `&[]` for single-staff / uncoordinated callers.
pub(crate) fn layout_measure_with_shared_spacing(
    rm: &ResolvedMeasure,
    sp: f64,
    start_x: f64,
    config: &LayoutConfig,
    forced_width: Option<f64>,
    resolved_ottavas: &[ResolvedOttavaRange],
    common_shortest_beats: f64,
    shared_spacing: &LogSpacing,
    forced_prefix: Option<AlignedPrefix>,
    part_mid_clef_beats: &[f64],
    is_system_start: bool,
) -> MeasureLayout {
    layout_measure_inner(
        rm,
        sp,
        start_x,
        config,
        forced_width,
        forced_prefix,
        resolved_ottavas,
        common_shortest_beats,
        Some(shared_spacing),
        part_mid_clef_beats,
        is_system_start,
    )
}

/// Pre-compute merged LogSpacing and max prefix widths for a system's measures
/// across all staves. This is the single source of truth for cross-staff beat
/// alignment — all layout entry points call this instead of duplicating the logic.
///
/// Returns `(merged_spacings, max_prefix_widths)`, both indexed by position in
/// `sys_measure_indices` (system-local index, not global measure index).
///
/// Standard engraving practice: max-distance principle across staves
/// (shared rhythmic-column positions across all staves of the system).
pub(crate) fn compute_system_spacing<R: AsRef<[ResolvedMeasure]>>(
    all_resolved: &[R],
    sys_measure_indices: &[usize],
    sp: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    // When `Some`, only parts whose index is in the set contribute to the
    // merged rhythmic spacing and prefix widths. Used by the explicit-pages
    // path, where `all_resolved` holds EVERY part in the document but only a
    // subset is shown in this score's systems — a single-part view must be
    // spaced for its own rhythm, not the cross-part onset union of the whole
    // orchestra (otherwise the merged spacing is sized for the busiest part
    // while `forced_width` is sized for the shown part, and notes spill past
    // their barlines). `None` = use every entry (the auto-flow path already
    // passes only the layout's staves).
    shown_parts: Option<&std::collections::HashSet<usize>>,
) -> (Vec<LogSpacing>, Vec<AlignedPrefix>) {
    let part_shown = |pi: usize| -> bool { shown_parts.is_none_or(|s| s.contains(&pi)) };
    let merged_spacings = sys_measure_indices
        .iter()
        .enumerate()
        .map(|(system_measure_index, &mi)| {
            let measures: Vec<&ResolvedMeasure> = all_resolved
                .iter()
                .enumerate()
                .filter(|(pi, _)| part_shown(*pi))
                .filter_map(|(_, resolved)| resolved.as_ref().get(mi))
                .collect();
            let total_beats = all_resolved
                .iter()
                .enumerate()
                .filter(|(pi, _)| part_shown(*pi))
                .filter_map(|(_, resolved)| resolved.as_ref().get(mi))
                .map(layout_total_beats)
                .reduce(f64::max)
                .unwrap_or(4.0);
            build_merged_log_spacing_for_resolved_measures(
                &measures,
                total_beats,
                common_shortest_beats,
                config,
                system_measure_index == 0,
            )
        })
        .collect();

    let max_prefix_widths = sys_measure_indices
        .iter()
        .enumerate()
        .map(|(si, &mi)| {
            let is_system_start = si == 0;
            compute_max_prefix_width(
                all_resolved
                    .iter()
                    .enumerate()
                    .filter(|(pi, _)| part_shown(*pi))
                    .filter_map(|(_, resolved)| resolved.as_ref().get(mi)),
                sp,
                is_system_start,
                config,
            )
        })
        .collect();

    (merged_spacings, max_prefix_widths)
}

/// Apply horizontal notehead offsets for multi-voice collisions.
///
/// For each pair of voice events that share an x position, compute the minimum
/// staff-position distance between any two notes. Decide whether to share
/// noteheads (pure unison, matching glyph) or shift the down-stem chord
/// (standard engraving practice §16, standard convention). Also handles crossed
/// voices where stems would visually overlap.
///
/// Refs:
///   -
///   -
#[allow(clippy::too_many_lines)] // single coherent collision algorithm; splitting would scatter the snapshot/decision/apply pipeline
pub(super) fn apply_multi_voice_horizontal_offsets(
    voice_layouts: &mut [VoiceLayout],
    config: &LayoutConfig,
    sp: f64,
) {
    if voice_layouts.len() < 2 {
        return;
    }
    let notehead_w = config.notehead_rx * 2.0 * sp;

    // Snapshot each voice's events as (x, positions, notehead glyph,
    // stem_up, is_whole, visual_staff). We snapshot up-front so mutations made
    // during the pair-wise pass don't affect comparisons. `visual_staff` is the
    // staff the event actually renders on (`event.staff` override, else the
    // parent sequence's staff) — multi-voice collisions only happen between
    // events sharing a visual staff, never across the staves of a grand staff
    // (their note positions are computed against different clefs and are not
    // comparable, so a cross-staff comparison would falsely displace notes).
    /// Per-event snapshot tuple:
    /// `(x, note_positions, notehead_cp, stem_up, is_whole, visual_staff)`.
    type VoiceEventSnapshot = (f64, Vec<f64>, u32, bool, bool, u32);
    let snapshots: Vec<Vec<VoiceEventSnapshot>> = voice_layouts
        .iter()
        .map(|vl| {
            (0..vl.events.len())
                .map(|i| {
                    let event = vl.events.event(i);
                    let is_whole = matches!(
                        event.duration.base,
                        crate::model::duration::NoteValueBase::Whole
                            | crate::model::duration::NoteValueBase::Breve
                            | crate::model::duration::NoteValueBase::Longa
                            | crate::model::duration::NoteValueBase::Maxima
                            | crate::model::duration::NoteValueBase::DuplexMaxima
                    );
                    let visual_staff = event.staff.unwrap_or(vl.events.sequence_staff(i));
                    (
                        vl.events.x(i),
                        vl.events.note_positions(i).to_vec(),
                        smufl::notehead_glyph(&event.duration.base),
                        vl.events.stem_up(i),
                        is_whole,
                        visual_staff,
                    )
                })
                .collect()
        })
        .collect();

    let mut x_shifts: Vec<Vec<f64>> = voice_layouts
        .iter()
        .map(|vl| vec![0.0; vl.events.len()])
        .collect();
    let mut share_requests: Vec<(usize, usize, usize)> = Vec::new();

    for i in 0..voice_layouts.len() {
        for j in (i + 1)..voice_layouts.len() {
            for (ei, (xi, pos_i, nh_i, stem_i, whole_i, staff_i)) in snapshots[i].iter().enumerate()
            {
                if pos_i.is_empty() {
                    continue;
                }
                for (ej, (xj, pos_j, nh_j, stem_j, whole_j, staff_j)) in
                    snapshots[j].iter().enumerate()
                {
                    if pos_j.is_empty() {
                        continue;
                    }
                    // Different visual staves never collide — their staff
                    // positions are clef-relative and not comparable.
                    if staff_i != staff_j {
                        continue;
                    }
                    if (xi - xj).abs() > 0.001 {
                        continue;
                    }

                    let mut min_diff = f64::INFINITY;
                    let mut has_unison = false;
                    let mut has_second = false;
                    for &pa in pos_i {
                        for &pb in pos_j {
                            let d = (pa - pb).abs();
                            if d < 0.001 {
                                has_unison = true;
                            } else if d <= 1.0 + 0.001 {
                                has_second = true;
                            }
                            if d < min_diff {
                                min_diff = d;
                            }
                        }
                    }

                    if min_diff > 1.0 + 0.001 {
                        // No notehead collision (third+ apart). But check
                        // for CROSSED voices where stems would overlap.
                        if stem_i == stem_j {
                            continue;
                        }
                        let (up_pos, down_pos) = if *stem_i {
                            (pos_i, pos_j)
                        } else {
                            (pos_j, pos_i)
                        };
                        let up_lowest = up_pos.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                        let down_highest = down_pos.iter().cloned().fold(f64::INFINITY, f64::min);
                        if up_lowest < down_highest - 0.001 {
                            continue;
                        }
                        if up_lowest - down_highest > 7.0 + 0.001 {
                            continue;
                        }
                    }

                    // Opposite stems: shift down-stem voice (standard engraving).
                    // Same stems: shift the higher-indexed voice.
                    let shift_target_voice = if stem_i != stem_j {
                        if !*stem_i {
                            i
                        } else {
                            j
                        }
                    } else {
                        j
                    };
                    let shift_target_ev = if shift_target_voice == i { ei } else { ej };

                    // Pure unison (no second clash) — try to share.
                    if has_unison && !has_second {
                        let same_notehead = nh_i == nh_j;
                        let whole_mismatch = whole_i != whole_j;
                        if same_notehead && !whole_mismatch {
                            let (share_voice, share_ev, other_positions) =
                                if shift_target_voice == i {
                                    (i, ei, pos_j)
                                } else {
                                    (j, ej, pos_i)
                                };
                            let target_positions = if share_voice == i { pos_i } else { pos_j };
                            for (ni, &p) in target_positions.iter().enumerate() {
                                if other_positions.iter().any(|&po| (po - p).abs() < 0.001) {
                                    share_requests.push((share_voice, share_ev, ni));
                                }
                            }
                            continue;
                        }
                    }

                    // Shift target chord right by one notehead width.
                    let cur = x_shifts[shift_target_voice][shift_target_ev];
                    if notehead_w > cur {
                        x_shifts[shift_target_voice][shift_target_ev] = notehead_w;
                    }
                }
            }
        }
    }

    for (vi, vl) in voice_layouts.iter_mut().enumerate() {
        // `ei` indexes the parallel `x_shifts[vi]` vec as well as the SoA
        // event accessors; an iterator can't span both.
        #[allow(clippy::needless_range_loop)]
        for ei in 0..vl.events.len() {
            let shift = x_shifts[vi][ei];
            if shift != 0.0 {
                vl.events.set_x(ei, vl.events.x(ei) + shift);
            }
        }
    }

    for (vi, ei, ni) in share_requests {
        if let Some(vl) = voice_layouts.get_mut(vi) {
            if ei < vl.events.len() {
                let sh = vl.events.shared_noteheads_mut(ei);
                if ni < sh.len() {
                    sh[ni] = true;
                }
            }
        }
    }
}

/// Normalize stem direction across beam groups.
///
/// `render_beams` uses `beam_events[0].stem_up` for the whole group, but each
/// event's `stem_up` is computed independently based on its own note position.
/// Events 2+ in a group may therefore have a different `stem_up` than event 0,
/// causing slurs and articulations attached to those events to read the wrong
/// value (standard engraving convention: slur is opposite the stem). Propagate the first
/// event's `stem_up` to every event in the group, matching beams.rs.
pub(super) fn normalize_beam_group_stem_directions(
    voice_layouts: &mut [VoiceLayout],
    rm: &ResolvedMeasure,
) -> HashSet<String> {
    use std::collections::HashSet;
    let beams_owned: Vec<Beam>;
    let beams: &[Beam] = if let Some(b) = rm.part.beams.as_ref() {
        b.as_slice()
    } else {
        beams_owned =
            super::super::beams::auto_beam_groups(voice_layouts, &rm.active_time, &HashSet::new());
        &beams_owned
    };
    let beamed_ids: HashSet<String> = beams
        .iter()
        .flat_map(|beam| beam.events.iter().cloned())
        .collect();
    for beam in beams {
        let first_stem_up = beam.events.iter().find_map(|id| {
            voice_layouts.iter().find_map(|vl| {
                (0..vl.events.len())
                    .find(|&i| vl.events.id(i) == Some(id.as_str()))
                    .map(|i| vl.events.stem_up(i))
            })
        });
        let Some(stem_up) = first_stem_up else {
            continue;
        };
        for id in &beam.events {
            for vl in voice_layouts.iter_mut() {
                for i in 0..vl.events.len() {
                    if vl.events.id(i) == Some(id.as_str()) {
                        // Flipping the stem direction also flips which side of
                        // the stem a second-interval notehead is displaced to
                        // (stem-up displaces the upper note right, stem-down the
                        // lower note left). The `note_x_offsets` were computed in
                        // `layout_sequence_content` with this event's ORIGINAL
                        // stem direction; if the beam-group normalization changes
                        // it, recompute them or the displaced noteheads end up on
                        // the wrong side, detached from the stem by a notehead
                        // width (standard engraving practice; the cause of
                        // "floating" cluster noteheads in beamed chords).
                        if vl.events.stem_up(i) != stem_up {
                            vl.events.set_stem_up(i, stem_up);
                            let positions = vl.events.note_positions(i).to_vec();
                            let new_offsets = compute_seconds_displacement(&positions, stem_up);
                            vl.events
                                .note_x_offsets_mut(i)
                                .copy_from_slice(&new_offsets);
                        }
                    }
                }
            }
        }
    }
    beamed_ids
}

/// Lay out a single voice (sequence) within a measure, producing a `VoiceLayout`.
/// Handles full-measure rests, single-rest measures, and general sequence content;
/// also positions grace notes and applies stem-direction optical correction.
#[allow(clippy::too_many_arguments)]
pub(super) fn layout_voice_for_measure(
    seq: &Sequence,
    vi: usize,
    rm: &ResolvedMeasure,
    num_voices: usize,
    sp: f64,
    config: &LayoutConfig,
    start_x: f64,
    prefix_width: f64,
    content_width: f64,
    measure_width: f64,
    has_visible_prefix: bool,
    total_beats: f64,
    clef_changes: &[(f64, Clef)],
    resolved_ottavas: &[ResolvedOttavaRange],
    log_spacing: &LogSpacing,
) -> VoiceLayout {
    let mut events = Vec::new();
    let mut tuplet_groups = Vec::new();
    let mut multi_note_tremolo_groups = Vec::new();
    let mut beat_cursor: f64 = 0.0;
    let seq_staff = seq.staff.unwrap_or(1);
    let bar_rest_center_x = if has_visible_prefix {
        start_x + prefix_width + content_width * 0.5
    } else {
        start_x + measure_width * 0.5
    };

    // A measure-repeat sign supersedes bar-rest notation. Preserve any actual
    // notes or shorter rests MNX explicitly places alongside the sign, but hide
    // both forms of a full-bar rest.
    if rm.measure_repeat_covered && seq.full_measure.is_some() {
        // No event layout: render_measure_repeat supplies the visible marking.
    } else if let Some(ref fm) = seq.full_measure {
        let rest_event = Event {
            duration: fm.visual_duration.clone(),
            id: None,
            notes: None,
            rest: Some(Rest {
                staff_position: fm.staff_position,
            }),
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        };
        events.push(EventLayout {
            x: bar_rest_center_x,
            event: rest_event,
            note_positions: vec![],
            note_x_offsets: vec![],
            shared_noteheads: vec![],
            shared_rest: false,
            display_pitches: vec![],
            stem_up: true,
            id: None,
            grace_notes: Vec::new(),
            num_voices,
            sequence_staff: seq_staff,
            beat_position: 0.0,
        });
    } else if rm.measure_repeat_covered
        && seq.content.len() == 1
        && seq.content[0].as_event().is_some_and(|event| {
            event.is_rest() && event.duration.total_beats() >= total_beats - 1e-9
        })
    {
        // Explicit whole-bar rest: the repeat sign is the sole visible content.
    } else if seq.content.len() == 1
        && seq.content[0].as_event().is_some_and(|event| {
            event.is_rest() && event.duration.total_beats() >= total_beats - 1e-9
        })
    {
        // Single rest filling the measure — center it like a fullMeasure rest
        if let Some(event) = seq.content[0].as_event() {
            events.push(EventLayout {
                x: bar_rest_center_x,
                event: event.clone(),
                note_positions: vec![],
                note_x_offsets: vec![],
                shared_noteheads: vec![],
                shared_rest: false,
                display_pitches: vec![],
                stem_up: true,
                id: event_layout_id(event, rm.index, vi, events.len()),
                grace_notes: Vec::new(),
                num_voices,
                sequence_staff: seq_staff,
                beat_position: 0.0,
            });
        }
    } else {
        let mut pending_grace: Vec<GraceNoteLayout> = Vec::new();
        layout_sequence_content(
            &seq.content,
            &mut events,
            &mut tuplet_groups,
            &mut multi_note_tremolo_groups,
            &mut beat_cursor,
            &mut pending_grace,
            1.0, // no duration scaling at top level
            total_beats,
            content_width,
            start_x + prefix_width,
            clef_changes,
            num_voices,
            vi,
            rm.index,
            resolved_ottavas,
            log_spacing,
            // sequence.orient overrides forced_stem_up from layout source
            seq.orient
                .and_then(|o| o.force_stem_up())
                .or(seq.forced_stem_up),
            seq_staff,
            rm.transposition,
            rm.kit.as_ref(),
        );

        if !pending_grace.is_empty() {
            if let Some(last_event) = events.last_mut() {
                for grace in &mut pending_grace {
                    grace.after_main = true;
                }
                last_event.grace_notes.append(&mut pending_grace);
            }
        }
    }

    // Position grace notes around their main event.
    let grace_scale = 0.65;
    let grace_nw = config.notehead_rx * 2.0 * grace_scale * sp;
    let grace_spacing = 0.3 * sp;
    let grace_to_main = 1.2 * sp; // enough room for flag + clearance
    for el in &mut events {
        let before = el.grace_notes.iter().filter(|gn| !gn.after_main).count();
        let after = el.grace_notes.iter().filter(|gn| gn.after_main).count();
        if before > 0 {
            // The main event's accidental column is drawn to the LEFT of its
            // notehead (el.x). Grace notes must clear that column too, or they
            // collide with the accidental. Reserve its extent on top of the
            // base flag clearance. Uses the same key-aware estimate as the
            // measure spacing reservation.
            let acc_extent = el
                .event
                .notes
                .as_ref()
                .map(|notes| {
                    event_accidental_extent_sp(
                        notes,
                        &rm.active_key,
                        &mut HashMap::new(),
                        None,
                        0.0,
                        None,
                    ) * sp
                })
                .unwrap_or(0.0);
            let total_w = before as f64 * grace_nw
                + (before as f64 - 1.0).max(0.0) * grace_spacing
                + grace_to_main
                + acc_extent;
            let mut gx = el.x - total_w;
            for gn in &mut el.grace_notes {
                if gn.after_main {
                    continue;
                }
                gn.x = gx;
                gx += grace_nw + grace_spacing;
            }
        }
        if after > 0 {
            let main_w = smufl::notehead_width(smufl::notehead_glyph(&el.event.duration.base)) * sp;
            let mut gx = el.x + main_w + grace_to_main;
            for gn in &mut el.grace_notes {
                if !gn.after_main {
                    continue;
                }
                gn.x = gx;
                gx += grace_nw + grace_spacing;
            }
        }
    }

    VoiceLayout {
        voice_index: vi,
        events: super::super::arena::EventArena::from_events(events),
        tuplet_groups,
        multi_note_tremolo_groups,
        part_index_override: seq.source_part_index,
        seq_index_override: seq.source_seq_index,
    }
}

pub(super) fn layout_measure_inner(
    rm: &ResolvedMeasure,
    sp: f64,
    start_x: f64,
    config: &LayoutConfig,
    forced_width: Option<f64>,
    forced_prefix: Option<AlignedPrefix>,
    resolved_ottavas: &[ResolvedOttavaRange],
    common_shortest_beats: f64,
    shared_log_spacing: Option<&LogSpacing>,
    part_mid_clef_beats: &[f64],
    is_system_start: bool,
) -> MeasureLayout {
    let is_first = rm.index == 0;
    let is_pickup = is_first && matches!(rm.global.number, Some(0));
    let prefix = prefix_layout(
        rm,
        sp,
        is_system_start,
        forced_prefix,
        None,
        PrefixContext::MeasureLayout,
        config,
    );
    let prefix_width = prefix.width;
    let bar_rest_has_visible_prefix = is_system_start
        || is_first
        || rm.global.repeat_start.is_some()
        || rm.global.key.is_some()
        || rm.global.time.is_some()
        || prefix.leading_clef_gap > 0.0;

    // For pickup bar 0, spacing should reflect only notated anacrusis duration.
    let total_beats = layout_total_beats(rm);
    let mut clef_changes: Vec<(f64, Clef)> = Vec::new();
    if let Some(clefs) = &rm.part.clefs {
        for pc in clefs {
            let beat = if let Some(ref pos) = pc.position {
                pos.beats()
            } else {
                0.0
            };
            clef_changes.push((beat, pc.clef.clone()));
        }
    }
    if clef_changes.is_empty() {
        clef_changes.push((
            0.0,
            Clef {
                sign: ClefSign::G,
                staff_position: -2,
                color: None,
                glyph: None,
                octave: None,
                show_octave: None,
            },
        ));
    }
    clef_changes.sort_by(|a, b| a.0.total_cmp(&b.0));

    // The shared spacing map already carries the system-wide conditional clef
    // clearance. Keep the beat union here only to place glyphs on owning staves.
    let mut gap_beats: Vec<f64> = clef_changes
        .iter()
        .map(|(b, _)| *b)
        .filter(|b| *b > 0.001)
        .chain(part_mid_clef_beats.iter().copied().filter(|b| *b > 0.001))
        .collect();
    gap_beats.sort_by(f64::total_cmp);
    gap_beats.dedup_by(|a, b| (*a - *b).abs() < 0.001);

    // Layout each voice (sequence)
    let mut voice_layouts = Vec::new();
    let num_voices = rm.part.sequences.len();

    // Build logarithmic spacing map from all voices in this measure,
    // or use a shared spacing map for cross-staff beat alignment.
    let local_log_spacing;
    let log_spacing = if let Some(shared) = shared_log_spacing {
        shared
    } else {
        local_log_spacing = build_log_spacing_for_resolved_measure(
            rm,
            total_beats,
            common_shortest_beats,
            config,
            is_system_start,
        );
        &local_log_spacing
    };

    let min_content_width = if is_pickup { 1.5 * sp } else { 4.0 * sp };
    let trailing_barline_extra =
        super::super::render_barlines::trailing_barline_extra_width(rm, config, sp);
    let natural_content_width = {
        let proportional = (log_spacing.total_width * sp).max(min_content_width);
        // Use skyline-based minimum to ensure no column collisions
        let skyline_min = skyline_min_content_width(
            &rm.part.sequences,
            total_beats,
            &rm.active_key,
            config,
            sp,
            common_shortest_beats,
        );
        proportional.max(skyline_min)
    };
    let content_width = if let Some(fw) = forced_width {
        // The forced width already includes structural barline overhead from
        // the natural-width and system-justification passes.
        (fw - prefix_width - super::MEASURE_TRAILING_PADDING_SP * sp - trailing_barline_extra)
            .max(min_content_width)
    } else {
        natural_content_width
    };
    let measure_width = forced_width.unwrap_or(
        prefix_width
            + content_width
            + super::MEASURE_TRAILING_PADDING_SP * sp
            + trailing_barline_extra,
    );

    for (vi, seq) in rm.part.sequences.iter().enumerate() {
        let vl = layout_voice_for_measure(
            seq,
            vi,
            rm,
            num_voices,
            sp,
            config,
            start_x,
            prefix_width,
            content_width,
            measure_width,
            bar_rest_has_visible_prefix,
            total_beats,
            &clef_changes,
            resolved_ottavas,
            log_spacing,
        );
        voice_layouts.push(vl);
    }

    // Normalize stem direction across beam groups (see helper for rationale).
    let beamed_ids = normalize_beam_group_stem_directions(&mut voice_layouts, rm);

    // Apply horizontal notehead offsets for multi-voice collisions.
    // See `apply_multi_voice_horizontal_offsets` for the algorithm details.
    apply_multi_voice_horizontal_offsets(&mut voice_layouts, config, sp);

    // Resolve vertical rest conflicts in multi-voice contexts.
    if voice_layouts.len() >= 2 {
        resolve_voice_rest_conflicts(&mut voice_layouts);
    }

    // Place mid-measure clefs inside the clearance already reserved by the
    // shared spacing map. No post-layout event shift is needed.
    let mut mid_clef_layouts: Vec<MidClefChange> = Vec::new();

    for &beat in &gap_beats {
        // `gap_beats` is the part-level union (all entries > 0.001).
        // Anchor the clef on the actual x of the first event at or after the
        // change's beat, rather than interpolating the beat linearly across the
        // measure. Note spacing is logarithmic and tuplets place onsets at
        // non-integer beats, so a linear beat→x mapping drifts away from the
        // real note positions — most visibly when the change follows a triplet.
        // `beat_position` and `beat` are both in quarter-note beats.
        let target_event = voice_layouts
            .iter()
            .flat_map(|vl| {
                (0..vl.events.len())
                    .filter(|&i| vl.events.beat_position(i) >= beat - 0.001)
                    .map(|i| (vl.events.beat_position(i), vl.events.x(i)))
            })
            .min_by(|left, right| left.1.total_cmp(&right.1));

        // Render the clef glyph only when THIS staff owns a change at this beat;
        // sibling-driven clearance only keeps rhythmic columns aligned.
        if let Some((_, clef)) = clef_changes
            .iter()
            .find(|(b, _)| *b > 0.001 && (*b - beat).abs() < 0.001)
        {
            let target_x = target_event
                .map(|(_, x)| x)
                .unwrap_or(start_x + prefix_width + content_width);
            let column_width = mid_clef_column_width_sp(clef) * sp;
            let fixed_material = target_event
                .map(|(target_beat, _)| rigid_delta_before(log_spacing, target_beat) * sp)
                .unwrap_or(column_width);
            let preceding_right = voice_layouts
                .iter()
                .flat_map(|voice| {
                    (0..voice.events.len())
                        .filter(|&index| voice.events.beat_position(index) < beat - 0.001)
                        .map(|index| {
                            let is_beamed = voice
                                .events
                                .id(index)
                                .is_some_and(|id| beamed_ids.contains(id));
                            event_right_edge(&voice.events, index, sp, config, is_beamed)
                        })
                })
                .max_by(f64::total_cmp);
            let preferred_x = target_x - fixed_material.max(column_width);
            let x = preceding_right.map_or(preferred_x, |right| {
                // Standard engraving practice: a change clef sits between the
                // adjacent event ink, never on top of the preceding chord.
                let minimum_glyph_x = right + MID_CLEF_LEFT_PAD_SP * sp;
                preferred_x.max(minimum_glyph_x - MID_CLEF_LEFT_PAD_SP * sp)
            });
            mid_clef_layouts.push(MidClefChange {
                clef: clef.clone(),
                x,
            });
        }
    }

    MeasureLayout {
        x: start_x,
        width: measure_width,
        resolved: rm.clone(),
        voice_layouts,
        prefix_width,
        first_onset_padding: prefix.first_onset_padding,
        time_signature_x_offset: prefix.time_signature_x_offset,
        trailing_barline_extra,
        mid_clef_changes: mid_clef_layouts,
        multimeasure_rest_count: None,
        multimeasure_rest_label: None,
        part_index: 0,
        is_first_on_system: false,
        show_system_objects: true,
        is_first_staff: true,
    }
}

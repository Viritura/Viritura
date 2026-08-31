#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::types::*;
use super::grouping::*;
use super::render::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

pub(crate) enum BeamSegment {
    /// Full beam connecting notes from start to end indices.
    Full { start: usize, end: usize },
    /// Beamlet (partial beam) on a single note. `right` = extends rightward.
    Hook { index: usize, right: bool },
}

/// Find contiguous sub-groups of events that have at least `min_level` beams.
/// Returns `BeamSegment` entries: full beams for multi-note runs, hooks for
/// isolated single notes (beamlets pointing toward the nearest neighbor).
pub(crate) fn find_beam_sub_groups(
    beam_events: &[&EventLayout],
    min_level: u32,
) -> Vec<BeamSegment> {
    let mut groups = Vec::new();
    let mut start: Option<usize> = None;

    for (i, el) in beam_events.iter().enumerate() {
        let level = el.event.duration.base.flag_count();
        if level >= min_level {
            if start.is_none() {
                start = Some(i);
            }
        } else {
            if let Some(s) = start {
                if i - 1 > s {
                    groups.push(BeamSegment::Full {
                        start: s,
                        end: i - 1,
                    });
                } else {
                    // Single note — draw a beamlet toward the nearest neighbor.
                    // First note in group → right; otherwise → left.
                    let right = s == 0;
                    groups.push(BeamSegment::Hook { index: s, right });
                }
            }
            start = None;
        }
    }

    // Close any open group
    if let Some(s) = start {
        let end = beam_events.len() - 1;
        if end > s {
            groups.push(BeamSegment::Full { start: s, end });
        } else {
            // Single note at end of group — hook points left
            groups.push(BeamSegment::Hook {
                index: s,
                right: false,
            });
        }
    }

    groups
}

/// Collect explicit beam hook directions from MNX inner beams.
/// Returns a map of event ID → is_right for each explicitly directed beamlet.
/// `BeamHookDirection::Auto` is treated as "no explicit override" so the
/// engraver can decide based on rhythmic context (per MNX spec).
pub(crate) fn collect_explicit_hooks(beam: &Beam) -> HashMap<String, bool> {
    let mut hooks = HashMap::new();
    for inner in &beam.beams {
        if let Some(ref dir) = inner.direction {
            match dir {
                BeamHookDirection::Right => {
                    for event_id in &inner.events {
                        hooks.insert(event_id.clone(), true);
                    }
                }
                BeamHookDirection::Left => {
                    for event_id in &inner.events {
                        hooks.insert(event_id.clone(), false);
                    }
                }
                BeamHookDirection::Auto => {
                    // intentional: skip — let the engraver's auto-detect run
                }
            }
        }
        // Recurse for deeper nested beams
        hooks.extend(collect_explicit_hooks(inner));
    }
    hooks
}

/// Extract explicit sub-beam groups per level from the MNX beam hierarchy.
///
/// Returns a Vec where index 0 = groups for beam level 1 (secondary),
/// index 1 = groups for beam level 2 (tertiary), etc.
/// Each entry is a Vec of event ID sets representing sub-groups at that level.
pub(crate) fn collect_explicit_beam_groups(beam: &Beam) -> Vec<Vec<HashSet<String>>> {
    let mut result: Vec<Vec<HashSet<String>>> = Vec::new();
    collect_beam_groups_recursive(&beam.beams, 0, &mut result);
    result
}

pub(crate) fn collect_beam_groups_recursive(
    inner_beams: &[Beam],
    depth: usize,
    result: &mut Vec<Vec<HashSet<String>>>,
) {
    if inner_beams.is_empty() {
        return;
    }
    while result.len() <= depth {
        result.push(Vec::new());
    }
    for inner in inner_beams {
        // Skip beamlet (hook) entries — they have a direction field
        if inner.direction.is_some() {
            continue;
        }
        let group: HashSet<String> = inner.events.iter().cloned().collect();
        result[depth].push(group);
        collect_beam_groups_recursive(&inner.beams, depth + 1, result);
    }
}

/// Compute indices after which secondary beams should break, based on
/// explicit MNX sub-beam groups.
///
/// For each pair of consecutive events in `beam_events`, if they belong to
/// different explicit groups, insert a break after the first event's index.
pub(crate) fn compute_beam_break_indices(
    beam_events: &[&EventLayout],
    groups: &[HashSet<String>],
) -> HashSet<usize> {
    let mut breaks = HashSet::new();
    for i in 0..beam_events.len().saturating_sub(1) {
        let id_i = beam_events[i].id.as_deref().unwrap_or("");
        let id_next = beam_events[i + 1].id.as_deref().unwrap_or("");
        let same_group = groups
            .iter()
            .any(|g| g.contains(id_i) && g.contains(id_next));
        if !same_group {
            breaks.insert(i);
        }
    }
    breaks
}

/// Compute implied beam break indices based on time-signature grouping.
///
/// When no explicit sub-beam groups are provided, breaks secondary+ beams
/// at metric sub-beat boundaries determined by the time signature.
/// `level` is 1-indexed (1 = secondary, 2 = tertiary, etc.).
pub(crate) fn compute_implied_beam_breaks(
    beam_events: &[&EventLayout],
    voice_onset_times: &HashMap<String, f64>,
    time_sig: &TimeSignature,
    level: u32,
) -> HashSet<usize> {
    let mut breaks = HashSet::new();
    if beam_events.is_empty() || level == 0 {
        return breaks;
    }

    // Beat duration in quarter-note beats
    let beat_duration = 4.0 / time_sig.unit as f64;

    // Sub-group boundary size: beat_duration / 2^level
    let divisor = (1u64 << level) as f64;
    let boundary = beat_duration / divisor;
    if boundary <= 0.0001 {
        return breaks;
    }

    // Look up onset time of the first beam event; fall back to 0.0
    let first_onset = beam_events[0]
        .id
        .as_deref()
        .and_then(|id| voice_onset_times.get(id).copied())
        .unwrap_or(0.0);

    // Compute onset times for each beam event by accumulating durations
    let mut onset = first_onset;
    let mut onsets = Vec::with_capacity(beam_events.len());
    for el in beam_events {
        onsets.push(onset);
        onset += el.event.duration.total_beats();
    }

    // Break between consecutive events that fall in different boundary groups
    for i in 0..beam_events.len().saturating_sub(1) {
        let group_i = (onsets[i] / boundary + 0.0001).floor() as i64;
        let group_next = (onsets[i + 1] / boundary + 0.0001).floor() as i64;
        if group_i != group_next {
            breaks.insert(i);
        }
    }

    breaks
}

/// Split beam segments at explicit break points.
///
/// Full segments that span a break index are split into separate segments.
/// Hooks pass through unchanged.
pub(crate) fn split_segments_at_breaks(
    segments: Vec<BeamSegment>,
    break_after: &HashSet<usize>,
) -> Vec<BeamSegment> {
    if break_after.is_empty() {
        return segments;
    }
    let mut result = Vec::new();
    for seg in segments {
        match seg {
            BeamSegment::Full { start, end } => {
                let mut sub_start = start;
                for i in start..end {
                    if break_after.contains(&i) {
                        if i > sub_start {
                            result.push(BeamSegment::Full {
                                start: sub_start,
                                end: i,
                            });
                        } else {
                            // Single note — beamlet toward nearest neighbor
                            let right = sub_start == 0;
                            result.push(BeamSegment::Hook {
                                index: sub_start,
                                right,
                            });
                        }
                        sub_start = i + 1;
                    }
                }
                // Close remaining run
                if end > sub_start {
                    result.push(BeamSegment::Full {
                        start: sub_start,
                        end,
                    });
                } else if sub_start <= end {
                    let right = sub_start == 0;
                    result.push(BeamSegment::Hook {
                        index: sub_start,
                        right,
                    });
                }
            }
            hook => result.push(hook),
        }
    }
    result
}

/// Render beam groups that span across barlines.
///
/// Iterates all measures to find beam groups where not all events are in the
/// declaring measure. Collects EventLayouts from all measures and renders the
/// beam group across measure boundaries.
///
/// TODO(cross-staff): this path anchors every beamed event to the single
/// `staff_y` baseline and does not yet honor per-event `staff` overrides. A
/// beam that BOTH crosses a barline AND crosses staves will be mis-placed.
/// Within-measure cross-staff beams are handled correctly in
/// `render_between_staff_beam` (beams/render.rs). To fix this case, thread
/// `staff_y_offsets` through and resolve each event's Y via
/// `render_measure::cross_staff_y`, mirroring `render_beams`.
pub(crate) fn render_cross_barline_beams(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    // Build a global map of event ID → EventLayout reference across all measures
    let all_events: Vec<EventLayout> = measure_layouts
        .iter()
        .flat_map(|ml| {
            ml.voice_layouts
                .iter()
                .flat_map(|vl| (0..vl.events.len()).map(|i| vl.events.to_event_layout(i)))
        })
        .collect();
    let mut event_map: HashMap<&str, &EventLayout> = HashMap::new();
    for el in &all_events {
        if let Some(ref id) = el.id {
            event_map.insert(id.as_str(), el);
        }
    }

    let beam_thickness = 0.5 * sp;
    let beam_gap = 0.25 * sp;

    for ml in measure_layouts {
        let beams = match &ml.resolved.part.beams {
            Some(b) => b,
            None => continue,
        };

        // Events local to this measure
        let ml_events: Vec<EventLayout> = ml
            .voice_layouts
            .iter()
            .flat_map(|vl| (0..vl.events.len()).map(|i| vl.events.to_event_layout(i)))
            .collect();
        let local_events: HashSet<&str> =
            ml_events.iter().filter_map(|el| el.id.as_deref()).collect();

        for (beam_idx, beam) in beams.iter().enumerate() {
            // Only handle beams where some events are NOT in this measure
            let all_local = beam
                .events
                .iter()
                .all(|id| local_events.contains(id.as_str()));
            if all_local {
                continue;
            }

            // Resolve event layouts from the global map
            let beam_events: Vec<&EventLayout> = beam
                .events
                .iter()
                .filter_map(|id| event_map.get(id.as_str()).copied())
                .collect();

            if beam_events.len() < 2 {
                continue;
            }

            // Record command index before rendering for element ID tagging
            let cmd_start = dl.commands.len();

            let explicit_hooks = collect_explicit_hooks(beam);
            let explicit_beam_groups = collect_explicit_beam_groups(beam);
            let stem_up = beam_events[0].stem_up;

            // --- Beam placement with quanting (same as render_beams) ---
            let stem_w_cb = config.stem_width * sp;

            let max_beam_level = beam_events
                .iter()
                .map(|el| el.event.duration.base.flag_count())
                .max()
                .unwrap_or(1);

            let note_info_cb: Vec<(f64, f64)> = beam_events
                .iter()
                .map(|el| {
                    let top_pos = el
                        .note_positions
                        .iter()
                        .cloned()
                        .fold(f64::INFINITY, f64::min);
                    let bottom_pos = el
                        .note_positions
                        .iter()
                        .cloned()
                        .fold(f64::NEG_INFINITY, f64::max);
                    if stem_up {
                        (
                            el.x + smufl::STEM_UP_SE.0 * sp - stem_w_cb * 0.5,
                            staff_y + top_pos * sp * 0.5,
                        )
                    } else {
                        (
                            el.x + smufl::STEM_DOWN_NW.0 * sp + stem_w_cb * 0.5,
                            staff_y + bottom_pos * sp * 0.5,
                        )
                    }
                })
                .collect();

            let (_beam_y_first, slope, stem_tips) =
                compute_quantized_beam(&note_info_cb, stem_up, sp, config, staff_y, max_beam_level);

            let first = stem_tips.first().unwrap();

            // Re-draw stems to beam center for cross-barline group
            let beam_center_offset = beam_thickness / 2.0;
            for (i, el) in beam_events.iter().enumerate() {
                let (stem_x, _) = stem_tips[i];
                let beam_y_at_stem = first.1 + slope * (stem_x - first.0);
                let top_pos = el
                    .note_positions
                    .iter()
                    .cloned()
                    .fold(f64::INFINITY, f64::min);
                let bottom_pos = el
                    .note_positions
                    .iter()
                    .cloned()
                    .fold(f64::NEG_INFINITY, f64::max);

                if stem_up {
                    let stem_bottom = staff_y + bottom_pos * sp * 0.5;
                    let stem_end = beam_y_at_stem + beam_center_offset;
                    dl.stem(stem_x, stem_end, stem_bottom, config.stem_width * sp);
                } else {
                    let stem_top = staff_y + top_pos * sp * 0.5;
                    let stem_end = beam_y_at_stem - beam_center_offset;
                    dl.stem(stem_x, stem_top, stem_end, config.stem_width * sp);
                }
            }

            for level in 0..max_beam_level {
                let level_offset = if stem_up {
                    level as f64 * (beam_thickness + beam_gap)
                } else {
                    -(level as f64) * (beam_thickness + beam_gap)
                };

                let mut sub_groups = find_beam_sub_groups(&beam_events, level + 1);

                // Apply explicit MNX sub-beam breaks for secondary+ beams
                if level > 0 {
                    let group_idx = (level - 1) as usize;
                    if group_idx < explicit_beam_groups.len()
                        && !explicit_beam_groups[group_idx].is_empty()
                    {
                        let breaks = compute_beam_break_indices(
                            &beam_events,
                            &explicit_beam_groups[group_idx],
                        );
                        sub_groups = split_segments_at_breaks(sub_groups, &breaks);
                    }
                }

                let hook_len = 0.875 * sp;
                let stem_half_w = config.stem_width * sp * 0.5;

                for segment in sub_groups {
                    match segment {
                        BeamSegment::Full {
                            start: start_idx,
                            end: end_idx,
                        } => {
                            let (x1, _) = stem_tips[start_idx];
                            let (x2, _) = stem_tips[end_idx];
                            let bx1 = x1 - stem_half_w;
                            let bx2 = x2 + stem_half_w;
                            let y1 = first.1 + slope * (bx1 - first.0) + level_offset;
                            let y2 = first.1 + slope * (bx2 - first.0) + level_offset;
                            if stem_up {
                                dl.beam_angled(bx1, y1, bx2, y2, beam_thickness);
                            } else {
                                dl.beam_angled(
                                    bx1,
                                    y1 - beam_thickness,
                                    bx2,
                                    y2 - beam_thickness,
                                    beam_thickness,
                                );
                            }
                        }
                        BeamSegment::Hook { index, right } => {
                            let event_id = beam_events[index].id.as_deref().unwrap_or("");
                            let actual_right =
                                explicit_hooks.get(event_id).copied().unwrap_or(right);
                            let (x, _) = stem_tips[index];
                            let (hx1, hx2) = if actual_right {
                                (x - stem_half_w, x + hook_len)
                            } else {
                                (x - hook_len, x + stem_half_w)
                            };
                            let hy1 = first.1 + slope * (hx1 - first.0) + level_offset;
                            let hy2 = first.1 + slope * (hx2 - first.0) + level_offset;
                            if stem_up {
                                dl.beam_angled(hx1, hy1, hx2, hy2, beam_thickness);
                            } else {
                                dl.beam_angled(
                                    hx1,
                                    hy1 - beam_thickness,
                                    hx2,
                                    hy2 - beam_thickness,
                                    beam_thickness,
                                );
                            }
                        }
                    }
                }
            }

            // Tag all commands produced by this cross-barline beam group
            let cmd_end = dl.commands.len();
            if cmd_end > cmd_start {
                let eid = element_id::beam(ml.part_index, ml.resolved.index, beam_idx);
                for ci in cmd_start..cmd_end {
                    dl.tag_command(ci, eid.clone());
                    if matches!(dl.commands[ci], RenderCommand::DrawPolygon { .. }) {
                        dl.push_shape_cmd(ci, eid.clone(), ElementKind::Beam, None, None);
                    }
                }
            }
        }
    }
}

/// Draw stems (and optional acciaccatura slash) for one grace-beam group.
/// Returns nothing; mutates `dl` only.
pub(super) fn draw_grace_beam_stems(
    dl: &mut DisplayList,
    beam_graces: &[&GraceNoteLayout],
    stem_tips: &[(f64, f64)],
    first: (f64, f64),
    slope: f64,
    stem_up: bool,
    staff_y: f64,
    sp: f64,
    grace_scale: f64,
    stem_w: f64,
    beam_thickness: f64,
    config: &LayoutConfig,
) {
    let grace_beam_center_offset = beam_thickness / 2.0;
    for (i, gn) in beam_graces.iter().enumerate() {
        let (stem_x, _) = stem_tips[i];
        let beam_y_at_stem = first.1 + slope * (stem_x - first.0);
        let top_pos = gn
            .note_positions
            .iter()
            .cloned()
            .fold(f64::INFINITY, f64::min);
        let bottom_pos = gn
            .note_positions
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);

        if stem_up {
            let stem_bottom = staff_y + bottom_pos * sp * 0.5;
            let stem_end = beam_y_at_stem + grace_beam_center_offset;
            dl.stem(stem_x, stem_end, stem_bottom, stem_w);
        } else {
            let stem_top = staff_y + top_pos * sp * 0.5;
            let stem_end = beam_y_at_stem - grace_beam_center_offset;
            dl.stem(stem_x, stem_top, stem_end, stem_w);
        }

        // Acciaccatura slash: only draw on the FIRST grace note in a beamed group.
        // For beamed grace notes, a single slash through the first stem indicates
        // the entire group is acciaccatura, not one slash per note.
        if i == 0 && gn.is_slash {
            let stem_len = config.stem_length * sp * grace_scale;
            let slash_ext = 0.6 * sp * grace_scale;
            let slash_center_y = if stem_up {
                beam_y_at_stem + stem_len * 0.35
            } else {
                beam_y_at_stem - stem_len * 0.35
            };
            dl.push(RenderCommand::DrawLine {
                x1: stem_x - slash_ext * 0.8,
                y1: slash_center_y + slash_ext,
                x2: stem_x + slash_ext * 0.8,
                y2: slash_center_y - slash_ext,
                width: config.stem_width * sp * 1.5,
                color: "#000000".into(),
            });
        }
    }
}

/// Draw beam segments for one grace-beam group across all levels.
pub(super) fn draw_grace_beam_levels(
    dl: &mut DisplayList,
    beam_graces: &[&GraceNoteLayout],
    stem_tips: &[(f64, f64)],
    first: (f64, f64),
    slope: f64,
    stem_up: bool,
    sp: f64,
    grace_scale: f64,
    stem_w: f64,
    beam_thickness: f64,
    beam_gap: f64,
    max_beam_level: u32,
    explicit_hooks: &std::collections::HashMap<String, bool>,
) {
    // Build temporary EventLayout wrappers for sub-group finding.
    // find_beam_sub_groups operates on EventLayouts, but grace notes use a
    // separate GraceNoteLayout type; wrap them minimally here.
    let temp_events: Vec<EventLayout> = beam_graces
        .iter()
        .map(|gn| EventLayout {
            x: gn.x,
            event: gn.event.clone(),
            note_x_offsets: vec![0.0; gn.note_positions.len()],
            shared_noteheads: vec![false; gn.note_positions.len()],
            shared_rest: false,
            note_positions: gn.note_positions.clone(),
            display_pitches: vec![],
            stem_up: gn.stem_up,
            id: gn.id.clone(),
            grace_notes: Vec::new(),
            num_voices: 1,
            sequence_staff: 1,
            beat_position: 0.0,
        })
        .collect();
    let temp_refs: Vec<&EventLayout> = temp_events.iter().collect();

    let grace_stem_half_w = stem_w * 0.5;
    let hook_len = 0.875 * sp * grace_scale;

    for level in 0..max_beam_level {
        let level_offset = if stem_up {
            level as f64 * (beam_thickness + beam_gap)
        } else {
            -(level as f64) * (beam_thickness + beam_gap)
        };

        let sub_groups = find_beam_sub_groups(&temp_refs, level + 1);

        for segment in sub_groups {
            match segment {
                BeamSegment::Full {
                    start: start_idx,
                    end: end_idx,
                } => {
                    let (x1, _) = stem_tips[start_idx];
                    let (x2, _) = stem_tips[end_idx];
                    let bx1 = x1 - grace_stem_half_w;
                    let bx2 = x2 + grace_stem_half_w;
                    let y1 = first.1 + slope * (bx1 - first.0) + level_offset;
                    let y2 = first.1 + slope * (bx2 - first.0) + level_offset;

                    if stem_up {
                        dl.beam_angled(bx1, y1, bx2, y2, beam_thickness);
                    } else {
                        dl.beam_angled(
                            bx1,
                            y1 - beam_thickness,
                            bx2,
                            y2 - beam_thickness,
                            beam_thickness,
                        );
                    }
                }
                BeamSegment::Hook { index, right } => {
                    let event_id = beam_graces[index].id.as_deref().unwrap_or("");
                    let actual_right = explicit_hooks.get(event_id).copied().unwrap_or(right);

                    let (x, _) = stem_tips[index];
                    let (hx1, hx2) = if actual_right {
                        (x - grace_stem_half_w, x + hook_len)
                    } else {
                        (x - hook_len, x + grace_stem_half_w)
                    };
                    let hy1 = first.1 + slope * (hx1 - first.0) + level_offset;
                    let hy2 = first.1 + slope * (hx2 - first.0) + level_offset;

                    if stem_up {
                        dl.beam_angled(hx1, hy1, hx2, hy2, beam_thickness);
                    } else {
                        dl.beam_angled(
                            hx1,
                            hy1 - beam_thickness,
                            hx2,
                            hy2 - beam_thickness,
                            beam_thickness,
                        );
                    }
                }
            }
        }
    }
}

/// Render beam groups for grace notes at reduced scale (0.65×).
///
/// Grace notes are nested inside EventLayout.grace_notes, so we collect
/// all grace notes across all voices, then match beam group IDs against
/// grace note IDs to form beam groups and draw scaled beam rectangles.
pub(crate) fn render_grace_beams(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    use_beams: bool,
) {
    // Explicit grace beams come from the part's beam list; grace groups without
    // an explicit beam are auto-beamed (standard engraving practice: a run of
    // two or more eighth-or-shorter grace notes is beamed). Author-specified
    // beaming (useBeams) suppresses the auto pass.
    let explicit_beams = ml.resolved.part.beams.clone().unwrap_or_default();
    let auto_beams = if use_beams {
        Vec::new()
    } else {
        let explicit_ids = super::grouping::collect_beamed_event_ids(&ml.resolved.part);
        super::grouping::auto_grace_beam_groups(ml, &explicit_ids)
    };
    let beams: Vec<&Beam> = explicit_beams.iter().chain(auto_beams.iter()).collect();
    if beams.is_empty() {
        return;
    }

    let grace_scale = 0.65;
    let stem_w = config.stem_width * sp;
    let beam_thickness = 0.5 * sp * grace_scale;
    let beam_gap = 0.25 * sp * grace_scale;

    // Collect all grace notes from all voices
    let ml_events: Vec<EventLayout> = ml
        .voice_layouts
        .iter()
        .flat_map(|vl| (0..vl.events.len()).map(|i| vl.events.to_event_layout(i)))
        .collect();
    let all_grace_notes: Vec<&GraceNoteLayout> = ml_events
        .iter()
        .flat_map(|el| el.grace_notes.iter())
        .collect();

    for (grace_beam_idx, &beam) in beams.iter().enumerate() {
        // Resolve grace note layouts in this beam group
        let beam_graces: Vec<&GraceNoteLayout> = beam
            .events
            .iter()
            .filter_map(|id| {
                all_grace_notes
                    .iter()
                    .find(|gn| gn.id.as_deref() == Some(id.as_str()))
                    .copied()
            })
            .collect();

        if beam_graces.len() < 2 {
            continue;
        }

        // Record command index before rendering for element ID tagging
        let cmd_start = dl.commands.len();

        let explicit_hooks = collect_explicit_hooks(beam);
        let stem_up = beam_graces[0].stem_up;

        // --- Beam placement with quanting for grace notes ---
        let grace_sp = sp * grace_scale;

        let max_beam_level = beam_graces
            .iter()
            .map(|gn| gn.event.duration.base.flag_count())
            .max()
            .unwrap_or(1);

        let note_info_g: Vec<(f64, f64)> = beam_graces
            .iter()
            .map(|gn| {
                let top_pos = gn
                    .note_positions
                    .iter()
                    .cloned()
                    .fold(f64::INFINITY, f64::min);
                let bottom_pos = gn
                    .note_positions
                    .iter()
                    .cloned()
                    .fold(f64::NEG_INFINITY, f64::max);
                if stem_up {
                    (
                        gn.x + smufl::STEM_UP_SE.0 * sp * grace_scale - stem_w * 0.5,
                        staff_y + top_pos * sp * 0.5,
                    )
                } else {
                    (
                        gn.x + smufl::STEM_DOWN_NW.0 * sp * grace_scale + stem_w * 0.5,
                        staff_y + bottom_pos * sp * 0.5,
                    )
                }
            })
            .collect();

        // Grace notes use scaled config for stem length
        let mut grace_config = config.clone();
        grace_config.stem_length *= grace_scale;
        let (_, slope, stem_tips) = compute_quantized_beam(
            &note_info_g,
            stem_up,
            grace_sp,
            &grace_config,
            staff_y,
            max_beam_level,
        );

        let first = stem_tips.first().unwrap();

        // Draw stems connecting noteheads to beam center (+ acciaccatura slash if any).
        draw_grace_beam_stems(
            dl,
            &beam_graces,
            &stem_tips,
            *first,
            slope,
            stem_up,
            staff_y,
            sp,
            grace_scale,
            stem_w,
            beam_thickness,
            config,
        );

        // Draw beam segments (full beams + hooks) at every level.
        draw_grace_beam_levels(
            dl,
            &beam_graces,
            &stem_tips,
            *first,
            slope,
            stem_up,
            sp,
            grace_scale,
            stem_w,
            beam_thickness,
            beam_gap,
            max_beam_level,
            &explicit_hooks,
        );

        // Tag all commands produced by this grace beam group
        let cmd_end = dl.commands.len();
        if cmd_end > cmd_start {
            let eid = element_id::grace_beam(ml.part_index, ml.resolved.index, grace_beam_idx);
            for ci in cmd_start..cmd_end {
                dl.tag_command(ci, eid.clone());
                if matches!(dl.commands[ci], RenderCommand::DrawPolygon { .. }) {
                    dl.push_shape_cmd(ci, eid.clone(), ElementKind::Beam, None, None);
                }
            }
        }
    }
}

pub(crate) fn render_rest(
    dl: &mut DisplayList,
    x: f64,
    staff_y: f64,
    sp: f64,
    duration: &Duration,
    staff_position: Option<i32>,
    centered_on_anchor: bool,
) {
    let rest_codepoint = smufl::rest_glyph(&duration.base);

    // If an explicit staff position is provided, use it directly.
    // MNX staffPosition: 0 = middle line, positive = up, negative = down.
    // Layout Y: staff_y is the top line; each half-space is 0.5*sp downward.
    let y = if let Some(pos) = staff_position {
        staff_y + (4.0 - pos as f64) * 0.5 * sp
    } else {
        // Default rest Y positions vary by type:
        // Whole rest hangs from line 4, half rest sits on line 3, others centered on middle line
        match duration.base {
            NoteValueBase::Whole => staff_y + 1.0 * sp, // Hangs from 2nd line from top
            NoteValueBase::Half => staff_y + 2.0 * sp,  // Sits on middle line
            _ => staff_y + 2.0 * sp,                    // Centered on middle line
        }
    };

    let glyph_x = rest_glyph_origin_x(x, rest_codepoint, sp, centered_on_anchor);
    dl.push(RenderCommand::DrawGlyph {
        x: glyph_x,
        y,
        codepoint: rest_codepoint,
        font: "Bravura".into(),
        size: 4.0 * sp,
        color: "#000000".into(),
        rotation: 0.0,
    });

    // Augmentation dots. Standard engraving practice: the dot sits in the
    // space just above the rest's vertical reference (never on a staff
    // line), to the right of the glyph — this was previously only drawn for
    // notes, so a dotted rest rendered visually identical to an undotted one.
    if let Some(dots) = duration.dots {
        let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(rest_codepoint);
        let dot_align_x = glyph_x + (bbox_x + bbox_w) * sp;
        let dot_y = y - 0.5 * sp;
        for d in 0..dots {
            let dot_x = dot_align_x + (0.3 + d as f64 * 0.35) * sp;
            dl.push(RenderCommand::DrawGlyph {
                x: dot_x,
                y: dot_y,
                codepoint: smufl::AUGMENTATION_DOT,
                font: "Bravura".into(),
                size: 4.0 * sp,
                color: "#000000".into(),
                rotation: 0.0,
            });
        }
    }
}

pub(crate) fn rest_glyph_origin_x(
    event_x: f64,
    codepoint: u32,
    sp: f64,
    centered_on_anchor: bool,
) -> f64 {
    if centered_on_anchor {
        let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(codepoint);
        event_x - (bbox_x + bbox_w * 0.5) * sp
    } else {
        event_x + 0.2 * sp
    }
}

pub(crate) fn rest_ink_center_x(
    event_x: f64,
    duration: &Duration,
    sp: f64,
    centered_on_anchor: bool,
) -> f64 {
    let codepoint = smufl::rest_glyph(&duration.base);
    let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(codepoint);
    rest_glyph_origin_x(event_x, codepoint, sp, centered_on_anchor) + (bbox_x + bbox_w * 0.5) * sp
}

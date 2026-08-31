use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::types::{EventLayout, MeasureLayout};
use super::cross_barline::*;
use crate::render::smufl::smufl;
use crate::render::{DisplayList, ElementKind, RenderCommand};
use std::collections::{HashMap, HashSet};

#[allow(clippy::too_many_arguments)] // rendering boundary: beam geometry and tagging inputs are independent
pub(super) fn render_between_staff_beam(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    beam_events: &[&EventLayout],
    effective_staves: &[u32],
    staff_y: f64,
    staff_y_offsets: Option<&[f64]>,
    sp: f64,
    config: &LayoutConfig,
    beam_thickness: f64,
    beam_gap: f64,
    max_beam_level: u32,
    beam_idx: usize,
    cmd_start: usize,
) -> bool {
    if effective_staves.iter().min() == effective_staves.iter().max() {
        return false;
    }
    let Some(_) = staff_y_offsets else {
        return false;
    };
    let event_ys: Vec<f64> = beam_events
        .iter()
        .map(|event| super::super::render_measure::cross_staff_y(event, staff_y, staff_y_offsets))
        .collect();
    let upper_staff_y = event_ys.iter().copied().fold(f64::INFINITY, f64::min);
    let lower_staff_y = event_ys.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if (lower_staff_y - upper_staff_y).abs() < 0.5 {
        return false;
    }
    let beam_y = (upper_staff_y + 4.0 * sp + lower_staff_y) * 0.5;
    let stem_width = config.stem_width * sp;
    let mut stems = Vec::new();
    for (index, event) in beam_events.iter().enumerate() {
        let event_y = event_ys[index];
        let stem_up = (event_y - lower_staff_y).abs() <= (event_y - upper_staff_y).abs();
        let top = event
            .note_positions
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        let bottom = event
            .note_positions
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        let (stem_x, notehead_y) = if stem_up {
            (
                event.x + smufl::STEM_UP_SE.0 * sp - stem_width * 0.5,
                event_y + bottom * sp * 0.5,
            )
        } else {
            (
                event.x + smufl::STEM_DOWN_NW.0 * sp + stem_width * 0.5,
                event_y + top * sp * 0.5,
            )
        };
        stems.push((stem_x, stem_up, notehead_y));
        if stem_up {
            dl.stem(
                stem_x,
                beam_y + beam_thickness * 0.5,
                notehead_y,
                stem_width,
            );
        } else {
            dl.stem(
                stem_x,
                notehead_y,
                beam_y - beam_thickness * 0.5,
                stem_width,
            );
        }
    }
    let stem_half_width = stem_width * 0.5;
    for level in 0..max_beam_level {
        let y = beam_y - beam_thickness * 0.5 - level as f64 * (beam_thickness + beam_gap);
        for segment in find_beam_sub_groups(beam_events, level + 1) {
            match segment {
                BeamSegment::Full { start, end } => dl.beam_angled(
                    stems[start].0 - stem_half_width,
                    y,
                    stems[end].0 + stem_half_width,
                    y,
                    beam_thickness,
                ),
                BeamSegment::Hook { index, right } => {
                    let x = stems[index].0;
                    let hook_length = 0.875 * sp;
                    let (x1, x2) = if right {
                        (x - stem_half_width, x + hook_length)
                    } else {
                        (x - hook_length, x + stem_half_width)
                    };
                    dl.beam_angled(x1, y, x2, y, beam_thickness);
                }
            }
        }
    }
    let beam_id = element_id::beam(ml.part_index, ml.resolved.index, beam_idx);
    for command_index in cmd_start..dl.commands.len() {
        if !dl.is_tagged(command_index) {
            dl.tag_command(command_index, beam_id.clone());
        }
        if matches!(
            dl.commands[command_index],
            RenderCommand::DrawPolygon { .. }
        ) {
            dl.push_shape_cmd(
                command_index,
                beam_id.clone(),
                ElementKind::Beam,
                None,
                None,
            );
        }
    }
    true
}

#[allow(clippy::too_many_arguments)] // rendering boundary: authored and inferred break inputs are independent
pub(super) fn draw_beam_levels(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    beam_events: &[&EventLayout],
    stem_tips: &[(f64, f64)],
    first: (f64, f64),
    slope: f64,
    stem_up: bool,
    max_beam_level: u32,
    beam_thickness: f64,
    beam_gap: f64,
    explicit_hooks: &HashMap<String, bool>,
    explicit_beam_groups: &[Vec<HashSet<String>>],
    voice_onset_times: &HashMap<String, f64>,
    within_single_tuplet: bool,
    tuplet_boundary_breaks: &HashSet<usize>,
    sp: f64,
    config: &LayoutConfig,
) {
    for level in 0..max_beam_level {
        let level_offset =
            if stem_up { 1.0 } else { -1.0 } * level as f64 * (beam_thickness + beam_gap);
        let mut segments = find_beam_sub_groups(beam_events, level + 1);
        if level > 0 {
            let group_index = (level - 1) as usize;
            if explicit_beam_groups
                .get(group_index)
                .is_some_and(|groups| !groups.is_empty())
            {
                let breaks =
                    compute_beam_break_indices(beam_events, &explicit_beam_groups[group_index]);
                segments = split_segments_at_breaks(segments, &breaks);
            } else {
                if !tuplet_boundary_breaks.is_empty() {
                    segments = split_segments_at_breaks(segments, tuplet_boundary_breaks);
                }
                if level > 1 && !within_single_tuplet {
                    let breaks = compute_implied_beam_breaks(
                        beam_events,
                        voice_onset_times,
                        &ml.resolved.active_time,
                        level,
                    );
                    segments = split_segments_at_breaks(segments, &breaks);
                }
            }
        }
        let hook_length = 0.875 * sp;
        let stem_half_width = config.stem_width * sp * 0.5;
        for segment in segments {
            let (x1, x2) = match segment {
                BeamSegment::Full { start, end } => (
                    stem_tips[start].0 - stem_half_width,
                    stem_tips[end].0 + stem_half_width,
                ),
                BeamSegment::Hook { index, right } => {
                    let points_right = explicit_hooks
                        .get(beam_events[index].id.as_deref().unwrap_or(""))
                        .copied()
                        .unwrap_or(right);
                    let x = stem_tips[index].0;
                    if points_right {
                        (x - stem_half_width, x + hook_length)
                    } else {
                        (x - hook_length, x + stem_half_width)
                    }
                }
            };
            let y1 = first.1 + slope * (x1 - first.0) + level_offset;
            let y2 = first.1 + slope * (x2 - first.0) + level_offset;
            let draw_offset = if stem_up { 0.0 } else { -beam_thickness };
            dl.beam_angled(x1, y1 + draw_offset, x2, y2 + draw_offset, beam_thickness);
        }
    }
}

#[allow(clippy::too_many_arguments)] // rendering correction needs existing glyph and beam geometry
pub(super) fn reposition_rests_under_beam(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    beam_events: &[&EventLayout],
    stem_tips: &[(f64, f64)],
    first: (f64, f64),
    slope: f64,
    stem_up: bool,
    max_beam_level: u32,
    beam_thickness: f64,
    beam_gap: f64,
    staff_y: f64,
    sp: f64,
    cmd_start: usize,
) {
    let first_beat = beam_events.first().unwrap().beat_position;
    let last_beat = beam_events.last().unwrap().beat_position;
    let first_x = stem_tips.first().unwrap().0;
    for voice in &ml.voice_layouts {
        for index in 0..voice.events.len() {
            let event = voice.events.event(index);
            let beat = voice.events.beat_position(index);
            if !event.is_rest()
                || beat <= first_beat
                || beat >= last_beat
                || event.duration.base.flag_count() == 0
            {
                continue;
            }
            let glyph = smufl::rest_glyph(&event.duration.base);
            let rest_x = voice.events.x(index) + 0.2 * sp;
            let (_, bbox_y, _, bbox_height) = smufl::glyph_bbox(glyph);
            let beam_y = first.1 + slope * (rest_x - first_x);
            let beam_depth =
                (max_beam_level as f64 - 1.0) * (beam_thickness + beam_gap) + beam_thickness;
            let target_y = if stem_up {
                beam_y + beam_depth + 0.5 * sp - bbox_y * sp
            } else {
                beam_y - beam_depth - 0.5 * sp - (bbox_y + bbox_height) * sp
            };
            let default_y = staff_y + 2.0 * sp;
            let clamped_y = if stem_up {
                target_y.max(default_y)
            } else {
                target_y.min(default_y)
            };
            let final_y = staff_y + ((clamped_y - staff_y) / (0.5 * sp)).round() * 0.5 * sp;
            for command in dl.commands[..cmd_start].iter_mut().rev() {
                if let RenderCommand::DrawGlyph {
                    x, y, codepoint, ..
                } = command
                {
                    if *codepoint == glyph && (*x - rest_x).abs() < 0.1 {
                        *y = final_y;
                        break;
                    }
                }
            }
        }
    }
}

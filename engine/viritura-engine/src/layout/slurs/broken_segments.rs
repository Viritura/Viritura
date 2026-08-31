use super::global_endpoints::{GlobalSlurEvent, SystemSlurBounds};
use super::obstacle_shapes::collect_seam_span_tie_obstacles;
use super::participation::SlurObstacle;
use super::render::{compute_shoulder_and_apex, compute_slur_bezier, HandleDeltas};
use super::scorer::{select_slur_candidate, SlurShapeInput};
use super::tie_lanes::tie_endpoint_lane;
use crate::layout::config::LayoutConfig;
use crate::render::{DisplayList, ElementKind, RenderCommand, SlurGeometry};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum BrokenSegmentKind {
    Begin,
    Middle,
    End,
}

#[derive(Clone, Copy)]
pub(super) struct BrokenSegment {
    pub(super) system_idx: usize,
    pub(super) kind: BrokenSegmentKind,
    pub(super) bounds: SystemSlurBounds,
    pub(super) first_event_idx: usize,
    pub(super) last_event_idx: usize,
}

pub(super) struct ShapedBrokenSegment {
    pub(super) command: RenderCommand,
    pub(super) spine: (f64, f64, f64, f64),
    pub(super) p0: (f64, f64),
    pub(super) p3: (f64, f64),
}

pub(super) fn plan_broken_segments(
    source_system: usize,
    target_system: usize,
    part_index: usize,
    staff_index: usize,
    bounds: &HashMap<(usize, usize, usize), SystemSlurBounds>,
    extremes: &HashMap<(usize, usize, usize), (usize, usize)>,
) -> Vec<BrokenSegment> {
    if target_system <= source_system {
        return Vec::new();
    }
    (source_system..=target_system)
        .filter_map(|system_idx| {
            let key = (system_idx, part_index, staff_index);
            let bounds = *bounds.get(&key)?;
            let &(first_event_idx, last_event_idx) = extremes.get(&key)?;
            let kind = if system_idx == source_system {
                BrokenSegmentKind::Begin
            } else if system_idx == target_system {
                BrokenSegmentKind::End
            } else {
                BrokenSegmentKind::Middle
            };
            Some(BrokenSegment {
                system_idx,
                kind,
                bounds,
                first_event_idx,
                last_event_idx,
            })
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub(super) fn shape_note_bound_segment(
    dl: &DisplayList,
    piece: &BrokenSegment,
    events: &[GlobalSlurEvent],
    source_event_id: &str,
    target_event_id: &str,
    x1: f64,
    mut y1: f64,
    x2: f64,
    mut y2: f64,
    curve_dir: f64,
    line_style: u8,
    thickness: f64,
    endpoint_thickness: f64,
    handle_deltas: Option<HandleDeltas>,
    note_bound_start: bool,
    note_bound_end: bool,
    sp: f64,
    config: &LayoutConfig,
) -> ShapedBrokenSegment {
    let first = &events[piece.first_event_idx];
    let last = &events[piece.last_event_idx];
    let mut obstacles = middle_obstacles(events, piece, x1, x2, sp, config);
    let (start_tips, end_tips) = collect_seam_span_tie_obstacles(
        dl,
        &mut obstacles,
        (first.eff_staff_y + last.eff_staff_y) * 0.5,
        x1,
        x2,
        sp,
    );
    if handle_deltas.is_none() {
        if note_bound_start {
            y1 = tie_endpoint_lane(y1, start_tips, curve_dir, 0, sp);
        }
        if note_bound_end {
            y2 = tie_endpoint_lane(y2, end_tips, curve_dir, 0, sp);
        }
    }
    let chord_len = (x2 - x1).hypot(y2 - y1).max(0.01);
    let default_shoulder = default_shoulder_for_chord(chord_len, sp, config);
    let cp_indent = default_cp_indent_for_chord(chord_len, sp, config);
    let (shoulder, apex_shift) = if handle_deltas.is_some() {
        (default_shoulder, 0.0)
    } else {
        let collision = compute_shoulder_and_apex(
            x1,
            x2,
            y1,
            y2,
            chord_len,
            curve_dir < 0.0,
            curve_dir,
            sp,
            config,
            &obstacles,
            source_event_id,
            target_event_id,
            true,
            true,
        );
        let selected = select_slur_candidate(&SlurShapeInput {
            x1,
            y1,
            x2,
            y2,
            curve_dir,
            cp_indent,
            heuristic_shoulder: collision.needed_shoulder,
            heuristic_apex_shift: collision.apex_shift_frac,
            default_shoulder,
            shoulder_cap: config.slur_shoulder_max * sp,
            staff_y: (first.eff_staff_y + last.eff_staff_y) * 0.5,
            sp,
            obstacles: &obstacles,
            source_event_id,
            target_event_id,
            has_manual_shape: false,
        });
        (selected.candidate.shoulder, selected.candidate.apex_shift)
    };
    let (command, spine) = compute_slur_bezier(
        x1,
        y1,
        x2,
        y2,
        curve_dir,
        shoulder,
        cp_indent,
        apex_shift,
        thickness,
        endpoint_thickness,
        line_style,
        handle_deltas,
    );
    ShapedBrokenSegment {
        command,
        spine,
        p0: (x1, y1),
        p3: (x2, y2),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn emit_middle_segments(
    dl: &mut DisplayList,
    pieces: &[BrokenSegment],
    events: &[GlobalSlurEvent],
    element_id: &str,
    curve_dir: f64,
    line_style: u8,
    thickness: f64,
    endpoint_thickness: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    for piece in pieces
        .iter()
        .filter(|piece| piece.kind == BrokenSegmentKind::Middle)
    {
        let first = &events[piece.first_event_idx];
        let last = &events[piece.last_event_idx];
        let x1 = piece.bounds.left_x + 0.5 * sp;
        let x2 = piece.bounds.right_x - 0.5 * sp;
        if x2 - x1 < sp {
            continue;
        }
        let note_offset = 0.7 * sp;
        let y1_pos = if curve_dir < 0.0 {
            first.y_pos
        } else {
            first.y_pos_bottom
        };
        let y2_pos = if curve_dir < 0.0 {
            last.y_pos
        } else {
            last.y_pos_bottom
        };
        let mut y1 = first.eff_staff_y + y1_pos * sp * 0.5 + curve_dir * note_offset;
        let mut y2 = last.eff_staff_y + y2_pos * sp * 0.5 + curve_dir * note_offset;
        let chord_len = (x2 - x1).hypot(y2 - y1).max(0.01);
        let default_shoulder = default_shoulder_for_chord(chord_len, sp, config);
        let cp_indent = default_cp_indent_for_chord(chord_len, sp, config);
        let mut obstacles = middle_obstacles(events, piece, x1, x2, sp, config);
        collect_seam_span_tie_obstacles(
            dl,
            &mut obstacles,
            (first.eff_staff_y + last.eff_staff_y) * 0.5,
            x1,
            x2,
            sp,
        );
        let collision = compute_shoulder_and_apex(
            x1,
            x2,
            y1,
            y2,
            chord_len,
            curve_dir < 0.0,
            curve_dir,
            sp,
            config,
            &obstacles,
            element_id,
            element_id,
            false,
            false,
        );
        y1 = collision.y1;
        y2 = collision.y2;
        let shoulder = collision.needed_shoulder;
        let apex_shift = collision.apex_shift_frac;
        let selected = select_slur_candidate(&SlurShapeInput {
            x1,
            y1,
            x2,
            y2,
            curve_dir,
            cp_indent,
            heuristic_shoulder: shoulder,
            heuristic_apex_shift: apex_shift,
            default_shoulder,
            shoulder_cap: config.slur_shoulder_max * sp,
            staff_y: (first.eff_staff_y + last.eff_staff_y) * 0.5,
            sp,
            obstacles: &obstacles,
            source_event_id: element_id,
            target_event_id: element_id,
            has_manual_shape: false,
        });
        let (command, spine) = compute_slur_bezier(
            x1,
            y1,
            x2,
            y2,
            curve_dir,
            selected.candidate.shoulder,
            cp_indent,
            selected.candidate.apex_shift,
            thickness,
            endpoint_thickness,
            line_style,
            None,
        );
        let segment_id = format!("{element_id}/mid/{}", piece.system_idx);
        dl.slur_geometries.push(SlurGeometry {
            element_id: segment_id.clone(),
            p0_x: x1,
            p0_y: y1,
            p1_x: spine.0,
            p1_y: spine.1,
            p2_x: spine.2,
            p2_y: spine.3,
            p3_x: x2,
            p3_y: y2,
            thickness,
            curve_dir,
            sp,
        });
        let band = crate::layout::curves::sample_cubic_band(
            (x1, y1),
            (spine.0, spine.1),
            (spine.2, spine.3),
            (x2, y2),
            thickness,
        );
        dl.push_shape_band(
            band,
            segment_id.clone(),
            ElementKind::Slur,
            Some(piece.system_idx as u32),
            Some(first.staff_idx as u32),
        );
        dl.push_tagged(command, segment_id);
    }
}

fn middle_obstacles(
    events: &[GlobalSlurEvent],
    piece: &BrokenSegment,
    x1: f64,
    x2: f64,
    sp: f64,
    config: &LayoutConfig,
) -> Vec<SlurObstacle> {
    let half_height = config.notehead_ry * sp;
    let mut obstacles = Vec::new();
    for event in events.iter().filter(|event| {
        event.system_idx == piece.system_idx
            && event.part_index == events[piece.first_event_idx].part_index
            && event.staff_idx == events[piece.first_event_idx].staff_idx
            && event.x >= x1
            && event.x <= x2
    }) {
        let note_top = event.eff_staff_y + event.y_pos * sp * 0.5 - half_height;
        let note_bottom = event.eff_staff_y + event.y_pos_bottom * sp * 0.5 + half_height;
        let (mut top, mut bottom) = if event.stem_up {
            (
                note_top.min(event.eff_staff_y + event.y_pos * sp * 0.5 - config.stem_length * sp),
                note_bottom,
            )
        } else {
            (
                note_top,
                note_bottom.max(
                    event.eff_staff_y + event.y_pos_bottom * sp * 0.5 + config.stem_length * sp,
                ),
            )
        };
        if let Some(beam_top) = event.beam_top_y {
            top = top.min(beam_top);
        }
        if let Some(beam_bottom) = event.beam_bottom_y {
            bottom = bottom.max(beam_bottom);
        }
        obstacles.push(SlurObstacle {
            event_id: Some(event.event_id.to_string()),
            voice_idx: event.voice_idx,
            x: event.x + event.notehead_w * 0.5,
            y_top: top,
            y_bottom: bottom,
            notehead_y_top: Some(note_top),
            notehead_y_bottom: Some(note_bottom),
            is_tie: false,
            is_articulation: false,
        });
        if let Some((y_top, y_bottom)) = event.articulation_extent {
            obstacles.push(SlurObstacle {
                event_id: Some(event.event_id.to_string()),
                voice_idx: event.voice_idx,
                x: event.x + event.notehead_w * 0.5,
                y_top,
                y_bottom,
                notehead_y_top: None,
                notehead_y_bottom: None,
                is_tie: false,
                is_articulation: true,
            });
        }
    }
    obstacles.sort_by(|left, right| left.x.total_cmp(&right.x));
    obstacles
}

pub(super) fn default_shoulder_for_chord(chord_len: f64, sp: f64, config: &LayoutConfig) -> f64 {
    let width = chord_len / sp;
    let parameter = width * config.slur_rise_rate / config.slur_height_inf;
    config.slur_height_inf
        * sp
        * (2.0 / std::f64::consts::PI)
        * (std::f64::consts::PI * parameter / 2.0).atan()
}

pub(super) fn default_cp_indent_for_chord(chord_len: f64, sp: f64, config: &LayoutConfig) -> f64 {
    let length_sp = chord_len / sp;
    if length_sp < 2.0 {
        0.20
    } else if length_sp < 10.0 {
        0.25
    } else if length_sp < 18.0 {
        0.20
    } else {
        config.slur_cp_indent.min(0.15)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_one_piece_for_every_occupied_system() {
        let mut bounds = HashMap::new();
        let mut extremes = HashMap::new();
        for system_idx in 2..=5 {
            bounds.insert(
                (system_idx, 3, 1),
                SystemSlurBounds {
                    left_x: 10.0,
                    right_x: 200.0,
                },
            );
            extremes.insert((system_idx, 3, 1), (system_idx * 2, system_idx * 2 + 1));
        }
        let pieces = plan_broken_segments(2, 5, 3, 1, &bounds, &extremes);

        assert_eq!(pieces.len(), 4);
        assert_eq!(pieces[0].kind, BrokenSegmentKind::Begin);
        assert_eq!(pieces[1].kind, BrokenSegmentKind::Middle);
        assert_eq!(pieces[2].kind, BrokenSegmentKind::Middle);
        assert_eq!(pieces[3].kind, BrokenSegmentKind::End);
    }
}

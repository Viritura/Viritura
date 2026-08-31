//! Tempo marking measurement, placement, and rendering.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::text_styles::{self, FontFamily, TextRole};
use super::super::types::*;
use super::rehearsal_marks::{
    rehearsal_mark_baseline_y, rehearsal_mark_reserved_width, rehearsal_mark_x_extent,
};
use super::substrate_obstacles::{above_glyph_top_in_range, highest_point_in_range, AboveGlyphBox};
use crate::model::{GlobalMeasure, RehearsalMark, ResolvedMeasure, Tempo};
use crate::render::smufl::smufl;
use crate::render::*;

/// One positioned piece of a metronome-style tempo marking, laid out left to
/// right from the marking's origin (`dx = 0`).
pub(crate) enum TempoRun {
    Text { dx: f64, text: String },
    Glyph { dx: f64, codepoint: u32, size: f64 },
}

fn format_bpm(bpm: f64) -> String {
    format!("{bpm:.2}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_owned()
}

/// Lay out a metronome-style tempo marking as a sequence of positioned runs.
pub(crate) fn tempo_metronome_runs(
    tempo: &Tempo,
    show_text: bool,
    text_size: f64,
    sp: f64,
    family: FontFamily,
    bold: bool,
) -> (Vec<TempoRun>, f64) {
    let glyph_size = 3.0 * sp;
    let glyph_scale = glyph_size / 4.0;
    let bpm = format_bpm(tempo.bpm);

    let mut runs: Vec<TempoRun> = Vec::new();
    let mut dx = 0.0;
    if show_text {
        let lead = format!("{} (", tempo.text.as_deref().unwrap_or(""));
        dx += text_styles::text_width(&lead, text_size, family, bold);
        runs.push(TempoRun::Text {
            dx: 0.0,
            text: lead,
        });
    }

    let note_cp = smufl::metronome_note_glyph(&tempo.value.base);
    runs.push(TempoRun::Glyph {
        dx,
        codepoint: note_cp,
        size: glyph_size,
    });
    dx += smufl::metronome_glyph_advance(note_cp) * glyph_scale;

    for _ in 0..tempo.value.dots.unwrap_or(0) {
        dx += 0.2 * sp;
        runs.push(TempoRun::Glyph {
            dx,
            codepoint: smufl::MET_AUGMENTATION_DOT,
            size: glyph_size,
        });
        dx += smufl::metronome_glyph_advance(smufl::MET_AUGMENTATION_DOT) * glyph_scale;
    }

    let trail = if show_text {
        format!(" = {bpm})")
    } else {
        format!(" = {bpm}")
    };
    runs.push(TempoRun::Text {
        dx,
        text: trail.clone(),
    });
    dx += text_styles::text_width(&trail, text_size, family, bold);
    (runs, dx)
}

pub(crate) fn tempo_marking_width(tempo: &Tempo, config: &LayoutConfig, sp: f64) -> f64 {
    let tempo_style = config.text_styles.resolve(TextRole::Tempo);
    let text_size = tempo_style.size_px(sp);
    let has_text = tempo.text.as_ref().is_some_and(|t| !t.is_empty());
    let show_metronome = tempo.show_metronome_mark.unwrap_or(true);
    let show_text = has_text && tempo.show_text.unwrap_or(true);
    if show_metronome {
        let (_runs, w) = tempo_metronome_runs(
            tempo,
            show_text,
            text_size,
            sp,
            tempo_style.family,
            tempo_style.bold,
        );
        w
    } else if show_text {
        let text = tempo.text.as_deref().unwrap_or("");
        text.chars().count() as f64 * 0.6 * text_size
    } else {
        0.0
    }
}

fn rehearsal_mark_flow_clearance(mark: Option<&RehearsalMark>, sp: f64) -> f64 {
    match mark {
        Some(m) => rehearsal_mark_reserved_width(m, sp) + 0.5 * sp,
        None => 0.0,
    }
}

pub(crate) fn measure_tempo_width(rm: &ResolvedMeasure, config: &LayoutConfig, sp: f64) -> f64 {
    let tempo_w = rm
        .global
        .tempos
        .as_ref()
        .map(|ts| {
            ts.iter()
                .map(|t| tempo_marking_width(t, config, sp))
                .fold(0.0f64, f64::max)
        })
        .unwrap_or(0.0);
    if tempo_w <= 0.0 {
        return 0.0;
    }
    tempo_w + rehearsal_mark_flow_clearance(rm.global.rehearsal_mark(), sp)
}

pub(crate) fn resolved_tempo_widths(
    measures: &[&ResolvedMeasure],
    config: &LayoutConfig,
    sp: f64,
) -> Vec<f64> {
    measures
        .iter()
        .map(|rm| measure_tempo_width(rm, config, sp))
        .collect()
}

pub(crate) fn global_tempo_widths(
    measures: &[GlobalMeasure],
    count: usize,
    config: &LayoutConfig,
    sp: f64,
) -> Vec<f64> {
    (0..count)
        .map(|mi| {
            measures
                .get(mi)
                .map(|gm| {
                    let tempo_w = gm
                        .tempos
                        .as_ref()
                        .map(|ts| {
                            ts.iter()
                                .map(|t| tempo_marking_width(t, config, sp))
                                .fold(0.0f64, f64::max)
                        })
                        .unwrap_or(0.0);
                    if tempo_w <= 0.0 {
                        0.0
                    } else {
                        tempo_w + rehearsal_mark_flow_clearance(gm.rehearsal_mark(), sp)
                    }
                })
                .unwrap_or(0.0)
        })
        .collect()
}

fn leftmost_obstacle_left(
    boxes: &[AboveGlyphBox],
    x_left: f64,
    x_right: f64,
    threshold: f64,
) -> Option<f64> {
    let mut leftmost: Option<f64> = None;
    for &(left, right, top) in boxes {
        if right < x_left || left > x_right || top >= threshold {
            continue;
        }
        leftmost = Some(leftmost.map_or(left, |c: f64| c.min(left)));
    }
    leftmost
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn resolve_tempo_placement(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    above_glyph_boxes: &[AboveGlyphBox],
    tempo_x: f64,
    width: f64,
    beat: f64,
    baseline_offset: f64,
    clearance: f64,
    leading_clef_gap: f64,
) -> (f64, f64) {
    let tempo_attach_gap = config.placement.resolve(ElementKind::Tempo).attach_gap;
    let mut min_tempo_y = staff_y - tempo_attach_gap * sp - baseline_offset;
    if let Some(mark_baseline) =
        rehearsal_mark_baseline_y(ml, staff_y, sp, config, above_glyph_boxes, leading_clef_gap)
    {
        min_tempo_y = min_tempo_y.min(mark_baseline - baseline_offset);
    }

    let right_limit = config
        .page_width
        .map(|pw| pw - config.page_margin_right * sp);
    let left_floor = {
        let page_floor = config
            .page_width
            .map(|_| config.page_margin_left * sp)
            .unwrap_or(0.0);
        match rehearsal_mark_x_extent(ml, sp) {
            Some((_, mark_right)) => page_floor.max(mark_right + 0.5 * sp),
            None => page_floor,
        }
    };
    let tempo_x = match right_limit {
        Some(limit) if tempo_x + width > limit => (limit - width).max(left_floor),
        _ => tempo_x,
    };

    let scan_pad = 0.5 * sp;
    let lift_threshold = min_tempo_y + clearance + baseline_offset;
    let compute_highest = |left: f64, right: f64| -> f64 {
        let mut highest = highest_point_in_range(ml, staff_y, sp, config.stem_length, left, right);
        if let Some((nx_l, nx_r, ntop)) =
            crate::layout::render_measure::multimeasure_rest_number_extent(ml, staff_y, sp)
        {
            if nx_r >= left && nx_l <= right && ntop < highest {
                highest = ntop;
            }
        }
        if let Some(gtop) = above_glyph_top_in_range(above_glyph_boxes, left, right) {
            highest = highest.min(gtop);
        }
        highest
    };

    let mut place_x = tempo_x;
    let mut highest = compute_highest(place_x - scan_pad, place_x + width + scan_pad);
    if ml.is_first_on_system && beat == 0.0 && highest < lift_threshold {
        let dodge_floor = match rehearsal_mark_x_extent(ml, sp) {
            Some((_, mark_right)) => (mark_right + 0.5 * sp).max(ml.x),
            None => ml.x,
        };
        if let Some(obstacle_left) = leftmost_obstacle_left(
            above_glyph_boxes,
            place_x - scan_pad,
            place_x + width + scan_pad,
            lift_threshold,
        ) {
            if obstacle_left > dodge_floor {
                let shifted_x = dodge_floor;
                let new_highest =
                    compute_highest(shifted_x - scan_pad, shifted_x + width + scan_pad);
                if new_highest > highest + 0.01 {
                    place_x = shifted_x;
                    highest = new_highest;
                }
            }
        }
    }

    let line_y = min_tempo_y.min(highest - clearance - baseline_offset);
    (place_x, line_y)
}

#[allow(clippy::too_many_arguments)]
fn resolve_tempo_with_manual(
    tempo: &Tempo,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    above_glyph_boxes: &[AboveGlyphBox],
    tempo_x: f64,
    width: f64,
    beat: f64,
    baseline_offset: f64,
    clearance: f64,
    leading_clef_gap: f64,
) -> (f64, f64) {
    let avoid = tempo.avoid_collisions.unwrap_or(true);
    let [off_x_sp, off_y_sp] = tempo.manual_offset.unwrap_or([0.0, 0.0]);
    let (place_x, line_y) = if avoid {
        resolve_tempo_placement(
            ml,
            staff_y,
            sp,
            config,
            above_glyph_boxes,
            tempo_x,
            width,
            beat,
            baseline_offset,
            clearance,
            leading_clef_gap,
        )
    } else {
        let attach_gap = config.placement.resolve(ElementKind::Tempo).attach_gap;
        (tempo_x, staff_y - attach_gap * sp - baseline_offset)
    };
    (place_x + off_x_sp * sp, line_y - off_y_sp * sp)
}

pub(crate) fn render_tempo_markings(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    above_glyph_boxes: &[AboveGlyphBox],
    leading_clef_gap: f64,
) {
    let tempos = match &ml.resolved.global.tempos {
        Some(t) if !t.is_empty() => t,
        _ => return,
    };

    let tempo_style = config.text_styles.resolve(TextRole::Tempo);
    let text_size = tempo_style.size_px(sp);
    let tempo_font = tempo_style.font_string();
    let tempo_color = tempo_style.color.clone();
    let tempo_family = tempo_style.family;
    let tempo_bold = tempo_style.bold;
    let baseline_offset = text_styles::baseline_offset_from_middle(tempo_family, text_size);
    let clearance = config
        .placement
        .resolve(ElementKind::Tempo)
        .padding
        .vertical
        * sp;

    let total_beats = ml.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
    let x_origin = ml.x + ml.prefix_width;
    let notehead_w = 1.18 * sp;
    let mi = ml.resolved.index;

    for (i, tempo) in tempos.iter().enumerate() {
        let cmd_idx = dl.commands.len();
        let show_metronome = tempo.show_metronome_mark.unwrap_or(true);
        let has_text = tempo.text.as_ref().is_some_and(|t| !t.is_empty());
        let show_text = has_text && tempo.show_text.unwrap_or(true);
        let beat = tempo.location.as_ref().map_or(0.0, |loc| loc.beats());
        let event_x = if beat == 0.0 {
            None
        } else {
            ml.voice_layouts.iter().find_map(|vl| {
                (0..vl.events.len())
                    .find(|&i| (vl.events.beat_position(i) - beat).abs() < 0.01)
                    .map(|i| vl.events.x(i))
            })
        };
        let tempo_x = match event_x {
            Some(ex) => ex,
            None => {
                if beat == 0.0 {
                    x_origin
                } else {
                    let beat_pos = beat / total_beats;
                    x_origin + beat_pos * content_width + notehead_w * 0.5
                }
            }
        };
        let tempo_x = match rehearsal_mark_x_extent(ml, sp) {
            Some((_, mark_right)) if tempo_x < mark_right + 0.5 * sp => mark_right + 0.5 * sp,
            _ => tempo_x,
        };

        if show_metronome {
            let (runs, total_w) =
                tempo_metronome_runs(tempo, show_text, text_size, sp, tempo_family, tempo_bold);
            let (place_x, line_y) = resolve_tempo_with_manual(
                tempo,
                ml,
                staff_y,
                sp,
                config,
                above_glyph_boxes,
                tempo_x,
                total_w,
                beat,
                baseline_offset,
                clearance,
                leading_clef_gap,
            );
            let baseline_y = line_y + baseline_offset;
            for run in runs {
                match run {
                    TempoRun::Text { dx, text } => {
                        dl.push(RenderCommand::DrawText {
                            x: place_x + dx,
                            y: baseline_y,
                            text,
                            font: tempo_font.clone(),
                            size: text_size,
                            color: tempo_color.clone(),
                            align: TextAlign::Left,
                            baseline: TextBaseline::Alphabetic,
                        });
                    }
                    TempoRun::Glyph {
                        dx,
                        codepoint,
                        size,
                    } => {
                        dl.push(RenderCommand::DrawGlyph {
                            x: place_x + dx,
                            y: baseline_y,
                            codepoint,
                            font: "Bravura".into(),
                            size,
                            color: tempo_color.clone(),
                            rotation: 0.0,
                        });
                    }
                }
            }
            let glyph_ascent = 2.1 * sp;
            let block_top = baseline_y - glyph_ascent;
            let block_h = baseline_y - block_top;
            dl.push_element_bbox_with_shape(ElementBBox {
                element_id: element_id::tempo(mi, i),
                bbox: BoundingBox::new(place_x, block_top, total_w, block_h),
            });
        } else if show_text {
            let full_text = tempo.text.as_deref().unwrap_or("").to_string();
            let n_chars = full_text.chars().count();
            let est_width = n_chars as f64 * 0.6 * text_size;
            let (place_x, line_y) = resolve_tempo_with_manual(
                tempo,
                ml,
                staff_y,
                sp,
                config,
                above_glyph_boxes,
                tempo_x,
                est_width,
                beat,
                baseline_offset,
                clearance,
                leading_clef_gap,
            );
            let baseline_y = line_y + baseline_offset;
            dl.push(RenderCommand::DrawText {
                x: place_x,
                y: baseline_y,
                text: full_text.clone(),
                font: tempo_font.clone(),
                size: text_size,
                color: tempo_color.clone(),
                align: TextAlign::Left,
                baseline: TextBaseline::Alphabetic,
            });
            let text_w = text_styles::text_width(&full_text, text_size, tempo_family, tempo_bold);
            let block_h = text_size * 0.82;
            let block_top = baseline_y - block_h;
            dl.push_element_bbox_with_shape(ElementBBox {
                element_id: element_id::tempo(mi, i),
                bbox: BoundingBox::new(place_x, block_top, text_w, block_h),
            });
        } else {
            continue;
        }

        let eid = element_id::tempo(mi, i);
        let cmd_end = dl.commands.len();
        for ci in cmd_idx..cmd_end {
            dl.tag_command(ci, eid.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::format_bpm;

    #[test]
    fn formats_integer_and_fractional_bpm() {
        assert_eq!(format_bpm(120.0), "120");
        assert_eq!(format_bpm(116.5), "116.5");
        assert_eq!(format_bpm(116.567), "116.57");
    }
}

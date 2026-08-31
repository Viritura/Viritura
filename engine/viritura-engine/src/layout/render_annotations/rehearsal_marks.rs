use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::types::*;
use super::substrate_obstacles::{above_glyph_top_in_range, highest_point_in_range, AboveGlyphBox};
use crate::model::{RehearsalMark, RehearsalMarkStyle, ResolvedMeasure};
use crate::render::smufl::smufl;
use crate::render::*;

/// Horizontal extent (left edge, right edge) of the rehearsal mark a measure
/// would draw at its start, or `None` if the measure has no rehearsal mark.
pub(crate) fn rehearsal_mark_x_extent(ml: &MeasureLayout, sp: f64) -> Option<(f64, f64)> {
    let _ = ml.resolved.global.rehearsal_mark()?;
    let box_w = rehearsal_box_width(ml, sp)?;
    let left = if ml.is_first_on_system {
        ml.x
    } else {
        ml.x - box_w * 0.5
    };
    Some((left, left + box_w))
}

fn rehearsal_box_width(ml: &MeasureLayout, sp: f64) -> Option<f64> {
    let mark = ml.resolved.global.rehearsal_mark()?;
    Some(rehearsal_box_width_for_mark(mark, sp))
}

fn rehearsal_box_width_for_mark(mark: &RehearsalMark, sp: f64) -> f64 {
    rehearsal_frame(mark, sp, 0.0, 0.0).width
}

pub(super) fn rehearsal_mark_reserved_width(mark: &RehearsalMark, sp: f64) -> f64 {
    rehearsal_box_width_for_mark(mark, sp)
}

struct RehearsalFrame {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
    pub text_center_x: f64,
    pub baseline_y: f64,
}

fn rehearsal_frame(mark: &RehearsalMark, sp: f64, left: f64, center_y: f64) -> RehearsalFrame {
    let font_size = 2.8 * sp;
    let padding_x = 0.4 * sp;
    let padding_y = 0.4 * sp;
    let cap_height = 0.7 * font_size;
    let text_width = smufl::serif_bold_text_width(&mark.text, font_size);
    let baseline_y = center_y + cap_height * 0.5;
    let style = mark.style.as_ref().unwrap_or(&RehearsalMarkStyle::Boxed);
    match style {
        RehearsalMarkStyle::Boxed => {
            let width = text_width + padding_x * 2.0;
            let height = cap_height + padding_y * 2.0;
            RehearsalFrame {
                left,
                top: center_y - height * 0.5,
                width,
                height,
                text_center_x: left + width * 0.5,
                baseline_y,
            }
        }
        RehearsalMarkStyle::Circled => {
            let radius = (text_width.max(font_size) * 0.5 + padding_x).max(font_size * 0.8);
            RehearsalFrame {
                left,
                top: center_y - radius,
                width: radius * 2.0,
                height: radius * 2.0,
                text_center_x: left + radius,
                baseline_y,
            }
        }
        RehearsalMarkStyle::Plain => RehearsalFrame {
            left,
            top: center_y - cap_height * 0.5,
            width: text_width,
            height: cap_height,
            text_center_x: left + text_width * 0.5,
            baseline_y,
        },
    }
}

pub(crate) fn measure_above_label_reserved_width(rm: &ResolvedMeasure, sp: f64) -> f64 {
    match rm.global.rehearsal_mark() {
        Some(mark) => rehearsal_box_width_for_mark(mark, sp),
        None => 0.0,
    }
}

struct RehearsalPlacement {
    pub left: f64,
    pub center_y: f64,
    pub baseline_y: f64,
}

fn rehearsal_mark_placement(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    above_glyph_boxes: &[AboveGlyphBox],
    leading_clef_gap: f64,
) -> Option<RehearsalPlacement> {
    let box_w = rehearsal_box_width(ml, sp)?;
    let font_size = 2.8 * sp;
    let padding_y = 0.4 * sp;
    let rehearsal_metrics = config.placement.resolve(ElementKind::RehearsalMark);
    let clearance = rehearsal_metrics.padding.vertical * sp;
    let cap_height = 0.7 * font_size;
    let half_below = cap_height * 0.5 + padding_y;
    let barline_x = ml.x + leading_clef_gap;
    let min_mark_y = staff_y - rehearsal_metrics.attach_gap * sp - cap_height * 0.5;
    let ideal_left = if ml.is_first_on_system {
        barline_x
    } else {
        barline_x - box_w * 0.5
    };
    let max_dodge = if ml.is_first_on_system {
        0.0
    } else {
        box_w * 0.5
    };
    let obstacle_over = |left: f64, right: f64| -> f64 {
        let mut o = highest_point_in_range(ml, staff_y, sp, config.stem_length, left, right);
        if let Some(top) = above_glyph_top_in_range(above_glyph_boxes, left, right) {
            o = o.min(top);
        }
        o
    };
    let obstacle_anchor = obstacle_over(ideal_left, ideal_left + box_w);
    let center_y_vertical = min_mark_y.min(obstacle_anchor - clearance - half_below);
    let clear_threshold = min_mark_y + half_below + clearance;
    let h_clear = clearance;
    let clears_horizontally = |left: f64| -> bool {
        let right = left + box_w;
        let notes_clear = highest_point_in_range(ml, staff_y, sp, config.stem_length, left, right)
            >= clear_threshold;
        let bands_clear =
            above_glyph_top_in_range(above_glyph_boxes, left - h_clear, right + h_clear)
                .is_none_or(|top| top >= clear_threshold);
        notes_clear && bands_clear
    };
    let mut horizontal_movement = f64::INFINITY;
    let step = 0.1 * sp;
    let mut dx = 0.0;
    while dx <= max_dodge + 1e-6 {
        if clears_horizontally(ideal_left - dx) {
            horizontal_movement = dx;
            break;
        }
        dx += step;
    }
    if horizontal_movement.is_finite() {
        Some(RehearsalPlacement {
            left: ideal_left - horizontal_movement,
            center_y: min_mark_y,
            baseline_y: min_mark_y + cap_height * 0.5,
        })
    } else {
        Some(RehearsalPlacement {
            left: ideal_left,
            center_y: center_y_vertical,
            baseline_y: center_y_vertical + cap_height * 0.5,
        })
    }
}

pub(crate) fn rehearsal_mark_baseline_y(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    above_glyph_boxes: &[AboveGlyphBox],
    leading_clef_gap: f64,
) -> Option<f64> {
    rehearsal_mark_placement(ml, staff_y, sp, config, above_glyph_boxes, leading_clef_gap)
        .map(|p| p.baseline_y)
}

pub(crate) fn collect_above_text_boxes(
    commands: &[RenderCommand],
    staff_y: f64,
) -> Vec<AboveGlyphBox> {
    let mut boxes = Vec::new();
    for cmd in commands {
        if let RenderCommand::DrawText {
            x,
            y,
            text,
            size,
            baseline,
            ..
        } = cmd
        {
            if *y >= staff_y {
                continue;
            }
            let text_width = text.chars().count() as f64 * 0.5 * *size;
            let top = match baseline {
                TextBaseline::Bottom => *y - *size,
                TextBaseline::Middle => *y - *size * 0.5,
                _ => *y,
            };
            boxes.push((*x, *x + text_width, top));
        }
    }
    boxes
}

/// Render rehearsal marks above the staff.
pub(crate) fn render_rehearsal_marks(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    above_glyph_boxes: &[AboveGlyphBox],
    leading_clef_gap: f64,
) {
    let global = &ml.resolved.global;
    let mark = match global.rehearsal_mark() {
        Some(m) => m,
        None => return,
    };
    let mi = ml.resolved.index;
    let cmd_idx = dl.commands.len();
    let border_width = 0.12 * sp;
    let style = mark.style.as_ref().unwrap_or(&RehearsalMarkStyle::Boxed);
    let placement =
        rehearsal_mark_placement(ml, staff_y, sp, config, above_glyph_boxes, leading_clef_gap);
    let avoid = mark.avoid_collisions.unwrap_or(true);
    let [off_x_sp, off_y_sp] = mark.manual_offset.unwrap_or([0.0, 0.0]);
    let barline_x = ml.x + leading_clef_gap;
    let (mark_left, mark_y) = if avoid {
        (
            placement.as_ref().map_or(barline_x, |p| p.left),
            placement.map_or(staff_y - 3.5 * sp, |p| p.center_y),
        )
    } else {
        (barline_x, staff_y - 3.5 * sp)
    };
    let mark_left = mark_left + off_x_sp * sp;
    let mark_y = mark_y - off_y_sp * sp;
    let frame = rehearsal_frame(mark, sp, mark_left, mark_y);

    match style {
        RehearsalMarkStyle::Boxed => {
            let (x0, y0) = (frame.left, frame.top);
            let (x1, y1) = (frame.left + frame.width, frame.top + frame.height);
            let half = border_width * 0.5;
            dl.push(RenderCommand::DrawLine {
                x1: x0 - half,
                y1: y0,
                x2: x1 + half,
                y2: y0,
                width: border_width,
                color: "#000000".into(),
            });
            dl.push(RenderCommand::DrawLine {
                x1: x0 - half,
                y1,
                x2: x1 + half,
                y2: y1,
                width: border_width,
                color: "#000000".into(),
            });
            dl.push(RenderCommand::DrawLine {
                x1: x0,
                y1: y0 - half,
                x2: x0,
                y2: y1 + half,
                width: border_width,
                color: "#000000".into(),
            });
            dl.push(RenderCommand::DrawLine {
                x1,
                y1: y0 - half,
                x2: x1,
                y2: y1 + half,
                width: border_width,
                color: "#000000".into(),
            });
        }
        RehearsalMarkStyle::Circled => {
            let radius = frame.width * 0.5;
            dl.push(RenderCommand::DrawEllipse {
                cx: frame.text_center_x,
                cy: mark_y,
                rx: radius,
                ry: radius,
                angle: 0.0,
                filled: false,
                color: "#000000".into(),
            });
        }
        RehearsalMarkStyle::Plain => {}
    }

    dl.push(RenderCommand::DrawText {
        x: frame.text_center_x,
        y: frame.baseline_y,
        text: mark.text.clone(),
        font: "serif bold".into(),
        size: 2.8 * sp,
        color: "#000000".into(),
        align: TextAlign::Center,
        baseline: TextBaseline::Alphabetic,
    });

    let eid = element_id::rehearsal(mi);
    let cmd_end = dl.commands.len();
    for ci in cmd_idx..cmd_end {
        dl.tag_command(ci, eid.clone());
    }
    let half = border_width * 0.5;
    dl.push_element_bbox_with_shape(ElementBBox {
        element_id: eid,
        bbox: BoundingBox::new(
            frame.left - half,
            frame.top - half,
            frame.width + 2.0 * half,
            frame.height + 2.0 * half,
        ),
    });
}

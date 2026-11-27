//! House-style measure numbers and multimeasure-rest range labels.

use super::super::config::LayoutConfig;
use super::super::dependent_stacking::{resolve_stacking, StackBox, StackSide};
use super::super::element_id;
use super::super::render_measure;
use super::super::render_signatures;
use super::super::text_styles::{text_width, TextRole, TextStyle};
use super::super::types::*;
use crate::model::*;
use crate::render::*;

#[path = "measure_numbers/locations.rs"]
mod locations;
#[path = "measure_numbers/number_staff.rs"]
mod number_staff;
pub(crate) use locations::*;

pub(crate) struct NumberLabel {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub align: TextAlign,
    pub bbox: BoundingBox,
    pub style: TextStyle,
}

pub(crate) fn render_measure_numbers(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    render_here: bool,
    leading_clef_gap: f64,
) {
    if !render_here || has_multiple_number_locations(&config.bar_numbers) {
        return;
    }
    let Some(mut label) = number_label(ml, staff_y, sp, config) else {
        return;
    };
    if aligns_to_barline(ml, &config.bar_numbers) {
        label.x += leading_clef_gap;
        label.bbox.x += leading_clef_gap;
    }
    let eid = element_id::measure_number(ml.resolved.index);
    render_number_label(dl, label, sp, config, eid);
}

fn aligns_to_barline(ml: &MeasureLayout, settings: &BarNumberSettings) -> bool {
    match settings.horizontal_alignment {
        Some(BarNumberHorizontalAlignment::Barline) => true,
        Some(BarNumberHorizontalAlignment::Center) => false,
        None => ml.multimeasure_rest_count.is_none(),
    }
}

fn render_number_label(
    dl: &mut DisplayList,
    label: NumberLabel,
    sp: f64,
    config: &LayoutConfig,
    eid: String,
) {
    let enclosure = config.bar_numbers.enclosure.unwrap_or_default();
    let b = &label.bbox;
    match enclosure {
        BarNumberEnclosure::None => {}
        BarNumberEnclosure::Box => {
            let width = 0.12 * sp;
            for (x1, y1, x2, y2) in [
                (b.x, b.y, b.x + b.width, b.y),
                (b.x, b.y + b.height, b.x + b.width, b.y + b.height),
                (b.x, b.y, b.x, b.y + b.height),
                (b.x + b.width, b.y, b.x + b.width, b.y + b.height),
            ] {
                dl.push_tagged(
                    RenderCommand::DrawLine {
                        x1,
                        y1,
                        x2,
                        y2,
                        width,
                        color: label.style.color.clone(),
                    },
                    eid.clone(),
                );
            }
        }
        BarNumberEnclosure::Circle => dl.push_tagged(
            RenderCommand::DrawEllipse {
                cx: b.x + b.width * 0.5,
                cy: b.y + b.height * 0.5,
                rx: b.width * 0.5,
                ry: b.height * 0.5,
                angle: 0.0,
                filled: false,
                color: label.style.color.clone(),
            },
            eid.clone(),
        ),
    }
    dl.push_tagged(
        RenderCommand::DrawText {
            x: label.x,
            y: label.y,
            text: label.text,
            font: label.style.font_string(),
            size: label.style.size_sp * sp,
            color: label.style.color.clone(),
            align: label.align,
            baseline: TextBaseline::Top,
        },
        eid.clone(),
    );
    dl.push_element_bbox_with_shape(ElementBBox {
        element_id: eid,
        bbox: label.bbox,
    });
}

/// Top edge of a below-staff bar number, clearing the system-start clef.
pub(crate) fn below_staff_number_top_y(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) -> f64 {
    let bottom_line = staff_y + 4.0 * sp;
    let renders_clef = ml.is_first_on_system || ml.resolved.index == 0;
    let clef_floor = if renders_clef {
        start_clef(ml).map_or(bottom_line, |c| {
            render_signatures::clef_bottom_y(c, staff_y, sp)
        })
    } else {
        bottom_line
    };
    let attach_gap = config.bar_numbers.distance.unwrap_or_else(|| {
        config
            .placement
            .resolve(ElementKind::MeasureNumber)
            .attach_gap
    });
    clef_floor.max(bottom_line) + attach_gap * sp
}

/// The clef drawn at the start of this measure, if any.
pub(crate) fn start_clef(ml: &MeasureLayout) -> Option<&Clef> {
    ml.resolved.part.clefs.as_ref().and_then(|clefs| {
        clefs
            .iter()
            .find(|c| match &c.position {
                None => true,
                Some(p) => p.fraction.0 == 0,
            })
            .map(|pc| &pc.clef)
    })
}

pub(crate) fn number_label(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) -> Option<NumberLabel> {
    let settings = &config.bar_numbers;
    if settings.frequency == Some(BarNumberFrequency::Hidden) {
        return None;
    }
    let (text, mut x, mut centered) = if let Some(count) = ml.multimeasure_rest_count {
        let start = ml
            .resolved
            .global
            .number
            .unwrap_or(ml.resolved.index as i32 + 1);
        if start == 0 {
            return None;
        }
        let prefix = render_measure::multimeasure_rest_structural_prefix(ml, sp, config);
        (
            format!("{start}\u{2013}{}", start + count as i32 - 1),
            ml.x + (prefix + ml.width) * 0.5,
            true,
        )
    } else {
        (measure_number_value(ml, config)?.to_string(), ml.x, false)
    };
    if let Some(alignment) = settings.horizontal_alignment {
        centered = alignment == BarNumberHorizontalAlignment::Center;
        x = ml.x + if centered { ml.width * 0.5 } else { 0.0 };
    }
    let style = bar_number_style(config);
    let size = style.size_sp * sp;
    let width = text_width(&text, size, style.family, style.bold);
    let padding = if settings.enclosure.unwrap_or_default() == BarNumberEnclosure::None {
        0.0
    } else {
        0.4 * sp
    };
    let (box_width, box_height) = if settings.enclosure == Some(BarNumberEnclosure::Circle) {
        let diameter = width.hypot(size) + 2.0 * padding;
        (diameter, diameter)
    } else {
        (width + 2.0 * padding, size + 2.0 * padding)
    };
    let top = if settings.placement == Some(BarNumberPlacement::AboveSystem) {
        staff_y
            - settings.distance.unwrap_or_else(|| {
                config
                    .placement
                    .resolve(ElementKind::MeasureNumber)
                    .attach_gap
            }) * sp
            - box_height
    } else if ml.multimeasure_rest_count.is_some() {
        staff_y + 4.0 * sp + settings.distance.unwrap_or(0.5) * sp
    } else {
        below_staff_number_top_y(ml, staff_y, sp, config)
    };
    let left = x - if centered { box_width * 0.5 } else { padding };
    Some(NumberLabel {
        text,
        x: if centered {
            left + box_width * 0.5
        } else {
            left + (box_width - width) * 0.5
        },
        y: top + (box_height - size) * 0.5,
        align: if centered {
            TextAlign::Center
        } else {
            TextAlign::Left
        },
        bbox: BoundingBox::new(left, top, box_width, box_height),
        style,
    })
}

pub(crate) fn bar_number_style(config: &LayoutConfig) -> TextStyle {
    let settings = &config.bar_numbers;
    let mut style = config.text_styles.resolve(TextRole::BarNumber).clone();
    if let Some(size) = settings.size {
        style.size_sp = size;
    }
    if let Some(family) = settings.family {
        style.family = family;
    }
    if let Some(bold) = settings.bold {
        style.bold = bold;
    }
    if let Some(italic) = settings.italic {
        style.italic = italic;
    }
    if let Some(override_style) = &settings.style {
        if let Some(size) = override_style.size {
            style.size_sp = size;
        }
        if let Some(family) = override_style.family {
            style.family = family;
        }
        if let Some(bold) = override_style.bold {
            style.bold = bold;
        }
        if let Some(italic) = override_style.italic {
            style.italic = italic;
        }
    }
    style
}

pub(crate) fn measure_number_value(ml: &MeasureLayout, config: &LayoutConfig) -> Option<i32> {
    let settings = &config.bar_numbers;
    if settings.frequency == Some(BarNumberFrequency::Hidden)
        || (!ml.is_first_on_system && settings.frequency != Some(BarNumberFrequency::EveryBar))
    {
        return None;
    }
    let number = match ml.resolved.global.number {
        Some(0) => return None,
        Some(n) => n,
        None => ml.resolved.index as i32 + 1,
    };
    (number > 1 || (number == 1 && settings.show_first == Some(true))).then_some(number)
}

/// Bar numbers join the existing outward stacking field after musical ink settles.
#[allow(clippy::too_many_arguments)] // The display staff shares its owner's geometry and optional global row position.
pub(crate) fn flow_bar_numbers(
    dl: &mut DisplayList,
    staff_cmd_start: usize,
    config: &LayoutConfig,
    layouts: &[MeasureLayout],
    staff_y: f64,
    render_here: bool,
    context: Option<&BarNumberStaffContext>,
    clef_changes: &std::collections::HashSet<usize>,
) {
    if has_multiple_number_locations(&config.bar_numbers) {
        let fallback = BarNumberStaffContext {
            staff_index: 0,
            placements: simple_number_locations(&config.bar_numbers, 0, 1, 0),
            rows: BarNumberRowPositions::default(),
        };
        let context = context.unwrap_or(&fallback);
        for &placement in &context.placements {
            let above = placement == BarNumberPlacement::AboveSystem;
            let key = number_location_key(context.staff_index, above);
            let mut local = config.clone();
            local.bar_numbers.placements = None;
            local.bar_numbers.above_groups = None;
            local.bar_numbers.placement = Some(placement);
            for layout in layouts {
                if let Some(mut label) = number_label(layout, staff_y, config.sp, &local) {
                    if aligns_to_barline(layout, &local.bar_numbers) {
                        let gap = render_measure::measure_leading_clef_gap(
                            layout,
                            config.sp,
                            clef_changes,
                        );
                        label.x += gap;
                        label.bbox.x += gap;
                    }
                    render_number_label(
                        dl,
                        label,
                        config.sp,
                        &local,
                        format!("m{}/{key}/mnum", layout.resolved.index),
                    );
                }
            }
            let row_y = if above {
                context.rows.above
            } else {
                context.rows.below
            };
            flow_number_location(
                dl,
                staff_cmd_start,
                &local,
                layouts,
                staff_y,
                true,
                row_y,
                Some(&key),
            );
        }
        return;
    }
    let row_y = context.and_then(|context| {
        if config.bar_numbers.placement == Some(BarNumberPlacement::AboveSystem) {
            context.rows.above
        } else {
            context.rows.below
        }
    });
    flow_number_location(
        dl,
        staff_cmd_start,
        config,
        layouts,
        staff_y,
        render_here,
        row_y,
        None,
    );
}

#[allow(clippy::too_many_arguments)] // Each location owns its labels and row while sharing the staff's obstacles.
fn flow_number_location(
    dl: &mut DisplayList,
    staff_cmd_start: usize,
    config: &LayoutConfig,
    layouts: &[MeasureLayout],
    staff_y: f64,
    render_here: bool,
    row_y: Option<f64>,
    location_key: Option<&str>,
) {
    if !render_here || config.bar_numbers.frequency == Some(BarNumberFrequency::Hidden) {
        return;
    }
    let side = if config.bar_numbers.placement == Some(BarNumberPlacement::AboveSystem) {
        StackSide::Above
    } else {
        StackSide::Below
    };
    let metrics = config.placement.resolve(ElementKind::MeasureNumber);
    let sp = config.sp;
    let mut ids = Vec::new();
    let mut boxes = Vec::new();
    for (index, _) in dl.commands.iter().enumerate().skip(staff_cmd_start) {
        let id = dl.element_ids.get(index).and_then(Option::as_deref);
        if id.is_some_and(|id| {
            id.ends_with("/mnum")
                && location_key.is_none_or(|key| id.ends_with(&format!("/{key}/mnum")))
        }) {
            let id = id.unwrap();
            if ids.iter().any(|known| known == id) {
                continue;
            }
            let Some((left, right, top, bottom)) = super::marking_extent(dl, staff_cmd_start, id)
            else {
                continue;
            };
            ids.push(id.to_string());
            boxes.push(StackBox {
                x0: left,
                x1: right,
                y_top: top,
                y_bottom: bottom,
                stack_gap: metrics.padding.vertical * sp,
                side_bearing: metrics.padding.horizontal * sp,
                stack_rank: metrics.stack_rank,
                side,
                pinned: false,
            });
        }
    }
    if config.bar_numbers.on_staff == Some(true) {
        number_staff::place(
            dl,
            staff_cmd_start,
            config,
            layouts,
            staff_y,
            &ids,
            &boxes,
            row_y,
            location_key,
        );
        return;
    }
    if ids.is_empty() {
        return;
    }
    append_obstacles(dl, staff_cmd_start, side, &mut boxes);
    let shifts = resolve_stacking(&boxes);
    for (id, shift) in ids.iter().zip(shifts) {
        super::shift_marking(dl, staff_cmd_start, id, -shift);
    }
}

fn append_obstacles(
    dl: &DisplayList,
    staff_cmd_start: usize,
    side: StackSide,
    boxes: &mut Vec<StackBox>,
) {
    for (index, command) in dl.commands.iter().enumerate().skip(staff_cmd_start) {
        if dl
            .element_ids
            .get(index)
            .and_then(Option::as_deref)
            .is_some_and(|id| id.ends_with("/mnum"))
        {
            continue;
        }
        let bbox = match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } => Some(super::glyph_screen_bbox(*x, *y, *codepoint, *size).to_bbox()),
            RenderCommand::DrawText { .. } => {
                super::substrate_obstacles::text_command_bbox(command)
            }
            RenderCommand::EraseRect { .. } => None,
            _ => command.bbox(),
        };
        if let Some(bbox) = bbox {
            boxes.push(StackBox {
                x0: bbox.x,
                x1: bbox.x + bbox.width,
                y_top: bbox.y,
                y_bottom: bbox.y + bbox.height,
                stack_gap: 0.0,
                side_bearing: 0.0,
                stack_rank: 0,
                side,
                pinned: true,
            });
        }
    }
}

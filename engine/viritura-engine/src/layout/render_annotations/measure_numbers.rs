//! House-style measure numbers and multimeasure-rest range labels.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_measure;
use super::super::render_signatures;
use super::super::types::*;
use crate::model::*;
use crate::render::*;

/// Render measure number above the staff following house style.
pub(crate) fn render_measure_numbers(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    render_here: bool,
) {
    if !render_here {
        return;
    }
    if let Some(count) = ml.multimeasure_rest_count {
        render_multimeasure_number_range(dl, ml, staff_y, sp, count);
        return;
    }

    let number = match measure_number_value(ml) {
        Some(n) => n,
        None => return,
    };

    let font_size = 2.0 * sp;
    let num_y = below_staff_number_top_y(ml, staff_y, sp, config);
    let num_x = ml.x;

    dl.push_tagged(
        RenderCommand::DrawText {
            x: num_x,
            y: num_y,
            text: number.to_string(),
            font: "serif italic".into(),
            size: font_size,
            color: "#000000".into(),
            align: TextAlign::Left,
            baseline: TextBaseline::Top,
        },
        element_id::measure_number(ml.resolved.index),
    );
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
    let attach_gap = config
        .placement
        .resolve(ElementKind::MeasureNumber)
        .attach_gap;
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

fn render_multimeasure_number_range(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    count: u32,
) {
    let start = match ml.resolved.global.number {
        Some(0) => return,
        Some(n) => n,
        None => ml.resolved.index as i32 + 1,
    };
    let end = start + count as i32 - 1;

    let font_size = 2.0 * sp;
    let prefix = render_measure::multimeasure_rest_structural_prefix(ml, sp);
    let center_x = ((ml.x + prefix) + (ml.x + ml.width)) / 2.0;
    let num_y = staff_y + 4.0 * sp + 0.5 * sp;

    dl.push_tagged(
        RenderCommand::DrawText {
            x: center_x,
            y: num_y,
            text: format!("{start}\u{2013}{end}"),
            font: "serif italic".into(),
            size: font_size,
            color: "#000000".into(),
            align: TextAlign::Center,
            baseline: TextBaseline::Top,
        },
        element_id::measure_number(ml.resolved.index),
    );
}

/// The measure number to print, following the system-start house style.
pub(crate) fn measure_number_to_display(ml: &MeasureLayout) -> Option<i32> {
    if !ml.is_first_staff {
        return None;
    }
    measure_number_value(ml)
}

pub(crate) fn measure_number_value(ml: &MeasureLayout) -> Option<i32> {
    if !ml.is_first_on_system {
        return None;
    }
    let number = match ml.resolved.global.number {
        Some(0) => return None,
        Some(n) => n,
        None => ml.resolved.index as i32 + 1,
    };
    (number > 1).then_some(number)
}

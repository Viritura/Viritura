use crate::layout::config::LayoutConfig;
use crate::layout::element_id;
use crate::layout::render_barlines::{render_barline, BarlineKind};
use crate::layout::types::MeasureLayout;
use crate::render::{DisplayList, RenderCommand};

pub(crate) const REPEAT_SIGNATURE_BRACKET_SP: f64 = 0.35;

/// Aligned x of a deferred start-repeat barline, inset from the prefix end.
pub(crate) fn deferred_repeat_start_x(ml: &MeasureLayout, sp: f64) -> f64 {
    ml.x + ml.prefix_width
        - ml.first_onset_padding
        - (super::super::measure::PREFIX_TO_ONSET_GAP_SP + 1.0) * sp
}

pub(crate) fn render_deferred_repeat_start(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    x_cursor: f64,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let bar_x = (x_cursor + 0.5 * sp).max(deferred_repeat_start_x(ml, sp));
    let command_start = dl.commands.len();
    render_barline(
        dl,
        bar_x,
        staff_y,
        4.0 * sp,
        sp,
        config,
        &BarlineKind::RepeatStart,
    );
    for index in command_start..dl.commands.len() {
        dl.tag_command(index, element_id::barline(ml.resolved.index));
    }
}

pub(crate) fn draw_repeat_signature_bracket(
    dl: &mut DisplayList,
    x: f64,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    measure: usize,
    left: bool,
) {
    let width = REPEAT_SIGNATURE_BRACKET_SP * sp;
    let hook = 0.18 * sp;
    let vertical_x = if left { x + width } else { x };
    let hook_start = if left { vertical_x - hook } else { vertical_x };
    let hook_end = if left { vertical_x } else { vertical_x + hook };
    let top = staff_y + 0.2 * sp;
    let bottom = staff_y + 3.8 * sp;
    let line_width = config.barline_width * sp;
    let command_start = dl.commands.len();
    dl.push(RenderCommand::DrawLine {
        x1: vertical_x,
        y1: top,
        x2: vertical_x,
        y2: bottom,
        width: line_width,
        color: "#000000".into(),
    });
    for y in [top, bottom] {
        dl.push(RenderCommand::DrawLine {
            x1: hook_start,
            y1: y,
            x2: hook_end,
            y2: y,
            width: line_width,
            color: "#000000".into(),
        });
    }
    for index in command_start..dl.commands.len() {
        dl.tag_command(index, element_id::barline(measure));
    }
}

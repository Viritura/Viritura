//! Measure-repeat (simile) signs.
//!
//! A simile mark says "repeat all music in the previous N measures". MNX puts
//! it on the FIRST bar it covers; the bars it spans carry no encoding of their
//! own and normally hold empty sequences.
//!
//! Standard engraving practice:
//!   - the sign is centred in the bar (or across the group of bars it covers)
//!     and straddles the middle staff line;
//!   - a multi-bar sign carries its bar count above the staff;
//!   - a run of single-bar signs may carry an iteration counter above the
//!     staff so players can keep their place.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::types::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;

/// SMuFL glyph for a simile sign covering `bars` measures. Bravura provides
/// precomposed one-, two-, and four-bar signs; any other span falls back to the
/// single-bar slash, which is what the count number above the staff clarifies.
fn repeat_glyph(bars: u32) -> u32 {
    match bars {
        2 => smufl::REPEAT_2_BARS,
        4 => smufl::REPEAT_4_BARS,
        _ => smufl::REPEAT_1_BAR,
    }
}

/// Whether the bar count is printed above the sign. MNX leaves this to the
/// engraver when `displayNumber` is absent: convention prints it for multi-bar
/// signs (where the reader cannot infer the span from the glyph alone) and
/// omits it for a plain one-bar simile.
fn shows_number(repeat: &MeasureRepeat) -> bool {
    match repeat.display_number {
        Some(crate::raw::YesNoAuto::Yes) => true,
        Some(crate::raw::YesNoAuto::No) => false,
        Some(crate::raw::YesNoAuto::Auto) | None => repeat.number > 1,
    }
}

/// Total advance of a span number in the same SMuFL numeral style used by
/// multimeasure-rest counts.
fn span_number_width(text: &str, sp: f64) -> f64 {
    text.chars()
        .filter_map(|character| character.to_digit(10))
        .map(|digit| smufl::time_sig_digit_advance(digit) * sp)
        .sum()
}

/// Draw the number of measures covered by the sign in the established
/// multimeasure-rest numeral style.
fn draw_span_number(dl: &mut DisplayList, text: &str, center_x: f64, y: f64, sp: f64) {
    let mut x = center_x - span_number_width(text, sp) / 2.0;
    for digit in text.chars().filter_map(|character| character.to_digit(10)) {
        dl.push(RenderCommand::DrawGlyph {
            x,
            y,
            codepoint: smufl::time_sig_digit(digit),
            font: "Bravura".into(),
            size: 4.0 * sp,
            color: "#000000".into(),
            rotation: 0.0,
        });
        x += smufl::time_sig_digit_advance(digit) * sp;
    }
}

/// Draw the optional iteration counter in the score's regular text face.
fn draw_counter(dl: &mut DisplayList, text: String, center_x: f64, y: f64, sp: f64) {
    dl.push(RenderCommand::DrawText {
        x: center_x,
        y,
        text,
        font: "serif".into(),
        size: 1.5 * sp,
        color: "#000000".into(),
        align: TextAlign::Center,
        baseline: TextBaseline::Bottom,
    });
}

/// Render the simile sign for this measure, if it carries one.
///
/// The sign is centred between its bounding barlines. `staffPosition` shifts
/// its origin off the middle staff line in half-space units, matching MNX.
pub(crate) fn render_measure_repeat(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    span_right: f64,
    staff_y: f64,
    sp: f64,
    _config: &LayoutConfig,
    render_numbers: bool,
) {
    let Some(repeat) = ml.resolved.part.measure_repeat.as_ref() else {
        return;
    };

    let codepoint = repeat_glyph(repeat.number);
    let (bbox_x, bbox_y, bbox_w, bbox_h) = smufl::glyph_bbox(codepoint);

    let center_x = (ml.x + span_right) / 2.0;
    // MNX staff positions count half-spaces up from the middle line; screen y
    // grows downward.
    let staff_position = f64::from(repeat.staff_position.unwrap_or(0));
    let baseline_y = staff_y + 2.0 * sp - staff_position * 0.5 * sp;

    let cmd_idx = dl.commands.len();
    dl.push(RenderCommand::DrawGlyph {
        x: center_x - (bbox_x + bbox_w / 2.0) * sp,
        y: baseline_y,
        codepoint,
        font: "Bravura".into(),
        size: 4.0 * sp,
        color: "#000000".into(),
        rotation: 0.0,
    });

    // The bar count sits directly above the sign; an iteration counter goes
    // above that (or below the staff when the counter asks for it).
    // Time-signature digit ink extends 1sp below its origin. An origin 2sp
    // above the top line therefore leaves exactly 1sp of clear air.
    let above_baseline = staff_y - 2.0 * sp;
    if render_numbers && shows_number(repeat) {
        draw_span_number(dl, &repeat.number.to_string(), center_x, above_baseline, sp);
    }

    if render_numbers {
        if let Some(counter) = repeat.counter.as_ref() {
            let below = counter.orient == Some(MultiStaffOrientation::Below);
            let counter_y = if below {
                staff_y + 4.0 * sp + 2.0 * sp
            } else if shows_number(repeat) {
                // The span numeral's ink top is 1sp above its origin. Place the
                // regular-text counter's ink bottom another 1sp above that.
                above_baseline - 2.0 * sp
            } else {
                // TextBaseline::Bottom makes y the counter's ink bottom.
                staff_y - sp
            };
            draw_counter(dl, counter.count.to_string(), center_x, counter_y, sp);
        }
    }

    let repeat_id = element_id::measure_repeat(ml.part_index, ml.resolved.index);
    for ci in cmd_idx..dl.commands.len() {
        dl.tag_command(ci, repeat_id.clone());
    }
    let hit_padding = 0.5 * sp;
    dl.push_element_bbox_with_shape(ElementBBox {
        element_id: repeat_id,
        bbox: BoundingBox::new(
            center_x - bbox_w * sp * 0.5 - hit_padding,
            baseline_y + bbox_y * sp - hit_padding,
            bbox_w * sp + 2.0 * hit_padding,
            bbox_h * sp + 2.0 * hit_padding,
        ),
    });
}

/// Right edge of the measure range a simile sign covers, clamped to the
/// measures available on this system. Standard engraving practice centres the
/// two- and four-bar signs across that complete range, not inside the first bar.
pub(crate) fn measure_repeat_span_right(
    measure_layouts: &[MeasureLayout],
    start_index: usize,
) -> f64 {
    let start = &measure_layouts[start_index];
    let span = start
        .resolved
        .part
        .measure_repeat
        .as_ref()
        .map_or(1, |repeat| repeat.number.max(1)) as usize;
    let end_index = (start_index + span - 1).min(measure_layouts.len() - 1);
    let end = &measure_layouts[end_index];
    end.x + end.width
}

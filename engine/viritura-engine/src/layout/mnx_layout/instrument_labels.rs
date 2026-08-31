use super::super::full_score::{FlatStaff, GroupRange};
use crate::layout::text_styles::TextStyle;
use crate::render::{DisplayList, RenderCommand, TextAlign, TextBaseline};

/// Color used for expansion source staves — blue-tinted gray derived from primary accent #2a7bc8.
pub(super) const EXPANSION_COLOR: &str = "#667890";

/// Split a staff label into two lines when it contains a transposition.
pub(super) fn split_label_transposition(label: &str) -> (&str, Option<&str>) {
    if let Some(idx) = label.find(" in ") {
        let base = &label[..idx];
        let transposition = &label[idx + 1..];
        (base, Some(transposition))
    } else {
        (label, None)
    }
}

/// Build final staff-label lines, merging condensed player numbers into transposing labels.
pub(super) fn build_label_lines(label: &str, condensed_numbers: &[u32]) -> Vec<String> {
    let (line1, line2) = split_label_transposition(label);
    if condensed_numbers.is_empty() {
        let mut lines = vec![line1.to_string()];
        if let Some(line2) = line2 {
            lines.push(line2.to_string());
        }
        return lines;
    }

    if let Some(line2) = line2 {
        let base_lines = [line1.to_string(), line2.to_string()];
        let mut result = Vec::new();
        for (index, number) in condensed_numbers.iter().enumerate() {
            if index < base_lines.len() {
                result.push(format!("{} {}", base_lines[index], number));
            } else {
                result.push(number.to_string());
            }
        }
        for line in base_lines.iter().skip(condensed_numbers.len()) {
            result.push(line.clone());
        }
        result
    } else {
        vec![line1.to_string()]
    }
}

/// Pixel extent from the right-hand anchor to the label's leftmost glyph.
///
/// Must measure with the same style [`render_staff_labels`] draws with, or the
/// reserved gutter and the glyphs disagree and long names collide with the
/// system's left margin.
pub(super) fn label_gutter_extent(
    label: &str,
    condensed_numbers: &[u32],
    sp: f64,
    style: &TextStyle,
) -> f64 {
    use crate::layout::text_styles::text_width;

    let label_font_size = style.size_px(sp);
    let max_line_width = build_label_lines(label, condensed_numbers)
        .iter()
        .map(|line| text_width(line, label_font_size, style.family, style.bold))
        .fold(0.0_f64, f64::max);
    let has_number_column =
        !condensed_numbers.is_empty() && split_label_transposition(label).1.is_none();
    let number_offset = if has_number_column {
        label_font_size * 0.75 + 0.5 * sp
    } else {
        0.0
    };
    number_offset + max_line_width
}

/// Render per-staff instrument labels in the left margin of a system.
///
/// `style` is the resolved [`TextRole::StaffLabel`](crate::layout::text_styles::TextRole)
/// style. Its `align` is deliberately not applied: these labels are
/// right-anchored against the system's left margin, and the gutter width is
/// measured from that anchor, so honouring a left/centre alignment here would
/// detach the names from the space reserved for them.
#[allow(clippy::too_many_arguments)] // rendering boundary: geometry and system identity are independent inputs
pub(super) fn render_staff_labels(
    dl: &mut DisplayList,
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
    staff_y_offsets: &[f64],
    label_x: f64,
    staff_height: f64,
    sp: f64,
    sys_idx: usize,
    style: &TextStyle,
) {
    let is_first_system = sys_idx == 0;
    let label_font_size = style.size_px(sp);
    let cap_offset =
        crate::layout::text_styles::cap_center_offset_from_baseline(style.family, label_font_size);

    for (index, flat_staff) in flat_staves.iter().enumerate() {
        if index >= staff_y_offsets.len() {
            continue;
        }
        let in_labeled_brace = group_ranges.iter().any(|group| {
            index >= group.first_staff
                && index <= group.last_staff
                && group.label.is_some()
                && group.symbol == "brace"
        });
        if in_labeled_brace {
            continue;
        }
        let label_text = if is_first_system {
            flat_staff.label.as_deref()
        } else {
            flat_staff
                .short_label
                .as_deref()
                .or(flat_staff.label.as_deref())
        };
        let Some(text) = label_text else { continue };

        let recolor_start = dl.commands.len();
        let label_y = staff_y_offsets[index] + staff_height * 0.5;
        let condensed_numbers = &flat_staff.condensed_numbers;
        let has_number_column =
            !condensed_numbers.is_empty() && split_label_transposition(text).1.is_none();
        let lines = build_label_lines(text, condensed_numbers);
        let number_column_gap = 0.5 * sp;
        let number_column_width = label_font_size * 0.75;
        let name_x = if has_number_column {
            label_x - number_column_width - number_column_gap
        } else {
            label_x
        };

        if lines.len() == 1 {
            push_label_line(dl, name_x, label_y + cap_offset, &lines[0], sp, style);
        } else {
            let line_height = label_font_size * 1.15;
            let top_y = label_y - line_height * (lines.len() as f64 - 1.0) * 0.5;
            for (line_index, line) in lines.iter().enumerate() {
                push_label_line(
                    dl,
                    name_x,
                    top_y + line_height * line_index as f64 + cap_offset,
                    line,
                    sp,
                    style,
                );
            }
        }

        if has_number_column {
            let line_height = label_font_size * 1.15;
            let top_y = label_y - line_height * (condensed_numbers.len() as f64 - 1.0) * 0.5;
            for (number_index, number) in condensed_numbers.iter().enumerate() {
                push_label_line(
                    dl,
                    label_x,
                    top_y + line_height * number_index as f64 + cap_offset,
                    &number.to_string(),
                    sp,
                    style,
                );
            }
        }

        if flat_staff.expansion {
            dl.recolor_range(recolor_start, EXPANSION_COLOR);
        }
    }
}

/// Emit one label line. Right-aligned by construction — see
/// [`render_staff_labels`] for why the style's own alignment is not used.
fn push_label_line(dl: &mut DisplayList, x: f64, y: f64, text: &str, sp: f64, style: &TextStyle) {
    dl.push(RenderCommand::DrawText {
        x,
        y,
        text: text.to_string(),
        font: style.font_string(),
        size: style.size_px(sp),
        color: style.color.clone(),
        align: TextAlign::Right,
        baseline: TextBaseline::Alphabetic,
    });
}

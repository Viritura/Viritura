use super::super::config::LayoutConfig;
use super::super::full_score::GroupRange;
use crate::layout::staff_brace::brace_geometry;
use crate::render::smufl::smufl;
use crate::render::{DisplayList, RenderCommand, TextAlign, TextBaseline};

pub(super) fn staves_share_group(gap_index: usize, groups: &[GroupRange]) -> bool {
    groups.is_empty()
        || groups
            .iter()
            .any(|group| group.first_staff <= gap_index && group.last_staff > gap_index)
}

/// Render staff-group brackets, braces, and brace labels in the system margin.
#[allow(clippy::too_many_arguments)] // rendering boundary: geometry and label policy are independent inputs
pub(super) fn render_group_brackets_and_braces(
    dl: &mut DisplayList,
    groups: &[GroupRange],
    staff_y_offsets: &[f64],
    margin_left: f64,
    staff_height: f64,
    sp: f64,
    config: &LayoutConfig,
    render_brace_labels: bool,
) {
    for group in groups {
        if group.first_staff >= staff_y_offsets.len() || group.last_staff >= staff_y_offsets.len() {
            continue;
        }
        if group.symbol == "bracket" && group.depth > 0 && group.first_staff == group.last_staff {
            continue;
        }
        let top_y = staff_y_offsets[group.first_staff];
        let bottom_y = staff_y_offsets[group.last_staff] + staff_height;

        match group.symbol.as_str() {
            "bracket" if group.depth > 0 => {
                let sub_x = margin_left - (0.85 + 0.25 * group.depth as f64) * sp;
                let connector_height = config.staff_line_width * sp;
                dl.push(RenderCommand::DrawRect {
                    x: sub_x,
                    y: top_y,
                    w: smufl::LINE_BRACKET_THICKNESS * sp,
                    h: bottom_y - top_y,
                    color: "#000000".into(),
                });
                for y in [top_y, bottom_y] {
                    dl.push(RenderCommand::DrawRect {
                        x: sub_x,
                        y: y - connector_height * 0.5,
                        w: margin_left - sub_x,
                        h: connector_height,
                        color: "#000000".into(),
                    });
                }
            }
            "bracket" => {
                let bracket_x = margin_left - 0.7 * sp;
                let glyph_size = 4.0 * sp;
                dl.push(RenderCommand::DrawGlyph {
                    x: bracket_x,
                    y: top_y,
                    codepoint: smufl::BRACKET_TOP,
                    font: "Bravura".into(),
                    size: glyph_size,
                    color: "#000000".into(),
                    rotation: 0.0,
                });
                dl.push(RenderCommand::DrawRect {
                    x: bracket_x,
                    y: top_y,
                    w: smufl::BRACKET_THICKNESS * sp,
                    h: bottom_y - top_y,
                    color: "#000000".into(),
                });
                dl.push(RenderCommand::DrawGlyph {
                    x: bracket_x,
                    y: bottom_y,
                    codepoint: smufl::BRACKET_BOTTOM,
                    font: "Bravura".into(),
                    size: glyph_size,
                    color: "#000000".into(),
                    rotation: 0.0,
                });
            }
            "brace" => {
                let staff_count = group.last_staff - group.first_staff + 1;
                let brace = brace_geometry(bottom_y - top_y, staff_count, sp);
                dl.push(RenderCommand::DrawStretchedGlyph {
                    x: margin_left - brace.width - 0.3 * sp,
                    y: bottom_y,
                    codepoint: brace.codepoint,
                    size: brace.size,
                    scale_x: brace.scale_x,
                    color: "#000000".into(),
                    font: "Bravura".into(),
                });
            }
            _ => {}
        }

        if render_brace_labels && group.symbol == "brace" {
            if let Some(label) = &group.label {
                let staff_count = group.last_staff - group.first_staff + 1;
                render_brace_label(dl, label, top_y, bottom_y, staff_count, margin_left, sp);
            }
        }
    }
}

fn render_brace_label(
    dl: &mut DisplayList,
    label: &str,
    top_y: f64,
    bottom_y: f64,
    staff_count: usize,
    margin_left: f64,
    sp: f64,
) {
    let font_size = 2.0 * sp;
    let brace = brace_geometry(bottom_y - top_y, staff_count, sp);
    let baseline_y = (top_y + bottom_y) * 0.5
        + crate::layout::text_styles::cap_center_offset_from_baseline(
            crate::layout::text_styles::FontFamily::Serif,
            font_size,
        );
    dl.push(RenderCommand::DrawText {
        x: margin_left - brace.width - 0.6 * sp,
        y: baseline_y,
        text: label.to_string(),
        font: "serif".into(),
        size: font_size,
        color: "#000000".into(),
        align: TextAlign::Right,
        baseline: TextBaseline::Alphabetic,
    });
}

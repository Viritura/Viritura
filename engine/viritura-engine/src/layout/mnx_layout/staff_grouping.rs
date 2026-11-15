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
        if !is_rendered_group(group, staff_y_offsets.len()) {
            continue;
        }
        let top_y = staff_y_offsets[group.first_staff];
        let bottom_y = staff_y_offsets[group.last_staff] + staff_height;

        match group.symbol.as_str() {
            // Standard engraving practice: a bracket nested inside another
            // bracket is drawn as a thin sub-bracket, not a second full bracket.
            "square" | "bracket" if group.symbol == "square" || group.depth > 0 => {
                // Standard engraving practice: a sub-bracket sits outside the
                // enclosing bracket, and its hooks reach the system line.
                let bracket_x = if group.depth == 0 {
                    margin_left - 0.7 * sp
                } else {
                    margin_left - (0.85 + 0.25 * group.depth as f64) * sp
                };
                let hook_thickness = config.staff_line_width * sp;
                dl.push(RenderCommand::DrawRect {
                    x: bracket_x,
                    y: top_y,
                    w: smufl::SUB_BRACKET_THICKNESS * sp,
                    h: bottom_y - top_y,
                    color: "#000000".into(),
                });
                for y in [top_y, bottom_y] {
                    dl.push(RenderCommand::DrawRect {
                        x: bracket_x,
                        y: y - hook_thickness * 0.5,
                        w: margin_left - bracket_x,
                        h: hook_thickness,
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

/// A secondary bracket spanning one staff carries no grouping information, so
/// standard engraving practice omits it.
fn is_rendered_group(group: &GroupRange, staff_count: usize) -> bool {
    group.first_staff < staff_count
        && group.last_staff < staff_count
        && !(group.depth > 0
            && group.first_staff == group.last_staff
            && matches!(group.symbol.as_str(), "bracket" | "square"))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn group(first_staff: usize, last_staff: usize, symbol: &str, depth: usize) -> GroupRange {
        GroupRange {
            first_staff,
            last_staff,
            symbol: symbol.into(),
            label: None,
            depth,
        }
    }

    fn render(groups: &[GroupRange], staff_y_offsets: &[f64]) -> DisplayList {
        let mut dl = DisplayList::new(100.0, 100.0);
        render_group_brackets_and_braces(
            &mut dl,
            groups,
            staff_y_offsets,
            20.0,
            4.0,
            1.0,
            &LayoutConfig::default(),
            false,
        );
        dl
    }

    #[test]
    fn square_bracket_draws_thin_vertical_with_hooks_to_system_line() {
        let config = LayoutConfig::default();
        let dl = render(&[group(0, 1, "square", 0)], &[10.0, 50.0]);
        assert_eq!(dl.commands.len(), 3);
        assert!(matches!(
            &dl.commands[0],
            RenderCommand::DrawRect { x, w, h, .. }
                if (*x - 19.3).abs() < 0.001
                    && (*w - smufl::SUB_BRACKET_THICKNESS).abs() < 0.001
                    && (*h - 44.0).abs() < 0.001
        ));
        assert!(dl.commands[1..].iter().all(|command| matches!(
            command,
            RenderCommand::DrawRect { w, h, .. }
                if (*w - 0.7).abs() < 0.001 && (*h - config.staff_line_width).abs() < 0.001
        )));
    }

    #[test]
    fn nested_bracket_draws_like_square_sub_bracket_beside_unshifted_outer_bracket() {
        let staves = [10.0, 30.0, 50.0];
        let nested_bracket = render(
            &[group(0, 1, "bracket", 1), group(0, 2, "bracket", 0)],
            &staves,
        );
        let nested_square = render(
            &[group(0, 1, "square", 1), group(0, 2, "bracket", 0)],
            &staves,
        );
        assert_eq!(
            format!("{:?}", nested_bracket.commands),
            format!("{:?}", nested_square.commands)
        );
        let bracket_tops: Vec<f64> = nested_bracket
            .commands
            .iter()
            .filter_map(|command| match command {
                RenderCommand::DrawGlyph { x, codepoint, .. }
                    if *codepoint == smufl::BRACKET_TOP =>
                {
                    Some(*x)
                }
                _ => None,
            })
            .collect();
        assert_eq!(bracket_tops.len(), 1);
        assert!((bracket_tops[0] - 19.3).abs() < 0.001);
    }

    #[test]
    fn single_staff_secondary_brackets_are_omitted() {
        let dl = render(
            &[group(0, 0, "square", 1), group(1, 1, "bracket", 1)],
            &[10.0, 30.0],
        );
        assert!(dl.commands.is_empty());
    }
}

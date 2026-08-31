//! Per-system chrome for the legacy (non-MNX-layout) full-score path.
//!
//! Everything drawn around the staves rather than on them: the system-start
//! barline, the system bracket and grand-staff braces, inner barline
//! connectors, the end-of-system barline, repeat counts, and part-name
//! labels. It is a contiguous block of the per-system loop with no
//! interleaving with staff content, which is what lets it live on its own.

#![allow(unused_imports)]

use super::*;
use crate::render::smufl::smufl;

/// Draw all per-system chrome (system-start barline, system bracket, grand-staff
/// braces, inner barline connectors, end-of-system barline, repeat counts, and
/// part-name labels) for one system of the legacy (non-MNX-layout) full-score
/// path.
///
/// Extracted from `layout_full_score_cached` to keep that function under the
/// `too_many_lines` threshold; the chrome is a contiguous block in the
/// per-system loop with no interleaving with the staff-content rendering above
/// it, so the extraction is purely mechanical.
#[allow(clippy::too_many_arguments)] // dispatch hub for system chrome
pub(super) fn render_system_chrome(
    dl: &mut DisplayList,
    score: &Score,
    config: &LayoutConfig,
    sys_idx: usize,
    system_count: usize,
    all_sys_layouts: &[Vec<MeasureLayout>],
    visual_staves: &[(usize, u32)],
    visual_staff_count: usize,
    staff_y_offsets: &[f64],
    margin_left: f64,
    brace_margin: f64,
    label_margin: f64,
    staff_height: f64,
    sp: f64,
) {
    let barline_w = config.barline_width * sp;
    let part_count = score.parts.len();

    let system_top = staff_y_offsets[0];
    let system_bottom = staff_y_offsets.last().copied().unwrap_or(system_top) + staff_height;

    // System start barline
    dl.push(RenderCommand::DrawLine {
        x1: margin_left,
        y1: system_top,
        x2: margin_left,
        y2: system_bottom,
        width: barline_w * 1.5,
        color: "#000000".into(),
    });

    // Bracket for the whole system (when multiple parts)
    // SMuFL spec Section 4.1: bracketTop + filled rect + bracketBottom
    if part_count > 1 {
        let bracket_x = margin_left - 0.7 * sp - brace_margin;
        let glyph_size = 4.0 * sp;
        let line_w = smufl::BRACKET_THICKNESS * sp;

        dl.push(RenderCommand::DrawGlyph {
            x: bracket_x,
            y: system_top,
            codepoint: smufl::BRACKET_TOP,
            font: "Bravura".into(),
            size: glyph_size,
            color: "#000000".into(),
            rotation: 0.0,
        });

        dl.push(RenderCommand::DrawRect {
            x: bracket_x,
            y: system_top,
            w: line_w,
            h: system_bottom - system_top,
            color: "#000000".into(),
        });

        dl.push(RenderCommand::DrawGlyph {
            x: bracket_x,
            y: system_bottom,
            codepoint: smufl::BRACKET_BOTTOM,
            font: "Bravura".into(),
            size: glyph_size,
            color: "#000000".into(),
            rotation: 0.0,
        });
    }

    // Braces for grand staff parts
    for (pi, part) in score.parts.iter().enumerate() {
        if part.staves < 2 {
            continue;
        }
        let Some(first_vi) = visual_staves.iter().position(|&(p, s)| p == pi && s == 1) else {
            continue;
        };
        let Some(last_vi) = visual_staves
            .iter()
            .position(|&(p, s)| p == pi && s == part.staves)
        else {
            continue;
        };
        let brace_top = staff_y_offsets[first_vi];
        let brace_bottom = staff_y_offsets[last_vi] + staff_height;
        let brace = brace_geometry(brace_bottom - brace_top, part.staves as usize, sp);
        dl.push(RenderCommand::DrawStretchedGlyph {
            x: margin_left - brace.width - 0.3 * sp,
            y: brace_bottom,
            codepoint: brace.codepoint,
            font: "Bravura".into(),
            size: brace.size,
            scale_x: brace.scale_x,
            color: "#000000".into(),
        });
    }

    // TODO: Legacy path connects barlines across ALL staves because it has no
    // GroupRange info.  Use the MNX layout path (mnx_layout.rs) for group-aware
    // barline connectivity.
    if let Some(first_layouts) = all_sys_layouts.first() {
        for (mi, ml) in first_layouts.iter().enumerate() {
            if mi > 0 {
                let prev_ml = &first_layouts[mi - 1];
                let prev_has_repeat_end = prev_ml.resolved.global.repeat_end.is_some();
                let has_repeat_start = ml.resolved.global.repeat_start.is_some();
                let connector_bt = BarlineKind::at_boundary(
                    prev_has_repeat_end,
                    has_repeat_start,
                    prev_ml
                        .resolved
                        .global
                        .barline
                        .as_ref()
                        .map(|b| &b.barline_type),
                    BarlineType::Regular,
                );
                let barline_tag = element_id::barline(ml.resolved.index);
                for gap_idx in 0..(visual_staff_count - 1) {
                    render_tagged_barline_connector(
                        dl,
                        BarlineGap {
                            x: ml.x,
                            y_top: staff_y_offsets[gap_idx] + staff_height,
                            y_bottom: staff_y_offsets[gap_idx + 1],
                        },
                        sp,
                        config,
                        &connector_bt,
                        &barline_tag,
                    );
                }
            }
        }

        let is_last_system = sys_idx == system_count - 1;
        if let Some(last_ml) = first_layouts.last() {
            let end_x = last_ml.x + last_ml.width;

            let barline_kind = if last_ml.resolved.global.repeat_end.is_some() {
                BarlineKind::RepeatEnd
            } else if is_last_system {
                BarlineKind::from(
                    last_ml
                        .resolved
                        .global
                        .barline
                        .as_ref()
                        .map(|b| b.barline_type)
                        .unwrap_or(BarlineType::Final),
                )
            } else {
                BarlineKind::Regular
            };

            let barline_tag = element_id::barline(last_ml.resolved.index + 1);
            let cmd_idx = dl.commands.len();
            for &staff_y in staff_y_offsets {
                render_barline(dl, end_x, staff_y, staff_height, sp, config, &barline_kind);
            }
            for ci in cmd_idx..dl.commands.len() {
                dl.tag_command(ci, barline_tag.clone());
            }

            for gap_idx in 0..(visual_staff_count - 1) {
                render_tagged_barline_connector(
                    dl,
                    BarlineGap {
                        x: end_x,
                        y_top: staff_y_offsets[gap_idx] + staff_height,
                        y_bottom: staff_y_offsets[gap_idx + 1],
                    },
                    sp,
                    config,
                    &barline_kind,
                    &barline_tag,
                );
            }

            dl.push_element_bbox_with_shape(ElementBBox {
                element_id: barline_tag,
                bbox: BoundingBox::new(
                    end_x - barline_w * 0.5,
                    staff_y_offsets[0],
                    barline_w.max(1.0 * sp),
                    staff_height,
                ),
            });
        }

        render_repeat_counts(dl, first_layouts, staff_y_offsets[0], sp);
    }

    // Part name labels — centered vertically across all staves of each part
    let part_display = resolve_part_display_names(&score.parts);
    for (pi, part) in score.parts.iter().enumerate() {
        if part.name.is_empty() {
            continue;
        }
        let Some(first_vi) = visual_staves.iter().position(|&(p, _)| p == pi) else {
            continue;
        };
        let Some(last_vi) = visual_staves.iter().rposition(|&(p, _)| p == pi) else {
            continue;
        };
        let part_top = staff_y_offsets[first_vi];
        let part_bottom = staff_y_offsets[last_vi] + staff_height;
        let label_y = (part_top + part_bottom) / 2.0;
        let info = &part_display[pi];
        let label_text = if sys_idx == 0 {
            info.display_name.clone()
        } else {
            info.display_short_name.clone()
        };
        let label_size = 2.0 * sp;
        // Optically centre the label on the part's staff group by its cap-height
        // band (not the em box): anchor the alphabetic baseline `capHeight/2`
        // below the group centre, so the capitals straddle `label_y`.
        let baseline_y = label_y
            + crate::layout::text_styles::cap_center_offset_from_baseline(
                crate::layout::text_styles::FontFamily::Serif,
                label_size,
            );
        dl.push(RenderCommand::DrawText {
            x: config.margin_left * sp + label_margin - 2.0 * sp,
            y: baseline_y,
            text: label_text,
            font: "serif".into(),
            size: label_size,
            color: "#000000".into(),
            align: TextAlign::Right,
            baseline: TextBaseline::Alphabetic,
        });
    }
}

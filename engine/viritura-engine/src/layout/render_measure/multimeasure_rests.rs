use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_barlines::*;
use super::super::render_signatures::*;
use super::super::types::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;

/// Full horizontal width of a multimeasure-rest count label, matching the
/// glyph advances used by the renderer. Digit-only labels use SMuFL
/// time-signature digit glyphs (1.2sp advance each); text labels fall back to
/// a serif estimate. Shared by the extent helper, the renderer, and the
/// natural-width reservation so all three agree.
pub(crate) fn multimeasure_rest_number_width(label: &str, sp: f64) -> f64 {
    if label.is_empty() {
        return 0.0;
    }
    let all_digits = label.chars().all(|c| c.is_ascii_digit());
    if all_digits {
        // SMuFL time-sig digit glyphs: per-digit advance from Bravura metadata.
        label
            .chars()
            .filter_map(|c| c.to_digit(10))
            .map(|d| smufl::time_sig_digit_advance(d) * sp)
            .sum()
    } else {
        // Text label: serif bold 2sp, ~0.5em per character.
        label.chars().count() as f64 * 0.5 * 2.0 * sp
    }
}

/// Natural (un-justified) width to reserve for a multimeasure-rest measure.
/// Reserves the measure's clef/key/time prefix on top of the H-bar body, and
/// grows the body so a wide count number (2+ digits) and the bar both fit.
pub(crate) fn multimeasure_rest_natural_width(prefix_width: f64, count: u32, sp: f64) -> f64 {
    let number_width = multimeasure_rest_number_width(&count.to_string(), sp);
    // Standard engraving practice: a multimeasure rest is drawn a little wider
    // the more bars it spans, so a long rest reads as a longer silence — but
    // with three guards that keep it tidy:
    //   1. a *floor* so even a 1-bar rest never collapses below a sensible
    //      minimum body;
    //   2. *slow, logarithmic growth* so each doubling adds the same width;
    //   3. a *cap* so very long rests stop growing and consuming the system.
    const FLOOR: f64 = 6.0; // sp — minimum readable H-bar body
    const NOMINAL: f64 = 8.0; // sp — a single whole-rest measure body
    const COUNT_CAP: f64 = 10.0; // beyond ten bars, the body no longer grows
    let effective = f64::from(count).min(COUNT_CAP);
    let log_growth = if count > 1 {
        2.0 * sp * effective.log2()
    } else {
        0.0
    };
    let body = (NOMINAL * sp + log_growth)
        .max(FLOOR * sp)
        .max(number_width + 2.0 * sp);
    prefix_width + body
}

/// Structural clef/key/time prefix the H-bar must clear, in pixels. Unlike the
/// measure's full `prefix_width`, this deliberately excludes the first-note
/// accidental/min-spacing clearance (a multimeasure rest has no first note), so
/// the bar centers over the true inner width of the measure: full-width on a
/// mid-system rest, and only past the clef/key/time on a system-start rest.
pub(crate) fn multimeasure_rest_structural_prefix(ml: &MeasureLayout, sp: f64) -> f64 {
    let rm = &ml.resolved;
    let is_first = rm.index == 0;
    let at_start = is_first || ml.is_first_on_system;
    let mut w = 0.0;

    if rm.global.repeat_start.is_some() {
        w += 1.5 * sp;
    }

    let has_start_clef = rm.part.clefs.as_ref().is_some_and(|clefs| {
        clefs.iter().any(|pc| match &pc.position {
            None => true,
            Some(p) => p.fraction.0 == 0,
        })
    });
    if has_start_clef && at_start {
        let clef_advance = rm
            .part
            .clefs
            .as_ref()
            .and_then(|clefs| clefs.first())
            .map(|pc| clef_prefix_advance_sp(&pc.clef))
            .unwrap_or(3.0);
        w += clef_advance * sp;
    }

    let is_key_change = rm.global.key.is_some();
    if is_key_change || (at_start && rm.active_key.accidental_count() != 0) {
        let cancel_count = if is_key_change {
            rm.prev_key.cancellation_count(&rm.active_key)
        } else {
            0
        };
        let clef_sign = rm
            .part
            .clefs
            .as_ref()
            .and_then(|clefs| clefs.first())
            .map(|pc| &pc.clef.sign)
            .unwrap_or(&ClefSign::G);
        let cancel_prev = (cancel_count > 0).then_some(&rm.prev_key);
        let key_width =
            key_signature_layout(0.0, 0.0, sp, &rm.active_key, clef_sign, cancel_prev).advance;
        if key_width > 0.0 {
            w += key_width;
            if rm.global.time.is_some() {
                w += super::super::measure::KEY_TO_TIME_GAP_SP * sp;
            }
        }
    }

    if let Some(time) = rm.global.time.as_ref() {
        w += crate::layout::time_signatures::prefix_reserve(
            LayoutConfig::default().time_signature_settings,
            time,
            sp,
        );
    }

    if w > 0.0 {
        w += 1.2 * sp;
    }
    w
}

/// Horizontal extent and top Y of the count number a multimeasure rest draws
/// above the staff, or `None` when this measure is not a multimeasure rest.
/// Mirrors the renderer geometry so above-staff elements can clear the number.
pub(crate) fn multimeasure_rest_number_extent(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
) -> Option<(f64, f64, f64)> {
    let count = ml.multimeasure_rest_count?;

    let hbar_area_left = ml.x + multimeasure_rest_structural_prefix(ml, sp);
    let hbar_area_right = ml.x + ml.width;
    let center_x = (hbar_area_left + hbar_area_right) / 2.0;
    let count_y = staff_y - 1.5 * sp;

    let display_str = ml
        .multimeasure_rest_label
        .clone()
        .unwrap_or_else(|| count.to_string());
    let half_width = multimeasure_rest_number_width(&display_str, sp) / 2.0;
    // Bravura time-signature digit bboxes top out 1sp above the origin.
    let top_y = count_y - 1.0 * sp;

    Some((center_x - half_width, center_x + half_width, top_y))
}

pub(crate) fn render_multimeasure_rest(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    count: u32,
    prev_has_repeat_end: bool,
    render_count: bool,
    count_y_override: Option<f64>,
) {
    let staff_height = 4.0 * sp;
    let is_first = ml.resolved.index == 0;

    // A repeat-start opening a system is deferred until after the repeated
    // clef/key/time prefix. Other non-system-start boundaries render normally.
    let defer_repeat_start = ml.resolved.global.repeat_start.is_some()
        && (is_first || ml.is_first_on_system || ml.resolved.global.key.is_some());
    if !is_first && !ml.is_first_on_system {
        let has_repeat_start = ml.resolved.global.repeat_start.is_some();
        let start_bt = BarlineKind::at_boundary(
            prev_has_repeat_end,
            has_repeat_start,
            None,
            BarlineType::Regular,
        );
        let cmd_idx = dl.commands.len();
        render_barline(dl, ml.x, staff_y, staff_height, sp, config, &start_bt);
        for ci in cmd_idx..dl.commands.len() {
            dl.tag_command(ci, element_id::barline(ml.resolved.index));
        }
    }

    // Repeat structural signatures at score and system starts.
    let mut x_cursor = ml.x;
    let at_start = is_first || ml.is_first_on_system;
    if at_start {
        if let Some(clefs) = &ml.resolved.part.clefs {
            if let Some(pc) = clefs.first() {
                let cmd_idx = dl.commands.len();
                render_clef(dl, x_cursor + 0.5 * sp, staff_y, sp, &pc.clef);
                x_cursor += 3.0 * sp;
                dl.tag_command(cmd_idx, element_id::clef(ml.part_index, ml.resolved.index));
            }
        }
    }
    let is_key_change = ml.resolved.global.key.is_some();
    let key_cancel_count = if is_key_change {
        ml.resolved
            .prev_key
            .cancellation_count(&ml.resolved.active_key)
    } else {
        0
    };
    let needs_key_render = (is_key_change || at_start)
        && (ml.resolved.active_key.accidental_count() != 0 || key_cancel_count > 0);
    if needs_key_render {
        let clef_sign = ml
            .resolved
            .part
            .clefs
            .as_ref()
            .and_then(|c| c.first())
            .map(|pc| &pc.clef.sign)
            .unwrap_or(&ClefSign::G);
        let cancel_prev = if key_cancel_count > 0 {
            Some(&ml.resolved.prev_key)
        } else {
            None
        };
        let cmd_idx = dl.commands.len();
        x_cursor += render_key_signature(
            dl,
            x_cursor,
            staff_y,
            sp,
            &ml.resolved.active_key,
            clef_sign,
            cancel_prev,
        );
        // Tag every accidental so the whole signature highlights on selection.
        for ci in cmd_idx..dl.commands.len() {
            dl.tag_command(ci, element_id::key_sig(ml.part_index, ml.resolved.index));
        }
    }
    if let Some(ref ts) = ml.resolved.global.time {
        let settings = config.time_signature_settings;
        if settings.distribution == crate::model::time::TimeSignatureDistribution::PerStaff {
            let cmd_idx = dl.commands.len();
            render_time_signature(
                dl,
                x_cursor + crate::layout::time_signatures::left_bearing(settings, sp),
                staff_y,
                sp,
                ts,
                settings,
            );
            for ci in cmd_idx..dl.commands.len() {
                dl.tag_command(ci, element_id::time_sig(ml.resolved.index));
            }
        }
    }

    if defer_repeat_start {
        let bar_x = x_cursor + 0.5 * sp;
        let cmd_idx = dl.commands.len();
        render_barline(
            dl,
            bar_x,
            staff_y,
            staff_height,
            sp,
            config,
            &BarlineKind::RepeatStart,
        );
        for ci in cmd_idx..dl.commands.len() {
            dl.tag_command(ci, element_id::barline(ml.resolved.index));
        }
    }

    let measure_right = ml.x + ml.width;
    let hbar_area_left = ml.x + multimeasure_rest_structural_prefix(ml, sp);
    let hbar_area_right = measure_right;
    let hbar_center = (hbar_area_left + hbar_area_right) / 2.0;
    let has_repeat_edge = prev_has_repeat_end
        || ml.resolved.global.repeat_start.is_some()
        || ml.resolved.global.repeat_end.is_some();
    let edge_clearance = if has_repeat_edge { 1.0 * sp } else { 0.5 * sp };
    let hbar_half_area = (hbar_area_right - hbar_area_left) / 2.0;
    let hbar_max_half_span = (hbar_half_area - edge_clearance).max(0.0);
    let hbar_half_span = (hbar_half_area - 1.5 * sp)
        .max(2.0 * sp)
        .min(hbar_max_half_span);
    let bar_left = hbar_center - hbar_half_span;
    let bar_right = hbar_center + hbar_half_span;
    let staff_middle_y = staff_y + 2.0 * sp;
    let hbar_thickness = 1.0 * sp;
    let serif_top = staff_y + 1.0 * sp;
    let serif_bottom = staff_y + 3.0 * sp;

    dl.push(RenderCommand::DrawRect {
        x: bar_left,
        y: staff_middle_y - hbar_thickness / 2.0,
        w: bar_right - bar_left,
        h: hbar_thickness,
        color: "#000000".into(),
    });

    let vert_width = 0.16 * sp;
    dl.push(RenderCommand::DrawRect {
        x: bar_left - vert_width / 2.0,
        y: serif_top,
        w: vert_width,
        h: serif_bottom - serif_top,
        color: "#000000".into(),
    });
    dl.push(RenderCommand::DrawRect {
        x: bar_right - vert_width / 2.0,
        y: serif_top,
        w: vert_width,
        h: serif_bottom - serif_top,
        color: "#000000".into(),
    });

    let center_x = (bar_left + bar_right) / 2.0;
    let number_size = 4.0 * sp;
    let count_y = count_y_override.unwrap_or(staff_y - 1.5 * sp);
    let display_str = ml
        .multimeasure_rest_label
        .clone()
        .unwrap_or_else(|| count.to_string());
    let all_digits = display_str.chars().all(|c| c.is_ascii_digit());

    if render_count && all_digits && !display_str.is_empty() {
        let total_width = multimeasure_rest_number_width(&display_str, sp);
        let mut x = center_x - total_width / 2.0;
        for ch in display_str.chars() {
            if let Some(digit) = ch.to_digit(10) {
                dl.push(RenderCommand::DrawGlyph {
                    x,
                    y: count_y,
                    codepoint: smufl::time_sig_digit(digit),
                    font: "Bravura".into(),
                    size: number_size,
                    color: "#000000".into(),
                    rotation: 0.0,
                });
                x += smufl::time_sig_digit_advance(digit) * sp;
            }
        }
    } else if render_count {
        dl.push(RenderCommand::DrawText {
            x: center_x,
            y: count_y,
            text: display_str,
            font: "serif bold".into(),
            size: 2.0 * sp,
            color: "#000000".into(),
            align: TextAlign::Center,
            baseline: TextBaseline::Bottom,
        });
    }
}

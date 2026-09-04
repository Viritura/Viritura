#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_annotations::{
    below_staff_number_top_y, highest_point_in_range, measure_number_to_display,
    measure_number_value, rehearsal_mark_x_extent, tempo_metronome_runs,
};
use super::super::render_barlines::{render_barline, BarlineKind};
use super::super::render_measure::MIDDLE_LINE_POS;
use super::super::resolve::*;
use super::super::spacing::*;
use super::super::types::*;
use super::bbox_articulations::*;
use super::bbox_notes::*;
use super::helpers::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

pub(super) fn bbox_chord_symbols(
    bboxes: &mut Vec<ElementBBox>,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    part_idx: usize,
    measure_idx: usize,
    config: &LayoutConfig,
) {
    let Some(chords) = &ml.resolved.part.chord_symbols else {
        return;
    };
    let total_beats = ml.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
    let x_origin = ml.x + ml.prefix_width;
    let chord_font_size = 2.4 * sp;
    // Mirror `render_chord_symbols`: Alphabetic baseline edge-anchored from the
    // table (`chordSymbol.attachGap`). The cap band spans up from the baseline;
    // the box bottom IS the baseline (chord symbols carry no descenders), so the
    // near-staff edge sits exactly `attach_gap` above the staff.
    let attach_gap = config
        .placement
        .resolve(ElementKind::ChordSymbol)
        .attach_gap;
    let chord_baseline_y = staff_y - attach_gap * sp;
    for (i, chord) in chords.iter().enumerate() {
        let beat = chord.position.beats();
        let beat_pos = beat / total_beats;
        let chord_x = x_origin + beat_pos * content_width;
        let text = chord.display_text();
        let text_w = text.len() as f64 * 0.6 * chord_font_size;
        let bbox = BoundingBox::new(
            chord_x,
            chord_baseline_y - chord_font_size * 0.82,
            text_w,
            chord_font_size * 0.82,
        );
        bboxes.push(ElementBBox {
            element_id: element_id::chord_symbol(part_idx, measure_idx, i),
            bbox,
        });
    }
}

pub(super) fn bbox_measure_numbers(
    bboxes: &mut Vec<ElementBBox>,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    measure_idx: usize,
    config: &LayoutConfig,
    render_measure_number_here: bool,
    render_mmr_count_here: bool,
    mmr_count_y_override: Option<f64>,
) {
    // Mirror `render_measure_numbers`. A collapsed multimeasure rest renders a
    // `{start}–{end}` range label instead of a single number (a separate render
    // path), so emit the range box here — otherwise the range is the only
    // below-staff number with no selection/measure-extent box, an inconsistency
    // with regular bar numbers.
    if let Some(count) = ml.multimeasure_rest_count {
        if render_measure_number_here {
            bbox_multimeasure_number_range(bboxes, ml, staff_y, sp, count);
        }
        if render_mmr_count_here {
            bbox_multimeasure_count_number(bboxes, ml, staff_y, sp, mmr_count_y_override);
        }
        return;
    }
    if !render_measure_number_here {
        return;
    }
    let number = match measure_number_value(ml) {
        Some(n) => n,
        None => return,
    };
    // The renderer draws the number below the staff (baseline Top, left-aligned)
    // at `below_staff_number_top_y`, at font size 2.0sp in serif italic. Digits
    // are a flat 0.5em advance in serif faces, so the real ink width matches
    // `serif_bold_text_width`.
    let font_size = 2.0 * sp;
    let num_y = below_staff_number_top_y(ml, staff_y, sp, config);
    let num_x = ml.x;
    let text = number.to_string();
    let text_w = smufl::serif_bold_text_width(&text, font_size);
    let bbox = BoundingBox::new(num_x, num_y, text_w, font_size);
    bboxes.push(ElementBBox {
        element_id: element_id::measure_number(measure_idx),
        bbox,
    });
}

/// Selection / measure-extent box for a collapsed multimeasure rest's
/// `{start}–{end}` bar-number range label. Mirrors
/// `render_annotations::render_multimeasure_number_range` exactly so the box
/// tracks the drawn text (centered under the H-bar, one line below the staff).
fn bbox_multimeasure_number_range(
    bboxes: &mut Vec<ElementBBox>,
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
    let text = format!("{start}\u{2013}{end}");
    let prefix = super::super::render_measure::multimeasure_rest_structural_prefix(ml, sp);
    let center_x = ((ml.x + prefix) + (ml.x + ml.width)) / 2.0;
    let num_y = staff_y + 4.0 * sp + 0.5 * sp;
    let text_w = smufl::serif_bold_text_width(&text, font_size);
    // Drawn centered (align Center), so the box's left edge is half the width
    // left of the centre.
    let bbox = BoundingBox::new(center_x - text_w * 0.5, num_y, text_w, font_size);
    bboxes.push(ElementBBox {
        element_id: element_id::measure_number(ml.resolved.index),
        bbox,
    });
}

/// Selection / obstacle box for a collapsed multimeasure rest's count number
/// (the large digits centred above the staff). Mirrors the geometry in
/// `multimeasure_rest_number_extent` (which the count renderer and the tempo
/// obstacle scan already share) plus the SMuFL time-signature digit cap/descent.
/// Without this box the count number is the only above-staff rendered ink with
/// no `ElementBBox`, so the lift overlay can't see it as an obstacle (a tempo
/// cleared over it would show no nearest-ink band) and measure-extent
/// refinement would miss it.
fn bbox_multimeasure_count_number(
    bboxes: &mut Vec<ElementBBox>,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    count_y_override: Option<f64>,
) {
    let Some((left, right, top_y)) =
        super::super::render_measure::multimeasure_rest_number_extent(ml, staff_y, sp)
    else {
        return;
    };
    // The count renders as SMuFL time-signature digits whose Bravura bbox spans
    // -1.0..+1.0 in glyph units (= sp) about the baseline, i.e. 2.0sp tall, with
    // `top_y` already at the glyph cap.
    let display_str = ml.multimeasure_rest_label.as_deref().unwrap_or_default();
    let all_digits = display_str.is_empty()
        || display_str
            .chars()
            .all(|character| character.is_ascii_digit());
    let (bbox_y, bbox_height) = if all_digits {
        (
            count_y_override.map_or(top_y, |center| center - sp),
            2.0 * sp,
        )
    } else if let Some(center) = count_y_override {
        let cap_height = crate::layout::text_styles::cap_height_from_baseline(
            crate::layout::text_styles::FontFamily::Serif,
            2.0 * sp,
        );
        (center - cap_height * 0.5, cap_height)
    } else {
        (staff_y - 1.5 * sp - 2.0 * sp, 2.0 * sp)
    };
    let bbox = BoundingBox::new(left, bbox_y, right - left, bbox_height);
    bboxes.push(ElementBBox {
        element_id: element_id::multimeasure_count(ml.resolved.index),
        bbox,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stem_tip_y_normal_note_unchanged() {
        let sp = 12.0;
        let staff_y = 60.0;
        let stem_length = 3.5;

        // Note on middle line (pos 4): stem up → tip at pos 4 - 7 = -3 (above staff)
        let tip = stem_tip_y(4.0, true, staff_y, sp, stem_length);
        let expected = staff_y + 4.0 * sp * 0.5 - stem_length * sp;
        assert!((tip - expected).abs() < 1e-9);

        // Note on middle line (pos 4): stem down → tip at pos 4 + 7 = 11 (below staff)
        let tip = stem_tip_y(4.0, false, staff_y, sp, stem_length);
        let expected = staff_y + 4.0 * sp * 0.5 + stem_length * sp;
        assert!((tip - expected).abs() < 1e-9);
    }

    #[test]
    fn stem_tip_y_ledger_below_stem_up_extends_to_middle() {
        let sp = 12.0;
        let staff_y = 60.0;
        let stem_length = 3.5;
        let middle_y = staff_y + MIDDLE_LINE_POS * sp * 0.5;

        // Note at pos 14 (3 ledger lines below): default tip at 14 - 7 = 7 (pos 7),
        // which is below middle line. Should clamp to middle.
        let tip = stem_tip_y(14.0, true, staff_y, sp, stem_length);
        assert!(
            (tip - middle_y).abs() < 1e-9,
            "Stem up from pos 14 should reach middle line, got {} expected {}",
            tip,
            middle_y
        );
    }

    #[test]
    fn stem_tip_y_ledger_above_stem_down_extends_to_middle() {
        let sp = 12.0;
        let staff_y = 60.0;
        let stem_length = 3.5;
        let middle_y = staff_y + MIDDLE_LINE_POS * sp * 0.5;

        // Note at pos -6 (3 ledger lines above): default tip at -6 + 7 = 1 (pos 1),
        // which is above middle line. Should clamp to middle.
        let tip = stem_tip_y(-6.0, false, staff_y, sp, stem_length);
        assert!(
            (tip - middle_y).abs() < 1e-9,
            "Stem down from pos -6 should reach middle line, got {} expected {}",
            tip,
            middle_y
        );
    }

    #[test]
    fn stem_tip_y_ledger_below_moderate_already_past_middle() {
        let sp = 12.0;
        let staff_y = 60.0;
        let stem_length = 3.5;
        let middle_y = staff_y + MIDDLE_LINE_POS * sp * 0.5;

        // Note at pos 10 (1 ledger line below): default tip at 10 - 7 = 3 (pos 3),
        // which is above middle line. No clamping needed.
        let tip = stem_tip_y(10.0, true, staff_y, sp, stem_length);
        let default_tip = staff_y + 10.0 * sp * 0.5 - stem_length * sp;
        assert!(tip < middle_y, "Stem should already be above middle line");
        assert!((tip - default_tip).abs() < 1e-9);
    }

    #[test]
    fn stem_tip_y_far_ledger_line_note() {
        let sp = 12.0;
        let staff_y = 60.0;
        let stem_length = 3.5;
        let middle_y = staff_y + MIDDLE_LINE_POS * sp * 0.5;

        // Very low note at pos 20: default tip at 20 - 7 = 13, way below middle.
        let tip = stem_tip_y(20.0, true, staff_y, sp, stem_length);
        assert!((tip - middle_y).abs() < 1e-9);

        // Very high note at pos -12: default tip at -12 + 7 = -5, way above middle.
        let tip = stem_tip_y(-12.0, false, staff_y, sp, stem_length);
        assert!((tip - middle_y).abs() < 1e-9);
    }

    fn count_draw_lines(dl: &DisplayList) -> usize {
        dl.commands
            .iter()
            .filter(|c| matches!(c, RenderCommand::DrawLine { .. }))
            .count()
    }

    fn get_draw_line_endpoints(dl: &DisplayList) -> Vec<(f64, f64, f64, f64)> {
        dl.commands
            .iter()
            .filter_map(|c| match c {
                RenderCommand::DrawLine { x1, y1, x2, y2, .. } => Some((*x1, *y1, *x2, *y2)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn render_barline_dashed_produces_dash_segments() {
        let mut dl = DisplayList::new(800.0, 600.0);
        let config = LayoutConfig::default();
        let sp = 12.0;
        let staff_y = 60.0;
        let staff_height = 4.0 * sp; // 48px

        render_barline(
            &mut dl,
            100.0,
            staff_y,
            staff_height,
            sp,
            &config,
            &BarlineKind::Dashed,
        );

        let lines = get_draw_line_endpoints(&dl);
        // With dash=0.5sp (6px) and gap=0.25sp (3px), period=9px over 48px → ~6 dashes
        assert!(
            lines.len() >= 5,
            "Expected multiple dashes, got {}",
            lines.len()
        );
        // Each dash is vertical at x=100
        for (x1, _y1, x2, _y2) in &lines {
            assert!((*x1 - 100.0).abs() < 1e-9);
            assert!((*x2 - 100.0).abs() < 1e-9);
        }
        // First dash starts at staff_y
        assert!((lines[0].1 - staff_y).abs() < 1e-9);
    }

    #[test]
    fn render_barline_tick_one_space_at_top() {
        let mut dl = DisplayList::new(800.0, 600.0);
        let config = LayoutConfig::default();
        let sp = 12.0;
        let staff_y = 60.0;
        let staff_height = 4.0 * sp;

        render_barline(
            &mut dl,
            100.0,
            staff_y,
            staff_height,
            sp,
            &config,
            &BarlineKind::Tick,
        );

        assert_eq!(count_draw_lines(&dl), 1);
        let lines = get_draw_line_endpoints(&dl);
        let (_, y1, _, y2) = lines[0];
        assert!(
            (y1 - staff_y).abs() < 1e-9,
            "Tick should start at staff top"
        );
        assert!(
            (y2 - (staff_y + sp)).abs() < 1e-9,
            "Tick should be 1sp tall"
        );
    }

    #[test]
    fn render_barline_short_spans_lines_2_to_4() {
        let mut dl = DisplayList::new(800.0, 600.0);
        let config = LayoutConfig::default();
        let sp = 12.0;
        let staff_y = 60.0;
        let staff_height = 4.0 * sp;

        render_barline(
            &mut dl,
            100.0,
            staff_y,
            staff_height,
            sp,
            &config,
            &BarlineKind::Short,
        );

        assert_eq!(count_draw_lines(&dl), 1);
        let lines = get_draw_line_endpoints(&dl);
        let (_, y1, _, y2) = lines[0];
        assert!(
            (y1 - (staff_y + sp)).abs() < 1e-9,
            "Short barline top at line 2"
        );
        assert!(
            (y2 - (staff_y + 3.0 * sp)).abs() < 1e-9,
            "Short barline bottom at line 4"
        );
    }

    #[test]
    fn render_barline_none_produces_nothing() {
        let mut dl = DisplayList::new(800.0, 600.0);
        let config = LayoutConfig::default();
        let sp = 12.0;

        render_barline(
            &mut dl,
            100.0,
            60.0,
            48.0,
            sp,
            &config,
            &BarlineKind::NoBarline,
        );

        assert_eq!(dl.commands.len(), 0);
    }
}

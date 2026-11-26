#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_annotations::{
    chord_symbol_dimensions, highest_point_in_range, rehearsal_mark_x_extent, tempo_metronome_runs,
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

pub(crate) fn chord_symbol_bboxes(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) -> Vec<ElementBBox> {
    let Some(chords) = &ml.resolved.chord_symbols else {
        return Vec::new();
    };
    let mut bboxes = Vec::with_capacity(chords.len());
    let total_beats = ml.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
    let x_origin = ml.x + ml.prefix_width;
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
        let (width, ascent) = chord_symbol_dimensions(chord, config.chord_symbol_style, sp);
        let bbox = BoundingBox::new(chord_x, chord_baseline_y - ascent, width, ascent);
        bboxes.push(ElementBBox {
            element_id: element_id::global_chord_symbol(
                ml.resolved.index,
                chord.source_index.unwrap_or(i),
            ),
            bbox,
        });
    }
    bboxes
}

/// Selection / obstacle box for a collapsed multimeasure rest's count number
/// (the large digits centred above the staff). Mirrors the geometry in
/// `multimeasure_rest_number_extent` (which the count renderer and the tempo
/// obstacle scan already share) plus the SMuFL time-signature digit cap/descent.
/// Without this box the count number is the only above-staff rendered ink with
/// no `ElementBBox`, so the lift overlay can't see it as an obstacle (a tempo
/// cleared over it would show no nearest-ink band) and measure-extent
/// refinement would miss it.
pub(super) fn bbox_multimeasure_count_number(
    bboxes: &mut Vec<ElementBBox>,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    count_y_override: Option<f64>,
    config: &LayoutConfig,
) {
    let Some((left, right, top_y)) =
        super::super::render_measure::multimeasure_rest_number_extent(ml, staff_y, sp, config)
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

// Extracted from render_measure.rs — render_tremolos

use super::config::LayoutConfig;
use super::render_geometry::*;
use super::types::*;
use crate::render::*;

/// Render multi-note tremolo slashes between two events in a measure.
///
/// Draws beam-like diagonal slashes between the two notes. Whole notes remain
/// stemless; invisible anchor geometry positions their floating strokes.
pub(crate) fn render_multi_note_tremolos(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    for vl in &ml.voice_layouts {
        let event_count = vl.events.len();
        for tg in &vl.multi_note_tremolo_groups {
            if tg.first_event_idx >= event_count || tg.second_event_idx >= event_count {
                continue;
            }
            // Tremolo groups are rare and tiny; materialize only the two
            // referenced events rather than the whole voice.
            let el1 = vl.events.to_event_layout(tg.first_event_idx);
            let el2 = vl.events.to_event_layout(tg.second_event_idx);
            render_multi_note_tremolo_pair(dl, &el1, &el2, tg.marks, staff_y, sp, config);
        }
    }
}

/// Render tremolo marks between a pair of events as beam-like strokes.
///
/// Computes stem tip positions for both events, then draws one to three
/// parallelograms following the line between those tips. Stemless notes use
/// implied anchor positions for geometry only and never paint those stems.
pub(crate) fn render_multi_note_tremolo_pair(
    dl: &mut DisplayList,
    el1: &EventLayout,
    el2: &EventLayout,
    marks: u32,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    if marks == 0 {
        return;
    }
    if el1.note_positions.is_empty() || el2.note_positions.is_empty() {
        return;
    }

    // Compute stem tip positions for each event
    let (stem_x1, stem_tip_y1) = stem_tip_pos(el1, staff_y, sp, config);
    let (stem_x2, stem_tip_y2) = stem_tip_pos(el2, staff_y, sp, config);
    let stems_up = el1.stem_up || el2.stem_up;
    let thickness = 0.5 * sp;
    let stroke_step = 0.75 * sp;
    let stem_distance_sp = (stem_x2 - stem_x1).abs() / sp;
    let available_after_default_inset = stem_distance_sp - 2.0;
    let inset_sp = if available_after_default_inset < 0.6 {
        (1.0 - (0.6 - available_after_default_inset) * 0.5).max(0.4)
    } else {
        1.0
    };
    let inset = inset_sp * sp;
    let slope = if (stem_x2 - stem_x1).abs() > f64::EPSILON {
        (stem_tip_y2 - stem_tip_y1) / (stem_x2 - stem_x1)
    } else {
        0.0
    };
    let direction = (stem_x2 - stem_x1).signum();
    let stroke_x1 = stem_x1 + direction * inset;
    let stroke_x2 = stem_x2 - direction * inset;
    let base_y1 = stem_tip_y1 + direction * inset * slope;
    let base_y2 = stem_tip_y2 - direction * inset * slope;
    for stroke in 0..marks.min(3) {
        let offset = f64::from(stroke) * stroke_step;
        let (y1, y2) = if stems_up {
            (base_y1 + offset, base_y2 + offset)
        } else {
            (base_y1 - thickness - offset, base_y2 - thickness - offset)
        };
        dl.beam_angled(stroke_x1, y1, stroke_x2, y2, thickness);
    }
}

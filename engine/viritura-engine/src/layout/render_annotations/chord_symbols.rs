//! Chord-symbol placement and rendering.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::types::*;
use crate::render::*;

/// Render chord symbols above the staff at their rhythmic positions.
pub(crate) fn render_chord_symbols(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let chords = match &ml.resolved.part.chord_symbols {
        Some(chords) if !chords.is_empty() => chords,
        _ => return,
    };

    let total_beats = ml.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
    let x_origin = ml.x + ml.prefix_width;
    let font_size = 2.4 * sp;
    let attach_gap = config
        .placement
        .resolve(ElementKind::ChordSymbol)
        .attach_gap;
    let chord_baseline_y = staff_y - attach_gap * sp;
    let measure_index = ml.resolved.index;
    let part_index = ml.part_index;

    for (index, chord) in chords.iter().enumerate() {
        let chord_x = x_origin + (chord.position.beats() / total_beats) * content_width;
        dl.push_tagged(
            RenderCommand::DrawText {
                x: chord_x,
                y: chord_baseline_y,
                text: chord.display_text(),
                font: "serif".into(),
                size: font_size,
                color: "#000000".into(),
                align: TextAlign::Left,
                baseline: TextBaseline::Alphabetic,
            },
            element_id::chord_symbol(part_index, measure_index, index),
        );
    }
}

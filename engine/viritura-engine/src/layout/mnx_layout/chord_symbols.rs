//! Harmony-lane filtering for layout staffs.

use super::super::config::LayoutConfig;
use super::super::full_score::FlatStaff;
use super::super::types::MeasureLayout;
use crate::model::{ChordSymbol, Score};
use crate::render::ElementKind;

pub(crate) fn above_staff_protrusion(
    layout: &MeasureLayout,
    sp: f64,
    config: &LayoutConfig,
) -> f64 {
    let Some(chords) = layout.resolved.chord_symbols.as_ref() else {
        return 0.0;
    };
    if chords.is_empty() {
        return 0.0;
    }
    let attach_gap = config
        .placement
        .resolve(ElementKind::ChordSymbol)
        .attach_gap;
    let total_beats = layout.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(layout, sp);
    let x_origin = layout.x + layout.prefix_width;
    let max_ascent = chords
        .iter()
        .map(|chord| {
            let x = x_origin + (chord.position.beats() / total_beats) * content_width;
            let height = super::super::render_annotations::chord_symbol_dimensions(
                chord,
                config.chord_symbol_style,
                sp,
            )
            .1;
            height
                + super::super::render_annotations::chord_symbol_vertical_lift(
                    layout, chord, x, 0.0, sp, config,
                )
        })
        .fold(0.0_f64, f64::max);
    attach_gap * sp + max_ascent
}

pub(super) fn display_transposition(
    score: &Score,
    staff: &FlatStaff,
    use_written: bool,
) -> Option<(i32, i32)> {
    display_transposition_at(score, staff, use_written, 0)
}

pub(super) fn display_transposition_at(
    score: &Score,
    staff: &FlatStaff,
    use_written: bool,
    measure_index: usize,
) -> Option<(i32, i32)> {
    if !use_written {
        return None;
    }
    let source = score.parts.get(staff.chord_symbol_source?)?;
    crate::model::ActiveInstrument::at(source, measure_index, (0, 1))
        .transposition
        .map(|transposition| {
            (
                transposition.interval.staff_distance,
                transposition.interval.half_steps,
            )
        })
}

pub(super) fn visible_global_chord_symbols(
    score: &Score,
    measure_index: usize,
    staff: &FlatStaff,
) -> Option<Vec<ChordSymbol>> {
    let source = staff.chord_symbol_source?;
    let chords = score.global.measures.get(measure_index)?.chord_symbols()?;
    Some(
        chords
            .iter()
            .enumerate()
            .map(|(index, chord)| {
                let mut chord = super::super::render_annotations::chord_symbol_for_display(
                    chord,
                    staff.chord_symbol_transposition,
                );
                chord.source_index = Some(index);
                chord.source_part_index = Some(source);
                let part_id = score.parts.get(source).and_then(|part| part.id.as_deref());
                chord
                    .fretboards
                    .retain(|frame| Some(frame.part_id.as_str()) == part_id);
                chord
            })
            .collect(),
    )
}

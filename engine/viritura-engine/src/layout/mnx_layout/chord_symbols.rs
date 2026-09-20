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
    let max_ascent = chords
        .iter()
        .map(|chord| {
            super::super::render_annotations::chord_symbol_dimensions(
                chord,
                config.chord_symbol_style,
                sp,
            )
            .1
        })
        .fold(0.0_f64, f64::max);
    attach_gap * sp + max_ascent
}

pub(super) fn display_transposition(
    score: &Score,
    staff: &FlatStaff,
    use_written: bool,
) -> Option<(i32, i32)> {
    if !use_written {
        return None;
    }
    let source = score.parts.get(staff.chord_symbol_source?)?;
    source.transposition.as_ref().map(|transposition| {
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
                chord
            })
            .collect(),
    )
}

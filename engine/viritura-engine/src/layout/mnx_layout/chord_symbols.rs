//! Harmony-lane filtering for layout staffs.

use super::super::config::LayoutConfig;
use super::super::full_score::{FlatSource, FlatStaff};
use super::super::types::MeasureLayout;
use crate::model::{ChordSymbol, PartMeasure};
use crate::render::ElementKind;

pub(crate) fn above_staff_protrusion(
    layout: &MeasureLayout,
    sp: f64,
    config: &LayoutConfig,
) -> f64 {
    let has_chords = layout
        .resolved
        .part
        .chord_symbols
        .as_ref()
        .is_some_and(|chords| !chords.is_empty());
    if !has_chords {
        return 0.0;
    }
    let attach_gap = config
        .placement
        .resolve(ElementKind::ChordSymbol)
        .attach_gap;
    let font_ascent = 2.4 * 0.82;
    (attach_gap + font_ascent) * sp
}

pub(super) fn extend_visible_chord_symbols(
    target: &mut Option<Vec<ChordSymbol>>,
    measure: &PartMeasure,
    staff: &FlatStaff,
    source: &FlatSource,
) {
    let Some(chords) = &measure.chord_symbols else {
        return;
    };
    let visible: Vec<_> = chords
        .iter()
        .enumerate()
        .filter(|(_, chord)| match staff.chord_symbols_visible {
            Some(true) => source.first_chord_symbol_source_on_layout_staff,
            Some(false) => false,
            None if source.part_has_explicit_chord_symbol_staff => false,
            None => {
                chord
                    .display_staff
                    .map_or(source.default_chord_symbol_source, |display_staff| {
                        if source.displayed_staff_numbers.contains(&display_staff) {
                            source.staff_number == Some(display_staff)
                                && source.first_chord_symbol_source_for_staff
                        } else {
                            source.default_chord_symbol_source
                        }
                    })
            }
        })
        .map(|(index, chord)| {
            let mut chord = chord.clone();
            chord.source_index = Some(index);
            chord.source_part_index = Some(source.part_index);
            chord
        })
        .collect();
    if !visible.is_empty() {
        target.get_or_insert_with(Vec::new).extend(visible);
    }
}

use super::super::resolve::*;
use super::super::types::ResolvedOttavaRange;
use super::helpers::{compute_note_staff_positions, resolve_stem_up};
use crate::model::{Clef, KitComponent, MultiNoteTremolo};
use std::collections::HashMap;

pub(super) struct TremoloPairContext<'a> {
    pub(super) start_beat: f64,
    pub(super) per_event_beats: f64,
    pub(super) duration_scale: f64,
    pub(super) clef_changes: &'a [(f64, Clef)],
    pub(super) resolved_ottavas: &'a [ResolvedOttavaRange],
    pub(super) measure_index: usize,
    pub(super) forced_stem_up: Option<bool>,
    pub(super) num_voices: usize,
    pub(super) voice_index: usize,
    pub(super) transposition: Option<(i32, i32)>,
    pub(super) kit: Option<&'a HashMap<String, KitComponent>>,
}

pub(super) struct TremoloPairPreparation {
    pub(super) note_positions: Vec<Vec<f64>>,
    pub(super) stem_up: bool,
}

pub(super) fn prepare_tremolo_pair(
    tremolo: &MultiNoteTremolo,
    context: TremoloPairContext<'_>,
) -> TremoloPairPreparation {
    let mut event_beat = context.start_beat;
    let note_positions: Vec<Vec<f64>> = tremolo
        .content
        .iter()
        .map(|event| {
            let clef = active_clef_at_beat(context.clef_changes, event_beat);
            let ottava_shift =
                ottava_diatonic_shift(context.resolved_ottavas, context.measure_index, event_beat);
            event_beat += context.per_event_beats * context.duration_scale;
            compute_note_staff_positions(
                event.notes(),
                clef,
                ottava_shift,
                context.transposition,
                context.kit,
            )
        })
        .collect();
    let combined_positions: Vec<f64> = note_positions.iter().flatten().copied().collect();
    let pair_orient = tremolo.content.iter().find_map(|event| event.orient);
    let pair_stem_direction = tremolo
        .content
        .iter()
        .find_map(|event| event.stem_direction.as_ref());
    let stem_up = resolve_stem_up(
        pair_orient,
        pair_stem_direction,
        context.forced_stem_up,
        context.num_voices,
        context.voice_index,
        &combined_positions,
    );

    TremoloPairPreparation {
        note_positions,
        stem_up,
    }
}

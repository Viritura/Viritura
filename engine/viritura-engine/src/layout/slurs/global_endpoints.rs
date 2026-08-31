use super::super::config::LayoutConfig;
use super::super::types::MeasureLayout;
use super::endpoint_articulation_relation;
use super::participation::{endpoint_snapshot, EndpointSnapshot};
use std::ops::{Deref, DerefMut};
use std::rc::Rc;

/// Cross-system endpoint snapshot with authored slurs, note positions, and tie
/// links retained independently of per-system measure layouts.
#[derive(Clone)]
pub(crate) struct GlobalSlurEvent {
    pub event_id: Rc<str>,
    pub endpoint: EndpointSnapshot,
    pub system_idx: usize,
    pub part_index: usize,
    pub staff_idx: usize,
    pub slurs: Vec<crate::model::event::Slur>,
    pub note_positions: Vec<(Rc<str>, f64, f64)>,
    pub tie_links: Vec<(Rc<str>, Rc<str>)>,
}

impl Deref for GlobalSlurEvent {
    type Target = EndpointSnapshot;

    fn deref(&self) -> &Self::Target {
        &self.endpoint
    }
}

impl DerefMut for GlobalSlurEvent {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.endpoint
    }
}

/// Horizontal content extent for one rendered system/staff.
#[derive(Clone, Copy)]
pub(crate) struct SystemSlurBounds {
    pub left_x: f64,
    pub right_x: f64,
}

#[allow(clippy::too_many_arguments)] // render-scope identifiers accompany one endpoint collection pass
pub(crate) fn collect_global_slur_events(
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    staff_y_offsets: Option<&[f64]>,
    sp: f64,
    config: &LayoutConfig,
    system_idx: usize,
    part_index: usize,
    staff_idx: usize,
    output: &mut Vec<GlobalSlurEvent>,
) {
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let beamed_ids = super::super::beams::collect_all_beamed_event_ids(measure_layouts, false);
    for measure in measure_layouts {
        for (voice_index, voice) in measure.voice_layouts.iter().enumerate() {
            for event_index in 0..voice.events.len() {
                let Some(event_id) = voice.events.id(event_index) else {
                    continue;
                };
                let event = voice.events.event(event_index);
                let positions = voice.events.note_positions(event_index);
                let effective_staff_y = super::super::render_measure::cross_staff_y_scalar(
                    event.staff,
                    voice.events.sequence_staff(event_index),
                    staff_y,
                    staff_y_offsets,
                );
                let notes = event.notes();
                let top = positions
                    .iter()
                    .copied()
                    .min_by(f64::total_cmp)
                    .unwrap_or(4.0);
                let bottom = positions
                    .iter()
                    .copied()
                    .max_by(f64::total_cmp)
                    .unwrap_or(4.0);
                let staff_move = notes
                    .first()
                    .and_then(|note| note.staff)
                    .map(|staff| staff as i32 - voice.events.sequence_staff(event_index) as i32)
                    .unwrap_or(0);
                let outgoing_tie = notes
                    .iter()
                    .any(|note| note.ties.as_ref().is_some_and(|ties| !ties.is_empty()));
                let articulation_relation = endpoint_articulation_relation(event.markings.as_ref());
                let mut endpoint = endpoint_snapshot(
                    voice.events.x(event_index),
                    top,
                    bottom,
                    voice.events.stem_up(event_index),
                    event.duration.base.has_stem(),
                    notehead_w,
                    notes.len(),
                    effective_staff_y,
                    voice_index + 1,
                    voice.events.num_voices(event_index),
                    staff_move,
                    1.0,
                    outgoing_tie,
                    beamed_ids.contains(event_id),
                    articulation_relation,
                );
                if notes.iter().any(has_visible_accidental) {
                    endpoint.accidental_right_x = Some(voice.events.x(event_index) - 0.12 * sp);
                }
                if let Some(dots) = event.duration.dots.filter(|dots| *dots > 0) {
                    endpoint.dot_right_x = Some(
                        voice.events.x(event_index)
                            + notehead_w
                            + dots as f64 * 0.3 * sp
                            + 0.1 * sp,
                    );
                }
                output.push(GlobalSlurEvent {
                    event_id: Rc::from(event_id),
                    endpoint,
                    system_idx,
                    part_index,
                    staff_idx,
                    slurs: event.slurs.clone().unwrap_or_default(),
                    note_positions: note_positions(notes, positions, effective_staff_y),
                    tie_links: tie_links(notes),
                });

                for grace in voice.events.grace_notes(event_index) {
                    let Some(grace_id) = grace.id.as_deref() else {
                        continue;
                    };
                    let grace_notes = grace.event.notes();
                    let grace_top = grace
                        .note_positions
                        .iter()
                        .copied()
                        .min_by(f64::total_cmp)
                        .unwrap_or(4.0);
                    let grace_bottom = grace
                        .note_positions
                        .iter()
                        .copied()
                        .max_by(f64::total_cmp)
                        .unwrap_or(4.0);
                    let grace_outgoing_tie = grace_notes
                        .iter()
                        .any(|note| note.ties.as_ref().is_some_and(|ties| !ties.is_empty()));
                    output.push(GlobalSlurEvent {
                        event_id: Rc::from(grace_id),
                        endpoint: endpoint_snapshot(
                            grace.x,
                            grace_top,
                            grace_bottom,
                            grace.stem_up,
                            grace.event.duration.base.has_stem(),
                            notehead_w * 0.65,
                            grace_notes.len(),
                            effective_staff_y,
                            voice_index + 1,
                            voice.events.num_voices(event_index),
                            0,
                            0.65,
                            grace_outgoing_tie,
                            beamed_ids.contains(grace_id),
                            endpoint_articulation_relation(grace.event.markings.as_ref()),
                        ),
                        system_idx,
                        part_index,
                        staff_idx,
                        slurs: grace.event.slurs.clone().unwrap_or_default(),
                        note_positions: note_positions(
                            grace_notes,
                            &grace.note_positions,
                            effective_staff_y,
                        ),
                        tie_links: tie_links(grace_notes),
                    });
                }
            }
        }
    }
}

fn has_visible_accidental(note: &crate::model::Note) -> bool {
    note.accidental_display
        .as_ref()
        .is_some_and(|display| display.show)
        || note.pitch.alter.is_some_and(|alter| alter != 0)
}

fn note_positions(
    notes: &[crate::model::Note],
    positions: &[f64],
    effective_staff_y: f64,
) -> Vec<(Rc<str>, f64, f64)> {
    notes
        .iter()
        .enumerate()
        .filter_map(|(index, note)| {
            Some((
                Rc::from(note.id.as_deref()?),
                *positions.get(index)?,
                effective_staff_y,
            ))
        })
        .collect()
}

fn tie_links(notes: &[crate::model::Note]) -> Vec<(Rc<str>, Rc<str>)> {
    notes
        .iter()
        .flat_map(|note| {
            let source = note.id.as_deref();
            note.ties
                .iter()
                .flatten()
                .filter_map(move |tie| Some((Rc::from(source?), Rc::from(tie.target.as_deref()?))))
        })
        .collect()
}

use crate::layout::beams::{auto_beam_groups, render_beams, render_rest};
use crate::layout::config::LayoutConfig;
use crate::layout::spacing::laid_out_rhythmic_ink;
use crate::layout::types::{EventLayout, MeasureLayout};
use crate::render::{BoundingBox, DisplayList, RenderCommand};
use std::collections::HashSet;

pub(super) struct StaffInk {
    pub staff: u32,
    pub bounds: BoundingBox,
}

pub(super) fn clear_own_ink(
    rest: &StaffInk,
    ink: &[StaffInk],
    up: bool,
    clearance: f64,
    sp: f64,
    mut dy: f64,
) -> f64 {
    let mut obstacles: Vec<_> = ink
        .iter()
        .filter(|obstacle| {
            obstacle.staff == rest.staff
                && obstacle.bounds.x < rest.bounds.x + rest.bounds.width
                && obstacle.bounds.x + obstacle.bounds.width > rest.bounds.x
        })
        .collect();
    obstacles.sort_by(|left, right| {
        if up {
            right.bounds.y.total_cmp(&left.bounds.y)
        } else {
            (left.bounds.y + left.bounds.height).total_cmp(&(right.bounds.y + right.bounds.height))
        }
    });
    for obstacle in obstacles {
        let top = rest.bounds.y + dy;
        let bottom = top + rest.bounds.height;
        if top >= obstacle.bounds.y + obstacle.bounds.height + clearance - 1e-8
            || bottom <= obstacle.bounds.y - clearance + 1e-8
        {
            continue;
        }
        dy = if up {
            ((obstacle.bounds.y - clearance - rest.bounds.y - rest.bounds.height) / sp).floor() * sp
        } else {
            ((obstacle.bounds.y + obstacle.bounds.height + clearance - rest.bounds.y) / sp).ceil()
                * sp
        };
    }
    dy
}

pub(super) fn note_ink(
    measure: &MeasureLayout,
    all: &[Vec<EventLayout>],
    sp: f64,
    config: &LayoutConfig,
) -> Vec<Vec<StaffInk>> {
    let explicit_ids: HashSet<_> = measure
        .resolved
        .part
        .beams
        .iter()
        .flatten()
        .flat_map(|beam| beam.events.iter().cloned())
        .collect();
    let mut beam_measure = measure.clone();
    let mut beams = measure.resolved.part.beams.clone().unwrap_or_default();
    if !measure.resolved.use_beams {
        beams.extend(auto_beam_groups(
            &measure.voice_layouts,
            measure.resolved.effective_beat_meter(),
            &explicit_ids,
        ));
    }
    let beamed_ids: HashSet<_> = beams
        .iter()
        .flat_map(|beam| beam.events.iter().cloned())
        .collect();
    beam_measure.resolved.part.beams = Some(beams);
    all.iter()
        .enumerate()
        .map(|(index, events)| {
            let mut ink: Vec<_> = events
                .iter()
                .filter(|event| !event.event.is_rest())
                .flat_map(|event| {
                    let is_beamed = event.id.as_ref().is_some_and(|id| beamed_ids.contains(id));
                    laid_out_rhythmic_ink(event, is_beamed, sp, config)
                        .into_iter()
                        .map(|bounds| StaffInk {
                            staff: event.event.staff.unwrap_or(event.sequence_staff),
                            bounds,
                        })
                })
                .collect();
            let Some(first) = events.iter().find(|event| !event.event.is_rest()) else {
                return ink;
            };
            // Measure beams with their canonical renderer, before rests and dependents are placed.
            beam_measure.voice_layouts = vec![measure.voice_layouts[index].clone()];
            let mut display = DisplayList::new(0.0, 0.0);
            render_beams(
                &mut display,
                &beam_measure,
                0.0,
                sp,
                config,
                &explicit_ids,
                true,
                None,
            );
            ink.extend(display.commands.iter().filter_map(|command| {
                Some(StaffInk {
                    staff: first.event.staff.unwrap_or(first.sequence_staff),
                    bounds: command.bbox()?,
                })
            }));
            ink
        })
        .collect()
}

pub(super) fn rest_ink(event: &EventLayout, position: i32, centered: bool, sp: f64) -> BoundingBox {
    let mut display = DisplayList::new(0.0, 0.0);
    render_rest(
        &mut display,
        "",
        event.x,
        0.0,
        sp,
        &event.event.duration,
        Some(position),
        centered,
    );
    display
        .commands
        .iter()
        .filter_map(RenderCommand::bbox)
        .reduce(|left, right| left.union(&right))
        .expect("a rest always has glyph ink")
}

use super::super::types::MeasureLayout;
use super::tuning;
use super::voice_span::{
    build_voice_span_index, voice_span_is_mountain_contour, voice_span_total_hs,
};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SlurSide {
    Above,
    Below,
}

/// Placement role of an event participating in one or more slurs.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SlurRole {
    pub(crate) side: SlurSide,
    pub(crate) is_boundary: bool,
    #[allow(dead_code)]
    pub(crate) is_inside: bool,
    pub(crate) mixed_stems: bool,
    pub(crate) partner_top_pos: Option<f64>,
}

pub(crate) type SlurParticipationMap = HashMap<String, SlurRole>;

pub(super) fn compute_slur_direction(
    explicit_side: Option<&str>,
    voice_number: usize,
    voice_count: usize,
    stem_up: bool,
) -> bool {
    match explicit_side {
        Some("up") => true,
        Some("down") => false,
        _ if voice_count > 1 => voice_number.max(1) % 2 == 1,
        _ => !stem_up,
    }
}

struct ActiveSlur {
    target: String,
    side: SlurSide,
    start_stem_up: bool,
    mixed: bool,
    span_ids: Vec<String>,
    start_top_pos: f64,
    start_id: Option<String>,
}

pub(crate) fn collect_slur_participation(
    measure_layouts: &[MeasureLayout],
) -> SlurParticipationMap {
    let mut roles = SlurParticipationMap::new();
    let max_voices = measure_layouts
        .iter()
        .map(|measure| measure.voice_layouts.len())
        .max()
        .unwrap_or(0);

    for voice_index in 0..max_voices {
        let (voice_span, id_to_index) = build_voice_span_index(measure_layouts, voice_index);
        let mut active = Vec::<ActiveSlur>::new();
        for measure in measure_layouts {
            let Some(voice) = measure.voice_layouts.get(voice_index) else {
                continue;
            };
            for event_index in 0..voice.events.len() {
                let event_id = voice.events.id(event_index);
                let top_position = voice
                    .events
                    .note_positions(event_index)
                    .iter()
                    .copied()
                    .fold(f64::INFINITY, f64::min);
                let top_position = if top_position.is_finite() {
                    top_position
                } else {
                    0.0
                };

                for slur in &mut active {
                    if voice.events.stem_up(event_index) != slur.start_stem_up {
                        slur.mixed = true;
                    }
                    if let Some(id) = event_id {
                        slur.span_ids.push(id.to_string());
                    }
                }

                let mut ended_sides = Vec::new();
                let mut closed = Vec::new();
                if let Some(id) = event_id {
                    let mut index = 0;
                    while index < active.len() {
                        if active[index].target == id {
                            let slur = active.remove(index);
                            ended_sides.push(slur.side);
                            closed.push(slur);
                        } else {
                            index += 1;
                        }
                    }
                }

                let mut starting_sides = Vec::new();
                if let Some(slurs) = &voice.events.event(event_index).slurs {
                    for slur in slurs {
                        let mut above = compute_slur_direction(
                            slur.side.as_deref(),
                            voice_index + 1,
                            voice.events.num_voices(event_index),
                            voice.events.stem_up(event_index),
                        );
                        if slur.side.is_none() {
                            if let Some(source_id) = event_id {
                                if voice_span_total_hs(
                                    &voice_span,
                                    &id_to_index,
                                    source_id,
                                    &slur.target,
                                ) >= tuning::TALL_SLUR_HS_THRESHOLD
                                    && voice_span_is_mountain_contour(
                                        &voice_span,
                                        &id_to_index,
                                        source_id,
                                        &slur.target,
                                        2.0,
                                    )
                                {
                                    above = true;
                                }
                            }
                        }
                        let side = if above {
                            SlurSide::Above
                        } else {
                            SlurSide::Below
                        };
                        starting_sides.push(side);
                        active.push(ActiveSlur {
                            target: slur.target.clone(),
                            side,
                            start_stem_up: voice.events.stem_up(event_index),
                            mixed: false,
                            span_ids: event_id.into_iter().map(str::to_string).collect(),
                            start_top_pos: top_position,
                            start_id: event_id.map(str::to_string),
                        });
                    }
                }

                let is_boundary = !ended_sides.is_empty() || !starting_sides.is_empty();
                let is_inside = !is_boundary && !active.is_empty();
                if !is_boundary && !is_inside {
                    continue;
                }
                let side = starting_sides
                    .iter()
                    .chain(&ended_sides)
                    .chain(active.iter().map(|slur| &slur.side))
                    .copied()
                    .reduce(|left, right| {
                        if left == SlurSide::Above || right == SlurSide::Above {
                            SlurSide::Above
                        } else {
                            SlurSide::Below
                        }
                    });
                let mixed_stems =
                    active.iter().any(|slur| slur.mixed) || closed.iter().any(|slur| slur.mixed);
                let partner_top_pos = closing_partner_position(&closed, side);

                if let (Some(id), Some(side)) = (event_id, side) {
                    roles.insert(
                        id.to_string(),
                        SlurRole {
                            side,
                            is_boundary,
                            is_inside,
                            mixed_stems,
                            partner_top_pos,
                        },
                    );
                }
                backfill_start_roles(&mut roles, &closed, top_position);
                for slur in &closed {
                    if slur.mixed {
                        for id in &slur.span_ids {
                            if let Some(role) = roles.get_mut(id) {
                                role.mixed_stems = true;
                            }
                        }
                    }
                }
            }
        }
    }
    roles
}

fn closing_partner_position(closed: &[ActiveSlur], side: Option<SlurSide>) -> Option<f64> {
    closed
        .iter()
        .map(|slur| slur.start_top_pos)
        .reduce(|left, right| {
            if side == Some(SlurSide::Above) {
                left.max(right)
            } else {
                left.min(right)
            }
        })
}

fn backfill_start_roles(
    roles: &mut SlurParticipationMap,
    closed: &[ActiveSlur],
    partner_position: f64,
) {
    for slur in closed {
        let Some(start_id) = &slur.start_id else {
            continue;
        };
        let Some(role) = roles.get_mut(start_id) else {
            continue;
        };
        role.partner_top_pos = Some(match role.partner_top_pos {
            None => partner_position,
            Some(current) if role.side == SlurSide::Above => current.max(partner_position),
            Some(current) => current.min(partner_position),
        });
    }
}

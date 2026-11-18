use super::{emit_glissando_segment, GlissEndpoint, GlissandoStaff};
use crate::layout::config::LayoutConfig;
use crate::layout::measure::collect_flat_events;
use crate::model::{RepeatGlissando, Score};
use crate::render::DisplayList;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

pub(crate) const APPROACH_LENGTH_SP: f64 = 3.0;

pub(crate) fn state_salt(score: &Score, salt: u64) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    salt.hash(&mut hasher);
    for (index, measure) in score.global.measures.iter().enumerate() {
        if measure.repeat_end.is_none() {
            continue;
        }
        for part_index in 0..score.parts.len() {
            serde_json::to_string(&resolve_repeat_glissandos(score, part_index, index))
                .expect("resolved repeat glissandos must serialize")
                .hash(&mut hasher);
        }
    }
    hasher.finish()
}

pub(crate) fn resolve_repeat_glissandos(
    score: &Score,
    part_index: usize,
    measure_index: usize,
) -> Vec<RepeatGlissando> {
    let mut routes = Vec::new();
    if measure_index != 0
        && score
            .global
            .measures
            .get(measure_index)
            .is_none_or(|measure| measure.repeat_start.is_none() && measure.repeat_end.is_none())
    {
        return routes;
    }
    let part = &score.parts[part_index];
    let mut start = 0;
    for (end, global) in score.global.measures.iter().enumerate() {
        if global.repeat_start.is_some() {
            start = end;
        }
        if global
            .repeat_end
            .as_ref()
            .is_none_or(|repeat| repeat.times.unwrap_or(2) <= 1)
            || (measure_index != start && measure_index != end)
        {
            continue;
        }
        let Some(source_measure) = part.measures.get(end) else {
            continue;
        };
        let Some(target_measure) = part.measures.get(start) else {
            continue;
        };
        let targets: HashMap<_, _> = target_measure
            .sequences
            .iter()
            .flat_map(|sequence| {
                collect_flat_events(&sequence.content, 0.0, 1.0)
                    .into_iter()
                    .filter(|(beat, event)| *beat < 1e-9 && !event.notes().is_empty())
                    .filter_map(|(_, event)| event.id.as_deref().map(|id| (id, event)))
            })
            .collect();
        for sequence in &source_measure.sequences {
            for (beat, event) in collect_flat_events(&sequence.content, 0.0, 1.0) {
                let Some(source) = event.id.as_deref() else {
                    continue;
                };
                if event.notes().is_empty() || (start == end && beat < 1e-9) {
                    continue;
                }
                for glissando in event.glissandos.iter().flatten() {
                    let Some(target) = targets.get(glissando.target.as_str()) else {
                        continue;
                    };
                    let source_pitch = event
                        .notes()
                        .iter()
                        .map(|note| note.pitch.to_midi())
                        .max()
                        .unwrap();
                    let target_pitch = target
                        .notes()
                        .iter()
                        .map(|note| note.pitch.to_midi())
                        .max()
                        .unwrap();
                    routes.push(RepeatGlissando {
                        source: source.to_string(),
                        glissando: glissando.clone(),
                        start_measure: start,
                        end_measure: end,
                        direction: (target_pitch - source_pitch).signum() as f64,
                    });
                }
            }
        }
    }
    routes
}

pub(super) fn render(
    dl: &mut DisplayList,
    staves: &[GlissandoStaff<'_>],
    endpoints: &HashMap<String, GlissEndpoint>,
    sp: f64,
    config: &LayoutConfig,
) {
    let mut emitted = HashSet::new();
    for &(measures, _) in staves {
        for measure in measures {
            for route in &measure.resolved.repeat_glissandos {
                let id =
                    crate::layout::element_id::glissando(&route.source, &route.glissando.target);
                if !emitted.insert(id.clone()) {
                    continue;
                }
                let begin = dl.commands.len();
                // Repeat continuations retain the pitch direction without crossing the written music backwards.
                let slope = route.direction * 0.5;
                let pad = 0.3 * sp;
                if let Some(source) = endpoints
                    .get(&route.source)
                    .filter(|endpoint| endpoint.measure_index == route.end_measure)
                {
                    let x1 = source.x + source.notehead_w + pad;
                    let x2 = (x1 + APPROACH_LENGTH_SP * sp).min(source.measure_right - pad);
                    let y1 = source.staff_y + source.y_pos * sp * 0.5;
                    if x2 > x1 {
                        emit_glissando_segment(
                            dl,
                            (x1, y1),
                            (x2, y1 - (x2 - x1) * slope),
                            &route.glissando,
                            sp,
                            config,
                        );
                    }
                }
                if let Some(target) = endpoints
                    .get(&route.glissando.target)
                    .filter(|endpoint| endpoint.measure_index == route.start_measure)
                {
                    let x2 = target.x - pad;
                    let x1 = x2 - APPROACH_LENGTH_SP * sp;
                    let y2 = target.staff_y + target.y_pos * sp * 0.5;
                    let mut continuation = route.glissando.clone();
                    continuation.text = None;
                    emit_glissando_segment(
                        dl,
                        (x1, y2 + (x2 - x1) * slope),
                        (x2, y2),
                        &continuation,
                        sp,
                        config,
                    );
                }
                for index in begin..dl.commands.len() {
                    dl.tag_command(index, id.clone());
                }
            }
        }
    }
}

use crate::model::*;
use std::collections::HashMap;

pub(super) fn project(
    part: &mut PartMeasure,
    global: &GlobalMeasure,
    measure_beats: f64,
    staff_meters: Option<&HashMap<u32, EffectiveStaffMeter>>,
) {
    let fermatas = global.fermatas();
    if fermatas.is_empty() {
        return;
    }
    for sequence in &mut part.sequences {
        let scale = staff_meters
            .and_then(|meters| meters.get(&sequence.staff.unwrap_or(1)))
            .map_or(1.0, |meter| meter.ratio_to_global.as_f64());
        project_sequence(sequence, fermatas, measure_beats, scale);
    }
}

pub(crate) fn project_on_staff(
    part: &mut PartMeasure,
    global: &GlobalMeasure,
    measure_beats: f64,
    meter: Option<&EffectiveStaffMeter>,
) {
    if global.fermatas().is_empty() {
        return;
    }
    let scale = meter.map_or(1.0, |meter| meter.ratio_to_global.as_f64());
    for sequence in &mut part.sequences {
        project_sequence(sequence, global.fermatas(), measure_beats, scale);
    }
}

fn project_sequence(
    sequence: &mut Sequence,
    fermatas: &[GlobalFermata],
    measure_beats: f64,
    scale: f64,
) {
    if let Some(full_measure) = &mut sequence.full_measure {
        attach(&mut full_measure.fermata, fermatas, 0.0, measure_beats);
    } else {
        project_content(&mut sequence.content, fermatas, &mut 0.0, scale);
    }
}

fn attach(local: &mut Option<Fermata>, globals: &[GlobalFermata], onset: f64, duration: f64) {
    for global in globals {
        let beat = global.position.beats();
        // Half-open intervals keep an exact boundary on the following main event.
        if beat + 1e-9 < onset || beat >= onset + duration - 1e-9 {
            continue;
        }
        let fermata = local.get_or_insert_with(|| Fermata {
            projected_global_ids: Vec::new(),
            id: None,
            class: None,
            extensions: None,
            symbol: None,
            duration: None,
            placement: None,
            pointing: None,
        });
        fermata.projected_global_ids.push(global.id.clone());
    }
}

fn project_content(
    content: &mut [SequenceContent],
    globals: &[GlobalFermata],
    cursor: &mut f64,
    scale: f64,
) {
    for item in content {
        match item {
            SequenceContent::Event(event) => {
                let duration = event.duration.total_beats() * scale;
                attach(&mut event.fermata, globals, *cursor, duration);
                *cursor += duration;
            }
            SequenceContent::Tuplet(tuplet) => {
                let inner = tuplet.inner.duration.total_beats() * tuplet.inner.multiple as f64;
                let outer = tuplet.outer.duration.total_beats() * tuplet.outer.multiple as f64;
                let ratio = if inner > 0.0 { outer / inner } else { 1.0 };
                project_content(&mut tuplet.content, globals, cursor, scale * ratio);
            }
            SequenceContent::MultiNoteTremolo(tremolo) => {
                let duration =
                    tremolo.outer.duration.total_beats() * tremolo.outer.multiple as f64 * scale
                        / tremolo.content.len().max(1) as f64;
                for event in &mut tremolo.content {
                    attach(&mut event.fermata, globals, *cursor, duration);
                    *cursor += duration;
                }
            }
            SequenceContent::Space(space) => *cursor += space.total_beats() * scale,
            SequenceContent::Grace(_) | SequenceContent::Other(_) => {}
        }
    }
}

use super::config::LayoutConfig;
use super::element_id;
use super::text_styles;
use super::types::MeasureLayout;
use crate::model::*;
use crate::render::*;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

#[cfg(test)]
thread_local! {
    static EVENT_COLLECTION_PASSES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(super) fn take_event_collection_passes() -> usize {
    EVENT_COLLECTION_PASSES.with(|passes| passes.replace(0))
}

struct LocatedEvent<'a> {
    event: &'a Event,
    part_index: usize,
    sequence_index: usize,
    voice: Option<&'a str>,
    event_index: usize,
    staff_number: u32,
    measure_index: usize,
    measure_start_beat: f64,
    start_beat: f64,
    duration_beats: f64,
    order: usize,
}

struct VisibleEvent<'a> {
    event: &'a Event,
    part_index: usize,
    sequence_index: usize,
    measure_index: usize,
    event_index: usize,
    staff_number: u32,
    x: f64,
    end_x: f64,
}

fn part_has_lyric_lines(part: &Part) -> bool {
    (1..=part.staves.max(1)).any(|staff| super::resolve::part_staff_has_lyrics(part, staff))
}

fn collect_score_events(score: &Score) -> Vec<LocatedEvent<'_>> {
    #[cfg(test)]
    EVENT_COLLECTION_PASSES.with(|passes| passes.set(passes.get() + 1));
    let mut output = Vec::new();
    let measure_count = score.global.measures.len().max(
        score
            .parts
            .iter()
            .map(|part| part.measures.len())
            .max()
            .unwrap_or(0),
    );
    let mut measure_starts = Vec::with_capacity(measure_count);
    let mut meters = Vec::with_capacity(measure_count);
    let mut meter = TimeSignature::default();
    let mut beat = 0.0;
    for index in 0..measure_count {
        if let Some(time) = score
            .global
            .measures
            .get(index)
            .and_then(|measure| measure.time.as_ref())
        {
            meter = time.clone();
        }
        meters.push(meter.clone());
        measure_starts.push(beat);
        beat += meter.measure_beats();
    }
    let mut written_spans = vec![0.0_f64; measure_count];
    for (part_index, part) in score.parts.iter().enumerate() {
        let (staff_meters, _) =
            crate::model::staff_meter::resolve_staff_meter_table(&part.measures, &meters);
        for (measure_index, measure) in part.measures.iter().enumerate() {
            let measure_start_beat = measure_starts.get(measure_index).copied().unwrap_or(0.0);
            for (sequence_index, sequence) in measure.sequences.iter().enumerate() {
                let staff_number = sequence.staff.unwrap_or(1);
                let ratio = staff_meters[measure_index]
                    .get(&staff_number)
                    .map_or(1.0, |meter| meter.ratio_to_global.as_f64());
                let timeline =
                    super::spacing::sequence_timeline(sequence, sequence_index, 1, ratio);
                if sequence.full_measure.is_none() {
                    written_spans[measure_index] =
                        written_spans[measure_index].max(timeline.duration_beats);
                }
                for (event_index, timed) in timeline.events.iter().enumerate() {
                    let graces = timeline.grace_before.get(&timed.key);
                    for event in graces
                        .into_iter()
                        .flatten()
                        .copied()
                        .chain(std::iter::once(timed.event))
                    {
                        output.push(LocatedEvent {
                            event,
                            part_index,
                            sequence_index,
                            voice: sequence.voice.as_deref(),
                            event_index,
                            staff_number,
                            measure_index,
                            measure_start_beat,
                            start_beat: measure_start_beat + timed.key.beats(),
                            duration_beats: if std::ptr::eq(event, timed.event) {
                                timed.duration_beats
                            } else {
                                0.0
                            },
                            order: output.len(),
                        });
                    }
                }
                if let Some(last) = timeline.events.last() {
                    for event in timeline.grace_after.get(&last.key).into_iter().flatten() {
                        output.push(LocatedEvent {
                            event,
                            part_index,
                            sequence_index,
                            voice: sequence.voice.as_deref(),
                            event_index: timeline.events.len().saturating_sub(1),
                            staff_number,
                            measure_index,
                            measure_start_beat,
                            start_beat: measure_start_beat + timeline.duration_beats,
                            duration_beats: 0.0,
                            order: output.len(),
                        });
                    }
                }
            }
        }
    }
    let mut correction = 0.0;
    let mut corrections = Vec::with_capacity(measure_count);
    for index in 0..measure_count {
        corrections.push(correction);
        let nominal = meters[index].measure_beats();
        let global = score.global.measures.get(index);
        if index == 0
            && global.is_some_and(|measure| measure.number == Some(0))
            && written_spans[index] > 0.0
        {
            correction += written_spans[index] - nominal;
        } else if global
            .and_then(|measure| measure.time.as_ref())
            .is_some_and(|time| time.display == Some(TimeSignatureDisplay::SenzaMisura))
        {
            correction += written_spans[index].max(nominal) - nominal;
        }
    }
    for event in &mut output {
        event.start_beat += corrections[event.measure_index];
        event.measure_start_beat += corrections[event.measure_index];
    }
    output
}

pub(super) fn cache_dependency_hash(score: &Score) -> u64 {
    if !score.parts.iter().any(part_has_lyric_lines) {
        return 0;
    }
    let events = collect_score_events(score);
    if !events.iter().any(|located| {
        located
            .event
            .lyrics
            .as_ref()
            .and_then(|lyrics| lyrics.lines.as_ref())
            .is_some_and(|lines| !lines.is_empty())
    }) {
        return 0;
    }

    let mut hasher = DefaultHasher::new();
    score
        .mnx
        .support
        .as_ref()
        .and_then(|support| support.use_lyric_extenders)
        .hash(&mut hasher);
    for (part_index, part) in score.parts.iter().enumerate() {
        for (measure_index, measure) in part.measures.iter().enumerate() {
            for (sequence_index, sequence) in measure.sequences.iter().enumerate() {
                if sequence.full_measure.is_some() {
                    part_index.hash(&mut hasher);
                    measure_index.hash(&mut hasher);
                    sequence_index.hash(&mut hasher);
                    sequence.staff.hash(&mut hasher);
                    sequence.voice.hash(&mut hasher);
                }
            }
        }
    }
    for located in events {
        located.part_index.hash(&mut hasher);
        located.sequence_index.hash(&mut hasher);
        located.voice.hash(&mut hasher);
        located.staff_number.hash(&mut hasher);
        located.measure_index.hash(&mut hasher);
        located.order.hash(&mut hasher);
        located.start_beat.to_bits().hash(&mut hasher);
        located.duration_beats.to_bits().hash(&mut hasher);
        serde_json::to_string(located.event)
            .expect("score events are serializable")
            .hash(&mut hasher);
    }
    hasher.finish()
}

fn visible_events(measure_layouts: &[MeasureLayout]) -> Vec<VisibleEvent<'_>> {
    let mut output = Vec::new();
    for measure in measure_layouts {
        for voice in &measure.voice_layouts {
            let sequence_index = voice.seq_index_override.unwrap_or(voice.voice_index);
            for event_index in 0..voice.events.len() {
                let event = voice.events.event(event_index);
                let end_x = if event_index + 1 < voice.events.len() {
                    voice.events.x(event_index + 1)
                } else {
                    measure.x + measure.width
                };
                output.push(VisibleEvent {
                    event,
                    part_index: voice.part_index_override.unwrap_or(measure.part_index),
                    sequence_index,
                    measure_index: measure.resolved.index,
                    event_index,
                    staff_number: voice.events.sequence_staff(event_index),
                    x: voice.events.x(event_index),
                    end_x,
                });
            }
        }
    }
    output
}

fn measure_x_at_beat(measure: &MeasureLayout, beat: f64) -> f64 {
    let (total_beats, anchors) = super::beat_anchors::build_beat_anchors(measure);
    let beat = beat.clamp(0.0, total_beats);
    for pair in anchors.windows(2) {
        let (left_beat, left_x) = pair[0];
        let (right_beat, right_x) = pair[1];
        if beat <= right_beat {
            let span = right_beat - left_beat;
            if span <= f64::EPSILON {
                return right_x;
            }
            return left_x + (right_x - left_x) * ((beat - left_beat) / span);
        }
    }
    anchors
        .last()
        .map_or(measure.x + measure.width, |anchor| anchor.1)
}

fn target_end_x(target: &LocatedEvent<'_>, measure_layouts: &[MeasureLayout]) -> Option<f64> {
    let measure = measure_layouts
        .iter()
        .find(|measure| measure.resolved.index == target.measure_index)?;
    Some(measure_x_at_beat(
        measure,
        target.start_beat - target.measure_start_beat + target.duration_beats,
    ))
}

fn same_lyric_voice(source: &LocatedEvent<'_>, candidate: &LocatedEvent<'_>) -> bool {
    source.part_index == candidate.part_index
        && source.staff_number == candidate.staff_number
        && match source.voice {
            Some(voice) => candidate.voice == Some(voice),
            None => candidate.voice.is_none() && source.sequence_index == candidate.sequence_index,
        }
}

fn inferred_target<'score, 'events>(
    score: &Score,
    source: &LocatedEvent<'score>,
    line_id: &str,
    events: &'events [LocatedEvent<'score>],
) -> Option<&'events LocatedEvent<'score>> {
    let mut target = None;
    for candidate in events.iter().filter(|candidate| {
        same_lyric_voice(source, candidate)
            && (candidate.start_beat > source.start_beat
                || (candidate.start_beat == source.start_beat && candidate.order > source.order))
    }) {
        let full_measure_rest = score.parts[source.part_index]
            .measures
            .iter()
            .enumerate()
            .skip(source.measure_index + 1)
            .take(candidate.measure_index.saturating_sub(source.measure_index))
            .any(|(_, measure)| {
                measure
                    .sequences
                    .iter()
                    .enumerate()
                    .any(|(index, sequence)| {
                        sequence.full_measure.is_some()
                            && sequence.staff.unwrap_or(1) == source.staff_number
                            && match source.voice {
                                Some(voice) => sequence.voice.as_deref() == Some(voice),
                                None => sequence.voice.is_none() && index == source.sequence_index,
                            }
                    })
            });
        if full_measure_rest
            || candidate.event.is_rest()
            || candidate
                .event
                .lyrics
                .as_ref()
                .and_then(|lyrics| lyrics.lines.as_ref())
                .is_some_and(|lines| lines.contains_key(line_id))
        {
            break;
        }
        target = Some(candidate);
    }
    target
}

fn target_for<'score, 'events>(
    score: &Score,
    source: &LocatedEvent<'score>,
    line_id: &str,
    line: &LyricLine,
    events: &'events [LocatedEvent<'score>],
    explicit_policy: bool,
) -> Option<&'events LocatedEvent<'score>> {
    let extender = line.extender.as_ref();
    if extender.is_some_and(|value| value.show == Some(false)) {
        return None;
    }
    if extender.is_none() && explicit_policy {
        return None;
    }
    if extender.is_none()
        && matches!(
            line.syllable_type,
            Some(LyricLineType::Start) | Some(LyricLineType::Middle)
        )
    {
        return None;
    }
    if let Some(target_id) = extender.and_then(|value| value.target.as_deref()) {
        return events.iter().find(|candidate| {
            candidate.event.id.as_deref() == Some(target_id)
                && (candidate.start_beat > source.start_beat
                    || (candidate.start_beat == source.start_beat
                        && (candidate.part_index != source.part_index
                            || candidate.sequence_index != source.sequence_index
                            || candidate.order >= source.order)))
        });
    }
    inferred_target(score, source, line_id, events)
}

fn crosses_later_syllable(
    source: &LocatedEvent<'_>,
    target: &LocatedEvent<'_>,
    line_id: &str,
    events: &[LocatedEvent<'_>],
) -> bool {
    events.iter().any(|candidate| {
        same_lyric_voice(source, candidate)
            && candidate.order > source.order
            && candidate.start_beat <= target.start_beat
            && candidate.order != target.order
            && candidate
                .event
                .lyrics
                .as_ref()
                .and_then(|lyrics| lyrics.lines.as_ref())
                .is_some_and(|lines| lines.contains_key(line_id))
    })
}

fn source_element_id(source: &LocatedEvent<'_>) -> String {
    let suffix = element_id::event_suffix(source.event.id.as_deref(), source.event_index);
    element_id::event(
        source.part_index,
        source.measure_index,
        source.sequence_index,
        &suffix,
    )
}

fn matches_visible(source: &LocatedEvent<'_>, candidate: &VisibleEvent<'_>) -> bool {
    candidate.part_index == source.part_index
        && candidate.sequence_index == source.sequence_index
        && candidate.staff_number == source.staff_number
        && candidate.measure_index == source.measure_index
        && source.event.id.as_ref().map_or_else(
            || candidate.event.id.is_none() && candidate.event_index == source.event_index,
            |id| candidate.event.id.as_ref() == Some(id),
        )
}

pub(super) fn active_line_ids_for_system(
    score: &Score,
    part_index: usize,
    measure_layouts: &[MeasureLayout],
    staff_number: u32,
) -> HashSet<String> {
    if score
        .parts
        .get(part_index)
        .is_none_or(|part| !part_has_lyric_lines(part))
    {
        return HashSet::new();
    }
    let events = collect_score_events(score);
    let first_measure = measure_layouts
        .iter()
        .map(|measure| measure.resolved.index)
        .min()
        .unwrap_or(0);
    let last_measure = measure_layouts
        .iter()
        .map(|measure| measure.resolved.index)
        .max()
        .unwrap_or(first_measure);
    let explicit_policy = score
        .mnx
        .support
        .as_ref()
        .and_then(|support| support.use_lyric_extenders)
        .unwrap_or(false);
    let mut active = HashSet::new();
    for source in events
        .iter()
        .filter(|source| source.part_index == part_index && source.staff_number == staff_number)
    {
        let Some(lines) = source
            .event
            .lyrics
            .as_ref()
            .and_then(|lyrics| lyrics.lines.as_ref())
        else {
            continue;
        };
        for (line_id, line) in lines {
            let Some(target) = target_for(score, source, line_id, line, &events, explicit_policy)
            else {
                continue;
            };
            let conflicts = target.order != source.order
                && target
                    .event
                    .lyrics
                    .as_ref()
                    .and_then(|lyrics| lyrics.lines.as_ref())
                    .is_some_and(|target_lines| target_lines.contains_key(line_id));
            if !conflicts
                && !crosses_later_syllable(source, target, line_id, &events)
                && source.measure_index <= last_measure
                && target.measure_index >= first_measure
            {
                active.insert(line_id.clone());
            }
        }
    }
    active
}

pub(super) fn system_lyric_context(
    score: &Score,
    part_index: usize,
    measure_layouts: &[MeasureLayout],
    global_line_order: Option<&[String]>,
    staff_index: Option<usize>,
) -> (Option<Vec<String>>, u32) {
    let staff_number = measure_layouts
        .iter()
        .flat_map(|measure| &measure.voice_layouts)
        .find_map(|voice| (!voice.events.is_empty()).then(|| voice.events.sequence_staff(0)))
        .unwrap_or_else(|| staff_index.map_or(1, |index| index as u32 + 1));
    let extender_lines =
        active_line_ids_for_system(score, part_index, measure_layouts, staff_number);
    let line_order = super::render_lyrics::line_order_for_staff_with_extenders(
        measure_layouts,
        global_line_order,
        &extender_lines,
    );
    (line_order, staff_number)
}

pub(super) fn render_part_system_extenders(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    score: &Score,
    part_index: usize,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    system_line_order: Option<&[String]>,
    staff_number: u32,
) {
    render_system_extenders(
        dl,
        measure_layouts,
        score,
        part_index,
        staff_y,
        sp,
        config,
        system_line_order,
        staff_number,
        None,
    );
}

pub(super) fn render_system_extenders(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    score: &Score,
    part_index: usize,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    system_line_order: Option<&[String]>,
    staff_number: u32,
    all_system_layouts: Option<&[Vec<MeasureLayout>]>,
) {
    if measure_layouts.is_empty() || system_line_order.is_none() {
        return;
    }
    let events = collect_score_events(score);
    let visible = all_system_layouts.map_or_else(
        || visible_events(measure_layouts),
        |system_layouts| {
            system_layouts
                .iter()
                .flat_map(|layouts| visible_events(layouts))
                .collect()
        },
    );
    let first_measure = measure_layouts
        .iter()
        .map(|measure| measure.resolved.index)
        .min()
        .unwrap_or(0);
    let last_measure = measure_layouts
        .iter()
        .map(|measure| measure.resolved.index)
        .max()
        .unwrap_or(first_measure);
    let left_x = measure_layouts.first().map_or(0.0, |measure| measure.x);
    let right_x = measure_layouts
        .last()
        .map_or(left_x, |measure| measure.x + measure.width);
    let explicit_policy = score
        .mnx
        .support
        .as_ref()
        .and_then(|support| support.use_lyric_extenders)
        .unwrap_or(false);
    let Some(ordered_lines) = system_line_order else {
        return;
    };
    let lyric_metrics = config.placement.resolve(ElementKind::Lyric);
    let font_size = 1.6 * sp;
    let base_lyric_y = staff_y + 4.0 * sp + lyric_metrics.attach_gap * sp;
    let line_spacing = lyric_metrics.padding.vertical * sp;

    for source in &events {
        if source.part_index != part_index
            || source.staff_number != staff_number
            || source.measure_index > last_measure
        {
            continue;
        }
        let Some(lines) = source
            .event
            .lyrics
            .as_ref()
            .and_then(|lyrics| lyrics.lines.as_ref())
        else {
            continue;
        };
        for (line_id, line) in lines {
            let Some(target) = target_for(score, source, line_id, line, &events, explicit_policy)
            else {
                continue;
            };
            if target.start_beat < source.start_beat
                || target.measure_index < first_measure
                || source.measure_index > last_measure
                || (target.order != source.order
                    && target
                        .event
                        .lyrics
                        .as_ref()
                        .and_then(|lyrics| lyrics.lines.as_ref())
                        .is_some_and(|target_lines| target_lines.contains_key(line_id)))
                || crosses_later_syllable(source, target, line_id, &events)
            {
                continue;
            }
            let line_index = ordered_lines
                .iter()
                .position(|id| id == line_id)
                .unwrap_or(0);
            let lyric_y = base_lyric_y + line_index as f64 * line_spacing;
            let source_visible = visible
                .iter()
                .find(|candidate| matches_visible(source, candidate));
            let target_visible = visible
                .iter()
                .find(|candidate| matches_visible(target, candidate));
            let starts_here = source.measure_index >= first_measure
                && source.measure_index <= last_measure
                && source_visible.is_some();
            let ends_here =
                target.measure_index >= first_measure && target.measure_index <= last_measure;
            let segment_start = if starts_here {
                let source_width = text_styles::text_width(
                    &line.text,
                    font_size,
                    text_styles::FontFamily::Serif,
                    false,
                );
                source_visible.map_or(left_x, |anchor| anchor.x + 0.59 * sp + source_width * 0.5)
            } else {
                left_x
            };
            let segment_end = if ends_here {
                target_visible.map_or_else(
                    || target_end_x(target, measure_layouts).unwrap_or(right_x),
                    |anchor| anchor.end_x,
                )
            } else {
                right_x
            };
            if segment_end <= segment_start {
                continue;
            }
            let event_id = source_element_id(source);
            let lyric_id = element_id::lyric(&event_id, line_id);
            let y = lyric_y + font_size * 0.72;
            dl.push_tagged(
                RenderCommand::DrawLine {
                    x1: segment_start,
                    y1: y,
                    x2: segment_end,
                    y2: y,
                    width: 0.12 * sp,
                    color: "#000000".into(),
                },
                lyric_id.clone(),
            );
            dl.push_element_bbox_with_shape(ElementBBox {
                element_id: lyric_id,
                bbox: BoundingBox::new(
                    segment_start,
                    y - 0.35 * sp,
                    segment_end - segment_start,
                    0.7 * sp,
                ),
            });
        }
    }
}

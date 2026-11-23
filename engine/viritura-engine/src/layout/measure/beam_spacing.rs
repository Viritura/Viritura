use super::contesting_voice_count;
use super::orchestrate::layout_voice_for_measure;
use crate::layout::beams::{auto_beam_groups, collect_beamed_event_ids};
use crate::layout::spacing::LogSpacing;
use crate::layout::{grace::GraceSpacingContext, LayoutConfig};
use crate::model::{Clef, ClefSign, ResolvedMeasure, SequenceContent};
use std::collections::{HashMap, HashSet};

fn content_has_beamable_event(content: &[SequenceContent]) -> bool {
    content.iter().any(|item| match item {
        SequenceContent::Event(event) => event.duration.base.flag_count() > 0,
        SequenceContent::Tuplet(tuplet) => content_has_beamable_event(&tuplet.content),
        SequenceContent::MultiNoteTremolo(tremolo) => tremolo
            .content
            .iter()
            .any(|event| event.duration.base.flag_count() > 0),
        SequenceContent::Grace(_) | SequenceContent::Space(_) | SequenceContent::Other(_) => false,
    })
}

pub(crate) fn auto_beamed_event_indices_for_spacing(
    measure: &ResolvedMeasure,
    config: &LayoutConfig,
    total_beats: f64,
) -> HashSet<(usize, usize)> {
    if measure.use_beams
        || !measure
            .part
            .sequences
            .iter()
            .any(|sequence| content_has_beamable_event(&sequence.content))
    {
        return HashSet::new();
    }

    let placeholder_spacing = LogSpacing {
        mapping: Vec::new(),
        total_width: 1.0,
        rigid_widths: Vec::new(),
        rigid_total: 0.0,
        minimum_widths: Vec::new(),
        minimum_total: 0.0,
        base_sp: config.sp,
    };
    let grace_context = GraceSpacingContext {
        key: &measure.active_key,
        transposition: measure.display_transposition(),
        clef: None,
        kit: measure.kit.as_ref(),
        suppressed_note_ids: None,
        config,
    };
    let active_clef = measure
        .part
        .clefs
        .as_ref()
        .and_then(|clefs| clefs.first())
        .map(|clef| clef.clef.clone())
        .unwrap_or(Clef {
            sign: ClefSign::G,
            staff_position: -2,
            color: None,
            glyph: None,
            octave: None,
            show_octave: None,
            hide: None,
        });
    let clef_changes = [(0.0, active_clef)];
    let num_voices = measure.part.sequences.len();
    let contesting_voices = contesting_voice_count(&measure.part.sequences);
    let mut measure_acc = HashMap::new();
    let voice_layouts = measure
        .part
        .sequences
        .iter()
        .enumerate()
        .map(|(voice_index, sequence)| {
            layout_voice_for_measure(
                sequence,
                voice_index,
                measure,
                num_voices,
                contesting_voices,
                config.sp,
                0.0,
                0.0,
                0.0,
                0.0,
                false,
                total_beats,
                &clef_changes,
                &[],
                &placeholder_spacing,
                &grace_context,
                &mut measure_acc,
            )
        })
        .collect::<Vec<_>>();
    let excluded_ids = collect_beamed_event_ids(&measure.part);

    let auto_beamed_ids: HashSet<_> = auto_beam_groups(
        &voice_layouts,
        measure.effective_beat_meter(),
        &excluded_ids,
    )
    .into_iter()
    .flat_map(|beam| beam.events)
    .collect();
    let mut indices = HashSet::new();
    for (voice_index, voice) in voice_layouts.iter().enumerate() {
        for event_index in 0..voice.events.len() {
            if voice
                .events
                .id(event_index)
                .is_some_and(|id| auto_beamed_ids.contains(id))
            {
                indices.insert((voice_index, event_index));
            }
        }
    }
    indices
}

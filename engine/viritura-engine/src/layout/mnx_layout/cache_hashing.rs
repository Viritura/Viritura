use super::super::measure::AlignedPrefix;
use super::super::spacing::LogSpacing;
use super::super::types::ResolvedOttavaRange;
use crate::model::ResolvedMeasure;
use crate::model::TimeSignatureSettings;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub(super) fn compound_layout_hash(
    content_hash: u64,
    forced_width: f64,
    spacing: &LogSpacing,
    prefix: AlignedPrefix,
    part_mid_clef_beats: &[f64],
) -> u64 {
    let mut hasher = DefaultHasher::new();
    content_hash.hash(&mut hasher);
    forced_width.to_bits().hash(&mut hasher);
    prefix.width.to_bits().hash(&mut hasher);
    prefix.first_onset_padding.to_bits().hash(&mut hasher);
    for &(beat, x) in &spacing.mapping {
        beat.to_bits().hash(&mut hasher);
        x.to_bits().hash(&mut hasher);
    }

    spacing.total_width.to_bits().hash(&mut hasher);
    for &beat in part_mid_clef_beats {
        beat.to_bits().hash(&mut hasher);
    }
    hasher.finish()
}

pub(super) fn time_signature_aware_hash(
    content_hash: u64,
    has_time_signature: bool,
    settings: TimeSignatureSettings,
) -> u64 {
    if !has_time_signature {
        return content_hash;
    }
    let mut hasher = DefaultHasher::new();
    content_hash.hash(&mut hasher);
    settings.render_style.hash(&mut hasher);
    settings.distribution.hash(&mut hasher);
    settings.grand_staff.hash(&mut hasher);
    settings.position.hash(&mut hasher);
    settings.scale.to_bits().hash(&mut hasher);
    hasher.finish()
}

pub(super) fn ottava_aware_hash(
    content_hash: u64,
    ottavas: &[ResolvedOttavaRange],
    measure_index: usize,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    content_hash.hash(&mut hasher);
    for ottava in ottavas.iter().filter(|ottava| {
        measure_index >= ottava.start_measure && measure_index <= ottava.end_measure
    }) {
        ottava.start_measure.hash(&mut hasher);
        ottava.start_beat.to_bits().hash(&mut hasher);
        ottava.end_measure.hash(&mut hasher);
        ottava.end_beat.to_bits().hash(&mut hasher);
        ottava.value.hash(&mut hasher);
    }
    hasher.finish()
}

#[allow(clippy::too_many_arguments)] // Authored measure retention includes content, shared spacing, pitch spans, and system-onset state.
pub(super) fn explicit_measure_layout_hash(
    measure: &ResolvedMeasure,
    width: f64,
    spacing: &LogSpacing,
    prefix: AlignedPrefix,
    ottavas: &[ResolvedOttavaRange],
    settings: TimeSignatureSettings,
    common_shortest_beats: f64,
    first_on_system: bool,
) -> u64 {
    let content_hash = super::super::cache::measure_content_hash(measure);
    let content_hash = ottava_aware_hash(content_hash, ottavas, measure.index);
    let content_hash = time_signature_aware_hash(content_hash, true, settings);
    let mut hasher = DefaultHasher::new();
    compound_layout_hash(content_hash, width, spacing, prefix, &[]).hash(&mut hasher);
    common_shortest_beats.to_bits().hash(&mut hasher);
    first_on_system.hash(&mut hasher);
    measure.condensing_change.hash(&mut hasher);
    measure.prev_key.fifths.hash(&mut hasher);
    measure.prev_key.atonal.hash(&mut hasher);
    measure.prev_key.color.hash(&mut hasher);
    for sequence in &measure.part.sequences {
        sequence.forced_stem_up.hash(&mut hasher);
        sequence.source_part_index.hash(&mut hasher);
        sequence.source_seq_index.hash(&mut hasher);
    }
    hasher.finish()
}

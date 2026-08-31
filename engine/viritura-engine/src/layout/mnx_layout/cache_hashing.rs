use super::super::measure::AlignedPrefix;
use super::super::spacing::LogSpacing;
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

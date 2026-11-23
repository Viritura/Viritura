//! Measure layout.

mod beam_spacing;
mod beam_stems;
mod cross_staff;
mod helpers;
mod orchestrate;
mod prefix_width;
mod rest_conflicts;
mod stem_direction;
mod tremolo_pair;

/// Fixed breathing room between the final rhythmic spring and the barline.
pub(crate) const MEASURE_TRAILING_PADDING_SP: f64 = 0.5;

pub(crate) use beam_spacing::auto_beamed_event_indices_for_spacing;
pub(crate) use cross_staff::*;
pub(crate) use helpers::{
    collect_flat_events, compute_note_staff_positions, compute_seconds_displacement,
};
pub(crate) use orchestrate::*;
pub(crate) use prefix_width::*;
pub(crate) use stem_direction::{contesting_voice_count, resolve_stem_up, StemContext};

#[cfg(test)]
pub(crate) use helpers::skyline_min_content_width;

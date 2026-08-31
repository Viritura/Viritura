//! Measure layout.

mod cross_staff;
mod helpers;
mod orchestrate;
mod prefix_width;
mod rest_conflicts;
mod tremolo_pair;

/// Fixed breathing room between the final rhythmic spring and the barline.
pub(crate) const MEASURE_TRAILING_PADDING_SP: f64 = 0.5;

pub(crate) use cross_staff::*;
pub(crate) use helpers::{compute_note_staff_positions, compute_seconds_displacement};
pub(crate) use orchestrate::*;
pub(crate) use prefix_width::*;

#[cfg(test)]
pub(crate) use helpers::skyline_min_content_width;

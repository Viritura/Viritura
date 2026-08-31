#![allow(unused_imports)]

use super::super::*;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) fn system_render_hash(
    all_staff_layouts: &[Vec<MeasureLayout>],
    staff_content_hashes: &[Vec<u64>],
    staff_y_offsets: &[f64],
    next_sys_clef_per_staff: &[Option<&Clef>],
    margin_left: f64,
    sys_idx: usize,
    is_last_system: bool,
    salt: u64,
) -> u64 {
    let mut h = DefaultHasher::new();
    salt.hash(&mut h);
    sys_idx.hash(&mut h);
    is_last_system.hash(&mut h);
    margin_left.to_bits().hash(&mut h);

    // Relative staff offsets — the absolute base is the reuse Δy and must be
    // excluded so a rigidly-shifted-but-identical system still hits.
    let base = staff_y_offsets.first().copied().unwrap_or(0.0);
    staff_y_offsets.len().hash(&mut h);
    for &off in staff_y_offsets {
        (off - base).to_bits().hash(&mut h);
    }

    // Per-staff, per-measure laid-out content. The pre-computed content hash is
    // reused from Pass 1; geometry and render flags are hashed directly.
    all_staff_layouts.len().hash(&mut h);
    for (staff_idx, layouts) in all_staff_layouts.iter().enumerate() {
        layouts.len().hash(&mut h);
        for (mi, ml) in layouts.iter().enumerate() {
            staff_content_hashes
                .get(staff_idx)
                .and_then(|hs| hs.get(mi))
                .copied()
                .unwrap_or(0)
                .hash(&mut h);
            ml.x.to_bits().hash(&mut h);
            ml.width.to_bits().hash(&mut h);
            ml.prefix_width.to_bits().hash(&mut h);
            ml.is_first_on_system.hash(&mut h);
            ml.is_first_staff.hash(&mut h);
            ml.show_system_objects.hash(&mut h);
            ml.part_index.hash(&mut h);
            ml.multimeasure_rest_count.hash(&mut h);
            ml.multimeasure_rest_label.hash(&mut h);
        }
    }

    // Courtesy clefs rendered at the system's right edge.
    if let Ok(json) = serde_json::to_string(next_sys_clef_per_staff) {
        json.hash(&mut h);
    }

    h.finish()
}

/// Render identity for one staff-content pass. This is intentionally more
/// conservative than the eventual per-staff dependency graph: every relative
/// staff offset is included, so cross-staff geometry can never reuse across a
/// changed gap. Absolute placement is excluded and replayed as a rigid shift.
#[allow(clippy::too_many_arguments)]
pub(super) fn staff_content_render_hash(
    measure_layouts: &[MeasureLayout],
    content_hashes: &[u64],
    staff_y_offsets: &[f64],
    next_system_clef: Option<&Clef>,
    margin_left: f64,
    sys_idx: usize,
    staff_idx: usize,
    is_last_system: bool,
    clef_change_hash: u64,
    salt: u64,
) -> u64 {
    let mut h = DefaultHasher::new();
    salt.hash(&mut h);
    sys_idx.hash(&mut h);
    staff_idx.hash(&mut h);
    is_last_system.hash(&mut h);
    clef_change_hash.hash(&mut h);
    margin_left.to_bits().hash(&mut h);

    let base = staff_y_offsets.first().copied().unwrap_or(0.0);
    staff_y_offsets.len().hash(&mut h);
    for &offset in staff_y_offsets {
        (offset - base).to_bits().hash(&mut h);
    }

    measure_layouts.len().hash(&mut h);
    for (measure_index, layout) in measure_layouts.iter().enumerate() {
        content_hashes
            .get(measure_index)
            .copied()
            .unwrap_or(0)
            .hash(&mut h);
        layout.x.to_bits().hash(&mut h);
        layout.width.to_bits().hash(&mut h);
        layout.prefix_width.to_bits().hash(&mut h);
        layout.is_first_on_system.hash(&mut h);
        layout.is_first_staff.hash(&mut h);
        layout.show_system_objects.hash(&mut h);
        layout.part_index.hash(&mut h);
        layout.multimeasure_rest_count.hash(&mut h);
        layout.multimeasure_rest_label.hash(&mut h);
    }
    if let Some(clef) = next_system_clef {
        if let Ok(json) = serde_json::to_string(clef) {
            json.hash(&mut h);
        }
    }
    h.finish()
}

pub(super) fn system_has_cross_staff_events(all_staff_layouts: &[Vec<MeasureLayout>]) -> bool {
    all_staff_layouts.iter().flatten().any(|measure| {
        measure.voice_layouts.iter().any(|voice| {
            (0..voice.events.len()).any(|event_index| {
                voice
                    .events
                    .event(event_index)
                    .staff
                    .is_some_and(|target| target != voice.events.sequence_staff(event_index))
            })
        })
    })
}

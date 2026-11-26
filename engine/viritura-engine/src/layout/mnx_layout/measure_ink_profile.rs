//! Per-measure vertical ink profile for joint system/page planning.
//!
//! Each visible measure is engraved as the opening of a one-measure system,
//! with the same staff placement and ink folding the measured packer uses.
//! A candidate system's height is then the union of its measures' extents,
//! so the planner can choose page turns with realistic heights in one pass
//! instead of measuring a casting and replanning.
//!
//! One-measure engraving cannot see ink that only arises across measures
//! (long slurs, hairpins, collision stacking of text along a line), so the
//! profile is calibrated once against the measured baseline casting: each
//! measure takes the outer ink painted over its horizontal span there,
//! rendered without system-start furniture. The isolated engraving supplies
//! that furniture as the measure's opening ink, which only the first measure
//! of a candidate system contributes.

use super::super::config::LayoutConfig;
use super::super::full_score::{compute_system_object_staves, FlatStaff, GroupRange};
use super::super::measure::layout_measure;
use super::super::page_turn::MeasureInk;
use super::super::types::{MeasureLayout, ResolvedOttavaRange};
use super::break_planning::SystemBreakPlan;
use super::measure_widths::MeasureWidthBudget;
use super::mmr_grouping::MmrPlan;
use super::resolve_condensing::ResolvedStaffSnapshot;
use super::staff_placement::compute_staff_y_offsets_for_system;
use super::system_ink::{measure_outer_extents, outer_extents};
use super::system_precompute::precompute_system_layouts;
use crate::model::Score;
use std::collections::HashMap;
use std::sync::Arc;

pub(super) struct InkProfileInputs<'a> {
    pub(super) score: &'a Score,
    pub(super) config: &'a LayoutConfig,
    pub(super) flat_staves: &'a [FlatStaff],
    pub(super) group_ranges: &'a [GroupRange],
    pub(super) resolved: &'a [ResolvedStaffSnapshot],
    pub(super) ottavas: &'a [Arc<[ResolvedOttavaRange]>],
    pub(super) mmr: &'a MmrPlan,
    pub(super) mmr_labels: &'a HashMap<usize, String>,
    pub(super) budget: &'a MeasureWidthBudget,
    /// Greedy casting measured once to calibrate cross-measure ink.
    pub(super) baseline: &'a SystemBreakPlan,
}

/// Ink extent of every visible measure, indexed by visible position.
pub(super) fn measure_ink_profile(inputs: &InkProfileInputs<'_>) -> Vec<MeasureInk> {
    let mut ink = isolated_measure_ink(inputs);
    calibrate_to_baseline(&mut ink, inputs);
    ink
}

/// Replace each measure's running outer ink with what the measured baseline
/// casting paints over it, and shift its staff block by its system's residual.
fn calibrate_to_baseline(ink: &mut [MeasureInk], inputs: &InkProfileInputs<'_>) {
    let sp = inputs.config.sp;
    let staff_height = 4.0 * sp;
    let measured = precompute_system_layouts(
        inputs.config,
        inputs.flat_staves,
        inputs.group_ranges,
        inputs.resolved,
        inputs.ottavas,
        inputs.mmr,
        inputs.mmr_labels,
        inputs.budget,
        inputs.baseline,
        false,
        None,
        None,
    );
    for (system, layouts) in inputs.baseline.systems.iter().zip(&measured.layouts) {
        let view: Vec<Vec<&MeasureLayout>> =
            layouts.iter().map(|staff| staff.iter().collect()).collect();
        let placement = compute_staff_y_offsets_for_system(
            &view,
            inputs.flat_staves,
            inputs.group_ranges,
            0.0,
            7.0 * sp,
            inputs.config.default_intra_staff_clearance * sp,
            sp,
            staff_height,
            inputs.config,
            false,
            inputs.score,
        );
        let core = staff_height + placement.offsets.last().copied().unwrap_or(0.0);
        let estimated_core = system
            .iter()
            .filter_map(|&position| ink.get(position).map(|measure| measure.core))
            .fold(0.0_f64, f64::max);
        // Opening furniture is profiled per measure in isolation, so credit
        // only the ink a measure keeps wherever it falls in a system.
        let mut running = layouts.clone();
        for opening in running.iter_mut().filter_map(|staff| staff.first_mut()) {
            opening.is_first_on_system = false;
        }
        let extents = measure_outer_extents(
            &running,
            inputs.flat_staves,
            &placement.offsets,
            inputs.score,
            inputs.config,
        );
        for (&position, (above, below)) in system.iter().zip(extents) {
            if let Some(measure) = ink.get_mut(position) {
                // The system maximum stays non-negative, so clamping only
                // touches measures that never set the staff block's extent.
                measure.core = (measure.core + core - estimated_core).max(0.0);
                measure.above = above;
                measure.below = below;
            }
        }
    }
}
fn isolated_measure_ink(inputs: &InkProfileInputs<'_>) -> Vec<MeasureInk> {
    let sp = inputs.config.sp;
    let staff_height = 4.0 * sp;
    let staff_count = inputs.flat_staves.len();
    let system_object_staves = compute_system_object_staves(inputs.group_ranges, staff_count);
    inputs
        .mmr
        .visible_indices
        .iter()
        .map(|&measure_index| {
            let layouts: Vec<Vec<MeasureLayout>> = inputs
                .resolved
                .iter()
                .enumerate()
                .filter_map(|(staff_index, staff)| {
                    let resolved = staff.get(measure_index)?;
                    let ottavas = inputs.ottavas.get(staff_index).map_or(&[][..], |o| &o[..]);
                    let mut layout = layout_measure(
                        resolved,
                        sp,
                        0.0,
                        inputs.config,
                        None,
                        ottavas,
                        inputs.budget.common_shortest_beats,
                    );
                    if let Some(&count) = inputs.mmr.start_map.get(&measure_index) {
                        layout.multimeasure_rest_count = Some(count);
                        layout.multimeasure_rest_label =
                            inputs.mmr_labels.get(&measure_index).cloned();
                    }
                    layout.part_index = inputs
                        .flat_staves
                        .get(staff_index)
                        .and_then(|flat| flat.sources.first())
                        .map_or(0, |source| source.part_index);
                    // Any measure may open a system, so include the clef and
                    // key restatement ink it would carry there.
                    layout.is_first_on_system = true;
                    layout.show_system_objects = system_object_staves.contains(&staff_index);
                    layout.is_first_staff = staff_index == 0;
                    layout.is_last_staff = staff_index + 1 == staff_count;
                    Some(vec![layout])
                })
                .collect();
            if layouts.len() != staff_count {
                return MeasureInk {
                    core: staff_height,
                    ..MeasureInk::default()
                };
            }
            let view: Vec<Vec<&MeasureLayout>> =
                layouts.iter().map(|staff| staff.iter().collect()).collect();
            let placement = compute_staff_y_offsets_for_system(
                &view,
                inputs.flat_staves,
                inputs.group_ranges,
                0.0,
                7.0 * sp,
                inputs.config.default_intra_staff_clearance * sp,
                sp,
                staff_height,
                inputs.config,
                false,
                inputs.score,
            );
            let (above, below) = outer_extents(
                &layouts,
                inputs.flat_staves,
                &placement.offsets,
                inputs.score,
                inputs.config,
            );
            MeasureInk {
                core: staff_height + placement.offsets.last().copied().unwrap_or(0.0),
                above,
                below,
                opening_above: above,
                opening_below: below,
            }
        })
        .collect()
}

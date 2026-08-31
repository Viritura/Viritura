use super::super::config::LayoutConfig;
use super::super::full_score::{FlatStaff, GroupRange};
use super::super::types::MeasureLayout;
use crate::model::SequenceContent;

/// Result of content-aware staff-Y placement for a single system.
#[derive(Clone)]
pub(super) struct StaffYPlacement {
    pub(super) offsets: Vec<f64>,
    pub(super) pair_debug: Vec<crate::render::StaffPairDebug>,
}

/// Compute per-staff vertical offsets for a system.
///
/// `all_staff_layouts` is `[staff][measure]` as references so stitched-horizon
/// chunks can share one globally computed offset vector without cloning.
#[allow(clippy::too_many_arguments)] // placement boundary: geometry and policy are independent inputs
pub(super) fn compute_staff_y_offsets_for_system(
    all_staff_layouts: &[Vec<&MeasureLayout>],
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
    sys_y_base: f64,
    justified_gap: f64,
    min_clearance: f64,
    sp: f64,
    staff_height: f64,
    config: &LayoutConfig,
    squish_clamp: bool,
) -> StaffYPlacement {
    let mut offsets = Vec::with_capacity(flat_staves.len());
    let mut y = sys_y_base;
    offsets.push(y);
    let mut pair_debug = Vec::new();

    for staff_index in 1..flat_staves.len() {
        let staff_bottom = y + staff_height;
        let mut lowest_above = staff_bottom;
        for &layout in &all_staff_layouts[staff_index - 1] {
            let lowest = super::super::render_annotations::lowest_point_in_measure(
                layout,
                y,
                sp,
                config.stem_length,
            );
            lowest_above = lowest_above.max(lowest);
        }
        let has_dynamics = all_staff_layouts[staff_index - 1].iter().any(|layout| {
            layout
                .resolved
                .part
                .dynamics
                .as_ref()
                .is_some_and(|dynamics| !dynamics.is_empty())
        });
        let has_lyrics = all_staff_layouts[staff_index - 1].iter().any(|layout| {
            layout.resolved.part.sequences.iter().any(|sequence| {
                sequence.content.iter().any(|content| {
                    matches!(content, SequenceContent::Event(event)
                        if event.lyrics.as_ref().is_some_and(|lyrics|
                            lyrics.lines.as_ref().is_some_and(|lines| !lines.is_empty())))
                })
            })
        });
        if has_dynamics {
            lowest_above = lowest_above.max(staff_bottom + 4.5 * sp);
        }
        if has_lyrics {
            lowest_above = lowest_above.max(staff_bottom + 5.0 * sp);
        }

        let mut above_protrusion = 0.0_f64;
        let receives_meter = crate::layout::time_signatures::spanning::staff_receives_meter(
            staff_index,
            group_ranges,
            flat_staves.len(),
            config.time_signature_settings,
        );
        for &layout in &all_staff_layouts[staff_index] {
            let mut highest = super::super::render_annotations::highest_point_in_measure(
                layout,
                0.0,
                sp,
                config.stem_length,
            );
            if receives_meter {
                if let Some((_left, _right, meter_top)) =
                    crate::layout::time_signatures::above_staff_extent(
                        layout,
                        0.0,
                        sp,
                        config.time_signature_settings,
                    )
                {
                    highest = highest.min(meter_top);
                }
            }
            if highest < 0.0 {
                above_protrusion = above_protrusion.max(-highest);
            }
        }

        let content_y = lowest_above + above_protrusion + min_clearance;
        let standard_y = y + staff_height + justified_gap;
        let upper_staff_bottom_y = staff_bottom;
        y = if squish_clamp {
            standard_y
        } else {
            content_y.max(standard_y)
        };
        offsets.push(y);

        if config.emit_layout_debug {
            pair_debug.push(crate::render::StaffPairDebug {
                upper_staff_index: staff_index - 1,
                justified_gap,
                content_gap: (content_y - upper_staff_bottom_y).max(0.0),
                actual_gap: y - upper_staff_bottom_y,
                min_clearance,
                upper_staff_bottom_y,
                lower_staff_top_y: y,
                upper_lowest_y: lowest_above,
                lower_above_protrusion: above_protrusion,
            });
        }
    }

    StaffYPlacement {
        offsets,
        pair_debug,
    }
}

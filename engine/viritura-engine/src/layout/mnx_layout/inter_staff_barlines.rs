//! The barline runs that bridge staves inside a group.
//!
//! A barline drawn only across each staff would read as a row of separate
//! strokes; what makes it one barline is the run continuing through the gaps.
//! Which gaps it crosses is a grouping decision — staves that share a group are
//! barred together, staves that don't are not — so this lives apart from the
//! per-staff barline render, which knows nothing about groups.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::full_score::GroupRange;
use super::super::render_barlines::{render_tagged_barline_connector, BarlineGap, BarlineKind};
use super::super::types::MeasureLayout;
use super::staff_grouping::staves_share_group;
use crate::model::BarlineType;
use crate::render::DisplayList;

/// Render barline connectors between adjacent staves in a multi-staff system:
/// inter-measure connectors at each barline plus the end barline. Connectors
/// only render across staff pairs that share a group (per `staves_share_group`).
#[allow(clippy::too_many_arguments)] // rendering boundary: system geometry, grouping and seam state are independent inputs
pub(super) fn render_inter_staff_barlines(
    dl: &mut DisplayList,
    first_layouts: &[MeasureLayout],
    staff_y_offsets: &[f64],
    group_ranges: &[GroupRange],
    staff_height: f64,
    sp: f64,
    config: &LayoutConfig,
    is_last_system: bool,
    clef_change_measures: &std::collections::HashSet<usize>,
    // Stitched-horizon seam: this chunk is followed by another, so its END
    // boundary barline is drawn by the NEXT chunk's first measure (which is a
    // seam continuation, `is_first_on_system == false`). Suppress this chunk's
    // end connector so the boundary isn't drawn twice — once here at the
    // unshifted edge and once by the next chunk's (possibly clef-shifted)
    // barline. Mirrors the per-staff `suppress_final_barline`.
    suppress_end_connector: bool,
) {
    for (mi_idx, ml) in first_layouts.iter().enumerate() {
        // Skip only a TRUE system start (the left margin has no connector). A
        // stitched-horizon seam continuation has `is_first_on_system == false`
        // even at `mi_idx == 0`; it MUST draw its boundary connector so it lines
        // up with the per-staff barline that the chunk's first measure draws.
        // Keying on `is_first_on_system` (not `mi_idx == 0`) keeps the connector
        // and the per-staff `is_clef_change_measure` condition in lock-step.
        if ml.is_first_on_system {
            continue;
        }
        let has_repeat_start = ml.resolved.global.repeat_start.is_some();
        let connector_bt = if mi_idx == 0 {
            // Seam continuation: no previous measure in THIS chunk. Match the
            // per-staff render, which defaults the boundary to Regular (its
            // `prev_barline_type` is None for the chunk's first measure).
            BarlineKind::at_boundary(false, has_repeat_start, None, BarlineType::Regular)
        } else {
            let prev_ml = &first_layouts[mi_idx - 1];
            BarlineKind::at_boundary(
                prev_ml.resolved.global.repeat_end.is_some(),
                has_repeat_start,
                prev_ml
                    .resolved
                    .global
                    .barline
                    .as_ref()
                    .map(|b| &b.barline_type),
                BarlineType::Regular,
            )
        };
        // Mid-system clef-change measures shift their start barline right by the
        // leading clef gap (see `render_measure_prefix`). The inter-staff
        // connector must shift by the SAME amount or it splits away from the
        // per-staff barline.
        let connector_x = if clef_change_measures.contains(&ml.resolved.index) {
            ml.x + super::super::render_measure::CLEF_CHANGE_LEADING_GAP_SP * sp
        } else {
            ml.x
        };
        connect_gaps(
            dl,
            GapRun {
                x: connector_x,
                staff_y_offsets,
                staff_height,
                group_ranges,
            },
            sp,
            config,
            &connector_bt,
            &element_id::barline(ml.resolved.index),
        );
    }
    // End barline connecting staves (only within groups). Suppressed at a
    // stitched seam — the next chunk's first measure draws this boundary.
    if suppress_end_connector {
        return;
    }
    let Some(last_ml) = first_layouts.last() else {
        return;
    };
    let end_bt = if last_ml.resolved.global.repeat_end.is_some() {
        BarlineKind::RepeatEnd
    } else {
        let fallback = if is_last_system {
            BarlineType::Final
        } else {
            BarlineType::Regular
        };
        BarlineKind::from(
            last_ml
                .resolved
                .global
                .barline
                .as_ref()
                .map(|b| b.barline_type)
                .unwrap_or(fallback),
        )
    };
    connect_gaps(
        dl,
        GapRun {
            x: last_ml.x + last_ml.width,
            staff_y_offsets,
            staff_height,
            group_ranges,
        },
        sp,
        config,
        &end_bt,
        &element_id::barline(last_ml.resolved.index + 1),
    );
}

/// One barline's worth of gaps: every inter-staff space at a single X.
struct GapRun<'a> {
    x: f64,
    staff_y_offsets: &'a [f64],
    staff_height: f64,
    group_ranges: &'a [GroupRange],
}

/// Draw the connector across each gap whose staves are barred together.
fn connect_gaps(
    dl: &mut DisplayList,
    run: GapRun<'_>,
    sp: f64,
    config: &LayoutConfig,
    bt: &BarlineKind,
    element_id: &str,
) {
    for gap_idx in 0..run.staff_y_offsets.len().saturating_sub(1) {
        if !staves_share_group(gap_idx, run.group_ranges) {
            continue;
        }
        render_tagged_barline_connector(
            dl,
            BarlineGap {
                x: run.x,
                y_top: run.staff_y_offsets[gap_idx] + run.staff_height,
                y_bottom: run.staff_y_offsets[gap_idx + 1],
            },
            sp,
            config,
            bt,
            element_id,
        );
    }
}

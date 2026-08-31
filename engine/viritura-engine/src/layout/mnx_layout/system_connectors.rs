//! System-level connectors for the explicit-pages path.
//!
//! Both things drawn here — the barline connectors between staves and, under
//! the spanning style, one time signature per bracket group — need the
//! staves' settled vertical positions, which is why neither can be drawn by
//! the per-staff content pass.

use super::inter_staff_barlines::render_inter_staff_barlines;
use crate::layout::config::LayoutConfig;
use crate::layout::full_score::GroupRange;
use crate::layout::time_signatures::spanning;
use crate::layout::types::MeasureLayout;
use crate::render::{DisplayList, RenderCommand};
use std::collections::HashSet;

/// Draw the vertical line that joins a system's staves at its left edge.
pub(super) fn render_system_start_barline(
    dl: &mut DisplayList,
    staff_y_offsets: &[f64],
    staff_height: f64,
    margin_left: f64,
    barline_w: f64,
) {
    let Some(&system_top) = staff_y_offsets.first() else {
        return;
    };
    let system_bottom = staff_y_offsets.last().copied().unwrap_or(system_top) + staff_height;
    dl.push(RenderCommand::DrawLine {
        x1: margin_left,
        y1: system_top,
        x2: margin_left,
        y2: system_bottom,
        width: barline_w * 1.5,
        color: "#000000".into(),
    });
}

/// Where a system sits within its score, plus the geometry its connectors are
/// measured against.
pub(super) struct SystemConnectorPlacement {
    pub sys_idx: usize,
    pub system_count: usize,
    pub staff_height: f64,
    pub sp: f64,
}

/// Draw one system's connectors: inter-staff barlines, then group meters.
pub(super) fn render_system_connectors(
    dl: &mut DisplayList,
    config: &LayoutConfig,
    all_staff_layouts: &[Vec<MeasureLayout>],
    group_ranges: &[GroupRange],
    staff_y_offsets: &[f64],
    clef_change_measures: &HashSet<usize>,
    placement: SystemConnectorPlacement,
) {
    if let Some(first_layouts) = all_staff_layouts.first() {
        render_inter_staff_barlines(
            dl,
            first_layouts,
            staff_y_offsets,
            group_ranges,
            placement.staff_height,
            placement.sp,
            config,
            placement.sys_idx == placement.system_count - 1,
            clef_change_measures,
            false,
        );
    }

    spanning::render_system_group_meters(
        dl,
        all_staff_layouts,
        group_ranges,
        staff_y_offsets,
        config,
    );
}

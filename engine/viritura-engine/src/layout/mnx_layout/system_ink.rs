//! Final staff ink used by page fitting, including dependent collision flow.

use super::super::config::LayoutConfig;
use super::super::full_score::FlatStaff;
use super::super::page::vertical_ink_extent;
use super::super::render_annotations::substrate_obstacles::text_command_bbox;
use super::super::types::MeasureLayout;
use super::shared::render_system_staff_content;
use crate::model::Score;
use crate::render::{DisplayList, RenderCommand};

pub(super) fn outer_extents(
    layouts: &[Vec<MeasureLayout>],
    staves: &[FlatStaff],
    offsets: &[f64],
    score: &Score,
    config: &LayoutConfig,
) -> (f64, f64) {
    let Some((&first_y, &last_y)) = offsets.first().zip(offsets.last()) else {
        return (0.0, 0.0);
    };
    let ink = render_staff_ink(layouts, staves, offsets, score, config);
    let ink = ink.commands.iter().filter_map(vertical_ink_extent);
    ink.fold((0.0_f64, 0.0_f64), |(above, below), (top, bottom)| {
        (
            above.max(first_y - top),
            below.max(bottom - last_y - 4.0 * config.sp),
        )
    })
}

/// Outer extents credited to each measure of the system: every painted
/// command counts toward all measures its horizontal span overlaps, so ink
/// that only arises across measures (long slurs, hairpins, stacked text)
/// stays attached to the measures it covers when the system is recombined.
pub(super) fn measure_outer_extents(
    layouts: &[Vec<MeasureLayout>],
    staves: &[FlatStaff],
    offsets: &[f64],
    score: &Score,
    config: &LayoutConfig,
) -> Vec<(f64, f64)> {
    let Some(((&first_y, &last_y), top_staff)) =
        offsets.first().zip(offsets.last()).zip(layouts.first())
    else {
        return Vec::new();
    };
    let spans: Vec<(f64, f64)> = top_staff
        .iter()
        .map(|measure| (measure.x, measure.x + measure.width))
        .collect();
    let mut extents = vec![(0.0_f64, 0.0_f64); spans.len()];
    let Some(last_index) = spans.len().checked_sub(1) else {
        return extents;
    };
    let ink = render_staff_ink(layouts, staves, offsets, score, config);
    for command in &ink.commands {
        let Some((top, bottom)) = vertical_ink_extent(command) else {
            continue;
        };
        let (above, below) = (first_y - top, bottom - last_y - 4.0 * config.sp);
        let (left, right) = horizontal_extent(command).unwrap_or((f64::MIN, f64::MAX));
        let mut covered = spans
            .iter()
            .enumerate()
            .filter(|(_, (start, end))| left <= *end && right >= *start)
            .map(|(index, _)| index)
            .peekable();
        // Ink beyond the measure frame (system brace, overhanging text)
        // belongs to the nearest measure.
        let fallback =
            (covered.peek().is_none()).then(|| if right < spans[0].0 { 0 } else { last_index });
        for index in covered.chain(fallback) {
            let extent = &mut extents[index];
            *extent = (extent.0.max(above), extent.1.max(below));
        }
    }
    extents
}

fn horizontal_extent(command: &RenderCommand) -> Option<(f64, f64)> {
    command
        .bbox()
        .or_else(|| text_command_bbox(command))
        .map(|bounds| (bounds.x, bounds.x + bounds.width))
}

fn render_staff_ink(
    layouts: &[Vec<MeasureLayout>],
    staves: &[FlatStaff],
    offsets: &[f64],
    score: &Score,
    config: &LayoutConfig,
) -> DisplayList {
    let clef_changes = super::super::render_measure::clef_change_measure_set_from_layouts(layouts);
    let mut scratch = DisplayList::new(0.0, 0.0);
    let mut accidentals = Vec::new();
    for staff in 0..layouts.len() {
        render_system_staff_content(
            &mut scratch,
            layouts,
            staves,
            None,
            offsets,
            score,
            None,
            config.sp,
            config,
            0,
            2,
            false,
            0,
            &clef_changes,
            None,
            staff,
            &mut accidentals,
        );
    }
    scratch
}

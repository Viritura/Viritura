//! Staff-line state and rendering.

use super::render_barlines::rhythmic_content_width;
use super::types::MeasureLayout;
use crate::model::{PartMeasure, PositionedStaffConfig};
use crate::render::DisplayList;

pub(super) const DEFAULT_STAFF_LINES: u32 = 5;

pub(super) fn configs_for_staff(
    measure: &PartMeasure,
    staff_number: Option<u32>,
) -> Option<Vec<PositionedStaffConfig>> {
    let staff_number = staff_number.unwrap_or(1);
    let configs: Vec<_> = measure
        .staff_configs
        .as_deref()?
        .iter()
        .filter(|config| config.staff.unwrap_or(1) == staff_number)
        .cloned()
        .collect();
    (!configs.is_empty()).then_some(configs)
}

#[derive(Clone, Copy)]
struct StaffLineRun {
    x1: f64,
    x2: f64,
    lines: u32,
}

#[derive(Clone, Copy)]
struct HorizontalLineRun {
    x1: f64,
    x2: f64,
    y: f64,
}

/// Resolve the line count at the start of one measure and advance `active_lines`
/// to the count in force after every positioned change in that measure.
pub(super) fn resolve_measure_staff_lines(
    active_lines: &mut u32,
    configs: Option<&[PositionedStaffConfig]>,
) -> u32 {
    let Some(configs) = configs else {
        return *active_lines;
    };
    let changes = ordered_line_changes(configs);
    for (_, lines) in changes.iter().copied().take_while(|(beat, _)| *beat <= 0.0) {
        *active_lines = lines;
    }
    let start_lines = *active_lines;
    for (_, lines) in changes.into_iter().skip_while(|(beat, _)| *beat <= 0.0) {
        *active_lines = lines;
    }
    start_lines
}

/// Draw one staff as the minimum set of continuous horizontal runs needed for
/// its effective line-count changes.
pub(super) fn render_staff_lines(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    margin_left: f64,
    sp: f64,
    line_width: f64,
) {
    let Some(first) = measure_layouts.first() else {
        return;
    };
    let x_end = measure_layouts
        .last()
        .map_or(margin_left, |layout| layout.x + layout.width);
    let mut runs = Vec::new();
    let mut active_lines = first.resolved.active_staff_lines;
    let mut run_start = margin_left;

    for layout in measure_layouts {
        if active_lines != layout.resolved.active_staff_lines {
            push_run(&mut runs, run_start, layout.x, active_lines);
            run_start = layout.x;
            active_lines = layout.resolved.active_staff_lines;
        }

        for (beat, lines) in ordered_line_changes(
            layout
                .resolved
                .part
                .staff_configs
                .as_deref()
                .unwrap_or_default(),
        )
        .into_iter()
        .filter(|(beat, _)| *beat > 0.0)
        {
            if lines == active_lines {
                continue;
            }
            let change_x =
                rhythmic_position_x(layout, beat, sp).clamp(layout.x, layout.x + layout.width);
            push_run(&mut runs, run_start, change_x, active_lines);
            run_start = change_x;
            active_lines = lines;
        }
    }
    push_run(&mut runs, run_start, x_end, active_lines);

    let mut horizontal_runs = Vec::new();
    for run in runs {
        append_horizontal_runs(&mut horizontal_runs, run, staff_y, sp);
    }
    horizontal_runs.sort_by(|left, right| {
        left.y
            .total_cmp(&right.y)
            .then_with(|| left.x1.total_cmp(&right.x1))
    });
    let mut coalesced: Vec<HorizontalLineRun> = Vec::new();
    for run in horizontal_runs {
        if let Some(previous) = coalesced.last_mut() {
            if (previous.y - run.y).abs() < 0.001 && (previous.x2 - run.x1).abs() < 0.001 {
                previous.x2 = run.x2;
                continue;
            }
        }
        coalesced.push(run);
    }
    for run in coalesced {
        dl.staff_line(run.x1, run.x2, run.y, line_width);
    }
}

pub(super) fn render_staff_line_run(
    dl: &mut DisplayList,
    x1: f64,
    x2: f64,
    staff_y: f64,
    lines: u32,
    sp: f64,
    line_width: f64,
) {
    if lines == 0 || x2 <= x1 {
        return;
    }
    let middle_y = staff_y + 2.0 * sp;
    let first_offset = -0.5 * f64::from(lines.saturating_sub(1));
    for line in 0..lines {
        let y = middle_y + (first_offset + f64::from(line)) * sp;
        dl.staff_line(x1, x2, y, line_width);
    }
}

fn ordered_line_changes(configs: &[PositionedStaffConfig]) -> Vec<(f64, u32)> {
    let mut changes: Vec<_> = configs
        .iter()
        .map(|positioned| {
            (
                positioned.position.as_ref().map_or(0.0, |p| p.beats()),
                positioned.config.lines.unwrap_or(DEFAULT_STAFF_LINES),
            )
        })
        .collect();
    changes.sort_by(|left, right| left.0.total_cmp(&right.0));
    changes
}

fn rhythmic_position_x(layout: &MeasureLayout, target_beat: f64, sp: f64) -> f64 {
    let total_beats = layout.resolved.active_time.measure_beats();
    let x_origin = layout.x + layout.prefix_width;
    let content_width = rhythmic_content_width(layout, sp);
    if total_beats <= f64::EPSILON {
        return x_origin;
    }
    let proportional_x = x_origin + (target_beat / total_beats) * content_width;
    let mut best_x = proportional_x;
    let mut best_dist = 0.1;

    for voice in &layout.voice_layouts {
        if voice.is_centered_bar_rest(total_beats) {
            continue;
        }
        for event_index in 0..voice.events.len() {
            let distance = (voice.events.beat_position(event_index) - target_beat).abs();
            if distance < best_dist {
                best_dist = distance;
                best_x = voice.events.x(event_index);
            }
        }
    }
    best_x
}

fn push_run(runs: &mut Vec<StaffLineRun>, x1: f64, x2: f64, lines: u32) {
    if x2 <= x1 {
        return;
    }
    if let Some(previous) = runs.last_mut() {
        if previous.lines == lines && (previous.x2 - x1).abs() < 0.001 {
            previous.x2 = x2;
            return;
        }
    }
    runs.push(StaffLineRun { x1, x2, lines });
}

fn append_horizontal_runs(
    runs: &mut Vec<HorizontalLineRun>,
    config_run: StaffLineRun,
    staff_y: f64,
    sp: f64,
) {
    if config_run.lines == 0 || config_run.x2 <= config_run.x1 {
        return;
    }
    let middle_y = staff_y + 2.0 * sp;
    let first_offset = -0.5 * f64::from(config_run.lines.saturating_sub(1));
    for line in 0..config_run.lines {
        runs.push(HorizontalLineRun {
            x1: config_run.x1,
            x2: config_run.x2,
            y: middle_y + (first_offset + f64::from(line)) * sp,
        });
    }
}

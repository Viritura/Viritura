//! A source-free display staff: one continuous row, with gaps around its labels.

use super::*;

#[allow(clippy::too_many_arguments)] // Display staff placement consumes the owning staff's ink and labels.
pub(super) fn place(
    dl: &mut DisplayList,
    command_start: usize,
    config: &LayoutConfig,
    layouts: &[MeasureLayout],
    staff_y: f64,
    ids: &[String],
    labels: &[StackBox],
    row_y: Option<f64>,
    location_key: Option<&str>,
) {
    let Some((first, last)) = layouts.first().zip(layouts.last()) else {
        return;
    };
    let sp = config.sp;
    let metrics = config.placement.resolve(ElementKind::MeasureNumber);
    let above = config.bar_numbers.placement == Some(BarNumberPlacement::AboveSystem);
    let side = if above {
        StackSide::Above
    } else {
        StackSide::Below
    };
    let height = labels
        .iter()
        .map(|label| label.y_bottom - label.y_top)
        .fold(super::bar_number_style(config).size_sp * sp, f64::max);
    let distance = config.bar_numbers.distance.unwrap_or(metrics.attach_gap) * sp;
    let center = row_y.unwrap_or_else(|| {
        if above {
            labels
                .iter()
                .map(|label| label.y_bottom)
                .fold(staff_y - distance, f64::min)
                - height * 0.5
        } else {
            labels
                .iter()
                .map(|label| label.y_top)
                .fold(staff_y + 4.0 * sp + distance, f64::max)
                + height * 0.5
        }
    });
    let left = first.x;
    let right = last.x + last.width;
    // Standard engraving practice: the entire number staff is one row of ink.
    // Its labels cannot move independently and leave a stepped staff line.
    let mut field = vec![StackBox {
        x0: labels.iter().map(|label| label.x0).fold(left, f64::min),
        x1: labels.iter().map(|label| label.x1).fold(right, f64::max),
        y_top: center - height * 0.5,
        y_bottom: center + height * 0.5,
        stack_gap: metrics.padding.vertical * sp,
        side_bearing: metrics.padding.horizontal * sp,
        stack_rank: metrics.stack_rank,
        side,
        pinned: false,
    }];
    super::append_obstacles(dl, command_start, side, &mut field);
    let center = center + resolve_stacking(&field)[0];
    for (id, label) in ids.iter().zip(labels) {
        let dy = center - (label.y_top + label.y_bottom) * 0.5;
        super::super::shift_marking(dl, command_start, id, -dy);
    }
    let padding = 0.4 * sp;
    let mut gaps: Vec<_> = labels
        .iter()
        .map(|label| (label.x0 - padding, label.x1 + padding))
        .collect();
    gaps.sort_by(|a, b| a.0.total_cmp(&b.0));
    let eid = match location_key {
        Some(key) => format!("m{}/{key}/bar-number-staff", first.resolved.index),
        None => format!("m{}/bar-number-staff", first.resolved.index),
    };
    let mut cursor = left;
    for (start, end) in gaps.into_iter().chain(std::iter::once((right, right))) {
        let end_of_line = start.min(right);
        if end_of_line > cursor && config.bar_numbers.show_staff_line != Some(false) {
            dl.push_tagged(
                RenderCommand::DrawLine {
                    x1: cursor,
                    y1: center,
                    x2: end_of_line,
                    y2: center,
                    width: config.staff_line_width * sp,
                    color: "#000000".into(),
                },
                eid.clone(),
            );
        }
        cursor = cursor.max(end);
    }
    dl.push_element_bbox_with_shape(ElementBBox {
        element_id: eid,
        bbox: BoundingBox::new(left, center - height * 0.5, right - left, height),
    });
}

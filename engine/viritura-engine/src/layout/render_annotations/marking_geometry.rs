use super::substrate_obstacles;
use crate::layout::{element_id, types::MeasureLayout};
use crate::render::*;

pub(super) fn framed_expression_is_pinned(measures: &[MeasureLayout], eid: &str) -> bool {
    measures.iter().any(|ml| {
        ml.resolved
            .part
            .expressions
            .as_ref()
            .is_some_and(|expressions| {
                expressions.iter().enumerate().any(|(index, expression)| {
                    expression.frame.is_some()
                        && expression.avoid_collisions == Some(false)
                        && element_id::expression(
                            expression.source_part_index.unwrap_or(ml.part_index),
                            ml.resolved.index,
                            expression.source_expression_index.unwrap_or(index),
                        ) == eid
                })
            })
    })
}

pub(super) fn marking_extent(
    dl: &DisplayList,
    staff_cmd_start: usize,
    eid: &str,
) -> Option<(f64, f64, f64, f64)> {
    let ink = command_extent(dl, staff_cmd_start, eid)?;
    let center = ((ink.0 + ink.1) * 0.5, (ink.2 + ink.3) * 0.5);
    if let Some(index) = nearest_shape(dl, eid, center) {
        let shape = &dl.element_shapes[index];
        if shape.authored_bounds {
            let bbox = shape.bbox(&dl.commands)?;
            return Some((
                ink.0.min(bbox.x),
                ink.1.max(bbox.x + bbox.width),
                ink.2.min(bbox.y),
                ink.3.max(bbox.y + bbox.height),
            ));
        }
    }
    Some(ink)
}

fn command_extent(
    dl: &DisplayList,
    staff_cmd_start: usize,
    eid: &str,
) -> Option<(f64, f64, f64, f64)> {
    let mut left = f64::INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut top = f64::INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    for idx in staff_cmd_start..dl.commands.len() {
        if dl.element_ids.get(idx).and_then(Option::as_deref) != Some(eid) {
            continue;
        }
        let bbox = match &dl.commands[idx] {
            command @ RenderCommand::DrawText { .. } => {
                substrate_obstacles::text_command_bbox(command)?
            }
            command => command.bbox()?,
        };
        left = left.min(bbox.x);
        right = right.max(bbox.x + bbox.width);
        top = top.min(bbox.y);
        bottom = bottom.max(bbox.y + bbox.height);
    }
    (left.is_finite() && right.is_finite()).then_some((left, right, top, bottom))
}

pub(in crate::layout) fn publish_marking_geometry(
    dl: &mut DisplayList,
    staff_cmd_start: usize,
    eid: &str,
    kind: ElementKind,
) {
    let Some((left, right, top, bottom)) = marking_extent(dl, staff_cmd_start, eid) else {
        return;
    };
    dl.push_element_bbox_with_shape(ElementBBox {
        element_id: eid.to_string(),
        bbox: BoundingBox::new(left, top, right - left, bottom - top),
    });
    if let Some(shape) = dl.element_shapes.last_mut() {
        shape.kind = kind;
    }
}

pub(super) fn sync_marking_geometry(dl: &mut DisplayList, staff_cmd_start: usize, eid: &str) {
    let Some((left, right, top, bottom)) = marking_extent(dl, staff_cmd_start, eid) else {
        return;
    };
    let bbox = BoundingBox::new(left, top, right - left, bottom - top);
    let center = (bbox.x + bbox.width * 0.5, bbox.y + bbox.height * 0.5);
    if nearest_shape(dl, eid, center).is_some_and(|index| dl.element_shapes[index].authored_bounds)
    {
        return;
    }
    if let Some(index) = nearest_bbox(dl, eid, center) {
        dl.element_bboxes[index].bbox = bbox.clone();
    }
    if let Some(index) = nearest_shape(dl, eid, center) {
        dl.element_shapes[index].geom = ShapeGeom::Rect { bbox };
    }
}

pub(super) fn translate_authored_bounds(
    dl: &mut DisplayList,
    staff_cmd_start: usize,
    eid: &str,
    dx: f64,
    dy: f64,
) {
    let Some((left, right, top, bottom)) = command_extent(dl, staff_cmd_start, eid) else {
        return;
    };
    let center = ((left + right) * 0.5, (top + bottom) * 0.5);
    let Some(index) = nearest_shape(dl, eid, center) else {
        return;
    };
    if !dl.element_shapes[index].authored_bounds {
        return;
    }
    let Some(mut bbox) = dl.element_shapes[index].bbox(&dl.commands) else {
        return;
    };
    let bbox_index = nearest_bbox(dl, eid, center);
    bbox.x += dx;
    bbox.y += dy;
    if let Some(index) = bbox_index {
        dl.element_bboxes[index].bbox = bbox.clone();
    }
    dl.element_shapes[index].geom = ShapeGeom::Rect { bbox };
}

fn nearest_bbox(dl: &DisplayList, eid: &str, center: (f64, f64)) -> Option<usize> {
    dl.element_bboxes
        .iter()
        .enumerate()
        .filter(|(_, bbox)| bbox.element_id == eid)
        .min_by(|(_, left), (_, right)| {
            distance(&left.bbox, center).total_cmp(&distance(&right.bbox, center))
        })
        .map(|(index, _)| index)
}

fn nearest_shape(dl: &DisplayList, eid: &str, center: (f64, f64)) -> Option<usize> {
    dl.element_shapes
        .iter()
        .enumerate()
        .filter(|(_, shape)| shape.element_id == eid)
        .filter_map(|(index, shape)| Some((index, distance(&shape.bbox(&dl.commands)?, center))))
        .min_by(|(_, left), (_, right)| left.total_cmp(right))
        .map(|(index, _)| index)
}

fn distance(bbox: &BoundingBox, center: (f64, f64)) -> f64 {
    let dx = bbox.x + bbox.width * 0.5 - center.0;
    let dy = bbox.y + bbox.height * 0.5 - center.1;
    dx * dx + dy * dy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authored_frame_bounds_survive_vertical_and_horizontal_dependent_flow() {
        let mut dl = DisplayList::new(800.0, 600.0);
        let eid = "p0/m0/expr0";
        dl.push(RenderCommand::DrawText {
            x: 100.0,
            y: 65.0,
            text: "short".into(),
            font: "serif".into(),
            size: 10.0,
            color: "#000000".into(),
            align: TextAlign::Left,
            baseline: TextBaseline::Alphabetic,
        });
        dl.tag_command(0, eid.into());
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: eid.into(),
            bbox: BoundingBox::new(90.0, 40.0, 120.0, 40.0),
        });
        dl.element_shapes[0].authored_bounds = true;
        assert_eq!(marking_extent(&dl, 0, eid), Some((90.0, 210.0, 40.0, 80.0)));
        super::super::shift_marking(&mut dl, 0, eid, 7.0);
        super::super::shift_marking_x(&mut dl, 0, eid, 3.0);
        let bbox = &dl.element_bboxes[0].bbox;
        assert_eq!(
            (bbox.x, bbox.y, bbox.width, bbox.height),
            (93.0, 33.0, 120.0, 40.0)
        );
        let shape = dl.element_shapes[0].bbox(&dl.commands).unwrap();
        assert_eq!(
            (shape.x, shape.y, shape.width, shape.height),
            (93.0, 33.0, 120.0, 40.0)
        );
        assert_eq!(marking_extent(&dl, 0, eid), Some((93.0, 213.0, 33.0, 73.0)));
    }
}

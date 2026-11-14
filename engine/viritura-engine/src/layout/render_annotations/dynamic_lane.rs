use super::{collect_gated_boxes, marking_extent, shift_marking};
use crate::layout::config::LayoutConfig;
use crate::layout::dependent_stacking::{resolve_stacking, StackBox, StackSide};
use crate::render::{BoundingBox, DisplayList, ElementKind, RenderCommand};
use std::collections::HashMap;

pub(in crate::layout) struct DynamicLane<'a> {
    pub left: f64,
    pub right: f64,
    pub y: f64,
    pub opening: f64,
    pub above: bool,
    pub staff_y: f64,
    pub dynamics: &'a HashMap<String, f64>,
}

pub(in crate::layout) fn placed_dynamic_midline(
    dl: &DisplayList,
    command_start: usize,
    element_id: &str,
    sp: f64,
) -> Option<f64> {
    dl.commands
        .iter()
        .enumerate()
        .skip(command_start)
        .find_map(|(index, command)| match command {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if (0xE520..=0xE54F).contains(codepoint)
                    && dl.element_ids.get(index).and_then(Option::as_deref) == Some(element_id) =>
            {
                Some(y - 0.5 * sp)
            }
            _ => None,
        })
}

pub(in crate::layout) fn clear_tuplet_lane(
    dl: &mut DisplayList,
    command_start: usize,
    lane: DynamicLane<'_>,
    config: &LayoutConfig,
) -> (f64, bool) {
    let mut bounds = BoundingBox::new(
        lane.left.min(lane.right),
        lane.y - lane.opening,
        (lane.right - lane.left).abs(),
        lane.opening * 2.0,
    );
    for (id, midline) in lane.dynamics {
        if let Some((left, right, top, bottom)) = marking_extent(dl, command_start, id) {
            bounds = bounds.union(&BoundingBox::new(
                left,
                top + lane.y - midline,
                right - left,
                bottom - top,
            ));
        }
    }
    let side = if lane.above {
        StackSide::Above
    } else {
        StackSide::Below
    };
    let metrics = config.placement.resolve(ElementKind::Dynamic);
    let mut boxes = vec![StackBox {
        x0: bounds.x,
        x1: bounds.x + bounds.width,
        y_top: bounds.y,
        y_bottom: bounds.y + bounds.height,
        stack_gap: metrics.padding.vertical * config.sp,
        side_bearing: metrics.padding.horizontal * config.sp,
        stack_rank: metrics.stack_rank,
        side,
        pinned: false,
    }];
    for tuplet in collect_gated_boxes(dl, command_start, "/tuplet") {
        if ((tuplet.top + tuplet.bottom) * 0.5 < lane.staff_y + 2.0 * config.sp) != lane.above {
            continue;
        }
        boxes.push(StackBox {
            x0: tuplet.left,
            x1: tuplet.right,
            y_top: tuplet.top,
            y_bottom: tuplet.bottom,
            stack_gap: 0.0,
            side_bearing: 0.0,
            stack_rank: 0,
            side,
            pinned: true,
        });
    }
    if boxes.len() == 1 {
        return (lane.y, false);
    }
    let dy = resolve_stacking(&boxes)[0];
    let y = lane.y + dy;
    let mut moved = false;
    for (id, midline) in lane.dynamics {
        if (midline - y).abs() > 1e-6 {
            shift_marking(dl, command_start, id, midline - y);
            moved = true;
        }
    }
    (y, moved)
}

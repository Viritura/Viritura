use super::participation::EventRenderInfo;
use super::EndpointArticulationRelation;
use crate::render::{BoundingBox, DisplayList, RenderCommand, ShapeGeom, SlurGeometry};

const CLEARANCE_SP: f64 = 0.3;
const SAMPLES: usize = 64;

/// Move automatic outside-endpoint dependent stacks against the final slur
/// contour. Fermatas are always outside; inside articulations and interior
/// marks remain slur obstacles.
pub(super) fn resolve_outside_boundary_dependents(
    display_list: &mut DisplayList,
    source: &EventRenderInfo,
    target: &EventRenderInfo,
    sp: f64,
) {
    let Some(geometry) = display_list.slur_geometries.last().cloned() else {
        return;
    };
    for event in [source, target] {
        resolve_endpoint(display_list, event, &geometry, sp);
    }
}

fn resolve_endpoint(
    display_list: &mut DisplayList,
    event: &EventRenderInfo,
    geometry: &SlurGeometry,
    sp: f64,
) {
    let mut element_ids = event.fermata_element_ids.clone();
    if event.endpoint_articulation_relation == Some(EndpointArticulationRelation::Outside) {
        element_ids.extend(event.articulation_element_ids.iter().cloned());
    }
    if element_ids.is_empty() {
        return;
    }
    let Some(bbox) = current_dependent_bbox(display_list, &element_ids) else {
        return;
    };
    let note_top = event.eff_staff_y + event.y_pos * sp * 0.5;
    let note_bottom = event.eff_staff_y + event.y_pos_bottom * sp * 0.5;
    let center = bbox.y + bbox.height * 0.5;
    let on_curve_side = if geometry.curve_dir < 0.0 {
        center < note_top
    } else {
        center > note_bottom
    };
    if !on_curve_side {
        return;
    }
    let Some(edge) = outer_edge_over_span(geometry, bbox.x, bbox.x + bbox.width) else {
        return;
    };
    let displacement = if geometry.curve_dir < 0.0 {
        (edge - CLEARANCE_SP * sp - (bbox.y + bbox.height)).min(0.0)
    } else {
        (edge + CLEARANCE_SP * sp - bbox.y).max(0.0)
    };
    if displacement.abs() > f64::EPSILON {
        shift_dependent_stack(display_list, &element_ids, displacement);
    }
    sync_fermata_geometry(display_list, &event.fermata_element_ids);
}

fn current_dependent_bbox(
    display_list: &DisplayList,
    element_ids: &[String],
) -> Option<BoundingBox> {
    let command_bbox = display_list
        .commands
        .iter()
        .enumerate()
        .filter(|(index, _)| {
            display_list
                .element_ids
                .get(*index)
                .and_then(Option::as_ref)
                .is_some_and(|id| element_ids.iter().any(|candidate| candidate == id))
        })
        .filter_map(|(_, command)| command.bbox())
        .reduce(|left, right| left.union(&right));
    command_bbox.or_else(|| {
        display_list
            .element_shapes
            .iter()
            .filter(|shape| element_ids.iter().any(|id| id == &shape.element_id))
            .filter_map(|shape| shape.bbox(&display_list.commands))
            .reduce(|left, right| left.union(&right))
    })
}

fn outer_edge_over_span(geometry: &SlurGeometry, x_min: f64, x_max: f64) -> Option<f64> {
    let mut edge: Option<f64> = None;
    for sample in 0..=SAMPLES {
        let t = sample as f64 / SAMPLES as f64;
        let mt = 1.0 - t;
        let x = mt.powi(3) * geometry.p0_x
            + 3.0 * mt.powi(2) * t * geometry.p1_x
            + 3.0 * mt * t.powi(2) * geometry.p2_x
            + t.powi(3) * geometry.p3_x;
        if x < x_min || x > x_max {
            continue;
        }
        let spine_y = mt.powi(3) * geometry.p0_y
            + 3.0 * mt.powi(2) * t * geometry.p1_y
            + 3.0 * mt * t.powi(2) * geometry.p2_y
            + t.powi(3) * geometry.p3_y;
        let outer = spine_y + geometry.curve_dir * geometry.thickness * 0.5;
        edge = Some(match edge {
            Some(current) if geometry.curve_dir < 0.0 => current.min(outer),
            Some(current) => current.max(outer),
            None => outer,
        });
    }
    edge
}

fn shift_dependent_stack(
    display_list: &mut DisplayList,
    element_ids: &[String],
    displacement: f64,
) {
    for (index, command) in display_list.commands.iter_mut().enumerate() {
        let Some(element_id) = display_list.element_ids.get(index).and_then(Option::as_ref) else {
            continue;
        };
        if !element_ids.iter().any(|id| id == element_id) {
            continue;
        }
        if let RenderCommand::DrawGlyph { y, .. } = command {
            *y += displacement;
        }
    }
    for bbox in &mut display_list.element_bboxes {
        if element_ids.iter().any(|id| id == &bbox.element_id) {
            bbox.bbox.y += displacement;
        }
    }
    for shape in &mut display_list.element_shapes {
        if !element_ids.iter().any(|id| id == &shape.element_id) {
            continue;
        }
        match &mut shape.geom {
            ShapeGeom::Rect { bbox } => bbox.y += displacement,
            ShapeGeom::Band { samples } => {
                for (_, top, bottom) in samples {
                    *top += displacement;
                    *bottom += displacement;
                }
            }
            ShapeGeom::Cmd { .. } => {}
        }
    }
}

fn sync_fermata_geometry(display_list: &mut DisplayList, element_ids: &[String]) {
    let command_bbox = display_list
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let id = display_list
                .element_ids
                .get(index)
                .and_then(Option::as_ref)?;
            (id.ends_with("/ferm") && element_ids.iter().any(|candidate| candidate == id))
                .then(|| command.bbox())
                .flatten()
        });
    let Some(command_bbox) = command_bbox else {
        return;
    };
    for bbox in &mut display_list.element_bboxes {
        if bbox.element_id.ends_with("/fermata")
            && element_ids.iter().any(|id| id == &bbox.element_id)
        {
            bbox.bbox = command_bbox.clone();
        }
    }
    for shape in &mut display_list.element_shapes {
        if shape.element_id.ends_with("/fermata")
            && element_ids.iter().any(|id| id == &shape.element_id)
        {
            shape.geom = ShapeGeom::Rect {
                bbox: command_bbox.clone(),
            };
        }
    }
}

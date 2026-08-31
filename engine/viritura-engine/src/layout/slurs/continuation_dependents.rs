use crate::render::{DisplayList, FieldRole, ShapeGeom, SlurGeometry};
use std::collections::HashMap;

/// Append a retained continuation overlay and re-run the outward-only
/// dependent solve against the newly appended connector geometries.
pub(crate) fn append_cross_system_overlay(
    display_list: &mut DisplayList,
    overlay: DisplayList,
    sp: f64,
) {
    let dependent_shape_end = display_list.element_shapes.len();
    let slur_geometry_start = display_list.slur_geometries.len();
    display_list.append(overlay);
    resolve_cross_system_slur_dependents(
        display_list,
        dependent_shape_end,
        slur_geometry_start,
        sp,
    );
}

fn cubic_coordinate(values: [f64; 4], t: f64) -> f64 {
    let mt = 1.0 - t;
    mt * mt * mt * values[0]
        + 3.0 * mt * mt * t * values[1]
        + 3.0 * mt * t * t * values[2]
        + t * t * t * values[3]
}

fn slur_y_near_x(geometry: &SlurGeometry, x: f64) -> f64 {
    let mut best_y = geometry.p0_y;
    let mut best_distance = (geometry.p0_x - x).abs();
    for index in 1..=24 {
        let t = index as f64 / 24.0;
        let sample_x = cubic_coordinate(
            [geometry.p0_x, geometry.p1_x, geometry.p2_x, geometry.p3_x],
            t,
        );
        let distance = (sample_x - x).abs();
        if distance < best_distance {
            best_distance = distance;
            best_y = cubic_coordinate(
                [geometry.p0_y, geometry.p1_y, geometry.p2_y, geometry.p3_y],
                t,
            );
        }
    }
    best_y
}

/// Finalize dependent placement after the global connector pass. The bounded
/// pass moves only intersecting dependents and only outward.
pub(crate) fn resolve_cross_system_slur_dependents(
    display_list: &mut DisplayList,
    dependent_shape_end: usize,
    slur_geometry_start: usize,
    sp: f64,
) {
    let geometries: Vec<_> = display_list
        .slur_geometries
        .iter()
        .skip(slur_geometry_start)
        .cloned()
        .collect();
    if geometries.is_empty() {
        return;
    }

    let mut shifts = HashMap::new();
    for shape in display_list.element_shapes.iter().take(dependent_shape_end) {
        if shape.kind.field_role() != Some(FieldRole::Dependent) || shape.element_id.is_empty() {
            continue;
        }
        let Some(bbox) = shape.bbox(&display_list.commands) else {
            continue;
        };
        let center_x = bbox.x + bbox.width * 0.5;
        let mut shift: f64 = 0.0;
        for slur in &geometries {
            let x_lo = slur.p0_x.min(slur.p3_x);
            let x_hi = slur.p0_x.max(slur.p3_x);
            if bbox.x + bbox.width <= x_lo || bbox.x >= x_hi {
                continue;
            }
            let curve_y = slur_y_near_x(slur, center_x.clamp(x_lo, x_hi));
            let clearance = slur.thickness * 0.5 + 0.35 * sp;
            if slur.curve_dir < 0.0 {
                let desired_bottom = curve_y - clearance;
                if bbox.y + shift < curve_y && bbox.y + bbox.height + shift > desired_bottom {
                    shift = shift.min(desired_bottom - bbox.y - bbox.height);
                }
            } else {
                let desired_top = curve_y + clearance;
                if bbox.y + bbox.height + shift > curve_y && bbox.y + shift < desired_top {
                    shift = shift.max(desired_top - bbox.y);
                }
            }
        }
        if shift.abs() > 0.001 {
            shifts
                .entry(shape.element_id.clone())
                .and_modify(|existing: &mut f64| {
                    *existing = if shift < 0.0 {
                        existing.min(shift)
                    } else {
                        existing.max(shift)
                    };
                })
                .or_insert(shift);
        }
    }

    for (element_id, dy) in shifts {
        translate_dependent(display_list, dependent_shape_end, &element_id, dy);
    }
}

fn translate_dependent(
    display_list: &mut DisplayList,
    dependent_shape_end: usize,
    element_id: &str,
    dy: f64,
) {
    for (command_index, tagged_id) in display_list.element_ids.iter().enumerate() {
        if tagged_id.as_deref() == Some(element_id) {
            if let Some(command) = display_list.commands.get_mut(command_index) {
                command.translate_in_place(0.0, dy);
            }
        }
    }
    for bbox in &mut display_list.element_bboxes {
        if bbox.element_id == element_id {
            bbox.bbox.y += dy;
        }
    }
    let shape_end = dependent_shape_end.min(display_list.element_shapes.len());
    for shape in &mut display_list.element_shapes[..shape_end] {
        if shape.element_id != element_id {
            continue;
        }
        match &mut shape.geom {
            ShapeGeom::Rect { bbox } => bbox.y += dy,
            ShapeGeom::Band { samples } => {
                for sample in samples {
                    sample.1 += dy;
                    sample.2 += dy;
                }
            }
            ShapeGeom::Cmd { .. } => {}
        }
    }
}

use super::obstacle_shapes::TupletObstacle;
use super::scorer::SlurShapeInput;
use super::tuning;
use crate::render::{BoundingBox, DisplayList, ElementKind, ShapeGeom, SlurGeometry};
use std::collections::BTreeMap;

const MAX_CLEARANCE_STEPS: usize = 80;
const CLEARANCE_STEP_SP: f64 = 0.1;

pub(super) fn apply_enclosing_tuplet_clearance(
    mut shoulder: f64,
    apex_shift: f64,
    input: &SlurShapeInput<'_>,
    tuplets: &[TupletObstacle],
) -> f64 {
    if input.has_manual_shape {
        return shoulder;
    }
    let (left, right) = (input.x1.min(input.x2), input.x1.max(input.x2));
    let clearance = tuning::ENCOMPASS_CLEARANCE_SP * input.sp;
    let applicable: Vec<_> = tuplets
        .iter()
        .filter(|tuplet| {
            left <= tuplet.left
                && right >= tuplet.right
                && same_side(
                    **tuplet,
                    input.x1,
                    input.y1,
                    input.x2,
                    input.y2,
                    input.curve_dir,
                )
        })
        .collect();
    if applicable.is_empty() {
        return shoulder;
    }

    for _ in 0..MAX_CLEARANCE_STEPS {
        let spine = candidate_spine(
            input.x1,
            input.y1,
            input.x2,
            input.y2,
            input.curve_dir,
            input.cp_indent,
            shoulder,
            apex_shift,
        );
        let clears_all = applicable.iter().all(|tuplet| {
            let y = y_at_x(&spine, (tuplet.left + tuplet.right) * 0.5);
            if input.curve_dir < 0.0 {
                y <= tuplet.top - clearance
            } else {
                y >= tuplet.bottom + clearance
            }
        });
        if clears_all {
            break;
        }
        shoulder += CLEARANCE_STEP_SP * input.sp;
    }
    shoulder
}

/// Move a tuplet number/bracket outward when an overlapping slur does not
/// enclose it. The complementary case is handled above by reshaping the outer
/// slur; when the tuplet is the outer span, the slur stays close to the notes
/// and the tuplet moves instead.
pub(super) fn flow_tuplets_over_inner_slurs(
    dl: &mut DisplayList,
    staff_shape_start: usize,
    slur_geometry_start: usize,
    staff_y: f64,
    sp: f64,
) {
    let slurs = dl.slur_geometries[slur_geometry_start.min(dl.slur_geometries.len())..].to_vec();
    if slurs.is_empty() {
        return;
    }

    let mut tuplets: BTreeMap<String, BoundingBox> = BTreeMap::new();
    for shape in dl.element_shapes.iter().skip(staff_shape_start) {
        if !matches!(shape.kind, ElementKind::Tuplet) {
            continue;
        }
        let Some(bbox) = shape.bbox(&dl.commands) else {
            continue;
        };
        tuplets
            .entry(shape.element_id.clone())
            .and_modify(|current| *current = current.union(&bbox))
            .or_insert(bbox);
    }

    let clearance = tuning::ENCOMPASS_CLEARANCE_SP * sp;
    let staff_middle = staff_y + 2.0 * sp;
    let shifts: Vec<_> = tuplets
        .into_iter()
        .filter_map(|(element_id, bbox)| {
            let above = bbox.y + bbox.height * 0.5 < staff_middle;
            let mut shift_y: f64 = 0.0;
            for slur in &slurs {
                if above != (slur.curve_dir < 0.0) {
                    continue;
                }
                let slur_left = slur.p0_x.min(slur.p3_x);
                let slur_right = slur.p0_x.max(slur.p3_x);
                let tuplet_right = bbox.x + bbox.width;
                let overlap_left = bbox.x.max(slur_left);
                let overlap_right = tuplet_right.min(slur_right);
                if overlap_left >= overlap_right {
                    continue;
                }
                if slur_left <= bbox.x && slur_right >= tuplet_right {
                    continue;
                }
                let Some((slur_top, slur_bottom)) =
                    slur_band_over_span(slur, overlap_left, overlap_right)
                else {
                    continue;
                };
                if slur_bottom < bbox.y - clearance || slur_top > bbox.y + bbox.height + clearance {
                    continue;
                }
                if above {
                    shift_y = shift_y.min(slur_top - clearance - (bbox.y + bbox.height));
                } else {
                    shift_y = shift_y.max(slur_bottom + clearance - bbox.y);
                }
            }
            (shift_y.abs() > 1e-6).then_some((element_id, shift_y))
        })
        .collect();

    for (element_id, shift_y) in shifts {
        translate_tuplet(dl, &element_id, shift_y);
    }
}

fn slur_band_over_span(slur: &SlurGeometry, left: f64, right: f64) -> Option<(f64, f64)> {
    let mut top = f64::INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    for step in 0..=64 {
        let t = step as f64 / 64.0;
        let mt = 1.0 - t;
        let x = mt * mt * mt * slur.p0_x
            + 3.0 * mt * mt * t * slur.p1_x
            + 3.0 * mt * t * t * slur.p2_x
            + t * t * t * slur.p3_x;
        if x < left || x > right {
            continue;
        }
        let y = mt * mt * mt * slur.p0_y
            + 3.0 * mt * mt * t * slur.p1_y
            + 3.0 * mt * t * t * slur.p2_y
            + t * t * t * slur.p3_y;
        top = top.min(y - slur.thickness * 0.5);
        bottom = bottom.max(y + slur.thickness * 0.5);
    }
    top.is_finite().then_some((top, bottom))
}

fn translate_tuplet(dl: &mut DisplayList, element_id: &str, shift_y: f64) {
    for (index, command) in dl.commands.iter_mut().enumerate() {
        if dl.element_ids.get(index).and_then(Option::as_deref) == Some(element_id) {
            command.translate_in_place(0.0, shift_y);
        }
    }
    for element_bbox in &mut dl.element_bboxes {
        if element_bbox.element_id == element_id {
            element_bbox.bbox.y += shift_y;
        }
    }
    for shape in &mut dl.element_shapes {
        if shape.element_id != element_id {
            continue;
        }
        match &mut shape.geom {
            ShapeGeom::Cmd { .. } => {}
            ShapeGeom::Rect { bbox } => bbox.y += shift_y,
            ShapeGeom::Band { samples } => {
                for (_, top, bottom) in samples {
                    *top += shift_y;
                    *bottom += shift_y;
                }
            }
        }
    }
}

fn same_side(tuplet: TupletObstacle, x1: f64, y1: f64, x2: f64, y2: f64, curve_dir: f64) -> bool {
    let center_x = (tuplet.left + tuplet.right) * 0.5;
    let chord_y = if (x2 - x1).abs() < 0.01 {
        (y1 + y2) * 0.5
    } else {
        y1 + (y2 - y1) * (center_x - x1) / (x2 - x1)
    };
    let center_y = (tuplet.top + tuplet.bottom) * 0.5;
    if curve_dir < 0.0 {
        center_y < chord_y
    } else {
        center_y > chord_y
    }
}

#[allow(clippy::too_many_arguments)] // Cubic construction uses the complete candidate geometry.
fn candidate_spine(
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    curve_dir: f64,
    cp_indent: f64,
    shoulder: f64,
    apex_shift: f64,
) -> [(f64, f64); 4] {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let chord_len = dx.hypot(dy).max(0.01);
    let ux = dx / chord_len;
    let uy = dy / chord_len;
    let px = -uy * curve_dir;
    let py = ux * curve_dir;
    let max_shift = (0.5 - cp_indent - 0.02).max(0.0);
    let shift = apex_shift.clamp(-max_shift, max_shift);
    let f1 = cp_indent + shift;
    let f2 = 1.0 - cp_indent + shift;
    [
        (x1, y1),
        (
            x1 + ux * chord_len * f1 + px * shoulder,
            y1 + uy * chord_len * f1 + py * shoulder,
        ),
        (
            x1 + ux * chord_len * f2 + px * shoulder,
            y1 + uy * chord_len * f2 + py * shoulder,
        ),
        (x2, y2),
    ]
}

fn y_at_x(spine: &[(f64, f64); 4], target_x: f64) -> f64 {
    let mut best = spine[0];
    let mut best_distance = (best.0 - target_x).abs();
    for step in 1..=64 {
        let t = step as f64 / 64.0;
        let point = cubic_point(spine, t);
        let distance = (point.0 - target_x).abs();
        if distance < best_distance {
            best = point;
            best_distance = distance;
        }
    }
    best.1
}

fn cubic_point(spine: &[(f64, f64); 4], t: f64) -> (f64, f64) {
    let mt = 1.0 - t;
    let weights = (mt * mt * mt, 3.0 * mt * mt * t, 3.0 * mt * t * t, t * t * t);
    (
        weights.0 * spine[0].0
            + weights.1 * spine[1].0
            + weights.2 * spine[2].0
            + weights.3 * spine[3].0,
        weights.0 * spine[0].1
            + weights.1 * spine[1].1
            + weights.2 * spine[2].1
            + weights.3 * spine[3].1,
    )
}

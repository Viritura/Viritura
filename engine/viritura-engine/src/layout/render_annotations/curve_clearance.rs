use super::super::element_id;
use super::super::types::*;
use super::dynamics::{dynamic_note_center_x, dynamic_places_above};
use crate::model::ExpressionPlacement;
use crate::render::smufl::smufl;
use crate::render::*;

/// Topmost (smallest-y) point of a slur's **upper** contour over the
/// horizontal span `[x_lo, x_hi]`, or `None` if the slur doesn't overlap the
/// span. The spine cubic is sampled densely; the upper edge is the spine minus
/// half the crescent thickness. Only meaningful for slurs that arch above the
/// chord (`curve_dir < 0`).
pub(super) fn slur_upper_edge_over_span(g: &SlurGeometry, x_lo: f64, x_hi: f64) -> Option<f64> {
    const SAMPLES: usize = 64;
    let mut top: Option<f64> = None;
    for i in 0..=SAMPLES {
        let t = i as f64 / SAMPLES as f64;
        let mt = 1.0 - t;
        // Cubic Bézier evaluation (spine endpoints + control points).
        let x = mt * mt * mt * g.p0_x
            + 3.0 * mt * mt * t * g.p1_x
            + 3.0 * mt * t * t * g.p2_x
            + t * t * t * g.p3_x;
        if x < x_lo || x > x_hi {
            continue;
        }
        let y = mt * mt * mt * g.p0_y
            + 3.0 * mt * mt * t * g.p1_y
            + 3.0 * mt * t * t * g.p2_y
            + t * t * t * g.p3_y;
        let upper = y - g.thickness * 0.5;
        top = Some(top.map_or(upper, |cur| cur.min(upper)));
    }
    top
}

/// Topmost (smallest-y) point of a cubic Bézier's outer contour over the
/// horizontal span `[x_lo, x_hi]`, or `None` if it doesn't overlap. Ties render
/// as [`RenderCommand::DrawFilledBezier`] crescents (not [`SlurGeometry`]), so
/// their above-arching obstacle is the *outer* contour — `(x1,y1)`, the two
/// outer control points, `(x2,y2)`. Only call for ties that arch above (outer
/// control point sits above the endpoints).
fn tie_upper_edge_over_span(
    p0: (f64, f64),
    c1: (f64, f64),
    c2: (f64, f64),
    p3: (f64, f64),
    x_lo: f64,
    x_hi: f64,
) -> Option<f64> {
    const SAMPLES: usize = 64;
    let mut top: Option<f64> = None;
    for i in 0..=SAMPLES {
        let t = i as f64 / SAMPLES as f64;
        let mt = 1.0 - t;
        let x = mt * mt * mt * p0.0
            + 3.0 * mt * mt * t * c1.0
            + 3.0 * mt * t * t * c2.0
            + t * t * t * p3.0;
        if x < x_lo || x > x_hi {
            continue;
        }

        let y = mt * mt * mt * p0.1
            + 3.0 * mt * mt * t * c1.1
            + 3.0 * mt * t * t * c2.1
            + t * t * t * p3.1;
        top = Some(top.map_or(y, |cur| cur.min(y)));
    }
    top
}

pub(crate) fn tie_lower_edge_over_span(
    p0: (f64, f64),
    c1: (f64, f64),
    c2: (f64, f64),
    p3: (f64, f64),
    x_lo: f64,
    x_hi: f64,
) -> Option<f64> {
    const SAMPLES: usize = 64;
    let mut bottom: Option<f64> = None;
    for i in 0..=SAMPLES {
        let t = i as f64 / SAMPLES as f64;
        let mt = 1.0 - t;
        let x = mt * mt * mt * p0.0
            + 3.0 * mt * mt * t * c1.0
            + 3.0 * mt * t * t * c2.0
            + t * t * t * p3.0;
        if x < x_lo || x > x_hi {
            continue;
        }
        let y = mt * mt * mt * p0.1
            + 3.0 * mt * mt * t * c1.1
            + 3.0 * mt * t * t * c2.1
            + t * t * t * p3.1;
        bottom = Some(bottom.map_or(y, |current| current.max(y)));
    }
    bottom
}

/// Smallest-y (highest) edge over `[x_lo, x_hi]` among the above-arching ties
/// rendered in `dl.commands[cmd_start..]`. Ties are `DrawFilledBezier` commands
/// tagged with a `tie/…` element id; a tie arches above when its outer control
/// point sits above its endpoints (`ocy1 < y1`). Returns `None` when no such
/// tie overlaps the span. Mirrors the slur obstacle scan so above-staff text
/// (tempo, expressions) clears ties as well as slurs.
pub(crate) fn highest_tie_edge_over_span(
    dl: &DisplayList,
    cmd_start: usize,
    x_lo: f64,
    x_hi: f64,
) -> Option<f64> {
    let mut top: Option<f64> = None;
    for idx in cmd_start..dl.commands.len() {
        let is_tie = dl
            .element_ids
            .get(idx)
            .and_then(|o| o.as_ref())
            .is_some_and(|id| id.starts_with("tie/"));
        if !is_tie {
            continue;
        }

        let RenderCommand::DrawFilledBezier {
            x1,
            y1,
            x2,
            y2,
            ocx1,
            ocy1,
            ocx2,
            ocy2,
            ..
        } = &dl.commands[idx]
        else {
            continue;
        };
        // Only ties arching above the chord are an obstacle for above-staff text.
        if *ocy1 >= *y1 {
            continue;
        }
        let (sx0, sx1) = (x1.min(*x2), x1.max(*x2));
        if sx1 < x_lo || sx0 > x_hi {
            continue;
        }
        if let Some(edge) = tie_upper_edge_over_span(
            (*x1, *y1),
            (*ocx1, *ocy1),
            (*ocx2, *ocy2),
            (*x2, *y2),
            x_lo,
            x_hi,
        ) {
            top = Some(top.map_or(edge, |cur| cur.min(edge)));
        }
    }
    top
}

pub(crate) fn lowest_tie_edge_over_span(
    dl: &DisplayList,
    cmd_start: usize,
    x_lo: f64,
    x_hi: f64,
) -> Option<f64> {
    let mut bottom: Option<f64> = None;
    for idx in cmd_start..dl.commands.len() {
        let is_tie = dl
            .element_ids
            .get(idx)
            .and_then(|id| id.as_ref())
            .is_some_and(|id| id.starts_with("tie/"));
        if !is_tie {
            continue;
        }
        let RenderCommand::DrawFilledBezier {
            x1,
            y1,
            x2,
            y2,
            ocx1,
            ocy1,
            ocx2,
            ocy2,
            ..
        } = &dl.commands[idx]
        else {
            continue;
        };
        if *ocy1 <= *y1 {
            continue;
        }
        let (sx0, sx1) = (x1.min(*x2), x1.max(*x2));
        if sx1 < x_lo || sx0 > x_hi {
            continue;
        }
        if let Some(edge) = tie_lower_edge_over_span(
            (*x1, *y1),
            (*ocx1, *ocy1),
            (*ocx2, *ocy2),
            (*x2, *y2),
            x_lo,
            x_hi,
        ) {
            bottom = Some(bottom.map_or(edge, |current| current.max(edge)));
        }
    }
    bottom
}

fn tie_ink_edge_over_span(
    dl: &DisplayList,
    cmd_start: usize,
    x_lo: f64,
    x_hi: f64,
    highest: bool,
) -> Option<f64> {
    let mut edge: Option<f64> = None;
    for idx in cmd_start..dl.commands.len() {
        if !dl
            .element_ids
            .get(idx)
            .and_then(|id| id.as_ref())
            .is_some_and(|id| id.starts_with("tie/"))
        {
            continue;
        }
        let RenderCommand::DrawFilledBezier {
            x1,
            y1,
            x2,
            y2,
            ocx1,
            ocy1,
            ocx2,
            ocy2,
            ..
        } = &dl.commands[idx]
        else {
            continue;
        };
        let curve = [(*x1, *y1), (*ocx1, *ocy1), (*ocx2, *ocy2), (*x2, *y2)];
        let tie_edge = if highest {
            tie_upper_edge_over_span(curve[0], curve[1], curve[2], curve[3], x_lo, x_hi)
        } else {
            tie_lower_edge_over_span(curve[0], curve[1], curve[2], curve[3], x_lo, x_hi)
        };
        if let Some(tie_edge) = tie_edge {
            edge = Some(match edge {
                Some(current) if highest => current.min(tie_edge),
                Some(current) => current.max(tie_edge),
                None => tie_edge,
            });
        }
    }
    edge
}

/// Lowest (largest-Y) edge of a single slur's lower contour over `[x_lo, x_hi]`.
fn slur_lower_edge_over_span(g: &SlurGeometry, x_lo: f64, x_hi: f64) -> Option<f64> {
    const SAMPLES: usize = 64;
    let mut bottom: Option<f64> = None;
    for i in 0..=SAMPLES {
        let t = i as f64 / SAMPLES as f64;
        let mt = 1.0 - t;
        let x = mt * mt * mt * g.p0_x
            + 3.0 * mt * mt * t * g.p1_x
            + 3.0 * mt * t * t * g.p2_x
            + t * t * t * g.p3_x;
        if x < x_lo || x > x_hi {
            continue;
        }
        let y = mt * mt * mt * g.p0_y
            + 3.0 * mt * mt * t * g.p1_y
            + 3.0 * mt * t * t * g.p2_y
            + t * t * t * g.p3_y;
        let lower = y + g.thickness * 0.5;
        bottom = Some(bottom.map_or(lower, |cur| cur.max(lower)));
    }
    bottom
}

/// Lowest edge among all below-arching slurs that overlap `[x_lo, x_hi]`.
/// Used to keep below-staff dynamics and hairpins clear of slurs.
pub(crate) fn lowest_slur_edge_below(slurs: &[SlurGeometry], x_lo: f64, x_hi: f64) -> Option<f64> {
    let mut lowest: Option<f64> = None;
    for g in slurs {
        let (sx0, sx1) = (g.p0_x.min(g.p3_x), g.p0_x.max(g.p3_x));
        if sx1 < x_lo || sx0 > x_hi {
            continue;
        }

        if let Some(edge) = slur_lower_edge_over_span(g, x_lo, x_hi) {
            lowest = Some(lowest.map_or(edge, |cur| cur.max(edge)));
        }
    }
    lowest
}

/// Highest edge among all above-arching slurs overlapping `[x_lo, x_hi]`.
pub(crate) fn highest_slur_edge_above(slurs: &[SlurGeometry], x_lo: f64, x_hi: f64) -> Option<f64> {
    let mut highest: Option<f64> = None;
    for geometry in slurs {
        let (sx0, sx1) = (
            geometry.p0_x.min(geometry.p3_x),
            geometry.p0_x.max(geometry.p3_x),
        );
        if sx1 < x_lo || sx0 > x_hi {
            continue;
        }
        if let Some(edge) = slur_upper_edge_over_span(geometry, x_lo, x_hi) {
            highest = Some(highest.map_or(edge, |current| current.min(edge)));
        }
    }
    highest
}

/// Move fermatas outward only when their ink overlaps a curve on their side of
/// the staff. Fermatas are horizontally attached to their event before ties and
/// slurs are known, so this post-pass preserves that anchor and changes only the
/// vertical coordinate once the curve ink is available.
pub(crate) fn push_fermatas_clear_of_curves(
    dl: &mut DisplayList,
    staff_cmd_start: usize,
    slur_geom_start: usize,
    sp: f64,
) {
    let slurs: Vec<SlurGeometry> = dl.slur_geometries[slur_geom_start..].to_vec();
    let fermatas: Vec<(usize, BoundingBox, bool)> = (staff_cmd_start..dl.commands.len())
        .filter_map(|idx| {
            let RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } = &dl.commands[idx]
            else {
                return None;
            };
            let is_below = matches!(
                *codepoint,
                smufl::FERMATA_BELOW
                    | smufl::FERMATA_VERY_SHORT_BELOW
                    | smufl::FERMATA_SHORT_BELOW
                    | smufl::FERMATA_LONG_BELOW
                    | smufl::FERMATA_VERY_LONG_BELOW
                    | smufl::FERMATA_LONG_HENZE_BELOW
                    | smufl::FERMATA_SHORT_HENZE_BELOW
            );
            let is_fermata = is_below
                || matches!(
                    *codepoint,
                    smufl::FERMATA_ABOVE
                        | smufl::FERMATA_VERY_SHORT_ABOVE
                        | smufl::FERMATA_SHORT_ABOVE
                        | smufl::FERMATA_LONG_ABOVE
                        | smufl::FERMATA_VERY_LONG_ABOVE
                        | smufl::FERMATA_LONG_HENZE_ABOVE
                        | smufl::FERMATA_SHORT_HENZE_ABOVE
                );
            if !is_fermata {
                return None;
            }
            let scale = *size / 4.0;
            let (bbox_x, bbox_y, bbox_w, bbox_h) = smufl::glyph_bbox(*codepoint);
            Some((
                idx,
                BoundingBox::new(
                    *x + bbox_x * scale,
                    *y + bbox_y * scale,
                    bbox_w * scale,
                    bbox_h * scale,
                ),
                is_below,
            ))
        })
        .collect();

    for (idx, bbox, is_below) in fermatas {
        let left = bbox.x;
        let right = bbox.x + bbox.width;
        let clearance = 0.3 * sp;

        if !is_below {
            let slur_edge = slurs
                .iter()
                .filter_map(|slur| slur_upper_edge_over_span(slur, left, right))
                .min_by(f64::total_cmp);
            let tie_edge = tie_ink_edge_over_span(dl, staff_cmd_start, left, right, true);
            let edge = match (slur_edge, tie_edge) {
                (Some(slur), Some(tie)) => Some(slur.min(tie)),
                (Some(slur), None) => Some(slur),
                (None, Some(tie)) => Some(tie),
                (None, None) => None,
            };
            let Some(edge) = edge else {
                continue;
            };
            let lift = (bbox.y + bbox.height - (edge - clearance)).max(0.0);
            shift_fermata(dl, idx, &bbox, lift);
        } else {
            let slur_edge = slurs
                .iter()
                .filter_map(|slur| slur_lower_edge_over_span(slur, left, right))
                .max_by(f64::total_cmp);
            let tie_edge = tie_ink_edge_over_span(dl, staff_cmd_start, left, right, false);
            let edge = match (slur_edge, tie_edge) {
                (Some(slur), Some(tie)) => Some(slur.max(tie)),
                (Some(slur), None) => Some(slur),
                (None, Some(tie)) => Some(tie),
                (None, None) => None,
            };
            let Some(edge) = edge else {
                continue;
            };
            let drop = (edge + clearance - bbox.y).max(0.0);
            shift_fermata(dl, idx, &bbox, -drop);
        }
    }
}

fn shift_fermata(dl: &mut DisplayList, command_idx: usize, original: &BoundingBox, dy: f64) {
    if dy == 0.0 {
        return;
    }
    if let Some(RenderCommand::DrawGlyph { y, .. }) = dl.commands.get_mut(command_idx) {
        *y -= dy;
    }
    for element_bbox in &mut dl.element_bboxes {
        if element_bbox.element_id.ends_with("/fermata")
            && element_bbox.bbox.x == original.x
            && element_bbox.bbox.y == original.y
            && element_bbox.bbox.width == original.width
            && element_bbox.bbox.height == original.height
        {
            element_bbox.bbox.y -= dy;
        }
    }
    for shape in &mut dl.element_shapes {
        if shape.element_id.ends_with("/fermata") {
            if let crate::render::ShapeGeom::Rect { bbox } = &mut shape.geom {
                if bbox.x == original.x
                    && bbox.y == original.y
                    && bbox.width == original.width
                    && bbox.height == original.height
                {
                    bbox.y -= dy;
                }
            }
        }
    }
}

/// Push below-staff dynamic glyphs down so they clear any slur that arches
/// below the staff over their span.
///
/// Runs as a post-pass *after* slurs are rendered, mirroring
/// [`flow_above_staff_dependents`]: dynamics are emitted earlier (during
/// per-measure rendering) before slur geometry exists, so the dynamic is first
/// placed against notes/stems/articulations and then nudged down here if a slur
/// arcs into it. Hairpins (rendered afterwards) re-derive the dynamic's optical
/// midline with the same slur edge, so a pinned wedge tracks the moved glyph.
pub(crate) fn push_below_dynamics_under_slurs(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    slur_geom_start: usize,
) {
    if dl.slur_geometries.len() <= slur_geom_start {
        return;
    }
    let slurs: Vec<SlurGeometry> = dl.slur_geometries[slur_geom_start..]
        .iter()
        .filter(|g| g.curve_dir > 0.0) // only slurs arching below the chord
        .cloned()
        .collect();
    if slurs.is_empty() {
        return;
    }
    let staff_bottom = staff_y + 4.0 * sp;
    let glyph_ascent = 1.78 * sp;
    let clearance = 0.5 * sp;

    for ml in measure_layouts {
        let dynamics = match &ml.resolved.part.dynamics {
            Some(d) if !d.is_empty() => d,
            _ => continue,
        };
        let total_beats = ml.resolved.active_time.measure_beats();
        let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
        let x_origin = ml.x + ml.prefix_width;
        let pi = ml.part_index;
        let mi = ml.resolved.index;

        for dyn_mark in dynamics {
            if dynamic_places_above(ml, dyn_mark) {
                continue; // only below-staff dynamics clear below-arching slurs
            }
            let beat = dyn_mark.position.beats();
            if dyn_mark.is_gradual() {
                continue;
            }
            let value = dyn_mark.display_value();
            let optical_center = smufl::dynamics_optical_center(&value) * sp;
            let note_center_x =
                dynamic_note_center_x(ml, dyn_mark, beat, sp, x_origin, content_width, total_beats);
            let dyn_x = note_center_x - optical_center;
            let dyn_w = smufl::dynamics_glyph_width(&value) * sp;
            let Some(edge) = lowest_slur_edge_below(&slurs, dyn_x, dyn_x + dyn_w) else {
                continue;
            };
            let required = (edge + clearance + glyph_ascent).max(staff_bottom);

            let eid =
                element_id::dynamic(dyn_mark.source_part_index.unwrap_or(pi), mi, &dyn_mark.id);
            let current_y = dl.commands.iter().enumerate().find_map(|(idx, c)| {
                if dl.element_ids.get(idx).and_then(|o| o.as_ref()) == Some(&eid) {
                    if let RenderCommand::DrawGlyph { y, .. } = c {
                        return Some(*y);
                    }
                }
                None
            });
            let Some(current_y) = current_y else {
                continue;
            };
            if current_y >= required {
                continue;
            }
            let dy = required - current_y;
            for idx in 0..dl.commands.len() {
                if dl.element_ids.get(idx).and_then(|o| o.as_ref()) == Some(&eid) {
                    match &mut dl.commands[idx] {
                        RenderCommand::DrawGlyph { y, .. } | RenderCommand::DrawText { y, .. } => {
                            *y += dy
                        }
                        _ => {}
                    }
                }
            }
            for eb in dl.element_bboxes.iter_mut() {
                if eb.element_id == eid {
                    eb.bbox.y += dy;
                }
            }
            for shape in dl.element_shapes.iter_mut() {
                if shape.element_id == eid {
                    if let crate::render::ShapeGeom::Rect { bbox } = &mut shape.geom {
                        bbox.y += dy;
                    }
                }
            }
            if let Some(expressions) = ml.resolved.part.expressions.as_ref() {
                for (index, expression) in expressions.iter().enumerate() {
                    if matches!(expression.placement, Some(ExpressionPlacement::Above))
                        || (expression.position.beats() - beat).abs() >= 0.01
                    {
                        continue;
                    }
                    let expression_id = element_id::expression(
                        expression.source_part_index.unwrap_or(pi),
                        mi,
                        expression.source_expression_index.unwrap_or(index),
                    );
                    shift_marking_down(dl, &expression_id, dy);
                }
            }
        }
    }
}

fn shift_marking_down(dl: &mut DisplayList, eid: &str, dy: f64) {
    for (index, command) in dl.commands.iter_mut().enumerate() {
        if dl.element_ids.get(index).and_then(|id| id.as_deref()) != Some(eid) {
            continue;
        }
        if let RenderCommand::DrawText { y, .. } | RenderCommand::DrawGlyph { y, .. } = command {
            *y += dy;
        }
    }
    for bbox in &mut dl.element_bboxes {
        if bbox.element_id == eid {
            bbox.bbox.y += dy;
        }
    }
    for shape in &mut dl.element_shapes {
        if shape.element_id == eid {
            if let crate::render::ShapeGeom::Rect { bbox } = &mut shape.geom {
                bbox.y += dy;
            }
        }
    }
}

//! Shared curve computation for ties and slurs.
//!
//! Both ties and slurs are rendered as filled crescent shapes (two cubic bezier
//! contours). This module extracts the common geometry so that ties and slurs
//! share the same rendering pipeline, differing only in parameters.

use crate::render::*;

/// Sample a cubic bezier spine into a thin vertical band: `~12` columns of
/// `(x, y_top, y_bottom)`, with half-`thickness` applied symmetrically about
/// the spine. Columns are returned sorted by ascending X (the cubic is
/// X-monotone for ordinary slur/tie geometry; we sort defensively regardless).
/// Used to register `ShapeGeom::Band` geometry so skyline/collision queries see
/// the local arc height at each X rather than the pessimistic bounding box.
pub(crate) fn sample_cubic_band(
    p0: (f64, f64),
    p1: (f64, f64),
    p2: (f64, f64),
    p3: (f64, f64),
    thickness: f64,
) -> Vec<(f64, f64, f64)> {
    const N: usize = 12;
    let half = thickness * 0.5;
    let mut out: Vec<(f64, f64, f64)> = Vec::with_capacity(N + 1);
    for i in 0..=N {
        let t = i as f64 / N as f64;
        let mt = 1.0 - t;
        let b = mt * mt * mt;
        let c = 3.0 * mt * mt * t;
        let d = 3.0 * mt * t * t;
        let e = t * t * t;
        let x = b * p0.0 + c * p1.0 + d * p2.0 + e * p3.0;
        let y = b * p0.1 + c * p1.1 + d * p2.1 + e * p3.1;
        out.push((x, y - half, y + half));
    }
    out.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Sampled-band geometry for a filled-bezier curve (tie), derived from the same
/// midline control points `compute_filled_bezier` uses, so the collision band
/// tracks the rendered crescent. Returns `(x, y_top, y_bottom)` columns.
pub(crate) fn filled_bezier_band(p: &FilledBezierParams) -> Vec<(f64, f64, f64)> {
    use std::f64::consts::PI;
    // Midline control points — identical derivation to `compute_filled_bezier`.
    let dx = p.x2 - p.x1;
    let dy = p.y2 - p.y1;
    let chord_len = (dx * dx + dy * dy).sqrt().max(0.01);
    let ux = dx / chord_len;
    let uy = dy / chord_len;
    let px = -uy * p.curve_dir;
    let py = ux * p.curve_dir;
    let w = chord_len / p.sp;
    let x_param = w * p.rise_rate / p.height_inf;
    let h_ss = p.height_inf * (2.0 / PI) * (PI * x_param / 2.0).atan();
    let curve_height = h_ss * p.sp;
    let cp1 = (
        p.x1 + ux * chord_len * p.cp_indent + px * curve_height,
        p.y1 + uy * chord_len * p.cp_indent + py * curve_height,
    );
    let cp2 = (
        p.x1 + ux * chord_len * (1.0 - p.cp_indent) + px * curve_height,
        p.y1 + uy * chord_len * (1.0 - p.cp_indent) + py * curve_height,
    );
    sample_cubic_band((p.x1, p.y1), cp1, cp2, (p.x2, p.y2), p.thickness)
}

/// Parameters for computing a filled bezier curve (crescent shape).
///
/// Used by both ties and slurs — the difference is in the parameter values:
/// - Ties: lower height asymptote, wider control-point indent, thinner
/// - Slurs: higher height asymptote, steeper departure, thicker
pub(crate) struct FilledBezierParams {
    /// Left endpoint X
    pub x1: f64,
    /// Left endpoint Y
    pub y1: f64,
    /// Right endpoint X
    pub x2: f64,
    /// Right endpoint Y
    pub y2: f64,
    /// Curve direction: 1.0 = below (positive Y), -1.0 = above (negative Y)
    pub curve_dir: f64,
    /// Height asymptote in staff spaces.
    /// Short curves grow linearly; long curves approach this limit.
    pub height_inf: f64,
    /// Rise-rate ratio. Controls how quickly height grows.
    pub rise_rate: f64,
    /// Control-point indent as fraction of chord length (0.0–0.5).
    /// Smaller = steeper departure from endpoint. Larger = rounder arc.
    pub cp_indent: f64,
    /// Base midpoint thickness in pixels (already scaled by sp).
    pub thickness: f64,
    /// Minimum thickness in pixels for short curves (already scaled by sp).
    #[allow(dead_code)]
    pub min_thickness: f64,
    /// Tapered tip thickness in pixels (already scaled by sp). Shares the
    /// slur value by default so both connectors are cut by the same graver.
    pub endpoint_thickness: f64,
    /// Staff space in pixels.
    pub sp: f64,
    /// Line style: 0=solid, 1=dashed, 2=dotted. Default 0.
    pub line_style: u8,
}

/// Compute a filled bezier render command from curve parameters.
///
/// Uses the asymptotic height formula:
///   h = h_inf · (2/π) · atan(π · w · r₀ / (2 · h_inf))
///
/// Thickness is applied perpendicular to the chord direction and scales
/// down for short curves (< 4 sp), producing natural tapering.
pub(crate) fn compute_filled_bezier(p: &FilledBezierParams) -> RenderCommand {
    use std::f64::consts::PI;
    // Chord vector and perpendicular
    let dx = p.x2 - p.x1;
    let dy = p.y2 - p.y1;
    let chord_len = (dx * dx + dy * dy).sqrt().max(0.01);
    let ux = dx / chord_len;
    let uy = dy / chord_len;
    // Perpendicular unit vector pointing in curve direction
    let px = -uy * p.curve_dir;
    let py = ux * p.curve_dir;

    // Asymptotic height formula
    let w = chord_len / p.sp;
    let x_param = w * p.rise_rate / p.height_inf;
    let h_ss = p.height_inf * (2.0 / PI) * (PI * x_param / 2.0).atan();
    let curve_height = h_ss * p.sp;

    // Control-point centers (midline of the crescent)
    let cp1_x = p.x1 + ux * chord_len * p.cp_indent + px * curve_height;
    let cp1_y = p.y1 + uy * chord_len * p.cp_indent + py * curve_height;
    let cp2_x = p.x1 + ux * chord_len * (1.0 - p.cp_indent) + px * curve_height;
    let cp2_y = p.y1 + uy * chord_len * (1.0 - p.cp_indent) + py * curve_height;

    // Thickness: constant for all curve lengths
    let mid_thick = p.thickness;

    engrave_stroke(
        &StrokeSpine {
            x1: p.x1,
            y1: p.y1,
            cp1_x,
            cp1_y,
            cp2_x,
            cp2_y,
            x2: p.x2,
            y2: p.y2,
            curve_dir: p.curve_dir,
        },
        mid_thick,
        p.endpoint_thickness,
        p.line_style,
    )
}
/// The midline path a curve's engraving tool travels: two endpoints and the
/// two control points of the *centre* of the crescent, plus which side of the
/// chord the curve bulges toward.
///
/// Ties and slurs are the same physical stroke — a graver cutting a crescent
/// into the plate — and differ only in how that path is chosen. Ties derive it
/// from the asymptotic height formula; slurs derive it from shoulder height,
/// apex shift and collision avoidance. Everything downstream of the path (the
/// swelling to full weight at the middle and the tapered tips) is identical,
/// and lives in `engrave_stroke` so the two can never drift apart.
pub(crate) struct StrokeSpine {
    pub(crate) x1: f64,
    pub(crate) y1: f64,
    pub(crate) cp1_x: f64,
    pub(crate) cp1_y: f64,
    pub(crate) cp2_x: f64,
    pub(crate) cp2_y: f64,
    pub(crate) x2: f64,
    pub(crate) y2: f64,
    /// +1 curves below the staff, -1 above.
    pub(crate) curve_dir: f64,
}

/// Cut one crescent stroke along `spine`, swelling to `mid_thickness` at the
/// middle and tapering to `tip_thickness` at each end.
///
/// The tips are displaced perpendicular to the **local tangent** at each
/// endpoint rather than to the chord, so the cap reads as a clean slanted tip
/// instead of a vertical cut. For a horizontal chord this reduces to
/// perpendicular-to-chord; for a tie between equal pitches the curve still
/// departs vertically (cp.y != y), so the cap correctly tilts toward
/// horizontal.
pub(crate) fn engrave_stroke(
    spine: &StrokeSpine,
    mid_thickness: f64,
    tip_thickness: f64,
    line_style: u8,
) -> RenderCommand {
    let dx = spine.x2 - spine.x1;
    let dy = spine.y2 - spine.y1;
    let chord_len = (dx * dx + dy * dy).sqrt().max(0.01);
    // Perpendicular to the chord, pointing the way the curve bulges.
    let px = -(dy / chord_len) * spine.curve_dir;
    let py = (dx / chord_len) * spine.curve_dir;

    let half_t = mid_thickness * 0.5;
    // Outer contour sits farther from the staff, inner contour closer.
    //
    // Both contours are displaced along the same perpendicular, so on a
    // sloped stroke the displacement has a horizontal component that pushes
    // one end's control point outward while pulling the other's inward. Past
    // an endpoint the contour reverses direction and the tapered tip renders
    // as a pinch, so hold every control point within the endpoints' span.
    let (span_lo, span_hi) = if spine.x1 < spine.x2 {
        (spine.x1, spine.x2)
    } else {
        (spine.x2, spine.x1)
    };
    let hold = |x: f64| x.clamp(span_lo, span_hi);
    let ocx1 = hold(spine.cp1_x + px * half_t);
    let ocy1 = spine.cp1_y + py * half_t;
    let ocx2 = hold(spine.cp2_x + px * half_t);
    let ocy2 = spine.cp2_y + py * half_t;
    let icx1 = hold(spine.cp1_x - px * half_t);
    let icy1 = spine.cp1_y - py * half_t;
    let icx2 = hold(spine.cp2_x - px * half_t);
    let icy2 = spine.cp2_y - py * half_t;

    let tip = tip_thickness.clamp(0.001, mid_thickness);
    // Tips step inward along the same axis the contours use for their width.
    //
    // Deriving a tip's direction from the local tangent instead looks more
    // faithful, but it has no defined answer when the curve leaves its
    // endpoint along the bulge direction: the local perpendicular is then
    // square to the width axis, so it says nothing about which side is
    // inward, and the tip lands along the stroke rather than across it — a
    // forward spike that the rounded cap then extends. Sharing the contours'
    // axis has no such degenerate case, and at a tenth of a staff space the
    // difference from the local perpendicular is invisible.
    let (ix1, iy1) = (spine.x1 - px * tip, spine.y1 - py * tip);
    let (ix2, iy2) = (spine.x2 - px * tip, spine.y2 - py * tip);

    RenderCommand::DrawFilledBezier {
        x1: spine.x1,
        y1: spine.y1,
        x2: spine.x2,
        y2: spine.y2,
        ocx1,
        ocy1,
        ocx2,
        ocy2,
        icx1,
        icy1,
        icx2,
        icy2,
        ix1,
        iy1,
        ix2,
        iy2,
        color: "#000000".into(),
        line_style,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_horizontal_curve_symmetric() {
        let p = FilledBezierParams {
            x1: 10.0,
            y1: 50.0,
            x2: 70.0,
            y2: 50.0,
            curve_dir: 1.0,
            height_inf: 1.5,
            rise_rate: 0.25,
            cp_indent: 0.20,
            thickness: 3.0,
            min_thickness: 1.0,
            endpoint_thickness: 1.0,
            sp: 12.0,
            line_style: 0,
        };
        let cmd = compute_filled_bezier(&p);
        if let RenderCommand::DrawFilledBezier {
            x1,
            y1,
            x2,
            y2,
            ocx1,
            ocy1,
            ocx2,
            ocy2,
            icx1: _,
            icy1,
            icx2: _,
            icy2: _,
            ..
        } = cmd
        {
            // Endpoints preserved
            assert!((x1 - 10.0).abs() < 1e-6);
            assert!((y1 - 50.0).abs() < 1e-6);
            assert!((x2 - 70.0).abs() < 1e-6);
            assert!((y2 - 50.0).abs() < 1e-6);
            // For horizontal chord, outer CPs should be below (curve_dir=1.0)
            assert!(ocy1 > y1, "Outer CP1 should be below endpoint");
            assert!(ocy2 > y2, "Outer CP2 should be below endpoint");
            // Inner CPs should also be below but closer to staff
            assert!(icy1 > y1, "Inner CP1 should be below endpoint");
            assert!(icy1 < ocy1, "Inner CP1 should be above outer CP1");
            // Symmetric: CP1 and CP2 should mirror around midpoint
            let mid_x = (x1 + x2) / 2.0;
            assert!(
                (ocx1 - (mid_x - (ocx2 - mid_x))).abs() < 1e-6,
                "Outer CPs should be symmetric"
            );
            assert!(
                (ocy1 - ocy2).abs() < 1e-6,
                "Outer CP heights should match for horizontal chord"
            );
        } else {
            panic!("Expected DrawFilledBezier");
        }
    }

    #[test]
    fn test_curve_height_asymptotic() {
        let sp = 12.0;
        // Short curve
        let short = FilledBezierParams {
            x1: 0.0,
            y1: 0.0,
            x2: 2.0 * sp,
            y2: 0.0,
            curve_dir: 1.0,
            height_inf: 1.5,
            rise_rate: 0.25,
            cp_indent: 0.20,
            thickness: 3.0,
            min_thickness: 1.0,
            endpoint_thickness: 1.0,
            sp,
            line_style: 0,
        };
        // Long curve
        let long = FilledBezierParams {
            x1: 0.0,
            y1: 0.0,
            x2: 50.0 * sp,
            y2: 0.0,
            curve_dir: 1.0,
            height_inf: 1.5,
            rise_rate: 0.25,
            cp_indent: 0.20,
            thickness: 3.0,
            min_thickness: 1.0,
            endpoint_thickness: 1.0,
            sp,
            line_style: 0,
        };

        let short_cmd = compute_filled_bezier(&short);
        let long_cmd = compute_filled_bezier(&long);

        let short_h = if let RenderCommand::DrawFilledBezier { ocy1, y1, .. } = short_cmd {
            (ocy1 - y1).abs()
        } else {
            0.0
        };
        let long_h = if let RenderCommand::DrawFilledBezier { ocy1, y1, .. } = long_cmd {
            (ocy1 - y1).abs()
        } else {
            0.0
        };

        assert!(long_h > short_h, "Longer curve should be taller");
        // Long curve should approach but not exceed h_inf * sp
        assert!(
            long_h < 1.5 * sp + 3.0,
            "Long curve height should be bounded near h_inf"
        );
    }

    #[test]
    fn test_thickness_constant_for_all_curves() {
        let sp = 12.0;
        let thickness = 4.0; // 4px base
                             // Very short curve (< 4sp)
        let short = FilledBezierParams {
            x1: 0.0,
            y1: 0.0,
            x2: 2.0 * sp,
            y2: 0.0,
            curve_dir: 1.0,
            height_inf: 1.5,
            rise_rate: 0.25,
            cp_indent: 0.20,
            thickness,
            min_thickness: 1.0,
            endpoint_thickness: 1.0,
            sp,
            line_style: 0,
        };
        // Normal length curve (>= 4sp)
        let normal = FilledBezierParams {
            x1: 0.0,
            y1: 0.0,
            x2: 6.0 * sp,
            y2: 0.0,
            curve_dir: 1.0,
            height_inf: 1.5,
            rise_rate: 0.25,
            cp_indent: 0.20,
            thickness,
            min_thickness: 1.0,
            endpoint_thickness: 1.0,
            sp,
            line_style: 0,
        };

        let short_cmd = compute_filled_bezier(&short);
        let normal_cmd = compute_filled_bezier(&normal);

        let short_t = if let RenderCommand::DrawFilledBezier { ocy1, icy1, .. } = short_cmd {
            (ocy1 - icy1).abs()
        } else {
            0.0
        };
        let normal_t = if let RenderCommand::DrawFilledBezier { ocy1, icy1, .. } = normal_cmd {
            (ocy1 - icy1).abs()
        } else {
            0.0
        };

        assert!(
            (short_t - normal_t).abs() < 0.01,
            "Short curve ({:.2}) should have same thickness as normal ({:.2})",
            short_t,
            normal_t
        );
        assert!(
            (short_t - thickness).abs() < 0.01,
            "Curve thickness ({:.2}) should equal configured thickness ({:.2})",
            short_t,
            thickness
        );
    }

    #[test]
    fn test_curve_direction_up() {
        let sp = 12.0;
        let p = FilledBezierParams {
            x1: 0.0,
            y1: 50.0,
            x2: 60.0,
            y2: 50.0,
            curve_dir: -1.0, // above
            height_inf: 1.5,
            rise_rate: 0.25,
            cp_indent: 0.20,
            thickness: 3.0,
            min_thickness: 1.0,
            endpoint_thickness: 1.0,
            sp,
            line_style: 0,
        };
        let cmd = compute_filled_bezier(&p);
        if let RenderCommand::DrawFilledBezier { ocy1, y1, .. } = cmd {
            assert!(ocy1 < y1, "Curve above should have negative Y offset");
        } else {
            panic!("Expected DrawFilledBezier");
        }
    }
}

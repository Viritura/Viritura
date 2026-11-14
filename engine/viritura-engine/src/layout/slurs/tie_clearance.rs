use super::participation::obstacles_in_x_range;
use super::render::{compute_slur_bezier, HandleDeltas};
use super::scorer::SlurShapeInput;
use super::tuning;
use crate::model::SlurShape;
use crate::render::RenderCommand;

/// Lift the two control points, not the notehead attachments, until the
/// rendered inner contour clears the sampled tie ink.
pub(super) fn tie_shape_handles(
    input: &SlurShapeInput<'_>,
    shoulder: f64,
    shift: f64,
    thickness: f64,
    tip: f64,
    shape: Option<&SlurShape>,
) -> Option<HandleDeltas> {
    if let Some(shape) = shape {
        return Some((
            None,
            shape.p1.map(|p| (p[0] * input.sp, p[1] * input.sp)),
            shape.p2.map(|p| (p[0] * input.sp, p[1] * input.sp)),
            None,
        ));
    }
    let slack = 0.1 * input.sp;
    let ties = obstacles_in_x_range(
        input.obstacles,
        input.x1.min(input.x2) + slack,
        input.x1.max(input.x2) - slack,
    );
    if !ties.iter().any(|obstacle| obstacle.is_tie) {
        return None;
    }
    let (cmd, _) = compute_slur_bezier(
        input.x1,
        input.y1,
        input.x2,
        input.y2,
        input.curve_dir,
        shoulder,
        input.cp_indent,
        shift,
        thickness,
        tip,
        0,
        None,
    );
    let RenderCommand::DrawFilledBezier {
        ix1,
        iy1,
        icx1,
        icy1,
        icx2,
        icy2,
        ix2,
        iy2,
        ..
    } = cmd
    else {
        unreachable!()
    };
    let extra = (tuning::TIE_CLEARANCE_SP - tuning::ENCOMPASS_CLEARANCE_SP).max(0.0) * input.sp;
    let white = tuning::CURVE_STACK_WHITE_SP * input.sp;
    // Extremely tight endpoints may not admit full clearance; limit the
    // control-point correction to the span rather than creating a huge arch.
    let lift = ties
        .iter()
        .filter(|obstacle| obstacle.is_tie)
        .map(|obstacle| {
            let mut lo = 0.0;
            let mut hi = 1.0;
            for _ in 0..32 {
                let t: f64 = (lo + hi) * 0.5;
                let u = 1.0 - t;
                let x = u * u * u * ix1
                    + 3.0 * u * u * t * icx1
                    + 3.0 * u * t * t * icx2
                    + t * t * t * ix2;
                if (x < obstacle.x) == (ix1 < ix2) {
                    lo = t;
                } else {
                    hi = t;
                }
            }
            let t: f64 = (lo + hi) * 0.5;
            let u = 1.0 - t;
            let y =
                u * u * u * iy1 + 3.0 * u * u * t * icy1 + 3.0 * u * t * t * icy2 + t * t * t * iy2;
            let deficit = if input.curve_dir < 0.0 {
                y - (obstacle.y_top + extra - white)
            } else {
                obstacle.y_bottom - extra + white - y
            };
            deficit.max(0.0) / (3.0 * u * t).max(1e-6)
        })
        .fold(0.0, f64::max)
        .min((input.x2 - input.x1).abs());
    if lift <= 1e-6 {
        None
    } else {
        let delta = Some((0.0, input.curve_dir * lift));
        Some((None, delta, delta, None))
    }
}

#[cfg(test)]
mod tests {
    use super::super::participation::SlurObstacle;
    use super::*;

    #[test]
    fn manual_shapes_and_opposite_side_ties_are_unchanged() {
        let tie = SlurObstacle {
            event_id: None,
            voice_idx: 0,
            x: 5.0,
            y_top: 5.0,
            y_bottom: 6.0,
            notehead_y_top: None,
            notehead_y_bottom: None,
            is_tie: true,
            is_articulation: false,
        };
        let obstacles = [tie];
        let mut input = SlurShapeInput {
            x1: 0.0,
            y1: 0.0,
            x2: 10.0,
            y2: 0.0,
            curve_dir: -1.0,
            cp_indent: 0.3,
            heuristic_shoulder: 1.0,
            heuristic_apex_shift: 0.0,
            default_shoulder: 1.0,
            shoulder_cap: 4.0,
            staff_y: 0.0,
            sp: 1.0,
            obstacles: &obstacles,
            source_event_id: "a",
            target_event_id: "b",
            has_manual_shape: false,
        };
        assert_eq!(tie_shape_handles(&input, 1.0, 0.0, 0.2, 0.05, None), None);
        input.curve_dir = 1.0;
        input.has_manual_shape = true;
        let shape = SlurShape {
            p1: Some([0.0, 0.5]),
            ..Default::default()
        };
        assert_eq!(
            tie_shape_handles(&input, 1.0, 0.0, 0.2, 0.05, Some(&shape)),
            Some((None, Some((0.0, 0.5)), None, None))
        );
        input.has_manual_shape = false;
        input.obstacles = &[];
        assert_eq!(tie_shape_handles(&input, 1.0, 0.0, 0.2, 0.05, None), None);
    }
}

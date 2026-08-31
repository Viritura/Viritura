use super::participation::*;
use super::tuning;

/// Returns the adjusted `(y1, y2)`. All other state is read-only.
pub(super) fn apply_endpoint_artic_pullback(
    mut y1: f64,
    mut y2: f64,
    src: &EventRenderInfo,
    tgt: &EventRenderInfo,
    curve_above: bool,
    sp: f64,
) -> (f64, f64) {
    let artic_pad = tuning::ARTIC_PAD_SP * sp;
    let max_inside_dist = tuning::MAX_INSIDE_DIST_SP * sp;
    let src_nh_top = src.eff_staff_y + src.y_pos * sp * 0.5;
    let src_nh_bot = src.eff_staff_y + src.y_pos_bottom * sp * 0.5;
    let tgt_nh_top = tgt.eff_staff_y + tgt.y_pos * sp * 0.5;
    let tgt_nh_bot = tgt.eff_staff_y + tgt.y_pos_bottom * sp * 0.5;
    let apply_artic_pull = |y: f64, extent: Option<(f64, f64)>, nh_top: f64, nh_bot: f64| -> f64 {
        let Some((top, bot)) = extent else { return y };
        if curve_above {
            if nh_top - top > max_inside_dist {
                return y;
            }
            (top - artic_pad).min(y)
        } else {
            if bot - nh_bot > max_inside_dist {
                return y;
            }
            (bot + artic_pad).max(y)
        }
    };
    let mixed_stems = src.stem_up != tgt.stem_up;
    let extent_on_slur_side =
        |extent: Option<(f64, f64)>, nh_top: f64, nh_bot: f64| -> Option<(f64, f64)> {
            let (top, bot) = extent?;
            if curve_above {
                if top < nh_top {
                    Some((top, bot))
                } else {
                    None
                }
            } else if bot > nh_bot {
                Some((top, bot))
            } else {
                None
            }
        };
    let src_extent = if src.endpoint_articulation_relation
        == Some(super::EndpointArticulationRelation::Outside)
    {
        None
    } else if mixed_stems {
        extent_on_slur_side(src.articulation_extent, src_nh_top, src_nh_bot)
    } else {
        src.articulation_extent
    };
    let tgt_extent = if tgt.endpoint_articulation_relation
        == Some(super::EndpointArticulationRelation::Outside)
    {
        None
    } else if mixed_stems {
        extent_on_slur_side(tgt.articulation_extent, tgt_nh_top, tgt_nh_bot)
    } else {
        tgt.articulation_extent
    };
    y1 = apply_artic_pull(y1, src_extent, src_nh_top, src_nh_bot);
    y2 = apply_artic_pull(y2, tgt_extent, tgt_nh_top, tgt_nh_bot);
    (y1, y2)
}

/// Lift slur endpoints outward to clear interior articulations
///
/// Boundary-only pull (`apply_endpoint_artic_pullback`) raises tips past the
/// articulations on the first and last note. But when interior notes (e.g.
/// inner D5/E5 staccatos under a C5→F5 slur) protrude past the boundary
/// articulations, the un-lifted tips dangle below them and the obstacle scan
/// raises only the shoulder, producing a steep asymmetric arc whose endpoints
/// visually compete with the inner marks.
///
/// This function scans all interior articulation obstacles in the slur span,
/// finds the worst-protruding edge in the slur direction, and per-endpoint
/// raises y1/y2 so the slur's natural apex (estimated via
/// `tuning::DEFAULT_SHOULDER_EST_SP`) clears that peak by `INNER_ARTIC_PAD_SP`.
///
/// Per-endpoint lift (rather than uniform) preserves high endpoints that
/// already sit at or beyond the inner peak — important for mixed-stem slurs.
///
/// Skipped entirely when either endpoint carries an outside-boundary
/// articulation: those glyphs sit *past* the un-lifted tip and lifting would
/// re-collide.
pub(super) fn apply_inner_artic_tip_lift(
    mut y1: f64,
    mut y2: f64,
    x1: f64,
    x2: f64,
    src: &EventRenderInfo,
    tgt: &EventRenderInfo,
    obstacles: &[SlurObstacle],
    src_event_id: &str,
    tgt_event_id: &str,
    curve_above: bool,
    sp: f64,
) -> (f64, f64) {
    let inner_artic_peak: Option<f64> = {
        // Use the post-stem-side-X-shift endpoint X values (x1/x2), not the
        // raw notehead-center src.x/tgt.x — the stem-side X shift can
        // displace endpoints by ~0.4sp which affects the boundary exclusion.
        let lo = x1.min(x2);
        let hi = x1.max(x2);
        let slack = tuning::ENDPOINT_X_SLACK_SP * sp;
        let mut peak: Option<f64> = None;
        for ob in obstacles_in_x_range(obstacles, lo + slack, hi - slack) {
            if !ob.is_articulation {
                continue;
            }
            if let Some(ref oid) = ob.event_id {
                if oid == src_event_id || oid == tgt_event_id {
                    continue;
                }
            }
            let edge = if curve_above { ob.y_top } else { ob.y_bottom };
            peak = Some(match peak {
                Some(p) => {
                    if curve_above {
                        p.min(edge)
                    } else {
                        p.max(edge)
                    }
                }
                None => edge,
            });
        }
        peak
    };
    let skip_endpoint_lift = src.endpoint_articulation_relation
        == Some(super::EndpointArticulationRelation::Outside)
        || tgt.endpoint_articulation_relation == Some(super::EndpointArticulationRelation::Outside);
    if let Some(peak) = inner_artic_peak.filter(|_| !skip_endpoint_lift) {
        let inner_pad = tuning::INNER_ARTIC_PAD_SP * sp;
        let shoulder_est = tuning::DEFAULT_SHOULDER_EST_SP * sp;
        let lift_endpoint = |y: f64| -> f64 {
            if curve_above {
                let needed_apex = peak - inner_pad;
                let current_apex_at_y = y - shoulder_est;
                let delta = current_apex_at_y - needed_apex;
                if delta > 0.0 {
                    y - delta
                } else {
                    y
                }
            } else {
                let needed_apex = peak + inner_pad;
                let current_apex_at_y = y + shoulder_est;
                let delta = needed_apex - current_apex_at_y;
                if delta > 0.0 {
                    y + delta
                } else {
                    y
                }
            }
        };
        y1 = lift_endpoint(y1);
        y2 = lift_endpoint(y2);
    }
    (y1, y2)
}

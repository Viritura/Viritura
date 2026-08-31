use super::super::config::LayoutConfig;
use super::participation::*;
use super::tuning;

/// fraction along the chord, and the possibly cap-lifted endpoint Ys.
pub(super) struct CollisionResult {
    pub(super) needed_shoulder: f64,
    pub(super) apex_shift_frac: f64,
    pub(super) y1: f64,
    pub(super) y2: f64,
}

/// S4 collision avoidance + 2-pass encompass + obstacle apex shift + cap.
///
/// This is the heart of slur shape computation. Pipeline:
///
/// 0. **Slant reduction** — lift the slant-reducing endpoint so a steeply
///    slanted chord stops exaggerating every mid-span intrusion measured
///    against it. Runs first because everything below uses that chord line.
/// 1. **Default shoulder** from the asymptotic
///    `slur_height_inf · (2/π) · atan(π·x/2)` formula.
/// 2. **Pass 1** — iterate obstacles between the endpoints and compute the
///    perpendicular intrusion past the chord line. For each obstacle, the
///    required shoulder is `intrusion / max(3t(1-t), 0.05)`. Tracks
///    left/right intrusion asymmetry for the apex shift.
/// 3. **Obstacle apex shift** — biases the apex toward the side carrying the
///    larger intrusion, clamped to ±0.22. Slope is deliberately not a factor:
///    the chord frame already handles it (see the note at the shift itself).
/// 4. **Pass 2** — re-evaluate each obstacle's required shoulder against
///    the apex-shifted bezier height factor.
/// 5. **Shoulder cap** — normally clamp to `slur_shoulder_max` and convert
///    excess to endpoint lift. Mixed/tall notehead-attached exceptions preserve
///    their endpoints and absorb the required clearance in the shoulder.
///
/// All inputs are read-only except y1/y2, which are returned (with the
/// optional endpoint lift applied).
///
/// This is Viritura's two-pass obstacle-clearance pipeline.
pub(super) fn compute_shoulder_and_apex(
    x1: f64,
    x2: f64,
    mut y1: f64,
    mut y2: f64,
    chord_len: f64,
    curve_above: bool,
    curve_dir: f64,
    sp: f64,
    config: &LayoutConfig,
    obstacles: &[SlurObstacle],
    src_event_id: &str,
    tgt_event_id: &str,
    preserve_endpoints: bool,
    endpoints_pinned: bool,
) -> CollisionResult {
    // Flatten a steeply slanted chord before measuring anything against it.
    // Intrusion is measured from the chord line, so a steep chord inflates
    // every mid-span reading; reducing the slant first shrinks the shoulder
    // the passes below go on to derive. Endpoints pinned by a tie or an
    // outside articulation are load-bearing and opt out.
    if !endpoints_pinned {
        let (flat_y1, flat_y2) = super::slant_reduction::reduce_slant(
            x1,
            x2,
            y1,
            y2,
            chord_len,
            curve_above,
            curve_dir,
            sp,
            obstacles,
            src_event_id,
            tgt_event_id,
        );
        y1 = flat_y1;
        y2 = flat_y2;
    }

    // Default shoulder height (perpendicular CP offset) from the asymptotic
    // formula. With both CPs at perpendicular height H, the cubic bezier
    // peak height is `0.75 * H`.
    let w = chord_len / sp;
    let x_param = w * config.slur_rise_rate / config.slur_height_inf;
    let default_shoulder = config.slur_height_inf
        * sp
        * (2.0 / std::f64::consts::PI)
        * (std::f64::consts::PI * x_param / 2.0).atan();

    let (left_x, right_x) = if x1 < x2 { (x1, x2) } else { (x2, x1) };
    let mid_x = (left_x + right_x) * 0.5;
    let clearance = tuning::ENCOMPASS_CLEARANCE_SP * sp;
    let small_obstacle_clearance = tuning::SMALL_OBSTACLE_CLEARANCE_SP * sp;
    let small_obstacle_max_h = tuning::SMALL_OBSTACLE_MAX_HEIGHT_SP * sp;

    let chord_y_at = |x: f64| -> f64 {
        if (x2 - x1).abs() < 0.01 {
            y1
        } else {
            y1 + (y2 - y1) * (x - x1) / (x2 - x1)
        }
    };

    let mut needed_shoulder = default_shoulder;
    let mut left_intrusion: f64 = 0.0;
    let mut right_intrusion: f64 = 0.0;
    let mut any_intrusion = false;

    // Pass 1: chord-line intrusion → required shoulder.
    // Obstacles are pre-sorted by x in `render_slurs`, so slice to the
    // in-span range (with endpoint slack) before scanning. The slack matches
    // the per-obstacle X test we still run inside the loop (sliced range is
    // a superset; per-obstacle test stays for clarity & safety on unsorted
    // call paths).
    let slack = tuning::ENDPOINT_X_SLACK_SP * sp;
    let span_obstacles = obstacles_in_x_range(obstacles, left_x + slack, right_x - slack);
    for obs in span_obstacles {
        if let Some(ref oid) = obs.event_id {
            if (oid == src_event_id || oid == tgt_event_id) && !obs.is_tie {
                continue;
            }
        }
        // X-range already enforced by `obstacles_in_x_range` above.
        let chord_y = chord_y_at(obs.x);
        let obs_height = obs.y_bottom - obs.y_top;
        let obs_clearance = if obs_height < small_obstacle_max_h {
            small_obstacle_clearance
        } else {
            clearance
        };
        let intrusion = if curve_above {
            (chord_y - obs.y_top) + obs_clearance
        } else {
            (obs.y_bottom - chord_y) + obs_clearance
        };
        if intrusion <= 0.0 {
            continue;
        }
        let t = ((obs.x - x1) / (x2 - x1))
            .clamp(tuning::INTRUSION_T_CLAMP, 1.0 - tuning::INTRUSION_T_CLAMP);
        let bezier_factor = 3.0 * t * (1.0 - t);
        let required_h = intrusion / bezier_factor.max(0.05);
        if required_h > needed_shoulder {
            needed_shoulder = required_h;
        }
        if obs.x < mid_x {
            left_intrusion = left_intrusion.max(intrusion);
        } else {
            right_intrusion = right_intrusion.max(intrusion);
        }
        any_intrusion = true;
    }

    // Apex shift: obstacle asymmetry only.
    //
    // Scaled by how much deeper one side is in absolute terms, not by that
    // difference's share of the total. The share saturates at ±1 the moment
    // one side is clear, so a single grazing obstacle used to swing the apex
    // as far as a genuinely lopsided passage would — which reads as a slur
    // shrugging for no visible reason.
    //
    // Deliberately NOT slope-aware. The control points are built in the chord
    // frame (unit vector along the chord, perpendicular offset for the
    // shoulder), so a sloped chord already produces a curve symmetric about
    // that chord. Adding a slope bias on top applies the rotation twice: the
    // apex slides toward the higher end, flattening the departure angle at one
    // endpoint while steepening it at the other, and the slur visibly shrugs.
    // Slope belongs to the frame, not to the shape drawn inside it.
    let asymmetry = right_intrusion - left_intrusion;
    let depth = (asymmetry.abs() / (tuning::APEX_SHIFT_FULL_ASYMMETRY_SP * sp)).clamp(0.0, 1.0);
    let apex_shift_frac = asymmetry.signum() * depth * tuning::APEX_SHIFT_MAX;

    // Pass 2: re-derive the shoulder against the apex-shifted bezier.
    //
    // Pass 1 sizes every obstacle against a centred apex, whose `3t(1-t)`
    // factor collapses toward zero near the endpoints — an obstacle sitting
    // in the last fifth of the span (a tie ending on the slur's own target,
    // say) demands several times the height it actually needs. Now that the
    // apex has moved toward the heavier side, the requirement is re-derived
    // from scratch rather than accumulated onto pass 1's estimate: keeping
    // the centred figure would discard the entire benefit of the shift and
    // balloon the curve far below the staff to clear something the shifted
    // apex already clears.
    //
    // Perf: previously we cached every (intrusion, t, x) tuple into a Vec
    // during pass 1 to avoid recomputing here. With obstacles now pre-
    // sorted and sliced to the in-span range the second walk is cheap, so
    // we drop the Vec allocation entirely. `any_intrusion` short-circuits
    // when pass 1 found nothing (the most common case for short slurs).
    if apex_shift_frac.abs() > 1e-3 && any_intrusion {
        let t_apex = (0.5 + apex_shift_frac).clamp(0.05, 0.95);
        let half = t_apex.max(1.0 - t_apex);
        let inv_dx = if (x2 - x1).abs() < 1e-9 {
            0.0
        } else {
            1.0 / (x2 - x1)
        };
        let mut shifted_shoulder = default_shoulder;
        for obs in span_obstacles {
            if let Some(ref oid) = obs.event_id {
                if (oid == src_event_id || oid == tgt_event_id) && !obs.is_tie {
                    continue;
                }
            }
            let chord_y = chord_y_at(obs.x);
            let obs_height = obs.y_bottom - obs.y_top;
            let obs_clearance = if obs_height < small_obstacle_max_h {
                small_obstacle_clearance
            } else {
                clearance
            };
            let intrusion = if curve_above {
                (chord_y - obs.y_top) + obs_clearance
            } else {
                (obs.y_bottom - chord_y) + obs_clearance
            };
            if intrusion <= 0.0 {
                continue;
            }
            let t = ((obs.x - x1) * inv_dx)
                .clamp(tuning::INTRUSION_T_CLAMP, 1.0 - tuning::INTRUSION_T_CLAMP);
            let dt = (t - t_apex) / half;
            let factor = (1.0 - dt * dt).max(0.05) * tuning::BEZIER_APEX_FACTOR;
            let required_h = intrusion / factor;
            if required_h > shifted_shoulder {
                shifted_shoulder = required_h;
            }
        }
        needed_shoulder = shifted_shoulder;
    }

    // Shoulder cap with endpoint-lift overflow.
    let shoulder_cap = config.slur_shoulder_max * sp;
    if needed_shoulder > shoulder_cap && !preserve_endpoints {
        let excess = needed_shoulder - shoulder_cap;
        let lift = tuning::BEZIER_APEX_FACTOR * excess;
        y1 += curve_dir * lift;
        y2 += curve_dir * lift;
        needed_shoulder = shoulder_cap;
    }

    CollisionResult {
        needed_shoulder,
        apex_shift_frac,
        y1,
        y2,
    }
}

#[allow(clippy::too_many_arguments)] // Phrase lift consumes the selected span and obstacle identities.
pub(super) fn apply_multi_event_phrase_lift(
    mut shoulder: f64,
    shoulder_cap: f64,
    x1: f64,
    x2: f64,
    source_voice: usize,
    obstacles: &[SlurObstacle],
    source_event_id: &str,
    target_event_id: &str,
    has_manual_shape: bool,
    sp: f64,
) -> f64 {
    if has_manual_shape {
        return shoulder;
    }
    let x_lo = x1.min(x2) + tuning::ENDPOINT_X_SLACK_SP * sp;
    let x_hi = x1.max(x2) - tuning::ENDPOINT_X_SLACK_SP * sp;
    let mut interior_event_ids = Vec::with_capacity(2);
    for obstacle in obstacles_in_x_range(obstacles, x_lo, x_hi) {
        if obstacle.voice_idx != source_voice || obstacle.notehead_y_top.is_none() {
            continue;
        }
        let Some(event_id) = obstacle.event_id.as_deref() else {
            continue;
        };
        if event_id == source_event_id || event_id == target_event_id {
            continue;
        }
        if !interior_event_ids.contains(&event_id) {
            interior_event_ids.push(event_id);
            if interior_event_ids.len() == 2 {
                shoulder = (shoulder + tuning::MULTI_EVENT_PHRASE_LIFT_SP * sp).min(shoulder_cap);
                break;
            }
        }
    }
    shoulder
}

/// S7 nested-slur shoulder adjustment.
///
/// Two complementary tweaks:
/// * **Outer slurs** (`nest_depth > 0`) — bump shoulder up by
///   `NEST_BUMP_PER_LEVEL_SP * nest_depth` so we arch above each enclosed
///   inner slur. The shoulder cap is correspondingly raised so the bump
///   isn't silently clamped away.
/// * **Inner slurs** (`inner_depth > 0`) — shrink the default shoulder
///   by `NESTED_LEVEL1_SHRINK` / `NESTED_DEEP_SHRINK` so the inner arc
///   sits snugly inside its outer parent. Only applied when the
///   obstacle-driven shoulder isn't significantly above the scaled
///   default (else we'd risk collisions).
pub(super) fn apply_nested_shoulder_adjust(
    mut needed_shoulder: f64,
    nest_depth: u32,
    inner_depth: u32,
    default_shoulder: f64,
    shoulder_cap: f64,
    sp: f64,
) -> f64 {
    if nest_depth > 0 {
        let nest_bump = tuning::NEST_BUMP_PER_LEVEL_SP * sp * nest_depth as f64;
        needed_shoulder += nest_bump;
        let nested_cap = shoulder_cap + nest_bump;
        if needed_shoulder > nested_cap {
            needed_shoulder = nested_cap;
        }
    }
    let inner_scaled_shoulder = if inner_depth >= 2 {
        default_shoulder * tuning::NESTED_DEEP_SHRINK
    } else if inner_depth == 1 {
        default_shoulder * tuning::NESTED_LEVEL1_SHRINK
    } else {
        needed_shoulder
    };
    if inner_depth > 0
        && inner_scaled_shoulder < needed_shoulder
        && needed_shoulder <= default_shoulder * tuning::NESTED_SHRINK_DEFER_RATIO
    {
        needed_shoulder = inner_scaled_shoulder.max(tuning::MIN_SHOULDER_SP * sp);
    }
    needed_shoulder
}

/// S5 / G-C staff-line apex snap for phrase-length slurs
///
/// "The apex of the slur must sit in a staff space, never on a staff line."
/// After all shoulder adjustments, project the actual bezier apex Y
/// (cubic peak at `chord_y + curve_dir * BEZIER_APEX_FACTOR * H`); if it
/// lands within `APEX_LINE_SNAP_PROXIMITY_HS` of one of the 5 drawn staff
/// lines, raise the shoulder by exactly enough to push the apex `clearance`
/// past the line.
///
/// Gated to chord_len ≥ `APEX_LINE_SNAP_PHRASE_GATE_SP` — short articulation
/// slurs keep their consistent standard shape even when the apex grazes
/// a line. Result is clamped to `shoulder_cap`.
#[allow(clippy::too_many_arguments)]
pub(super) fn apply_apex_line_snap(
    mut needed_shoulder: f64,
    chord_len: f64,
    mid_x: f64,
    apex_shift_frac: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
    curve_dir: f64,
    src_eff_y: f64,
    tgt_eff_y: f64,
    shoulder_cap: f64,
    sp: f64,
) -> f64 {
    if chord_len < tuning::APEX_LINE_SNAP_PHRASE_GATE_SP * sp {
        return needed_shoulder;
    }
    let apex_x = mid_x + apex_shift_frac * (x2 - x1);
    let apex_chord_y = if (x2 - x1).abs() < 0.01 {
        y1
    } else {
        y1 + (y2 - y1) * (apex_x - x1) / (x2 - x1)
    };
    let apex_y = apex_chord_y + curve_dir * needed_shoulder * tuning::BEZIER_APEX_FACTOR;
    let staff_ref_y = if (apex_x - x1).abs() < (apex_x - x2).abs() {
        src_eff_y
    } else {
        tgt_eff_y
    };
    let half_spaces = (apex_y - staff_ref_y) / (sp * 0.5);
    let nearest = half_spaces.round();
    if (0.0..=8.0).contains(&nearest)
        && (nearest as i32).rem_euclid(2) == 0
        && (half_spaces - nearest).abs() < tuning::APEX_LINE_SNAP_PROXIMITY_HS
    {
        let line_dist = (half_spaces - nearest).abs() * 0.5 * sp;
        let clearance_sp = tuning::APEX_LINE_SNAP_CLEARANCE_SP * sp;
        let needed_shift = (clearance_sp - line_dist).max(0.0);
        let shoulder_add = needed_shift / tuning::BEZIER_APEX_FACTOR;
        needed_shoulder += shoulder_add;
        if needed_shoulder > shoulder_cap {
            needed_shoulder = shoulder_cap;
        }
    }
    needed_shoulder
}

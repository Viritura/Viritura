//! Slant reduction — flatten a steeply slanted slur rather than digging a
//! deeper arc under it.
//!
//! Obstacle intrusion is measured against the chord line joining the two
//! endpoints. When that chord is steeply slanted, notes of perfectly ordinary
//! height sit a long way off it — not because they are extreme, but because
//! the chord has climbed away from them. Clearing them by shoulder height
//! alone digs the arc far past the music and leaves a conspicuous pocket of
//! white space under the shallow end.
//!
//! Standard engraving practice is to draw a slur over a wide-ranging passage
//! *less* steeply than the notes themselves rise, letting the endpoints lift
//! away from their noteheads instead. Flattening the chord attacks the cause:
//! it shrinks every mid-span intrusion at once, so the shoulder that the
//! following passes derive is smaller to begin with.
//!
//! Only the endpoint whose movement *reduces* the slant is touched, and only
//! by as much as the worst genuine mid-span crossing needs. Whatever the cap
//! leaves unresolved is picked up by the shoulder passes as usual.

use super::participation::*;
use super::tuning;

/// Lift the slant-reducing endpoint so a steeply slanted chord stops
/// exaggerating mid-span intrusions. Returns the (possibly unchanged)
/// endpoint Ys.
#[allow(clippy::too_many_arguments)]
pub(super) fn reduce_slant(
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
    chord_len: f64,
    curve_above: bool,
    curve_dir: f64,
    sp: f64,
    obstacles: &[SlurObstacle],
    src_event_id: &str,
    tgt_event_id: &str,
) -> (f64, f64) {
    let span = x2 - x1;
    if span.abs() < 0.01 {
        return (y1, y2);
    }
    // Short slurs are allowed to be steep: they track a single gesture and
    // flattening them would fight the contour they exist to show.
    if chord_len / sp < tuning::SLANT_REDUCTION_MIN_LEN_SP {
        return (y1, y2);
    }
    let rise = y2 - y1;
    if (rise / span).abs() < tuning::SLANT_REDUCTION_SLOPE {
        return (y1, y2);
    }

    // Move whichever endpoint sits furthest *inward* (toward the music) in
    // the curve's own direction. Pushing that one outward closes the gap
    // between the two endpoint heights, which is exactly a slant reduction.
    let move_target = curve_dir * y2 < curve_dir * y1;

    let chord_y_at = |x: f64| y1 + rise * (x - x1) / span;

    let (left_x, right_x) = if x1 < x2 { (x1, x2) } else { (x2, x1) };
    let lo = left_x + (right_x - left_x) * tuning::SLANT_REDUCTION_BAND_LO;
    let hi = left_x + (right_x - left_x) * tuning::SLANT_REDUCTION_BAND_HI;

    let mut lift: f64 = 0.0;
    for obs in obstacles_in_x_range(obstacles, lo, hi) {
        if let Some(ref oid) = obs.event_id {
            if (oid == src_event_id || oid == tgt_event_id) && !obs.is_tie {
                continue;
            }
        }
        // Raw crossing only — no clearance padding. Slant reduction should
        // answer to notes that genuinely poke past the chord, not to every
        // note that merely sits near it.
        let chord_y = chord_y_at(obs.x);
        let crossing = if curve_above {
            chord_y - obs.y_top
        } else {
            obs.y_bottom - chord_y
        };
        if crossing <= 0.0 {
            continue;
        }
        // Moving one endpoint tilts the chord about the other, so its
        // influence at the obstacle falls off linearly with distance from
        // the pivot. Invert that to get the endpoint travel this crossing
        // would need.
        let t = ((obs.x - x1) / span).clamp(0.0, 1.0);
        let influence = if move_target { t } else { 1.0 - t };
        lift = lift.max(crossing / influence.max(0.2));
    }

    if lift <= 0.0 {
        return (y1, y2);
    }

    // Never overshoot into an opposite slant, and never lift so far that the
    // endpoint reads as detached from its notehead. Anything still unresolved
    // is left for the shoulder passes.
    let lift = lift
        .min(rise.abs())
        .min(tuning::SLANT_REDUCTION_MAX_SP * sp);

    if move_target {
        (y1, y2 + curve_dir * lift)
    } else {
        (y1 + curve_dir * lift, y2)
    }
}

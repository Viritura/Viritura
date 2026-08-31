//! Endpoint lanes where slurs and ties land on the same notehead.
//!
//! Slurs and ties nest by span: at a shared notehead the shorter connector
//! hugs the head and each enclosing connector takes the next lane outward.
//! A tie that ends where a slur ends runs *parallel* into the shared head, so
//! without a real lane the two arcs converge into a single wedge and the slur
//! reads as swallowed by its tie. Lanes are measured from the tie's actual
//! published tip and compose additively with the multi-slur tip rank, so any
//! number of connectors landing on one notehead each get their own lane.
//!
//! Only ties on the slur's own side participate — a tie curving away from the
//! slur shares the notehead but never the airspace.

use super::participation::EndpointSnapshot;
use super::tuning;

/// Outermost tie tip landing on one notehead, tracked per curve side.
/// `None` on a side means no tie band was published there.
#[derive(Clone, Copy, Default)]
pub(super) struct TieTips {
    pub(super) above: Option<f64>,
    pub(super) below: Option<f64>,
    /// The endpoint is known to carry a tie even when no band geometry was
    /// published for it (retained / cross-system segments).
    pub(super) has_tie: bool,
}

impl TieTips {
    pub(super) fn from_endpoint(info: &EndpointSnapshot) -> Self {
        Self {
            above: info.tie_tip_above_y,
            below: info.tie_tip_below_y,
            has_tie: info.outgoing_tie || info.incoming_tie,
        }
    }

    /// Fold one tie tip in, keeping the outermost per side.
    pub(super) fn merge(&mut self, tip: f64, curves_above: bool) {
        self.has_tie = true;
        if curves_above {
            self.above = Some(self.above.map_or(tip, |y| y.min(tip)));
        } else {
            self.below = Some(self.below.map_or(tip, |y| y.max(tip)));
        }
    }
}

/// Push one slur endpoint outward past any tie tip sharing its notehead
/// and side. Applied as a floor, so an endpoint already beyond its lane
/// (a taller slur, a stem-side anchor) keeps the position it earned.
///
/// The tie is simply the innermost graver in the stack, so it gets the same
/// `TIP_STACK_STEP_SP` every other connector does — one step per rank, each
/// leaving `CURVE_STACK_WHITE_SP` of white beyond the previous tip's ink.
/// Rank 0 (the first slur above the tie) is one step out; rank 1 is two.
pub(super) fn tie_endpoint_lane(
    y: f64,
    tips: TieTips,
    curve_dir: f64,
    tip_rank: u32,
    sp: f64,
) -> f64 {
    let above = curve_dir < 0.0;
    let tie_tip = if above { tips.above } else { tips.below };
    let Some(tie_tip) = tie_tip else {
        // No tie band published on this side. Retained and cross-system
        // segments still know an endpoint is tied, so keep a flat clearance
        // rather than letting the tips touch.
        if tips.has_tie {
            return y + curve_dir * tuning::TIE_ENDPOINT_CLEARANCE_SP * sp;
        }
        return y;
    };
    let steps = f64::from(tip_rank + 1);
    let lane = tie_tip + curve_dir * steps * tuning::TIP_STACK_STEP_SP * sp;
    if above {
        y.min(lane)
    } else {
        y.max(lane)
    }
}

/// Resolve both slur endpoints against the ties that share their noteheads.
/// The two ends are decided independently: an S-curve can enclose a tie at
/// one end while curving away from another at the other end.
#[allow(clippy::too_many_arguments)] // One lane decision per endpoint; each carries its own side and rank.
pub(super) fn apply_tie_clearance(
    y1: f64,
    y2: f64,
    src: &EndpointSnapshot,
    tgt: &EndpointSnapshot,
    curve_dir: f64,
    end_curve_dir: f64,
    src_tip_rank: u32,
    tgt_tip_rank: u32,
    sp: f64,
) -> (f64, f64) {
    (
        tie_endpoint_lane(y1, TieTips::from_endpoint(src), curve_dir, src_tip_rank, sp),
        tie_endpoint_lane(
            y2,
            TieTips::from_endpoint(tgt),
            end_curve_dir,
            tgt_tip_rank,
            sp,
        ),
    )
}

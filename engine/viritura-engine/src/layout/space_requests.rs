//! §4 — Space creation: the single sanctioned channel through which an element
//! can ask the spacing pass for horizontal room *before* the rhythmic grid is
//! frozen.
//!
//! The rigid/elastic spacing model (`spacing::LogSpacing`) is the engine's only
//! space-*creation* mechanism. Historically each space-creating element
//! (accidentals, grace notes, caesuras, arpeggios) hand-rolled its own
//! reservation inline in the spacing builder, and annotations rendered *after*
//! width-freeze (tempo, rehearsal marks) could create no space at all — a wide
//! tempo over a narrow multi-measure rest simply overflowed.
//!
//! This module replaces that ad-hoc bookkeeping with explicit declarative
//! constraint types. Constraints are **declarative and idempotent**, so the
//! reconciliation runs once, before justification, and the result is
//! deterministic — preserving the acyclic `request → freeze → place → rejoin`
//! invariant (a dependent never deforms substrate except through this channel,
//! which runs *before* freeze).
//!
//! Two reconciliation surfaces consume these requests:
//!
//! * **Measure level** — [`MeasureWidthConstraint`] raises a measure's natural width so
//!   an above-staff annotation fits. Folded into the natural widths in
//!   `compute_natural_widths`, so justification still runs exactly once.
//! * **Intra-measure level** — [`OnsetPaddingConstraint`] and
//!   [`GapFloorConstraint`] express the per-beat
//!   reservations the spacing builder applies (arpeggio left pad, caesura
//!   "railroad-track" gap floor). Routing them through this enum means caesura
//!   and arpeggio reservations go through the same request API as accidentals,
//!   with no bespoke per-element bookkeeping.

use super::config::LayoutConfig;
use super::render_annotations;
use crate::model::ResolvedMeasure;

/// Why a request exists. Carried for diagnostics and so the reconciler can apply
/// reason-specific caps (e.g. tempo-over-MMR widening is bounded; a rehearsal
/// box must always fit).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpaceReason {
    /// An above-staff label (rehearsal mark) whose box must not overhang the
    /// next bar.
    AboveLabel,
    /// A tempo marking sitting over a narrow measure (typically a multi-measure
    /// rest) that would otherwise overflow.
    TempoOverMmr,
    /// A caesura ("railroad tracks") that physically interrupts the flow.
    Caesura,
    /// An arpeggio's wavy vertical line, which sits left of its chord.
    Arpeggio,
    /// Final rhythmic ink must clear the trailing barline under compression.
    TrailingBarline,
}

/// A minimum natural width. Multiple constraints combine by maximum, never sum.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct MeasureWidthConstraint {
    pub(crate) measure: usize,
    pub(crate) min_width: f64,
    pub(crate) reason: SpaceReason,
}

/// Additive space immediately before an onset.
///
/// `rigid_floor` is the portion that survives compression; the remainder is an
/// elastic preference. Padding constraints at the same onset sum because they
/// represent distinct pieces of physical ink.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct OnsetPaddingConstraint {
    pub(crate) width: f64,
    pub(crate) rigid_floor: f64,
    pub(crate) reason: SpaceReason,
}

/// Minimum advance after an onset.
///
/// Gap constraints combine by maximum. `rigid` means the selected floor is an
/// incompressible strut rather than only a natural-width preference.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct GapFloorConstraint {
    pub(crate) min_advance: f64,
    pub(crate) rigid: bool,
    pub(crate) reason: SpaceReason,
}

impl GapFloorConstraint {
    pub(crate) fn reconcile(self, advance: f64) -> (f64, f64) {
        let reconciled = advance.max(self.min_advance);
        let rigid = if self.rigid {
            self.min_advance.min(reconciled)
        } else {
            0.0
        };
        (reconciled, rigid)
    }
}

/// Upper bound on how far a tempo may widen a narrow measure (multi-measure
/// rest). Past this, a system break is preferable to an over-stretched bar, so
/// the widening saturates and the line-breaker takes over.
const TEMPO_MMR_WIDEN_CAP_SP: f64 = 24.0;

/// Collect the measure-level minimum-width requests for one resolved measure.
///
/// * A rehearsal mark reserves its box width so it can't overhang the next bar
///   (unbounded — the box must fit).
/// * A tempo over a multi-measure rest reserves enough room to sit cleanly
///   instead of overflowing (bounded by [`TEMPO_MMR_WIDEN_CAP_SP`]).
pub(crate) fn measure_min_width_requests(
    rm: &ResolvedMeasure,
    measure_idx: usize,
    is_mmr: bool,
    config: &LayoutConfig,
    sp: f64,
) -> Vec<MeasureWidthConstraint> {
    let mut reqs = Vec::new();
    let label_w = render_annotations::measure_above_label_reserved_width(rm, sp);
    if label_w > 0.0 {
        reqs.push(MeasureWidthConstraint {
            measure: measure_idx,
            min_width: label_w,
            reason: SpaceReason::AboveLabel,
        });
    }
    if is_mmr {
        let tempo_w = render_annotations::measure_tempo_width(rm, config, sp);
        if tempo_w > 0.0 {
            reqs.push(MeasureWidthConstraint {
                measure: measure_idx,
                min_width: tempo_w,
                reason: SpaceReason::TempoOverMmr,
            });
        }
    }
    reqs
}

/// Fold the `MinMeasureWidth` requests for a measure into its natural width.
///
/// `AboveLabel` widens without bound (a rehearsal box must always fit).
/// `TempoOverMmr` widening saturates at [`TEMPO_MMR_WIDEN_CAP_SP`] beyond the
/// natural width — past that, the line-breaker prefers a system break. The pass
/// is a pure max-fold, so it is idempotent and justification still runs once.
pub(crate) fn reconcile_natural_width(
    natural: f64,
    constraints: &[MeasureWidthConstraint],
    sp: f64,
) -> f64 {
    let mut width = natural;
    for constraint in constraints {
        let target = match constraint.reason {
            SpaceReason::TempoOverMmr => {
                natural + (constraint.min_width - natural).min(TEMPO_MMR_WIDEN_CAP_SP * sp)
            }
            _ => constraint.min_width,
        };
        width = width.max(target);
    }
    width
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn above_label_widens_without_bound() {
        let reqs = [MeasureWidthConstraint {
            measure: 0,
            min_width: 200.0,
            reason: SpaceReason::AboveLabel,
        }];
        // Natural width smaller than the label box → widened to the full box.
        assert_eq!(reconcile_natural_width(50.0, &reqs, 4.0), 200.0);
    }

    #[test]
    fn natural_width_wins_when_already_wide_enough() {
        let reqs = [MeasureWidthConstraint {
            measure: 0,
            min_width: 30.0,
            reason: SpaceReason::AboveLabel,
        }];
        assert_eq!(reconcile_natural_width(100.0, &reqs, 4.0), 100.0);
    }

    #[test]
    fn tempo_over_mmr_widens_up_to_cap() {
        let sp = 4.0;
        // A very wide tempo (1000) over a narrow MMR (natural 24) must widen the
        // measure, but only up to the cap (24 sp * 4 px = 96 px beyond natural).
        let reqs = [MeasureWidthConstraint {
            measure: 0,
            min_width: 1000.0,
            reason: SpaceReason::TempoOverMmr,
        }];
        let widened = reconcile_natural_width(24.0, &reqs, sp);
        assert_eq!(widened, 24.0 + TEMPO_MMR_WIDEN_CAP_SP * sp);
        assert!(widened < 1000.0, "must saturate, not fully expand");
    }

    #[test]
    fn tempo_over_mmr_fits_within_cap_exactly() {
        let sp = 4.0;
        // A modest tempo that fits within the cap widens to exactly the tempo.
        let reqs = [MeasureWidthConstraint {
            measure: 0,
            min_width: 60.0,
            reason: SpaceReason::TempoOverMmr,
        }];
        assert_eq!(reconcile_natural_width(24.0, &reqs, sp), 60.0);
    }

    #[test]
    fn empty_requests_leave_width_untouched() {
        assert_eq!(reconcile_natural_width(42.0, &[], 4.0), 42.0);
    }

    #[test]
    fn explicit_constraints_preserve_solver_semantics() {
        let pad = OnsetPaddingConstraint {
            width: 3.0,
            rigid_floor: 3.0,
            reason: SpaceReason::Arpeggio,
        };
        let floor = GapFloorConstraint {
            min_advance: 5.0,
            rigid: true,
            reason: SpaceReason::Caesura,
        };
        assert_eq!(pad.width, 3.0);
        assert_eq!(pad.rigid_floor, 3.0);
        assert_eq!(floor.reconcile(2.0), (5.0, 5.0));
        assert_eq!(floor.reconcile(8.0), (8.0, 5.0));
    }
}

//! Slur rendering — bezier curves connecting slurred notes.
//!
//! Slurs share the same curve rendering pipeline as ties (see `curves.rs`),
//! differing in parameters: slurs are thicker, taller, and center on noteheads
//! rather than hugging their edges.
//!
//! **Collision avoidance:** After computing the initial bezier arc, the curve
//! height is raised if intermediate notes or stems protrude into the curve's
//! path. Control points are also shifted asymmetrically toward whichever side
//! has taller obstacles (a standard engraving approach).
//!
//! ## Slur engraving plan status
//!
//! - **S1** Data plumbing  ✅ shared local/global snapshots, grace + tie links
//! - **S2** Endpoint clearances  ✅ exact local beam/accidental/dot/articulation shapes with explicit global fallbacks
//! - **S3** Multi-voice direction  ✅
//! - **S4** Encompass checking (two-pass + cap)  ✅
//! - **S5** Staff-line shoulder snap  ✅
//! - **S6** Cross-staff default direction  ✅
//! - **S7** Nested slur stacking  ✅
//! - **S8** Tie-chain endpoint extension  ✅ shared note-ID graph, local + global
//! - **S9** Multi-shape scorer  ✅ bounded deterministic candidate family
//! - **S10** SMuFL midpoint thickness (0.22sp)  ✅
//! - **S11** Cross-system + cross-staff direction  ✅ geometry bands + stitched obstacles

// ═══════════════════════════════════════════
// Slur layout
// ═══════════════════════════════════════════

/// Deterministic engraving relationship between a slur endpoint and an
/// articulation attached to that endpoint.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EndpointArticulationRelation {
    /// The slur tip moves outward so the articulation remains between the
    /// notehead and the slur (staccato, tenuto, spiccato, unstress).
    Inside,
    /// The final slur remains fixed and the automatic articulation stack moves
    /// outward (accent, marcato, staccatissimo, soft accent, stress).
    Outside,
}

pub(crate) fn endpoint_articulation_relation(
    markings: Option<&crate::model::event::Markings>,
) -> Option<EndpointArticulationRelation> {
    let markings = markings?;
    if markings.accent.is_some()
        || markings.strong_accent.is_some()
        || markings.staccatissimo.is_some()
        || markings.staccatissimo_wedge.is_some()
        || markings.soft_accent.is_some()
        || markings.stress.is_some()
    {
        Some(EndpointArticulationRelation::Outside)
    } else if markings.staccato.is_some()
        || markings.tenuto.is_some()
        || markings.spiccato.is_some()
        || markings.unstress.is_some()
    {
        Some(EndpointArticulationRelation::Inside)
    } else {
        None
    }
}

/// Tuning constants for slur engraving.
///
/// All "*_SP" values are *multiples of one staff space* (sp). Callers must
/// multiply by the local `sp` to get pixel/unit values. Threshold values
/// are either in half-spaces ("_HS") or in unitless ratios.
///
/// These constants were originally inline magic numbers scattered across
/// `emit_slur_bezier` (51 occurrences). Centralizing them makes the
/// engraving algorithm legible and tunable without grepping a 2,800-line file.
pub(crate) mod tuning {
    // ── Endpoint clearance ──────────────────────────────────────────
    /// Padding between slur tip and an articulation glyph at a boundary
    /// event. Used by the artic pull-back pass.
    pub(crate) const ARTIC_PAD_SP: f64 = 0.45;
    /// Padding between slur arc and an articulation glyph on an INTERIOR
    /// (non-boundary) note. Larger than `ARTIC_PAD_SP` because the arc
    /// passes over the dot rather than landing next to it.
    pub(crate) const INNER_ARTIC_PAD_SP: f64 = 0.80;
    /// Stem-side endpoint sits this far beyond the bare stem tip
    /// (in addition to `config.stem_length * sp`).
    pub(crate) const STEM_EXTENSION_SP: f64 = 0.50;
    /// Clearance between a stem-side slur tip and the local outer edge of every
    /// beam level crossing that stem.
    pub(crate) const BEAM_TIP_CLEARANCE_SP: f64 = 0.40;
    /// Extra inward tuck when the stem-side endpoint X is shifted toward
    /// the note's stem side.
    pub(crate) const STEM_INWARD_TUCK_SP: f64 = 0.25;
    /// Endpoint clearance from a staff line when the endpoint Y lands in
    /// a SPACE (between two lines).
    pub(crate) const STAFF_LINE_CLEARANCE_SPACE_SP: f64 = 1.10;
    /// Endpoint clearance from a staff line when the endpoint Y lands ON
    /// a line — slightly larger to read as clearly off-line.
    pub(crate) const STAFF_LINE_CLEARANCE_LINE_SP: f64 = 1.20;
    /// When the stem-side endpoint snaps near a staff line, this is the
    /// nudge applied to clearly sit in the adjacent space.
    pub(crate) const STAFF_LINE_NUDGE_SP: f64 = 0.40;

    // ── Tie / nesting / chaining ────────────────────────────────────
    /// Vertical clearance between a slur arc and a tie underneath
    /// (standard engraving G-B Y-stacking).
    pub(crate) const TIE_CLEARANCE_SP: f64 = 1.0;
    /// Fallback clearance for an endpoint that is known to carry a tie but has
    /// no published tie band on this staff (retained / cross-system segments).
    pub(crate) const TIE_ENDPOINT_CLEARANCE_SP: f64 = 0.40;
    /// Vertical half-extent of a notehead's ink. Shapes differ (triangles,
    /// diamonds, slashes), but they agree closely enough here for this to
    /// serve as the spacing datum.
    pub(crate) const NOTEHEAD_HALF_HEIGHT_SP: f64 = 0.45;
    /// Centreline standoff of a tie tip from its notehead's centre. Ties are
    /// the innermost graver in any stack, so this single distance sets the
    /// rhythm every other connector inherits.
    pub(crate) const TIE_NOTEHEAD_STANDOFF_SP: f64 = 2.0 * NOTEHEAD_HALF_HEIGHT_SP;
    /// White space left between two adjacent connectors stacked at the same
    /// notehead — the gap a reader actually sees, ink to ink.
    ///
    /// This is *derived*, not chosen: it is exactly the white a tie leaves
    /// against its own notehead. A stack should breathe at one constant rate,
    /// so the gap from notehead to tie and the gap from tie to slur are the
    /// same distance rather than two independently tuned numbers.
    ///
    /// Connector-to-notehead distance is measured from the notehead *centre*
    /// (notehead ink varies by shape, so its edge is not a dependable anchor).
    /// Connector-to-connector distance is measured from the previous graver
    /// tip instead: both curves are strokes we cut ourselves, so their
    /// geometry is exactly known and spacing them ink-to-ink is meaningful.
    pub(crate) const CURVE_STACK_WHITE_SP: f64 =
        TIE_NOTEHEAD_STANDOFF_SP - NOTEHEAD_HALF_HEIGHT_SP - CURVE_TIP_INK_SP * 0.5;
    /// Ink carried by a tapered tip, i.e. `*_endpoint_thickness`. Converting
    /// the desired white space into a centreline-to-centreline step has to
    /// add this back, and doing it here keeps the two in step if the tip
    /// weight is ever retuned.
    pub(crate) const CURVE_TIP_INK_SP: f64 = 0.10;
    /// Centreline step between stacked connector tips: the white space we
    /// want, plus the ink the two tips occupy.
    pub(crate) const TIP_STACK_STEP_SP: f64 = CURVE_STACK_WHITE_SP + CURVE_TIP_INK_SP;
    /// Horizontal fan applied alongside the vertical step. Stacked endpoints
    /// separate in both axes: the outer slur starts fractionally earlier and
    /// ends fractionally later than the one it encloses, which reads far more
    /// clearly than a purely vertical stack.
    pub(crate) const TIP_STACK_HORIZ_SP: f64 = 0.20;
    /// Inward nudge for a chained-pair pivot tip.
    pub(crate) const CHAINED_PIVOT_NUDGE_SP: f64 = 0.18;

    /// Steepest angle, as a tangent, at which a slur may leave its notehead.
    /// `tan 60°`. A control point's offset from its endpoint is
    /// `chord_len * f` along the chord and the shoulder across it, so their
    /// ratio is the departure angle. Unbounded, a short chord with a tall
    /// shoulder leaves the notehead almost square to the chord and reads as a
    /// hook rather than the start of an arc.
    pub(crate) const MAX_DEPARTURE_TAN: f64 = 1.732_050_8;
    /// Smallest share of the span a control point must keep between itself
    /// and its own endpoint. The apex shift is bounded by the indent, so
    /// without this a full shift can drive a control point onto its endpoint,
    /// leaving the curve no tangential run at all: it departs square to the
    /// chord and reads as a hook however shallow the arc.
    pub(crate) const MIN_CP_FRACTION: f64 = 0.08;

    // ── Apex shift ───────────────────────────────────────────────
    /// Largest fraction of the span the apex may slide toward the more
    /// obstructed side.
    pub(crate) const APEX_SHIFT_MAX: f64 = 0.10;
    /// Difference in intrusion depth that earns the full apex shift. The
    /// shift must answer to how much deeper one side actually is, not merely
    /// to which side is deeper: a hair's asymmetry should move the apex by a
    /// hair. Scaling by the raw difference rather than by its share of the
    /// total is what keeps a trivial one-sided intrusion from saturating.
    pub(crate) const APEX_SHIFT_FULL_ASYMMETRY_SP: f64 = 1.0;
    /// Bezier parameter clamp used when inverting an intrusion into the
    /// shoulder height that would clear it. The `3t(1-t)` term collapses
    /// toward the endpoints, so an unclamped inversion lets a note just
    /// inside an endpoint demand many times its own depth. Obstacles that
    /// close to an end are the business of endpoint placement, not of the
    /// arc, so the inversion stops taking them literally past this point.
    pub(crate) const INTRUSION_T_CLAMP: f64 = 0.15;

    // ── Slant reduction ────────────────────────────────────────
    /// Chord slope past which a slur counts as slanted enough that flattening
    /// it beats deepening its arc. `tan 5°` — a barely-perceptible tilt, so
    /// anything visibly sloped qualifies.
    pub(crate) const SLANT_REDUCTION_SLOPE: f64 = 0.0875;
    /// Minimum slur length for slant reduction. Short slurs track a single
    /// gesture and should keep the contour of the notes they cover.
    pub(crate) const SLANT_REDUCTION_MIN_LEN_SP: f64 = 8.0;
    /// Ceiling on how far an endpoint may lift away from its notehead in the
    /// service of flattening. Past this the endpoint reads as detached.
    pub(crate) const SLANT_REDUCTION_MAX_SP: f64 = 1.5;
    /// Span fractions bounding the "mid" region consulted for slant
    /// reduction. Crossings close to an endpoint are that endpoint's own
    /// problem and are handled by endpoint placement, not by tilting.
    pub(crate) const SLANT_REDUCTION_BAND_LO: f64 = 0.20;
    pub(crate) const SLANT_REDUCTION_BAND_HI: f64 = 0.80;
    /// Shoulder bump per level of slur nesting (S7 finish).
    pub(crate) const NEST_BUMP_PER_LEVEL_SP: f64 = 0.50;
    /// Inner-slur shoulder reduction factor at nest level 1.
    pub(crate) const NESTED_LEVEL1_SHRINK: f64 = 0.75;
    /// Inner-slur shoulder reduction factor at nest level 2+.
    pub(crate) const NESTED_DEEP_SHRINK: f64 = 0.60;

    // ── Shoulder shape ──────────────────────────────────────────────
    /// Estimated shoulder height used by early endpoint-pad calculations
    /// before the real shoulder is computed. (~1.5 sp matches standard engraving's
    /// typical short-slur arc.)
    pub(crate) const DEFAULT_SHOULDER_EST_SP: f64 = 1.5;
    /// Absolute minimum shoulder height — slurs flatter than this read
    /// as line segments rather than arcs.
    pub(crate) const MIN_SHOULDER_SP: f64 = 0.4;
    /// A modest aesthetic lift for phrase slurs spanning at least two
    /// interior notes. Applied after collision scoring so a contour that only
    /// just clears its notes still reads as a phrase rather than an enclosure.
    pub(crate) const MULTI_EVENT_PHRASE_LIFT_SP: f64 = 0.15;
    /// Bezier apex factor: a cubic with symmetric CPs at perpendicular
    /// height `H` peaks at `0.75 * H` above the chord midpoint.
    pub(crate) const BEZIER_APEX_FACTOR: f64 = 0.75;

    // ── Stem-side tip drop (contour-aware) ──────────────────────────
    /// Span normalization for the contour-driven tip-drop curve:
    /// `((chord_len_sp - 3) / 12).clamp(0, 1) * 0.60`.
    pub(crate) const TIP_DROP_SPAN_OFFSET_SP: f64 = 3.0;
    pub(crate) const TIP_DROP_SPAN_SCALE_SP: f64 = 12.0;
    pub(crate) const TIP_DROP_SPAN_MAX_SP: f64 = 0.60;
    /// Overhang contribution to tip drop: 30% of obstacle overhang, capped.
    pub(crate) const TIP_DROP_OVERHANG_FACTOR: f64 = 0.30;
    pub(crate) const TIP_DROP_OVERHANG_MAX_SP: f64 = 0.90;
    /// Overall cap for the contour-driven tip drop.
    pub(crate) const TIP_DROP_TOTAL_MAX_SP: f64 = 1.20;
    /// Extra drop when the contour rolls toward the endpoint.
    pub(crate) const CONTOUR_DROP_EXTRA_SP: f64 = 0.40;

    // ── Contour-side / register / tall slur ─────────────────────────
    /// Margin (in sp) by which an inner peak/valley must exceed the
    /// endpoint envelope to trigger contour-driven side flip.
    pub(crate) const MOUNTAIN_MARGIN_SP: f64 = 1.0;
    /// Minimum inner-note count for a slur to qualify as a "long phrase"
    /// where the contour-flip rule is suppressed.
    pub(crate) const LONG_PHRASE_INNER_THRESHOLD: u32 = 5;
    /// Span (in half-spaces) above which the "tall slur" force-above rule
    /// activates. Mirrors
    pub(crate) const TALL_SLUR_HS_THRESHOLD: f64 = 10.0;
    /// Maximum endpoint-to-inside-notehead distance considered for the
    /// "endpoint above middle" register guard.
    pub(crate) const MAX_INSIDE_DIST_SP: f64 = 4.0;
    /// Endpoint snap tolerance (relative to half-space) for the apex
    /// line-snap pass.
    pub(crate) const APEX_LINE_SNAP_PROXIMITY_HS: f64 = 0.25;
    /// Apex line-snap clearance: how far the apex is pushed off a line
    /// when snapped.
    pub(crate) const APEX_LINE_SNAP_CLEARANCE_SP: f64 = 0.30;
    /// Chord-length gate (in sp) below which the apex line-snap is
    /// disabled (short articulation slurs keep consistent shape).
    pub(crate) const APEX_LINE_SNAP_PHRASE_GATE_SP: f64 = 8.0;

    // ── Cross-staff ─────────────────────────────────────────────────
    /// Staff-gap (in sp) above which the cross-staff height-factor
    /// reduction kicks in.
    pub(crate) const CROSS_STAFF_GAP_THRESHOLD_SP: f64 = 3.5;
    /// Multiplicative shoulder reduction for tall cross-staff slurs.
    pub(crate) const CROSS_STAFF_HEIGHT_FACTOR: f64 = 0.85;

    // ── Encompass / shoulder cap interaction ────────────────────────
    /// Above this ratio (obstacle-driven shoulder ÷ default shoulder),
    /// the nested-shrink rule defers to obstacle clearance.
    pub(crate) const NESTED_SHRINK_DEFER_RATIO: f64 = 1.1;
    /// Small-obstacle clearance for the encompass pass: obstacles with
    /// height ≤ `SMALL_OBSTACLE_MAX_HEIGHT_SP` need only this much arc
    /// clearance (avoids ballooning over tenutos/staccatos).
    pub(crate) const SMALL_OBSTACLE_CLEARANCE_SP: f64 = 1.2;
    pub(crate) const SMALL_OBSTACLE_MAX_HEIGHT_SP: f64 = 0.5;
    /// Inner-padding used by the encompass pass.
    pub(crate) const ENCOMPASS_CLEARANCE_SP: f64 = 0.4;

    // ── Slack / hit-test tolerances ─────────────────────────────────
    /// Endpoint-X slack: obstacles within this distance of an endpoint X
    /// are treated as ON the endpoint (not inside the span).
    pub(crate) const ENDPOINT_X_SLACK_SP: f64 = 0.1;
    /// Tolerance used when snapping endpoint Y to a staff line.
    pub(crate) const STAFF_LINE_SNAP_TOLERANCE_SP: f64 = 0.35;
}

mod articulation_clearance;
mod boundary_dependents;
mod broken_segments;
mod collision_apex;
mod continuation_dependents;
mod cross_system;
mod direction;
mod endpoint_spring;
mod global_endpoints;
mod obstacle_shapes;
pub(super) mod participation;
mod participation_roles;
mod render;
mod scorer;
mod slant_reduction;
mod tie_chains;
mod tie_lanes;
mod tuplet_clearance;
mod voice_span;

pub(crate) use continuation_dependents::*;
pub(crate) use cross_system::*;
pub(crate) use global_endpoints::*;
pub(crate) use participation_roles::*;
pub(crate) use render::*;

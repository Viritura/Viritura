# Collision-Avoidance Follow-ups

> **Status:** Core collision infrastructure is shipped. This plan tracks the remaining horizontal/diagonal placement and reflow work. Shipped spacing, skyline, and pagination behavior is specified in [page-layout.md](../spec/page-layout.md).

## Shipped baseline

- Content-aware inter-staff and inter-system spacing from rendered extents.
- Up/down skyline construction, merge, and bounded x-range queries.
- Multi-voice notehead collision handling, including shared unisons and down-stem displacement.
- Beam-to-inner-stem avoidance.
- Skyline-driven placement for below-staff hairpins and pedals.
- Skyline-to-skyline page-break spacing.
- Above-staff dependent flow with duration-aware horizontal envelopes for tempo marks and text expressions.
- Outward-only dependent stacking through the shared placement field.

The shared vocabulary is `FieldRole`, `PlacementTable`, `ShapeGeom::Band`, and `SpaceRequest`. New work must extend that model rather than introduce a parallel collision system.

## Remaining work

### 1. Horizontal allowance for dynamics

Dynamics remain centered on their rhythmic anchor even when nearby whitespace would permit a clearer horizontal position. Add bounded displacement without breaking alignment with related hairpins, voice/staff ownership, or user-authored offsets.

### 2. Joint two-dimensional placement

`flow_above_staff_dependents` currently tries horizontal displacement before stacking vertically. Replace this axis-priority sequence with a bounded joint search minimizing a named cost over $(\Delta x, \Delta y)$.

The first implementation should use an L1-style objective with deterministic tie-breaking:

$$
C = w_x |\Delta x| + w_y |\Delta y| + C_{overlap} + C_{anchor} + C_{ordering}
$$

Hard constraints still include collision clearance, legal rhythmic displacement, pinned fields, staff ownership, and finite geometry. Preserve current output when costs tie.

### 3. Vertical tuck

After collision resolution, move dependents back toward their preferred baseline where clearance permits. Tuck must be outward-only relative to pinned siblings during each solve and must not oscillate with the two-dimensional search.

### 4. Note-spacing compression

When dependent movement cannot resolve a horizontal conflict acceptably, allow bounded compression of neighboring note spacing. This is a later relief valve: collision-free notation and minimum rhythmic spacing remain hard constraints, and compression must feed the normal system-width calculation.

### 5. Gap-driven re-pagination

Changed vertical gaps can invalidate page packing. Add a bounded layout retry that re-paginates after final measured gaps, with a maximum of two retries and deterministic convergence. Do not add this until fixtures demonstrate a real single-pass failure.

### 6. Per-staff-pair below-staff stacking

Lyrics, dynamics, hairpins, and pedals need one per-staff-pair stacking model rather than independent fixed lanes. Resolve their combined skyline while preserving semantic ordering and avoiding unnecessary distance from the staff.

## Known correctness risks

### Above-staff extent prediction

The measurement pass can underestimate a tempo or expression that is later pushed above a tall note or stem. Either compute the same placement in measurement and rendering or feed the resolver's actual extent back into system spacing.

### Below-staff extent composition

Some measurement paths combine protrusions and annotation lanes with `max()` even when a dodging annotation sits beyond the protrusion and therefore requires additive clearance. Audit each consumer against its actual skyline behavior before changing the shared formula.

### Configurable clearance

The explicit-system intra-staff minimum clearance remains hardcoded. Move it into the layout/style configuration only when the style cascade has a stable owner for the value.

## Constraints

1. Layout decisions remain in Rust; renderers consume absolute geometry.
2. Every search is bounded, finite, and deterministic.
3. Existing authored offsets and pinned placements remain hard constraints.
4. Collision shapes and renderer output must describe the same geometry.
5. Reflow relief valves run only after cheaper dependent displacement is exhausted.
6. New behavior requires focused Rust layout fixtures and retained-layout coverage where applicable.

## Completion criteria

- Dynamics can move horizontally within musically legal bounds.
- Above-staff dependents choose a deterministic minimum-cost diagonal placement.
- Dependents tuck toward their baseline without overlap or oscillation.
- Below-staff annotation families share one ordered per-staff-pair field.
- Compression and re-pagination are measurement-gated, bounded, and covered by fixtures.
- System and page extents contain the final resolved annotation geometry.

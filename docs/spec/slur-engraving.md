# Slur Engraving

> **Status:** Shipped. This document records the implemented slur geometry and collision contract. Manual authoring behavior is documented separately in [engrave-mode.md](engrave-mode.md).

## Geometry pipeline

Slurs are connectors in the layout collision model. Noteheads, stems, beams, accidentals, augmentation dots, ledger lines, ties, articulations, and fermatas form the substrate against which slur geometry is resolved. Once shaped, every slur publishes an editable spine and a sampled connector band before dependent annotations are placed.

The implementation lives in [`engine/viritura-engine/src/layout/slurs/`](../../engine/viritura-engine/src/layout/slurs). Local and cross-system layout use the same endpoint snapshot semantics:

- Main and grace events can be endpoints.
- Exact event-owned element shapes are preferred over analytic estimates, with explicit fallbacks where no shape has been published.
- Endpoint identity is note-specific within chords and follows the intended note's tie chain.
- Explicit side and manual shape handles are hard author constraints.
- Geometry is finite, deterministic, and scoped by system, staff, and event identity.

## Shape selection

Ordinary and stitched-horizon slurs use the same bounded deterministic candidate family. Candidates vary shoulder height, apex bias, and legal endpoint tuck around the baseline heuristic.

Candidates that violate authored direction, endpoint order, obstacle clearance, finite geometry, or manual handles are rejected. Remaining candidates are scored for:

- obstacle-clearance deficit;
- excess height and length;
- undesirable asymmetry;
- endpoint tangent quality;
- staff-line grazing;
- curvature smoothness.

Deterministic tie-breaking prefers the baseline heuristic when scores are equal.

## Cross-system behavior

A real system or page break produces continuation segments. Each segment publishes the same spine and sampled connector-band geometry as a same-system slur, so dependent markings clear it consistently.

A retained Horizon chunk boundary is not a musical break. A slur crossing such a boundary remains one continuous command and one continuous band, using bounded event and obstacle slices from both retained chunks. Cached and freshly computed overlays preserve stable element identity.

## Tie-chain endpoints

Slur geometry resolves authored note endpoints through note-specific predecessor and successor tie relationships:

- a source inside an incoming tie chain extends to the effective chain start;
- a target with an outgoing tie extends to the effective chain end;
- chord endpoints follow only the selected note's chain;
- malformed cycles terminate deterministically.

Authored source and target IDs remain available for selection identity even when geometry uses an effective tied endpoint.

## Filled outline and taper

Slurs render as filled Bezier outlines with distinct inner and outer endpoints. `LayoutConfig::slur_endpoint_thickness` controls endpoint taper while the existing midpoint thickness controls the shoulder. The same outline semantics are preserved by Rust transforms and bounding boxes, the binary display-list codec, SVG output, WASM decoding, Canvas rendering, and sampled collision bands.

Ties retain their separate taper policy.

## Invariants

1. Slurs consume the frozen substrate, then rejoin the collision field before dependents resolve.
2. Same-system, real-break, and retained-boundary paths use equivalent endpoint and obstacle semantics.
3. Every emitted slur segment has matching editable and collision geometry.
4. Stitched retained boundaries never create left/right continuation fragments.
5. Manual handles and explicit side always override automatic candidate selection.
6. Renderer output and collision geometry describe the same filled outline.

## Validation

The Rust layout suite covers main and grace endpoints, note-specific tie chains, exact obstacle clearance, real and retained boundaries, continuation-band publication, deterministic candidate scoring, manual handles, and taper. Binary, SVG, WASM, and Canvas tests cover the filled-outline protocol.

Related references:

- [page-layout.md](page-layout.md) for system, page, and retained-layout behavior.
- [data-model-pipeline.md](data-model-pipeline.md) for model-to-display-list flow.
- [viritura-extensions.md](viritura-extensions.md) for persisted Viritura-specific fields.

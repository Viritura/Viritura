# 60 FPS Incremental Layout Plan

> **Status:** Core local-pitch target achieved — bounded dirty scope, stable Horizon chunks,
> PatchFrame v3, patch IR, optimistic feedback, spatial deltas, and retained
> Horizon paint partitions shipped on the performance branch. The branch is
> synchronized with current `main`; the initial broader headed-browser scenario
> expansion is complete. Pitch p95 is within 33 ms, but p50 still varies under
> sustained host load despite stable deterministic work counters.
>
> **Target:** authoritative local edits at p50 ≤ 16.6 ms on Rhapsody in Blue
> (510 measures × 33 parts), with immediate visual feedback for larger reflows  
> **Architecture reference:** [`performance-architecture.md`](performance-architecture.md)  
> **Correctness policy:** every optimization remains byte-identical to full/no-cache
> layout unless this plan explicitly introduces a versioned render-protocol change

## 1. Goal

Make ordinary notation edits behave like updates to a persistent game/physics
world rather than requests to rebuild and transfer a rendered score snapshot.

A local edit must dirty a bounded dependency island:

```text
changed event
  → affected part/staff and rhythmic interval
  → affected measure/system constraints
  → affected page frontier
  → connected spanners
  → affected render/spatial layers
```

Everything outside that island remains in memory and is reused by stable handle.

This plan does **not** require replacing Rust, WASM, Canvas 2D, the promoted score
model, `EventArena`, or the worker. It evolves the granularity of the existing
stateful engine, caches, patch frames, and renderer.

## 2. Latency contract

Not every operation has the same dependency radius. Use explicit service-level
objectives rather than pretending a global meter/layout change can settle like a
pitch edit.

| Edit class                                                      |        Immediate visual response |             Authoritative layout |
| --------------------------------------------------------------- | -------------------------------: | -------------------------------: |
| Pitch, width-neutral accidental/articulation, local handle drag |       p50 ≤ 16.6 ms; p95 ≤ 33 ms |                    p50 ≤ 16.6 ms |
| Width-changing accidental/note/duration edit                    | optimistic local layer ≤ 16.6 ms | p50 ≤ 50 ms; bounded propagation |
| Meter/key/layout/part-topology change                           |            UI remains responsive |   asynchronous; no 16 ms promise |

For width-changing and structural edits, the editor may render an optimistic
local overlay using prior system geometry while the worker computes the final
constraint solution. The authoritative result replaces it atomically.

## 3. Measurements and implementation record

Measurements are from production WASM and native release probes on 2026-07-11.
See [`performance-architecture.md`](performance-architecture.md) for commands and
full context.

### 3.1 Pre-plan local-edit baseline

The following numbers are historical. They describe the starting point before
the implementation phases below, not the current architecture.

| Metric                                | Pre-plan baseline |
| ------------------------------------- | ----------------: |
| Native release Rhapsody real-edit p50 |           62.9 ms |
| Production-WASM paged patch p50       |         ~69–81 ms |
| Production-WASM paged patch p95       |        ~85–111 ms |
| Patch decode + reconstruction         |             ~9 ms |
| Typical paged patch                   |       ~587–719 KB |
| Fresh/reused paged systems            |           1 / 249 |

Pre-plan native buckets:

| Bucket                          |       Approx. cost |
| ------------------------------- | -----------------: |
| Edited-page render loop         |            16.0 ms |
| Resolve staves + MMR            |            14.8 ms |
| Cross-system slurs (cache miss) |             8.1 ms |
| Natural widths                  |             6.2 ms |
| Pass-1 precompute               |             6.4 ms |
| Cross-system ties (cache miss)  |             3.3 ms |
| Retention move/hash/restore     | ~0.01–0.02 ms each |

Retention bookkeeping is already negligible. Container-level `memcpy` work is
not the next priority.

### 3.2 Current accepted checkpoint and implementation chronology

The performance branch now exercises the real editor in headed production
Chrome with trusted keyboard input and 30 warmed samples per scenario. The
accepted implementation has reached:

- 1–2 resolved and natural-width staff/measure cells out of 17,340;
- one dirty Horizon system with 169 reused systems in the permanent pitch gate;
- approximately 338 KB incremental local frames;
- optimistic pitch/accidental feedback below 1 ms p95;
- incremental spatial replacement around 6.9 ms p50 / 8.8 ms p95;
- retained PatchFrame system partitions used as a coarse direct-paint index.
- compact per-staff content ranges retained inside each system segment. Systems
  without cross-staff events reuse every byte-identical staff layer around the
  edit; cross-staff systems conservatively reuse only the prefix before it.
  Accidental-obstacle state is replayed in either mode.
- compact cross-system snapshots prune staff/system bounds that no surviving
  slur event or tie note can query; the headed gate requires this reduction to
  engage on every sampled edit.
- immutable MMR grouping plans are shared while the exact first-staff resolved
  snapshot and authored grouping inputs retain identity; first-staff or
  structural changes recompute normally.
- affected-staff duration histograms update only for rerun measures, and ottava
  range snapshots retain identity unless those measures change ottava
  declarations.
- adjacent retained staff layers are extracted, translated, and appended as
  contiguous runs while their individual markers remain addressable.
- fresh system display lists are shared immutably between the retained cache
  and PatchFrame instead of deep-cloned for two owners.
- stitched-Horizon global vertical metrics retain per-staff above/below
  protrusion summaries and rescan only affected staves.
- stitched-Horizon tie-accidental suppression maps retain per-staff identity
  and rebuild only for affected staves.
- dirty retained systems move matching measure-layout slots back by ordinal and
  compound hash, so only the edited staff/measure is laid out fresh.
- Horizon sticky-overlay staff detection collapses precise measure bounds by
  flattened staff index instead of rediscovering `chunks × staves` line groups.
- retained-layer Horizon frames paint before flattened compatibility arrays are
  updated; spatial indexing receives the finalized arrays immediately after
  authoritative paint.
- full MNX document assembly runs after authoritative paint for successful
  patches; only structural or failed-patch paths require it before layout.
- natural-width validation scans only the dirty slice when weak MMR identity
  proves the retained width vector remains aligned.

The remaining paragraphs in this subsection are a chronological measurement
record. Intermediate statements such as “target is not yet met” describe that
checkpoint only; the final accepted result is the 16.52 ms run below.

A controlled headed-Chrome A/B on the same production build measured Canvas
paint p50 at 35.82 ms with full command traversal and 17.89 ms with retained
system culling. Absolute end-to-end timings varied materially with host CPU/GPU
load; at that intermediate checkpoint, the authoritative target was not yet met.

The representative native local-part probe improved from 37.0 ms to 32.8 ms
p50 after fresh-system ownership cleanup and per-staff prefix retention. The
20 sampled Rhapsody edits reused 106 staff-content layers in total; edits in
the first visible staff conservatively reuse zero prefix layers.

Rhapsody originally retained 16,456 cross-system bounds for 2,923 compact slur
events and 3,676 compact tie notes. Pruning unreferenced bounds reduced the
native `cross_system_slurs` bucket from roughly 8.7 ms to 6.4 ms in the same
20-edit probe while preserving patch/full byte equivalence.

MMR retention engaged for 16 of 20 distributed native edits (all edits outside
the first resolved staff) and for every headed trusted-pitch sample. The native
local-part p50 measured 32.3 ms in that checkpoint.

Incremental staff derivatives removed a measured ~4.4 ms full-staff auxiliary
scan from the scoped resolve bucket. The distributed native local-part probe
then measured 20.0 ms p50, and a quiet-window headed production-Chrome pitch
run measured 28.26 ms authoritative p50 with 14.13 ms Canvas p50. The large
Rhapsody oracle now verifies a duration-bucket edit against no-cache output in
addition to pitch edits.

Batching adjacent staff layers reduced the distributed native local-part probe
again, from 20.0 ms to 17.5 ms p50. The headed gate requires at least 30 reused
staff layers to reconstruct in no more than three retained runs.

Shared fresh-system ownership reduced the distributed native probe to 15.3 ms
p50, crossing the native 16.6 ms target. Permanent browser telemetry now splits
worker RPC/transfer from main-thread patch reconstruction: a representative
headed run measured 31.29 ms worker p50, 2.92 ms reconstruction p50, and 14.55
ms Canvas p50. The remaining authoritative browser gap is therefore primarily
inside production WASM/worker layout rather than transfer or JS reconstruction.

The browser workload is chunked Horizon, not the paged native configuration.
Before retained global staff extents, the matching native Horizon probe measured
27.9 ms p50 and spent ~14.7 ms rescanning all staff protrusions. Retaining those
two scalars per staff reduced native Horizon to 24.0 ms p50 and headed worker
p50 from ~31.3 ms to 25.8–27.4 ms. A repeat headed run measured 24.08 ms
authoritative p50, 2.77 ms reconstruction p50, and 14.08 ms Canvas p50.

Retaining the second Horizon-global staff dependency—the tie-accidental map—
removed another full 34-staff scan. The resulting headed run measured 17.63 ms
worker p50, 2.18 ms reconstruction p50, 12.26 ms Canvas p50, and 25.0 ms
authoritative p50. Worker compute is now near, but not yet below, 16.6 ms.

Partial precompute reuse moved the remaining clean measure-layout slots out of
the dirty chunk and reduced headed worker compute to 13.66 ms p50 / 15.59 ms
p95, meeting the worker frame budget. Collapsing sticky-overlay rows then
measured about 20.9 ms authoritative p50 with 12.56 ms Canvas p50; the screenshot
retained the expected sticky clefs and instrument labels.

The final critical-path changes deferred flattened compatibility reconstruction
until after retained-layer paint, moved successful-patch full-document assembly
after authoritative paint, removed the duplicate direct-paint selection
overlay, and limited
width validation to the dirty slice. A 30-sample headed production-Chrome run
in the final accepted full suite measured **16.52 ms authoritative p50**, crossing the
≤16.6 ms target:

- worker RPC/layout: 13.34 ms p50;
- retained patch decode/application: 0.58 ms p50;
- authoritative Canvas paint: 1.58 ms p50;
- command processing: 0.34 ms p50;
- delta preparation: 0.15 ms p50;
- optimistic feedback: 0.19 ms p50.

The permanent headed gate now asserts authoritative p50 ≤16.6 ms in addition
to deterministic non-vacuous scope/reuse counters. At that checkpoint, p95
remained above one frame; structural edits retained asynchronous fallback.
The tested accidental toggle changes shared measure width; in the final full
suite it reconciled at 18.37 ms p50 with 0.19 ms optimistic p50, below the 50 ms
width-changing contract.

After merging current `origin/main`, rebuilding WASM, and rerunning headed
production Chrome, pitch improved to 13.94 ms p50 / 16.70 ms p95 (11.11 ms
worker, 0.53 ms retained application, 1.44 ms Canvas). The permanent suite now
also measures articulation at 16.53 ms p50, `ScorePatch` slur mutation at
15.16 ms p50 / 18.09 ms p95, note insertion at 34.99 ms p50 / 198.31 ms p95,
and asynchronous global meter fallback at ~1.07 s p50. The insertion tail—not
pitch—is now the primary local tail-hardening target.

Measured experiments rejected rather than retained:

- dirty Canvas bitmap-region patching (authoritative p50 regressed to ~62 ms);
- targeted tile rebuilding (command-bucket rebuild cost exceeded direct paint);
- lazy/filtered overlay dependency graphs (low engagement and p50 regression);
- skipping unchanged Canvas dimension assignments (Canvas p50 regressed from
  17.89 ms to 25.90 ms in the controlled A/B).
- retained slur-topology maps (~1 ms setup prize; no total-bucket improvement);
- direct single-buffer PatchFrame encoding (worker p50 unchanged);
- fat-LTO/codegen-unit-one WASM builds (worker p50 unchanged; build time tripled);
- one-pass Canvas `copy` reset (no authoritative/Canvas improvement);
- staff-scoped accidental invalidation (zero matching staff hashes because the
  tested accidental toggle changes shared measure width; reverted).

### 3.3 Historical staff-count vs. score-length baseline

| View                                   | Measures |          p50 |  p95/max |
| -------------------------------------- | -------: | -----------: | -------: |
| Full score (33 parts, ~34 flat staves) |      510 | **72.49 ms** | 83.52 ms |
| Single part                            |      510 |  **1.27 ms** |  1.46 ms |
| Single part                            |      256 |      0.98 ms |  1.16 ms |
| Single part                            |      128 |      0.53 ms |  0.72 ms |
| Single part                            |       64 |      0.37 ms |  0.51 ms |

At the pre-plan baseline, the dominant scale boundary was staff count and
cross-staff/system aggregation. The final common pitch path no longer performs
those whole-score resolved/setup scans.

### 3.4 Historical Horizon rechunking failure

A width-preserving edit retains 41 of 42 horizon chunks and stays near 80–90 ms
p95. A measured width-changing edit shifted cumulative chunk boundaries and
produced:

```text
42 fresh chunks / 0 reused
~514 ms WASM call
~43.2 MB frame
```

This failure motivated stable Horizon membership. It is not the current
width-neutral behavior; width-changing/structural propagation remains an area
for broader permanent coverage and frontier hardening.

## 4. Reconvergence Requirements

Incremental layout requires a retained dependency frontier that:

- records command time and staff ranges;
- begins partial page layout at the affected system, one measure earlier for
  carried/courtesy state;
- mutates a persistent score/system/page engraving graph;
- stops downstream page collection when the requested range is complete and the
  current page ends on the same measure as before;
- indexes spanners using an interval tree;
- incrementally spaces the last one or two measures while collecting a system.

Viritura can retain binary render layers and apply deltas without retaining a
platform-specific scene graph.

## 5. Decisions

1. **Dirty state is two-dimensional.** A rhythmic range without affected
   parts/staves does not solve orchestral scaling.
2. **Use exact score time, not MIDI PPQ.** Internally this may remain
   `(measure_id/index, rational beat)` plus an ordered interval key. “Tick” means
   an exact ordered score-time interval.
3. **Keep state on both sides of the worker.** The worker retains score/layout/
   render state; the main thread retains render and spatial layers. Send
   versioned deltas, not snapshots.
4. **Stable handles are mandatory.** Every retained render/spatial layer has a
   generational handle so stale frames cannot mutate a newer document.
5. **Transforms are data.** Vertical/page movement should update a layer transform,
   not regenerate its commands or bboxes.
6. **Stop at reconvergence.** Width/page propagation continues only until prior
   system/page boundaries and metrics match.
7. **Scope before threading.** Do not add WASM threads to all-staff work that
   should not run.
8. **SAB is optional.** First make deltas small; use shared memory only if the
   measured residual justifies it.
9. **Correctness remains non-negotiable.** Scoped output is compared against
   edited-score full/no-cache output with non-vacuous engagement counters.

## 6. Target architecture

### 6.1 Dirty region

Introduce a shared engine type conceptually equivalent to:

```rust
struct DirtyRegion {
    measure_start: usize,
    measure_end: usize,
    time_start: ScoreTime,
    time_end: ScoreTime,
    affected_parts: BitSet,
    affected_flat_staves: BitSet,
    flags: DirtyFlags,
}

bitflags! {
    struct DirtyFlags {
        const CONTENT    = 1 << 0;
        const HORIZONTAL = 1 << 1;
        const VERTICAL   = 1 << 2;
        const SPANNER    = 1 << 3;
        const STRUCTURAL = 1 << 4;
        const GLOBAL     = 1 << 5;
    }
}
```

The TypeScript patch already carries `changedPartMeasures`; the WASM parser must
preserve that set instead of reducing it to `(changed_start, changed_end)`.

Mapping rules:

- `globalMeasures`, time/key/layout/staff topology: all relevant staves;
- part measure edit: flat staves whose `sources.part_index` intersects changed
  parts;
- condensed staff: mark the complete condensing source group;
- cross-staff event: mark home and target staff;
- system object: mark its owning staff plus system-object layer;
- structural patch or unknown dependency: explicit full fallback.

### 6.2 Persistent layout graph

Persist versioned nodes:

```text
ResolvedStaffNode
MeasureWidthNode
SystemHorizontalNode
SystemVerticalNode
PageNode
SpannerNode
RenderLayerNode
SpatialLayerNode
```

Each node stores:

- stable key;
- input generation/fingerprint;
- output generation;
- parent/dependency handles;
- cached output;
- optional rigid transform.

A pass visits only dirty nodes and dependents whose input generation changed.

### 6.3 Persistent render graph

Split each system into independently retained layers:

```text
System substrate layer
  staff lines, barlines, brackets, labels

Per-staff music layer
  notes, rests, stems, accidentals, articulations, local directions

System-object layer
  tempo, rehearsal marks, system text

Spanner layers
  per spanner / per source-target system pair
```

Patch frame v3 should support:

```text
upsertLayer(handle, binaryCommands, bboxDelta)
removeLayer(handle)
setTransform(handle, dx, dy)
setOrder(parent, handles[])
setPageMetadata(...)
```

The main thread retains layer command buffers and per-layer spatial indices. A
frame application touches only listed handles.

## 7. Implementation phases

## Phase 0 — trustworthy gates and telemetry

**Status: 🟡 Core gate shipped; scenario expansion remains.** The permanent
headed production-Chrome suite covers trusted width-neutral pitch and the
tested width-changing accidental, 30 warmed samples, deterministic engagement
counters, optimistic latency, phase telemetry, and CDP traces. Articulation,
insertion/duration, local spanner drag, and structural/global scenarios remain.

**Goal:** distinguish local, width-changing, and structural behavior and make
optimization engagement observable.

Tasks:

- Add permanent production-WASM scenarios for:
  - width-preserving pitch edit;
  - accidental/articulation edit;
  - note insertion that preserves width;
  - width-changing insertion/duration edit;
  - slur/tie handle edit;
  - global meter/layout change.
- Report p50/p95/max separately for:
  - patch build;
  - worker queue/boundary;
  - patch apply/reconcile;
  - resolve;
  - widths/precompute;
  - render generation;
  - transfer;
  - decode/layer apply;
  - spatial update;
  - paint.
- Add counters:
  - resolved staff-measure cells;
  - width staff-measure cells;
  - systems/pages propagated;
  - staff layers rendered;
  - spanners rebuilt;
  - transferred bytes;
  - spatial entries updated.
- Keep deterministic payload/command/bbox baselines separate from noisy time
  budgets.

Acceptance:

- Every scenario produces at least 30 measured iterations after warmup.
- No benchmark uses out-of-range dirty indices or a no-op edit.
- CI records results; hard gates apply only to deterministic counts and generous
  p95 safety ceilings until hardware-normalized runners exist.

## Phase 1 — measure × part/staff dirty scope

**Status: ✅ Shipped for the common local path.** `DirtyRegion`, affected-staff
scope, immutable snapshots, dirty-slice width validation, retained MMR plans,
and incremental duration/ottava derivatives reduce the permanent pitch gate to
1–2 of 17,340 cells. Conservative structural/global fallback remains by design.

**Goal:** reduce a normal edit from 34 resolved cells to 1–2.

Primary files:

- `engine/viritura-wasm/src/lib.rs`
- `engine/viritura-engine/src/layout/cache.rs`
- `engine/viritura-engine/src/layout/mnx_layout/auto_flow.rs`
- `packages/renderer/src/perfOverlay.ts`
- patch/serializer tests in editor and format packages

Tasks:

1. Parse `partMeasures` into affected-part and per-part measure sets.
2. Store `DirtyRegion` in `LayoutCache` instead of `pending_dirty_range`.
3. Build/cache part→flat-staff dependency mapping for the active layout.
4. In `resolve_staves_with_condensing_labels`:
   - untouched staff: reuse prior snapshot without visiting dirty measures;
   - touched staff: run existing carried-state convergence;
   - condensing/cross-staff: expand affected set conservatively.
5. Change `CachedResolvedStaff.resolved` and current-pass resolved storage to a
   shared immutable snapshot (`Arc<[ResolvedMeasure]>` or equivalent).
6. Remove `resolved_mut.clone()` from the common scoped path.
7. Scope natural-width work by affected staff while recomputing the cross-staff
   max only for dirty measures.
8. Move whole-score duration/ottava/clef-union setup behind versioned caches.

Correctness tests:

- one-part edit in full score: staff-scope counter < all staves;
- condensing source edit invalidates its group;
- cross-staff edit invalidates both staves;
- global key/time edit invalidates all staves;
- scoped == full == no-cache binary output.

Performance gate:

- resolve + natural widths <3 ms p50 on Rhapsody local pitch edits.

## Phase 2 — per-staff render layers and spatial deltas

**Status: 🟡 Substantially shipped.** PatchFrame v3, retained system/staff content
ranges, batched retained runs, transform-aware retained application, direct
paint before compatibility flattening, and incremental spatial replacement are
live. Fully independent public generational layer handles and the aspirational
<64 KB local frame are not complete; current local frames are roughly 338 KB,
but decode/application is already ~0.58 ms p50.

**Goal:** stop producing, transferring, decoding, and indexing an entire system
for a one-staff edit.

Primary files/packages:

- engine render loop and `DisplayList`/binary modules;
- `packages/renderer/src/patchFrame.ts`;
- Canvas tile/page caches;
- `SpatialIndex` and editor enriched-index integration.

Tasks:

1. Define stable `LayerHandle { documentGeneration, system, staff, kind,
generation }`.
2. Render system substrate and each staff into separate command/bbox/shape
   buffers.
3. Move absolute system/staff placement into layer transforms.
4. Add patch-frame v3 layer operations while retaining v2 fallback during
   migration.
5. Reconstruct/paint directly from retained layers; avoid assembling one giant
   JS `DisplayList` for the hot path.
6. Store spatial index entries per layer; update or rigidly translate only
   affected layers.
7. Keep export/full-frame paths able to flatten layers deterministically.

Correctness tests:

- v3 flattened frame == full display list;
- transform-only page reflow preserves commands and shifts every sidecar store;
- stale generation/unknown handle triggers safe full reseed;
- selection/hit test updates only changed layer and matches rebuilt full index.

Performance gates:

- render generation <3 ms p50 for local edit;
- transfer + decode/layer application <2 ms p50;
- incremental spatial update <1 ms p50;
- typical local patch <64 KB.

## Phase 3 — system/page stability frontier and stable horizon chunks

**Status: 🟡 Horizon suffix reuse shipped; full paged frontier remains.** Stable
Horizon chunks, dirty-system slot reuse, global staff-extents/tie-map retention,
and 169-system reuse are exercised by the permanent pitch gate. Exact page
boundary reconvergence for broader width-changing/structural workloads remains.

**Goal:** stop downstream propagation when layout membership reconverges and
eliminate all-chunk horizon invalidation.

Tasks:

1. Persist prior measure→system and system→page membership.
2. Start horizontal reflow at the dirty system (include required look-back for
   courtesy/carry state).
3. After each rebuilt system, compare:
   - first/last measure;
   - width/stretch state;
   - staff visibility/condensing membership;
   - vertical extrema;
   - page-ending measure and page metrics.
4. Stop and reuse the suffix when membership and page boundary match prior state.
5. Replace cumulative-width horizon repartitioning with either:
   - stable measure/tick-anchored chunks plus local overflow; or
   - a chunk reconvergence frontier that preserves the downstream suffix.
6. Represent downstream position changes as layer transforms.

Correctness tests:

- width-preserving edit stops at dirty system/page;
- width-changing edit propagates until stable then stops;
- manual breaks/MMRs/courtesy clefs/page-turn pagination force appropriate
  expansion or fallback;
- horizon output remains byte-identical to unchunked canonical output.

Performance gates:

- no local width-changing edit emits all 42 chunks unless membership genuinely
  changes to the end;
- horizon local-edit p95 <50 ms during transition, then <33 ms after Phase 2;
- propagated system/page counters are bounded and non-vacuous.

## Phase 4 — indexed spanner dependencies

**Status: 🟡 Partial and deliberately deferred.** Compact slur/tie snapshots and
staff/system-bound pruning are shipped with non-vacuous gates. An attempted
retained slur-topology map produced no total-bucket improvement and was removed.
Build the exact interval/fragment graph only against a measured failing scenario.

**Goal:** make cross-system overlay cost proportional to affected spanners.

Tasks:

1. Introduce exact score-time interval index for slurs, ties, hairpins, pedals,
   ottavas, and future spanners.
2. Maintain event/note ID→spanner adjacency.
3. Resolve each spanner to source/target system handles after horizontal layout.
4. Store rendered fragments per `(spanner, system-pair)` layer.
5. Dirty a spanner only when:
   - its model changes;
   - an endpoint event changes;
   - source/target system membership changes;
   - relevant boundary/vertical geometry changes.
6. Preserve Phase-R full overlay as a fallback until the indexed path is proven.

Correctness tests:

- all existing cross-system/stitched-horizon fixtures;
- non-vacuous affected/unaffected spanner counters;
- indexed overlay flattened output == current full overlay;
- duplicate IDs from condensed expansion select the same target as current code.

Performance gate:

- non-spanner local edit overlay <1 ms p50;
- single-spanner edit rebuilds O(connected fragments), not O(score spanners).

## Phase 5 — optimistic local feedback

**Status: 🟡 Shipped for tested pitch/accidental edits.** The accepted suite
measures ~0.19 ms optimistic p50 with generation-safe authoritative
reconciliation. Articulation and drag variants still need permanent scenarios.

**Goal:** keep visual interaction at frame rate while authoritative layout for a
large constraint island is pending.

Tasks:

- Maintain an editor overlay layer for the edited note/rest/spanner handle.
- Apply pitch, accidental, articulation, and drag changes immediately using the
  previous staff/system transform.
- Mark optimistic elements visually only if reconciliation exceeds one frame;
  avoid visible “double notes.”
- Replace/remove optimistic nodes atomically when the authoritative generation
  arrives.
- Never use optimistic geometry for serialization/export or authoritative hit
  testing after reconciliation.

Acceptance:

- input→visual p50 ≤16.6 ms for every local and width-changing scenario;
- no stale result can overwrite a newer optimistic/document generation;
- authoritative correction is visually stable (no large flash/jump for common
  edits).

## Phase 6 — optional WASM threads and shared command arena

**Status: ⏸ Not required by current measurements.** Retained PatchFrame
decode/application is ~0.58 ms p50 and single-threaded worker layout is 13.34 ms
p50. Keep transferable buffers and avoid COOP/COEP/thread complexity unless a
broader workload establishes a new residual bottleneck.

**Prerequisite:** Phases 1–4 measured and still above budget.

Tasks:

- deploy COOP/COEP for cross-origin isolation;
- parallelize independent touched-staff resolve/render tasks;
- evaluate a versioned `SharedArrayBuffer` layer arena/ring;
- keep transferable-buffer fallback for unsupported contexts;
- measure synchronization and false-sharing overhead.

Decision gate:

- If layer deltas already transfer/apply in <2 ms, do not add SAB complexity.
- If scoped engine work is <8 ms, threads are unnecessary for the common edit.

## 8. Byte-identity and protocol gates

Every phase must retain or replace the existing three-way oracle:

```text
incremental/scoped result
  == edited-score full cached result
  == edited-score no-cache result
```

Also require:

- non-vacuous optimization counters;
- patch-frame reconstruction equivalence;
- all sidecar stores compared (commands, IDs, bboxes, shapes, slur geometry,
  measure bounds, pages, page-turn warnings);
- deterministic ordering independent of hash-map iteration;
- generation-safe recovery to a full reseed;
- stitched-horizon canonical equivalence.

Layer-protocol versions may change byte encoding, but flattening the retained
layers must equal the authoritative full `DisplayList` until the full renderer is
explicitly migrated to a new canonical representation.

## 9. Risks and mitigations

| Risk                                           | Mitigation                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Condensing creates cross-part dependencies     | Expand dirty staff set to the complete condensing source group; full fallback until proven |
| Cross-staff notes affect another staff         | Record home/target staff dependency during promotion/layout                                |
| Layer ordering differs from monolithic render  | Stable parent order lists; flatten-equivalence oracle                                      |
| Relative transforms miss a sidecar store       | Central transform implementation and exhaustive store tests                                |
| Memory doubles while old/new protocols coexist | Instrument retained bytes; phase out v2 after equivalence gates pass                       |
| Stable handles reused after reset              | Document generation + per-handle generation counters                                       |
| Horizon stable chunks produce uneven work      | Local overflow/merge policy with maximum chunk budget                                      |
| Optimistic overlay diverges visibly            | Restrict to well-defined edit classes; one-frame threshold; atomic reconciliation          |
| Threads add overhead or nondeterminism         | Scope first; deterministic task outputs; optional measured rollout                         |

## 10. Delivery order

### Shipped chronology on the performance branch

1. Added trusted headed-browser gates, phase telemetry, traces, and deterministic
   non-vacuous counters.
2. Introduced `DirtyRegion`, part/staff scope, immutable snapshots, and
   incremental staff derivatives.
3. Added PatchFrame v3, retained system/staff partitions, incremental spatial
   replacement, and retained-layer direct paint.
4. Stabilized Horizon membership and retained its global staff dependencies.
5. Moved full-document assembly and compatibility-array reconstruction after
   authoritative paint.
6. Added optimistic feedback and hard pitch/accidental contracts.

### Remaining order

1. Normalize/isolate browser-runner host load: quiet integrated pitch is
   13.94 ms p50, while sustained loaded runs measured 19–26 ms p50 with the same
   1-cell/169-system counters.
2. Harden note-insertion p95 and extreme host/coalescer outliers without
   regressing its 34.99 ms p50.
3. Add a stable performance-only geometry hook for a real slur-handle pointer
   drag; the permanent slur mutation scenario and immediate drag preview exist.
4. Add representative paged width-changing fixtures that exercise the shipped
   shifted-ordinal membership reconvergence mapping and page-ending metrics.
5. Continue migrating ordinary commands to `ScorePatch`; slur and tie toggles
   are now migrated, while structural commands keep explicit full fallback.
6. Keep the ~338 KB local protocol unless transfer/application rises materially;
   current retained application is ~0.53 ms. Treat the ~47.8 MB global-meter
   fallback separately.
7. Reconsider indexed spanner fragments, SAB, or threads only if a measured
   scenario exceeds its contract after the preceding work.

Every follow-up must remain runnable, byte-identical, and measurable against the
preceding protocol. Do not turn optional phases 3–6 into a flag day.

## 11. Definition of done

### Achieved core target

- ✅ Trusted full-score local pitch authoritative p50 is **16.52 ms**, within the
  16.6 ms primary contract.
- ✅ The tested width-changing accidental has ~0.19 ms optimistic p50 and
  18.37 ms authoritative p50, within the 50 ms contract.
- ✅ Full-score common-path work scales with the 1–2-cell dirty island rather
  than all 17,340 staff-measure cells.
- ✅ Patch decode/application and spatial maintenance are incremental; retained
  layers paint before compatibility reconstruction.
- ✅ Every accepted optimization has byte-equivalence coverage and non-vacuous
  engagement counters; structural/failed patches retain a safe full fallback.

### Remaining completion criteria

- 🟡 Preserve the hard p50 gate after synchronizing with current `main`: achieved
  in a quiet run, but not yet stable under sustained host load.
- ✅ Bring trusted pitch p95 to ≤33 ms (current integrated run: 16.70 ms).
- 🟡 Permanent contracts cover articulation, insertion, slur mutation, and
  structural/global meter fallback; actual pointer-drag automation remains.
- ⬜ Demonstrate bounded page/Horizon propagation for representative
  width-changing edits.
- ✅ Decide from measurement whether roughly 338 KB local frames require stable
  fine-grained handles: **not currently justified** while application remains
  ~0.53 ms. Revisit only with contrary transfer/memory evidence.
- 🟡 Expand `ScorePatch` coverage: slur/tie toggles now use precise patches;
  complex structural commands still deliberately fall back.

SAB, WASM threads, a full arena-container migration, and an exact spanner
fragment graph are **not** unconditional completion criteria. They remain
measurement-triggered options.

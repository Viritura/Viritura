# Performance Architecture

> **Single source of truth for Viritura's layout/render performance** — the
> shipped architecture, the measured numbers, and the remaining roadmap to the
> per-edit latency target. Earlier performance investigations have been merged
> into this document.

## The target and the measured reality

**Goal:** per-edit p50 ≤ **16.6 ms** on a real orchestral score. The reference
workload is **Rhapsody in Blue, 510 measures × 33 parts** in the editor's
chunked-Horizon mode, using trusted keyboard input in headed production Chrome.

**Current accepted snapshot (performance branch after merging `origin/main`, 2026-07-12):**

| Scenario / phase                           |      p50 | Contract / status                                |
| ------------------------------------------ | -------: | ------------------------------------------------ |
| Width-neutral trusted pitch, authoritative | 13.94 ms | ✅ primary p50 ≤16.6 ms; p95 16.70 ms ≤33 ms     |
| Worker layout/RPC                          | 11.11 ms | ✅ below one frame at p50                        |
| Retained patch decode/application          |  0.53 ms | ✅ transferable buffers; SAB not justified       |
| Authoritative Canvas paint                 |  1.44 ms | ✅ retained-layer direct paint                   |
| Optimistic pitch feedback                  |  0.16 ms | ✅ immediate visual response                     |
| Width-preserving articulation              | 16.53 ms | ✅ bounded 1-cell PatchFrame scenario            |
| Local slur/spanner mutation                | 15.16 ms | ✅ `ScorePatch`; p95 18.09 ms                    |
| Note insertion                             | 34.99 ms | ✅ p50 <50 ms; p95 198.31 ms remains a tail risk |
| Structural global meter change             |   1.07 s | ✅ asynchronous fallback measured; no frame SLO  |

The branch is synchronized with current `main`. A quiet-window integrated run
meets the hard pitch p50/p95 targets, but repeated runs during sustained build,
test, and browser load measured 19–26 ms p50 while retaining identical 1-cell/
169-system engagement counters; p95 remained below 33 ms. Treat 13.94 ms as the
accepted low-load baseline, not hardware-normalized CI proof. Permanent headed scenarios now cover pitch,
accidental, articulation, note insertion, slur/spanner mutation, global meter,
and a CDP trace. Remaining performance work is concentrated in insertion tails,
actual pointer-drag automation, and structural/global latency—not the common
pitch path.

**Historical pre-plan steady-state cost** (retained for before/after context):

| Phase                                              | Cost            | Notes                                                    |
| -------------------------------------------------- | --------------- | -------------------------------------------------------- |
| Edit → paint (felt)                                | **~190 ms**     | what the user experiences for one isolated edit          |
| ↳ pure engine (`applyPatchAndLayout`)              | **~137 ms**     | the WASM layout call — the lever target                  |
| ↳ Comlink worker boundary                          | **~50 ms**      | structured-clone of the ~527 KB patch payload off-thread |
| ↳ decode + reconstruct                             | ~3 ms           | main-thread frame decode + `PatchReconstructor`          |
| JS-side (serialize, patch-build, optimistic paint) | single-digit ms | already optimized — **not** the bottleneck               |

> **Implementation update (2026-07-12):** the table above is the pre-plan
> baseline. The isolated performance branch now scopes resolve/width work to
> 1–2 of 17,340 staff/measure cells, emits one fresh + 101 reused Horizon
> systems, publishes React state after authoritative paint, applies spatial
> deltas, and provides sub-1-ms optimistic feedback. PatchFrame's retained
> system partitions now act as a coarse Horizon paint index. In a controlled
> headed production-Chrome A/B, this reduced Canvas paint p50 from 35.82 ms to
> 17.89 ms. Changed systems now also retain compact per-staff content ranges;
> systems without cross-staff events reuse independent layers on both sides of
> the edit, while cross-staff systems remain prefix-only. The representative
> native local-part probe improved from 37.0 ms to 32.8 ms
> p50 while preserving full/no-cache byte identity. Cross-system snapshots now
> prune bounds unreferenced by surviving slur/tie nodes, reducing the measured
> native slur bucket from ~8.7 ms to ~6.4 ms. MMR grouping is now shared by weak
> identity when the exact first-staff snapshot is unchanged; edits to that
> snapshot conservatively recompute. Duration histograms now update over only
> rerun measures, and ottava ranges retain identity unless their declarations
> change. This reduced the distributed native local-part probe to 20.0 ms p50;
> a quiet-window headed production-Chrome pitch run measured 28.26 ms
> authoritative p50 and 14.13 ms Canvas p50. At that checkpoint the
> authoritative 16.6 ms target remained open.
> Adjacent retained staff layers now reconstruct as contiguous runs, reducing
> the distributed native local-part probe further to 17.5 ms p50.
> Sharing each fresh system immutably between retention and PatchFrame reduced
> that probe to 15.3 ms p50. Headed telemetry now separates worker RPC from JS
> reconstruction; a representative run measured 31.29 ms worker p50 and 2.92
> ms reconstruction p50, leaving production WASM/worker layout as the main gap.
> The equivalent native chunked-Horizon workload was 27.9 ms p50, revealing a
> Horizon-only global staff-protrusion scan rather than a 2× WASM penalty.
> Retaining per-staff protrusion summaries reduced native Horizon to 24.0 ms
> p50 and headed worker p50 to 25.8–27.4 ms; a repeat headed run measured 24.08
> ms authoritative p50.
> Retaining per-staff Horizon tie-accidental maps then reduced headed worker
> p50 to 17.63 ms, with 2.18 ms reconstruction, 12.26 ms Canvas paint, and 25.0
> ms authoritative p50.
> Reusing matching measure-layout slots inside the one dirty chunk reduced
> worker compute to 13.66 ms p50 / 15.59 ms p95. Horizon sticky-overlay staff
> detection now collapses measure bounds to physical rows rather than processing
> duplicate chunk rows; a subsequent run measured about 20.9 ms authoritative
> p50.
> The final hot path paints retained Horizon layers before rebuilding flattened
> compatibility arrays, defers successful-patch full MNX assembly until after
> authoritative paint, avoids a
> duplicate direct-paint selection overlay, and scans only dirty width slots
> when MMR identity proves alignment. The permanent 30-sample headed gate now
> measures **16.52 ms authoritative p50** in the final accepted full-suite run
> (13.34 ms worker, 0.58 ms retained decode/application, 1.58 ms Canvas,
> 0.34 ms command processing, 0.15 ms delta preparation), meeting the primary
> 16.6 ms contract.

**The wall is visit-count, not visit-cost.** 510 × 33 = **17,340 measure-layouts
are visited on every edit, even at 100% cache reuse** — page mode with a perfect
measure cache is still ~438 ms (horizon was 1016 ms before Lever 0). The cache
spares the per-measure _recompute_; it does not spare the _visit_. You cannot
reach 16 ms by making 17,340 operations faster — you reach it by **not doing
17,340 operations.** That single fact orders the whole roadmap: the dominant
lever is **O(viewport) — stop walking the whole score per edit**; the arena
(making each surviving visit cheaper) is a multiplier on top of it, not a
substitute.

### Measured per-edit breakdown (audited 2026-07-11, release, Rhapsody warm cache)

Re-measured from the in-tree engine probes (`cargo test -p viritura-engine --lib
--release <probe> -- --ignored --nocapture --test-threads=1`) so the next steps
are triaged from data, not memory. **These numbers supersede the older felt-cost
table above for engine-internal triage.**

The editor-representative bucket path is `lever1_scoped_render_loop_probe`: a
re-justifying pitch edit with the dirty range set and B-full wholesale system
reuse ON (the live WASM defaults). On the current fixture it skips **482 systems**
(`render_hash_skips = 482`). Re-running it during the July audit measured:

| Bucket                            | ms        | Notes                                          |
| --------------------------------- | --------- | ---------------------------------------------- |
| `pass3 render loop`               | **16.0**  | the ~28 non-skipped systems on the edited page |
| `resolve_staves + mmr_grouping`   | **14.8**  | already measure-range-scoped, not staff-scoped |
| `cross_system_slurs`              | **8.1**   | global overlay on a Phase R cache miss         |
| `pass1 precompute_system_layouts` | 6.4       | parent bucket; overlaps its sub-buckets below  |
| `natural_widths`                  | 6.2       | scoped but still re-runs all staves in range   |
| `cross_system_ties`               | 3.3       | global overlay on a Phase R cache miss         |
| `precompute.fresh_build`          | 2.8       | included in `pass1`; do not sum both           |
| `slurs+ties+pages+debug`          | 1.8       |                                                |
| `precompute.reuse_move`           | **0.018** | ← retention move                               |
| `restore measures+fit`            | **0.016** | ← retention restore                            |
| `precompute.hash`                 | **0.010** | ← retention hash                               |

**Headline finding that re-orders the roadmap:** the three retention buckets
(`reuse_move` / `restore` / `precompute.hash`) — exactly what the "container /
`memcpy` retention" work below targets — are **already ~0.02 ms each** in the live
config. In the _unscoped_ baseline (reuse OFF) they were 5.5 ms + 12.3 ms + 2.1 ms;
**B-full wholesale system reuse (shipped, live) already collapsed that ~20 ms of
per-measure `HashMap` churn to ~0.05 ms.** So the doc's previously-stated "~7 ms/
edit `HashMap` churn" prize for the container arena **is already captured** — the
container slice/`memcpy` work is **no longer the highest-value next step**.

Two other audited facts:

- **The previously-reported full-relayout spikes were a probe bug, not an engine
  result.** The old `perf_split_rhapsody_scoped` never edited the score and used
  dirty indices `0,100,…,700`; Rhapsody has ~510 measures, so 600/700 manufactured
  the `17,340` full-span fallbacks and the **206.8 ms** p50. The corrected probe
  performs 20 real note edits evenly across valid pitched measures, enables the
  live cache defaults. Repeated audited runs measured **~63–77 ms p50**
  (62.9 ms on the latest integrated production build) with a stable resolved span of
  **34 / 17,340 (0.2%) on all 20 iterations**. There is no measured scope-collapse
  priority at present.
- **Cross-system overlay is the largest un-scoped engine cost** (~11.4 ms =
  8.1 slurs + 3.3 ties in the latest integrated run), because it is O(all spanner
  events) on a cache miss and is
  not part of the per-system clean-skip. This is the deferred "cross-system scan
  scoping" item (Lever 1 §remaining), now empirically the top arena-adjacent lever.

### Route to a 16.6 ms frame (July 2026 architecture decision)

The browser and Rust→WASM boundary are **not** the fundamental blocker. On the
same current score/edit, native release layout is ~63 ms and direct production
WASM patch layout is ~70–80 ms: WASM costs margin, not the 4–5× gap. Patch output
already transfers zero-copy. The remaining cost is chiefly granularity:

- the patch carries changed **parts**, but the engine collapses that to one
  measure range and resolves the dirty measure on all 34 flat staves;
- one fresh render segment is an entire system (all staves), so a one-staff note
  edit generates/decodes/reconstructs hundreds of KB;
- cross-system spanners are globally collected/rendered on a cache miss;
- the main-thread spatial index is rebuilt as one global structure (immediate in
  Engrave mode);
- page/system/chunk propagation is cache-based but not a first-class dependency
  frontier. A width-changing horizon edit can shift cumulative chunk boundaries
  and make all 42 chunks fresh (~500 ms / ~43 MB), while a width-preserving edit
  stays at 1 fresh + 41 reused (~80–90 ms p95).

#### Staff count vs. score length (measured scale matrix)

A temporary native-release matrix used the same Rhapsody model, live cache
defaults, and repeated real pitch edits while varying full-score/part view and
truncating the single-part score. The probe was removed after measurement:

| View                                   | Measures |          p50 |  p95/max |
| -------------------------------------- | -------: | -----------: | -------: |
| Full score (33 parts, ~34 flat staves) |      510 | **72.49 ms** | 83.52 ms |
| Single part                            |      510 |  **1.27 ms** |  1.46 ms |
| Single part                            |      256 |      0.98 ms |  1.16 ms |
| Single part                            |      128 |      0.53 ms |  0.72 ms |
| Single part                            |       64 |      0.37 ms |  0.51 ms |

The primary scale boundary is therefore **staff count and cross-staff/system
aggregation**, not length alone. Length is still visible (the single-part path
grows roughly with measure count) because resolved vectors are whole-score
snapshots and natural-width setup scans global durations/ottavas/clef unions, but
its absolute cost is small for one staff. The full score is ~57× slower than the
same 510-measure single-part view.

Tick-range invalidation helps the **length axis**: it gives precise carried-state
and spanner interval boundaries and supports stable reconvergence. It
does not fix orchestral scaling if every staff still processes that tick range.
The required unit is a 2-D dirty rectangle: **tick/measure range × affected
part/staff set**, with dependency flags for horizontal, vertical, spanner, and
structural propagation.

Horizon chunking currently optimizes only the **horizontal/length axis**. Each
chunk still contains every staff; all-staff resolve/width setup and global
spanner work remain. Its cumulative-width chunk boundaries also make the length
partition unstable under a local width change, explaining the all-42-fresh tail.

This is analogous to a game/physics engine whose broad-phase and component
storage exist, but whose dirty island is still the whole scene layer. The route
is a persistent, versioned layout/render graph—not more micro-optimization of
the current all-staff/system passes:

1. **2-D dirty region (measure × part/staff).** Preserve the existing
   `partMeasures` set through the WASM patch parser into `LayoutCache`, map parts
   to `FlatStaff` sources, and re-resolve/recompute widths only for intersecting
   staves. Global-measure/layout changes still mark all staves. Share immutable
   resolved-staff snapshots between the current pass and cache (for example
   `Arc<[ResolvedMeasure]>`) so the current `resolved_mut.clone()` does not copy
   every staff's 510-measure vector each edit. The current 34-cell resolve span
   should become 1–2 cells for a normal part edit. **First implementation
   target:** resolve + natural-width work from ~21 ms to <3 ms.
2. **Persistent render layers, not whole-system fresh segments.** Split each
   system into stable layers: substrate/system furniture, per-staff music,
   system objects, and spanner layers. Patch-frame v3 should upsert/remove layer
   handles and apply transform-only placements. A note edit re-renders one staff
   layer; vertical reflow translates downstream layers without regenerating
   commands. Keep the spatial index per layer and update/translate only changed
   entries. **Target:** render + decode/reconstruct + spatial update <5 ms and a
   normal patch in tens, not hundreds, of KB.
3. **Dependency/frontier propagation.** Persist measure→system→page membership.
   Start at the dirty system and propagate until system membership and the page's
   ending measure/vertical metrics match the previous layout, then reuse the
   untouched suffix. Anchor horizon chunks to stable measure/tick ranges (or use
   the same reconvergence frontier) so one local width change cannot repartition
   every downstream chunk.
4. **Indexed spanner dependencies.** Add an event/tick interval index plus
   event→spanner and spanner→source/target-system adjacency. Rebuild only
   spanners touching dirty systems; store overlay segments per spanner/system
   pair. This is the notation equivalent of physics broad-phase/island solving.
5. **Parallelism and shared memory only after scoping.** Independent affected
   staves/layers are suitable for WASM threads once COOP/COEP is deployed, but
   threading an O(all-staves) pass is secondary to making it O(affected staves).
   `SharedArrayBuffer` can remove the last copy/object-decode costs, but a small
   layer delta may make SAB unnecessary for the common edit.

The required model is a **stability frontier**: begin partial page layout at the
affected system, include one earlier measure for carried state, and stop once
system/page membership reconverges with the retained layout. Viritura's content
hashes, worker, EventArena, and patch frames are good foundations; the next step
is finer dependency granularity.

Do not promise every operation a final globally-correct frame in 16.6 ms. Use
three SLO classes:

| Edit class                                             |                 Visual response |    Authoritative layout target |
| ------------------------------------------------------ | ------------------------------: | -----------------------------: |
| Pitch/accidental/articulation/local drag               |        ≤16.6 ms p50, ≤33 ms p95 |                   ≤16.6 ms p50 |
| Width-changing note/duration insertion                 | optimistic local layer ≤16.6 ms |   ≤50 ms p50; bounded frontier |
| Structural/global changes (meter/layout/part topology) |           UI remains responsive | asynchronous, no 16 ms promise |

For hard edits, render the changed notation immediately in an optimistic overlay
using prior system geometry, then reconcile when the worker's authoritative
layout arrives. This is the same multi-rate model used by game engines: input and
render stay at frame rate while a larger constraint island settles separately.

---

## What exists today (shipped architecture)

### Engine & rendering pipeline

- **Rust → WASM layout engine** (`engine/viritura-engine`, `engine/viritura-wasm`).
  Single-threaded today.
- **`CachedLayoutEngine`** — measure-id-keyed layout cache; a single-measure edit
  re-lays-out only the touched measure(s) and reuses the rest.
- **Binary display list** — the engine emits a tagged `Float32Array` of render
  commands (`render/binary.rs`), not direct canvas calls. Commands: `DrawGlyph`,
  `DrawLine`, `DrawBezier`, `DrawText`, `SetColor`, `PushClip`/`PopClip`. Compact,
  parse-free on the JS side, transferable (one copy per pass; a
  `SharedArrayBuffer`-backed buffer is planned for the cross-origin-isolated app
  origin — see Roadmap §Lever 3).
- **Glyph atlas** (`glyphAtlas.ts`) — pre-rasterizes the common SMuFL set per zoom
  level. **5-page OffscreenCanvas page cache** (`pageCache.ts`) with a sliding
  window + virtual scrolling.

### Per-edit retention (the patch-frame path)

This is the machinery that makes a one-measure edit _not_ re-emit the whole
display list:

- **Patch frames.** A patch-enabled layout pass produces a delta: per-system
  segments tagged `Fresh { segment }` or `Reuse { prev_index, dy }`. The
  main-thread **`PatchReconstructor`** holds the prior segments and reassembles
  the frame by reference — fresh systems are decoded, reused systems are
  referenced and shifted by a single `dy` scalar.
- **Two backends, both on the patch path.** The default **worker backend**
  (Comlink-wrapped `DedicatedWorker`) calls
  `engineApplyPatchAndLayoutPatchFrameBinary` → `Comlink.transfer` (zero-copy) →
  main-thread `decodeFrame` + reconstructor. The **main-thread fallback**
  (`makeMainThreadBackend`, used only if the worker fails to init) routes through
  the same decode + reconstructor. (The patch path is bypassed only when the
  geometry-debug sidecar `emitLayoutDebug` is on — a deliberate degradation for
  the debug overlay, never the perf HUD.)
- **Layout coalescer** (`layoutCoalescer.ts`) — the single layout worker processes
  edits FIFO, so fast typing builds a queue. The coalescer keeps **one in-flight +
  one pending** request, dropping stale intermediates: a fast burst settles in
  ~2–3 computes instead of N serial ones, and the final paint reflects the latest
  model. (A trailing-edge drain guarantees the last edit always lays out.) The
  `mnxJson` fallback effect defers to the coalescer whenever it's registered, so
  held edits don't leak into uncoalesced full relayouts.
- **Generation-safe reset.** Worker RPCs are not cancellable. `LayoutCoalescer`
  tags each dispatch with a reset generation so an old document's completion
  cannot mark a newer generation idle or drain its pending request concurrently;
  the paint path also re-checks currency after `await` and suppresses stale
  display-list/spatial-index commits.

### Cache correctness invariants (audited July 2026)

- **Exact config identity.** `LayoutCache::check_config` compares a complete
  `LayoutConfig` snapshot, not a hand-maintained subset hash. The former hash
  covered only 25 of 70 fields and could retain stale geometry after changes to
  slur/tie settings, text styles, placement metrics, page-turn policy, or horizon
  chunking.
- **Phase R global overlay.** The cache stores only expensive cross-system
  slur/tie commands. Page-turn hints are rendered fresh exactly once (the former
  combined cache could append old hints and then render current hints again).
  Identity reuses the ordered per-system render hashes + absolute system Y +
  slur bounds + seam mode, avoiding a duplicate O(all-events) signature walk
  while covering the same complete content/geometry inputs as segment retention.

### RangeScope — per-pass dirty-range scoping (Lever 1, "cheap half")

Every front-half pass already skips the per-measure _recompute_ outside the
patch's dirty range; the toggles live on `LayoutCache::range_scope`
(`engine/viritura-engine/src/layout/cache.rs`). The WASM `LayoutEngine` ships
with:

| Toggle              | Default | Pass                                                                                                                                               |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scoped_resolve`    | **ON**  | `resolve_staves` — reuse prefix, re-run dirty span, splice suffix once carried clef/key/time fingerprint reconverges (~1–2 measures past the edit) |
| `scoped_precompute` | **ON**  | `natural_widths` + `precompute_system_layouts` — trust cached width / system spacing outside the dirty range                                       |
| `scoped_breaks`     | OFF     | break planner is trivially cheap (~0.03 ms); not worth scoping                                                                                     |
| `scoped_slurs`      | OFF     | cross-system scan scoping — deferred (see Roadmap)                                                                                                 |

A `|dirty| > K` guard (K = 16 measures, `DEFAULT_RANGE_SCOPE_K`) falls back to a
full layout for pathological edits (meter change, structural insert).

### Lever 0 — horizon retention (shipped + live)

Horizon (continuous/galley) mode used to run **zero** retention — every edit
re-laid the whole score (1016 ms). Three changes fixed it: (0a) **stitched
chunking** splits the galley into retention-sized chunks so per-system reuse has
units to reuse; (0b) a **constant galley vertical offset** replaces the
content-derived global `fit_unpaged_bounds` translate; (0c) **patch frames in
chunked horizon** ship the offset as a `galley_offset_y` scalar applied by the
reconstructor. Result: horizon **1016 → ~72 ms** (now slightly faster than page
mode). Live in the editor.

### Lever 1 — per-region clean-system skip (shipped)

The render loop used to do O(all-systems) work every edit even when one system
was fresh. The clean-system skip removes that:

- **Break-plan stability proof.** Hash the system-break membership (which measures
  land in which system). When it matches the prior pass, a width-changing edit
  cannot have occurred, so every system outside the dirty range is provably
  byte-identical and reuses its prior `render_hash` instead of re-walking its
  measures.
- **Per-system staff-offset reuse.** The dominant render-loop cost was
  `compute_staff_y_offsets_for_system` (an O(staves × measures) protrusion scan)
  run for _every_ system. Each system's staff offsets are cached _relative_ to its
  base; a clean system reconstructs them as `rel + sys_y_base` and skips the scan.
- **Per-page justification scoping.** A height-changing edit (growing ledger lines)
  re-justifies the edited system's _page_. Stability is split into a **global** part
  (break membership + margins) and a **per-system** part (each system's own
  `(justified_gap, intra_clearance)`, compared individually). Systems on unaffected
  pages keep byte-identical gaps and stay skippable. **Measured: render loop
  54 → 20 ms** on a re-justifying pitch edit (489 of ~510 systems skipped), the
  most common edit type.

All of the above is gated by the `lever1_*` byte-identity oracles (non-vacuous
skip + byte-identical to a from-scratch layout).

### Lever 2 — SoA arena foundation (reader/mutator migration complete)

The arena migration replaces the deep `Clone`/alloc of the nested
`MeasureLayout → VoiceLayout → EventLayout → NoteLayout` tree with flat columnar
buffers. _(Historical note: this was originally motivated by per-measure
`HashMap` churn dominating the per-edit floor; the 2026-06-07 re-measurement
shows B-full wholesale system reuse already drove that churn to ~0.05 ms, so the
remaining payoff is render-path cache locality and unblocking the SAB boundary,
not the retention buckets.)_

- **`EventArena`** (`layout/arena.rs`) — `VoiceLayout.events` is now struct-of-arrays
  (flat per-event scalar buffers + a CSR offset table for the per-note arrays).
  `translate_x` is a single flat-buffer pass; round-trip to/from `EventLayout` is
  byte-exact. The model `Event` payload and grace-note vectors remain parallel
  AoS columns, and a limited set of complex readers (beams, tuplets, fermatas,
  bbox compatibility paths, the multi-voice rest-conflict solver) still call
  `to_event_layout`/`to_events`; the hot `render_event` path does not.
- **Reader/mutator migration (complete).** _Every_ production reader and mutator
  now goes through the arena directly — there are zero `events_vec()` /
  `with_events_mut` calls left in shipping code. Notes-only loops use the scalar
  accessors (`x(i)`, `event(i)`, `stem_up(i)`, `beat_position(i)`,
  `note_positions(i)`); the few sites that must hand a whole `&EventLayout` to a
  helper use the single-event `EventArena::to_event_layout(i)` materializer (drops
  the per-voice whole-vector clone while keeping helper signatures). Migrated:
  glissando, hairpins, pedals, volta, lyrics, tremolos, beams (incl. cross-barline
  and grace), ties, tuplets, fingerings, fermatas/trills/ornaments, arpeggios,
  articulation bbox, tie-accidental map, the slur/tie collectors
  (`collect_global_slur_events`, `collect_global_tie_notes`,
  `build_slur_event_obstacle_maps`, `compute_slur_role_map`,
  `compute_slur_nest_depths`, `build_event_tie_chains`), the dynamics/expression/
  tempo skyline scans in `render_annotations`, the bbox event-walk in
  `render_geometry/helpers`, the measure-layout read scans, and the **main
  `render_measure` event render loop**. Per-measure **mutation** passes
  (notehead-share x-shift, stem normalization, mid-clef shift, cross-staff
  reposition, covered-rest suppression, the multi-voice rest-conflict solver)
  write in place via the index-based setters (`set_x`, `set_stem_up`,
  `event_mut`, …) instead of the clone-mutate-`from_events`-rebuild roundtrip.
- **Transitional API removed.** `with_events_mut` is deleted; `events_vec()` is now
  `#[cfg(test)]`-only (AoS-style test assertions) and is no longer part of the
  shipping API surface. Verified by a release lib build that has zero dependency on
  it.
- **B-full per-system wholesale reuse** (`set_system_layout_reuse`, wired live) —
  a clean system is moved back in _whole_ (one move + uniform x-translate) instead
  of a per-measure `HashMap::remove` + struct rebuild.
- **Cheap cross-system alloc scoping** — the cross-system slur/tie passes scope
  their `idx_map`/`note_map` to referenced targets instead of all ~95K events.

Validated throughout by the **byte-identity oracle** (full engine suite green at
every step — 1276 tests; the `system_layout_reuse_byte_identical_and_non_vacuous`
oracle proves wholesale reuse is byte-for-byte the per-measure path) and a clean
shipping WASM build.

> **Note on leverage.** This foundation is a _cold-load_ win (it makes each
> surviving per-measure visit cheaper / alloc-free) but is **not** the per-edit
> steady-state win on its own — the clean-system skips (Lever 1) already keep the
> render path off most systems. The container `memcpy` retention it was meant to
> unblock targets a bucket the 2026-06-07 re-measurement shows is already ~0.02 ms
> (see the per-edit breakdown), so that follow-on is now deprioritized.

**Shipped this campaign (engine, all byte-identical, on `main`):**

- Reader/mutator migration off `events_vec()`/`with_events_mut`; `with_events_mut`
  deleted; `events_vec()` gated `#[cfg(test)]` (commits through `3ae1ab3e`).
- `render_event` deep migration — `render_event`, `render_accidentals_stacked`,
  `render_articulations` (+ sub-helpers), `render_tremolo` take
  `(events: &EventArena, ei)`; `render_measure` loop drops the per-voice
  `Vec<EventLayout>` (`9184fe00`).
- `Rc<str>` ids on `GlobalSlurEvent`/`GlobalTieNote` so the per-edit retention
  clone (`splice_retained_slur_data`) is a refcount bump (`5642b12e`).
- Non-vacuous byte-identity oracle for the cross-system spanner retention path,
  `cross_system_spanner_retention_is_byte_identical` (`0085acca`) — the safety net
  for any future id-representation change (incl. `u32` interning).

**Reproduce the measurements** (from a clean checkout; the live editor config is
`page_width: Some(816.0)`, B-full reuse + scoped resolve/precompute ON):

```
cd engine
cargo test -p viritura-engine --lib --release lever1_scoped_render_loop_probe \
  -- --ignored --nocapture --test-threads=1   # editor-representative bucket breakdown
cargo test -p viritura-engine --lib --release perf_split_rhapsody_scoped \
  -- --ignored --nocapture --test-threads=1   # wall p50 + resolved-span fallback trace
cargo test -p viritura-engine --lib --release precompute_sub_timing_probe \
  -- --ignored --nocapture --test-threads=1   # reuse OFF vs ON, unscoped worst case
```

If `main` is mid-edit by another agent and won't compile, measure against the last
green commit in a throwaway worktree: `git worktree add --detach ../perf <sha>`.

---

## The lever roadmap (what's left)

The original Lever 0–3 sequence is now mostly an implementation history. Use
this section—not the historical cost tables above—for current priorities.

| Lever / capability                            | Current status                                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Horizon retention**                      | ✅ Shipped: stable chunks, retained systems/staff layers, global staff extents and tie maps, retained-layer direct paint                                                    |
| **1. O(dirty island)**                        | ✅ Common pitch path shipped: `DirtyRegion`, 1–2-cell resolve/width work, clean-system and dirty-system-slot reuse, compact spanner bounds                                  |
| **2. Arena / SoA**                            | ✅ Hot reader/mutator migration shipped; deeper container conversion is optional and currently low leverage                                                                 |
| **3. Stateful worker boundary**               | ✅ Retained worker score + patch IR + PatchFrame v3 + transferable buffers shipped; decode is ~0.58 ms p50                                                                  |
| **SAB / WASM threads**                        | ⏸ Deferred: current transfer/decode is below 2 ms and worker p50 is within budget; do not add COOP/COEP/thread complexity without a new measured need                       |
| **Page frontier / indexed spanner fragments** | 🟡 Partial: stable Horizon chunks, compact dependency snapshots, and system-membership reuse shipped; full page reconvergence and fragment graph remain optional follow-ups |

### Next session — start here (measured priority order)

1. **Stabilize the pitch gate under host contention.** Repeated loaded runs moved
   worker p50 from 11.11 ms to 15–20 ms and Canvas from 1.44 ms to 2–4 ms without
   changing work counters. Add runner load normalization or isolate the residual
   scheduling/CPU-frequency variance before calling integration fully stable.
2. **Harden insertion tails.** Note insertion meets the 50 ms p50 contract at
   34.99 ms but has a 198.31 ms p95 and one 1.06 s host outlier. Trace and split
   command/coalescer scheduling from the 23.88 ms worker and 6.37 ms retained
   reconstruction medians.
3. **Automate an actual pointer drag.** Slur mutation is now a permanent trusted
   scenario and uses `ScorePatch`; the existing immediate drag preview still
   needs a stable headed selector/geometry hook for pointer automation.
4. **Target structural fallback only where UX requires it.** Alternating meter
   changes intentionally rebuild all 17,340 cells and emit a ~47.8 MB full
   PatchFrame, measuring ~1.07 s p50. This is asynchronous and outside the frame
   SLO, but progress/cancellation/coalescing must remain responsive.
5. **Continue command migration opportunistically.** Slur and tie toggles now
   join pitch, accidental, articulation, transpose, and other migrated commands
   on `ScorePatch`. Complex structural commands still use explicit full fallback.
6. **Exercise shifted page reconvergence with more fixtures.** Exact current→prior
   system-membership mapping now allows a changed prefix to reuse a suffix even
   when ordinals shift; deterministic mapping and byte-identity tests are green.
   Page-ending metric reconvergence remains a follow-up for a measured paged case.
7. **Do not shrink local frames yet.** Pitch/slur frames are ~338 KB and apply in
   ~0.53 ms. Articulation is ~339 KB and insertion ~404 KB. These measurements do
   not justify fine-grained handle complexity; the 47.8 MB structural frame is a
   separate full-fallback problem, not evidence against the local protocol.

The **container slice / `memcpy` retention + `u32` id interning** work
(previously "the prize") is now explicitly **deprioritized** — its target bucket
is already ~0.02 ms. Keep it for when the SAB boundary (Lever 3) needs contiguous
arena storage, or revisit if a future edit pattern re-grows the retention buckets.

### Lever 1 — the remaining structural half

The common pitch path now resolves/validates 1–2 staff-measure cells, moves clean
measure slots out of the dirty system, and reuses the stable Horizon suffix.
Remaining structural work concerns harder edits:

1. **Page reconvergence frontier.** Paged width-changing and structural edits can
   still propagate farther than necessary. Persist page-ending membership and
   vertical metrics so rebuilding stops when the prior frontier reconverges.
2. **Exact indexed spanner fragments.** Compact snapshots and bound pruning are
   shipped. A per-spanner/system fragment graph remains optional for workloads
   where overlay work becomes dominant again; a simpler retained topology map
   did not improve the measured path and was reverted.
3. **Complete the `ScorePatch` command surface.** Bounded layout depends on a
   command naming affected measures/parts. Commands still using whole-score
   updates should migrate for both collaboration deltas and incremental layout.

### Lever 2 — completing the arena

The `EventArena` foundation and the **full reader/mutator migration are done** (no
`events_vec()`/`with_events_mut` in shipping code). The **`render_event` deep
migration is also done**: `render_event`, `render_accidentals_stacked`,
`render_articulations` (+ its sub-helpers), and `render_tremolo` now take
`(events: &EventArena, ei)` and read the columns by index, and the main
`render_measure` loop no longer materializes a per-voice `Vec<EventLayout>` at all —
removing the last per-event materialization on the render path. The retained
cross-system spanner structs (`GlobalSlurEvent`/`GlobalTieNote`) now carry
`Rc<str>` ids, so their **ID components** are refcount bumps instead of string
heap allocs during `splice_retained_slur_data`. The surrounding vectors/model
payload are still cloned; the entire retained-struct clone is not O(1).
A non-vacuous byte-identity oracle (`cross_system_spanner_retention_is_byte_identical`)
now covers that path (the six default retention fixtures were vacuous on
cross-system spanners). What remains is optional container-level cleanup rather
than a prerequisite for the achieved frame budget:

- **Container types** — `MeasureLayout`/`SystemLayout` could become arena slices
  if future memory profiles justify it. Dirty-system slot moves and shared
  `Arc<DisplayList>` ownership have already removed the measured common-path
  clone/`HashMap` costs.
- **`GlobalSlurEvent` / `GlobalTieNote`** → arena slice views; `u32`-interned event
  IDs. **Investigated to implementation depth and folded here deliberately:** these
  structs are retained in the cache and spliced into a _later_ layout's consumption
  pass, so interned `u32`s must stay stable across layouts — which requires a
  _persistent, cache-resident interner_ threaded through every collection +
  consumption site (the non-cached `layout_full_score` path included). That interner
  is container-retention infrastructure, and over the `Rc<str>` ids already shipped
  it buys only ~tens of KB + ~tens of µs of render-hash time (the SipHash →
  identity-hash win is not a standalone per-edit win). So it lands with the
  slice-view migration, not before it.

### Lever 3 — retained worker/render state shipped; SAB and threads deferred

The worker owns a stateful `LayoutEngine`, retains the promoted score and layout
graph, applies small part/global-measure patches, and transfers PatchFrame v3
buffers by ownership. The main thread retains system/staff layers, paints them
before flattening compatibility arrays, and patches the spatial index by dirty
measure.

`SharedArrayBuffer` and WASM threads remain intentionally deferred. They require
COOP/COEP and add synchronization/fallback complexity, while the accepted run
already measures ~0.58 ms for retained decode/application and 13.34 ms worker
p50. Reconsider only if broader scenarios or larger reference scores establish
a measured residual that transferable buffers and scoped single-threaded layout
cannot meet.

---

## Reference

### WASM ↔ JS data transfer

| Data                               | Direction | Strategy                                                             | Why                                              |
| ---------------------------------- | --------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| Score model                        | JS → WASM | MNX JSON string copied into WASM memory                              | one-time-ish; the input-O(score) Lever 3 removes |
| Display list                       | WASM → JS | PatchFrame v3 tagged binary `Float32Array`, transferred by ownership | compact, parse-free on JS                        |
| Layout results (positions, breaks) | WASM → JS | same binary display list, doubles as spatial-index input             | hit-testing on JS side                           |
| Incremental edits                  | JS → WASM | patch frame (Lever 3: patch IR applied to retained `Score`)          | avoids re-serializing the document               |

### The byte-identity oracle (the correctness gate)

Every retention/scoping/arena change is gated by an **edit-driven three-way
byte-identity oracle**: the range-scoped/skipped/arena result must be
byte-for-byte identical to (a) a full from-scratch layout and (b) a no-cache
layout of the _edited_ score — not just a static re-layout. Plus a **non-vacuous**
guard (the optimization must actually have engaged: `render_hash_skips > 0`,
`system_layout_reuse_hits > 0`, etc.) so a no-op can't pass. This is what lets the
arena and skip work land without visual regressions across all 71 MNX fixtures.

### Cache hierarchy (the working-set model)

The score model itself is small (a few MB) and is held whole in memory — there's
no benefit to streaming it the way a DAW streams audio. The expensive things are
**downstream** of the model, and _those_ are windowed:

```
Y.Doc (whole) → layout cache (per-measure / per-system retention)
            → render cache (binary display-list segments)
            → viewport (5-page OffscreenCanvas bitmaps + glyph atlas)
```

### Historical O(score) pass audit (superseded)

This table captured the residual engine floor before the final 2-D dirty-scope,
retained-layer, stable-chunk, and compact-overlay work. Keep it only to explain
why those changes were prioritized; these are **not current costs or pending
passes**:

| Pass                            | ~ms | Note                                                                                                             |
| ------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------- |
| `pass3 render loop`             | ~19 | per-region skip shipped; residual is the O(score) `dl.append` of reused segments (needs relative coords / arena) |
| `resolve_staves + mmr_grouping` | ~15 | `scoped_resolve` on; residual is the per-staff confirm-reuse walk over all 33 staves                             |
| `cross_system_slurs`            | ~11 | alloc-scoped; residual is the O(95K-event) iteration scans — deferred (non-local deps)                           |
| `precompute_system_layouts`     | ~7  | scoped; residual is the per-measure retention churn the arena removes                                            |
| `natural_widths`                | ~5  | scoped; already O(viewport) on the live path                                                                     |

Also flagged but cheap: `repairBeatCounts` (a TS-side pass) must be plumbed its
dirty range from every caller (it's `patchAffectedMeasures`-scoped on most paths
already); `getEffectiveTimeSignature` does an O(measureIndex) backward walk that a
parse-time `timeSigByMeasure` table would make O(1).

The current accepted pitch path reports 1–2 resolved/width cells, 169 reused
Horizon systems, retained-layer direct paint, incremental spatial replacement,
and 16.52 ms authoritative p50. Use the permanent headed-browser suite and its
trace/counter artifacts for current cost attribution.

### Reference workload — Beethoven's 9th (scaling ceiling)

The Rhapsody fixture is the _per-edit_ target; the _scaling-limit_ benchmark is a
full Beethoven 9th: ~1,200 measures, ~24 parts, ~28 staves/system, ~350–400 pages,
~150K notation elements, ~8–15 MB MNX JSON, ~5–10 MB Yjs binary. If the per-edit
path holds 16 ms on Rhapsody and the page-cache window holds, this scale is a
load-time concern (streaming parse, per-movement sub-docs), not a per-edit one.

### Measurement methodology (don't trust the wrong probe)

- **Use the in-app perf overlay on a production build**, not an isolated vitest
  bench. The bench fixture (page mode, near-single-part, same-spot repeated edits,
  fully warm) under-represents real scores by ~10×.
- **The engine sub-timing probe must set the live `RangeScope`** (`scoped_resolve`
  - `scoped_precompute` ON) and a `pending_dirty_range`, mirroring
    `engine/viritura-wasm`'s `Default`. A probe without the dirty range measures the
    _unscoped_ worst case (e.g. `natural_widths` reads ~33 ms unscoped vs. ~5 ms on
    the real live path) and mis-ranks the passes.
- **Burst latency only shows up in a live DevTools trace**, not a vitest run —
  vitest awaits each edit serially and can't reproduce a human typing faster than
  the worker drains.

---

## What this is _not_

- **Not a rewrite.** Each lever is a targeted refactor of one layer. The score
  model (`packages/core`), MNX format (`packages/format`), CRDT projection
  (`packages/crdt`), and renderer (`packages/renderer`) are unaffected by the
  arena — only the layout-output representation changes.
- **Not GPU layout.** Compute-shader layout is a research project with fragile
  browser support and unproven wins for irregular per-cell music typesetting. CPU +
  SIMD where available.
- **Not streaming for scores larger than Rhapsody-class** (Mahler 8, the Ring
  cycle). Those need a separate lazy-load-by-viewport architecture, a roadmap item
  for _after_ 16 ms on Rhapsody is in hand.
- **Not abandoning retention.** The Phase A–T scoping, segment retention, system
  signatures, and patch frames all carry forward — Lever 1 scopes _which_ systems
  are touched; the arena makes each touch cheaper. Neither makes retention
  redundant.

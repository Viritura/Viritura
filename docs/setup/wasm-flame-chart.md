# Capturing a WASM flame chart

When `pnpm --filter @viritura/editor exec vitest run pagedPatchFrame` shows
the engine eating most of a per-edit budget, the `take_timings_json` probe
(see `engine/viritura-engine/src/timing.rs`) tells you **which pass**
inside `layout_with_mnx_scores_cached` is hot. Once you've narrowed to one
pass and want **which line inside that pass** — use this.

## Measure the right boundary first

At PR188 HEAD `a06bafa`, the deferred editor path finalizes compatibility arrays
and rebuilds the full spatial index **before paint**. A paged patch benchmark
measures WASM/decode/synchronous reconstruction, not that full lifecycle.
For the closest existing Node lifecycle probe, without rebuilding or overwriting
the current WASM artifact:

```powershell
pnpm --filter @viritura/editor exec vitest run src\__tests__\noteInputClick.perf.test.ts --maxWorkers=1
```

It reports command, WASM, decode, retained apply, compatibility finalization,
spatial rebuild and publication separately, with phase counts. Paint is a
**no-op** and the queue uses Promises, not worker RPC; publication totals include
test-only scans/assertions. Passing its p95 <220 ms publication ceiling does not
prove the width-edit p50 <50 ms or 60 FPS browser targets. See the
[performance audit](../plans/performance-architecture.md) for the exact measured
scope, artifact fingerprint, failures and historical browser results.

Avoid concurrent perf samples/heavy builds. Record host load, artifact hash and
build provenance; an existing WASM file need not include current Rust edits.
On a shared checkout, do not run `wasm:profile` or a restoring build over another
owner's artifact. Coordinate rebuilding/remeasurement rather than silently
substituting a different module or reloading a running user app/plugin.

## What you get

Chrome DevTools Performance shows WASM call stacks with **demangled Rust
function names**, attributed at ~0.1 ms sampling resolution. Click a flame
chart sample → you can see the actual `cross_system::idx_map.insert` /
`bezier::evaluate` / etc. frame, including approximate self-time vs
inclusive-time.

What you do **not** get:

- Source-line attribution inside one function (sample resolution is per
  function symbol, not per Rust line).
- JS↔WASM marshalling shown as anything more granular than one
  `wasm-function[…]` frame.

## Steps

### 1. Build WASM with debug symbols

```sh
pnpm wasm:profile
```

This runs `wasm-pack build --profiling --no-opt` against
`engine/viritura-wasm`. Output lands in `engine/viritura-wasm/pkg-browser/`
exactly where the shipping build does (overwriting it). The wasm file
grows from ~3.5 MB to ~4.2 MB — that ~680 KB delta is the DWARF symbol
table the browser uses for demangling.

> **Why `--no-opt`:** wasm-pack's default `wasm-opt` post-pass strips most
> of the DWARF table we just paid to keep. `--no-opt` skips it; the build
> stays near release performance because the `--profiling` cargo profile
> already runs `-O3`.

### 2. Open the editor and capture

1. Use `pnpm dev:stack up ui` for an isolated worktree service and
   `pnpm dev:stack url` for its route; Docker must be available. Do not launch
   Vite directly or reload an existing user's app. UI profiles run the
   cache-aware WASM builder automatically, so coordinate artifact ownership and
   verify the module actually loaded by the browser still has profiling symbols.
2. DevTools → Performance tab → cog icon → set **CPU throttling: No
   throttling** and **Network: No throttling**.
3. Click **Record**.
4. Trigger the workload you care about — for the per-edit Rhapsody case,
   type a single note into the score so a patch fires.
5. **Stop** after ~1-2 seconds.

### 3. Read the trace

- The **Bottom-Up** view, sorted by **Self Time**, is the fastest path to
  "what's hot." Filter to `wasm` to drop the V8/browser-internal frames.
- For a flame chart view of the actual call stacks, scroll the timeline
  to the WASM thread band and zoom in on a single patch.
- Symbols look like
  `viritura_engine::layout::slurs::cross_system::render_cross_system_slurs::h6f3a8e`.
  The trailing `h…` is the crate hash — ignore.

### 4. Cross-reference against `take_timings_json`

The Phase Q+ engine probe (run via the perf bench) reports ms-resolution
splits for each named pass. The flame chart's sample-time attribution
should agree with those splits within ~1 ms. When they don't, the gap is
usually:

- An allocator hot path (`alloc::raw_vec::*`) that shows in the flame
  chart but isn't tied to one named pass.
- WASM↔JS marshalling shown as `js-sys` / `__wbg_*` frames just outside
  the engine call.

### 5. Restore the shipping build after capturing

When you own the artifact and profiling is finished:

```sh
pnpm wasm:build:force
```

Use the forced build: `wasm:profile` overwrites `pkg-browser` without updating
the shipping build's input-cache record, so an ordinary cache hit can preserve
profiling output. The shipping build applies the `wasm-opt` post-pass. Do not
restore an artifact owned by another session.

## Known limits / gotchas

- **First record after `pnpm wasm:profile` is JIT-cold.** Toss it; the
  second record onwards is steady-state.
- **Chrome's WASM symbol demangling occasionally truncates** very long
  generic names (e.g. `<HashMap<&str, Vec<usize>, …>>::insert`). When it
  matters, look at the same function in the **Sources** panel —
  DevTools can resolve the symbol there even when the perf-tab tooltip
  doesn't.
- **The WASM engine is single-threaded inside a Dedicated Worker by default.**
  The editor uses Comlink and transferable patch buffers; main-thread execution
  is an initialization-failure fallback. Inspect the worker track as well as
  main-thread decode, compatibility reconstruction, spatial indexing and Canvas
  work. “No WASM threads” does not mean “no worker.”
- **wasm-pack's `--profiling` flag does not read the
  `[profile.profiling]` section in `engine/Cargo.toml`.** Its three flags
  (`--dev`, `--release`, `--profiling`) override cargo profile settings
  directly. The section is kept for downstream tools (`cargo flamegraph
--profile profiling`, custom CI jobs) that invoke cargo without
  wasm-pack.

## Scripted alternative: Node `inspector` API + bucket aggregator

For repeatable + headless analysis (CI, regression tracking, comparing
two builds), use the Node-side capture instead of clicking through
DevTools:

```sh
pnpm wasm:profile
pnpm exec tsx apps/editor/src/__tests__/profile-rhapsody.ts
node scripts/profile/summarize-rhapsody.cjs tmp/profiles/rhapsody.cpuprofile
node scripts/profile/analyze-cpuprofile.cjs  tmp/profiles/rhapsody.cpuprofile 50
pnpm wasm:build:force
```

What you get:

- `profile-rhapsody.ts` runs 12 patched edits against Rhapsody under
  Node's `Profiler` (via `node:inspector`). Node's profiler — perhaps
  surprisingly — DOES penetrate WASM frames and demangles Rust symbols
  the same way DevTools does. Writes `tmp/profiles/rhapsody.cpuprofile`.
- `summarize-rhapsody.cjs` aggregates self-time into ~12 buckets
  (wasm.alloc, wasm.clone, wasm.hashbrown, wasm.cross_system,
  js.patchFrame, …) and reports per-iter ms. This is the report to
  ratchet against in successive optimization rounds.
- `analyze-cpuprofile.cjs` prints the top-N hottest individual symbols
  if you need a finer view than the buckets give.

When to prefer this over DevTools: regression checks, comparing
optimization candidates, anything you want machine-readable. When to
prefer DevTools: the call-tree relationships between hot symbols (Node's
profile has them too, but the DevTools UI is much faster to navigate).

## When NOT to use this

- For ms-level "is this pass over budget" questions, prefer the Phase Q+
  engine probe (`set_wasm_timing(true)` + `take_timings_json()` in the
  perf bench). It's faster, scriptable, and machine-readable.
- For correctness questions, prefer the byte-identity oracle
  (`test_segment_retention.rs`) — flame charts can't catch wrong output,
  only slow output.

Flame charts are the right tool when you've isolated a hot pass via
`tick!` and need to find which inner function or allocation is the actual
cost driver inside it.

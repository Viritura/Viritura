# Capturing a WASM flame chart

When `pnpm --filter @viritura/editor exec vitest run pagedPatchFrame` shows
the engine eating most of a per-edit budget, the `take_timings_json` probe
(see `engine/viritura-engine/src/timing.rs`) tells you **which pass**
inside `layout_with_mnx_scores_cached` is hot. Once you've narrowed to one
pass and want **which line inside that pass** — use this.

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

### 2. Restore the shipping build when done

```sh
pnpm wasm
```

The shipping build is slimmer and faster (one fewer optimization pass is
preserved on the profiling build, but `wasm-opt` post-pass IS applied on
the shipping build).

### 3. Open the editor and capture

1. `pnpm --filter @viritura/editor dev` (or whatever your normal dev
   command is) and open the editor against the score you want to profile.
2. DevTools → Performance tab → cog icon → set **CPU throttling: No
   throttling** and **Network: No throttling**.
3. Click **Record**.
4. Trigger the workload you care about — for the per-edit Rhapsody case,
   type a single note into the score so a patch fires.
5. **Stop** after ~1-2 seconds.

### 4. Read the trace

- The **Bottom-Up** view, sorted by **Self Time**, is the fastest path to
  "what's hot." Filter to `wasm` to drop the V8/browser-internal frames.
- For a flame chart view of the actual call stacks, scroll the timeline
  to the WASM thread band and zoom in on a single patch.
- Symbols look like
  `viritura_engine::layout::slurs::cross_system::render_cross_system_slurs::h6f3a8e`.
  The trailing `h…` is the crate hash — ignore.

### 5. Cross-reference against `take_timings_json`

The Phase Q+ engine probe (run via the perf bench) reports ms-resolution
splits for each named pass. The flame chart's sample-time attribution
should agree with those splits within ~1 ms. When they don't, the gap is
usually:

- An allocator hot path (`alloc::raw_vec::*`) that shows in the flame
  chart but isn't tied to one named pass.
- WASM↔JS marshalling shown as `js-sys` / `__wbg_*` frames just outside
  the engine call.

## Known limits / gotchas

- **First record after `pnpm wasm:profile` is JIT-cold.** Toss it; the
  second record onwards is steady-state.
- **Chrome's WASM symbol demangling occasionally truncates** very long
  generic names (e.g. `<HashMap<&str, Vec<usize>, …>>::insert`). When it
  matters, look at the same function in the **Sources** panel —
  DevTools can resolve the symbol there even when the perf-tab tooltip
  doesn't.
- **The profiling build is single-threaded.** We don't ship worker-based
  WASM today, but if/when we do, you'll need to enable
  "JavaScript Profiler" alongside Performance to see worker stacks.
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
pnpm wasm
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

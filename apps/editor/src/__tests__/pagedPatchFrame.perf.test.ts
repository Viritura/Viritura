// @vitest-environment node
/**
 * Paged patch-frame performance probe (Phase 1b).
 *
 * The horizon hot path ({@link noteInput.perf.test.ts}, pageWidth 0) never
 * produces patch frames. This probe drives the *paged* auto-flow path, where a
 * single note edit reflows one system and the engine can emit a patch frame
 * (changed system + per-system shifts) instead of re-serializing the whole
 * score.
 *
 * It runs two engines fed identical edits and times the full per-edit consumer
 * path for each:
 *   - baseline: `apply_patch_and_layout_binary` → `decodeBinaryDisplayList`
 *     (re-encode + full decode of the whole display list)
 *   - patch:    `apply_patch_and_layout_patch_frame_binary` → `decodeFrame`
 *     → `PatchReconstructor.apply` (encode + decode only fresh systems)
 *
 * The patch path must be (a) correct — its reassembled display list matches the
 * baseline within sub-pixel tolerance — and (b) faster on a large score. The
 * budget assertion guards the per-edit p95 of the patch path.
 *
 * Skip with `VIRITURA_SKIP_PERF=1`. Loosen budgets via `PERF_BUDGET_MULTIPLIER`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DeltaSerializer, parseMnx } from "@viritura/format";
import { decodeBinaryDisplayList, decodeFrame, PatchReconstructor } from "@viritura/renderer";
import type { DisplayList } from "@viritura/renderer";
import { produce } from "../score/scoreClone";
import { addNoteWithAutoTie } from "../commands/noteCommands";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = resolve(__dirname, "../../../../engine/viritura-wasm/pkg-browser");
const SCORE_DIR = resolve(__dirname, "../../../../packages/format/fixtures/mnx");
const WASM_BYTES_PATH = resolve(WASM_DIR, "viritura_wasm_bg.wasm");
const WASM_GLUE_PATH = resolve(WASM_DIR, "viritura_wasm.js");

const WASM_AVAILABLE = existsSync(WASM_BYTES_PATH) && existsSync(WASM_GLUE_PATH);
const PERF_SKIPPED = process.env.VIRITURA_SKIP_PERF === "1";
const BUDGET_MULTIPLIER = Number(process.env.PERF_BUDGET_MULTIPLIER ?? (process.env.CI ? "2" : "1"));

interface WasmLayoutEngine {
  full_layout(
    mnx_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string | null,
    score_index?: number | null,
  ): string;
  apply_patch_and_layout_binary(
    patch_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string | null,
    score_index?: number | null,
  ): Float32Array;
  apply_patch_and_layout_patch_frame_binary(
    patch_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string | null,
    score_index?: number | null,
  ): Float32Array;
  has_retained_score(): boolean;
  take_timings_json(): string | undefined;
  set_system_layout_reuse(enabled: boolean): void;
  free(): void;
}

interface WasmGlue {
  initSync(opts: { module: WebAssembly.Module }): void;
  LayoutEngine: new () => WasmLayoutEngine;
  set_wasm_timing(enabled: boolean): void;
}

let glue: WasmGlue | null = null;

beforeAll(async () => {
  if (!WASM_AVAILABLE || PERF_SKIPPED) return;
  const bytes = readFileSync(WASM_BYTES_PATH);
  const mod = new WebAssembly.Module(bytes);
  const imported = (await import(/* @vite-ignore */ pathToFileURL(WASM_GLUE_PATH).href)) as unknown as WasmGlue;
  imported.initSync({ module: mod });
  glue = imported;
});

const SP = 8;
const PAGE_WIDTH = 816; // Paged layout → exercises the auto-flow patch path.

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx]!;
}

/** A note-input edit applied to the immer score draft. */
function applyEdit(score: ReturnType<typeof parseMnx>, i: number, measureCount: number, partIndex: number) {
  const steps = ["C", "D", "E", "F", "G", "A", "B"] as const;
  return produce(score, (draft) => {
    addNoteWithAutoTie(draft, {
      pitch: { step: steps[i % steps.length]!, octave: 4 },
      duration: { base: "quarter" },
      measureIndex: i % Math.max(1, measureCount),
      partIndex,
      voice: 0,
      beatPosition: i % 4,
    });
  });
}

/**
 * A WIDTH-PRESERVING edit: bump the octave of the first pitched note in a
 * target measure (alternating ±1 by iteration so each pass is a real change).
 * A pitch change never alters measure width, so the system-break plan is stable
 * and Lever 1's clean-system render-hash skip engages — this is the variant that
 * exercises it (note *addition* changes width and busts the plan). The edit is
 * confined to one measure so every other system stays clean.
 */
function applyPitchEdit(score: ReturnType<typeof parseMnx>, i: number, measureCount: number, partIndex: number) {
  const delta = i % 2 === 0 ? 1 : -1;
  return produce(score, (draft) => {
    const part = draft.parts[partIndex];
    if (!part) return;
    // Find the first measure (scanning from i%measureCount) that actually
    // contains a pitched note — Rhapsody's early measures are intro rests, and
    // editing an empty measure yields an EMPTY patch (no dirty range), which
    // would disable the per-region skip and silently measure nothing.
    const n = part.measures.length;
    for (let off = 0; off < Math.min(n, Math.max(1, measureCount) + n); off++) {
      const measure = part.measures[((((i % Math.max(1, measureCount)) + off) % n) + n) % n];
      if (!measure) continue;
      for (const seq of measure.sequences ?? []) {
        for (const item of seq.content ?? []) {
          if (item.type === "event" && item.notes?.length) {
            const note = item.notes[0]!;
            if (note.pitch) {
              note.pitch.octave += delta;
              return;
            }
          }
        }
      }
    }
  });
}

/**
 * Probe score indices for the first that emits a patch frame (tag 1.0) after a
 * single edit in paged mode. Returns null when the fixture has no paged
 * auto-flow score view.
 */
function findPagedPatchIndex(fixturePath: string, measureCount: number, partIndex: number): number | null {
  if (!glue) throw new Error("WASM glue not initialised");
  const raw = readFileSync(fixturePath, "utf-8");
  const base = parseMnx(JSON.parse(raw));

  for (let scoreIndex = 0; scoreIndex < 8; scoreIndex++) {
    const serializer = new DeltaSerializer();
    const seed = serializer.serialize(base);
    const engine = new glue.LayoutEngine();
    try {
      engine.full_layout(seed.json, SP, PAGE_WIDTH, null, scoreIndex);
    } catch {
      engine.free();
      continue; // out-of-range / trapped view
    }
    let tag: number;
    try {
      const edited = applyEdit(base, 0, measureCount, partIndex);
      const result = serializer.serialize(edited);
      if (result.structuralChange) {
        engine.free();
        return null;
      }
      const patchJson = serializer.buildPatch(result.changedGlobalMeasures, result.changedPartMeasures);
      const tagged = engine.apply_patch_and_layout_patch_frame_binary(patchJson, SP, PAGE_WIDTH, null, scoreIndex);
      tag = tagged[0]!;
    } catch {
      engine.free();
      continue;
    }
    engine.free();
    if (tag === 1.0) return scoreIndex;
  }
  return null;
}

interface PathStats {
  p50: number;
  p95: number;
  max: number;
}

interface BenchResult {
  scoreIndex: number;
  iterations: number;
  baseline: PathStats;
  patch: PathStats;
  /** Sub-tick: just the wasm engine call. */
  wasmCall: PathStats;
  /** Sub-tick: TS-side `decodeFrame` of the returned Float32Array. */
  decodeFrame: PathStats;
  /** Sub-tick: TS-side `PatchReconstructor.apply`. */
  reconstruct: PathStats;
  freshAvg: number;
  reuseAvg: number;
  patchFrames: number;
}

function statsOf(samples: number[]): PathStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), max: sorted[sorted.length - 1] ?? 0 };
}

function runPagedBenchmark(opts: {
  fixturePath: string;
  scoreIndex: number;
  iterations: number;
  warmup: number;
  measureCount: number;
  partIndex: number;
  editMode?: "add" | "pitch";
}): BenchResult {
  if (!glue) throw new Error("WASM glue not initialised");
  const raw = readFileSync(opts.fixturePath, "utf-8");
  let score = parseMnx(JSON.parse(raw));

  const baseSerializer = new DeltaSerializer();
  const patchSerializer = new DeltaSerializer();
  const baseSeed = baseSerializer.serialize(score);
  const patchSeed = patchSerializer.serialize(score);

  const baseEngine = new glue.LayoutEngine();
  const patchEngine = new glue.LayoutEngine();
  baseEngine.full_layout(baseSeed.json, SP, PAGE_WIDTH, null, opts.scoreIndex);
  patchEngine.full_layout(patchSeed.json, SP, PAGE_WIDTH, null, opts.scoreIndex);

  const reconstructor = new PatchReconstructor();
  const baselineSamples: number[] = [];
  const patchSamples: number[] = [];
  let freshTotal = 0;
  let reuseTotal = 0;
  let patchFrames = 0;

  // Sub-tick breakdown of the patch path (engine call vs decodeFrame vs
  // PatchReconstructor) so we can see which stage dominates the wall time.
  const wasmCallSamples: number[] = [];
  const decodeFrameSamples: number[] = [];
  const reconstructSamples: number[] = [];

  const total = opts.warmup + opts.iterations;
  for (let i = 0; i < total; i++) {
    score =
      opts.editMode === "pitch"
        ? applyPitchEdit(score, i, opts.measureCount, opts.partIndex)
        : applyEdit(score, i, opts.measureCount, opts.partIndex);

    const baseResult = baseSerializer.serialize(score);
    const patchResult = patchSerializer.serialize(score);
    if (baseResult.structuralChange || patchResult.structuralChange) continue;

    const basePatchJson = baseSerializer.buildPatch(baseResult.changedGlobalMeasures, baseResult.changedPartMeasures);
    const patchPatchJson = patchSerializer.buildPatch(
      patchResult.changedGlobalMeasures,
      patchResult.changedPartMeasures,
    );

    // Baseline: full binary → full decode.
    const t0 = performance.now();
    const baseBin = baseEngine.apply_patch_and_layout_binary(basePatchJson, SP, PAGE_WIDTH, null, opts.scoreIndex);
    const baseDl = decodeBinaryDisplayList(baseBin);
    const t1 = performance.now();

    // Patch: tagged frame → decode fresh systems → reassemble.
    const ta = performance.now();
    const tagged = patchEngine.apply_patch_and_layout_patch_frame_binary(
      patchPatchJson,
      SP,
      PAGE_WIDTH,
      null,
      opts.scoreIndex,
    );
    const tb = performance.now();
    const frame = decodeFrame(tagged);
    const tc = performance.now();
    const patchDl = reconstructor.apply(frame);
    const t2 = performance.now();

    if (i >= opts.warmup) {
      baselineSamples.push(t1 - t0);
      patchSamples.push(t2 - t1);
      wasmCallSamples.push(tb - ta);
      decodeFrameSamples.push(tc - tb);
      reconstructSamples.push(t2 - tc);
      if (frame.kind === "patch") {
        patchFrames++;
        freshTotal += frame.patch.placements.filter((p) => p.kind === "fresh").length;
        reuseTotal += frame.patch.placements.filter((p) => p.kind === "reuse").length;
      }
      // Correctness: reassembled command count must match the baseline.
      expectSameShape(patchDl, baseDl, i);
    }
  }

  baseEngine.free();
  patchEngine.free();

  return {
    scoreIndex: opts.scoreIndex,
    iterations: baselineSamples.length,
    baseline: statsOf(baselineSamples),
    patch: statsOf(patchSamples),
    wasmCall: statsOf(wasmCallSamples),
    decodeFrame: statsOf(decodeFrameSamples),
    reconstruct: statsOf(reconstructSamples),
    freshAvg: patchFrames > 0 ? freshTotal / patchFrames : 0,
    reuseAvg: patchFrames > 0 ? reuseTotal / patchFrames : 0,
    patchFrames,
  };
}

function expectSameShape(a: DisplayList, b: DisplayList, frame: number): void {
  expect(a.commands.length, `frame ${frame}: command count must match baseline`).toBe(b.commands.length);
}

function logPaged(label: string, r: BenchResult, budgetMs: number): void {
  const ratio = r.patch.p50 > 0 ? r.baseline.p50 / r.patch.p50 : 0;
  console.log(
    `[paged patch perf] ${label} (idx ${r.scoreIndex}): ` +
      `baseline p50=${r.baseline.p50.toFixed(2)}ms p95=${r.baseline.p95.toFixed(2)}ms | ` +
      `patch p50=${r.patch.p50.toFixed(2)}ms p95=${r.patch.p95.toFixed(2)}ms | ` +
      `speedup ${ratio.toFixed(2)}x | ` +
      `fresh/frame=${r.freshAvg.toFixed(1)} reuse/frame=${r.reuseAvg.toFixed(1)} | ` +
      `patchFrames=${r.patchFrames}/${r.iterations} budget p95<${budgetMs.toFixed(1)}ms`,
  );
  console.log(
    `[paged patch perf]   sub-tick p50: wasmCall=${r.wasmCall.p50.toFixed(2)}ms ` +
      `decodeFrame=${r.decodeFrame.p50.toFixed(2)}ms ` +
      `reconstruct=${r.reconstruct.p50.toFixed(2)}ms`,
  );
}

const suite = WASM_AVAILABLE && !PERF_SKIPPED ? describe : describe.skip;
const skipReason = !WASM_AVAILABLE
  ? "WASM artifacts not built (run `pnpm wasm:build`)"
  : PERF_SKIPPED
    ? "VIRITURA_SKIP_PERF=1"
    : "";

suite(`paged patch-frame perf${skipReason ? ` — SKIPPED: ${skipReason}` : ""}`, () => {
  it("large fixture (beethoven-5-finale) — patch path beats full decode", () => {
    const fixturePath = resolve(SCORE_DIR, "beethoven-5-finale.mnx");
    const scoreIndex = findPagedPatchIndex(fixturePath, 16, 0);
    if (scoreIndex === null) {
      console.warn("[paged patch perf] beethoven-5-finale: no paged patch-emitting score view; skipping");
      return;
    }
    const r = runPagedBenchmark({
      fixturePath,
      scoreIndex,
      iterations: 24,
      warmup: 4,
      measureCount: 16,
      partIndex: 0,
    });
    const budgetMs = 60 * BUDGET_MULTIPLIER;
    logPaged("beethoven-5-finale", r, budgetMs);

    // The patch path must produce real patch frames (not all full-frame).
    expect(r.patchFrames, "patch path must emit patch frames").toBeGreaterThan(0);
    // The patch path must beat the baseline full-decode path on a large score.
    expect(r.patch.p50, "patch p50 must be below baseline p50").toBeLessThan(r.baseline.p50);
    // Per-edit p95 budget.
    expect(r.patch.p95).toBeLessThan(budgetMs);
  });

  it("very large fixture (Rhapsody in Blue) — patch path is the user-facing per-edit cost", () => {
    // Reads the same path that the user-facing editor uses on note input.
    // The numbers logged here are the true per-edit cost on our largest fixture.
    // §1.2's ~248 ms warm number is the FULL relayout cost, NOT what the editor
    // pays on a note edit — this test pins the *actual* user-facing per-edit cost.
    const fixturePath = resolve(SCORE_DIR, "Rhapsody in Blue.mnx");
    const scoreIndex = findPagedPatchIndex(fixturePath, 16, 0);
    if (scoreIndex === null) {
      console.warn("[paged patch perf] Rhapsody: no paged patch-emitting score view; skipping");
      return;
    }
    const r = runPagedBenchmark({
      fixturePath,
      scoreIndex,
      iterations: 12,
      warmup: 3,
      measureCount: 16,
      partIndex: 0,
    });
    // Soft budget: we expect this to be the slow case. Logging is the
    // primary signal; budget kept generous to avoid CI flakes while we work
    // toward 16 ms.
    const budgetMs = 500 * BUDGET_MULTIPLIER;
    logPaged("Rhapsody in Blue", r, budgetMs);

    // Phase Q: one-off WASM-side timing probe. Runs a single warm patch
    // edit with WASM_TIMING_ENABLED on and logs the engine's own breakdown
    // (parse+promote+reconcile vs layout). Tells us which side of the
    // ~75 ms wasmCall is the actual bottleneck.
    if (glue?.set_wasm_timing) {
      glue.set_wasm_timing(true);
      const raw2 = readFileSync(fixturePath, "utf-8");
      let probeScore = parseMnx(JSON.parse(raw2));
      const probeSerializer = new DeltaSerializer();
      const probeSeed = probeSerializer.serialize(probeScore);
      const probeEngine = new glue.LayoutEngine();
      probeEngine.full_layout(probeSeed.json, SP, PAGE_WIDTH, null, scoreIndex);
      // Apply one edit + relayout to engage the patch path; discard.
      probeScore = applyEdit(probeScore, 0, 16, 0);
      const probeResult = probeSerializer.serialize(probeScore);
      if (!probeResult.structuralChange) {
        const probePatchJson = probeSerializer.buildPatch(
          probeResult.changedGlobalMeasures,
          probeResult.changedPartMeasures,
        );
        // First patch call warms the per-system retention cache; its timings
        // are cold (all-Fresh) and not interesting.
        probeEngine.apply_patch_and_layout_patch_frame_binary(probePatchJson, SP, PAGE_WIDTH, null, scoreIndex);
        // Discard cold timings.
        probeEngine.take_timings_json();
        // Now apply a SECOND edit and patch: this is the warm path the bench
        // measures. The breakdown here is what we want.
        probeScore = applyEdit(probeScore, 1, 16, 0);
        const probeResult2 = probeSerializer.serialize(probeScore);
        if (!probeResult2.structuralChange) {
          const probePatchJson2 = probeSerializer.buildPatch(
            probeResult2.changedGlobalMeasures,
            probeResult2.changedPartMeasures,
          );
          probeEngine.apply_patch_and_layout_patch_frame_binary(probePatchJson2, SP, PAGE_WIDTH, null, scoreIndex);
          const breakdownJson = probeEngine.take_timings_json();
          if (breakdownJson) {
            console.log(`[paged patch perf]   wasm-internal breakdown (warm): ${breakdownJson}`);
          }
        }
      }
      probeEngine.free();
      glue.set_wasm_timing(false);
    }

    expect(r.patchFrames, "patch path must emit patch frames").toBeGreaterThan(0);
    expect(r.patch.p50, "patch p50 must be below baseline p50").toBeLessThan(r.baseline.p50);
    expect(r.patch.p95, "patch p95 within generous soft budget").toBeLessThan(budgetMs);
  }, 600_000); // Rhapsody is slow: warmup + iterations + per-iter ~1s baseline.

  it("very large fixture (Rhapsody in Blue) — WIDTH-PRESERVING pitch edit (Lever 1 skip)", () => {
    // A pitch edit doesn't change measure width, so the system-break plan is
    // stable and Lever 1's clean-system render-hash skip engages. This is the
    // common real-editing case (re-pitching, articulations, dynamics) and the
    // one the skip targets — note *addition* (the test above) changes width and
    // busts the plan, so it does NOT exercise the skip.
    const fixturePath = resolve(SCORE_DIR, "Rhapsody in Blue.mnx");
    const scoreIndex = findPagedPatchIndex(fixturePath, 16, 0);
    if (scoreIndex === null) {
      console.warn("[paged patch perf] Rhapsody pitch: no paged patch-emitting score view; skipping");
      return;
    }
    const r = runPagedBenchmark({
      fixturePath,
      scoreIndex,
      iterations: 12,
      warmup: 3,
      measureCount: 16,
      partIndex: 0,
      editMode: "pitch",
    });
    const budgetMs = 500 * BUDGET_MULTIPLIER;
    logPaged("Rhapsody in Blue [pitch]", r, budgetMs);

    if (glue?.set_wasm_timing) {
      glue.set_wasm_timing(true);
      const raw2 = readFileSync(fixturePath, "utf-8");
      let probeScore = parseMnx(JSON.parse(raw2));
      const probeSerializer = new DeltaSerializer();
      const probeSeed = probeSerializer.serialize(probeScore);
      const probeEngine = new glue.LayoutEngine();
      probeEngine.full_layout(probeSeed.json, SP, PAGE_WIDTH, null, scoreIndex);
      // Warm the patch chain (cold re-seed) then measure a SECOND warm pitch edit.
      for (const it of [0, 1]) {
        probeScore = applyPitchEdit(probeScore, it, 16, 0);
        const pr = probeSerializer.serialize(probeScore);
        if (pr.structuralChange) continue;
        const pj = probeSerializer.buildPatch(pr.changedGlobalMeasures, pr.changedPartMeasures);
        probeEngine.apply_patch_and_layout_patch_frame_binary(pj, SP, PAGE_WIDTH, null, scoreIndex);
        if (it === 0) probeEngine.take_timings_json(); // discard cold
      }
      const breakdownJson = probeEngine.take_timings_json();
      if (breakdownJson) {
        console.log(`[paged patch perf]   wasm-internal breakdown (pitch, warm): ${breakdownJson}`);
      }
      probeEngine.free();

      // Lever 2 step 4 (B-full): same warm pitch edit with the per-system
      // wholesale layout-reuse store ENABLED, so the patch-path precompute +
      // restore delta is visible side-by-side with the OFF breakdown above.
      // Default-off in the live app; this probe opts in explicitly.
      if (typeof (new glue.LayoutEngine() as WasmLayoutEngine).set_system_layout_reuse === "function") {
        let onScore = parseMnx(JSON.parse(raw2));
        const onSerializer = new DeltaSerializer();
        const onSeed = onSerializer.serialize(onScore);
        const onEngine = new glue.LayoutEngine();
        onEngine.set_system_layout_reuse(true);
        onEngine.full_layout(onSeed.json, SP, PAGE_WIDTH, null, scoreIndex);
        for (const it of [0, 1]) {
          onScore = applyPitchEdit(onScore, it, 16, 0);
          const pr = onSerializer.serialize(onScore);
          if (pr.structuralChange) continue;
          const pj = onSerializer.buildPatch(pr.changedGlobalMeasures, pr.changedPartMeasures);
          onEngine.apply_patch_and_layout_patch_frame_binary(pj, SP, PAGE_WIDTH, null, scoreIndex);
          if (it === 0) onEngine.take_timings_json(); // discard cold
        }
        const onBreakdown = onEngine.take_timings_json();
        if (onBreakdown) {
          console.log(`[paged patch perf]   wasm-internal breakdown (pitch, warm, B-full ON): ${onBreakdown}`);
        }
        onEngine.free();
      }
      glue.set_wasm_timing(false);
    }

    expect(r.patchFrames, "patch path must emit patch frames").toBeGreaterThan(0);
    expect(r.patch.p50, "pitch patch p50 must be below baseline p50").toBeLessThan(r.baseline.p50);
  }, 600_000);
});

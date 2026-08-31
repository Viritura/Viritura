// @vitest-environment node
/**
 * Note-input performance regression test.
 *
 * Drives the same hot path that runs on every keystroke:
 *   produce(score, draft => addNoteWithAutoTie(draft, ...))
 *     → DeltaSerializer.serialize
 *     → buildPatchJson
 *     → LayoutEngine.apply_patch_and_layout_patch_frame_binary
 *     → decodeFrame → PatchReconstructor.apply
 *
 * Asserts p95 stays under a budget so regressions in serialize / WASM
 * patch / layout cache fail CI rather than slipping into a release.
 *
 * Budgets are empirical regression ceilings for the complete engine-side
 * production path, with a CI-aware multiplier.
 *
 * Skip the suite with `VIRITURA_SKIP_PERF=1`. Loosen budgets via
 * `PERF_BUDGET_MULTIPLIER=N`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DeltaSerializer, parseMnx } from "@viritura/format";
import { decodeBinaryDisplayList, decodeFrame, PatchReconstructor } from "@viritura/renderer";
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

// Minimal subset of the wasm-bindgen LayoutEngine API the test uses.
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
  free(): void;
}

interface WasmGlue {
  initSync(opts: { module: WebAssembly.Module }): void;
  LayoutEngine: new () => WasmLayoutEngine;
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

// --- helpers --------------------------------------------------------------

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx]!;
}

function pageSetupJsonForA4(): string {
  // Mirrors DEFAULT_PAGE_SETUP from @viritura/core for an A4 page at 1.764mm spatium.
  const spatiumMm = 1.764;
  return JSON.stringify({
    page_height: 297 / spatiumMm,
    page_margin_top: 15 / spatiumMm,
    page_margin_bottom: 15 / spatiumMm,
    page_margin_left: 15 / spatiumMm,
    page_margin_right: 15 / spatiumMm,
  });
}

interface BenchStats {
  iterations: number;
  warmup: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  patchHits: number;
  fullLayoutFallbacks: number;
}

function runBenchmark(opts: {
  fixturePath: string;
  iterations: number;
  warmup: number;
  measureCount: number;
  partIndex: number;
}): BenchStats {
  if (!glue) throw new Error("WASM glue not initialised");

  const raw = readFileSync(opts.fixturePath, "utf-8");
  let score = parseMnx(JSON.parse(raw));
  const serializer = new DeltaSerializer();

  // Seed: initial full serialize + full layout. This makes the engine retain
  // the Score so subsequent apply_patch_and_layout calls work.
  const seed = serializer.serialize(score);
  const sp = 8; // ~spatium px @ 1.764mm spatium
  const pageWidth = 0; // 0 means "engine-side default"; horizon mode
  const pageSetup = pageSetupJsonForA4();

  const engine = new glue.LayoutEngine();
  const reconstructor = new PatchReconstructor();
  engine.full_layout(seed.json, sp, pageWidth, pageSetup, 0);

  const steps = ["C", "D", "E", "F", "G", "A", "B"] as const;
  const samples: number[] = [];
  let patchHits = 0;
  let fullLayoutFallbacks = 0;

  const total = opts.warmup + opts.iterations;
  for (let i = 0; i < total; i++) {
    const step = steps[i % steps.length]!;
    const measureIndex = i % Math.max(1, opts.measureCount);
    const beatPosition = i % 4;

    const t0 = performance.now();

    // 1. Mutate via immer (matches real editor path in noteInputHandlers).
    score = produce(score, (draft) => {
      addNoteWithAutoTie(draft, {
        pitch: { step, octave: 4 },
        duration: { base: "quarter" },
        measureIndex,
        partIndex: opts.partIndex,
        voice: 0,
        beatPosition,
      });
    });

    // 2. Delta serialize.
    const result = serializer.serialize(score);

    // 3. WASM relayout — patch path when possible, full layout otherwise.
    const canPatch =
      !result.structuralChange &&
      (result.changedGlobalMeasures.length > 0 || result.changedPartMeasures.size > 0) &&
      engine.has_retained_score();

    if (canPatch) {
      const patchJson = serializer.buildPatch(result.changedGlobalMeasures, result.changedPartMeasures);
      const tagged = engine.apply_patch_and_layout_patch_frame_binary(patchJson, sp, pageWidth, pageSetup, 0);
      reconstructor.apply(decodeFrame(tagged));
      patchHits++;
    } else {
      engine.full_layout(result.json, sp, pageWidth, pageSetup, 0);
      reconstructor.reset();
      fullLayoutFallbacks++;
    }

    samples.push(performance.now() - t0);
  }

  engine.free();

  // Drop warmup samples before computing stats.
  const warm = samples.slice(opts.warmup).sort((a, b) => a - b);
  return {
    iterations: opts.iterations,
    warmup: opts.warmup,
    p50: quantile(warm, 0.5),
    p95: quantile(warm, 0.95),
    p99: quantile(warm, 0.99),
    max: warm[warm.length - 1] ?? 0,
    patchHits: patchHits - Math.min(opts.warmup, patchHits),
    fullLayoutFallbacks: fullLayoutFallbacks - Math.min(opts.warmup, fullLayoutFallbacks),
  };
}

function logStats(label: string, stats: BenchStats, budgetMs: number): void {
  console.log(
    `[note-input perf] ${label}: ` +
      `p50=${stats.p50.toFixed(2)}ms ` +
      `p95=${stats.p95.toFixed(2)}ms ` +
      `p99=${stats.p99.toFixed(2)}ms ` +
      `max=${stats.max.toFixed(2)}ms ` +
      `(budget p95<${budgetMs.toFixed(1)}ms, ` +
      `patch=${stats.patchHits}/${stats.iterations}, ` +
      `full=${stats.fullLayoutFallbacks})`,
  );
}

// --- tests ----------------------------------------------------------------

const suite = WASM_AVAILABLE && !PERF_SKIPPED ? describe : describe.skip;
const skipReason = !WASM_AVAILABLE
  ? "WASM artifacts not built (run `pnpm wasm:build`)"
  : PERF_SKIPPED
    ? "VIRITURA_SKIP_PERF=1"
    : "";

suite(`note input regression${skipReason ? ` — SKIPPED: ${skipReason}` : ""}`, () => {
  // Budgets are regression gates, not aspirational targets. They sit well
  // above measured p95 to absorb CI/test-suite CPU contention (the small
  // fixture is sub-millisecond in isolation but ~5ms p95 when 88 other test
  // files are running concurrently). They will still trip on an honest
  // regression (full re-serialize creeping back in, patch path turning into
  // full layout, etc.). Tighten as the underlying numbers improve.
  it("small fixture (c-major-scale) — sub-frame, patch path", () => {
    const stats = runBenchmark({
      fixturePath: resolve(SCORE_DIR, "c-major-scale.mnx"),
      iterations: 50,
      warmup: 5,
      measureCount: 2,
      partIndex: 0,
    });
    const budgetMs = 10 * BUDGET_MULTIPLIER;
    logStats("small", stats, budgetMs);
    expect(stats.p95).toBeLessThan(budgetMs);
    // The patch fast path must dominate. If it falls below 80% something has
    // regressed the structural-sharing or delta logic.
    expect(stats.patchHits / stats.iterations).toBeGreaterThan(0.8);
  });

  it("large fixture (beethoven-5-finale) — orchestral patch path", () => {
    const stats = runBenchmark({
      fixturePath: resolve(SCORE_DIR, "beethoven-5-finale.mnx"),
      iterations: 30,
      warmup: 3,
      // Spread edits across the first 16 measures of part 0 so we exercise
      // the patch path against different cache slots, not just one.
      measureCount: 16,
      partIndex: 0,
    });
    // This measures the complete main-thread production path: incremental
    // serialization, WASM patch-frame layout, decode, and reconstruction.
    // Serialization remains independent of total score size; the Rhapsody
    // block below guards that property directly without involving WASM.
    // See the Rhapsody serialize-cost block below for the O(score size) proof.
    const budgetMs = 80 * BUDGET_MULTIPLIER;
    logStats("large", stats, budgetMs);
    expect(stats.p95).toBeLessThan(budgetMs);
    expect(stats.patchHits / stats.iterations).toBeGreaterThan(0.8);
  });
});

// The serialize step must NOT scale with total score size. Before incremental
// assembly, every keystroke ran JSON.stringify(serializeMnx(score)) — O(score
// size) — plus a full JSON.parse in buildPatchJson. On the 21MB Rhapsody score
// that was hundreds of ms per edit (and tripped the 500ms "updating score"
// toast). The DeltaSerializer now re-serializes only changed measures and
// splices cached MNX strings, so per-edit serialize + patch-build is sub-frame
// even at orchestral scale. This block has no WASM dependency.
describe(`serialize cost (no WASM)${PERF_SKIPPED ? " — SKIPPED" : ""}`, () => {
  const suite2 = PERF_SKIPPED ? it.skip : it;

  suite2("21MB score — incremental serialize + patch-build stays sub-frame", () => {
    const raw = readFileSync(resolve(SCORE_DIR, "Rhapsody in Blue.mnx"), "utf-8");
    let score = parseMnx(JSON.parse(raw));
    const serializer = new DeltaSerializer();

    // Cold serialize (full assembly, primes caches) — not measured.
    serializer.serialize(score);

    const steps = ["C", "D", "E", "F", "G", "A", "B"] as const;
    const samples: number[] = [];
    const iterations = 40;
    const warmup = 5;

    for (let i = 0; i < iterations + warmup; i++) {
      const step = steps[i % steps.length]!;
      const measureIndex = i % 16;

      score = produce(score, (draft) => {
        addNoteWithAutoTie(draft, {
          pitch: { step, octave: 4 },
          duration: { base: "quarter" },
          measureIndex,
          partIndex: 0,
          voice: 0,
          beatPosition: i % 4,
        });
      });

      const t0 = performance.now();
      const result = serializer.serialize(score);
      serializer.buildPatch(result.changedGlobalMeasures, result.changedPartMeasures);
      samples.push(performance.now() - t0);
    }

    const warm = samples.slice(warmup).sort((a, b) => a - b);
    const p50 = quantile(warm, 0.5);
    const p95 = quantile(warm, 0.95);
    console.log(
      `[note-input perf] rhapsody-serialize: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms ` +
        `(21MB score, budget p95<16ms)`,
    );
    // A full JSON.stringify(serializeMnx) of this score is ~40-65ms on its
    // own, and the old patch path then re-parsed the entire 21MB output in
    // buildPatchJson — so per-edit serialize+patch was ~100ms+ and tripped the
    // 500ms "updating score" toast under load. The incremental path is ~3-5ms.
    expect(p95).toBeLessThan(16 * BUDGET_MULTIPLIER);
  });
});

interface TransportMetrics {
  iterations: number;
  patchFrames: number;
  fullFrames: number;
  reusePlacements: number;
  patchPayloadP50: number;
  fullPayloadP50: number;
}

function runProductionTransportBenchmark(): TransportMetrics {
  if (!glue) throw new Error("WASM glue not initialised");

  const raw = readFileSync(resolve(SCORE_DIR, "Rhapsody in Blue.mnx"), "utf-8");
  let score = parseMnx(JSON.parse(raw));
  const fullSerializer = new DeltaSerializer();
  const patchSerializer = new DeltaSerializer();
  const fullEngine = new glue.LayoutEngine();
  const patchEngine = new glue.LayoutEngine();
  const reconstructor = new PatchReconstructor();
  const sp = 8;
  const pageWidth = 0;
  const pageSetup = pageSetupJsonForA4();

  fullEngine.full_layout(fullSerializer.serialize(score).json, sp, pageWidth, pageSetup, 0);
  patchEngine.full_layout(patchSerializer.serialize(score).json, sp, pageWidth, pageSetup, 0);

  const steps = ["C", "D", "E", "F", "G", "A", "B"] as const;
  const warmup = 2;
  const iterations = 8;
  const patchPayloads: number[] = [];
  const fullPayloads: number[] = [];
  let patchFrames = 0;
  let fullFrames = 0;
  let reusePlacements = 0;

  for (let i = 0; i < warmup + iterations; i++) {
    score = produce(score, (draft) => {
      addNoteWithAutoTie(draft, {
        pitch: { step: steps[i % steps.length]!, octave: 4 },
        duration: { base: "quarter" },
        measureIndex: i % 16,
        partIndex: 0,
        voice: 0,
        beatPosition: i % 4,
      });
    });

    const fullResult = fullSerializer.serialize(score);
    const patchResult = patchSerializer.serialize(score);
    const fullBinary = fullEngine.apply_patch_and_layout_binary(
      fullSerializer.buildPatch(fullResult.changedGlobalMeasures, fullResult.changedPartMeasures),
      sp,
      pageWidth,
      pageSetup,
      0,
    );
    const fullDisplayList = decodeBinaryDisplayList(fullBinary);
    const tagged = patchEngine.apply_patch_and_layout_patch_frame_binary(
      patchSerializer.buildPatch(patchResult.changedGlobalMeasures, patchResult.changedPartMeasures),
      sp,
      pageWidth,
      pageSetup,
      0,
    );
    const frame = decodeFrame(tagged);
    const patchDisplayList = reconstructor.apply(frame);

    if (i < warmup) continue;

    expect(patchDisplayList.commands.length, `frame ${i}: command count`).toBe(fullDisplayList.commands.length);
    expect(patchDisplayList.width, `frame ${i}: width`).toBeCloseTo(fullDisplayList.width, 1);
    expect(patchDisplayList.height, `frame ${i}: height`).toBeCloseTo(fullDisplayList.height, 1);
    expect(patchDisplayList.pages?.length ?? 0, `frame ${i}: page count`).toBe(fullDisplayList.pages?.length ?? 0);

    patchPayloads.push(tagged.byteLength);
    fullPayloads.push(fullBinary.byteLength);
    if (frame.kind === "patch") {
      patchFrames++;
      reusePlacements += frame.patch.placements.filter((placement) => placement.kind === "reuse").length;
    } else {
      fullFrames++;
    }
  }

  fullEngine.free();
  patchEngine.free();

  return {
    iterations,
    patchFrames,
    fullFrames,
    reusePlacements,
    patchPayloadP50: quantile(
      patchPayloads.sort((a, b) => a - b),
      0.5,
    ),
    fullPayloadP50: quantile(
      fullPayloads.sort((a, b) => a - b),
      0.5,
    ),
  };
}

const transportSuite = WASM_AVAILABLE && !PERF_SKIPPED ? describe : describe.skip;

transportSuite(`production patch transport${skipReason ? ` — SKIPPED: ${skipReason}` : ""}`, () => {
  it("Rhapsody note edits reconstruct correctly with a compact patch frame", () => {
    const metrics = runProductionTransportBenchmark();
    const payloadRatio = metrics.patchPayloadP50 / metrics.fullPayloadP50;
    console.log(
      `[note-input transport] patch=${(metrics.patchPayloadP50 / 1024).toFixed(0)}KB ` +
        `full=${(metrics.fullPayloadP50 / 1024).toFixed(0)}KB ` +
        `ratio=${(payloadRatio * 100).toFixed(1)}% ` +
        `patchFrames=${metrics.patchFrames}/${metrics.iterations} reuse=${metrics.reusePlacements}`,
    );

    expect(metrics.patchFrames, "every warmed edit must use patch transport").toBe(metrics.iterations);
    expect(metrics.fullFrames, "no warmed edit should fall back to a full frame").toBe(0);
    expect(metrics.reusePlacements, "patch frames must reuse retained systems").toBeGreaterThan(0);
    expect(payloadRatio, "patch transport must stay materially smaller than a full frame").toBeLessThan(0.25);
  }, 180_000);
});

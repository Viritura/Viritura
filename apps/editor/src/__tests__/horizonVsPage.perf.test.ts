// @vitest-environment node
/**
 * Milestone A — horizon vs. page per-edit cost on the orchestral reference score.
 *
 * The in-app perf overlay measured, on Rhapsody in Blue (510 measures × 33 parts,
 * 100% measure-cache hit):
 *
 *   - Horizon mode: WASM layout ~1016 ms   (NO retention — `fit_unpaged_bounds`
 *                                            global translate + `patch_enabled`
 *                                            requires `page_width.is_some()`)
 *   - Page mode:    WASM layout  ~438 ms   (full Phase A–T retention, patch frame)
 *
 * The ~578 ms gap *is* the retention path that page mode has and horizon doesn't.
 * Lever 0 (docs/plans/sixteen-ms-rhapsody.md) closes that gap by giving horizon
 * the same patch-frame retention. This bench is the measurement that gates and
 * validates Lever 0: it times the per-edit WASM call in BOTH modes and reports
 * the patch-frame ratio per mode.
 *
 * Expected progression:
 *   - BEFORE Lever 0: horizon emits 0 patch frames (full-frame every edit),
 *     horizon wasmCall p50 ≫ page wasmCall p50.
 *   - AFTER  Lever 0: horizon emits patch frames, horizon wasmCall p50 drops
 *     toward page-mode-class numbers.
 *
 * This file LOGS both numbers (the human reads the delta) and asserts only the
 * stable invariants so it passes both before and after Lever 0.
 *
 * Skip with `VIRITURA_SKIP_PERF=1`.
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

interface WasmLayoutEngine {
  full_layout(
    mnx_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string | null,
    score_index?: number | null,
  ): string;
  apply_patch_and_layout_patch_frame_binary(
    patch_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string | null,
    score_index?: number | null,
  ): Float32Array;
  cacheStats?: () => [number, number];
  cache_stats(): number[];
  take_timings_json(): string | undefined;
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

const SP = Number(process.env.PERF_SP ?? "8");
const PAGE_WIDTH = 816; // paged auto-flow
const HORIZON_WIDTH = 0; // page_width <= 0 → horizon (galley) mode

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx]!;
}

interface Stats {
  p50: number;
  p95: number;
  max: number;
}

function statsOf(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  return { p50: quantile(s, 0.5), p95: quantile(s, 0.95), max: s[s.length - 1] ?? 0 };
}

/** A note-input edit applied to the immer score draft. Same-area edits keep the
 *  measure-layout cache warm (reproducing the 100%-hit overlay scenario). */
function applyEdit(score: ReturnType<typeof parseMnx>, i: number): ReturnType<typeof parseMnx> {
  const steps = ["C", "D", "E", "F", "G", "A", "B"] as const;
  return produce(score, (draft) => {
    addNoteWithAutoTie(draft, {
      pitch: { step: steps[i % steps.length]!, octave: 4 },
      duration: { base: "quarter" },
      measureIndex: i % 16,
      partIndex: 0,
      voice: 0,
      beatPosition: i % 4,
    });
  });
}

interface ModeResult {
  mode: "horizon" | "page";
  pageWidth: number;
  wasmCall: Stats;
  consume: Stats; // decode + reconstruct (or full decode for full frames)
  patchFrames: number;
  iterations: number;
  cacheHitRatio: number;
  freshAvg: number;
  reuseAvg: number;
  payloadKbAvg: number;
}

function runMode(opts: {
  mode: "horizon" | "page";
  pageWidth: number;
  fixturePath: string;
  scoreIndex: number;
  iterations: number;
  warmup: number;
}): ModeResult {
  if (!glue) throw new Error("WASM glue not initialised");
  const raw = readFileSync(opts.fixturePath, "utf-8");
  let score = parseMnx(JSON.parse(raw));

  const serializer = new DeltaSerializer();
  const seed = serializer.serialize(score);
  const engine = new glue.LayoutEngine();
  engine.full_layout(seed.json, SP, opts.pageWidth, null, opts.scoreIndex);

  const reconstructor = new PatchReconstructor();
  const wasmSamples: number[] = [];
  const consumeSamples: number[] = [];
  let patchFrames = 0;
  let freshTotal = 0;
  let reuseTotal = 0;
  let cmdTotal = 0;
  let hitSum = 0;
  let hitCount = 0;

  const total = opts.warmup + opts.iterations;
  for (let i = 0; i < total; i++) {
    score = applyEdit(score, i);
    const result = serializer.serialize(score);
    if (result.structuralChange) continue;
    const patchJson = serializer.buildPatch(result.changedGlobalMeasures, result.changedPartMeasures);

    const ta = performance.now();
    const tagged = engine.apply_patch_and_layout_patch_frame_binary(
      patchJson,
      SP,
      opts.pageWidth,
      null,
      opts.scoreIndex,
    );
    const tb = performance.now();

    // decodeFrame handles both kinds: patch frame → reconstruct; full frame →
    // it already runs decodeBinaryDisplayList internally (the horizon path
    // today). Timing this captures the full per-edit consumer cost.
    const frame = decodeFrame(tagged);
    if (frame.kind === "patch") {
      reconstructor.apply(frame);
    }
    const tc = performance.now();

    if (i >= opts.warmup) {
      wasmSamples.push(tb - ta);
      consumeSamples.push(tc - tb);
      if (frame.kind === "patch") {
        patchFrames++;
        freshTotal += frame.patch.placements.filter((p) => p.kind === "fresh").length;
        reuseTotal += frame.patch.placements.filter((p) => p.kind === "reuse").length;
        cmdTotal += tagged.length;
      }
      const [hits, misses] = engine.cache_stats();
      const denom = hits + misses;
      if (denom > 0) {
        hitSum += hits / denom;
        hitCount++;
      }
    }
  }

  engine.free();

  return {
    mode: opts.mode,
    pageWidth: opts.pageWidth,
    wasmCall: statsOf(wasmSamples),
    consume: statsOf(consumeSamples),
    patchFrames,
    iterations: wasmSamples.length,
    cacheHitRatio: hitCount > 0 ? hitSum / hitCount : 0,
    freshAvg: patchFrames > 0 ? freshTotal / patchFrames : 0,
    reuseAvg: patchFrames > 0 ? reuseTotal / patchFrames : 0,
    payloadKbAvg: patchFrames > 0 ? cmdTotal / patchFrames / 256 : 0,
  };
}

function logMode(r: ModeResult): void {
  console.log(
    `[horizon-vs-page] ${r.mode.padEnd(7)} (pw=${r.pageWidth}): ` +
      `wasmCall p50=${r.wasmCall.p50.toFixed(1)}ms p95=${r.wasmCall.p95.toFixed(1)}ms | ` +
      `consume p50=${r.consume.p50.toFixed(1)}ms | ` +
      `patchFrames=${r.patchFrames}/${r.iterations} | ` +
      `fresh=${r.freshAvg.toFixed(1)} reuse=${r.reuseAvg.toFixed(1)} payload=${r.payloadKbAvg.toFixed(0)}KB | ` +
      `cacheHit=${(r.cacheHitRatio * 100).toFixed(0)}%`,
  );
}

const suite = WASM_AVAILABLE && !PERF_SKIPPED ? describe : describe.skip;
const skipReason = !WASM_AVAILABLE
  ? "WASM artifacts not built (run `pnpm wasm`)"
  : PERF_SKIPPED
    ? "VIRITURA_SKIP_PERF=1"
    : "";

suite(`horizon vs page per-edit cost${skipReason ? ` — SKIPPED: ${skipReason}` : ""}`, () => {
  it("Rhapsody in Blue (510m × 33p) — measures the Lever 0 gap", () => {
    const fixturePath = resolve(SCORE_DIR, "Rhapsody in Blue.mnx");
    const scoreIndex = 0; // Rhapsody's auto-flow score view.

    const page = runMode({
      mode: "page",
      pageWidth: PAGE_WIDTH,
      fixturePath,
      scoreIndex,
      iterations: 10,
      warmup: 3,
    });
    logMode(page);

    const horizon = runMode({
      mode: "horizon",
      pageWidth: HORIZON_WIDTH,
      fixturePath,
      scoreIndex,
      iterations: 10,
      warmup: 3,
    });
    logMode(horizon);

    const gap = horizon.wasmCall.p50 - page.wasmCall.p50;
    console.log(
      `[horizon-vs-page] Lever 0 gap (horizon − page wasmCall p50): ${gap.toFixed(1)}ms ` +
        `— closing this is the Lever 0 win.`,
    );

    // Stable invariants (pass before AND after Lever 0):
    // 1. Page mode emits patch frames (Phase A–T retention works).
    expect(page.patchFrames, "page mode must emit patch frames").toBeGreaterThan(0);
    // 2. Both modes run without error and produce timing samples.
    expect(page.iterations).toBeGreaterThan(0);
    expect(horizon.iterations).toBeGreaterThan(0);
    // 3. Measure-cache hit is high in both modes (same content, warm).
    expect(page.cacheHitRatio).toBeGreaterThan(0.9);
    expect(horizon.cacheHitRatio).toBeGreaterThan(0.9);

    // Lever 0 (LANDED): horizon now emits patch frames every edit, matching
    // page mode. Was 0/10 before Lever 0 (full-frame each edit).
    expect(horizon.patchFrames, "horizon must emit patch frames (Lever 0)").toBeGreaterThan(0);
  }, 120_000);

  it("horizon patch frame reconstructs identically to the full frame (Lever 0 correctness)", () => {
    const fixturePath = resolve(SCORE_DIR, "Rhapsody in Blue.mnx");
    const scoreIndex = 0;
    const raw = readFileSync(fixturePath, "utf-8");
    let score = parseMnx(JSON.parse(raw));

    // Two engines fed identical horizon edits: one returns full frames, the
    // other patch frames. The reconstructed patch DisplayList must match the
    // full frame command-for-command (position, not just count).
    const baseSerializer = new DeltaSerializer();
    const patchSerializer = new DeltaSerializer();
    const baseEngine = new glue!.LayoutEngine();
    const patchEngine = new glue!.LayoutEngine();
    baseEngine.full_layout(baseSerializer.serialize(score).json, SP, HORIZON_WIDTH, null, scoreIndex);
    patchEngine.full_layout(patchSerializer.serialize(score).json, SP, HORIZON_WIDTH, null, scoreIndex);

    const reconstructor = new PatchReconstructor();
    let comparedFrames = 0;

    for (let i = 0; i < 8; i++) {
      score = applyEdit(score, i);
      const baseResult = baseSerializer.serialize(score);
      const patchResult = patchSerializer.serialize(score);
      if (baseResult.structuralChange || patchResult.structuralChange) continue;

      const baseBin = baseEngine.apply_patch_and_layout_binary(
        baseSerializer.buildPatch(baseResult.changedGlobalMeasures, baseResult.changedPartMeasures),
        SP,
        HORIZON_WIDTH,
        null,
        scoreIndex,
      );
      const baseDl = decodeBinaryDisplayList(baseBin);

      const tagged = patchEngine.apply_patch_and_layout_patch_frame_binary(
        patchSerializer.buildPatch(patchResult.changedGlobalMeasures, patchResult.changedPartMeasures),
        SP,
        HORIZON_WIDTH,
        null,
        scoreIndex,
      );
      const frame = decodeFrame(tagged);
      if (frame.kind !== "patch") continue; // only compare when a patch frame was emitted
      const patchDl = reconstructor.apply(frame);

      // Command count must match.
      expect(patchDl.commands.length, `frame ${i}: command count`).toBe(baseDl.commands.length);
      // Canvas dims must match (structural galley dims agree).
      expect(patchDl.width, `frame ${i}: width`).toBeCloseTo(baseDl.width, 1);
      expect(patchDl.height, `frame ${i}: height`).toBeCloseTo(baseDl.height, 1);
      // Page list must match — including each page's y_offset, which carries
      // the constant galley offset (regression guard: the reconstructor must
      // apply galleyOffsetY to pages, not just commands).
      expect(patchDl.pages?.length ?? 0, `frame ${i}: page count`).toBe(baseDl.pages?.length ?? 0);
      if (baseDl.pages && patchDl.pages) {
        for (let pg = 0; pg < baseDl.pages.length; pg++) {
          expect(patchDl.pages[pg]!.yOffset, `frame ${i} page ${pg}: yOffset`).toBeCloseTo(
            baseDl.pages[pg]!.yOffset,
            1,
          );
        }
      }
      // Spot-check positions across the frame: every 200th command's first
      // coordinate pair must match within sub-pixel tolerance.
      for (let c = 0; c < patchDl.commands.length; c += 200) {
        const pc = patchDl.commands[c]!;
        const bc = baseDl.commands[c]!;
        expect(pc.type, `frame ${i} cmd ${c}: type`).toBe(bc.type);
        const py = firstY(pc);
        const by = firstY(bc);
        if (py !== null && by !== null) {
          expect(py, `frame ${i} cmd ${c}: y (${pc.type})`).toBeCloseTo(by, 1);
        }
      }
      comparedFrames++;
    }

    baseEngine.free();
    patchEngine.free();

    expect(comparedFrames, "must have compared at least one horizon patch frame").toBeGreaterThan(0);
  }, 120_000);
});

/** First Y-bearing coordinate of a render command, for spot-check comparison. */
function firstY(cmd: { type: string } & Record<string, unknown>): number | null {
  for (const key of ["cy", "y1", "y", "iy1"]) {
    const v = cmd[key];
    if (typeof v === "number") return v;
  }
  return null;
}

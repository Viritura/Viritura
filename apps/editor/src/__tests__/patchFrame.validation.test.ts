// @vitest-environment node
/**
 * Patch-frame reconstruction validation.
 *
 * Drives the incremental (paged) layout path through two parallel engines fed
 * identical edits: one returns a full binary display list, the other a
 * patch frame. The patch frame is decoded and reassembled by
 * {@link PatchReconstructor}; the result must match the full display list.
 *
 * Cold frames (all-Fresh, no reuse shift) must match exactly — the patch just
 * partitions the same `to_binary` floats. Warm frames reuse prior-frame
 * segments shifted by `dy`, where one extra f32 rounding can differ by a ULP,
 * so those are compared within a sub-pixel tolerance.
 *
 * Skip with `VIRITURA_SKIP_PERF=1` (shares the perf harness's WASM artifacts).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DeltaSerializer, parseMnx } from "@viritura/format";
import { isRest } from "@viritura/core";
import { decodeBinaryDisplayList, decodeFrame, PatchReconstructor } from "@viritura/renderer";
import type { DisplayList } from "@viritura/renderer";
import { changePitch } from "../commands/noteCommands";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = resolve(__dirname, "../../../../engine/viritura-wasm/pkg-browser");
const SCORE_DIR = resolve(__dirname, "../../../../packages/format/fixtures/mnx");
const WASM_BYTES_PATH = resolve(WASM_DIR, "viritura_wasm_bg.wasm");
const WASM_GLUE_PATH = resolve(WASM_DIR, "viritura_wasm.js");

const WASM_AVAILABLE = existsSync(WASM_BYTES_PATH) && existsSync(WASM_GLUE_PATH);
const SKIPPED = process.env.VIRITURA_SKIP_PERF === "1";

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
  if (!WASM_AVAILABLE || SKIPPED) return;
  const bytes = readFileSync(WASM_BYTES_PATH);
  const mod = new WebAssembly.Module(bytes);
  const imported = (await import(/* @vite-ignore */ pathToFileURL(WASM_GLUE_PATH).href)) as unknown as WasmGlue;
  imported.initSync({ module: mod });
  glue = imported;
});

const SP = 8;
const PAGE_WIDTH = 816; // Paged layout → exercises the auto-flow patch path.

/** Recursively compare two decoded display lists, allowing a numeric tolerance. */
function assertApproxEqual(actual: unknown, expected: unknown, tol: number, path = "$"): void {
  if (typeof expected === "number") {
    expect(typeof actual, `${path}: type`).toBe("number");
    const a = actual as number;
    if (Number.isNaN(expected)) {
      expect(Number.isNaN(a), `${path}: NaN`).toBe(true);
    } else {
      expect(Math.abs(a - expected), `${path}: ${a} vs ${expected}`).toBeLessThanOrEqual(tol);
    }
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path}: array`).toBe(true);
    const a = actual as unknown[];
    expect(a.length, `${path}: length`).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      assertApproxEqual(a[i], expected[i], tol, `${path}[${i}]`);
    }
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(actual !== null && typeof actual === "object", `${path}: object`).toBe(true);
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
    for (const key of keys) {
      assertApproxEqual(a[key], e[key], tol, `${path}.${key}`);
    }
    return;
  }
  expect(actual, `${path}: scalar`).toBe(expected);
}

interface EditDriver {
  patchJson(): string;
  advance(): void;
}

interface NoteLocation {
  partIndex: number;
  measureIndex: number;
  voice: number;
  eventIndex: number;
}

/** First top-level (non-tuplet) note event in the score, or null if none. */
function findNoteLocation(score: ReturnType<typeof parseMnx>): NoteLocation | null {
  for (let p = 0; p < score.parts.length; p++) {
    const measures = score.parts[p]!.measures;
    for (let m = 0; m < measures.length; m++) {
      const sequences = measures[m]!.sequences ?? [];
      for (let v = 0; v < sequences.length; v++) {
        const content = sequences[v]!.content ?? [];
        for (let e = 0; e < content.length; e++) {
          const item = content[e]!;
          if (item.type === "event" && !isRest(item) && (item.notes?.length ?? 0) > 0) {
            return { partIndex: p, measureIndex: m, voice: v, eventIndex: e };
          }
        }
      }
    }
  }
  return null;
}

/** Builds the per-edit patch JSON the same way the live editor hot path does. */
function makeEditDriver(fixturePath: string): { seedJson: string; driver: EditDriver } {
  const raw = readFileSync(fixturePath, "utf-8");
  let score = parseMnx(JSON.parse(raw));
  const serializer = new DeltaSerializer();
  // Establish the delta baseline; the per-frame patches diff against this.
  serializer.serialize(score);
  let i = 0;

  // Re-pitch ONE existing note each frame (alternating between two pitches of
  // the same duration). Unlike adding notes, this never changes measure widths,
  // so only the edited system reflows — every downstream system stays unchanged
  // and is emitted as a Reuse placement (the warm path this test validates).
  const loc = findNoteLocation(score);

  const driver: EditDriver = {
    patchJson(): string {
      if (!loc) throw new Error("fixture has no editable note");
      const newPitch = i % 2 === 0 ? { step: "G" as const, octave: 5 } : { step: "A" as const, octave: 4 };
      score = changePitch(score, { ...loc, newPitch });
      const result = serializer.serialize(score);
      return serializer.buildPatch(result.changedGlobalMeasures, result.changedPartMeasures);
    },
    advance(): void {
      i++;
    },
  };
  // Seed wasm with the FULL MNX (the raw fixture), so `score.layouts`/`scores`
  // survive and `full_layout` routes to the auto-flow path that emits patches —
  // exactly what the live editor does. The DeltaSerializer json strips those.
  return { seedJson: raw, driver };
}

/**
 * Find a score index for `fixturePath` whose paged layout emits a patch frame
 * (tag 1.0). Explicit-page layouts return a full frame (tag 0.0) and are
 * skipped. Returns null if no index emits a patch within the probe range.
 */
function findPatchScoreIndex(fixturePath: string): number | null {
  if (!glue) throw new Error("WASM glue not initialised");
  // Match the Rust oracle: default page setup (no custom A4 height). A custom
  // page setup pushes some score views onto the explicit-pages branch (no
  // patch) and traps others, so the auto-flow patch path is only reached with
  // the engine's default page metrics.
  const pageSetup = undefined;

  const freeQuietly = (engine: WasmLayoutEngine): void => {
    try {
      engine.free();
    } catch {
      /* engine trapped (e.g. out-of-range score_index) — nothing to free */
    }
  };

  for (let scoreIndex = 0; scoreIndex < 8; scoreIndex++) {
    const { seedJson, driver } = makeEditDriver(fixturePath);
    const engine = new glue.LayoutEngine();

    // full_layout traps on some score indices (out-of-range, or a view that
    // panics); each iteration uses a FRESH engine so a trap can't poison the
    // next probe. Skip a trapped index and keep looking.
    let laidOut = false;
    try {
      engine.full_layout(seedJson, SP, PAGE_WIDTH, pageSetup, scoreIndex);
      laidOut = true;
    } catch {
      /* full_layout trapped on this view (out-of-range index, etc.) — skip */
    }
    if (!laidOut) {
      freeQuietly(engine);
      continue;
    }

    // A throw HERE is a genuine patch-path failure — let it propagate.
    try {
      let patchJson: string;
      try {
        patchJson = driver.patchJson();
      } catch {
        // Fixture's part 0 can't take the generic single-note edit (e.g. no
        // measure 0) — unsupported by this harness, skip the whole fixture.
        return null;
      }
      const tagged = engine.apply_patch_and_layout_patch_frame_binary(patchJson, SP, PAGE_WIDTH, pageSetup, scoreIndex);
      if (tagged[0] === 1.0) return scoreIndex;
    } finally {
      freeQuietly(engine);
    }
  }
  return null;
}

const FIXTURES = ["multimeasure-rests"];

const suite = WASM_AVAILABLE && !SKIPPED ? describe : describe.skip;

// Counts Reuse placements reconstructed across the whole suite, so we can prove
// the JS reuse+translate path was genuinely exercised (not just all-Fresh).
let totalReuseSeen = 0;

suite("patch-frame reconstruction matches full layout", () => {
  afterAll(() => {
    expect(totalReuseSeen, "warm-frame reuse+translate path must be exercised").toBeGreaterThan(0);
  });

  for (const fixture of FIXTURES) {
    it(`${fixture}: cold + warm frames reconstruct the full display list`, () => {
      if (!glue) throw new Error("WASM glue not initialised");
      const fixturePath = resolve(SCORE_DIR, `${fixture}.mnx`);
      const scoreIndex = findPatchScoreIndex(fixturePath);
      if (scoreIndex === null) {
        // No paged auto-flow score view in this fixture — nothing to validate.
        return;
      }

      const pageSetup = undefined;
      const { seedJson, driver } = makeEditDriver(fixturePath);

      const full = new glue.LayoutEngine();
      const patch = new glue.LayoutEngine();
      full.full_layout(seedJson, SP, PAGE_WIDTH, pageSetup, scoreIndex);
      patch.full_layout(seedJson, SP, PAGE_WIDTH, pageSetup, scoreIndex);

      const reconstructor = new PatchReconstructor();

      try {
        for (let frame = 0; frame < 6; frame++) {
          const patchJson = driver.patchJson();
          const fullBin = full.apply_patch_and_layout_binary(patchJson, SP, PAGE_WIDTH, pageSetup, scoreIndex);
          const taggedBin = patch.apply_patch_and_layout_patch_frame_binary(
            patchJson,
            SP,
            PAGE_WIDTH,
            pageSetup,
            scoreIndex,
          );
          driver.advance();

          const expected: DisplayList = decodeBinaryDisplayList(fullBin);
          const decoded = decodeFrame(taggedBin);
          expect(decoded.kind, `${fixture} frame ${frame} must emit a patch`).toBe("patch");

          if (decoded.kind === "patch") {
            if (frame === 0) {
              // Cold frame: every system is Fresh, so reconstruction is just a
              // re-partition of the same floats — it must match exactly.
              expect(
                decoded.patch.placements.every((p) => p.kind === "fresh"),
                `${fixture}: cold frame should be all-Fresh`,
              ).toBe(true);
            }
            totalReuseSeen += decoded.patch.placements.filter((p) => p.kind === "reuse").length;
          }

          const actual = reconstructor.apply(decoded, frame > 0);
          if (decoded.kind === "patch") {
            expect(actual.retainedRenderLayers).toHaveLength(decoded.patch.placements.length + 2);
            expect(Object.prototype.propertyIsEnumerable.call(actual, "retainedRenderLayers")).toBe(false);
          }
          actual.finalizeRetainedFrame?.();
          // Sub-pixel tolerance absorbs the single extra f32 round on shifted
          // (reused) segments; cold frames are well within it (exact).
          assertApproxEqual(actual, expected, 1e-3, `${fixture}#${frame}`);
        }
      } finally {
        full.free();
        patch.free();
      }
    });
  }

  it("reconstructs a source-only slur patch spanning multiple systems", () => {
    if (!glue) throw new Error("WASM glue not initialised");
    const measures = Array.from({ length: 16 }, (_, index) => ({
      sequences: [
        {
          content: [
            {
              id: `ev-${index}`,
              duration: { base: "whole" },
              notes: [{ pitch: { step: "C", octave: 4 } }],
            },
          ],
        },
      ],
    }));
    const seed = JSON.stringify({
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, ...Array.from({ length: 15 }, () => ({}))] },
      parts: [{ id: "P1", name: "Flute", measures }],
      layouts: [{ id: "full", content: [{ type: "staff", sources: [{ part: "P1" }] }] }],
      scores: [{ name: "Full Score", layout: "full" }],
    });
    const sourceMeasure = structuredClone(measures[0]!);
    sourceMeasure.sequences[0]!.content[0]!.slurs = [{ target: "ev-12" }];
    const patchJson = JSON.stringify({ partMeasures: { 0: { 0: sourceMeasure } } });

    const full = new glue.LayoutEngine();
    const patch = new glue.LayoutEngine();
    const reconstructor = new PatchReconstructor();
    try {
      full.full_layout(seed, SP, 160, undefined, 0);
      patch.full_layout(seed, SP, 160, undefined, 0);

      const expected = decodeBinaryDisplayList(full.apply_patch_and_layout_binary(patchJson, SP, 160, undefined, 0));
      const decoded = decodeFrame(patch.apply_patch_and_layout_patch_frame_binary(patchJson, SP, 160, undefined, 0));
      const actual = reconstructor.apply(decoded);
      actual.finalizeRetainedFrame?.();

      expect(actual.elementIds).toContain("slur/ev-0/ev-12");
      assertApproxEqual(actual, expected, 1e-3, "long slur patch frame");
    } finally {
      full.free();
      patch.free();
    }
  });
});

// Lever 0: horizon (pageWidth 0) now emits patch frames too. Reconstruction
// correctness for horizon — including the page list's `y_offset` carrying the
// constant galley offset — is validated on the Rhapsody fixture (which chunks
// into many segments) in `horizonVsPage.perf.test.ts`'s correctness case.
// Small fixtures fit in a single horizon chunk, so they can't exercise the
// chunk-reuse path here.

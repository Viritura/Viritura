// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../score/ScoreBuilder";

const wasmDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "engine",
  "viritura-wasm",
  "pkg-browser",
);
const wasmPath = resolve(wasmDir, "viritura_wasm_bg.wasm");
const gluePath = resolve(wasmDir, "viritura_wasm.js");

interface WasmLayoutEngine {
  compute_layout_cached(json: string, part: number, sp: number, width: number): string;
  full_layout(json: string, sp: number, width: number): string;
  relayout_retained_score_cached(sp: number, width: number): string;
  apply_patch_and_layout(json: string, sp: number, width: number): string;
  has_retained_score(): boolean;
  free(): void;
}

interface WasmGlue {
  initSync(options: { module: WebAssembly.Module }): void;
  LayoutEngine: new () => WasmLayoutEngine;
  compute_layout(json: string, part: number, sp: number, width: number): string;
  compute_layout_binary(json: string, part: number, sp: number, width: number): Float32Array;
}

const populatedScore = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: [
    {
      id: "P1",
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  duration: { base: "whole" },
                  notes: [{ pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

// Like the existing WASM performance suites, this runs when `pnpm wasm:build`
// has produced the browser bindings. Native tests cannot detect trapped borrows.
describe.skipIf(!existsSync(wasmPath) || !existsSync(gluePath))("empty-score WASM ownership", () => {
  let wasm: WasmGlue;

  beforeAll(async () => {
    wasm = (await import(/* @vite-ignore */ pathToFileURL(gluePath).href)) as WasmGlue;
    wasm.initSync({ module: new WebAssembly.Module(readFileSync(wasmPath)) });
  });

  it.each(["single", "full"] as const)(
    "loads an instrument-less new score via %s and reuses the retained engine",
    (path) => {
      const json = buildBlankScore(DEFAULT_NEW_SCORE_SETTINGS);
      expect(JSON.parse(json).parts).toEqual([]);
      const engine = new wasm.LayoutEngine();
      const initial =
        path === "single" ? engine.compute_layout_cached(json, 0, 10, 800) : engine.full_layout(json, 10, 800);
      if (path === "single") {
        expect(JSON.parse(initial)).toMatchObject({ commands: [], width: 0, height: 0 });
      } else {
        expect(JSON.parse(initial).commands).toContainEqual(
          expect.objectContaining({ type: "DrawText", text: "Untitled Score" }),
        );
        expect(JSON.parse(initial).width).toBeGreaterThan(0);
        expect(JSON.parse(initial).height).toBeGreaterThan(0);
      }
      expect(engine.has_retained_score()).toBe(true);
      for (const result of [
        engine.relayout_retained_score_cached(10, 800),
        engine.apply_patch_and_layout("{}", 10, 800),
      ]) {
        expect(JSON.parse(result).commands).toContainEqual(
          expect.objectContaining({ type: "DrawText", text: "Untitled Score" }),
        );
      }

      expect(JSON.parse(engine.full_layout(populatedScore, 10, 800)).commands.length).toBeGreaterThan(0);
      expect(() => engine.free()).not.toThrow();
    },
  );

  it("returns an ordinary invalid-index error without trapping the cached engine", () => {
    const engine = new wasm.LayoutEngine();
    expect(() => engine.compute_layout_cached(populatedScore, 1, 10, 800)).toThrow(/Part index 1 is out of range/);
    expect(JSON.parse(engine.compute_layout_cached(populatedScore, 0, 10, 800)).commands.length).toBeGreaterThan(0);
    expect(() => engine.free()).not.toThrow();
  });

  it("keeps stateless JSON and binary layouts safe for empty scores and invalid indices", () => {
    const json = buildBlankScore(DEFAULT_NEW_SCORE_SETTINGS);
    expect(JSON.parse(wasm.compute_layout(json, 0, 10, 800))).toMatchObject({ commands: [] });
    expect(wasm.compute_layout_binary(json, 0, 10, 800).length).toBeGreaterThan(0);
    expect(() => wasm.compute_layout(populatedScore, 1, 10, 800)).toThrow(/Part index 1 is out of range/);
    expect(() => wasm.compute_layout_binary(populatedScore, 1, 10, 800)).toThrow(/Part index 1 is out of range/);
    expect(wasm.compute_layout_binary(populatedScore, 0, 10, 800).length).toBeGreaterThan(0);
  });
});

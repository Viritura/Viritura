import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeBinaryDisplayList } from "../binaryDisplayList";
import { detectHorizonStaves, extractStickyClefInfo, paintStickyClefs } from "../overlayPainter";
import * as wasm from "../wasm";

const wasmDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "engine",
  "viritura-wasm",
  "pkg-browser",
);
const wasmBytesPath = resolve(wasmDirectory, "viritura_wasm_bg.wasm");
const wasmGluePath = resolve(wasmDirectory, "viritura_wasm.js");

interface EngineGlue {
  initSync(options: { module: WebAssembly.Module }): void;
  compute_key_signature_positions(fifths: number, clefSign: string): Float64Array;
  compute_layout_binary(json: string, partIndex: number, spatium: number, pageWidth: number): Float32Array;
  compute_full_score_layout_binary(json: string, spatium: number, pageWidth: number): Float32Array;
}

const note = { type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] };
const mnx = JSON.stringify({
  mnx: { version: 1 },
  global: {
    measures: [
      { time: { count: 4, unit: 4 }, key: { fifths: 2 } },
      {},
      { key: { fifths: -1 } },
      { key: { fifths: 0 } },
    ],
  },
  parts: [
    {
      measures: [
        { clefs: [{ clef: { sign: "G", staffPosition: -2 } }], sequences: [{ content: [note] }] },
        { clefs: [{ clef: { sign: "F", staffPosition: 2 } }], sequences: [{ content: [note] }] },
        { sequences: [{ content: [note] }] },
        { sequences: [{ content: [note] }] },
      ],
    },
  ],
});

function scoreWithClefChange(clef: { sign: "F"; staffPosition: number; glyph?: string; hide?: boolean }): string {
  return JSON.stringify({
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 2 } }, {}] },
    parts: [
      {
        measures: [
          { clefs: [{ clef: { sign: "G", staffPosition: -2 } }], sequences: [{ content: [note] }] },
          { clefs: [{ clef }], sequences: [{ content: [note] }] },
        ],
      },
    ],
  });
}

afterEach(() => vi.restoreAllMocks());

describe.skipIf(!existsSync(wasmBytesPath) || !existsSync(wasmGluePath))("sticky rail with the WASM engraver", () => {
  let glue: EngineGlue;

  beforeAll(async () => {
    glue = (await import(/* @vite-ignore */ pathToFileURL(wasmGluePath).href)) as EngineGlue;
    glue.initSync({ module: new WebAssembly.Module(readFileSync(wasmBytesPath)) });
    expect(glue.compute_key_signature_positions, "Rebuild browser WASM with pnpm wasm:build").toBeTypeOf("function");
  });

  it("uses real tagged signatures and re-engraves an inherited key after a clef change", () => {
    const dl = decodeBinaryDisplayList(glue.compute_layout_binary(mnx, 0, 10, 0));
    const staves = detectHorizonStaves(dl);
    const info = extractStickyClefInfo(dl, staves);
    expect(staves).toHaveLength(1);
    expect(info[0]!.clefs).toHaveLength(2);
    expect(info[0]!.keySignatures.map((key) => key.glyphs.length)).toEqual([2, 1, 0]);

    const positions = vi
      .spyOn(wasm, "computeKeySignaturePositions")
      .mockImplementation((fifths, sign) => Array.from(glue.compute_key_signature_positions(fifths, sign)));
    const fillText = vi.fn();
    const ctx = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D;
    const clefChange = info[0]!.clefs[1]!;
    const nextKey = info[0]!.keySignatures[1]!;
    expect(clefChange.x).toBeLessThan(nextKey.x);
    paintStickyClefs(ctx, staves, info, clefChange.x + 0.01, 1);
    expect(positions).toHaveBeenCalledWith(2, "F");
    const sharpCalls = fillText.mock.calls.filter(([text]) => text === String.fromCodePoint(0xe262));
    const staffTop = staves[0]!.y;
    const sp = staves[0]!.spatium;
    expect(sharpCalls.map((call) => call[2])).toEqual([staffTop + sp, staffTop + 2.5 * sp]);
  });

  it.each([
    ["custom glyph", { sign: "F" as const, staffPosition: 2, glyph: "gClef" }],
    ["hidden clef", { sign: "F" as const, staffPosition: 2, hide: true }],
  ])("uses the semantic clef after a %s change", (_description, clef) => {
    const dl = decodeBinaryDisplayList(glue.compute_layout_binary(scoreWithClefChange(clef), 0, 10, 0));
    const staves = detectHorizonStaves(dl);
    const info = extractStickyClefInfo(dl, staves);
    const change =
      "hide" in clef && clef.hide ? dl.measureBounds!.find((bound) => bound.index === 1)!.x : info[0]!.clefs[1]!.x;
    vi.spyOn(wasm, "computeKeySignaturePositions").mockImplementation((fifths, sign) =>
      Array.from(glue.compute_key_signature_positions(fifths, sign)),
    );
    const fillText = vi.fn();
    const ctx = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D;
    paintStickyClefs(ctx, staves, info, change + 0.01, 1);
    const sharpCalls = fillText.mock.calls.filter(([text]) => text === String.fromCodePoint(0xe262));
    const expected = Array.from(
      glue.compute_key_signature_positions(2, "F"),
      (y) => staves[0]!.y + y * staves[0]!.spatium,
    );
    expect(sharpCalls.map((call) => call[2])).toEqual(expected);
  });

  it("uses resolved clef contexts for both staves of a full score", () => {
    const score = JSON.parse(scoreWithClefChange({ sign: "F", staffPosition: 2, glyph: "gClef" })) as {
      parts: unknown[];
    };
    score.parts.push({
      measures: [
        { clefs: [{ clef: { sign: "F", staffPosition: 2 } }], sequences: [{ content: [note] }] },
        { sequences: [{ content: [note] }] },
      ],
    });
    const dl = decodeBinaryDisplayList(glue.compute_full_score_layout_binary(JSON.stringify(score), 10, 0));
    const staves = detectHorizonStaves(dl);
    const info = extractStickyClefInfo(dl, staves);
    expect(staves).toHaveLength(2);
    expect(info[0]!.clefContexts.map((context) => context.sign)).toContain("F");
    const change = info[0]!.clefs[1]!.x;
    vi.spyOn(wasm, "computeKeySignaturePositions").mockImplementation((fifths, sign) =>
      Array.from(glue.compute_key_signature_positions(fifths, sign)),
    );
    const fillText = vi.fn();
    const ctx = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D;
    paintStickyClefs(ctx, staves, info, change + 0.01, 1);
    const sharpCalls = fillText.mock.calls.filter(([text]) => text === String.fromCodePoint(0xe262));
    const expected = staves.flatMap((staff) =>
      Array.from(glue.compute_key_signature_positions(2, "F"), (y) => staff.y + y * staff.spatium),
    );
    expect(sharpCalls.map((call) => call[2])).toEqual(expected);
  });

  it("keeps grand-staff clef contexts separate when their tags share a part", () => {
    const sequences = [
      { staff: 1, content: [note] },
      { staff: 2, content: [note] },
    ];
    const score = JSON.stringify({
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 2 } }, {}] },
      parts: [
        {
          staves: 2,
          measures: [
            {
              clefs: [
                { staff: 1, clef: { sign: "G", staffPosition: -2 } },
                { staff: 2, clef: { sign: "F", staffPosition: 2 } },
              ],
              sequences,
            },
            {
              clefs: [
                { staff: 1, clef: { sign: "F", staffPosition: 2, glyph: "gClef" } },
                { staff: 2, clef: { sign: "G", staffPosition: -2, glyph: "fClef" } },
              ],
              sequences,
            },
          ],
        },
      ],
    });
    const dl = decodeBinaryDisplayList(glue.compute_layout_binary(score, 0, 10, 0));
    const staves = detectHorizonStaves(dl);
    const info = extractStickyClefInfo(dl, staves);
    expect(staves).toHaveLength(2);
    expect(info.map((staff) => staff.clefs.length)).toEqual([2, 2]);
    const change = Math.max(...info.map((staff) => staff.clefs[1]!.x));
    vi.spyOn(wasm, "computeKeySignaturePositions").mockImplementation((fifths, sign) =>
      Array.from(glue.compute_key_signature_positions(fifths, sign)),
    );
    const fillText = vi.fn();
    const ctx = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D;
    paintStickyClefs(ctx, staves, info, change + 0.01, 1);
    const sharpCalls = fillText.mock.calls.filter(([text]) => text === String.fromCodePoint(0xe262));
    const expected = staves.flatMap((staff, index) =>
      Array.from(glue.compute_key_signature_positions(2, index === 0 ? "F" : "G"), (y) => staff.y + y * staff.spatium),
    );
    expect(sharpCalls.map((call) => call[2])).toEqual(expected);
  });

  it.each([
    ["custom", { glyph: "gClef" }],
    ["hidden", { hide: true }],
  ])("uses semantic context for a %s mid-measure clef change", (_description, clefOptions) => {
    const quarter = { ...note, duration: { base: "quarter" } };
    const score = JSON.stringify({
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 2 } }] },
      parts: [
        {
          measures: [
            {
              clefs: [
                { clef: { sign: "G", staffPosition: -2 } },
                { position: { fraction: [1, 2] }, clef: { sign: "F", staffPosition: 2, ...clefOptions } },
              ],
              sequences: [{ content: [quarter, quarter, quarter, quarter] }],
            },
          ],
        },
      ],
    });
    const dl = decodeBinaryDisplayList(glue.compute_layout_binary(score, 0, 10, 0));
    const staves = detectHorizonStaves(dl);
    const info = extractStickyClefInfo(dl, staves);
    const change = info[0]!.clefContexts.find((context) => context.sign === "F");
    expect(change).toBeDefined();
    vi.spyOn(wasm, "computeKeySignaturePositions").mockImplementation((fifths, sign) =>
      Array.from(glue.compute_key_signature_positions(fifths, sign)),
    );
    const fillText = vi.fn();
    const ctx = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D;
    paintStickyClefs(ctx, staves, info, change!.x + 0.01, 1);
    const sharpCalls = fillText.mock.calls.filter(([text]) => text === String.fromCodePoint(0xe262));
    const expected = Array.from(
      glue.compute_key_signature_positions(2, "F"),
      (y) => staves[0]!.y + y * staves[0]!.spatium,
    );
    expect(sharpCalls.map((call) => call[2])).toEqual(expected);
  });
});

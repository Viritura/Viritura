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
});

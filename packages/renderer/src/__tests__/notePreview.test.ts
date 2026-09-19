import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AccidentalType, NoteValueBase } from "@viritura/core";
import { paintGhostNote, type StaffInfo } from "../overlayPainter";
import * as wasm from "../wasm";
import type { DrawGlyph, NotePreviewInput, RenderCommand } from "../wasm";

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

interface PreviewGlue {
  initSync(options: { module: WebAssembly.Module }): void;
  compute_note_preview(input: string): string;
}

const input: NotePreviewInput = { x: 120, y: 124, staffY: 100, spatium: 12, duration: "quarter" };
const staff: StaffInfo = { x: 20, xEnd: 420, y: 100, spatium: 12, height: 48, index: 0 };
let glue: PreviewGlue;

function preview(overrides: Partial<NotePreviewInput> = {}): RenderCommand[] {
  return JSON.parse(glue.compute_note_preview(JSON.stringify({ ...input, ...overrides }))) as RenderCommand[];
}

function glyphs(commands: RenderCommand[]): DrawGlyph[] {
  return commands.filter((command) => command.type === "DrawGlyph");
}

afterEach(() => vi.restoreAllMocks());

it("omits an uninitialized WASM ghost rather than inventing a different rhythm", () => {
  expect(wasm.computeNotePreview(input)).toEqual([]);
});

describe.skipIf(!existsSync(wasmBytesPath) || !existsSync(wasmGluePath))("Rust note-preview integration", () => {
  beforeAll(async () => {
    glue = (await import(/* @vite-ignore */ pathToFileURL(wasmGluePath).href)) as PreviewGlue;
    glue.initSync({ module: new WebAssembly.Module(readFileSync(wasmBytesPath)) });
    expect(glue.compute_note_preview, "Rebuild the browser WASM with pnpm wasm:build").toBeTypeOf("function");
  });

  const rhythms: { duration: NoteValueBase; head: number; upFlag?: number; downFlag?: number }[] = [
    { duration: "whole", head: 0xe0a2 },
    { duration: "half", head: 0xe0a3 },
    { duration: "quarter", head: 0xe0a4 },
    { duration: "eighth", head: 0xe0a4, upFlag: 0xe240, downFlag: 0xe241 },
    { duration: "16th", head: 0xe0a4, upFlag: 0xe242, downFlag: 0xe243 },
    { duration: "32nd", head: 0xe0a4, upFlag: 0xe244, downFlag: 0xe245 },
    { duration: "64th", head: 0xe0a4, upFlag: 0xe246, downFlag: 0xe247 },
    // Shared rendering preserves the head and stem when SMuFL has no flag glyph.
    { duration: "2048th", head: 0xe0a4 },
    { duration: "4096th", head: 0xe0a4 },
  ];

  describe.each(["up", "down"] as const)("%s stems", (stemDirection) => {
    it.each(rhythms)(
      "engraves $duration with its real notehead, stem and flag",
      ({ duration, head, upFlag, downFlag }) => {
        const commands = preview({ duration, stemDirection });
        const notes = glyphs(commands);
        const flag = stemDirection === "up" ? upFlag : downFlag;
        expect(notes.map((glyph) => glyph.codepoint)).toEqual(flag ? [head, flag] : [head]);
        expect(notes.every((glyph) => glyph.font === "Bravura")).toBe(true);
        const stems = commands.filter((command) => command.type === "DrawLine");
        expect(stems).toHaveLength(duration === "whole" ? 0 : 1);
        if (duration === "whole") return;
        const stem = stems[0]!;
        expect(stem.x1).toBeCloseTo(stem.x2);
        expect(stem.width).toBeGreaterThan(0);
        if (stemDirection === "up") {
          expect(Math.min(stem.y1, stem.y2)).toBeLessThan(input.y - 2 * input.spatium);
          expect(stem.x1).toBeGreaterThan(input.x);
        } else {
          expect(Math.max(stem.y1, stem.y2)).toBeGreaterThan(input.y + 2 * input.spatium);
        }
      },
    );

    it.each([0, 1, 2, 3, 4])("engraves %i evenly spaced augmentation dots above a staff line", (dots) => {
      const commands = preview({ duration: "16th", stemDirection, dots });
      const dotGlyphs = glyphs(commands).filter((glyph) => glyph.codepoint === 0xe1e7);
      expect(dotGlyphs).toHaveLength(dots);
      for (const [index, dot] of dotGlyphs.entries()) {
        expect(dot.x).toBeGreaterThan(input.x + input.spatium);
        expect(dot.y).toBeCloseTo(input.y - input.spatium / 2);
        if (index > 0) expect(dot.x - dotGlyphs[index - 1]!.x).toBeCloseTo(input.spatium * 0.5);
      }
    });
  });

  it("keeps space-note dots on the note's space", () => {
    const y = input.staffY + input.spatium * 2.5;
    const dot = glyphs(preview({ y, dots: 1 })).find((glyph) => glyph.codepoint === 0xe1e7)!;
    expect(dot.y).toBeCloseTo(y);
  });

  it("scales every glyph and line with the actual staff spatium", () => {
    const original = preview({ duration: "32nd", dots: 2, accidental: "sharp", y: 160 });
    const scaled = preview({
      duration: "32nd",
      dots: 2,
      accidental: "sharp",
      x: input.x * 2,
      y: 320,
      staffY: input.staffY * 2,
      spatium: input.spatium * 2,
    });
    expect(scaled).toHaveLength(original.length);
    original.forEach((command, index) => {
      const larger = scaled[index]!;
      expect(larger.type).toBe(command.type);
      if (command.type === "DrawGlyph" && larger.type === "DrawGlyph") {
        expect(larger.codepoint).toBe(command.codepoint);
        expect(larger.x).toBeCloseTo(command.x * 2);
        expect(larger.y).toBeCloseTo(command.y * 2);
        expect(larger.size).toBeCloseTo(command.size * 2);
      } else if (command.type === "DrawLine" && larger.type === "DrawLine") {
        for (const key of ["x1", "y1", "x2", "y2", "width"] as const) {
          expect(larger[key]).toBeCloseTo(command[key] * 2);
        }
      }
    });
  });

  it("uses shared accidental and ledger-line engraving", () => {
    const commands = preview({ y: 160, accidental: "flat" });
    const accidental = glyphs(commands).find((glyph) => glyph.codepoint === 0xe260)!;
    expect(accidental.x).toBeLessThan(input.x);
    expect(accidental.y).toBe(160);
    const ledgers = commands.filter((command) => command.type === "DrawLine" && command.y1 === command.y2);
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({ y1: 160, y2: 160 });
  });

  const accidentalGlyphs: Record<AccidentalType, number> = {
    sharp: 0xe262,
    flat: 0xe260,
    natural: 0xe261,
    "double-sharp": 0xe263,
    "double-flat": 0xe264,
    "triple-sharp": 0xe265,
    "triple-flat": 0xe266,
  };

  it.each(Object.keys(accidentalGlyphs) as AccidentalType[])(
    "accepts the TypeScript %s accidental and engraves its shared SMuFL glyph",
    (accidental) => {
      const notes = glyphs(preview({ accidental }));
      expect(notes.map((glyph) => glyph.codepoint)).toEqual([0xe0a4, accidentalGlyphs[accidental]]);
      expect(notes[1]).toMatchObject({ font: "Bravura", y: input.y });
      expect(notes[1]!.x).toBeLessThan(input.x);
      expect(notes[1]!.size).toBeGreaterThan(0);
    },
  );

  it.each([
    { duration: "whole", codepoint: 0xe4e3 },
    { duration: "half", codepoint: 0xe4e4 },
    { duration: "quarter", codepoint: 0xe4e5 },
    { duration: "eighth", codepoint: 0xe4e6 },
    { duration: "16th", codepoint: 0xe4e7 },
    // Shared rendering falls back to the existing 1024th rest.
    { duration: "2048th", codepoint: 0xe4ed },
    { duration: "4096th", codepoint: 0xe4ed },
  ] as const)("engraves a dotted $duration rest without note stems", ({ duration, codepoint }) => {
    const commands = preview({ duration, isRest: true, dots: 2 });
    expect(glyphs(commands).map((glyph) => glyph.codepoint)).toEqual([codepoint, 0xe1e7, 0xe1e7]);
    expect(commands.filter((command) => command.type === "DrawLine")).toHaveLength(0);
  });

  it("scales grace notes and distinguishes slashed grace from appoggiatura", () => {
    const normal = glyphs(preview({ duration: "eighth" }))[0]!;
    const appoggiatura = preview({ duration: "eighth", isGrace: true });
    const slashed = preview({ duration: "eighth", isGrace: true, slash: true });
    expect(glyphs(appoggiatura)[0]!.size).toBeLessThan(normal.size);
    expect(glyphs(slashed)[0]!.size).toBe(glyphs(appoggiatura)[0]!.size);
    const diagonalLines = (commands: RenderCommand[]) =>
      commands.filter(
        (command) => command.type === "DrawLine" && command.x1 !== command.x2 && command.y1 !== command.y2,
      );
    expect(diagonalLines(appoggiatura)).toHaveLength(0);
    expect(diagonalLines(slashed)).toHaveLength(1);
  });

  describe.each([
    { position: "above", y: input.staffY + input.spatium },
    { position: "below", y: input.staffY + 3 * input.spatium },
  ])("grace notes $position the middle line", ({ y }) => {
    it.each([
      { direction: "default", stemDirection: undefined, up: true },
      { direction: "explicit up", stemDirection: "up", up: true },
      { direction: "explicit down", stemDirection: "down", up: false },
    ] as const)("preserves $direction stem direction", ({ stemDirection, up }) => {
      const commands = preview({ duration: "eighth", isGrace: true, y, stemDirection });
      expect(glyphs(commands).map((glyph) => glyph.codepoint)).toEqual([0xe0a4, up ? 0xe240 : 0xe241]);
      const stems = commands.filter((command) => command.type === "DrawLine");
      expect(stems).toHaveLength(1);
      const stem = stems[0]!;
      expect(stem.x1).toBeCloseTo(stem.x2);
      expect(stem.width).toBeGreaterThan(0);
      if (up) {
        expect(Math.min(stem.y1, stem.y2)).toBeLessThan(y - input.spatium);
        expect(stem.x1).toBeGreaterThan(input.x);
      } else {
        expect(Math.max(stem.y1, stem.y2)).toBeGreaterThan(y + input.spatium);
      }
    });
  });

  it("preserves percussion noteheads and explicit stem direction", () => {
    const commands = preview({ duration: "eighth", notehead: "x", stemDirection: "down" });
    expect(glyphs(commands).map((glyph) => glyph.codepoint)).toEqual([0xe0a9, 0xe241]);
  });

  it("paints the Rust commands unchanged in geometry with ghost tint and opacity", () => {
    const compute = vi.spyOn(wasm, "computeNotePreview").mockImplementation((options) => preview(options));
    const fillText = vi.fn();
    const moveTo = vi.fn();
    const lineTo = vi.fn();
    const context = {
      globalAlpha: 1,
      save: vi.fn(),
      restore: vi.fn(),
      fillText,
      moveTo,
      lineTo,
      beginPath: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const options = { x: input.x, y: input.y, staff, duration: "16th" as const, dots: 2, stemDirection: "up" as const };
    paintGhostNote(context, options);
    expect(compute).toHaveBeenCalledWith({ ...input, dots: 2, duration: "16th", stemDirection: "up" });
    const commands = preview({ duration: "16th", dots: 2, stemDirection: "up" });
    expect(context.rotate).not.toHaveBeenCalled();
    expect(fillText.mock.calls).toEqual(
      glyphs(commands).map((glyph) => [String.fromCodePoint(glyph.codepoint), glyph.x, glyph.y]),
    );
    for (const line of commands.filter((command) => command.type === "DrawLine")) {
      expect(moveTo).toHaveBeenCalledWith(line.x1, line.y1);
      expect(lineTo).toHaveBeenCalledWith(line.x2, line.y2);
    }
    expect(context.globalAlpha).toBe(0.35);
    expect(context.fillStyle).toBe("rgb(33, 150, 243)");
    expect(context.strokeStyle).toBe("rgb(33, 150, 243)");
    expect(context.save).toHaveBeenCalledOnce();
    expect(context.restore).toHaveBeenCalledOnce();
  });
});

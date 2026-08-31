/**
 * Source-level guards for ScoreCanvas's `printPreview` prop.
 *
 * Full DOM/WASM rendering of ScoreCanvas isn't viable in the unit-test
 * environment, so instead of a render-and-assert test we pin the source
 * shape: the prop must be declared and must gate the four side-effects we
 * care about (margin guides, selection overlay, InputCursor mount, pointer
 * handlers). If any of these are removed or renamed, this test fires —
 * forcing the author to revisit print-preview behavior intentionally.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCORE_CANVAS_DIR = resolve(__dirname, "..", "components", "ScoreCanvas");
// Concatenate every source file in the ScoreCanvas folder so this guard
// survives further internal splits (props in types.ts, handlers in
// canvasHandlers.ts, etc.) without losing its purpose.
const SOURCE = readdirSync(SCORE_CANVAS_DIR)
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .map((f) => readFileSync(resolve(SCORE_CANVAS_DIR, f), "utf8"))
  .join("\n");

describe("ScoreCanvas printPreview", () => {
  it("declares the printPreview prop", () => {
    expect(SOURCE).toMatch(/printPreview\?:\s*boolean/);
  });

  it("destructures printPreview with a false default", () => {
    expect(SOURCE).toMatch(/printPreview\s*=\s*false/);
  });

  it("suppresses margin guides when printPreview is set", () => {
    // The guard in the overlay block must include `!printPreview`.
    expect(SOURCE).toMatch(/!printPreview\s*&&\s*\(viewMode\s*===\s*"page"/);
  });

  it("suppresses selection overlay when printPreview is set", () => {
    expect(SOURCE).toMatch(/!printPreview\s*&&\s*spatialIndex(Ref\.current)?\s*&&\s*selectedIds/);
  });

  it("conditionally renders InputCursor only when not printPreview", () => {
    expect(SOURCE).toMatch(/\{!printPreview\s*&&\s*\(\s*<InputCursor/);
  });

  it("disables pointer events on the canvas when printPreview is set", () => {
    expect(SOURCE).toMatch(/pointerEvents:\s*printPreview\s*\?\s*"none"/);
  });

  it("strips canvas pointer handlers when printPreview is set", () => {
    expect(SOURCE).toMatch(/onClick=\{printPreview\s*\?\s*undefined/);
    expect(SOURCE).toMatch(/onMouseDown=\{printPreview\s*\?\s*undefined/);
    expect(SOURCE).toMatch(/onMouseUp=\{printPreview\s*\?\s*undefined/);
    expect(SOURCE).toMatch(/onDoubleClick=\{printPreview\s*\?\s*undefined/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SOURCE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "ScoreCanvas.tsx"), "utf8");

describe("ScoreCanvas selection wiring", () => {
  it("recomputes selected IDs when score or layout geometry changes", () => {
    expect(SOURCE).toContain("displayListVersion > 0 ? spatialIndexRef.current : null");
    expect(SOURCE).toMatch(/\[\s*selection,\s*displayListVersion,\s*docScore\s*\]/);
    expect(SOURCE).toContain("onDisplayListCommit: handleDisplayListCommit");
  });

  it("uses one click hit-resolution path and pointer events for drags", () => {
    expect(SOURCE).not.toContain("onDoubleClick=");
    expect(SOURCE).toContain("onPointerDown=");
    expect(SOURCE).toContain("onPointerMove=");
    expect(SOURCE).toContain('aria-label="Interactive music score"');
    expect(SOURCE).toContain("aria-describedby={selectionStatusId}");
  });
});

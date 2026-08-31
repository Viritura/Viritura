import { describe, it, expect } from "vitest";
import type { SlurGeometry } from "@viritura/renderer";
import { hitTestSlurCurve } from "../slurCurveHit";

/** A shallow slur arcing upward from (100, 200) to (300, 200). */
function makeSlur(overrides: Partial<SlurGeometry> = {}): SlurGeometry {
  return {
    elementId: "slur/ev1/ev4",
    p0x: 100,
    p0y: 200,
    p1x: 150,
    p1y: 160,
    p2x: 250,
    p2y: 160,
    p3x: 300,
    p3y: 200,
    thickness: 4,
    curveDir: -1,
    sp: 12,
    ...overrides,
  };
}

describe("hitTestSlurCurve", () => {
  it("returns null when there are no slur geometries", () => {
    expect(hitTestSlurCurve(undefined, 200, 180)).toBeNull();
    expect(hitTestSlurCurve([], 200, 180)).toBeNull();
  });

  it("hits a click on the arc apex", () => {
    // Apex of this symmetric cubic sits at y = (200 + 3*160 + 3*160 + 200) / 8 = 170.
    expect(hitTestSlurCurve([makeSlur()], 200, 170)).toBe("slur/ev1/ev4");
  });

  it("hits a click on the endpoints", () => {
    expect(hitTestSlurCurve([makeSlur()], 100, 200)).toBe("slur/ev1/ev4");
    expect(hitTestSlurCurve([makeSlur()], 300, 200)).toBe("slur/ev1/ev4");
  });

  it("misses the hollow interior of the arc", () => {
    // Inside the slur's bounding rectangle but ~30px below the curve — this is
    // exactly the region where the rectangular spatial-index entry produced
    // false positives and stole clicks from the notes underneath.
    expect(hitTestSlurCurve([makeSlur()], 200, 200)).toBeNull();
  });

  it("misses points outside the horizontal span", () => {
    expect(hitTestSlurCurve([makeSlur()], 50, 200)).toBeNull();
    expect(hitTestSlurCurve([makeSlur()], 400, 200)).toBeNull();
  });

  it("picks the nearer slur when arcs overlap", () => {
    const inner = makeSlur({ elementId: "slur/inner", p1y: 180, p2y: 180 });
    const outer = makeSlur({ elementId: "slur/outer", p1y: 120, p2y: 120 });
    // Apex of `outer` is at y = (200 + 3*120 + 3*120 + 200) / 8 = 140.
    expect(hitTestSlurCurve([inner, outer], 200, 140)).toBe("slur/outer");
    // Apex of `inner` is at y = (200 + 3*180 + 3*180 + 200) / 8 = 185.
    expect(hitTestSlurCurve([inner, outer], 200, 185)).toBe("slur/inner");
  });

  it("matches either segment of a slur split across systems", () => {
    const left = makeSlur({ elementId: "slur/ev1/ev4" });
    const right = makeSlur({
      elementId: "slur/ev1/ev4",
      p0x: 600,
      p1x: 650,
      p2x: 750,
      p3x: 800,
    });
    expect(hitTestSlurCurve([left, right], 700, 170)).toBe("slur/ev1/ev4");
  });
});

import { describe, expect, it } from "vitest";
import type { DisplayList as RendererDisplayList, MeasureBounds } from "@viritura/renderer";
import { createEngine } from "../engine";
import { unwrapDisplayList, wrapDisplayList } from "../displayListHandle";
import { withInk } from "../paint";
import { PACKAGE_VERSION } from "../buildInfo";
import pkg from "../../package.json" with { type: "json" };
import type { DisplayList } from "../types";

function bounds(overrides: Partial<MeasureBounds>): MeasureBounds {
  return {
    index: 0,
    partIndex: 0,
    partId: "violin",
    staffIndex: 0,
    systemIndex: 0,
    x: 0,
    width: 100,
    y: 50,
    height: 28,
    prefixWidth: 20,
    totalBeats: 4,
    beatAnchors: [],
    ...overrides,
  };
}

/** Two pages, one system each; a violin part and a two-staff piano part. */
function pagedList(): RendererDisplayList {
  return {
    commands: [],
    width: 400,
    height: 1000,
    pages: [
      { pageNumber: 1, systemIndices: [0], yOffset: 0, height: 500 },
      { pageNumber: 2, systemIndices: [1], yOffset: 500, height: 500 },
    ],
    parts: [
      { id: "violin", index: 0, name: "Violin" },
      { id: "#1", index: 1, name: "Piano" },
    ],
    measureBounds: [
      bounds({ index: 0, x: 0, y: 50 }),
      bounds({ index: 0, partIndex: 1, partId: "#1", staffIndex: 1, x: 0, y: 120 }),
      bounds({ index: 0, partIndex: 1, partId: "#1", staffIndex: 2, x: 0, y: 190 }),
      bounds({ index: 1, systemIndex: 1, x: 0, y: 550, totalBeats: 3 }),
      bounds({ index: 1, systemIndex: 1, partIndex: 1, partId: "#1", staffIndex: 1, x: 0, y: 620, totalBeats: 3 }),
      bounds({ index: 1, systemIndex: 1, partIndex: 1, partId: "#1", staffIndex: 2, x: 0, y: 690, totalBeats: 3 }),
    ],
  };
}

describe("display list handle", () => {
  it("exposes only public summary fields", () => {
    const dl = wrapDisplayList(pagedList());
    expect(dl.width).toBe(400);
    expect(dl.pageCount).toBe(2);
    expect(dl.paged).toBe(true);
    expect(unwrapDisplayList(dl).measureBounds).toHaveLength(6);
  });

  it("rejects foreign objects", () => {
    expect(() => unwrapDisplayList({ width: 1 } as unknown as DisplayList)).toThrow(TypeError);
  });
});

describe("geometry", () => {
  const engine = createEngine();
  const dl = wrapDisplayList(pagedList());

  it("measures pages and parts with stable IDs", () => {
    const m = engine.measure(dl);
    expect(m.pages.map((p) => [p.height, p.offsetY])).toEqual([
      [500, 0],
      [500, 500],
    ]);
    expect(m.parts.map((p) => p.id)).toEqual(["violin", "#1"]);
  });

  it("returns page-local measure and system geometry", () => {
    const measures = engine.measures(dl);
    expect(measures.find((mg) => mg.index === 1 && mg.partId === "violin")).toMatchObject({ page: 1, y: 50 });
    const systems = engine.systems(dl);
    expect(systems).toHaveLength(2);
    expect(systems[1]).toMatchObject({ page: 1, y: 50, height: 190 - 50 + 28 });
  });

  it("maps beats per part, counting grand-staff measures once", () => {
    // Piano beat 5 is beat 1 of measure 1 (4 beats in measure 0).
    const pos = engine.positionToCanvas(dl, { beat: 5, partId: "#1" });
    expect(pos).toMatchObject({ page: 1, y: 120 });
    expect(pos!.x).toBeGreaterThan(20);
    expect(engine.positionToCanvas(dl, { beat: 99 })).toBeNull();
    expect(engine.positionToCanvas(dl, { beat: 0, partId: "nope" })).toBeNull();
  });

  it("spans the whole system with the playhead", () => {
    const head = engine.playhead(dl, { measureIndex: 0, beat: 0 });
    expect(head).toMatchObject({ page: 0, y: 50, height: 190 + 28 - 50, systemIndex: 0 });
  });

  it("round-trips a canvas hit to a beat and part", () => {
    const hit = engine.canvasToBeat(dl, 1, 20, 700 - 500);
    expect(hit).toMatchObject({ measureIndex: 1, partId: "#1", beat: 4 });
    expect(engine.canvasToBeat(dl, 0, 5000, 5000)).toBeNull();
  });
});

describe("ink", () => {
  it("recolours default black ink only, and caches per colour", () => {
    const commands = [
      { type: "DrawLine", x1: 0, y1: 0, x2: 1, y2: 1, width: 1, color: "#000000" },
      { type: "DrawLine", x1: 0, y1: 0, x2: 1, y2: 1, width: 1, color: "#ff0000" },
    ] as unknown as RendererDisplayList["commands"];
    const inked = withInk(commands, "#eeeeee");
    expect(inked.map((c) => ("color" in c ? c.color : null))).toEqual(["#eeeeee", "#ff0000"]);
    expect(withInk(commands, "#eeeeee")).toBe(inked);
    expect(withInk(commands, undefined)).toBe(commands);
  });
});

describe("version", () => {
  it("matches package.json", () => {
    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(createEngine().version.package).toBe(pkg.version);
  });
});

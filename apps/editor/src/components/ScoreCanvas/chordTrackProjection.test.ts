import { describe, expect, it } from "vitest";
import { SpatialIndex, type DisplayList } from "@viritura/renderer";
import { withoutStaffChordHits, withoutStaffChordInk } from "./chordTrackProjection";

const note = { id: "p0/m0/s0/e0", x: 40, y: 100, width: 12, height: 12 };
const chord = { id: "m0/chord0/p0/staff0", x: 40, y: 60, width: 30, height: 20 };
const displayList: DisplayList = {
  width: 400,
  height: 200,
  commands: [
    {
      type: "DrawText",
      x: 40,
      y: 60,
      text: "C",
      font: "serif",
      size: 22,
      color: "#000",
      align: "left",
      baseline: "alphabetic",
    },
    { type: "DrawLine", x1: 40, y1: 100, x2: 50, y2: 100, width: 1, color: "#000" },
  ],
  elementIds: [chord.id, note.id],
  elementBboxes: [
    { elementId: chord.id, bbox: { x: chord.x, y: chord.y, width: chord.width, height: chord.height } },
    { elementId: note.id, bbox: { x: note.x, y: note.y, width: note.width, height: note.height } },
  ],
};

describe("editor-only staff chord suppression", () => {
  it("removes ink and bounds without mutating the export display list", () => {
    const projected = withoutStaffChordInk(displayList);
    expect(projected.commands).toEqual([displayList.commands[1]]);
    expect(projected.elementIds).toEqual([note.id]);
    expect(projected.elementBboxes).toHaveLength(1);
    expect(projected.retainedRenderLayers).toBeUndefined();
    expect(displayList.commands).toHaveLength(2);
    expect(withoutStaffChordInk(displayList)).toBe(projected);
  });

  it("does not leave invisible staff chord hit targets behind", () => {
    const index = new SpatialIndex([note, chord]);
    const projected = withoutStaffChordHits(index)!;
    expect(projected.getBBox(chord.id)).toBeUndefined();
    expect(projected.getBBox(note.id)).toBeTruthy();
    expect(index.getBBox(chord.id)).toBeTruthy();
    expect(withoutStaffChordHits(index)).toBe(projected);
  });
});

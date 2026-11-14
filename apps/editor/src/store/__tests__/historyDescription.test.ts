import { describe, expect, it } from "vitest";
import { describeHistoryChange } from "../historyDescription";
import type { ScorePatch } from "@viritura/core";

const pitchPatch = (measureIndex: number): ScorePatch => ({
  kind: "setNotePitch",
  locator: {
    sequencePath: { partId: "part-1", measureIndex, voice: 0 },
    eventId: "event-1",
  },
  noteId: "note-1",
  pitch: { step: "D", octave: 4 },
});

describe("describeHistoryChange", () => {
  it("labels a single atomic patch with its measure", () => {
    expect(describeHistoryChange([pitchPatch(2)])).toBe("Change pitch · m. 3");
  });

  it("summarizes multiple patches without losing their measure", () => {
    expect(describeHistoryChange([pitchPatch(2), pitchPatch(2)])).toBe("Change pitch · 2 changes · m. 3");
    expect(describeHistoryChange([pitchPatch(2), pitchPatch(3)])).toBe("Change pitch · 2 changes");
  });

  it("uses the cursor location when no patch metadata is available", () => {
    expect(describeHistoryChange([], { measureIndex: 0, beatPosition: 0, partIndex: 0 })).toBe("Edit · m. 1");
    expect(describeHistoryChange([])).toBe("Edit");
  });

  it("uses authored measure numbers, including a pickup", () => {
    const measures = [{ number: 0 }, { number: 12 }, {}];
    expect(describeHistoryChange([pitchPatch(0)], null, null, measures)).toBe("Change pitch · m. 0");
    expect(describeHistoryChange([pitchPatch(1)], null, null, measures)).toBe("Change pitch · m. 12");
    expect(describeHistoryChange([pitchPatch(2)], null, null, measures)).toBe("Change pitch · m. 3");
  });

  it("uses the previous score to label a removed measure", () => {
    const removal: ScorePatch = { kind: "removeMeasures", startIndex: 0, count: 1 };
    expect(describeHistoryChange([removal], null, null, [{ number: 12 }], [{ number: 0 }, { number: 12 }])).toBe(
      "Remove measures · m. 0",
    );
    expect(describeHistoryChange([removal], null, null, [{ number: 12 }])).toBe("Remove measures");
  });
});

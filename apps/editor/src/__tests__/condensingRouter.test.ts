import { describe, it, expect } from "vitest";
import {
  findCondensingStaff,
  getActiveLayoutId,
  resolveEditTargets,
  type CondensingStaffInfo,
} from "../score/condensingRouter";
import type { Score, LayoutDefinition } from "@viritura/core";

function makeScore(opts: { layouts?: LayoutDefinition[]; partIds?: string[]; scoreLayout?: string }): Score {
  const parts = (opts.partIds ?? ["flute1", "flute2"]).map((id) => ({
    id,
    name: id,
    measures: [{ sequences: [{ content: [] }] }],
  }));
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts,
    layouts: opts.layouts,
    scores: opts.scoreLayout ? [{ layout: opts.scoreLayout }] : undefined,
  };
}

const condensedLayout: LayoutDefinition = {
  id: "condensed",
  content: [
    {
      type: "staff",
      sources: [{ part: "flute1" }, { part: "flute2" }],
    },
  ],
};

const nonCondensingLayout: LayoutDefinition = {
  id: "full",
  content: [
    { type: "staff", sources: [{ part: "flute1" }] },
    { type: "staff", sources: [{ part: "flute2" }] },
  ],
};

describe("findCondensingStaff", () => {
  it("returns null for non-condensing staff", () => {
    const score = makeScore({ layouts: [nonCondensingLayout], partIds: ["flute1", "flute2"] });
    expect(findCondensingStaff(score, "full", 0)).toBeNull();
  });

  it("returns staff info for condensing staff (first source)", () => {
    const score = makeScore({ layouts: [condensedLayout], partIds: ["flute1", "flute2"] });
    const result = findCondensingStaff(score, "condensed", 0);
    expect(result).not.toBeNull();
    expect(result!.sourcePartIndices).toEqual([0, 1]);
  });

  it("returns staff info for condensing staff (second source)", () => {
    const score = makeScore({ layouts: [condensedLayout], partIds: ["flute1", "flute2"] });
    const result = findCondensingStaff(score, "condensed", 1);
    expect(result).not.toBeNull();
    expect(result!.sourcePartIndices).toEqual([0, 1]);
  });

  it("returns null if no layout found", () => {
    const score = makeScore({ layouts: [condensedLayout], partIds: ["flute1", "flute2"] });
    expect(findCondensingStaff(score, "nonexistent", 0)).toBeNull();
  });

  it("returns null if no layouts defined", () => {
    const score = makeScore({ partIds: ["flute1"] });
    expect(findCondensingStaff(score, "full", 0)).toBeNull();
  });

  it("finds condensing staff inside groups", () => {
    const nestedLayout: LayoutDefinition = {
      id: "nested",
      content: [
        {
          type: "group",
          content: [
            {
              type: "staff",
              sources: [{ part: "flute1" }, { part: "flute2" }],
            },
          ],
        },
      ],
    };
    const score = makeScore({ layouts: [nestedLayout], partIds: ["flute1", "flute2"] });
    const result = findCondensingStaff(score, "nested", 0);
    expect(result).not.toBeNull();
    expect(result!.sourcePartIndices).toEqual([0, 1]);
  });

  it("ignores single-source staves", () => {
    const singleSourceLayout: LayoutDefinition = {
      id: "single",
      content: [
        {
          type: "staff",
          sources: [{ part: "flute1" }],
        },
      ],
    };
    const score = makeScore({ layouts: [singleSourceLayout], partIds: ["flute1", "flute2"] });
    expect(findCondensingStaff(score, "single", 0)).toBeNull();
  });
});

describe("getActiveLayoutId", () => {
  it("returns layout from score definition", () => {
    const score = makeScore({ scoreLayout: "condensed" });
    expect(getActiveLayoutId(score, 0)).toBe("condensed");
  });

  it("returns undefined for missing score index", () => {
    const score = makeScore({});
    expect(getActiveLayoutId(score, 5)).toBeUndefined();
  });

  it("returns layout from page/system definitions", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [],
      scores: [
        {
          pages: [{ systems: [{ measure: "1", layout: "page-layout" }] }],
        },
      ],
    };
    expect(getActiveLayoutId(score, 0)).toBe("page-layout");
  });
});

describe("resolveEditTargets", () => {
  const staffInfo: CondensingStaffInfo = {
    staff: {
      type: "staff",
      sources: [{ part: "flute1" }, { part: "flute2" }],
    },
    sourcePartIndices: [0, 1],
  };

  it("unison mode broadcasts to all sources", () => {
    const targets = resolveEditTargets("unison", staffInfo, 0);
    expect(targets).toEqual([
      { partIndex: 0, voice: 0 },
      { partIndex: 1, voice: 0 },
    ]);
  });

  it("amalgamate mode broadcasts to all sources", () => {
    const targets = resolveEditTargets("amalgamate", staffInfo, 0);
    expect(targets).toEqual([
      { partIndex: 0, voice: 0 },
      { partIndex: 1, voice: 0 },
    ]);
  });

  it("solo1 targets only first source", () => {
    const targets = resolveEditTargets("solo1", staffInfo, 0);
    expect(targets).toEqual([{ partIndex: 0, voice: 0 }]);
  });

  it("solo2 targets only second source", () => {
    const targets = resolveEditTargets("solo2", staffInfo, 0);
    expect(targets).toEqual([{ partIndex: 1, voice: 0 }]);
  });

  it("divisi maps voice to source", () => {
    expect(resolveEditTargets("divisi", staffInfo, 0)).toEqual([{ partIndex: 0, voice: 0 }]);
    expect(resolveEditTargets("divisi", staffInfo, 1)).toEqual([{ partIndex: 1, voice: 0 }]);
  });

  it("divisi falls back to first source for out-of-range voice", () => {
    const targets = resolveEditTargets("divisi", staffInfo, 5);
    expect(targets).toEqual([{ partIndex: 0, voice: 0 }]);
  });

  it("smart default: voice 0 without mode broadcasts (unison)", () => {
    const targets = resolveEditTargets(undefined, staffInfo, 0);
    expect(targets).toEqual([
      { partIndex: 0, voice: 0 },
      { partIndex: 1, voice: 0 },
    ]);
  });

  it("smart default: voice 1 without mode routes to source 1 (divisi)", () => {
    const targets = resolveEditTargets(undefined, staffInfo, 1);
    expect(targets).toEqual([{ partIndex: 1, voice: 0 }]);
  });

  it("handles three sources", () => {
    const threeSourceInfo: CondensingStaffInfo = {
      staff: {
        type: "staff",
        sources: [{ part: "fl1" }, { part: "fl2" }, { part: "fl3" }],
      },
      sourcePartIndices: [0, 1, 2],
    };
    // unison broadcasts to all three
    expect(resolveEditTargets("unison", threeSourceInfo, 0)).toHaveLength(3);
    // divisi voice 2 → source 2
    expect(resolveEditTargets("divisi", threeSourceInfo, 2)).toEqual([{ partIndex: 2, voice: 0 }]);
  });
});

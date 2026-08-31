import { describe, it, expect } from "vitest";
import { deriveHiddenLayout, ensureDerivedLayout, pruneUnusedDerivedLayouts } from "../model/derivedLayouts";
import type { LayoutDefinition } from "../model/layout";

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const baseLayout: LayoutDefinition = {
  id: "L1",
  content: [
    {
      type: "group",
      symbol: "bracket",
      content: [
        { type: "staff", sources: [{ part: "P1" }] },
        { type: "staff", sources: [{ part: "P2" }] },
      ],
    },
    { type: "staff", sources: [{ part: "P3" }] },
  ],
};

describe("deriveHiddenLayout", () => {
  it("returns the base content when nothing matches", () => {
    expect(deriveHiddenLayout(baseLayout, new Set()).effective.size).toBe(0);
    expect(deriveHiddenLayout(baseLayout, new Set(["P99"])).effective.size).toBe(0);
  });

  it("prunes hidden parts and collapses empty groups", () => {
    const { content, effective } = deriveHiddenLayout(baseLayout, new Set(["P1", "P2"]));
    expect(effective).toEqual(new Set(["P1", "P2"]));
    // Group containing only P1+P2 should collapse, leaving only P3 staff
    expect(content).toEqual([{ type: "staff", sources: [{ part: "P3" }] }]);
  });

  it("preserves a group when at least one staff remains", () => {
    const { content } = deriveHiddenLayout(baseLayout, new Set(["P2"]));
    expect(content).toEqual([
      {
        type: "group",
        symbol: "bracket",
        content: [{ type: "staff", sources: [{ part: "P1" }] }],
      },
      { type: "staff", sources: [{ part: "P3" }] },
    ]);
  });

  it("ignores hidden ids that don't exist in the layout", () => {
    const { effective } = deriveHiddenLayout(baseLayout, new Set(["P3", "Pmissing"]));
    expect(effective).toEqual(new Set(["P3"]));
  });
});

describe("ensureDerivedLayout", () => {
  it("appends a derived layout once and dedupes on second call", () => {
    const r1 = ensureDerivedLayout([baseLayout], "L1", new Set(["P3"]));
    expect(r1.layoutId).not.toBe("L1");
    expect(r1.layoutId).toMatch(UUID_V7_RE);
    expect(r1.layouts).toHaveLength(2);

    const r2 = ensureDerivedLayout(r1.layouts, "L1", new Set(["P3"]));
    expect(r2.layoutId).toBe(r1.layoutId);
    expect(r2.layouts).toBe(r1.layouts);
  });

  it("flags derived layouts with _x.viritura.derived", () => {
    const r = ensureDerivedLayout([baseLayout], "L1", new Set(["P3"]));
    const derived = r.layouts.find((l) => l.id === r.layoutId);
    expect(derived?._x?.viritura?.derived).toBe(true);
  });

  it("returns base id when no parts are actually hidden", () => {
    const r = ensureDerivedLayout([baseLayout], "L1", new Set());
    expect(r.layoutId).toBe("L1");
    expect(r.layouts).toHaveLength(1);
  });

  it("returns base id when the base layout doesn't exist", () => {
    const r = ensureDerivedLayout([baseLayout], "missing", new Set(["P1"]));
    expect(r.layoutId).toBe("missing");
  });

  it("dedupes structurally against an existing user-authored layout", () => {
    // A user-authored layout that happens to match what we'd derive by
    // hiding P1+P2 from baseLayout. Must reuse its id, not mint a new one.
    const userAuthored: LayoutDefinition = {
      id: "L-cello-only",
      content: [{ type: "staff", sources: [{ part: "P3" }] }],
    };
    const r = ensureDerivedLayout([baseLayout, userAuthored], "L1", new Set(["P1", "P2"]));
    expect(r.layoutId).toBe("L-cello-only");
    expect(r.layouts).toHaveLength(2);
  });

  it("dedupes structurally across different base layouts that prune to the same shape", () => {
    const baseA: LayoutDefinition = {
      id: "A",
      content: [
        { type: "staff", sources: [{ part: "P1" }] },
        { type: "staff", sources: [{ part: "X" }] },
      ],
    };
    const baseB: LayoutDefinition = {
      id: "B",
      content: [
        { type: "staff", sources: [{ part: "P1" }] },
        { type: "staff", sources: [{ part: "Y" }] },
      ],
    };
    let layouts: LayoutDefinition[] = [baseA, baseB];
    const r1 = ensureDerivedLayout(layouts, "A", new Set(["X"]));
    layouts = r1.layouts;
    const r2 = ensureDerivedLayout(layouts, "B", new Set(["Y"]));
    expect(r2.layoutId).toBe(r1.layoutId);
    expect(r2.layouts).toBe(layouts);
  });
});

describe("pruneUnusedDerivedLayouts", () => {
  it("drops derived layouts not referenced anywhere", () => {
    const derived: LayoutDefinition = {
      id: "derived-uuid",
      content: [{ type: "staff", sources: [{ part: "P1" }] }],
      _x: { viritura: { derived: true } },
    };
    const result = pruneUnusedDerivedLayouts([baseLayout, derived], new Set(["L1"]));
    expect(result).toEqual([baseLayout]);
  });

  it("keeps derived layouts that are still referenced", () => {
    const derived: LayoutDefinition = {
      id: "derived-uuid",
      content: [{ type: "staff", sources: [{ part: "P1" }] }],
      _x: { viritura: { derived: true } },
    };
    const result = pruneUnusedDerivedLayouts([baseLayout, derived], new Set(["L1", "derived-uuid"]));
    expect(result).toEqual([baseLayout, derived]);
  });

  it("keeps user-authored layouts even if unreferenced", () => {
    const user: LayoutDefinition = {
      id: "L-custom",
      content: [{ type: "staff", sources: [{ part: "P1" }] }],
    };
    const result = pruneUnusedDerivedLayouts([baseLayout, user], new Set(["L1"]));
    expect(result).toContain(user);
  });
});

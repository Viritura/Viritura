/**
 * Condensed-staff row derivation — the geometry contract behind the in-canvas
 * expand/collapse handles.
 *
 * The walk here must stay in lockstep with `injectExpandedStaves`, because the
 * engine numbers `MeasureBounds.staffIndex` by that same flattened order. If
 * the two ever drift, handles silently attach to the wrong staff — so the
 * index arithmetic (especially "an expansion consumes N further indices") is
 * pinned here rather than left to inspection.
 */
import { describe, expect, it } from "vitest";
import type { LayoutContent, Score } from "@viritura/core";
import { collectCondensedStaffRows } from "../condensedStaves/condensedStaffRows";

function staff(...parts: string[]): LayoutContent {
  return { type: "staff", sources: parts.map((part) => ({ part })) };
}

function group(label: string, content: LayoutContent[]): LayoutContent {
  return { type: "group", label, symbol: "bracket", content } as LayoutContent;
}

function makeScore(content: LayoutContent[]): Score {
  return {
    global: { measures: [{}] },
    parts: [
      { id: "FL", name: "Flute" },
      { id: "HN1", name: "Horn 1" },
      { id: "HN2", name: "Horn 2" },
      { id: "TPT1", name: "Trumpet 1" },
      { id: "TPT2", name: "Trumpet 2" },
      { id: "VC", name: "Cello" },
    ],
    layouts: [{ id: "L1", content }],
    scores: [{ name: "Full Score", layout: "L1" }],
  } as unknown as Score;
}

const NONE: ReadonlySet<string> = new Set();

describe("collectCondensedStaffRows", () => {
  it("returns nothing when no staff carries more than one part", () => {
    expect(collectCondensedStaffRows(makeScore([staff("FL"), staff("VC")]), 0, NONE)).toEqual([]);
  });

  it("labels a condensed staff with both part names", () => {
    const rows = collectCondensedStaffRows(makeScore([staff("FL"), staff("HN1", "HN2")]), 0, NONE);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("Horn 1 / Horn 2");
    expect(rows[0]!.partLabels).toEqual(["Horn 1", "Horn 2"]);
  });

  it("reports the visual staff index the condensed staff occupies", () => {
    const rows = collectCondensedStaffRows(makeScore([staff("FL"), staff("VC"), staff("HN1", "HN2")]), 0, NONE);

    expect(rows[0]!.staffIndex).toBe(2);
  });

  it("counts staves across groups, since groups don't render a staff of their own", () => {
    const score = makeScore([staff("FL"), group("Brass", [staff("TPT1"), staff("HN1", "HN2")]), staff("VC")]);
    const rows = collectCondensedStaffRows(score, 0, NONE);

    // FL=0, TPT1=1, condensed=2 — the group itself consumes no index.
    expect(rows[0]!.staffIndex).toBe(2);
    expect(rows[0]!.pathKey).toBe("1-1");
  });

  it("shifts later staves down by the expansion size when one is expanded", () => {
    const score = makeScore([staff("HN1", "HN2"), staff("TPT1", "TPT2")]);

    const collapsed = collectCondensedStaffRows(score, 0, NONE);
    expect(collapsed.map((r) => r.staffIndex)).toEqual([0, 1]);

    // Expanding the horns injects two staves below them, so the trumpets
    // move from visual index 1 to 3.
    const expanded = collectCondensedStaffRows(score, 0, new Set(["0"]));
    expect(expanded.map((r) => r.staffIndex)).toEqual([0, 3]);
    expect(expanded[0]!.expanded).toBe(true);
    expect(expanded[1]!.expanded).toBe(false);
  });

  it("accumulates shifts across multiple expansions", () => {
    const score = makeScore([staff("HN1", "HN2"), staff("TPT1", "TPT2"), staff("VC")]);
    const rows = collectCondensedStaffRows(score, 0, new Set(["0", "1"]));

    // horns=0 (+2 injected) → trumpets=3 (+2 injected) → cello would be 6.
    expect(rows.map((r) => r.staffIndex)).toEqual([0, 3]);
  });

  it("ignores expansion keys that don't match a condensed staff", () => {
    const score = makeScore([staff("FL"), staff("HN1", "HN2")]);
    const rows = collectCondensedStaffRows(score, 0, new Set(["0", "9-9"]));

    // "0" is the flute — a single-source staff that cannot expand.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.staffIndex).toBe(1);
    expect(rows[0]!.expanded).toBe(false);
  });

  it("returns nothing without a resolvable layout", () => {
    const score = { ...makeScore([staff("FL")]), scores: [{ name: "Broken" }] } as unknown as Score;
    expect(collectCondensedStaffRows(score, 0, NONE)).toEqual([]);
    expect(collectCondensedStaffRows(null, 0, NONE)).toEqual([]);
  });

  it("scopes discovery to the requested score", () => {
    const score = {
      ...makeScore([staff("FL")]),
      layouts: [
        { id: "L1", content: [staff("FL")] },
        { id: "L2", content: [staff("HN1", "HN2")] },
      ],
      scores: [
        { name: "Flute", layout: "L1" },
        { name: "Condensed", layout: "L2" },
      ],
    } as unknown as Score;

    expect(collectCondensedStaffRows(score, 0, NONE)).toEqual([]);
    expect(collectCondensedStaffRows(score, 1, NONE)).toHaveLength(1);
  });
});

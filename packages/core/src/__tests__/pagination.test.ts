import { describe, it, expect } from "vitest";
import {
  applySnapshot,
  clearBreak,
  emptySnapshot,
  extractSnapshot,
  insertBreak,
  snapshotToPages,
  sortSnapshot,
} from "../model/pagination";
import type { ScoreDefinition } from "../model/layout";

describe("pagination snapshot", () => {
  it("extracts an empty snapshot when no pages are authored", () => {
    const score: ScoreDefinition = { name: "Full" };
    expect(extractSnapshot(score)).toEqual(emptySnapshot());
  });

  it("flattens pages[].systems[] into ordered entries with pageBreak flags", () => {
    const score: ScoreDefinition = {
      pages: [{ systems: [{ measure: "m1" }, { measure: "m5", layout: "L-alt" }] }, { systems: [{ measure: "m9" }] }],
    };
    const snap = extractSnapshot(score);
    expect(snap.entries).toEqual([
      { measure: "m1", pageBreak: false },
      { measure: "m5", layout: "L-alt", pageBreak: false },
      { measure: "m9", pageBreak: true },
    ]);
  });

  it("rebuilds pages[] from a snapshot, treating the first entry as page 0", () => {
    const snap = {
      entries: [
        { measure: "m1", pageBreak: false },
        { measure: "m5", pageBreak: false },
        { measure: "m9", pageBreak: true },
        { measure: "m13", pageBreak: false },
      ],
    };
    const pages = snapshotToPages(snap);
    expect(pages).toEqual([
      { systems: [{ measure: "m1" }, { measure: "m5" }] },
      { systems: [{ measure: "m9" }, { measure: "m13" }] },
    ]);
  });

  it("returns undefined for an empty snapshot to clear pages[]", () => {
    expect(snapshotToPages(emptySnapshot())).toBeUndefined();
  });

  it("round-trips extract → snapshotToPages", () => {
    const score: ScoreDefinition = {
      pages: [{ systems: [{ measure: "m1" }] }, { systems: [{ measure: "m4", layout: "L-2" }, { measure: "m7" }] }],
    };
    const snap = extractSnapshot(score);
    expect(snapshotToPages(snap)).toEqual(score.pages);
  });

  it("inserts a new break and updates an existing one", () => {
    let snap = emptySnapshot();
    snap = insertBreak(snap, "m4", "system");
    snap = insertBreak(snap, "m9", "page");
    expect(snap.entries).toHaveLength(2);

    snap = insertBreak(snap, "m4", "page", "L-alt");
    expect(snap.entries.find((e) => e.measure === "m4")).toEqual({
      measure: "m4",
      pageBreak: true,
      layout: "L-alt",
    });
  });

  it("clears a break by measure id", () => {
    const snap = insertBreak(insertBreak(emptySnapshot(), "m4", "system"), "m9", "page");
    const cleared = clearBreak(snap, "m4");
    expect(cleared.entries).toHaveLength(1);
    expect(cleared.entries[0]!.measure).toBe("m9");
  });

  it("sortSnapshot drops measures not in the document and sorts by measure order", () => {
    const snap = {
      entries: [
        { measure: "m9", pageBreak: false },
        { measure: "m-stale", pageBreak: false },
        { measure: "m1", pageBreak: false },
      ],
    };
    const sorted = sortSnapshot(snap, ["m1", "m5", "m9", "m13"]);
    expect(sorted.entries.map((e) => e.measure)).toEqual(["m1", "m9"]);
  });

  it("applySnapshot writes pages back and clears them when empty", () => {
    const base: ScoreDefinition = { name: "Full", layout: "L1" };
    const withBreaks = applySnapshot(base, insertBreak(emptySnapshot(), "m1", "system"));
    expect(withBreaks.pages).toBeDefined();
    expect(withBreaks.layout).toBe("L1");

    const cleared = applySnapshot(withBreaks, emptySnapshot());
    expect(cleared.pages).toBeUndefined();
  });
});

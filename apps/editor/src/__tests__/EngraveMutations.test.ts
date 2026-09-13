import { describe, it, expect } from "vitest";
import {
  insertBreakInScore,
  clearBreakInScore,
  clearAllBreaksInScore,
  setStaffVisibilityInScore,
  applyStaffVisibilityFromSystem,
  ghostRailGroupsOnSystem,
  hiddenRangeHasMusic,
  hiddenPartsOnSystem,
} from "../score/ScoreMutations";
import { buildBlankScore, type NewScoreSettings } from "../score/ScoreBuilder";
import { createPlayer, renumberPlayers } from "../score/InstrumentCatalog";
import { parseMnx } from "@viritura/format";
import type { Score } from "@viritura/core";

function makeScore(...ids: string[]): Score {
  const players = renumberPlayers(ids.map((id) => createPlayer(id)));
  const settings: NewScoreSettings = {
    title: "Test",
    players,
    time: { count: 4, unit: 4 },
    keyFifths: 0,
    measureCount: 8,
    tempoBpm: 120,
  };
  return parseMnx(JSON.parse(buildBlankScore(settings)));
}

function measureIds(score: Score): string[] {
  return score.global.measures.map((m, i) => m.id ?? `m${i + 1}`);
}

function asStarts(measureIds: string[]): { measure: string; pageBreak: boolean }[] {
  return measureIds.map((m) => ({ measure: m, pageBreak: false }));
}

describe("insertBreakInScore", () => {
  it("stores only the authored system lock", () => {
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    const next = insertBreakInScore(score, 0, ids[3]!, "system");
    const sd = next.scores![0]!;
    expect(sd.pages).toBeUndefined();
    expect(sd.layoutBreaks).toEqual([{ measure: ids[3], kind: "system" }]);
  });

  it("converts a system break to a page break (idempotent insert)", () => {
    const score = makeScore("flute");
    const ids = measureIds(score);
    let next = insertBreakInScore(score, 0, ids[4]!, "system");
    next = insertBreakInScore(next, 0, ids[4]!, "page");
    const sd = next.scores![0]!;
    expect(sd.pages).toBeUndefined();
    expect(sd.layoutBreaks).toEqual([{ measure: ids[4], kind: "page" }]);
  });

  it("migrates break-only pages from the previous control model", () => {
    const score = makeScore("flute");
    const ids = measureIds(score);
    const legacy: Score = {
      ...score,
      scores: score.scores!.map((definition, index) =>
        index === 0
          ? {
              ...definition,
              pages: [{ systems: [{ measure: ids[0]! }, { measure: ids[2]! }] }, { systems: [{ measure: ids[5]! }] }],
            }
          : definition,
      ),
    };

    const next = insertBreakInScore(legacy, 0, ids[4]!, "system");
    expect(next.scores![0]!.pages).toBeUndefined();
    expect(next.scores![0]!.layoutBreaks).toEqual([
      { measure: ids[2], kind: "system" },
      { measure: ids[4], kind: "system" },
      { measure: ids[5], kind: "page" },
    ]);
  });
});

describe("clearBreakInScore / clearAllBreaksInScore", () => {
  it("removes the final break and restores automatic pagination", () => {
    const score = makeScore("flute");
    const ids = measureIds(score);
    let next = insertBreakInScore(score, 0, ids[3]!, "system");
    next = clearBreakInScore(next, 0, ids[3]!);
    expect(next.scores![0]!.pages).toBeUndefined();
    expect(next.scores![0]!.layoutBreaks).toBeUndefined();
  });

  it("removes one break without resetting other authored breaks", () => {
    const score = makeScore("flute");
    const ids = measureIds(score);
    let next = insertBreakInScore(score, 0, ids[2]!, "system");
    next = insertBreakInScore(next, 0, ids[5]!, "page");
    next = clearBreakInScore(next, 0, ids[2]!);

    expect(next.scores![0]!.layoutBreaks).toEqual([{ measure: ids[5], kind: "page" }]);
  });

  it("wipeAll reverts to automatic pagination", () => {
    const score = makeScore("flute");
    const ids = measureIds(score);
    let next = insertBreakInScore(score, 0, ids[3]!, "system");
    next = clearAllBreaksInScore(next, 0);
    expect(next.scores![0]!.pages).toBeUndefined();
    expect(next.scores![0]!.layoutBreaks).toBeUndefined();
  });
});

describe("setStaffVisibilityInScore", () => {
  it("hides a part on a specific system via derived layout", () => {
    const score = makeScore("flute", "violin", "cello");
    const ids = measureIds(score);
    const partIdToHide = score.parts[1]!.id;
    const next = applyStaffVisibilityFromSystem(score, 0, ids[4]!, partIdToHide, false, []);

    const hidden = hiddenPartsOnSystem(next, 0, ids[4]!);
    expect(hidden.has(partIdToHide)).toBe(true);

    const hiddenAtFirst = hiddenPartsOnSystem(next, 0, ids[0]!);
    expect(hiddenAtFirst.size).toBe(0);

    expect(next.layouts!.some((l) => l._x?.viritura?.derived === true)).toBe(true);
  });

  it("re-showing the staff GCs the derived layout", () => {
    // Use 3 instruments so hiding one part produces a 2-staff prune
    // that doesn't structurally match any pre-existing per-part layout
    // — otherwise dedup reuses an existing user-authored layout and no
    // derived layout is minted in the first place.
    const score = makeScore("flute", "violin", "cello");
    const ids = measureIds(score);
    const partIdToHide = score.parts[1]!.id;

    let next = applyStaffVisibilityFromSystem(score, 0, ids[4]!, partIdToHide, false, []);
    const layoutsWithDerived = next.layouts!.length;
    expect(next.layouts!.some((l) => l._x?.viritura?.derived === true)).toBe(true);

    next = setStaffVisibilityInScore(next, 0, ids[4]!, partIdToHide, true);
    expect(next.layouts!.length).toBeLessThan(layoutsWithDerived);
    expect(hiddenPartsOnSystem(next, 0, ids[4]!).size).toBe(0);
  });

  it("refuses to hide every staff in a system (no-op)", () => {
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    const part1 = score.parts[0]!.id;
    const part2 = score.parts[1]!.id;
    let next = applyStaffVisibilityFromSystem(score, 0, ids[4]!, part1, false, []);
    expect(hiddenPartsOnSystem(next, 0, ids[4]!).has(part1)).toBe(true);

    // Attempting to hide the last visible staff should be a no-op.
    const before = next;
    next = setStaffVisibilityInScore(next, 0, ids[4]!, part2, false);
    expect(next).toBe(before); // referential equality — no change
    expect(hiddenPartsOnSystem(next, 0, ids[4]!).has(part2)).toBe(false);
  });
});

describe("applyStaffVisibilityFromSystem", () => {
  it("materialises the opening and target systems without forced page breaks elsewhere", () => {
    // Regression: prior behaviour seeded the full engine-computed
    // pagination — including pageBreak flags — on the first hide,
    // which locked auto-flow and prevented later reflow.
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    // Pretend the engine laid this out across two pages, with m5
    // starting a new page.
    const computed = [
      { measure: ids[0]!, pageBreak: false },
      { measure: ids[2]!, pageBreak: false },
      { measure: ids[4]!, pageBreak: true },
      { measure: ids[6]!, pageBreak: false },
    ];
    const partIdToHide = score.parts[1]!.id;
    const next = applyStaffVisibilityFromSystem(score, 0, ids[4]!, partIdToHide, false, computed);

    const pages = next.scores![0]!.pages ?? [];
    const allSystems = pages.flatMap((p) => p.systems);
    // Only the opening and target anchors are materialised — intermediate
    // systems remain on auto-flow. (Previously this would have been 4 systems.)
    expect(allSystems.map((system) => system.measure)).toEqual([ids[0], ids[4]]);
    // Critically: the engine-computed page break at m5 must NOT have
    // been promoted to a forced page boundary in pages[]. Since we
    // Both sparse anchors remain on one authored page.
    expect(pages.length).toBe(1);
    // And the hide actually took effect on that system.
    expect(hiddenPartsOnSystem(next, 0, ids[4]!).has(partIdToHide)).toBe(true);
  });

  it("preserves existing user-authored breaks when adding a hide elsewhere", () => {
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    const computed = asStarts([ids[0]!, ids[2]!, ids[4]!, ids[6]!]);
    // User first inserts a page lock at m3.
    const withBreak = insertBreakInScore(score, 0, ids[2]!, "page");
    expect(withBreak.scores![0]!.layoutBreaks).toEqual([{ measure: ids[2], kind: "page" }]);

    // Then hides a part on m5.
    const partIdToHide = withBreak.parts[1]!.id;
    const next = applyStaffVisibilityFromSystem(withBreak, 0, ids[4]!, partIdToHide, false, computed);

    const pagesAfter = next.scores![0]!.pages ?? [];
    expect(next.scores![0]!.layoutBreaks).toEqual([{ measure: ids[2], kind: "page" }]);
    // And the hide target was materialised somewhere in pages[].
    const allSystems = pagesAfter.flatMap((p) => p.systems);
    expect(allSystems.some((s) => s.measure === ids[4])).toBe(true);
  });

  it("preserves a new break when a staff layout override already exists", () => {
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    const hidden = applyStaffVisibilityFromSystem(score, 0, ids[4]!, score.parts[1]!.id, false, []);
    const next = insertBreakInScore(hidden, 0, ids[2]!, "page");

    expect(next.scores![0]!.pages?.flatMap((page) => page.systems).some((system) => system.layout)).toBe(true);
    expect(next.scores![0]!.layoutBreaks).toEqual([{ measure: ids[2], kind: "page" }]);
  });
});

describe("setStaffVisibilityInScore — condensed staves", () => {
  it("hides every source on a condensed staff together", () => {
    // Build a 3-part score, then override the base layout so the first
    // two parts share a single condensed staff. Hiding either part
    // should hide the whole staff group together.
    const score = makeScore("flute", "flute", "violin");
    const ids = measureIds(score);
    const [p1, p2, p3] = score.parts.map((p) => p.id!);

    const baseLayoutId = score.scores![0]!.layout!;
    const condensedScore: Score = {
      ...score,
      layouts: score.layouts!.map((l) =>
        l.id === baseLayoutId
          ? {
              ...l,
              content: [
                { type: "staff", sources: [{ part: p1 }, { part: p2 }] },
                { type: "staff", sources: [{ part: p3 }] },
              ],
            }
          : l,
      ),
    };

    // Hide via p1 — p2 (its condensed staff-mate) must hide too.
    const next = applyStaffVisibilityFromSystem(condensedScore, 0, ids[4]!, p1, false, []);

    const hidden = hiddenPartsOnSystem(next, 0, ids[4]!);
    expect(hidden.has(p1)).toBe(true);
    expect(hidden.has(p2)).toBe(true);
    expect(hidden.has(p3)).toBe(false);
  });

  it("ghostRailGroupsOnSystem collapses a condensed staff into one staffGroup", () => {
    const score = makeScore("flute", "flute", "violin");
    const ids = measureIds(score);
    const [p1, p2, p3] = score.parts.map((p) => p.id!);
    const baseLayoutId = score.scores![0]!.layout!;
    const condensedScore: Score = {
      ...score,
      layouts: score.layouts!.map((l) =>
        l.id === baseLayoutId
          ? {
              ...l,
              content: [
                { type: "staff", sources: [{ part: p1 }, { part: p2 }] },
                { type: "staff", sources: [{ part: p3 }] },
              ],
            }
          : l,
      ),
    };

    const next = applyStaffVisibilityFromSystem(condensedScore, 0, ids[4]!, p1, false, []);

    const groups = ghostRailGroupsOnSystem(next, 0, ids[4]!);
    expect(groups.length).toBe(1);
    const g = groups[0]!;
    // Both hidden parts in partIds, but only ONE staffGroup (the condensed staff).
    expect(g.partIds.sort()).toEqual([p1, p2].sort());
    expect(g.staffGroups.length).toBe(1);
    expect(g.staffGroups[0]!.sort()).toEqual([p1, p2].sort());
  });
});

describe("hiddenRangeHasMusic / ghost-rail music detection", () => {
  it("returns false when all hidden measures contain only full-measure rests", () => {
    // Blank scores from buildBlankScore are full-measure rests on every part.
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    const partId = score.parts[1]!.id!;
    expect(hiddenRangeHasMusic(score, 0, ids[0]!, partId)).toBe(false);
  });

  it("returns true when the inheritance range contains a real note", () => {
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    const partId = score.parts[1]!.id!;
    // Inject a note into the violin's first measure (replaces the
    // fullMeasure rest with an explicit event).
    const withNote: Score = {
      ...score,
      parts: score.parts.map((p) =>
        p.id === partId
          ? {
              ...p,
              measures: p.measures.map((m, i) =>
                i === 0
                  ? {
                      ...m,
                      sequences: [
                        {
                          content: [
                            {
                              type: "event",
                              duration: { base: "whole" },
                              notes: [{ pitch: { step: "C", octave: 4 } }],
                            },
                          ],
                        } as never,
                      ],
                    }
                  : m,
              ),
            }
          : p,
      ),
    };
    expect(hiddenRangeHasMusic(withNote, 0, ids[0]!, partId)).toBe(true);
  });

  it("ghostRailGroupsOnSystem reports per-staff music flags", () => {
    // Two parts, both hidden. Inject a note into the second part only.
    // Expect staffGroupHasMusic = [false, true] in base-layout order.
    const score = makeScore("flute", "violin");
    const _ids = measureIds(score);
    const [p1, p2] = score.parts.map((p) => p.id!);

    let withNote: Score = {
      ...score,
      parts: score.parts.map((p) =>
        p.id === p2
          ? {
              ...p,
              measures: p.measures.map((m, i) =>
                i === 0
                  ? {
                      ...m,
                      sequences: [
                        {
                          content: [
                            {
                              type: "event",
                              duration: { base: "whole" },
                              notes: [{ pitch: { step: "G", octave: 4 } }],
                            },
                          ],
                        } as never,
                      ],
                    }
                  : m,
              ),
            }
          : p,
      ),
    };

    // Add a third part so we can hide two of them and still have a visible
    // staff (the "refuses to hide all staves" guard would otherwise block).
    withNote = makeScore("flute", "violin", "cello");
    const idsB = measureIds(withNote);
    const [a1, a2] = withNote.parts.map((p) => p.id!);
    withNote = {
      ...withNote,
      parts: withNote.parts.map((p) =>
        p.id === a2
          ? {
              ...p,
              measures: p.measures.map((m, i) =>
                i === 0
                  ? {
                      ...m,
                      sequences: [
                        {
                          content: [
                            {
                              type: "event",
                              duration: { base: "whole" },
                              notes: [{ pitch: { step: "G", octave: 4 } }],
                            },
                          ],
                        } as never,
                      ],
                    }
                  : m,
              ),
            }
          : p,
      ),
    };

    const startsB = asStarts([idsB[0]!]);
    let next = applyStaffVisibilityFromSystem(withNote, 0, idsB[0]!, a1, false, startsB);
    next = applyStaffVisibilityFromSystem(next, 0, idsB[0]!, a2, false, startsB);

    const groups = ghostRailGroupsOnSystem(next, 0, idsB[0]!);
    expect(groups.length).toBe(1);
    const g = groups[0]!;
    expect(g.partIds).toEqual([a1, a2]);
    expect(g.staffGroups).toEqual([[a1], [a2]]);
    // First staff has no music (flute is full rests); second carries the note.
    expect(g.staffGroupHasMusic).toEqual([false, true]);
    // Silence the unused-var warning for the original 2-part construction
    // sketch we replaced with the 3-part script above.
    void p1;
  });
});

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
  it("seeds full pagination on first break and applies the new break", () => {
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    const computed = asStarts([ids[0]!, ids[2]!, ids[4]!, ids[6]!]);
    const next = insertBreakInScore(score, 0, ids[3]!, "system", computed);
    const sd = next.scores![0]!;
    const sysCount = sd.pages!.flatMap((p) => p.systems).length;
    expect(sysCount).toBe(5);
    expect(sd.pages!.flatMap((p) => p.systems).some((s) => s.measure === ids[3])).toBe(true);
  });

  it("converts a system break to a page break (idempotent insert)", () => {
    const score = makeScore("flute");
    const ids = measureIds(score);
    const computed = asStarts([ids[0]!, ids[2]!, ids[4]!, ids[6]!]);
    let next = insertBreakInScore(score, 0, ids[4]!, "system", computed);
    next = insertBreakInScore(next, 0, ids[4]!, "page", computed);
    const sd = next.scores![0]!;
    expect(sd.pages!.length).toBe(2);
    expect(sd.pages![1]!.systems[0]!.measure).toBe(ids[4]);
  });
});

describe("clearBreakInScore / clearAllBreaksInScore", () => {
  it("removes a single break, leaving snapshot otherwise intact", () => {
    const score = makeScore("flute");
    const ids = measureIds(score);
    const computed = asStarts([ids[0]!, ids[2]!, ids[4]!, ids[6]!]);
    let next = insertBreakInScore(score, 0, ids[3]!, "system", computed);
    next = clearBreakInScore(next, 0, ids[3]!);
    const sd = next.scores![0]!;
    const measures = sd.pages!.flatMap((p) => p.systems).map((s) => s.measure);
    expect(measures).not.toContain(ids[3]);
    expect(measures.length).toBe(4);
  });

  it("wipeAll reverts to automatic pagination", () => {
    const score = makeScore("flute");
    const ids = measureIds(score);
    let next = insertBreakInScore(score, 0, ids[3]!, "system", asStarts([ids[0]!]));
    next = clearAllBreaksInScore(next, 0);
    expect(next.scores![0]!.pages).toBeUndefined();
  });
});

describe("setStaffVisibilityInScore", () => {
  it("hides a part on a specific system via derived layout", () => {
    const score = makeScore("flute", "violin", "cello");
    const ids = measureIds(score);
    const computed = asStarts([ids[0]!, ids[4]!]);
    let next = insertBreakInScore(score, 0, ids[4]!, "system", computed);

    const partIdToHide = next.parts[1]!.id;
    next = setStaffVisibilityInScore(next, 0, ids[4]!, partIdToHide, false);

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
    const computed = asStarts([ids[0]!, ids[4]!]);
    let next = insertBreakInScore(score, 0, ids[4]!, "system", computed);
    const partIdToHide = next.parts[1]!.id;

    next = setStaffVisibilityInScore(next, 0, ids[4]!, partIdToHide, false);
    const layoutsWithDerived = next.layouts!.length;
    expect(next.layouts!.some((l) => l._x?.viritura?.derived === true)).toBe(true);

    next = setStaffVisibilityInScore(next, 0, ids[4]!, partIdToHide, true);
    expect(next.layouts!.length).toBeLessThan(layoutsWithDerived);
    expect(hiddenPartsOnSystem(next, 0, ids[4]!).size).toBe(0);
  });

  it("refuses to hide every staff in a system (no-op)", () => {
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    const computed = asStarts([ids[0]!, ids[4]!]);
    let next = insertBreakInScore(score, 0, ids[4]!, "system", computed);

    const part1 = next.parts[0]!.id;
    const part2 = next.parts[1]!.id;
    next = setStaffVisibilityInScore(next, 0, ids[4]!, part1, false);
    expect(hiddenPartsOnSystem(next, 0, ids[4]!).has(part1)).toBe(true);

    // Attempting to hide the last visible staff should be a no-op.
    const before = next;
    next = setStaffVisibilityInScore(next, 0, ids[4]!, part2, false);
    expect(next).toBe(before); // referential equality — no change
    expect(hiddenPartsOnSystem(next, 0, ids[4]!).has(part2)).toBe(false);
  });
});

describe("applyStaffVisibilityFromSystem", () => {
  it("only materialises the target system (no forced page breaks elsewhere)", () => {
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
    // Only the target system should be materialised — every other
    // system stays on engine auto-flow so the page geometry remains
    // reflowable. (Previously this would have been 4 systems.)
    expect(allSystems.length).toBe(1);
    expect(allSystems[0]!.measure).toBe(ids[4]);
    // Critically: the engine-computed page break at m5 must NOT have
    // been promoted to a forced page boundary in pages[]. Since we
    // only have one materialised system, it lives on the first (and
    // only) page in the authored snapshot.
    expect(pages.length).toBe(1);
    // And the hide actually took effect on that system.
    expect(hiddenPartsOnSystem(next, 0, ids[4]!).has(partIdToHide)).toBe(true);
  });

  it("preserves existing user-authored breaks when adding a hide elsewhere", () => {
    const score = makeScore("flute", "violin");
    const ids = measureIds(score);
    const computed = asStarts([ids[0]!, ids[2]!, ids[4]!, ids[6]!]);
    // User first inserts a page break at m3. PageBreak is encoded
    // structurally: m3 should be the first system of a separate page.
    const withBreak = insertBreakInScore(score, 0, ids[2]!, "page", computed);
    const pagesBefore = withBreak.scores![0]!.pages ?? [];
    const m3PageIdx = pagesBefore.findIndex((p) => p.systems.some((s) => s.measure === ids[2]));
    const m1PageIdx = pagesBefore.findIndex((p) => p.systems.some((s) => s.measure === ids[0]));
    expect(m3PageIdx).toBeGreaterThan(m1PageIdx);

    // Then hides a part on m5.
    const partIdToHide = withBreak.parts[1]!.id;
    const next = applyStaffVisibilityFromSystem(withBreak, 0, ids[4]!, partIdToHide, false, computed);

    const pagesAfter = next.scores![0]!.pages ?? [];
    // The earlier user-authored page break must still be structurally
    // present (m3 still on its own page after m1's page).
    const m3PageIdxAfter = pagesAfter.findIndex((p) => p.systems.some((s) => s.measure === ids[2]));
    const m1PageIdxAfter = pagesAfter.findIndex((p) => p.systems.some((s) => s.measure === ids[0]));
    expect(m3PageIdxAfter).toBeGreaterThan(m1PageIdxAfter);
    // And the hide target was materialised somewhere in pages[].
    const allSystems = pagesAfter.flatMap((p) => p.systems);
    expect(allSystems.some((s) => s.measure === ids[4])).toBe(true);
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

    const computed = asStarts([ids[0]!, ids[4]!]);
    let next = insertBreakInScore(condensedScore, 0, ids[4]!, "system", computed);
    // Hide via p1 — p2 (its condensed staff-mate) must hide too.
    next = setStaffVisibilityInScore(next, 0, ids[4]!, p1, false);

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

    const computed = asStarts([ids[0]!, ids[4]!]);
    let next = insertBreakInScore(condensedScore, 0, ids[4]!, "system", computed);
    next = setStaffVisibilityInScore(next, 0, ids[4]!, p1, false);

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

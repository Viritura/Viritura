import { describe, it, expect } from "vitest";
import { parseMnx, serializeMnx } from "@viritura/format";
import { applyStaffVisibilityFromSystem, insertBreakInScore } from "../score/ScoreMutations";
import { buildBlankScore, type NewScoreSettings } from "../score/ScoreBuilder";
import { createPlayer, renumberPlayers } from "../score/InstrumentCatalog";
import type { Score } from "@viritura/core";

function makeScore(): Score {
  const players = renumberPlayers([createPlayer("flute"), createPlayer("violin")]);
  const settings: NewScoreSettings = {
    title: "RoundTrip",
    players,
    time: { count: 4, unit: 4 },
    keyFifths: 0,
    measureCount: 8,
    tempoBpm: 120,
  };
  return parseMnx(JSON.parse(buildBlankScore(settings)));
}

describe("Engrave-mode MNX round-trip", () => {
  it("forced breaks survive serialize → parse", () => {
    const original = makeScore();
    const ids = original.global.measures.map((m, i) => m.id ?? `m${i + 1}`);
    const withBreaks = insertBreakInScore(original, 0, ids[3]!, "page");
    const obj = serializeMnx(withBreaks);
    const reparsed = parseMnx(obj);

    expect(reparsed.scores![0]!.pages).toBeUndefined();
    expect(reparsed.scores![0]!.layoutBreaks).toEqual([{ measure: ids[3], kind: "page" }]);
  });

  it("hidden-staff layout swap survives serialize → parse", () => {
    const original = makeScore();
    // buildBlankScore pre-creates a per-part layout for every part as a
    // convenience for parts-viewing. We strip them here so the hide-staff
    // prune produces a layout shape that doesn't already exist —
    // otherwise structural dedup (correctly) reuses the matching
    // user-authored layout and no derived layout is minted at all.
    const baseLayoutId = original.scores![0]!.layout!;
    const trimmed: Score = {
      ...original,
      layouts: original.layouts!.filter((l) => l.id === baseLayoutId),
    };
    const ids = trimmed.global.measures.map((m, i) => m.id ?? `m${i + 1}`);

    let next = insertBreakInScore(trimmed, 0, ids[4]!, "system");
    const partIdToHide = next.parts[1]!.id;
    next = applyStaffVisibilityFromSystem(next, 0, ids[4]!, partIdToHide, false, []);

    const obj = serializeMnx(next);
    const reparsed = parseMnx(obj);

    const sys = reparsed.scores![0]!.pages!.flatMap((p) => p.systems).find((s) => s.measure === ids[4]);
    expect(sys?.layout).toBeDefined();
    expect(reparsed.scores![0]!.layoutBreaks).toEqual([{ measure: ids[4], kind: "system" }]);

    // The derived layout must be present in the document's layouts list
    // and flagged via the vendor extension that round-trips through MNX.
    const derived = reparsed.layouts!.find((l) => l.id === sys!.layout);
    expect(derived).toBeDefined();
    expect(derived!._x?.viritura?.derived).toBe(true);
    // And it must be distinct from the base layout id.
    expect(sys!.layout).not.toBe(reparsed.scores![0]!.layout);
  });
});

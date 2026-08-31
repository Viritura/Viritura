import { describe, it, expect } from "vitest";
import type { LayoutContent, Score } from "@viritura/core";
import { addInstrumentToScore } from "../instrumentMutations";
import { collectPartIdsInLayout } from "../scoreMembership";

function staff(part: string): LayoutContent {
  return { type: "staff", sources: [{ part }] } as unknown as LayoutContent;
}

/** Two conductor layouts ("full" + "brass") plus a trumpet extract. */
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    parts: [
      { id: "tp", name: "Trumpet", measures: [{}], _x: { viritura: { instrumentId: "trumpet" } } },
      { id: "hn", name: "Horn", measures: [{}], _x: { viritura: { instrumentId: "horn" } } },
    ],
    layouts: [
      { id: "full", content: [staff("tp"), staff("hn")] },
      { id: "brass", content: [staff("tp"), staff("hn")] },
      { id: "L-tp", content: [staff("tp")] },
    ],
    scores: [
      { name: "Full Score", layout: "full" },
      { name: "Brass", layout: "brass" },
      { name: "Trumpet", layout: "L-tp" },
    ],
    global: { measures: [{}] },
  } as unknown as Score;
}

function newPartId(before: Score, after: Score): string {
  const had = new Set(before.parts.map((p) => p.id));
  return after.parts.find((p) => !had.has(p.id))!.id!;
}

describe("addInstrumentToScore — target layouts", () => {
  it("adds the new staff only to the chosen target layouts", () => {
    const score = makeScore();
    const next = addInstrumentToScore(score, "flute", ["full"]);
    const newId = newPartId(score, next);
    const byId = (id: string) => next.layouts!.find((l) => l.id === id)!;
    expect(collectPartIdsInLayout(byId("full").content).has(newId)).toBe(true);
    // Not added to the un-targeted "brass" conductor layout.
    expect(collectPartIdsInLayout(byId("brass").content).has(newId)).toBe(false);
  });

  it("always creates the per-part extract layout + score regardless of targets", () => {
    const score = makeScore();
    const next = addInstrumentToScore(score, "flute", []);
    const newId = newPartId(score, next);
    // No conductor layout got the staff…
    expect(collectPartIdsInLayout(next.layouts!.find((l) => l.id === "full")!.content).has(newId)).toBe(false);
    expect(collectPartIdsInLayout(next.layouts!.find((l) => l.id === "brass")!.content).has(newId)).toBe(false);
    // …but the extract layout + score still exist.
    expect(next.layouts!.some((l) => l.id === `L-${newId}`)).toBe(true);
    expect(next.scores!.some((sd) => sd.layout === `L-${newId}`)).toBe(true);
  });

  it("falls back to the canonical full score when no targets are given", () => {
    const score = makeScore();
    const next = addInstrumentToScore(score, "flute");
    const newId = newPartId(score, next);
    // Legacy behavior: appends to the layout named "Full Score".
    expect(collectPartIdsInLayout(next.layouts!.find((l) => l.id === "full")!.content).has(newId)).toBe(true);
    expect(collectPartIdsInLayout(next.layouts!.find((l) => l.id === "brass")!.content).has(newId)).toBe(false);
  });
});

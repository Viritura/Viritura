import { describe, it, expect } from "vitest";
import type { LayoutContent, Score } from "@viritura/core";
import {
  addPartToScoreLayout,
  collectConductorScores,
  collectPartIdsInLayout,
  createSectionScore,
  removePartFromScoreLayout,
  scoreLayoutContainsPart,
  setScoreLayoutMembership,
} from "../scoreMembership";

function staff(part: string): LayoutContent {
  return { type: "staff", sources: [{ part }] } as unknown as LayoutContent;
}
function group(label: string, content: LayoutContent[]): LayoutContent {
  return { type: "group", symbol: "bracket", label, content } as unknown as LayoutContent;
}

/** Collect part ids in depth-first (visual) order from layout content. */
function partOrder(content: readonly LayoutContent[]): string[] {
  const ids: string[] = [];
  const walk = (nodes: readonly LayoutContent[]) => {
    for (const node of nodes) {
      if (node.type === "group") walk(node.content);
      else for (const s of node.sources) if (s.part) ids.push(s.part);
    }
  };
  walk(content);
  return ids;
}

/**
 * A two-instrument document: a Full Score (both staves, in a Brass family
 * group), a single-staff Trumpet extract, and a single-staff Horn extract.
 * The horn carries an instrument-id vendor ext so add-back resolves its family.
 */
function makeScore(): Score {
  return {
    parts: [
      { id: "tp", name: "Trumpet", _x: { viritura: { instrumentId: "trumpet", family: "brass" } } },
      { id: "hn", name: "Horn", _x: { viritura: { instrumentId: "horn", family: "brass" } } },
    ],
    layouts: [
      { id: "full", content: [group("Brass", [staff("tp"), staff("hn")])] },
      { id: "L-tp", content: [staff("tp")] },
      { id: "L-hn", content: [staff("hn")] },
    ],
    scores: [
      { name: "Full Score", layout: "full" },
      { name: "Trumpet", layout: "L-tp" },
      { name: "Horn", layout: "L-hn" },
    ],
    global: { measures: [] },
  } as unknown as Score;
}

describe("collectPartIdsInLayout", () => {
  it("collects part ids across nested groups", () => {
    const content = [group("Brass", [staff("tp"), staff("hn")]), staff("tuba")];
    expect(collectPartIdsInLayout(content)).toEqual(new Set(["tp", "hn", "tuba"]));
  });
});

describe("collectConductorScores", () => {
  it("returns only multi-part scores, excluding single-part extracts", () => {
    const conductors = collectConductorScores(makeScore());
    expect(conductors.map((c) => c.layoutId)).toEqual(["full"]);
    expect(conductors[0]).toMatchObject({ index: 0, name: "Full Score", staffCount: 2 });
  });

  it("does not treat a two-staff piano part as a conductor score", () => {
    const score = makeScore();
    score.layouts!.push({ id: "L-piano", content: [group("Piano", [staff("pno"), staff("pno")])] });
    score.scores!.push({ name: "Piano", layout: "L-piano" });

    expect(collectConductorScores(score).map((entry) => entry.layoutId)).toEqual(["full"]);
  });
});

describe("scoreLayoutContainsPart", () => {
  it("detects membership by layout id", () => {
    const score = makeScore();
    expect(scoreLayoutContainsPart(score, "full", "tp")).toBe(true);
    expect(scoreLayoutContainsPart(score, "L-tp", "hn")).toBe(false);
  });
});

describe("removePartFromScoreLayout", () => {
  it("removes a part's staff from one layout but keeps the part and other layouts", () => {
    const score = makeScore();
    const next = removePartFromScoreLayout(score, "hn", "full");
    // Part still exists in the document.
    expect(next.parts.some((p) => p.id === "hn")).toBe(true);
    // Removed from the full score only.
    expect(scoreLayoutContainsPart(next, "full", "hn")).toBe(false);
    expect(partOrder(next.layouts!.find((l) => l.id === "full")!.content)).toEqual(["tp"]);
    // The horn extract is untouched.
    expect(scoreLayoutContainsPart(next, "L-hn", "hn")).toBe(true);
  });

  it("prunes an emptied family group", () => {
    const score = makeScore();
    // Remove both brass parts from the full score → the Brass group empties.
    const a = removePartFromScoreLayout(score, "tp", "full");
    const b = removePartFromScoreLayout(a, "hn", "full");
    expect(b.layouts!.find((l) => l.id === "full")!.content).toEqual([]);
  });

  it("is a no-op when the part is absent from the layout", () => {
    const score = makeScore();
    expect(removePartFromScoreLayout(score, "hn", "L-tp")).toBe(score);
  });
});

describe("addPartToScoreLayout", () => {
  it("adds an existing part back into a layout it was removed from", () => {
    const score = makeScore();
    const removed = removePartFromScoreLayout(score, "hn", "full");
    expect(scoreLayoutContainsPart(removed, "full", "hn")).toBe(false);
    const readded = addPartToScoreLayout(removed, "hn", "full");
    expect(scoreLayoutContainsPart(readded, "full", "hn")).toBe(true);
    // Joins the matching Brass family group rather than the root.
    const root = readded.layouts!.find((l) => l.id === "full")!.content;
    expect(root.length).toBe(1);
    expect(root[0]!.type).toBe("group");
    expect(partOrder(root)).toEqual(["tp", "hn"]);
  });

  it("is idempotent when the part is already present", () => {
    const score = makeScore();
    expect(addPartToScoreLayout(score, "tp", "full")).toBe(score);
  });

  it("is a no-op for an unknown layout or part", () => {
    const score = makeScore();
    expect(addPartToScoreLayout(score, "hn", "nope")).toBe(score);
    expect(addPartToScoreLayout(score, "ghost", "full")).toBe(score);
  });
});

/** A 3-part document: trumpet (brass), glock + timpani (percussion). */
function makePercussionScore(): Score {
  return {
    parts: [
      { id: "tp", name: "Trumpet", _x: { viritura: { instrumentId: "trumpet", family: "brass" } } },
      { id: "glk", name: "Glockenspiel", _x: { viritura: { instrumentId: "glockenspiel", family: "percussion" } } },
      { id: "timp", name: "Timpani", _x: { viritura: { instrumentId: "timpani", family: "percussion" } } },
    ],
    layouts: [{ id: "full", content: [staff("tp"), staff("glk"), staff("timp")] }],
    scores: [{ name: "Full Score", layout: "full" }],
    global: { measures: [] },
  } as unknown as Score;
}

describe("createSectionScore", () => {
  it("creates a new conductor score with only the chosen parts, in document order", () => {
    const score = makePercussionScore();
    const result = createSectionScore(score, ["timp", "glk"], "Percussion");
    expect(result).not.toBeNull();
    const { score: next, selectedIndex } = result!;
    // Appended at the end.
    expect(selectedIndex).toBe(next.scores!.length - 1);
    const sd = next.scores![selectedIndex]!;
    expect(sd.name).toBe("Percussion");
    const layout = next.layouts!.find((l) => l.id === sd.layout)!;
    // Document order preserved (glk before timp), not selection order.
    expect(partOrder(layout.content)).toEqual(["glk", "timp"]);
    // Both percussion parts share one family group.
    expect(layout.content.length).toBe(1);
    expect(layout.content[0]!.type).toBe("group");
    // Trumpet untouched in the document.
    expect(next.parts.map((p) => p.id)).toEqual(["tp", "glk", "timp"]);
  });

  it("defaults the name and returns null when no known parts are chosen", () => {
    const score = makePercussionScore();
    expect(createSectionScore(score, [])).toBeNull();
    expect(createSectionScore(score, ["ghost"])).toBeNull();
    const result = createSectionScore(score, ["glk"]);
    expect(result!.score.scores!.at(-1)!.name).toBe("Section Score");
  });
});

describe("setScoreLayoutMembership", () => {
  it("adds missing and removes extra parts to match the target set", () => {
    const score = makePercussionScore();
    // Full score currently has tp, glk, timp. Target: just the two percussion.
    const next = setScoreLayoutMembership(score, "full", ["glk", "timp"]);
    expect(collectPartIdsInLayout(next.layouts![0]!.content)).toEqual(new Set(["glk", "timp"]));
    // Parts remain in the document.
    expect(next.parts.map((p) => p.id)).toEqual(["tp", "glk", "timp"]);
  });

  it("adds a previously-absent part back (appended when no family group exists)", () => {
    const score = makePercussionScore();
    const removed = removePartFromScoreLayout(score, "glk", "full");
    expect(scoreLayoutContainsPart(removed, "full", "glk")).toBe(false);
    const restored = setScoreLayoutMembership(removed, "full", ["tp", "glk", "timp"]);
    // All three present again; re-added glk appends at the end of the flat list.
    expect(collectPartIdsInLayout(restored.layouts![0]!.content)).toEqual(new Set(["tp", "glk", "timp"]));
    expect(partOrder(restored.layouts![0]!.content)).toEqual(["tp", "timp", "glk"]);
  });

  it("is a no-op for an unknown layout", () => {
    const score = makePercussionScore();
    expect(setScoreLayoutMembership(score, "nope", ["tp"])).toBe(score);
  });
});

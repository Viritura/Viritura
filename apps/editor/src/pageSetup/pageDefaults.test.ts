import { describe, expect, it } from "vitest";
import { DEFAULT_PART_PAGE_SETUP, resolveScorePageSetup, type Score } from "@viritura/core";
import { DeltaSerializer, parseMnx, serializeMnx } from "@viritura/format";
import { resolvePageSetupForScore } from "../publish";

const LETTER = { ...DEFAULT_PART_PAGE_SETUP, width: 215.9, height: 279.4 };
const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [{ id: "p1", name: "Violin", measures: [{ sequences: [{ content: [] }] }] }],
  scores: [
    { name: "Full score", pageSetupRole: "score" },
    { name: "Violin", pageSetupRole: "part" },
    { name: "Custom part", pageSetupRole: "part", pageSetup: { width: 250 } },
  ],
};

describe("project page defaults", () => {
  it("propagates profile changes to layouts that do not override the same values", () => {
    const score: Score = { ...SCORE, pageSetupDefaults: { part: LETTER } };
    expect(resolveScorePageSetup(score, 1)).toEqual(LETTER);
    expect(resolveScorePageSetup(score, 2)).toEqual({ ...LETTER, width: 250 });
    expect(resolvePageSetupForScore(score, 1)).toEqual(LETTER);
  });

  it("keeps sparse layout overrides sparse after reopening", () => {
    const score: Score = { ...SCORE, pageSetupDefaults: { part: LETTER } };
    const reopened = parseMnx(serializeMnx(score));
    expect(reopened.scores?.[2]?.pageSetup).toEqual({ width: 250 });
    expect(resolveScorePageSetup(reopened, 2)).toEqual({ ...LETTER, width: 250 });
  });

  it("invalidates retained layout and saved JSON when only project defaults change", () => {
    const serializer = new DeltaSerializer();
    serializer.serialize(SCORE);
    const next = { ...SCORE, pageSetupDefaults: { part: LETTER } };
    const result = serializer.serialize(next);
    expect(result.structuralChange).toBe(true);
    expect(JSON.parse(result.json)).toEqual(serializeMnx(next));
  });

  it("keeps turn-only overrides inheriting profile geometry and other turn settings", () => {
    const part = {
      ...LETTER,
      pageTurns: { enabled: true, preset: "professional" as const, titlePage: "always" as const },
    };
    const score: Score = {
      ...SCORE,
      pageSetupDefaults: { part },
      scores: [{ pageSetupRole: "part", pageSetup: { pageTurns: { enabled: true, titlePage: "never" } } }],
    };
    expect(resolveScorePageSetup(score, 0)).toEqual({ ...part, pageTurns: { ...part.pageTurns, titlePage: "never" } });
  });
});

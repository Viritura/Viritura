import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SETUP, DEFAULT_PART_PAGE_SETUP, resolveScorePageSetup, type Score } from "@viritura/core";
import { parseMnx, serializeMnx, DeltaSerializer } from "@viritura/format";
import { setProjectPageDefault } from "./projectDefaults";
import { resolvePageSetupForScore } from "../publish";

const LETTER = { ...DEFAULT_PART_PAGE_SETUP, width: 215.9, height: 279.4 };
const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [{ id: "p1", name: "Violin", measures: [{ sequences: [{ content: [] }] }] }],
  scores: [
    { name: "Full score", pageSetupRole: "score" },
    { name: "Violin", pageSetupRole: "part" },
    { name: "Custom part", pageSetupRole: "part", pageSetup: { ...DEFAULT_PART_PAGE_SETUP, width: 250 } },
  ],
};

describe("project page defaults", () => {
  it("applies independent defaults to all inheriting layouts and preserves custom geometry", () => {
    const updated = setProjectPageDefault(SCORE, "part", LETTER, false);
    expect(resolveScorePageSetup(updated, 0)).toEqual(DEFAULT_PAGE_SETUP);
    expect(resolveScorePageSetup(updated, 1)).toEqual(LETTER);
    expect(resolveScorePageSetup(updated, 2)).toEqual(SCORE.scores?.[2]?.pageSetup);
    expect(SCORE.pageSetupDefaults).toBeUndefined();
    expect(resolvePageSetupForScore(updated, 1)).toEqual(LETTER);
  });

  it("snapshots partial overrides before changing defaults, and can explicitly replace them", () => {
    const score = parseMnx({
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [],
      scores: [{ name: "Custom", _x: { viritura: { pageSetupRole: "part", pageSetup: { width: 250 } } } }],
    });
    const preserved = setProjectPageDefault(score, "part", LETTER, false);
    expect(resolveScorePageSetup(preserved, 0)).toEqual({ ...DEFAULT_PART_PAGE_SETUP, width: 250 });
    const replaced = setProjectPageDefault(preserved, "part", LETTER, true);
    expect(replaced.scores?.[0]?.pageSetup).toBeUndefined();
    expect(resolveScorePageSetup(replaced, 0)).toEqual(LETTER);
  });

  it("replaces only the requested role and preserves other layout engraving", () => {
    const score = {
      ...SCORE,
      scores: SCORE.scores?.map((definition) => ({
        ...definition,
        pageSetup: { ...DEFAULT_PAGE_SETUP, width: 250 },
        layoutBreaks: [{ measure: "m1", kind: "page" as const }],
      })),
    };
    const updated = setProjectPageDefault(score, "part", LETTER, true);
    expect(updated.scores?.[0]?.pageSetup?.width).toBe(250);
    expect(resolveScorePageSetup(updated, 1)).toEqual(LETTER);
    expect(resolveScorePageSetup(updated, 2)).toEqual(LETTER);
    expect(updated.scores?.[1]?.layoutBreaks).toEqual(score.scores?.[1]?.layoutBreaks);
  });

  it("retains explicit A4 and staff-size overrides over project defaults after reopening", () => {
    const score = setProjectPageDefault(SCORE, "part", LETTER, false);
    const override = { ...DEFAULT_PAGE_SETUP, pageTurns: { enabled: false } };
    const custom: Score = {
      ...score,
      scores: score.scores?.map((definition, index) =>
        index === 1 ? { ...definition, pageSetup: override } : definition,
      ),
    };
    const reopened = parseMnx(serializeMnx(custom));
    expect(resolveScorePageSetup(reopened, 1)).toEqual(override);
    expect(reopened.pageSetupDefaults?.part).toEqual(LETTER);
    expect(reopened.scores?.[1]?.pageSetupRole).toBe("part");
    const reset: Score = {
      ...reopened,
      scores: reopened.scores?.map((definition, index) =>
        index === 1 ? { ...definition, pageSetup: undefined } : definition,
      ),
    };
    expect(resolveScorePageSetup(reset, 1)).toEqual(LETTER);
  });

  it("invalidates retained layout and saved JSON when only project defaults change", () => {
    const serializer = new DeltaSerializer();
    serializer.serialize(SCORE);
    const next = { ...SCORE, pageSetupDefaults: { part: LETTER } };
    const result = serializer.serialize(next);
    expect(result.structuralChange).toBe(true);
    expect(JSON.parse(result.json)).toEqual(serializeMnx(next));
  });
});

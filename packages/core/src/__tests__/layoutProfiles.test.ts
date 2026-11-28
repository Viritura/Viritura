import { describe, expect, it } from "vitest";

import { DEFAULT_PART_PAGE_SETUP, DEFAULT_PAGE_SETUP } from "../model/layout";
import { assignedLayoutProfile, profilePageSetupForScore, resolveScorePageSetup } from "../model/pageSetup";
import type { Score } from "../model/score";

function scoreWithViews(): Score {
  return {
    parts: [],
    scores: [{ name: "Full score" }, { name: "Violin", pageSetupRole: "part" }],
  } as unknown as Score;
}

describe("layout profile cascade", () => {
  it("layers sparse default-profile values over built-in role defaults", () => {
    const score = scoreWithViews();
    score.pageSetupDefaults = { part: { spatiumMm: 1.75, margins: { left: 20 } } };

    const part = resolveScorePageSetup(score, 1);
    expect(part.spatiumMm).toBe(1.75);
    expect(part.margins).toEqual({ ...DEFAULT_PART_PAGE_SETUP.margins, left: 20 });
    expect(part.pageTurns).toEqual(DEFAULT_PART_PAGE_SETUP.pageTurns);
    expect(resolveScorePageSetup(score, 0)).toEqual(DEFAULT_PAGE_SETUP);
  });

  it("uses an assigned named profile instead of the role default", () => {
    const score = scoreWithViews();
    score.pageSetupDefaults = { part: { spatiumMm: 1.75 } };
    score.layoutProfiles = [{ id: "large", name: "Large print", role: "part", pageSetup: { spatiumMm: 2 } }];
    score.scores![1]!.layoutProfile = "large";

    expect(profilePageSetupForScore(score, 1).spatiumMm).toBe(2);
  });

  it("lets layout overrides win over the profile one field at a time", () => {
    const score = scoreWithViews();
    score.layoutProfiles = [
      { id: "large", name: "Large print", role: "part", pageSetup: { spatiumMm: 2, margins: { top: 25 } } },
    ];
    score.scores![1] = { ...score.scores![1], layoutProfile: "large", pageSetup: { margins: { bottom: 5 } } };

    const resolved = resolveScorePageSetup(score, 1);
    expect(resolved.spatiumMm).toBe(2);
    expect(resolved.margins).toEqual({ ...DEFAULT_PART_PAGE_SETUP.margins, top: 25, bottom: 5 });
  });

  it("ignores profiles whose role does not match the score view", () => {
    const score = scoreWithViews();
    score.layoutProfiles = [{ id: "big-score", name: "Big score", role: "score", pageSetup: { spatiumMm: 2 } }];
    score.scores![1]!.layoutProfile = "big-score";

    expect(assignedLayoutProfile(score, 1)).toBeUndefined();
    expect(resolveScorePageSetup(score, 1).spatiumMm).toBe(DEFAULT_PART_PAGE_SETUP.spatiumMm);
  });
});

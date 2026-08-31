import { describe, expect, it } from "vitest";
import type { LayoutContent, Score } from "@viritura/core";

import { buildScoreEntries } from "../scoreSwitcher/scoreEntries";

function staff(part: string): LayoutContent {
  return { type: "staff", sources: [{ part }] } as LayoutContent;
}

function scoreFixture(): Score {
  return {
    global: { measures: [] },
    parts: [
      { id: "pno", name: "Piano", measures: [] },
      { id: "sop", name: "Soprano", measures: [] },
      { id: "alto", name: "Alto", measures: [] },
    ],
    layouts: [
      { id: "piano", content: [staff("pno"), staff("pno")] },
      { id: "choir", content: [staff("sop"), staff("alto")] },
    ],
    scores: [
      { name: "Piano", layout: "piano" },
      { name: "Choir Score", layout: "choir" },
    ],
  } as Score;
}

describe("buildScoreEntries", () => {
  it("groups a multi-staff single instrument as a part", () => {
    expect(buildScoreEntries(scoreFixture())[0]).toMatchObject({ name: "Piano", isScore: false });
  });

  it("groups a partial multi-part layout as a score", () => {
    expect(buildScoreEntries(scoreFixture())[1]).toMatchObject({ name: "Choir Score", isScore: true });
  });
});

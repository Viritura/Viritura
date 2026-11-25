import { describe, expect, it } from "vitest";
import { pickDefaultScore } from "./folderScan";

const scores = [{ relativePath: "a.mnx" }, { relativePath: "set/b.mnx" }];

describe("pickDefaultScore", () => {
  it("reopens the score last used in a folder of the same name", () => {
    const recents = [
      { vcs: { rootName: "Other", scoreRelPath: "a.mnx" } },
      {},
      { vcs: { rootName: "Gig", scoreRelPath: "set/b.mnx" } },
      { vcs: { rootName: "Gig", scoreRelPath: "a.mnx" } },
    ];
    expect(pickDefaultScore("Gig", scores, recents)).toBe(scores[1]);
  });

  it("falls back to scan order when the remembered score is gone", () => {
    expect(pickDefaultScore("Gig", scores, [{ vcs: { rootName: "Gig", scoreRelPath: "deleted.mnx" } }])).toBe(
      scores[0],
    );
  });
});

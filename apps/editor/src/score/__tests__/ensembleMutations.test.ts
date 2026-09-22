import { describe, expect, it } from "vitest";
import { parseMnx } from "@viritura/format";
import type { LayoutContent } from "@viritura/core";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../ScoreBuilder";
import { addEnsembleToScore } from "../ensembleMutations";
import { addInstrumentToScore } from "../ScoreMutations";

function groupShape(node: LayoutContent): unknown {
  if (node.type === "staff") return "staff";
  return {
    label: node.label,
    symbol: node.symbol,
    content: node.content.map(groupShape),
  };
}

describe("addEnsembleToScore", () => {
  it("builds family and subfamily brackets when a preset populates an empty project", () => {
    const empty = parseMnx(JSON.parse(buildBlankScore({ ...DEFAULT_NEW_SCORE_SETTINGS, measureCount: 1 })));
    const updated = addEnsembleToScore(empty, "classical-orchestra");
    const fullScore = updated.layouts?.find((layout) => layout.id === "FullScore");

    expect(fullScore?.content.map(groupShape)).toEqual([
      {
        label: "Woodwinds",
        symbol: "bracket",
        content: [
          { label: undefined, symbol: "bracket", content: ["staff", "staff"] },
          { label: undefined, symbol: "bracket", content: ["staff", "staff"] },
          { label: undefined, symbol: "bracket", content: ["staff", "staff"] },
          { label: undefined, symbol: "bracket", content: ["staff", "staff"] },
        ],
      },
      {
        label: "Brass",
        symbol: "bracket",
        content: [
          { label: undefined, symbol: "bracket", content: ["staff", "staff"] },
          { label: undefined, symbol: "bracket", content: ["staff", "staff"] },
        ],
      },
      "staff",
      {
        label: "Strings",
        symbol: "bracket",
        content: [{ label: undefined, symbol: "bracket", content: ["staff", "staff"] }, "staff", "staff", "staff"],
      },
    ]);
  });

  it("preserves custom layouts when adding a preset", () => {
    const existing = parseMnx(
      JSON.parse(
        buildBlankScore({
          ...DEFAULT_NEW_SCORE_SETTINGS,
          players: [],
          measureCount: 1,
        }),
      ),
    );
    existing.parts.push({
      id: "custom",
      name: "Custom",
      measures: [{ sequences: [{ content: [] }] }],
    });
    existing.layouts!.push({
      id: "custom-layout",
      content: [
        {
          type: "group",
          symbol: "brace",
          label: "Authored",
          content: [{ type: "staff", sources: [{ part: "custom" }] }],
        },
      ],
    });
    existing.scores!.push({ name: "Custom", layout: "custom-layout" });

    const updated = addEnsembleToScore(existing, "classical-orchestra");
    const custom = updated.layouts!.find((layout) => layout.id === "custom-layout");

    expect(custom!.content[0]).toMatchObject({ type: "group", symbol: "brace", label: "Authored" });
  });

  it("uses catalog score order regardless of insertion order", () => {
    const empty = parseMnx(JSON.parse(buildBlankScore({ ...DEFAULT_NEW_SCORE_SETTINGS, measureCount: 1 })));
    const updated = ["cello", "horn", "flute"].reduce(
      (score, instrumentId) => addInstrumentToScore(score, instrumentId),
      empty,
    );

    expect(updated.parts.map((part) => part._x?.viritura?.instrumentId)).toEqual(["flute", "horn", "cello"]);
  });
});

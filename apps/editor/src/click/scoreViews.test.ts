import { describe, expect, it } from "vitest";
import { parseMnx } from "@viritura/format";
import multipleLayouts from "../../../../packages/format/fixtures/mnx/multiple-layouts.mnx?raw";
import { clickPartMnx, clickScoreViews } from "./scoreViews";

describe("click score views", () => {
  it("preserves authored views and supplements missing extracts without duplicating an authored part", () => {
    const score = parseMnx(JSON.parse(multipleLayouts));
    const partId = score.parts[0]!.id!;
    score.layouts!.push({ id: "soprano-view", content: [{ type: "staff", sources: [{ part: partId }] }] });
    score.scores!.push({ name: "Soprano extract", layout: "soprano-view" });
    const views = clickScoreViews(score);
    expect(views.map((view) => view.label)).toEqual([
      "FourStaff",
      "TwoStaffSplit",
      "TwoStaffChord",
      "Soprano extract",
      "Alto",
      "Tenor",
      "Bass",
    ]);
    expect(views[3]?.scoreIndex).toBe(3);
    expect(views[3]?.partIndex).toBeUndefined();
    expect(views[4]).toMatchObject({ scoreIndex: 0, partIndex: 1 });
  });

  it("provides part views for ordinary MNX and derives a written-pitch view without altering the source", () => {
    const score = parseMnx(JSON.parse(multipleLayouts));
    delete score.scores;
    delete score.layouts;
    expect(clickScoreViews(score).map((view) => view.label)).toEqual([
      "Full score",
      "Soprano",
      "Alto",
      "Tenor",
      "Bass",
    ]);
    const part = parseMnx(JSON.parse(clickPartMnx(multipleLayouts, 1)));
    expect(part.parts.map((source) => source.name)).toEqual(["Alto"]);
    expect(part.scores?.[0]?.useWritten).toBe(true);
    expect(part.parts[0]?.measures).toHaveLength(score.parts[1]!.measures.length);
    expect(part.parts[0]?.measures[0]?.sequences[0]?.content[0]).toMatchObject({
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "G", octave: 4 } }],
    });
    expect(parseMnx(JSON.parse(multipleLayouts)).parts).toHaveLength(4);
  });
});

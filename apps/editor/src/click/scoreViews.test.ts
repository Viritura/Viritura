import { describe, expect, it } from "vitest";
import { parseMnx } from "@viritura/format";
import { DEFAULT_PAGE_SETUP, DEFAULT_PART_PAGE_SETUP } from "@viritura/core";
import multipleLayouts from "../../../../packages/format/fixtures/mnx/multiple-layouts.mnx?raw";
import { clickPartMnx, clickScoreViews } from "./scoreViews";

describe("click score views", () => {
  it("resolves project engraving defaults, score overrides, and source-part settings", () => {
    const score = parseMnx(JSON.parse(multipleLayouts));
    score.pageSetupDefaults = {
      score: {
        ...DEFAULT_PAGE_SETUP,
        width: 300,
        height: 200,
        orientation: "landscape",
        spatiumMm: 1.8,
        margins: { top: 10, right: 12, bottom: 14, left: 16 },
      },
      part: { ...DEFAULT_PART_PAGE_SETUP, width: 180, height: 260, spatiumMm: 1.6 },
    };
    score.scores![1]!.pageSetup = { height: 280, spatiumMm: 2 };
    const views = clickScoreViews(score);
    expect(views[0]?.pageSetup).toEqual(score.pageSetupDefaults.score);
    expect(views[1]?.pageSetup).toEqual({ ...score.pageSetupDefaults.score, height: 280, spatiumMm: 2 });
    expect(views.find((view) => view.partIndex === 1)?.pageSetup).toEqual(score.pageSetupDefaults.part);
  });

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
    expect(views[0]?.isScore).toBe(true);
    expect(views[3]?.isScore).toBe(false);
    expect(views[4]?.isScore).toBe(false);
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

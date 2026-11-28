import { describe, expect, it } from "vitest";
import type { DenigmaGap, DenigmaGapReport } from "../types";
import { applyDenigmaGapReport } from "./applyGapReport";
import type { JsonRecord } from "./types";

const frame = {
  unit: "evpu",
  width: 48,
  height: 0,
  handleOffsetX: 0,
  handleOffsetY: 0,
  wordWrap: true,
  noExpandSingleWord: false,
  justify: "center",
  inset: 12,
  lineSpacingPercent: 100,
  showBorder: false,
  borderThickness: 0,
  cornerRadius: 0,
  positionFromFrameEdge: true,
  hasCustomShape: false,
};

function adapt(
  gaps: DenigmaGap[],
  scores: JsonRecord[] = [],
  fonts: Record<string, JsonRecord> = { "1": { bold: true } },
) {
  const source = {
    mnx: { version: 57 },
    global: { measures: [{}] },
    parts: [
      {
        measures: [
          {
            text: [{ id: "text0", text: [{ text: "Expression" }] }],
            sequences: [],
          },
        ],
      },
    ],
    scores,
  };
  const report: DenigmaGapReport = {
    schemaVersion: 4,
    producer: { name: "denigma", version: "4.0.0", commit: "21346acd" },
    gaps,
    fonts,
  };
  const result = applyDenigmaGapReport(JSON.stringify(source), report);
  return { ...result, document: JSON.parse(result.mnxJson) as JsonRecord };
}

describe("schema-v3 text-block and page-text gaps", () => {
  it("maps measure text frame presentation and EVPU offsets", () => {
    const result = adapt([
      {
        type: "text-block",
        extent: "partial",
        anchor: "text0",
        textBlock: {
          unit: "evpu",
          horizontalOffset: 24,
          verticalOffset: 0,
          verticalOrigin: "staff-top-line",
          frame,
        },
      },
    ]);

    const parts = result.document["parts"] as JsonRecord[];
    const measure = (parts[0]?.["measures"] as JsonRecord[])[0]!;
    const expression = (measure["text"] as JsonRecord[])[0]!;
    expect(expression["_x"]).toEqual({
      viritura: {
        frame: {
          paragraphJustification: "center",
          padding: 0.5,
          border: "none",
          sourceReference: { unit: "evpu", referenceStaffSize: 96 },
          width: { unit: "staffSpaces", value: 2 },
        },
        manualOffset: [1, 0],
      },
    });
    expect(result.outcomes[0]?.disposition).toBe("handled");
  });

  it("maps page IDs, right-page alignment, and inverted EVPU vertical offsets", () => {
    const result = adapt(
      [
        {
          type: "page-text",
          extent: "complete",
          pageText: {
            text: {
              plain: "Title",
              runs: [{ text: "Title", font: "1" }],
            },
            unit: "evpu",
            alignment: {
              horizontal: "left",
              rightPageHorizontal: "right",
              vertical: "top",
              horizontalFrom: "margin",
              verticalFrom: "margin",
            },
            position: {
              offsetX: 24,
              offsetY: 48,
              independentRightPages: true,
              rightPageOffsetX: 48,
              rightPageOffsetY: 96,
            },
            frame: { ...frame, width: 0 },
            placements: [
              { kind: "page", anchor: "score0.page1" },
              { kind: "page", anchor: "score0.page2" },
            ],
          },
        },
      ],
      [{ pages: [{ id: "score0.page1" }, { id: "score0.page2" }] }],
    );

    const scores = result.document["scores"] as JsonRecord[];
    const scoreExtensions = scores[0]?.["_x"] as JsonRecord;
    const viritura = scoreExtensions["viritura"] as JsonRecord;
    const textFrames = viritura["textFrames"] as JsonRecord[];
    expect(textFrames).toHaveLength(2);
    expect(textFrames[0]).toMatchObject({
      locator: { type: "page", pageIndex: 0 },
      placement: { anchor: "top-right", offset: { x: 2, y: -4 } },
      width: { unit: "textColumnFraction", value: 1 },
      horizontalAlignment: "right",
      content: [{ text: "Title", style: { weight: "bold" } }],
    });
    expect(textFrames[1]).toMatchObject({
      locator: { type: "page", pageIndex: 1 },
      placement: { anchor: "top-left", offset: { x: 1, y: -2 } },
      horizontalAlignment: "left",
    });
    expect(result.outcomes[0]?.disposition).toBe("handled");
  });

  it("does not restore page text whose only source runs are hidden", () => {
    const result = adapt(
      [
        {
          type: "page-text",
          extent: "complete",
          pageText: {
            text: { plain: "Hidden", runs: [{ text: "Hidden", font: "1" }] },
            unit: "evpu",
            alignment: { horizontal: "left", vertical: "top" },
            position: { offsetX: 0, offsetY: 0 },
            frame: { ...frame, width: 0 },
            placements: [{ kind: "page", anchor: "score0.page1" }],
          },
        },
      ],
      [{ pages: [{ id: "score0.page1" }] }],
      { "1": { hidden: true } },
    );

    expect(result.document["scores"]).toEqual([{ pages: [{ id: "score0.page1" }] }]);
    expect(result.outcomes[0]?.disposition).toBe("unhandled");
  });
});

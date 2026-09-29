/**
 * textFrameScore — shared MNX fixture for text-frame stories: a two-page
 * violin part whose full score carries one frame of each locator kind.
 */

function bar(step: string) {
  return {
    sequences: [
      {
        content: [
          { type: "event", id: `e-${step}`, duration: { base: "whole" }, notes: [{ pitch: { step, octave: 5 } }] },
        ],
      },
    ],
  };
}

const STEPS = ["C", "D", "E", "F", "G", "A", "B", "C", "D", "E", "F", "G", "A", "B", "C", "D"];

function textFrame(
  id: string,
  locator: Record<string, unknown>,
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    locator,
    placement: { anchor: "top-left", offset: { x: 0, y: 0 } },
    width: { unit: "staffSpaces", value: 24 },
    content: [{ text }],
    ...extra,
  };
}

/** Page-index, global-measure, and event-located frames on one score view. */
export const TEXT_FRAME_MNX = {
  mnx: { version: 1 },
  global: {
    measures: STEPS.map((_, i) => ({
      id: `m${i + 1}`,
      ...(i === 0 ? { time: { count: 4, unit: 4 }, key: { fifths: 0 } } : {}),
    })),
  },
  parts: [
    {
      id: "vn",
      name: "Violin",
      measures: STEPS.map((step, i) =>
        i === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }], ...bar(step) } : bar(step),
      ),
    },
  ],
  layouts: [{ id: "L", content: [{ type: "staff", sources: [{ part: "vn" }] }] }],
  scores: [
    {
      name: "Full Score",
      layout: "L",
      _x: {
        viritura: {
          layoutBreaks: [{ measure: "m9", kind: "page" }],
          textFrames: [
            textFrame(
              "program-note",
              { type: "page", pageIndex: 0 },
              "Program note: this frame is located by page index and stays on page 1 when the music reflows.",
              {
                placement: { anchor: "bottom", offset: { x: 0, y: -4 } },
                width: { unit: "textColumnFraction", value: 0.6 },
                horizontalAlignment: "center",
                paragraphJustification: "justify",
                border: "solid",
                padding: 1,
              },
            ),
            textFrame(
              "section-note",
              { type: "globalMeasure", measureId: "m9" },
              "Second section\nfollows measure 9 onto its page",
              {
                placement: { anchor: "top-right", offset: { x: 0, y: 6 } },
                horizontalAlignment: "right",
                paragraphJustification: "right",
              },
            ),
            textFrame(
              "solo-note",
              { type: "event", partId: "vn", eventId: "e-G" },
              "Solo cue follows the event in measure 5",
              {
                placement: { anchor: "left", offset: { x: 2, y: 0 } },
              },
            ),
          ],
        },
      },
    },
  ],
};

export const TEXT_FRAME_MNX_JSON = JSON.stringify(TEXT_FRAME_MNX, null, 2);

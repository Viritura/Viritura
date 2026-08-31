import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";

import { normalizePartLocalStaffIndex, resolveActiveClefForStaff } from "../keyboard/noteInputShared";
import { defaultPitchForClef } from "../input/octaveLogic";

function scoreWithLaterTreblePart(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        name: "Piano",
        staves: 2,
        measures: [
          {
            sequences: [
              { staff: 1, content: [] },
              { staff: 2, content: [] },
            ],
          },
        ],
      },
      {
        name: "Violin",
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [] }],
          },
        ],
      },
    ],
  };
}

describe("note-input cursor staff normalization", () => {
  it("normalizes a global visual index to staff zero for a later single-staff part", () => {
    const score = scoreWithLaterTreblePart();

    expect(normalizePartLocalStaffIndex(score, 1, 2)).toBe(0);
  });

  it("does not misclassify a later treble part as bass clef", () => {
    const score = scoreWithLaterTreblePart();
    const clef = resolveActiveClefForStaff(score, 1, 2, 0);

    expect(clef.sign).toBe("G");
    expect(defaultPitchForClef(clef)).toEqual({ step: "B", octave: 4 });
  });

  it("preserves a valid lower grand-staff index", () => {
    const score = scoreWithLaterTreblePart();

    expect(normalizePartLocalStaffIndex(score, 0, 1)).toBe(1);
  });
});

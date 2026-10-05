import { describe, expect, it } from "vitest";
import { parseMnx, validateRawScore } from "@viritura/format";
import { transpositionPreviewScore } from "./previewScore";

describe("transposition notation preview", () => {
  it.each([
    [2, 1, "B", -1, 3],
    [14, 8, "B", -1, 2],
    [-3, -2, "E", -1, 4],
    [-12, -7, "C", 0, 5],
  ] as const)(
    "uses shared sounding notes for interval %i/%i and distinct concert/written scores",
    (halfSteps, staffDistance, step, alter, octave) => {
      const mnx = transpositionPreviewScore("brass.french-horn", {
        interval: { halfSteps, staffDistance },
        prefersWrittenPitches: true,
        keyFifthsFlipAt: -4,
      });
      expect(validateRawScore(mnx).ok).toBe(true);
      const score = parseMnx(mnx);
      expect(score.scores?.map((entry) => entry.useWritten)).toEqual([false, true]);
      expect(score.parts[0]?.transposition).toEqual({ interval: { halfSteps, staffDistance }, keyFifthsFlipAt: -4 });
      const event = score.parts[0]?.measures[0]?.sequences[0]?.content[0];
      expect(event?.type).toBe("event");
      if (event?.type !== "event") throw new Error("Expected preview note");
      expect(event.notes?.[0]?.pitch).toMatchObject({ step, alter, octave });
    },
  );
});

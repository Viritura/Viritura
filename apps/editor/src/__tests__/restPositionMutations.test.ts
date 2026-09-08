import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { setRestStaffPositionInScore } from "../score/ScoreMutations";

function scoreWithVoices(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        measures: [
          {
            sequences: [
              { content: [{ type: "event", duration: { base: "whole" }, rest: {} }] },
              { voice: "2", content: [{ type: "event", duration: { base: "whole" }, rest: {} }] },
            ],
          },
        ],
      },
    ],
  };
}

describe("setRestStaffPositionInScore", () => {
  it("updates only the targeted voice and can restore automatic placement", () => {
    const original = scoreWithVoices();
    const target = { partIndex: 0, measureIndex: 0, sequenceIndex: 1, eventIndex: 0 };

    const positioned = setRestStaffPositionInScore(original, target, 3);
    expect(positioned.parts[0]!.measures[0]!.sequences[0]!.content[0]).toEqual(expect.objectContaining({ rest: {} }));
    expect(positioned.parts[0]!.measures[0]!.sequences[1]!.content[0]).toEqual(
      expect.objectContaining({ rest: { staffPosition: 3 } }),
    );

    const automatic = setRestStaffPositionInScore(positioned, target, null);
    expect(automatic.parts[0]!.measures[0]!.sequences[1]!.content[0]).toEqual(expect.objectContaining({ rest: {} }));
  });

  it("round-trips an explicit staff position through MNX serialization", () => {
    const positioned = setRestStaffPositionInScore(
      scoreWithVoices(),
      { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 },
      -4,
    );

    const roundTripped = parseMnx(serializeMnx(positioned));
    const event = roundTripped.parts[0]!.measures[0]!.sequences[0]!.content[0];
    expect(event).toEqual(expect.objectContaining({ rest: { staffPosition: -4 } }));
  });
});

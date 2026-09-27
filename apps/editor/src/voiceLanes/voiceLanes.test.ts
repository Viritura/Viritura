import { describe, expect, it } from "vitest";
import type { Sequence } from "@viritura/core";
import { assignLanes, ensureLaneSequence, laneOfSequence, laneSequenceIndex, voiceLane } from "./index";

const seq = (extra: Partial<Sequence> = {}): Sequence => ({ content: [], ...extra });

describe("voiceLane", () => {
  it("numbers lanes Up 1, Down 1, Up 2, Down 2", () => {
    expect([1, 2, 3, 4].map((n) => voiceLane(n).label)).toEqual(["Up 1", "Down 1", "Up 2", "Down 2"]);
    expect(voiceLane(2)).toMatchObject({ direction: "down", ordinal: 1, name: "down1", hint: "lower" });
    expect(voiceLane(3)).toMatchObject({ direction: "up", ordinal: 2, name: "up2", hint: "upper" });
  });
});

describe("assignLanes", () => {
  it("keeps the legacy slot order for unnamed, unhinted voices", () => {
    expect([...assignLanes([seq(), seq()])]).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it("follows directionHint rather than array position", () => {
    const lanes = assignLanes([seq({ directionHint: "lower" }), seq({ directionHint: "upper" })]);
    expect(lanes.get(1)).toBe(1);
    expect(lanes.get(2)).toBe(0);
  });

  it("lets an editor lane name win over position and hint", () => {
    const lanes = assignLanes([seq({ voice: "down1" }), seq({ directionHint: "upper" })]);
    expect(lanes.get(2)).toBe(0);
    expect(lanes.get(1)).toBe(1);
  });

  it("places a second hinted voice of one direction in that direction's next lane", () => {
    const lanes = assignLanes([
      seq({ directionHint: "upper" }),
      seq({ directionHint: "upper" }),
      seq({ directionHint: "lower" }),
    ]);
    expect(lanes.get(1)).toBe(0);
    expect(lanes.get(3)).toBe(1);
    expect(lanes.get(2)).toBe(2);
  });

  it("maps a lone Down 1 voice to lane 2, leaving Up 1 empty", () => {
    const lanes = assignLanes([seq({ voice: "down1", directionHint: "lower" })]);
    expect(lanes.get(1)).toBeUndefined();
    expect(lanes.get(2)).toBe(0);
  });

  it("assigns lanes per staff in multi-staff parts", () => {
    const sequences = [seq({ staff: 1 }), seq({ staff: 2 }), seq({ staff: 2, directionHint: "lower" })];
    expect(laneSequenceIndex(sequences, 1, 2)).toBe(1);
    expect(laneSequenceIndex(sequences, 2, 2)).toBe(2);
    expect(laneSequenceIndex(sequences, 2, 1)).toBeUndefined();
    expect(laneOfSequence(sequences, 2)).toBe(2);
  });
});

describe("ensureLaneSequence", () => {
  it("reuses a matching sequence", () => {
    const sequences = [seq()];
    expect(ensureLaneSequence(sequences, 1)).toBe(0);
    expect(sequences).toHaveLength(1);
  });

  it("creates exactly one named, hinted sequence — never blank padding", () => {
    const sequences: Sequence[] = [];
    expect(ensureLaneSequence(sequences, 4)).toBe(0);
    expect(sequences).toEqual([{ content: [], voice: "down2", directionHint: "lower" }]);
  });

  it("stamps the staff for multi-staff parts", () => {
    const sequences = [seq({ staff: 1 })];
    expect(ensureLaneSequence(sequences, 1, 2)).toBe(1);
    expect(sequences[1]).toEqual({ content: [], voice: "up1", directionHint: "upper", staff: 2 });
  });

  it("finds a lane in the next bar even when that bar has a different voice count", () => {
    // Bar 1 has two voices; bar 2 has only the lower one. Down 1 must resolve
    // to the lower voice in both, despite sitting in different array slots.
    const bar1 = [seq({ voice: "up1", directionHint: "upper" }), seq({ voice: "down1", directionHint: "lower" })];
    const bar2 = [seq({ voice: "down1", directionHint: "lower" })];
    expect(laneSequenceIndex(bar1, 2)).toBe(1);
    expect(laneSequenceIndex(bar2, 2)).toBe(0);
  });
});

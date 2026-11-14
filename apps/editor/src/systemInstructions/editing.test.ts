import { describe, expect, it } from "vitest";
import type { Score, SystemText } from "@viritura/core";
import { instructionFromTempo, resolveInstructionSwing, saveSystemInstruction, withInstructionBpm } from "./editing";
import { systemTextToStaff } from "../score/textFrameAttachment";

const instruction: SystemText = {
  id: "instruction",
  text: [{ text: "Allegro", style: { weight: "bold", fontStyle: "italic" } }],
  position: { fraction: [1, 2] },
  placement: "below",
  frame: { border: "solid", padding: 0.5, width: { unit: "staffSpaces", value: 20 } },
  manualOffset: [2, -3],
  avoidCollisions: false,
};

describe("bounded system instruction editing", () => {
  it.each([undefined, []])("adapts a metronome-only legacy tempo with empty printed text %j", (text) => {
    const converted = instructionFromTempo({ bpm: 90, value: { base: "quarter" }, text });
    expect(converted.text).toHaveLength(1);
    expect(converted.text[0]).toMatchObject({ text: "" });
    expect(converted.tempo?.bpm).toBe(90);
  });

  it("resolves inherited swing at the instruction position without inheriting its old explicit setting", () => {
    const swing = { mode: "swing" as const, subdivision: "16th" as const, ratio: [3, 2] as [number, number] };
    const score: Score = {
      mnx: { version: 1 },
      parts: [],
      global: {
        measures: [
          {
            tempos: [{ swing }],
            systemText: [{ ...instruction, tempo: { swing: { mode: "straight" } } }],
          },
        ],
      },
    };
    expect(resolveInstructionSwing(score, 0, instruction).swing).toEqual(swing);
    expect(resolveInstructionSwing(score, 0, { ...instruction, tempo: { swing: { mode: "straight" } } }).swing).toEqual(
      { mode: "straight" },
    );
  });

  it("adds and removes BPM without losing rich text, framing, placement or offsets", () => {
    const metronomic = withInstructionBpm(instruction, 84);
    expect(metronomic.tempo).toEqual({ bpm: 84, value: { base: "quarter" } });
    expect(withInstructionBpm(metronomic, undefined)).toEqual(instruction);
    expect(instruction.tempo).toBeUndefined();
  });

  it("preserves explicit swing when removing BPM", () => {
    const swing = { mode: "swing" as const, subdivision: "eighth" as const, ratio: [2, 1] as [number, number] };
    expect(
      withInstructionBpm({ ...instruction, tempo: { bpm: 84, value: { base: "half", dots: 1 }, swing } }, undefined)
        .tempo,
    ).toEqual({ swing });
  });

  it("migrates only the selected legacy tempo and preserves all other anchors and page frames", () => {
    const legacy = {
      bpm: 84,
      value: { base: "half" as const, dots: 1 },
      text: instruction.text,
      location: instruction.position,
      manualOffset: instruction.manualOffset,
      avoidCollisions: false,
      showText: false,
    };
    const other = { bpm: 60, value: { base: "quarter" as const }, location: { fraction: [3, 4] as [number, number] } };
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ tempos: [legacy, other], systemText: [instruction] }] },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
      scores: [{ name: "Full score", textFrames: [] }],
    };
    const converted = instructionFromTempo(legacy, "converted");
    const next = saveSystemInstruction(score, 0, converted, 0);
    expect(next.global.measures[0]!.tempos).toEqual([other]);
    expect(next.global.measures[0]!.systemText).toEqual([instruction, converted]);
    expect(converted).toMatchObject({
      text: [{ text: "Allegro", style: { weight: "bold", fontStyle: "italic", size: 1.2 } }],
      position: instruction.position,
      manualOffset: instruction.manualOffset,
      avoidCollisions: false,
      showText: false,
    });
    expect(next.scores).toEqual(score.scores);
    expect(score.global.measures[0]!.tempos).toHaveLength(2);
    const edited = { ...converted, frame: instruction.frame, placement: "below" as const };
    expect(saveSystemInstruction(next, 0, edited).global.measures[0]!.systemText).toEqual([instruction, edited]);
    expect(() => systemTextToStaff(next, 0, 0, "converted")).toThrow(/playback settings/);
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid authored BPM %s", (bpm) => {
    expect(() => withInstructionBpm(instruction, bpm)).toThrow(/BPM/);
  });
});

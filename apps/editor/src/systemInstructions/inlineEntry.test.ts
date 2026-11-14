import { describe, expect, it } from "vitest";
import type { SystemText } from "@viritura/core";
import { applyInlineInstruction, inlineInstructionValue, parseInlineInstruction } from "./inlineEntry";

const instruction: SystemText = {
  id: "shared",
  text: [{ text: "Allegro", style: { weight: "bold" } }],
  position: { fraction: [1, 2] },
  placement: "below",
  frame: { border: "solid", padding: 0.5 },
  manualOffset: [2, -1],
  avoidCollisions: false,
};

describe("inline system text and tempo entry", () => {
  it.each([
    ["Freely", "Freely", undefined],
    ["Allegro", "Allegro", undefined],
    ["Allegro q=180", "Allegro", { bpm: 180, value: { base: "quarter" } }],
    ["words here (q=180)", "words here", { bpm: 180, value: { base: "quarter" } }],
    ["(q=180)", "", { bpm: 180, value: { base: "quarter" } }],
    ["words ( q. = 90.5 ) here", "words here", { bpm: 90.5, value: { base: "quarter", dots: 1 } }],
    ["q=180 words here", "words here", { bpm: 180, value: { base: "quarter" } }],
    ["words q=180 here", "words here", { bpm: 180, value: { base: "quarter" } }],
    ["words (q=180), with feeling", "words, with feeling", { bpm: 180, value: { base: "quarter" } }],
    ["words (freely q=180)", "words (freely)", { bpm: 180, value: { base: "quarter" } }],
    ["q=180", "", { bpm: 180, value: { base: "quarter" } }],
    [" q. = 90.5 ", "", { bpm: 90.5, value: { base: "quarter", dots: 1 } }],
    ["e140", "", { bpm: 140, value: { base: "eighth" } }],
    ["180", "", { bpm: 180, value: { base: "quarter" } }],
    ["64th=120", "", { bpm: 120, value: { base: "64th" } }],
  ])("interprets %s without inferring BPM from words", (input, text, tempo) => {
    expect(parseInlineInstruction(input)).toEqual({ ok: true, instruction: { text, ...(tempo ? { tempo } : {}) } });
  });

  it.each(["q=0", "q=-10", "q=NaN", "q=Infinity", "q=", "q=0x10", "q=1e9999", "words (q=0)", "(q=)", "(q=180oops)"])(
    "rejects malformed tempo syntax %s explicitly",
    (input) => {
      expect(parseInlineInstruction(input)).toMatchObject({ ok: false, error: expect.stringContaining("BPM") });
      expect(() => applyInlineInstruction(instruction, input)).toThrow(/BPM/);
    },
  );

  it("rejects ambiguous instructions containing multiple tempo markings", () => {
    expect(parseInlineInstruction("q=180 words (e=90)")).toEqual({
      ok: false,
      error: "Enter only one BPM marking per instruction.",
    });
  });

  it("adds and removes playback while retaining rich text and musical presentation", () => {
    const tempo = applyInlineInstruction(instruction, "Allegro q=180");
    expect(tempo).toEqual({ ...instruction, tempo: { bpm: 180, value: { base: "quarter" } } });
    expect(inlineInstructionValue(tempo)).toBe("Allegro q=180");
    expect(applyInlineInstruction(tempo, "Allegro")).toEqual(instruction);
    expect(
      applyInlineInstruction(
        {
          ...tempo,
          tempo: { ...tempo.tempo!, swing: { mode: "straight" } },
        },
        "Allegro",
      ),
    ).toEqual(instruction);
  });

  it("round-trips an existing less-common metronome unit without changing it", () => {
    const tempo: SystemText = { ...instruction, tempo: { bpm: 84.5, value: { base: "64th", dots: 2 } } };
    expect(applyInlineInstruction(tempo, inlineInstructionValue(tempo))).toEqual(tempo);
  });

  it.each<NonNullable<SystemText["tempo"]>>([
    { swing: { mode: "swing", subdivision: "eighth", ratio: [2, 1] } },
    { swing: { mode: "straight" } },
  ])("preserves BPM-free rhythm settings when editing their words: %j", (tempo) => {
    const original = { ...instruction, tempo };
    expect(applyInlineInstruction(original, inlineInstructionValue(original))).toEqual(original);
    expect(applyInlineInstruction(original, "Freely")).toEqual({
      ...original,
      text: [{ text: "Freely" }],
    });
  });
});

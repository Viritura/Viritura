import { describe, expect, it } from "vitest";
import type { NoteEvent, Score, SequenceContent, Space, Tuplet } from "@viritura/core";
import { serializeMnx, validateRawScore } from "@viritura/format";
import { applyPaste } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";
import { ensureSequencePosition, splitSequenceAtBeat } from "./clipboardTrackPlacement";

function destination(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ measures: [{ sequences: [{ staff: 1, content: [{ type: "space", duration: [1, 1] }] }] }] }],
  };
}

const quarter: NoteEvent = {
  type: "event",
  id: "pasted-quarter",
  duration: { base: "quarter" },
  notes: [{ id: "pasted-note", pitch: { step: "C", octave: 4 } }],
};

const offsets: { leadIn: Space["duration"]; remainder: Space["duration"] }[] = [
  { leadIn: [1, 12], remainder: [2, 3] },
  { leadIn: [5, 24], remainder: [13, 24] },
  { leadIn: [7, 64], remainder: [41, 64] },
  { leadIn: [1, 28], remainder: [5, 7] },
  { leadIn: [1, 4096], remainder: [3071, 4096] },
];

describe("exact clipboard track positions", () => {
  it.each(offsets)("pastes inside a whole-note space at exact leadIn $leadIn", ({ leadIn, remainder }) => {
    const score = destination();
    const paste = {
      content: [quarter],
      tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, leadIn, content: [quarter] }],
    };
    const snapshot = structuredClone({ score, paste });
    const placed: SequenceContent[] = [];
    const result = applyPaste(score, paste, 0, 0, 0, 0, placed);
    const sequence = result.parts[0]!.measures[0]!.sequences[0]!;

    expect(result.parts[0]!.measures).toHaveLength(1);
    expect(sequence.content).toEqual([
      { type: "space", duration: leadIn },
      quarter,
      { type: "space", duration: remainder },
    ]);
    expect(sequenceContentBeats(sequence.content[0]!)).toBe((leadIn[0] / leadIn[1]) * 4);
    expect(sequence.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBeCloseTo(4, 14);
    expect(placed).toEqual([quarter]);
    expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
    expect({ score, paste }).toEqual(snapshot);
  });

  it.each(offsets)("pads a new voice to exact leadIn $leadIn", ({ leadIn }) => {
    const score = destination();
    const result = applyPaste(
      score,
      {
        content: [quarter],
        tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 1, leadIn, content: [quarter] }],
      },
      0,
      0,
      0,
      0,
    );

    expect(result.parts[0]!.measures).toHaveLength(1);
    expect(result.parts[0]!.measures[0]!.sequences[1]!.content).toEqual([{ type: "space", duration: leadIn }, quarter]);
    expect(result.parts[0]!.measures[0]!.sequences[0]).toEqual(score.parts[0]!.measures[0]!.sequences[0]);
    expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
  });

  it("preserves exact split fractions after an existing event", () => {
    const content: SequenceContent[] = [quarter, { type: "space", duration: [3, 4] }];
    splitSequenceAtBeat(content, 1 + 1 / 3);
    expect(content).toEqual([quarter, { type: "space", duration: [1, 12] }, { type: "space", duration: [2, 3] }]);
  });

  it("pads by the exact difference from existing content without changing existing boundaries", () => {
    const content: SequenceContent[] = [quarter];
    ensureSequencePosition(content, 1 + 1 / 3);
    expect(content).toEqual([quarter, { type: "space", duration: [1, 12] }]);
    const snapshot = structuredClone(content);
    ensureSequencePosition(content, 1 + 1 / 3);
    splitSequenceAtBeat(content, 1);
    expect(content).toEqual(snapshot);
  });

  it.each(["space", "rest", "padding"] as const)(
    "permits accumulated floating-point error when calculating an exact %s boundary",
    (kind) => {
      const content: SequenceContent[] = Array.from({ length: 42 }, () => ({ type: "space", duration: [1, 60] }));
      if (kind === "space") content.push({ type: "space", duration: [3, 10] });
      if (kind === "rest") content.push({ type: "event", duration: { base: "quarter" }, rest: {} });
      const prefix = structuredClone(content.slice(0, 42));
      const target = (117 / 160) * 4;
      if (kind === "padding") ensureSequencePosition(content, target);
      else splitSequenceAtBeat(content, target);

      expect(content.slice(0, 42)).toEqual(prefix);
      expect(sequenceContentBeats(content[42]!)).toBe(1 / 8);
      if (kind === "space") expect(content[43]).toEqual({ type: "space", duration: [43, 160] });
      if (kind === "padding") expect(content).toHaveLength(43);
    },
  );

  it("places at an exact offset after many fractional spaces without rejecting accumulated roundoff", () => {
    const score = destination();
    const prefix: SequenceContent[] = Array.from({ length: 42 }, () => ({ type: "space", duration: [1, 60] }));
    score.parts[0]!.measures[0]!.sequences[0]!.content = [...prefix, { type: "space", duration: [3, 10] }];
    const result = applyPaste(
      score,
      {
        content: [quarter],
        tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, leadIn: [117, 160], content: [quarter] }],
      },
      0,
      0,
      0,
      0,
    );
    expect(result.parts[0]!.measures).toHaveLength(1);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content).toEqual([
      ...prefix,
      { type: "space", duration: [1, 32] },
      quarter,
      { type: "space", duration: [3, 160] },
    ]);
    expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
  });

  it.each([4 / 4097, Math.SQRT2, 1 / 3 + 1e-10])(
    "rejects a space split or padding that cannot be represented exactly (%s beats)",
    (beat) => {
      const space: SequenceContent[] = [{ type: "space", duration: [1, 1] }];
      const snapshot = structuredClone(space);
      const empty: SequenceContent[] = [];
      expect(() => splitSequenceAtBeat(space, beat)).toThrow(/exact/i);
      expect(space).toEqual(snapshot);
      expect(() => ensureSequencePosition(empty, beat)).toThrow(/exact/i);
      expect(empty).toEqual([]);
    },
  );

  it("rejects unrepresentable physical lead-in placement without mutating the score", () => {
    const score = destination();
    const snapshot = structuredClone(score);
    expect(() =>
      applyPaste(
        score,
        {
          content: [quarter],
          tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, leadIn: [1, 4097], content: [quarter] }],
        },
        0,
        0,
        0,
        0,
      ),
    ).toThrow(/exact/i);
    expect(score).toEqual(snapshot);
  });

  it("rejects a rest split that would require invented tuplets rather than quantizing it", () => {
    const content: SequenceContent[] = [{ type: "event", id: "rest", duration: { base: "whole" }, rest: {} }];
    const snapshot = structuredClone(content);
    expect(() => splitSequenceAtBeat(content, 1 / 3)).toThrow(/exact/i);
    expect(content).toEqual(snapshot);
  });

  it("still splits rests at exactly representable rhythmic boundaries", () => {
    const content: SequenceContent[] = [{ type: "event", id: "rest", duration: { base: "whole" }, rest: {} }];
    splitSequenceAtBeat(content, 1.5);
    expect(content.map(sequenceContentBeats)).toEqual([1.5, 2, 0.5]);
    expect(content.every((item) => item.type === "event" && item.rest)).toBe(true);
  });

  it("does not flatten a tuplet to create a destination boundary", () => {
    const tuplet: Tuplet = {
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "quarter" } },
      outer: { multiple: 2, duration: { base: "quarter" } },
      content: [quarter, { ...quarter, id: "second" }, { ...quarter, id: "third" }],
    };
    const content: SequenceContent[] = [tuplet];
    const snapshot = structuredClone(content);
    expect(() => splitSequenceAtBeat(content, 1 / 3)).toThrow(/rhythmic boundary/);
    expect(content).toEqual(snapshot);
  });
});

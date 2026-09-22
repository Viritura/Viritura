import { describe, expect, it } from "vitest";
import type { NoteEvent, Score, SequenceContent, Space, Tuplet } from "@viritura/core";
import { serializeMnx, validateRawScore } from "@viritura/format";
import { applyPaste, pasteResultFromFragment } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";
import {
  addWholeFractions,
  contentWholeFraction,
  ensureSequencePosition,
  exactWholeFraction,
  splitSequenceAtBeat,
} from "./clipboardTrackPlacement";
import type { CapturedChordSymbol, ClipboardTrack } from "./ClipboardFragment";
import { deserializeFragment } from "./deserialize";
import { serializeFragment } from "./serialize";

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

function nativePaste(tracks: ClipboardTrack[], chordSymbols?: CapturedChordSymbol[]) {
  const fragment = deserializeFragment(
    serializeFragment(
      tracks[0]?.content ?? [],
      { count: 4, unit: 4 },
      { fifths: 0 },
      tracks,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      chordSymbols,
    ),
  );
  expect(fragment).not.toBeNull();
  return pasteResultFromFragment(fragment!);
}

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

  it.each([
    { leadIn: [1, 8192], remainder: [8191, 8192] },
    { leadIn: [1, 4097], remainder: [4096, 4097] },
    { leadIn: [1, 68719476736], remainder: [68719476735, 68719476736] },
  ] satisfies { leadIn: Space["duration"]; remainder: Space["duration"] }[])(
    "preserves fine leading offsets $leadIn in both spaces and empty voices",
    ({ leadIn, remainder }) => {
      const beat = (leadIn[0] / leadIn[1]) * 4;
      const content: SequenceContent[] = [{ type: "space", duration: [1, 1] }];
      splitSequenceAtBeat(content, beat);
      expect(content).toEqual([
        { type: "space", duration: leadIn },
        { type: "space", duration: remainder },
      ]);
      const empty: SequenceContent[] = [];
      ensureSequencePosition(empty, beat);
      expect(empty).toEqual([{ type: "space", duration: leadIn }]);
    },
  );

  it.each([Math.SQRT2, 1 / 3 + 1e-10])("round-trips numeric offsets without snapping to a nearby grid (%s)", (beat) => {
    const content: SequenceContent[] = [];
    ensureSequencePosition(content, beat);
    expect(sequenceContentBeats(content[0]!)).toBe(beat);
    expect(content[0]).not.toEqual({ type: "space", duration: [1, 12] });
  });

  it.each([Number.MIN_VALUE, 4 / 2 ** 54, Infinity, NaN, -1])(
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
          tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, leadIn: [1, 2 ** 54], content: [quarter] }],
        },
        0,
        0,
        0,
        0,
      ),
    ).toThrow(/exact/i);
    expect(score).toEqual(snapshot);
  });

  it.each([
    [1, 8192],
    [1, 4097],
  ] satisfies Space["duration"][])(
    "pads a physical voice with a fine whole-note offset %s/%s",
    (numerator, denominator) => {
      const score = destination();
      const leadIn: Space["duration"] = [numerator, denominator];
      const result = applyPaste(
        score,
        { content: [quarter], tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 1, leadIn, content: [quarter] }] },
        0,
        0,
        0,
        0,
      );
      expect(result.parts[0]!.measures[0]!.sequences[1]!.content).toEqual([
        { type: "space", duration: leadIn },
        quarter,
      ]);
      expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
    },
  );

  it("does not reconstruct tiny positive timing as a zero-length fraction", () => {
    expect(exactWholeFraction(4 / 68719476736)).toEqual([1, 68719476736]);
  });

  it("uses a safe intermediate fraction when the next convergent exceeds the safe integer range", () => {
    const beat = 3.9999999999999996;
    const fraction = exactWholeFraction(beat);
    expect(fraction.every(Number.isSafeInteger)).toBe(true);
    expect((fraction[0] / fraction[1]) * 4).toBe(beat);
    const content: SequenceContent[] = [];
    ensureSequencePosition(content, beat);
    expect(sequenceContentBeats(content[0]!)).toBe(beat);
  });

  it.each([
    { count: 6, duration: [1, 12] },
    { count: 42, duration: [1, 60] },
  ] satisfies { count: number; duration: Space["duration"] }[])(
    "recovers the stored endpoint after $count spaces rather than inventing a roundoff gap",
    ({ count, duration }) => {
      const content: SequenceContent[] = Array.from({ length: count }, () => ({ type: "space", duration }));
      const targetBeat = content.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
      const snapshot = structuredClone(content);
      ensureSequencePosition(content, targetBeat);
      splitSequenceAtBeat(content, targetBeat);
      expect(content).toEqual(snapshot);
    },
  );

  it("pastes a physical track at an accumulated endpoint without treating roundoff as notation", () => {
    const score = destination();
    const prefix: SequenceContent[] = Array.from({ length: 6 }, () => ({ type: "space", duration: [1, 12] }));
    score.parts[0]!.measures[0]!.sequences[0]!.content = prefix;
    const result = applyPaste(
      score,
      { content: [quarter], tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [quarter] }] },
      0,
      0,
      0,
      prefix.length,
    );
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content).toEqual([...prefix, quarter]);
  });

  it.each(["rest", "space", "empty"] as const)(
    "carries a native two-staff onset from six fractional spaces into a secondary %s",
    (kind) => {
      const score = destination();
      const part = score.parts[0]!;
      part.staves = 2;
      const prefix: SequenceContent[] = Array.from({ length: 6 }, () => ({ type: "space", duration: [1, 12] }));
      part.measures[0]!.sequences[0]!.content = [...prefix, { type: "space", duration: [1, 2] }];
      const secondary: SequenceContent[] =
        kind === "rest"
          ? [{ type: "event", duration: { base: "whole" }, rest: {} }]
          : kind === "space"
            ? [{ type: "space", duration: [1, 1] }]
            : [];
      part.measures[0]!.sequences.push({ staff: 2, content: secondary });
      const paste = nativePaste([
        { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [quarter] },
        {
          partOffset: 0,
          staffOffset: 1,
          voiceIndex: 0,
          content: [
            { ...quarter, id: "lower-quarter", notes: [{ id: "lower-note", pitch: { step: "C", octave: 3 } }] },
          ],
        },
      ]);
      const snapshot = structuredClone({ score, paste });
      const accumulatedBeat = prefix.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
      expect(accumulatedBeat).toBe(1.9999999999999998);
      expect(validateRawScore(serializeMnx(score))).toMatchObject({ ok: true });

      for (const startBeat of [undefined, accumulatedBeat]) {
        const placed: SequenceContent[] = [];
        const result = applyPaste(score, paste, 0, 0, 0, prefix.length, placed, startBeat);
        const sequences = result.parts[0]!.measures[0]!.sequences;
        expect(sequences[0]!.content.slice(0, prefix.length)).toEqual(prefix);
        for (const [index, sequence] of sequences.entries()) {
          const pasted = paste.tracks![index]!.content[0]!;
          const eventIndex = sequence.content.findIndex(
            (item) => item.type === "event" && item.id === (pasted as NoteEvent).id,
          );
          expect(eventIndex).toBeGreaterThan(0);
          expect(
            sequence.content
              .slice(0, eventIndex)
              .reduce<Space["duration"]>((sum, item) => addWholeFractions(sum, contentWholeFraction(item)), [0, 1]),
          ).toEqual([1, 2]);
          expect(sequence.content[eventIndex]).toEqual(pasted);
        }
        if (kind === "rest") expect(sequences[1]!.content[0]).toMatchObject({ duration: { base: "half" }, rest: {} });
        else expect(sequences[1]!.content[0]).toEqual({ type: "space", duration: [1, 2] });
        expect(placed).toEqual(paste.tracks!.flatMap((track) => track.content));
        expect(result.parts[0]!.measures).toHaveLength(1);
        expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
        expect({ score, paste }).toEqual(snapshot);
      }
    },
  );

  it.each([
    { leadIn: [1, 12], measureIndex: 0, onset: [7, 12] },
    { leadIn: [1, 2], measureIndex: 1, onset: [0, 1] },
    { leadIn: [2, 3], measureIndex: 1, onset: [1, 6] },
    { leadIn: [4, 3], measureIndex: 2, onset: [1, 12] },
  ] satisfies { leadIn: Space["duration"]; measureIndex: number; onset: Space["duration"] }[])(
    "composes native leadIn $leadIn with the exact prefix through changing barlines",
    ({ leadIn, measureIndex, onset }) => {
      const score = destination();
      score.global.measures.push({ time: { count: 3, unit: 4 } }, { time: { count: 4, unit: 4 } });
      const part = score.parts[0]!;
      part.staves = 2;
      const prefix: SequenceContent[] = Array.from({ length: 6 }, () => ({ type: "space", duration: [1, 12] }));
      part.measures[0]!.sequences[0]!.content = [...prefix, { type: "space", duration: [1, 2] }];
      part.measures.push(
        { sequences: [{ staff: 1, content: [{ type: "space", duration: [3, 4] }] }] },
        { sequences: [{ staff: 1, content: [{ type: "space", duration: [1, 1] }] }] },
      );
      const paste = nativePaste([{ partOffset: 0, staffOffset: 1, voiceIndex: 0, leadIn, content: [quarter] }]);
      const snapshot = structuredClone({ score, paste });
      const result = applyPaste(score, paste, 0, 0, 0, prefix.length);
      const content = result.parts[0]!.measures[measureIndex]!.sequences.find(
        (sequence) => sequence.staff === 2,
      )!.content;
      expect(content).toEqual([...(onset[0] === 0 ? [] : [{ type: "space", duration: onset }]), ...paste.content]);
      expect(result.parts[0]!.measures).toHaveLength(3);
      for (const [index, measure] of result.parts[0]!.measures.entries()) {
        expect(measure.sequences[0]).toEqual(part.measures[index]!.sequences[0]);
      }
      expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
      expect({ score, paste }).toEqual(snapshot);
    },
  );

  it.each([
    [1, 8192],
    [1, 4097],
    [1, 68719476736],
  ] satisfies Space["duration"][])("does not round native chord-symbol offset %s/%s", (numerator, denominator) => {
    const offset: Space["duration"] = [numerator, denominator];
    const paste = nativePaste(
      [],
      [
        {
          measureOffset: 0,
          offset,
          chordSymbol: { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
        },
      ],
    );
    const score = destination();
    const snapshot = structuredClone({ score, paste });
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    expect(result.global.measures[0]!.chordSymbols![0]!.position.fraction).toEqual(offset);
    expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
    expect({ score, paste }).toEqual(snapshot);
  });

  it("keeps a tiny native lead-in when choosing the exact insertion boundary", () => {
    const score = destination();
    const leadIn: Space["duration"] = [1, 68719476736];
    const paste = nativePaste([{ partOffset: 0, staffOffset: 0, voiceIndex: 0, leadIn, content: [quarter] }]);
    const snapshot = structuredClone({ score, paste });
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content).toEqual([
      { type: "space", duration: leadIn },
      ...paste.content,
      { type: "space", duration: [51539607551, 68719476736] },
    ]);
    expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
    expect({ score, paste }).toEqual(snapshot);
  });

  it.each([
    { offset: [1, 3], legacy: false, measureIndex: 0 },
    { offset: [1, 3], legacy: true, measureIndex: 0 },
    { offset: [4, 3], legacy: false, measureIndex: 1 },
  ] satisfies { offset: Space["duration"]; legacy: boolean; measureIndex: number }[])(
    "composes native chord offset $offset with a fractional prefix (legacy: $legacy)",
    ({ offset, legacy, measureIndex }) => {
      const score = destination();
      score.parts[0]!.measures[0]!.sequences[0]!.content = [
        { type: "space", duration: [1, 12] },
        { type: "space", duration: [11, 12] },
      ];
      score.global.measures.push({});
      score.parts[0]!.measures.push({ sequences: [{ content: [{ type: "space", duration: [1, 1] }] }] });
      const paste = nativePaste(
        [],
        [
          {
            measureOffset: 0,
            ...(legacy ? {} : { offset }),
            chordSymbol: { position: { fraction: legacy ? offset : [0, 1] }, root: { step: "C" }, quality: "major" },
          },
        ],
      );
      const snapshot = structuredClone({ score, paste });
      const result = applyPaste(score, paste, 0, 0, 0, 1);
      expect(result.global.measures[measureIndex]!.chordSymbols![0]!.position.fraction).toEqual([5, 12]);
      expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
      expect({ score, paste }).toEqual(snapshot);
    },
  );

  it("rejects a positive duration absorbed by numeric accumulation", () => {
    const content: SequenceContent[] = [
      { type: "space", duration: [2, 1] },
      { type: "space", duration: [1, Number.MAX_SAFE_INTEGER] },
    ];
    const snapshot = structuredClone(content);
    const targetBeat = content.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
    expect(targetBeat).toBe(8);
    expect(() => splitSequenceAtBeat(content, targetBeat)).toThrow(/exact/i);
    expect(content).toEqual(snapshot);
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

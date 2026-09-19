import { describe, expect, it } from "vitest";
import type { Score, SequenceContent, Space, TimeSignature, Tuplet } from "@viritura/core";
import { serializeMnx, validateRawScore } from "@viritura/format";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import { applyPaste } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";
import { planPasteFragments } from "../clipboard/pasteContent/rhythmicFragments";

const time: TimeSignature = { count: 4, unit: 4 };
const key = { fifths: 0 };

function score(times: TimeSignature[] = [time]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: times.map((time) => ({ time })) },
    parts: [{ measures: times.map(() => ({ sequences: [{ content: [] }] })) }],
  };
}

function tuplet(content: SequenceContent[]): Tuplet {
  return {
    type: "tuplet",
    inner: { multiple: 3, duration: { base: "quarter" } },
    outer: { multiple: 2, duration: { base: "quarter" } },
    content,
  };
}

describe("clipboard space fraction validation", () => {
  it.each<{ duration: Space["duration"] }>([
    { duration: [0, 1] },
    { duration: [1, 8] },
    { duration: [7, 8] },
    { duration: [10, 4] },
    { duration: [1, 3] },
  ])("round-trips the whole-note fraction $duration without normalization", ({ duration }) => {
    const content: SequenceContent[] = [{ type: "space", duration }];
    const fragment = deserializeFragment(serializeFragment(content, time, key));
    expect(fragment?.content).toEqual(content);
  });

  it.each([
    { duration: { base: "quarter" } },
    { duration: null },
    { duration: undefined },
    { duration: "1/4" },
    { duration: [] },
    { duration: [1] },
    { duration: [1, 4, 2] },
    { duration: [3.5, 4] },
    { duration: [1, 2.5] },
    { duration: [-1, 4] },
    { duration: [1, -4] },
    { duration: [1, 0] },
    { duration: ["1", 4] },
    { duration: [1, "4"] },
    { duration: [Infinity, 4] },
    { duration: [1, NaN] },
  ])("rejects an invalid space duration $duration", ({ duration }) => {
    const envelope: unknown = JSON.parse(serializeFragment([], time, key));
    const json = JSON.stringify({ ...(envelope as object), content: [{ type: "space", duration }] });
    expect(deserializeFragment(json)).toBeNull();
  });

  it("preserves spaces inside nested tuplets without flattening the containers", () => {
    const content: SequenceContent[] = [tuplet([tuplet([{ type: "space", duration: [1, 8] }])])];
    expect(deserializeFragment(serializeFragment(content, time, key))?.content).toEqual(content);
  });

  it("round-trips whole-measure capture with explicit spaces and captured padding", () => {
    const source = score([time, time]);
    source.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "event", id: "first", duration: { base: "eighth" }, rest: {} },
      { type: "space", duration: [7, 8] },
    ];
    source.parts[0]!.measures[1]!.sequences[0]!.content = [
      { type: "event", id: "last", duration: { base: "quarter" }, rest: {} },
    ];
    const snapshot = structuredClone(source);
    const selection = buildClipboardSelection(source, {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startMeasure: 0,
      endMeasure: 1,
    })!;
    const capturedSpaces = selection.events.filter((item) => item.type === "space");
    expect(capturedSpaces[0]).toEqual({ type: "space", duration: [7, 8] });
    expect(capturedSpaces.map(sequenceContentBeats)).toEqual([3.5, 3]);

    const fragment = deserializeFragment(
      serializeFragment(selection.events, selection.timeSignature, selection.keySignature, selection.tracks),
    );
    expect(fragment).not.toBeNull();
    expect(fragment!.content).toEqual(selection.events);
    expect(fragment!.tracks).toEqual(selection.tracks);
    expect(source).toEqual(snapshot);
  });
});

describe("clipboard split spaces remain valid MNX fractions", () => {
  it.each([
    { duration: [2049, 8192], remainder: [1, 8192] },
    { duration: [2049, 8193], remainder: [1, 10924] },
    { duration: [17179869185, 68719476736], remainder: [1, 68719476736] },
  ] satisfies { duration: Space["duration"]; remainder: Space["duration"] }[])(
    "retains the exact destination space remainder $remainder through consecutive pastes",
    ({ duration, remainder }) => {
      const destination = score();
      const following: SequenceContent = {
        type: "event",
        id: "following",
        duration: { base: "eighth" },
        notes: [{ pitch: { step: "D", octave: 4 } }],
      };
      destination.parts[0]!.measures[0]!.sequences[0]!.content = [{ type: "space", duration }, following];
      const content: SequenceContent[] = [
        {
          type: "event",
          id: "pasted",
          duration: { base: "quarter" },
          notes: [{ pitch: { step: "C", octave: 4 } }],
        },
      ];
      const snapshot = structuredClone({ destination, content });
      const result = applyPaste(destination, { content }, 0, 0, 0, 0);
      const expected = [...content, { type: "space", duration: remainder }, following];
      expect(result.parts[0]!.measures[0]!.sequences[0]!.content).toEqual(expected);
      expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
      expect({ destination, content }).toEqual(snapshot);

      const replacement: SequenceContent = {
        type: "event",
        id: "replacement",
        duration: { base: "eighth" },
        rest: {},
      };
      const next = applyPaste(result, { content: [replacement] }, 0, 0, 0, 2);
      expect(next.parts[0]!.measures[0]!.sequences[0]!.content).toEqual([
        ...content,
        { type: "space", duration: remainder },
        replacement,
      ]);
      expect(result.parts[0]!.measures[0]!.sequences[0]!.content).toEqual(expected);
      expect(validateRawScore(serializeMnx(next))).toMatchObject({ ok: true });
    },
  );

  it("clears a positive pasted interval smaller than the old boundary epsilon", () => {
    const destination = score();
    destination.parts[0]!.measures[0]!.sequences[0]!.content = [{ type: "space", duration: [1, 4] }];
    const content: SequenceContent[] = [{ type: "space", duration: [1, 68719476736] }];
    const snapshot = structuredClone({ destination, content });
    const result = applyPaste(destination, { content }, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content).toEqual([
      ...content,
      { type: "space", duration: [17179869183, 68719476736] },
    ]);
    expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
    expect({ destination, content }).toEqual(snapshot);
  });

  it.each(["note", "rest"] as const)(
    "rejects unsupported exact %s remainders without changing either input",
    (kind) => {
      for (const duration of [
        [1, 12],
        [2047, 8192],
        [17179869183, 68719476736],
      ] satisfies Space["duration"][]) {
        const destination = score();
        destination.parts[0]!.measures[0]!.sequences[0]!.content = [
          {
            type: "event",
            id: "untouched",
            duration: { base: "quarter" },
            ...(kind === "rest" ? { rest: {} } : { notes: [{ pitch: { step: "C" as const, octave: 4 } }] }),
          },
        ];
        const content: SequenceContent[] = [{ type: "space", duration }];
        const snapshot = structuredClone({ destination, content });
        expect(() => applyPaste(destination, { content }, 0, 0, 0, 0)).toThrow(/exact/i);
        expect({ destination, content }).toEqual(snapshot);
      }
    },
  );

  it.each([false, true])("uses the actual destination prefix through applyPaste with reversed parts: %s", (reverse) => {
    const destination = score([time, time]);
    destination.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "space", duration: [4503599627370495, 9007199254740991] },
    ];
    const prefix: SequenceContent[] = Array.from({ length: 6 }, () => ({ type: "space", duration: [1, 12] }));
    destination.parts.push({
      measures: [
        { sequences: [{ content: [...prefix, { type: "space", duration: [1, 2] }] }] },
        { sequences: [{ content: [] }] },
      ],
    });
    if (reverse) destination.parts.reverse();
    const partIndex = reverse ? 0 : 1;
    const content: SequenceContent[] = [{ type: "event", id: "pasted", duration: { base: "whole" }, rest: {} }];
    const snapshot = structuredClone({ destination, content });
    const result = applyPaste(destination, { content }, partIndex, 0, 0, prefix.length);
    const measures = result.parts[partIndex]!.measures;
    expect(measures[0]!.sequences[0]!.content).toEqual([
      ...prefix,
      { type: "event", id: "pasted", duration: { base: "half" }, rest: {} },
    ]);
    expect(measures[1]!.sequences[0]!.content).toEqual([
      { type: "event", id: expect.any(String), duration: { base: "half" }, rest: {} },
    ]);
    expect(result.parts[1 - partIndex]).toEqual(destination.parts[1 - partIndex]);
    expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
    expect({ destination, content }).toEqual(snapshot);
  });

  it.each([
    { duration: [2049, 8192], remainder: [1, 8192] },
    { duration: [2049, 8193], remainder: [1, 10924] },
    { duration: [17179869185, 68719476736], remainder: [1, 68719476736] },
  ] satisfies { duration: Space["duration"]; remainder: Space["duration"] }[])(
    "preserves the exact positive remainder of $duration after beat three",
    ({ duration, remainder }) => {
      const destination = score([time, time]);
      destination.parts[0]!.measures[0]!.sequences[0]!.content = [{ type: "space", duration: [3, 4] }];
      const following: SequenceContent = { type: "event", id: "following", duration: { base: "quarter" }, rest: {} };
      const content: SequenceContent[] = [{ type: "space", duration }, following];
      const snapshot = structuredClone({ destination, content });
      const result = applyPaste(destination, { content }, 0, 0, 0, 1);
      const measures = result.parts[0]!.measures;

      expect(measures[0]!.sequences[0]!.content).toEqual([
        { type: "space", duration: [3, 4] },
        { type: "space", duration: [1, 4] },
      ]);
      expect(measures[1]!.sequences[0]!.content).toEqual([{ type: "space", duration: remainder }, following]);
      expect(BigInt(duration[0]) * 4n * BigInt(remainder[1])).toBe(
        BigInt(duration[1]) * (BigInt(remainder[1]) + 4n * BigInt(remainder[0])),
      );
      expect(sequenceContentBeats(measures[1]!.sequences[0]!.content[0]!)).toBeGreaterThan(0);
      expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
      expect({ destination, content }).toEqual(snapshot);
    },
  );

  it("keeps repeated non-binary spaces on their exact barlines without cumulative drift", () => {
    const content: SequenceContent[] = Array.from({ length: 8193 }, () => ({ type: "space", duration: [1, 8193] }));
    const following: SequenceContent = { type: "event", duration: { base: "quarter" }, rest: {} };
    content.push(following);
    const fragments = planPasteFragments(score(), 0, 0, content);
    expect(fragments).toHaveLength(2);
    expect(fragments[0]).toMatchObject({ measureIndex: 0, beat: 0, beats: 4 });
    expect(fragments[0]!.content).toEqual(content.slice(0, -1));
    expect(fragments[1]).toEqual({ measureIndex: 1, beat: 0, beats: 1, content: [following] });
  });

  it("does not move a tiny positive available interval to the next measure", () => {
    const destination = score([time, time]);
    const content: SequenceContent[] = [{ type: "space", duration: [1, 1] }];
    const fragments = planPasteFragments(destination, 0, 4 - 4 / 68719476736, content);
    expect(fragments.map((fragment) => fragment.content)).toEqual([
      [{ type: "space", duration: [1, 68719476736] }],
      [{ type: "space", duration: [68719476735, 68719476736] }],
    ]);
  });

  it("uses the destination prefix rather than a different voice with an indistinguishable numeric onset", () => {
    const destination = score([time, time]);
    destination.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "space", duration: [4503599627370495, 9007199254740991] },
    ];
    const prefix: SequenceContent[] = Array.from({ length: 6 }, () => ({ type: "space", duration: [1, 12] }));
    destination.parts.push({ measures: [{ sequences: [{ content: prefix }] }] });
    const beat = prefix.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
    const content: SequenceContent[] = [{ type: "event", duration: { base: "whole" }, rest: {} }];
    const fragments = planPasteFragments(destination, 0, beat, content, prefix);
    expect(fragments.map(({ measureIndex, beat, beats }) => ({ measureIndex, beat, beats }))).toEqual([
      { measureIndex: 0, beat: 2, beats: 2 },
      { measureIndex: 1, beat: 0, beats: 2 },
    ]);
    for (const fragment of fragments) {
      expect(fragment.content[0]).toMatchObject({ type: "event", duration: { base: "half" }, rest: {} });
    }
    expect(() => planPasteFragments(destination, 0, beat, content)).toThrow(/exact.*destination prefix/i);
    destination.parts.reverse();
    expect(() => planPasteFragments(destination, 0, beat, content)).toThrow(/exact.*destination prefix/i);
  });

  it("rejects a split whose reduced fraction exceeds safe integers without mutating the destination", () => {
    const destination = score([time, time]);
    destination.parts[0]!.measures[0]!.sequences[0]!.content = [{ type: "space", duration: [3, 4] }];
    const content: SequenceContent[] = [
      { type: "space", duration: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 2] },
    ];
    const snapshot = structuredClone({ destination, content });
    expect(() => applyPaste(destination, { content }, 0, 0, 0, 1)).toThrow(/exact/i);
    expect({ destination, content }).toEqual(snapshot);
  });

  it.each([
    {
      times: [time, time],
      prefix: [1, 8],
      expected: [
        [7, 8],
        [1, 8],
      ],
    },
    {
      times: [{ count: 5, unit: 8 }, time],
      prefix: [1, 16],
      expected: [
        [9, 16],
        [7, 16],
      ],
    },
    {
      times: [time, time],
      prefix: [1, 12],
      expected: [
        [11, 12],
        [1, 12],
      ],
    },
  ] satisfies { times: TimeSignature[]; prefix: Space["duration"]; expected: Space["duration"][] }[])(
    "preserves exact timing and schema validity with prefix $prefix and meters $times",
    ({ times, prefix, expected }) => {
      const destination = score(times);
      destination.parts[0]!.measures[0]!.sequences[0]!.content = [{ type: "space", duration: prefix }];
      const snapshot = structuredClone(destination);
      const content: SequenceContent[] = [{ type: "space", duration: [1, 1] }];
      const result = applyPaste(destination, { content }, 0, 0, 0, 1);
      const spaces = result.parts[0]!.measures.flatMap((measure, index) =>
        measure.sequences[0]!.content.slice(index === 0 ? 1 : 0),
      );

      expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
      expect(spaces).toEqual(expected.map((duration) => ({ type: "space", duration })));
      expect(spaces.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBeCloseTo(4, 12);
      expect(deserializeFragment(serializeFragment(spaces, time, key))?.content).toEqual(spaces);
      expect(destination).toEqual(snapshot);
      expect(content).toEqual([{ type: "space", duration: [1, 1] }]);
    },
  );

  it("splits a space through changing meters while leaving a following tuplet intact", () => {
    const destination = score([time, { count: 5, unit: 8 }, time]);
    destination.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "event", duration: { base: "eighth" }, rest: {} },
    ];
    const container = tuplet([
      { type: "event", duration: { base: "quarter" }, rest: {} },
      { type: "event", duration: { base: "quarter" }, rest: {} },
      { type: "event", duration: { base: "quarter" }, rest: {} },
    ]);
    const result = applyPaste(
      destination,
      {
        content: [{ type: "space", duration: [2, 1] }, container],
      },
      0,
      0,
      0,
      1,
    );

    expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
    expect(
      result.parts[0]!.measures.map((measure) => measure.sequences[0]!.content.filter((item) => item.type === "space")),
    ).toEqual([
      [{ type: "space", duration: [7, 8] }],
      [{ type: "space", duration: [5, 8] }],
      [{ type: "space", duration: [1, 2] }],
    ]);
    expect(result.parts[0]!.measures[2]!.sequences[0]!.content[1]).toEqual(container);
  });

  it("preserves an exact space remainder when a fractional continuation overwrites an occupied bar", () => {
    const destination = score([time, time]);
    destination.parts[0]!.measures[0]!.sequences[0]!.content = [{ type: "space", duration: [1, 12] }];
    destination.parts[0]!.measures[1]!.sequences[0]!.content = [{ type: "space", duration: [1, 1] }];
    const result = applyPaste(destination, { content: [{ type: "space", duration: [1, 1] }] }, 0, 0, 0, 1);
    const following = result.parts[0]!.measures[1]!.sequences[0]!.content;
    expect(following).toEqual([
      { type: "space", duration: [1, 12] },
      { type: "space", duration: [11, 12] },
    ]);
    expect(following.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(4);
    expect(validateRawScore(serializeMnx(result))).toMatchObject({ ok: true });
    expect(() => applyPaste(result, { content: [{ type: "space", duration: [1, 4] }] }, 0, 1, 0, 2)).not.toThrow();
  });
});

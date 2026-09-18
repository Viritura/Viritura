import { describe, expect, it } from "vitest";
import type { Score, SequenceContent, Space, TimeSignature, Tuplet } from "@viritura/core";
import { serializeMnx, validateRawScore } from "@viritura/format";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import { applyPaste } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";

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

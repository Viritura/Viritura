import { afterEach, describe, expect, it, vi } from "vitest";
import {
  walkSequenceEvents,
  type NoteEvent,
  type Score,
  type SequenceContent,
  type Space,
  type Tuplet,
} from "@viritura/core";
import { serializeMnx, validateRawScore } from "@viritura/format";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { contentWholeFraction, sequenceBoundaryFraction } from "../clipboard/clipboardTrackPlacement";
import { computePasteResult } from "../clipboard/computePasteResult";
import { copyToClipboard, pasteFromClipboard } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";

function note(id: string, base: NoteEvent["duration"]["base"] = "quarter"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }],
  };
}

function quintuplet(type: "start" | "stop", count = type === "start" ? 3 : 2): Tuplet {
  return {
    type: "tuplet",
    inner: { duration: { base: "quarter" }, multiple: 5 },
    outer: { duration: { base: "quarter" }, multiple: 4 },
    span: { id: "quintuplet", type },
    content: Array.from({ length: count }, (_, index) => note(`${type}-${index}`)),
  };
}

function nestedTuplet(type: "start" | "stop"): Tuplet {
  return {
    type: "tuplet",
    inner: { duration: { base: "half" }, multiple: 3 },
    outer: { duration: { base: "half" }, multiple: 2 },
    span: { id: "outer-triplet", type },
    content: [quintuplet(type), ...(type === "stop" ? [note("last-half", "half")] : [])],
  };
}

function longTriplet(type: "start" | "stop"): Tuplet {
  return {
    type: "tuplet",
    inner: { duration: { base: "half" }, multiple: 3 },
    outer: { duration: { base: "half" }, multiple: 2 },
    span: { id: "long-triplet", type },
    content: Array.from({ length: type === "start" ? 11 : 1 }, (_, index) => note(`${type}-${index}`, "eighth")),
  };
}

const cases: { name: string; fragment: typeof quintuplet; start: Space["duration"]; stop: Space["duration"] }[] = [
  { name: "5:4 quintuplet", fragment: quintuplet, start: [3, 5], stop: [2, 5] },
  {
    name: "5:4 quintuplet ending with three quarters",
    fragment: (type) => quintuplet(type, type === "start" ? 2 : 3),
    start: [2, 5],
    stop: [3, 5],
  },
  { name: "nested 3:2 and 5:4 tuplets", fragment: nestedTuplet, start: [2, 5], stop: [3, 5] },
  { name: "long 3:2 triplet fragment", fragment: longTriplet, start: [11, 12], stop: [1, 12] },
];

function spanningScore(fragment: typeof quintuplet, start: Space["duration"], stop: Space["duration"]): Score {
  const measures: SequenceContent[][] = [
    [{ type: "space", duration: stop }, fragment("start")],
    [fragment("stop"), { type: "space", duration: start }],
  ];
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
    parts: [
      { measures: measures.map((content) => ({ sequences: [{ content }] })) },
      {
        measures: measures.map(() => ({
          sequences: [{ content: [{ type: "space", duration: [1, 1] }] }],
        })),
      },
    ],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("exact spanning-tuplet clipboard timing", () => {
  it("uses dotted durations and unequal duration bases in the spanning ratio", () => {
    const item = quintuplet("start");
    item.inner = { duration: { base: "half", dots: 1 }, multiple: 5 };
    item.outer = { duration: { base: "quarter", dots: 2 }, multiple: 4 };
    item.content = [{ ...note("dotted"), duration: { base: "quarter", dots: 1 } }];
    expect(contentWholeFraction(item)).toEqual([7, 40]);
  });

  it("retains declared durations for ordinary containers and zero time for grace notes", () => {
    const item = quintuplet("start");
    delete item.span;
    expect(contentWholeFraction(item)).toEqual([1, 1]);
    expect(
      contentWholeFraction({
        type: "tremolo",
        outer: { duration: { base: "quarter", dots: 1 }, multiple: 2 },
        marks: 2,
        content: [note("tremolo-1"), note("tremolo-2")],
      }),
    ).toEqual([3, 4]);
    expect(contentWholeFraction({ type: "grace", content: [note("grace")] })).toEqual([0, 1]);
  });

  it("rejects a spanning ratio whose reduced fraction exceeds safe integer bounds", () => {
    const item = quintuplet("start");
    item.inner.multiple = Number.MAX_SAFE_INTEGER;
    item.outer.multiple = 1;
    item.content = [note("too-fine")];
    expect(() => contentWholeFraction(item)).toThrow(/exact/i);
  });

  it.each(cases)("uses the local $name duration and its exact sequence boundary", ({ fragment, start, stop }) => {
    const content = [fragment("start")];
    expect(contentWholeFraction(content[0]!)).toEqual(start);
    expect(contentWholeFraction(fragment("stop"))).toEqual(stop);
    expect(sequenceBoundaryFraction(content, sequenceContentBeats(content[0]!))).toEqual(start);
  });

  it.each(cases)(
    "copies and pastes a two-bar $name through browser JSON without rhythm loss",
    async ({ fragment, start, stop }) => {
      const score = spanningScore(fragment, start, stop);
      const snapshot = structuredClone(score);
      expect(validateRawScore(serializeMnx(score))).toMatchObject({ ok: true });
      const selection = buildClipboardSelection(score, {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startMeasure: 0,
        endMeasure: 1,
      });
      expect(selection).not.toBeNull();
      const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
      const readText = vi.fn(async () => writeText.mock.calls[0]![0]);
      vi.stubGlobal("navigator", { clipboard: { writeText, readText } });
      expect(await copyToClipboard(selection!)).toBe(true);
      expect(writeText).toHaveBeenCalledTimes(1);
      const paste = await pasteFromClipboard();
      expect(readText).toHaveBeenCalledTimes(1);
      expect(paste).not.toBeNull();
      const pasteSnapshot = structuredClone(paste);

      const result = computePasteResult(
        score,
        {
          kind: "measure",
          startPartIndex: 1,
          endPartIndex: 1,
          startMeasure: 0,
          endMeasure: 0,
        },
        paste!,
      );
      expect(result).not.toBeNull();
      const measures = result!.newScore.parts[1]!.measures;
      expect(measures).toHaveLength(2);
      expect(result!.newScore.global.measures).toHaveLength(2);
      expect(measures[0]!.sequences[0]!.content).toEqual([{ type: "space", duration: stop }, paste!.content[1]]);
      expect(measures[1]!.sequences[0]!.content).toEqual([paste!.content[2], { type: "space", duration: start }]);
      const events = measures.flatMap((measure) =>
        [...walkSequenceEvents(measure.sequences[0]!.content)].map(({ event }) => event),
      );
      const sourceEvents = score.parts[0]!.measures.flatMap((measure) =>
        [...walkSequenceEvents(measure.sequences[0]!.content)].map(({ event }) => event),
      );
      expect(events.map((event) => event.duration)).toEqual(sourceEvents.map((event) => event.duration));
      expect(events.map((event) => event.notes?.map((note) => note.pitch))).toEqual(
        sourceEvents.map((event) => event.notes?.map((note) => note.pitch)),
      );
      expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
      expect(events.every((event) => !sourceEvents.some((source) => source.id === event.id))).toBe(true);
      for (const measure of measures) {
        expect(measure.sequences[0]!.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBeCloseTo(
          4,
          14,
        );
      }
      expect(validateRawScore(serializeMnx(result!.newScore))).toMatchObject({ ok: true });
      expect(result!.newScore.parts[0]).toEqual(snapshot.parts[0]);
      expect(score).toEqual(snapshot);
      expect(paste).toEqual(pasteSnapshot);
    },
  );
});

import { describe, expect, it } from "vitest";
import type { DynamicGroup, NoteEvent, PartMeasure, Score, Sequence, SequenceContent } from "@viritura/core";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import type { ClipboardTrack } from "../clipboard/ClipboardFragment";
import { applyPaste, type ClipboardSelection } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";

function note(id: string, base: "whole" | "half" | "quarter" = "whole"): NoteEvent {
  return { type: "event", id, duration: { base }, notes: [{ pitch: { step: "C", octave: 4 } }] };
}

function voice(id: string, staff = 1, base: "whole" | "half" | "quarter" = "whole"): Sequence {
  return { staff, content: [note(id, base)] };
}

function measure(...sequences: Sequence[]): PartMeasure {
  return { sequences };
}

function score(parts: PartMeasure[][]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: parts[0]!.map((_, index) => ({ id: `m${index}`, time: { count: 4, unit: 4 } })) },
    parts: parts.map((measures, index) => ({
      id: `part-${index}`,
      staves: Math.max(1, ...measures.flatMap((m) => m.sequences.map((s) => s.staff ?? 1))),
      measures,
    })),
  };
}

function copyMeasures(source: Score): ClipboardSelection {
  return buildClipboardSelection(source, {
    kind: "measure",
    startPartIndex: 0,
    endPartIndex: source.parts.length - 1,
    startMeasure: 0,
    endMeasure: source.global.measures.length - 1,
  })!;
}

function ids(content: readonly SequenceContent[]): string[] {
  return content.flatMap((item) => (item.type === "event" && item.id ? [item.id] : []));
}

function onsets(track: ClipboardTrack): [string, number][] {
  let beat = track.leadIn ? (track.leadIn[0] / track.leadIn[1]) * 4 : 0;
  return track.content.flatMap((item) => {
    const onset = beat;
    beat += sequenceContentBeats(item);
    return item.type === "event" && item.id ? [[item.id, onset] as [string, number]] : [];
  });
}

function trackEnd(track: ClipboardTrack): number {
  return (
    (track.leadIn ? (track.leadIn[0] / track.leadIn[1]) * 4 : 0) +
    track.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0)
  );
}

function paste(source: Score, selection: ClipboardSelection): Score {
  return applyPaste(
    source,
    {
      content: selection.events,
      tracks: selection.tracks,
      dynamics: selection.dynamics,
    },
    0,
    0,
    0,
    0,
  );
}

function dynamic(id: string, staff = 1): DynamicGroup {
  return { id, type: "immediate", value: "mf", position: { fraction: [0, 1] }, staff };
}

describe("clipboard selection review: continuous measure tracks", () => {
  it("keeps two voices continuous across two whole measures in a single part", () => {
    const source = score([[measure(voice("a0"), voice("b0")), measure(voice("a1"), voice("b1"))]]);
    const selection = copyMeasures(source);

    expect(selection.tracks).toHaveLength(2);
    expect(selection.tracks!.map((track) => [track.staffOffset, track.voiceIndex, ids(track.content)])).toEqual([
      [0, 0, ["a0", "a1"]],
      [0, 1, ["b0", "b1"]],
    ]);
    expect(ids(selection.events)).toEqual(["a0", "a1"]);
    expect(selection.cutLocations).toHaveLength(4);
    const result = paste(source, selection);
    expect(ids(result.parts[0]!.measures[0]!.sequences[0]!.content)).toEqual(["a0"]);
    expect(ids(result.parts[0]!.measures[1]!.sequences[0]!.content)).toEqual(["a1"]);
    expect(ids(result.parts[0]!.measures[1]!.sequences[1]!.content)).toEqual(["b1"]);
  });

  it("keeps one-part piano staves separate when their sequence order changes", () => {
    const source = score([
      [measure(voice("lower0", 2), voice("upper0", 1)), measure(voice("upper1", 1), voice("lower1", 2))],
    ]);
    const selection = copyMeasures(source);

    expect(selection.tracks).toHaveLength(2);
    expect(selection.tracks!.map((track) => [track.staffOffset, track.voiceIndex, ids(track.content)])).toEqual([
      [0, 0, ["upper0", "upper1"]],
      [1, 0, ["lower0", "lower1"]],
    ]);
  });

  it("aggregates each multipart staff/voice instead of overwriting with its last measure", () => {
    const source = score([
      [measure(voice("p0m0")), measure(voice("p0m1"))],
      [measure(voice("p1m0v0"), voice("p1m0v1")), measure(voice("p1m1v0"), voice("p1m1v1"))],
    ]);
    const selection = copyMeasures(source);

    expect(selection.tracks).toHaveLength(3);
    expect(
      selection.tracks!.map((track) => [track.partOffset, track.staffOffset, track.voiceIndex, ids(track.content)]),
    ).toEqual([
      [0, 0, 0, ["p0m0", "p0m1"]],
      [1, 1, 0, ["p1m0v0", "p1m1v0"]],
      [1, 1, 1, ["p1m0v1", "p1m1v1"]],
    ]);
    const result = paste(source, selection);
    expect(ids(result.parts[1]!.measures[0]!.sequences[0]!.content)).toEqual(["p1m0v0"]);
    expect(ids(result.parts[1]!.measures[1]!.sequences[0]!.content)).toEqual(["p1m1v0"]);
  });

  it("pads missing middle/trailing time and preserves delayed leading time across meter changes", () => {
    const source = score([
      [
        measure(voice("upper0", 1, "quarter")),
        measure(voice("lower1", 2, "quarter")),
        measure(voice("upper2", 1, "quarter"), voice("lower2", 2, "quarter")),
      ],
    ]);
    source.global.measures[0]!.time = { count: 3, unit: 4 };
    source.global.measures[1]!.time = { count: 5, unit: 8 };
    source.global.measures[2]!.time = { count: 2, unit: 4 };
    const selection = copyMeasures(source);
    const [upper, lower] = selection.tracks!;

    expect(selection.timeSignature).toEqual({ count: 3, unit: 4 });
    expect(onsets(upper!)).toEqual([
      ["upper0", 0],
      ["upper2", 5.5],
    ]);
    expect(onsets(lower!)).toEqual([
      ["lower1", 3],
      ["lower2", 5.5],
    ]);
    expect(trackEnd(upper!)).toBe(7.5);
    expect(trackEnd(lower!)).toBe(7.5);
    expect(lower!.leadIn![0] / lower!.leadIn![1]).toBe(3 / 4);
    expect(ids(lower!.content)[0]).toBe("lower1");
    expect(lower!.content[0]?.type).toBe("event");
  });

  it("does not replace destination leading music before a delayed measure track", () => {
    const source = score([[measure(voice("upper0")), measure(voice("upper1"), voice("lower1", 2))]]);
    const target = score([
      [measure(voice("old-upper0"), voice("keep-lower0", 2)), measure(voice("old-upper1"), voice("old-lower1", 2))],
    ]);
    const result = paste(target, copyMeasures(source));

    expect(ids(result.parts[0]!.measures[0]!.sequences[1]!.content)).toEqual(["keep-lower0"]);
    expect(ids(result.parts[0]!.measures[1]!.sequences[1]!.content)).toEqual(["lower1"]);
  });

  it("copies a selected full-measure rest as silence rather than an unselected lead-in", () => {
    const source = score([
      [
        measure({ content: [], fullMeasure: { visualDuration: { base: "whole" } } }),
        measure(voice("after-rest", 1, "half")),
      ],
    ]);
    source.global.measures[0]!.time = { count: 3, unit: 4 };
    source.global.measures[1]!.time = { count: 2, unit: 4 };
    const selection = copyMeasures(source);
    const track = selection.tracks![0]!;

    expect(track.leadIn).toBeUndefined();
    expect(track.content[0]).toMatchObject({ type: "event", rest: {} });
    expect(sequenceContentBeats(track.content[0]!)).toBe(3);
    expect(onsets(track).find(([id]) => id === "after-rest")?.[1]).toBe(3);
    expect(trackEnd(track)).toBe(5);
    expect(selection.cutLocations).toEqual([{ partIndex: 0, measureIndex: 1, sequenceIndex: 0, eventIndex: 0 }]);
    const target = score([[measure(voice("replace-me", 1, "half")), measure(voice("old", 1, "half"))]]);
    target.global = structuredClone(source.global);
    const result = paste(target, selection);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({ rest: {} });
  });

  it("uses inherited meter and key context when the selection starts after a change", () => {
    const source = score([[measure(voice("before", 1, "half")), measure(voice("selected", 1, "half"))]]);
    source.global.measures[0]!.time = { count: 2, unit: 4 };
    source.global.measures[0]!.key = { fifths: -2 };
    delete source.global.measures[1]!.time;
    const selection = buildClipboardSelection(source, {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startMeasure: 1,
      endMeasure: 1,
    })!;

    expect(selection.timeSignature).toEqual({ count: 2, unit: 4 });
    expect(selection.keySignature).toEqual({ fifths: -2 });
    expect(trackEnd(selection.tracks![0]!)).toBe(2);
  });
});

describe("clipboard selection review: dynamics ownership", () => {
  it("captures a part-level dynamic once for a multivoice range and pastes it once", () => {
    const source = score([[measure(voice("a"), voice("b"))]]);
    source.parts[0]!.measures[0]!.dynamics = [dynamic("d")];
    const selection = buildClipboardSelection(source, {
      kind: "range",
      startElementId: "p0/m0/s0/a",
      endElementId: "p0/m0/s1/b",
    })!;

    expect(selection.tracks!.flatMap((track) => track.dynamics ?? [])).toHaveLength(1);
    const target = score([[measure(voice("old-a"), voice("old-b"))]]);
    expect(paste(target, selection).parts[0]!.measures[0]!.dynamics).toHaveLength(1);
  });

  it("captures each measure's dynamics once on their display staff, not each voice", () => {
    const source = score([
      [measure(voice("u0"), voice("v0"), voice("l0", 2)), measure(voice("u1"), voice("v1"), voice("l1", 2))],
    ]);
    source.parts[0]!.measures[0]!.dynamics = [dynamic("upper", 1), dynamic("lower", 2)];
    source.parts[0]!.measures[1]!.dynamics = [dynamic("next-lower", 2)];
    const selection = copyMeasures(source);

    expect(
      selection.tracks!.map((track) => [
        track.staffOffset,
        track.voiceIndex,
        track.dynamics?.map((item) => item.dynamic.id) ?? [],
      ]),
    ).toEqual([
      [0, 0, ["upper"]],
      [0, 1, []],
      [1, 0, ["lower", "next-lower"]],
    ]);
    const target = score([
      [
        measure(voice("old-u0"), voice("old-v0"), voice("old-l0", 2)),
        measure(voice("old-u1"), voice("old-v1"), voice("old-l1", 2)),
      ],
    ]);
    const result = paste(target, selection);
    expect(result.parts[0]!.measures[0]!.dynamics?.map((item) => item.staff)).toEqual([1, 2]);
    expect(result.parts[0]!.measures[1]!.dynamics).toHaveLength(1);
  });

  it("keeps selected dynamics on the display staff in a multivoice range", () => {
    const source = score([[measure(voice("a"), voice("b"), voice("c", 2))]]);
    source.parts[0]!.measures[0]!.dynamics = [dynamic("lower", 2)];
    const selection = buildClipboardSelection(source, {
      kind: "range",
      startElementId: "p0/m0/s0/a",
      endElementId: "p0/m0/s2/c",
    })!;

    expect(selection.tracks!.filter((track) => track.dynamics?.length)).toMatchObject([
      { staffOffset: 1, voiceIndex: 0, dynamics: [{ dynamic: { id: "lower", staff: 2 } }] },
    ]);
  });

  it("captures selected multipart dynamics only once even with several voices", () => {
    const source = score([[measure(voice("a"), voice("b"))], [measure(voice("c"), voice("d"))]]);
    source.parts[0]!.measures[0]!.dynamics = [dynamic("first")];
    source.parts[1]!.measures[0]!.dynamics = [dynamic("second")];
    const selection = buildClipboardSelection(source, {
      kind: "multi",
      elementIds: ["p0/m0/s0/a", "p0/m0/s1/b", "p1/m0/s0/c", "p1/m0/s1/d", "p0/m0/dynfirst", "p1/m0/dynsecond"],
    })!;

    expect(selection.tracks!.flatMap((track) => track.dynamics ?? []).map((item) => item.dynamic.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("preserves explicitly selected display-staff dynamics even without selected notes on that staff", () => {
    const source = score([[measure(voice("a"))], [measure(voice("b"))]]);
    source.parts[0]!.staves = 2;
    source.parts[0]!.measures[0]!.dynamics = [dynamic("lower", 2)];
    const selection = buildClipboardSelection(source, {
      kind: "multi",
      elementIds: ["p0/m0/s0/a", "p1/m0/s0/b", "p0/m0/dynlower", "p0/m0/dynlower"],
    })!;

    expect(selection.tracks!.flatMap((track) => track.dynamics ?? [])).toHaveLength(1);
    expect(selection.tracks!.find((track) => track.staffOffset === 1)).toMatchObject({
      content: [],
      dynamics: [{ dynamic: { id: "lower", staff: 2 } }],
    });
    const target = structuredClone(source);
    delete target.parts[0]!.measures[0]!.dynamics;
    expect(paste(target, selection).parts[0]!.measures[0]!.dynamics).toHaveLength(1);
  });

  it("keeps dynamics on a selected part with no selected rhythmic events", () => {
    const source = score([[measure(voice("a"))], [measure(voice("b"))]]);
    source.parts[1]!.measures[0]!.dynamics = [dynamic("other-part")];
    const selection = buildClipboardSelection(source, {
      kind: "multi",
      elementIds: ["p0/m0/s0/a", "p1/m0/dynother-part"],
    })!;

    expect(selection.tracks!.find((track) => track.partOffset === 1)).toMatchObject({
      content: [],
      dynamics: [{ dynamic: { id: "other-part" } }],
    });
  });

  it("uses the common meter-aware timeline for dynamics on delayed voices", () => {
    const source = score([
      [
        measure(voice("a", 1, "quarter")),
        measure(voice("b", 1, "quarter")),
        measure(voice("c", 1, "quarter"), voice("delayed", 2, "quarter")),
      ],
    ]);
    source.global.measures[0]!.time = { count: 3, unit: 4 };
    source.global.measures[1]!.time = { count: 5, unit: 8 };
    source.global.measures[2]!.time = { count: 2, unit: 4 };
    source.parts[0]!.measures[2]!.dynamics = [dynamic("later", 2)];
    const selection = copyMeasures(source);
    const lower = selection.tracks!.find((track) => track.staffOffset === 1)!;
    const captured = lower.dynamics![0]!;

    expect(captured.offset![0] / captured.offset![1]).toBe(5.5 / 4);
    expect(captured.measureOffset).toBe(2);
    expect(selection.tracks!.flatMap((track) => track.dynamics ?? [])).toHaveLength(1);
  });

  it("preserves explicitly selected dynamics before the first selected event", () => {
    const source = score([[measure({ content: [note("before", "quarter"), note("selected", "quarter")] })]]);
    source.parts[0]!.measures[0]!.dynamics = [dynamic("before-note")];
    const selection = buildClipboardSelection(source, {
      kind: "multi",
      elementIds: ["p0/m0/s0/selected", "p0/m0/dynbefore-note"],
    })!;

    expect(selection.dynamics).toHaveLength(1);
    expect(selection.dynamics![0]!.offset).toEqual([0, 1024]);
    expect(selection.tracks![0]!.leadIn).toEqual([256, 1024]);
  });
});

describe("clipboard selection review: delayed ranges", () => {
  it("resolves a delayed voice against its first event measure, not an earlier reordered staff", () => {
    const source = score([
      [
        measure(voice("start", 2), voice("unselected", 1)),
        measure(voice("later-upper", 1), voice("later-lower-a", 2), voice("later-lower-b", 2)),
      ],
    ]);
    const selection = buildClipboardSelection(source, {
      kind: "range",
      startElementId: "p0/m0/s0/start",
      endElementId: "p0/m1/s2/later-lower-b",
    })!;

    expect(selection.tracks!.map((track) => [track.staffOffset, track.voiceIndex, ids(track.content)])).toEqual([
      [0, 0, ["unselected", "later-upper"]],
      [1, 0, ["start", "later-lower-a"]],
      [1, 1, ["later-lower-b"]],
    ]);
    expect(selection.tracks!.find((track) => track.staffOffset === 1 && track.voiceIndex === 1)?.leadIn).toEqual([
      1024, 1024,
    ]);
  });

  it("resolves a delayed first voice when earlier sequences on that staff are missing", () => {
    const source = score([[measure(voice("start")), measure(voice("later-lower", 2), voice("later-upper"))]]);
    const selection = buildClipboardSelection(source, {
      kind: "range",
      startElementId: "p0/m0/s0/start",
      endElementId: "p0/m1/s1/later-upper",
    })!;

    expect(selection.tracks!.map((track) => [track.staffOffset, track.voiceIndex, ids(track.content)])).toEqual([
      [0, 0, ["start", "later-upper"]],
      [1, 0, ["later-lower"]],
    ]);
  });
});

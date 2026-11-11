import { describe, expect, it } from "vitest";
import type { NoteEvent, Score, Sequence } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import type { SelectionState } from "../../store/selectionStore";
import { resolveStaffSwapTarget, swapStaffContents } from "./index";

function voice(id: string, staff = 1): Sequence {
  return {
    staff,
    voice: id,
    content: [
      {
        type: "event",
        id,
        duration: { base: "whole" },
        notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }],
      },
    ],
  };
}

function score(staves = [1, 1, 1]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [0, 1, 2].map((index) => ({ id: `m${index}`, time: { count: 4, unit: 4 } })) },
    parts: staves.map((count, partIndex) => ({
      id: `part${partIndex}`,
      name: `Part ${partIndex}`,
      staves: count,
      measures: [0, 1, 2].map((measureIndex) => ({
        clefs: [{ staff: 1, clef: { sign: "G", staffPosition: -2 } }],
        sequences: Array.from({ length: count }, (_, index) =>
          voice(`p${partIndex}m${measureIndex}s${index}`, index + 1),
        ),
      })),
    })),
  };
}

function selection(
  overrides: Partial<Extract<SelectionState, { kind: "measure" }>> = {},
): Extract<SelectionState, { kind: "measure" }> {
  return {
    kind: "measure",
    startPartIndex: 0,
    endPartIndex: 1,
    startStaffIndex: 0,
    endStaffIndex: 1,
    startLocalStaffIndex: 0,
    endLocalStaffIndex: 0,
    startMeasure: 0,
    endMeasure: 1,
    ...overrides,
  };
}

describe("staff swap targeting", () => {
  it("resolves reversed bars and staves", () => {
    expect(
      resolveStaffSwapTarget(
        score(),
        selection({
          startPartIndex: 1,
          endPartIndex: 0,
          startStaffIndex: 1,
          endStaffIndex: 0,
          startMeasure: 1,
          endMeasure: 0,
        }),
      ),
    ).toEqual({
      staves: [
        { partIndex: 0, staff: 1 },
        { partIndex: 1, staff: 1 },
      ],
      startMeasure: 0,
      endMeasure: 1,
    });
  });

  it("resolves adjacent staves across multi-staff parts, not the whole parts", () => {
    expect(resolveStaffSwapTarget(score([2, 2]), selection({ startLocalStaffIndex: 1 }))?.staves).toEqual([
      { partIndex: 0, staff: 2 },
      { partIndex: 1, staff: 1 },
    ]);
  });

  it("handles legacy bar selections without local indices", () => {
    expect(
      resolveStaffSwapTarget(
        score(),
        selection({
          startLocalStaffIndex: undefined,
          endLocalStaffIndex: undefined,
        }),
      ),
    ).not.toBeNull();
    expect(
      resolveStaffSwapTarget(
        score([2, 2]),
        selection({
          startLocalStaffIndex: undefined,
          endLocalStaffIndex: undefined,
        }),
      ),
    ).toBeNull();
  });

  it.each([
    { kind: "none" } as const,
    { kind: "single", elementId: "p0/m0/s0/e0", elementType: "event" } as const,
    selection({ endPartIndex: 0, endStaffIndex: 0 }),
    selection({ endPartIndex: 2, endStaffIndex: 2 }),
    selection({ endMeasure: 3 }),
    selection({ startMeasure: -1 }),
    selection({ startMeasure: NaN }),
    selection({ endPartIndex: 10 }),
    selection({ startLocalStaffIndex: 2 }),
  ])("rejects selections that do not identify two valid staves: %j", (selected) => {
    expect(resolveStaffSwapTarget(score(), selected)).toBeNull();
    expect(swapStaffContents(score(), selected)).toBeNull();
  });

  it("rejects a missing document", () => {
    expect(resolveStaffSwapTarget(null, selection())).toBeNull();
  });
});

describe("swapping staff contents", () => {
  it("exchanges all voices only in the selected bars without mutating the source", () => {
    const source = score();
    source.parts[0]!.measures[0]!.sequences.push(voice("extra"));
    source.parts[1]!.transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
    const before = structuredClone(source);
    const next = swapStaffContents(source, selection())!;
    for (const index of [0, 1]) {
      expect(next.parts[0]!.measures[index]!.sequences).toEqual(source.parts[1]!.measures[index]!.sequences);
      expect(next.parts[1]!.measures[index]!.sequences).toEqual(source.parts[0]!.measures[index]!.sequences);
      expect(next.parts[0]!.measures[index]!.clefs).toEqual(source.parts[0]!.measures[index]!.clefs);
    }
    expect(next.parts[0]!.measures[2]).toEqual(source.parts[0]!.measures[2]);
    expect(next.parts[2]).toEqual(source.parts[2]);
    expect(next.parts[1]!.transposition).toEqual(source.parts[1]!.transposition);
    expect(next.global).toEqual(source.global);
    expect(source).toEqual(before);
    expect(swapStaffContents(next, selection())).toEqual(source);
  });

  it("swaps grand-staff voices even with reordered sequences and omitted default staff", () => {
    const source = score([3]);
    const measure = source.parts[0]!.measures[0]!;
    delete measure.sequences[0]!.staff;
    measure.sequences.unshift(voice("lower-second-voice", 2));
    measure.sequences.reverse();
    const selected = selection({ endPartIndex: 0, endLocalStaffIndex: 1, endMeasure: 0 });
    const next = swapStaffContents(source, selected)!;
    const sequences = next.parts[0]!.measures[0]!.sequences;
    expect(sequences.filter((sequence) => sequence.staff === 1).map((sequence) => sequence.voice)).toEqual([
      "p0m0s1",
      "lower-second-voice",
    ]);
    expect(sequences.filter((sequence) => sequence.staff === 2).map((sequence) => sequence.voice)).toEqual(["p0m0s0"]);
    expect(sequences.find((sequence) => sequence.staff === 3)).toEqual(
      measure.sequences.find((sequence) => sequence.staff === 3),
    );
  });

  it("moves rests, tuplets, grace notes, and explicit cross-staff targets intact", () => {
    const source = score([2]);
    const measure = source.parts[0]!.measures[0]!;
    const event = measure.sequences[0]!.content[0] as NoteEvent;
    event.staff = 2;
    event.lyrics = { lines: { "1": { syllable: { text: "la" } } } };
    measure.sequences[0]!.content = [
      { type: "grace", content: [{ ...event, id: "grace" }] },
      {
        type: "tuplet",
        staff: 1,
        inner: { duration: { base: "quarter" }, multiple: 3 },
        outer: { duration: { base: "quarter" }, multiple: 2 },
        content: [event],
      },
    ];
    measure.sequences[1] = { staff: 2, content: [], fullMeasure: { visualDuration: { base: "whole" }, fermata: {} } };
    const next = swapStaffContents(source, selection({ endPartIndex: 0, endLocalStaffIndex: 1, endMeasure: 0 }))!;
    const [upperMusic, lowerMusic] = next.parts[0]!.measures[0]!.sequences;
    expect(upperMusic!.staff).toBe(2);
    const tuplet = upperMusic!.content[1]!;
    expect(tuplet.type === "tuplet" && tuplet.staff).toBe(2);
    expect(tuplet.type === "tuplet" && tuplet.content[0]).toEqual({ ...event, staff: 1 });
    expect(lowerMusic).toEqual({ ...measure.sequences[1], staff: 1 });
  });

  it("moves staff-owned and ID-referenced markings while retaining unselected staff markings", () => {
    const source = score([2, 2]);
    const first = source.parts[0]!.measures[0]!;
    const second = source.parts[1]!.measures[0]!;
    const position = { fraction: [0, 1] as [number, number] };
    first.dynamics = [
      { id: "stay", type: "immediate", value: "p", position },
      { id: "move", type: "immediate", value: "f", position, staff: 2 },
    ];
    first.expressions = [{ position, text: [{ text: "dolce" }], staff: 2 }];
    first.pedals = [{ position, end: { fraction: [1, 1] }, type: "sustain", staff: 2 }];
    first.ottavas = [{ position, end: { fraction: [1, 1] }, value: 1, staff: 2 }];
    first.beams = [{ events: ["p0m0s1"] }];
    first.arpeggios = [{ position, span: { start: "p0m0s1-note", end: "p0m0s1-note" } }];
    first.nonArpeggios = [{ position, span: { start: "p0m0s0-note", end: "p0m0s0-note" } }];
    second.dynamics = [{ id: "other", type: "immediate", value: "mf", position }];
    const next = swapStaffContents(source, selection({ startLocalStaffIndex: 1, endMeasure: 0 }))!;
    const a = next.parts[0]!.measures[0]!;
    const b = next.parts[1]!.measures[0]!;
    expect(a.dynamics?.map((dynamic) => [dynamic.id, dynamic.staff ?? 1])).toEqual([
      ["stay", 1],
      ["other", 2],
    ]);
    expect(b.dynamics?.map((dynamic) => [dynamic.id, dynamic.staff])).toEqual([["move", 1]]);
    for (const values of [b.expressions, b.pedals, b.ottavas]) expect(values?.[0]?.staff).toBe(1);
    expect(b.beams).toEqual(first.beams);
    expect(b.arpeggios).toEqual(first.arpeggios);
    expect(a.nonArpeggios).toEqual(first.nonArpeggios);
    expect(a.expressions).toBeUndefined();
  });

  it("remaps diagonal hairpins between two staves of the same part only once", () => {
    const source = score([3]);
    source.parts[0]!.measures[0]!.dynamics = [
      {
        id: "hairpin",
        type: "gradual",
        position: { fraction: [0, 1] },
        end: { fraction: [1, 1] },
        wedgeType: "crescendo",
        staff: 1,
        staffEnd: 2,
      },
    ];
    const next = swapStaffContents(source, selection({ endPartIndex: 0, endLocalStaffIndex: 1, endMeasure: 0 }))!;
    expect(next.parts[0]!.measures[0]!.dynamics?.[0]).toMatchObject({ staff: 2, staffEnd: 1 });
  });

  it("keeps cross-staff overrides valid when moving into a single-staff part", () => {
    const source = score([3, 1]);
    const measure = source.parts[0]!.measures[0]!;
    const event = measure.sequences[2]!.content[0] as NoteEvent;
    event.staff = 2;
    const next = swapStaffContents(source, selection({ startLocalStaffIndex: 2, endMeasure: 0 }))!;
    const moved = next.parts[1]!.measures[0]!.sequences[0]!;
    expect(moved.staff).toBe(1);
    expect(moved.content[0]).toEqual({ ...event, staff: 1 });
  });

  it("can exchange an empty staff and a full-measure rest", () => {
    const source = score([1, 1]);
    source.parts[0]!.measures[0]!.sequences = [];
    source.parts[1]!.measures[0]!.sequences = [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }];
    const next = swapStaffContents(source, selection({ endMeasure: 0 }))!;
    expect(next.parts[0]!.measures[0]!.sequences).toEqual([
      { staff: 1, content: [], fullMeasure: { visualDuration: { base: "whole" } } },
    ]);
    expect(next.parts[1]!.measures[0]!.sequences).toEqual([]);
  });

  it("persists swapped music through MNX serialization", () => {
    const source = score();
    const next = swapStaffContents(source, selection())!;
    const restored = parseMnx(serializeMnx(next));
    expect(restored.parts[0]!.measures[0]!.sequences[0]!.content).toEqual(
      source.parts[1]!.measures[0]!.sequences[0]!.content,
    );
  });
});

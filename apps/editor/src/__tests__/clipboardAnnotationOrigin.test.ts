import { describe, expect, it } from "vitest";
import type { ChordSymbol, DynamicGroup, NoteEvent, Score, SequenceContent } from "@viritura/core";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import { readMuseScoreClipboard, writeMuseScoreStaffList } from "../clipboard/museScore";
import { applyPaste, pasteResultFromFragment, type ClipboardSelection } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";
import type { SelectionState } from "../store/selectionStore";

function note(id: string, base: "whole" | "quarter" = "whole", step: "C" | "D" = "C"): NoteEvent {
  return { type: "event", id, duration: { base }, notes: [{ id: `${id}-n`, pitch: { step, octave: 4 } }] };
}

function score(layout: number[], measures = 1): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: measures }, (_, index) => ({ id: `m${index}`, time: { count: 4, unit: 4 } })),
    },
    parts: layout.map((staves, partIndex) => ({
      staves,
      measures: Array.from({ length: measures }, (_, measureIndex) => ({
        sequences: Array.from({ length: staves }, (_, staff) => ({
          staff: staff + 1,
          content: [note(`p${partIndex}m${measureIndex}s${staff}`)],
        })),
      })),
    })),
  };
}

function dynamic(id: string, beat: number, staff?: number): DynamicGroup {
  return { id, type: "immediate", value: "mf", position: { fraction: [beat, 4] }, ...(staff ? { staff } : {}) };
}

function harmony(staff?: number, step: "C" | "D" | "E" | "F" | "G" = "C"): ChordSymbol {
  return {
    root: { step },
    quality: "minor",
    position: { fraction: [0, 1] },
    ...(staff === undefined ? {} : { displayStaff: staff }),
  };
}

function roundTrip(selection: ClipboardSelection) {
  const fragment = deserializeFragment(
    serializeFragment(
      selection.events,
      selection.timeSignature,
      selection.keySignature,
      selection.tracks,
      selection.clef,
      selection.transposition,
      selection.dynamics,
      selection.measureRepeats,
      selection.lyrics,
      selection.chordSymbols,
    ),
  );
  expect(fragment).not.toBeNull();
  return pasteResultFromFragment(fragment!);
}

function copy(source: Score, selection?: SelectionState): ClipboardSelection {
  return buildClipboardSelection(
    source,
    selection ?? {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: source.parts.length - 1,
      startMeasure: 0,
      endMeasure: source.global.measures.length - 1,
    },
  )!;
}

function offsetBeats(offset: [number, number] | undefined): number {
  expect(offset).toBeDefined();
  return (offset![0] / offset![1]) * 4;
}

function onsets(content: SequenceContent[]): [string | undefined, number][] {
  let beat = 0;
  return content.flatMap((item) => {
    const start = beat;
    beat += sequenceContentBeats(item);
    return item.type === "event" ? [[item.id, start]] : [];
  });
}

describe("clipboard annotation source staff metadata", () => {
  it("keeps a staff-2 Cm below the only copied staff-1 note sequence", () => {
    const source = score([2]);
    source.parts[0]!.measures[0]!.sequences.splice(1);
    source.parts[0]!.measures[0]!.chordSymbols = [harmony(2)];
    const selection = copy(source);
    const paste = roundTrip(selection);
    expect(paste.tracks).toMatchObject([{ staffOffset: 0, sourceStaff: 1 }]);
    expect(paste.chordSymbols).toMatchObject([{ staffOffset: 1, chordSymbol: { displayStaff: 2 } }]);
    const target = score([2]);
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]).toEqual(paste.content[0]);
    expect(result.parts[0]!.measures[0]!.sequences[1]).toEqual(target.parts[0]!.measures[0]!.sequences[1]);
    expect(result.parts[0]!.measures[0]!.chordSymbols).toMatchObject([
      { displayStaff: 2, root: { step: "C" }, quality: "minor" },
    ]);
    expect(writeMuseScoreStaffList(selection)).toMatchObject({ xml: null, warning: expect.any(String) });
  });

  it("maps a singleton lower-staff range's harmony and dynamics into a single staff", () => {
    const source = score([2], 2);
    for (const measure of source.parts[0]!.measures) {
      measure.chordSymbols = [harmony(2)];
      measure.dynamics = [dynamic("same-id-in-different-measures", 0, 2)];
    }
    const selection = copy(source, {
      kind: "range",
      startElementId: "p0/m0/s1/p0m0s1",
      endElementId: "p0/m1/s1/p0m1s1",
    });
    expect(selection.tracks).toBeUndefined();
    const paste = roundTrip(selection);
    expect(paste.chordSymbols?.map((item) => item.staffOffset)).toEqual([0, 0]);
    expect(paste.dynamics?.map((item) => item.staffOffset)).toEqual([0, 0]);
    const result = applyPaste(score([1], 2), paste, 0, 0, 0, 0);
    for (const [index, measure] of result.parts[0]!.measures.entries()) {
      expect(measure.sequences[0]!.content[0]).toEqual(paste.content[index]);
      expect(measure.dynamics).toMatchObject([{ staff: 1, position: { fraction: [0, 16] } }]);
      expect(measure.chordSymbols).toMatchObject([{ displayStaff: 1, root: { step: "C" } }]);
    }
    const exported = writeMuseScoreStaffList(selection);
    expect(exported.warning).toBeUndefined();
    const imported = readMuseScoreClipboard(exported.xml!);
    expect(imported.chordSymbols?.map((item) => item.staffOffset)).toEqual([0, 0]);
    expect(imported.dynamics?.map((item) => item.staffOffset)).toEqual([0, 0]);
  });

  it("retains a single lower-staff note's harmony source coordinate without tracks", () => {
    const source = score([2]);
    source.parts[0]!.measures[0]!.chordSymbols = [harmony(2)];
    const selection = copy(source, { kind: "single", elementId: "p0/m0/s1/p0m0s1" });
    expect(selection.tracks).toBeUndefined();
    const result = applyPaste(score([1]), roundTrip(selection), 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.chordSymbols).toMatchObject([{ displayStaff: 1 }]);
  });

  it.each([undefined, 1])(
    "aligns a singleton's default/explicit staff %s harmony with the destination staff",
    (staff) => {
      const source = score([1]);
      source.parts[0]!.measures[0]!.chordSymbols = [harmony(staff)];
      source.parts[0]!.measures[0]!.dynamics = [dynamic("default-staff", 0, staff)];
      for (const selection of [
        { kind: "single", elementId: "p0/m0/s0/p0m0s0" } as const,
        { kind: "range", startElementId: "p0/m0/s0/p0m0s0", endElementId: "p0/m0/s0/p0m0s0" } as const,
      ]) {
        const result = applyPaste(score([2]), roundTrip(copy(source, selection)), 0, 0, 1, 0);
        expect(result.parts[0]!.measures[0]!.chordSymbols).toMatchObject([{ displayStaff: 2 }]);
        if (selection.kind === "range") {
          expect(result.parts[0]!.measures[0]!.dynamics).toMatchObject([{ staff: 2 }]);
        }
      }
    },
  );

  it("maps five physical staves across mismatched multipart layouts without counting annotations", () => {
    const source = score([2, 1, 2]);
    const roots = ["C", "D", "E", "F", "G"] as const;
    let physicalStaff = 0;
    for (const part of source.parts) {
      const measure = part.measures[0]!;
      measure.chordSymbols = [];
      measure.dynamics = [];
      for (let staff = 1; staff <= part.staves!; staff++) {
        measure.chordSymbols.push(harmony(staff, roots[physicalStaff]!));
        measure.dynamics.push(dynamic("same-id-across-staves-and-parts", 0, staff));
        physicalStaff++;
      }
    }
    const paste = roundTrip(copy(source));
    expect(paste.chordSymbols?.map((item) => item.staffOffset)).toEqual([0, 1, 2, 3, 4]);
    const result = applyPaste(score([1, 2, 1, 1]), paste, 0, 0, 0, 0);
    physicalStaff = 0;
    for (const part of result.parts) {
      const measure = part.measures[0]!;
      for (let staff = 1; staff <= part.staves!; staff++) {
        expect(measure.chordSymbols?.find((item) => item.displayStaff === staff)?.root.step).toBe(roots[physicalStaff]);
        expect(measure.dynamics?.filter((item) => item.staff === staff)).toHaveLength(1);
        expect(measure.sequences[staff - 1]!.content[0]).toEqual(paste.tracks![physicalStaff]!.content[0]);
        physicalStaff++;
      }
    }
  });

  it("rejects legacy physical annotations without a source-staff coordinate instead of guessing", () => {
    const target = score([2]);
    const snapshot = structuredClone(target);
    expect(() =>
      applyPaste(
        target,
        {
          content: [note("legacy")],
          tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [note("legacy")] }],
          chordSymbols: [{ measureOffset: 0, chordSymbol: harmony(2) }],
        },
        0,
        0,
        0,
        0,
      ),
    ).toThrow(/source staff is ambiguous/);
    expect(target).toEqual(snapshot);
  });

  it("uses explicit track sourceStaff when an older annotation has no physical offset", () => {
    const source = score([2]);
    source.parts[0]!.measures[0]!.sequences.splice(1);
    source.parts[0]!.measures[0]!.chordSymbols = [harmony(2)];
    const paste = roundTrip(copy(source));
    delete paste.chordSymbols![0]!.staffOffset;
    const result = applyPaste(score([2]), paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.chordSymbols).toMatchObject([{ displayStaff: 2 }]);
  });

  it("uses the lower selection anchor across multiple source parts with different destination grouping", () => {
    const source = score([3, 2]);
    source.parts[0]!.measures[0]!.sequences.splice(0, 1);
    source.parts[0]!.measures[0]!.chordSymbols = [harmony(2, "C"), harmony(3, "D")];
    source.parts[1]!.measures[0]!.chordSymbols = [harmony(undefined, "E"), harmony(2, "F")];
    const paste = roundTrip(
      copy(source, {
        kind: "range",
        startElementId: "p0/m0/s0/p0m0s1",
        endElementId: "p1/m0/s1/p1m0s1",
      }),
    );
    expect(paste.chordSymbols?.map((item) => item.staffOffset)).toEqual([0, 1, 2, 3]);
    const result = applyPaste(score([1, 3]), paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.chordSymbols).toMatchObject([{ displayStaff: 1, root: { step: "C" } }]);
    expect(result.parts[1]!.measures[0]!.chordSymbols).toMatchObject([
      { displayStaff: 1, root: { step: "D" } },
      { displayStaff: 2, root: { step: "E" } },
      { displayStaff: 3, root: { step: "F" } },
    ]);
  });
});

describe("clipboard common annotation and note origin", () => {
  it("chooses the topmost staff independently of the earliest multi-selected note", () => {
    const source = score([2]);
    source.parts[0]!.measures[0]!.sequences[0]!.content = [note("before", "quarter"), note("upper", "quarter")];
    const paste = roundTrip(
      copy(source, {
        kind: "multi",
        elementIds: ["p0/m0/s0/upper", "p0/m0/s1/p0m0s1"],
      }),
    );
    expect(paste.tracks?.map((track) => track.staffOffset)).toEqual([0, 1]);
    expect(offsetBeats(paste.tracks![0]!.leadIn)).toBe(1);
    expect(paste.tracks![1]!.leadIn).toBeUndefined();
    const target = score([2]);
    target.parts[0]!.measures[0]!.sequences[0]!.content = [note("keep", "quarter"), note("replace", "quarter")];
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[1]).toEqual(paste.tracks![0]!.content[0]);
    expect(result.parts[0]!.measures[0]!.sequences[1]!.content[0]).toEqual(paste.tracks![1]!.content[0]);
  });

  it.each([false, true])(
    "deduplicates the d-to-second-note range with nonnegative offsets (reverse: %s)",
    (reverse) => {
      const source = score([1], 2);
      source.parts[0]!.measures[0]!.dynamics = [dynamic("d", 3)];
      source.parts[0]!.measures[1]!.dynamics = [dynamic("e", 0)];
      const snapshot = structuredClone(source);
      const selection = copy(source, {
        kind: "range",
        startElementId: reverse ? "p0/m1/s0/p0m1s0" : "p0/m0/dynd",
        endElementId: reverse ? "p0/m0/dynd" : "p0/m1/s0/p0m1s0",
      });
      const paste = roundTrip(selection);
      expect(paste.tracks).toHaveLength(1);
      expect(offsetBeats(paste.tracks![0]!.leadIn)).toBe(1);
      const dynamics = paste.tracks!.flatMap((track) => track.dynamics ?? []);
      expect(dynamics.map((item) => [item.dynamic.id, item.measureOffset, offsetBeats(item.offset)])).toEqual([
        ["d", 0, 0],
        ["e", 1, 1],
      ]);
      const target = score([1], 2);
      target.parts[0]!.measures[0]!.sequences[0]!.content = Array.from({ length: 4 }, (_, index) =>
        note(`keep-${index}`, "quarter", "D"),
      );
      const targetSnapshot = structuredClone(target);
      const pasteSnapshot = structuredClone(paste);
      const result = applyPaste(target, paste, 0, 0, 0, 0);
      const measure = result.parts[0]!.measures[0]!;
      expect(onsets(measure.sequences[0]!.content).slice(0, 2)).toEqual([
        ["keep-0", 0],
        [(paste.content[0] as NoteEvent).id, 1],
      ]);
      expect(measure.dynamics?.map((item) => item.position.fraction)).toEqual([
        [0, 16],
        [4, 16],
      ]);
      expect(result.parts[0]!.measures[1]!.dynamics ?? []).toHaveLength(0);
      expect(source).toEqual(snapshot);
      expect(target).toEqual(targetSnapshot);
      expect(paste).toEqual(pasteSnapshot);
    },
  );

  it("starts before the first note for a same-measure annotation range", () => {
    const source = score([1]);
    source.parts[0]!.measures[0]!.sequences[0]!.content = [note("before", "quarter"), note("selected", "quarter")];
    source.parts[0]!.measures[0]!.dynamics = [dynamic("d", 0.5)];
    const paste = roundTrip(
      copy(source, {
        kind: "range",
        startElementId: "p0/m0/dynd",
        endElementId: "p0/m0/s0/selected",
      }),
    );
    expect(offsetBeats(paste.tracks![0]!.leadIn)).toBe(0.5);
    expect(offsetBeats(paste.tracks![0]!.dynamics![0]!.offset)).toBe(0);
    const target = score([1]);
    target.parts[0]!.measures[0]!.sequences[0]!.content = [];
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.dynamics).toMatchObject([{ position: { fraction: [0, 16] } }]);
    expect(onsets(result.parts[0]!.measures[0]!.sequences[0]!.content)[0]?.[1]).toBe(0.5);
  });

  it("uses inherited meters for annotation origins before a delayed note", () => {
    const source = score([1], 3);
    source.global.measures[0]!.time = { count: 3, unit: 4 };
    delete source.global.measures[1]!.time;
    source.global.measures[2]!.time = { count: 5, unit: 8 };
    source.parts[0]!.measures[1]!.dynamics = [dynamic("d", 2.5)];
    source.parts[0]!.measures[2]!.dynamics = [dynamic("e", 0)];
    const paste = roundTrip(
      copy(source, {
        kind: "range",
        startElementId: "p0/m1/dynd",
        endElementId: "p0/m2/s0/p0m2s0",
      }),
    );
    expect(offsetBeats(paste.tracks![0]!.leadIn)).toBe(0.5);
    expect(paste.tracks![0]!.dynamics?.map((item) => offsetBeats(item.offset))).toEqual([0, 0.5]);
    const target = score([1], 2);
    target.parts[0]!.measures[0]!.sequences[0]!.content = [];
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.dynamics?.map((item) => item.position.fraction)).toEqual([
      [0, 16],
      [2, 16],
    ]);
  });

  it("rebases a selected multi-selection dynamic before its note without losing the note delay", () => {
    const source = score([1]);
    source.parts[0]!.measures[0]!.sequences[0]!.content = [note("before", "quarter"), note("selected", "quarter")];
    source.parts[0]!.measures[0]!.dynamics = [dynamic("d", 0)];
    const paste = roundTrip(
      copy(source, {
        kind: "multi",
        elementIds: ["p0/m0/s0/selected", "p0/m0/dynd", "p0/m0/dynd"],
      }),
    );
    expect(offsetBeats(paste.tracks![0]!.leadIn)).toBe(1);
    expect(paste.tracks![0]!.dynamics).toHaveLength(1);
    expect(offsetBeats(paste.tracks![0]!.dynamics![0]!.offset)).toBe(0);
    const target = score([1]);
    target.parts[0]!.measures[0]!.sequences[0]!.content = [note("keep", "quarter"), note("replace", "quarter")];
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.dynamics).toMatchObject([{ position: { fraction: [0, 16] } }]);
    expect(onsets(result.parts[0]!.measures[0]!.sequences[0]!.content)[1]).toEqual([
      (paste.content[0] as NoteEvent).id,
      1,
    ]);
  });

  it("deduplicates a selected hairpin and rebases both endpoints from an annotation-first origin", () => {
    const source = score([1], 2);
    source.parts[0]!.measures[0]!.dynamics = [
      {
        id: "hairpin",
        type: "gradual",
        wedgeType: "increasing",
        position: { fraction: [3, 4] },
        end: { measure: "m1", position: { fraction: [1, 4] } },
      },
    ];
    const paste = roundTrip(
      copy(source, {
        kind: "range",
        startElementId: "p0/m0/hairpinhairpin",
        endElementId: "p0/m1/s0/p0m1s0",
      }),
    );
    expect(paste.tracks![0]!.dynamics).toHaveLength(1);
    const captured = paste.tracks![0]!.dynamics![0]!;
    expect(offsetBeats(captured.offset)).toBe(0);
    expect(offsetBeats(captured.endOffset)).toBe(2);
    const target = score([1], 2);
    target.parts[0]!.measures[0]!.sequences[0]!.content = [];
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.dynamics).toMatchObject([
      {
        type: "gradual",
        position: { fraction: [0, 16] },
        end: { measure: "m0", position: { fraction: [8, 16] } },
      },
    ]);
  });

  it("preserves a gradual endpoint at the final barline without requiring another measure", () => {
    const source = score([1]);
    source.parts[0]!.measures[0]!.dynamics = [
      {
        id: "hairpin",
        type: "gradual",
        wedgeType: "increasing",
        position: { fraction: [0, 1] },
        end: { measure: "m0", position: { fraction: [1, 1] } },
      },
    ];
    const result = applyPaste(score([1]), roundTrip(copy(source)), 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.dynamics).toMatchObject([
      {
        type: "gradual",
        end: { measure: "m0", position: { fraction: [16, 16] } },
      },
    ]);
  });

  it.each([false, true])("rebases dynamics merged from a later measure repeat (gradual: %s)", (gradual) => {
    const source = score([1, 1], 2);
    source.parts[0]!.measures[0]!.dynamics = [dynamic("first", 0)];
    source.parts[0]!.measures[1]!.measureRepeat = { numMeasures: 1 };
    source.parts[0]!.measures[1]!.dynamics = [
      gradual
        ? {
            id: "repeat-dynamic",
            type: "gradual",
            wedgeType: "increasing",
            position: { fraction: [0, 1] },
            end: { measure: "m1", position: { fraction: [3, 4] } },
          }
        : dynamic("repeat-dynamic", 0),
    ];
    const paste = roundTrip(
      copy(source, {
        kind: "multi",
        elementIds: ["p0/m0/s0/p0m0s0", "p1/m0/s0/p1m0s0", "p0/m0/dynfirst", "p0/m1/measurerepeat"],
      }),
    );
    expect(offsetBeats(paste.dynamics!.find((item) => item.dynamic.id === "repeat-dynamic")!.offset)).toBe(4);
    const result = applyPaste(score([1, 1], 2), paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.dynamics).toHaveLength(1);
    expect(result.parts[0]!.measures[1]!.dynamics).toHaveLength(1);
    expect(result.parts[0]!.measures[1]!.dynamics![0]!.position.fraction).toEqual([0, 16]);
    if (gradual) {
      expect(result.parts[0]!.measures[1]!.dynamics![0]).toMatchObject({
        end: { measure: "m1", position: { fraction: [12, 16] } },
      });
    }
  });

  it("uses an earlier measure repeat's dynamic as the common origin without negative offsets", () => {
    const source = score([1], 3);
    source.parts[0]!.measures[1]!.measureRepeat = { numMeasures: 1 };
    source.parts[0]!.measures[1]!.dynamics = [dynamic("repeat-dynamic", 0)];
    const paste = roundTrip(
      copy(source, {
        kind: "multi",
        elementIds: ["p0/m2/s0/p0m2s0", "p0/m1/measurerepeat"],
      }),
    );
    expect(offsetBeats(paste.tracks![0]!.leadIn)).toBe(4);
    expect(offsetBeats(paste.dynamics![0]!.offset)).toBe(0);
    const result = applyPaste(score([1], 3), paste, 0, 1, 0, 0);
    expect(result.parts[0]!.measures[1]!.dynamics).toMatchObject([{ position: { fraction: [0, 16] } }]);
    expect(result.parts[0]!.measures[2]!.sequences[0]!.content[0]).toEqual(paste.content[0]);
  });
});

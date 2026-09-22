import { describe, expect, it } from "vitest";
import type { ChordSymbol, DynamicGroup, NoteEvent, Score, SequenceContent } from "@viritura/core";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
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

function harmony(step: "C" | "D" | "E" | "F" | "G" = "C"): ChordSymbol {
  return {
    root: { step },
    quality: "minor",
    position: { fraction: [0, 1] },
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
  it("captures global Cm on the first staff without changing the uncopied second sequence", () => {
    const source = score([2]);
    source.parts[0]!.measures[0]!.sequences.splice(1);
    source.global.measures[0]!.chordSymbols = [harmony()];
    const selection = copy(source);
    const paste = roundTrip(selection);
    expect(paste.tracks).toMatchObject([{ staffOffset: 0, sourceStaff: 1 }]);
    expect(paste.chordSymbols).toMatchObject([{ staffOffset: 0, chordSymbol: harmony() }]);
    const target = score([2]);
    target.parts[0]!.chordSymbolVisibility = "hide";
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]).toEqual(paste.content[0]);
    expect(result.parts[0]!.measures[0]!.sequences[1]).toEqual(target.parts[0]!.measures[0]!.sequences[1]);
    expect(result.global.measures[0]!.chordSymbols).toMatchObject([{ root: { step: "C" }, quality: "minor" }]);
    expect(result.parts[0]!.chordSymbolVisibility).toBe("show");
  });

  it("maps a singleton lower-staff range's dynamics without capturing first-staff harmony", () => {
    const source = score([2], 2);
    for (const measure of source.global.measures) measure.chordSymbols = [harmony()];
    for (const measure of source.parts[0]!.measures) {
      measure.dynamics = [dynamic("same-id-in-different-measures", 0, 2)];
    }
    const selection = copy(source, {
      kind: "range",
      startElementId: "p0/m0/s1/p0m0s1",
      endElementId: "p0/m1/s1/p0m1s1",
    });
    expect(selection.tracks).toBeUndefined();
    const paste = roundTrip(selection);
    expect(paste.chordSymbols ?? []).toEqual([]);
    expect(paste.dynamics?.map((item) => item.staffOffset)).toEqual([0, 0]);
    const target = score([1], 2);
    target.parts[0]!.chordSymbolVisibility = "hide";
    for (const measure of target.global.measures) measure.chordSymbols = [harmony("D")];
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    for (const [index, measure] of result.parts[0]!.measures.entries()) {
      expect(measure.sequences[0]!.content[0]).toEqual(paste.content[index]);
      expect(measure.dynamics).toMatchObject([{ staff: 1, position: { fraction: [0, 16] } }]);
      expect(result.global.measures[index]!.chordSymbols).toEqual([harmony("D")]);
    }
    expect(result.parts[0]!.chordSymbolVisibility).toBe("hide");
  });

  it("does not attach first-staff harmony to a single lower-staff note without tracks", () => {
    const source = score([2]);
    source.global.measures[0]!.chordSymbols = [harmony()];
    const selection = copy(source, { kind: "single", elementId: "p0/m0/s1/p0m0s1" });
    expect(selection.tracks).toBeUndefined();
    const paste = roundTrip(selection);
    expect(paste.chordSymbols ?? []).toEqual([]);
    const result = applyPaste(score([1]), paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]).toEqual(paste.content[0]);
    expect(result.global.measures[0]!.chordSymbols).toBeUndefined();
  });

  it.each([undefined, 1])("maps default/explicit staff %s dynamics while keeping singleton harmony global", (staff) => {
    const source = score([1]);
    source.global.measures[0]!.chordSymbols = [harmony()];
    source.parts[0]!.measures[0]!.dynamics = [dynamic("default-staff", 0, staff)];
    for (const selection of [
      { kind: "single", elementId: "p0/m0/s0/p0m0s0" } as const,
      { kind: "range", startElementId: "p0/m0/s0/p0m0s0", endElementId: "p0/m0/s0/p0m0s0" } as const,
    ]) {
      const target = score([2]);
      target.parts[0]!.chordSymbolVisibility = "hide";
      const result = applyPaste(target, roundTrip(copy(source, selection)), 0, 0, 1, 0);
      expect(result.global.measures[0]!.chordSymbols).toMatchObject([harmony()]);
      expect(result.parts[0]!.chordSymbolVisibility).toBe("show");
      if (selection.kind === "range") {
        expect(result.parts[0]!.measures[0]!.dynamics).toMatchObject([{ staff: 2 }]);
      }
    }
  });

  it("maps five physical staves across mismatched multipart layouts without counting annotations", () => {
    const source = score([2, 1, 2]);
    const roots = ["C", "D", "E", "F", "G"] as const;
    for (const part of source.parts) {
      const measure = part.measures[0]!;
      measure.dynamics = [];
      for (let staff = 1; staff <= part.staves!; staff++) {
        measure.dynamics.push(dynamic("same-id-across-staves-and-parts", 0, staff));
      }
    }
    const selection = copy(source);
    // Imported harmony can retain several source staves before global conflict resolution.
    selection.chordSymbols = roots
      .map((root, staffOffset) => ({
        staffOffset,
        sourceStaff: [1, 2, 1, 1, 2][staffOffset]!,
        measureOffset: 0,
        chordSymbol: {
          ...harmony(root),
          bass: { step: "G" as const, alter: 1 },
          position: { fraction: [staffOffset + 1, 3 * (staffOffset + 1)] as [number, number] },
        },
      }))
      .reverse();
    const paste = roundTrip(selection);
    expect(paste.chordSymbols?.map((item) => item.staffOffset)).toEqual([4, 3, 2, 1, 0]);
    const target = score([1, 2, 1, 1]);
    for (const part of target.parts) {
      part.chordSymbolVisibility = "hide";
      part.transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
    }
    const untouched = { ...harmony("F"), position: { fraction: [1, 4] as [number, number] } };
    target.global.measures[0]!.chordSymbols = [untouched, { ...harmony("D"), position: { fraction: [2, 6] } }];
    const snapshot = structuredClone(target);
    const warnings: string[] = [];
    const result = applyPaste(target, paste, 0, 0, 0, 0, undefined, undefined, (warning) => warnings.push(warning));
    expect(result.global.measures[0]!.chordSymbols).toEqual([
      untouched,
      { ...harmony("C"), bass: { step: "G", alter: 1 }, position: { fraction: [1, 3] } },
    ]);
    expect(warnings).toHaveLength(4);
    expect(warnings.every((warning) => /conflict/i.test(warning))).toBe(true);
    expect(target).toEqual(snapshot);
    let physicalStaff = 0;
    for (const part of result.parts) {
      const measure = part.measures[0]!;
      for (let staff = 1; staff <= part.staves!; staff++) {
        expect(measure.dynamics?.filter((item) => item.staff === staff)).toHaveLength(1);
        expect(measure.sequences[staff - 1]!.content[0]).toEqual(paste.tracks![physicalStaff]!.content[0]);
        physicalStaff++;
      }
      expect(part.chordSymbolVisibility).toBe("show");
      for (const measure of part.measures) expect(measure).not.toHaveProperty("chordSymbols");
    }
  });

  it("deduplicates equivalent harmony without warnings and shows every mapped destination", () => {
    const selection = copy(score([1, 1]));
    selection.chordSymbols = [1, 0].map((staffOffset) => ({
      staffOffset,
      sourceStaff: 1,
      measureOffset: 0,
      chordSymbol: {
        ...harmony(),
        root: { step: "C", ...(staffOffset === 1 ? { alter: 0 } : {}) },
        position: { fraction: [staffOffset + 1, 3 * (staffOffset + 1)] },
      },
    }));
    const target = score([1, 1]);
    for (const part of target.parts) part.chordSymbolVisibility = "hide";
    const warnings: string[] = [];
    const result = applyPaste(target, roundTrip(selection), 0, 0, 0, 0, undefined, undefined, (warning) =>
      warnings.push(warning),
    );
    expect(result.global.measures[0]!.chordSymbols).toEqual([{ ...harmony(), position: { fraction: [1, 3] } }]);
    expect(result.parts.map((part) => part.chordSymbolVisibility)).toEqual(["show", "show"]);
    expect(warnings).toEqual([]);
  });

  it.each(["hide", "show"] as const)("captures harmony only from the scoped %s part", (visibility) => {
    const source = score([1, 2]);
    source.global.measures[0]!.chordSymbols = [harmony()];
    source.parts[0]!.chordSymbolVisibility = "show";
    source.parts[1]!.chordSymbolVisibility = visibility;
    const paste = roundTrip(
      copy(source, {
        kind: "measure",
        startPartIndex: 1,
        endPartIndex: 1,
        startMeasure: 0,
        endMeasure: 0,
      }),
    );
    expect(paste.tracks?.map((track) => track.staffOffset)).toEqual([0, 1]);
    if (visibility === "hide") {
      expect(paste.chordSymbols ?? []).toEqual([]);
    } else {
      expect(paste.chordSymbols).toMatchObject([{ staffOffset: 0, chordSymbol: harmony() }]);
    }
  });

  it("rejects legacy physical tracks without a source-staff coordinate instead of guessing", () => {
    const target = score([2]);
    const snapshot = structuredClone(target);
    expect(() =>
      applyPaste(
        target,
        {
          content: [note("legacy")],
          tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [note("legacy")] }],
          chordSymbols: [{ measureOffset: 0, sourceStaff: 2, chordSymbol: harmony() }],
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
    const selection = copy(source);
    selection.chordSymbols = [{ measureOffset: 0, staffOffset: 1, sourceStaff: 2, chordSymbol: harmony() }];
    const paste = roundTrip(selection);
    expect(paste.chordSymbols![0]!.sourceStaff).toBe(2);
    delete paste.chordSymbols![0]!.staffOffset;
    const target = score([1, 1]);
    for (const part of target.parts) part.chordSymbolVisibility = "hide";
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.global.measures[0]!.chordSymbols).toMatchObject([harmony()]);
    expect(result.parts.map((part) => part.chordSymbolVisibility)).toEqual(["show", "show"]);
    expect(result.parts[1]!.measures[0]!.sequences).toEqual(target.parts[1]!.measures[0]!.sequences);
  });

  it("uses the lower selection anchor across multiple source parts with different destination grouping", () => {
    const source = score([3, 2]);
    source.parts[0]!.measures[0]!.sequences.splice(0, 1);
    source.global.measures[0]!.chordSymbols = [harmony("E")];
    source.parts[1]!.chordSymbolVisibility = "show";
    const paste = roundTrip(
      copy(source, {
        kind: "range",
        startElementId: "p0/m0/s0/p0m0s1",
        endElementId: "p1/m0/s1/p1m0s1",
      }),
    );
    expect(paste.chordSymbols?.map((item) => item.staffOffset)).toEqual([2]);
    expect(paste.tracks?.map((track) => track.staffOffset)).toEqual([0, 1, 2, 3]);
    const target = score([1, 3]);
    for (const part of target.parts) part.chordSymbolVisibility = "hide";
    const result = applyPaste(target, paste, 0, 0, 0, 0);
    expect(result.global.measures[0]!.chordSymbols).toMatchObject([harmony("E")]);
    expect(result.parts.map((part) => part.chordSymbolVisibility)).toEqual(["hide", "show"]);
    const sequences = result.parts.flatMap((part) => part.measures[0]!.sequences);
    expect(sequences.map((sequence) => sequence.content[0])).toEqual(paste.tracks!.map((track) => track.content[0]));
  });
});

describe("clipboard common annotation and note origin", () => {
  it.each(["range", "reverse", "multi"] as const)(
    "keeps harmony before the first selected note in a %s selection",
    (kind) => {
      const source = score([1], 2);
      source.global.measures[0]!.chordSymbols = [{ ...harmony(), position: { fraction: [3, 4] } }, harmony("D")];
      source.global.measures[1]!.chordSymbols = [harmony("E")];
      const snapshot = structuredClone(source);
      const chordId = "m0/chord0";
      const noteId = "p0/m1/s0/p0m1s0";
      const selection = copy(
        source,
        kind === "multi"
          ? { kind: "multi", elementIds: [noteId, chordId, chordId] }
          : {
              kind: "range",
              startElementId: kind === "reverse" ? noteId : chordId,
              endElementId: kind === "reverse" ? chordId : noteId,
            },
      );
      expect(selection).toMatchObject({ captureOrigin: { measureIndex: 0, beat: 3 } });
      expect(selection.cutAnnotationLocations).toContainEqual({
        kind: "global",
        type: "chord",
        measureIndex: 0,
        annotationIndex: 0,
      });
      const paste = roundTrip(selection);
      expect(offsetBeats(paste.tracks![0]!.leadIn)).toBe(1);
      expect(
        paste.chordSymbols?.map((item) => [
          item.chordSymbol.root.step,
          item.measureOffset,
          item.staffOffset,
          offsetBeats(item.offset),
        ]),
      ).toEqual(
        kind === "multi"
          ? [["C", 0, 0, 0]]
          : [
              ["C", 0, 0, 0],
              ["E", 1, 0, 1],
            ],
      );
      expect(source).toEqual(snapshot);
    },
  );

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

describe("clipboard exact capture timing", () => {
  it.each([0, 16])("pads fractional measure %s without moving the next measure's onset", (measureIndex) => {
    const source = score([1], measureIndex + 2);
    source.parts[0]!.measures[measureIndex]!.sequences[0]!.content = [
      { type: "space", duration: [1, 12] },
      note("first", "quarter"),
    ];
    source.parts[0]!.measures[measureIndex + 1]!.sequences[0]!.content = [note("next", "quarter")];
    const paste = roundTrip(copy(source));
    expect(paste.content[measureIndex + 2]).toEqual({ type: "space", duration: [2, 3] });
    expect(
      onsets(paste.content)
        .slice(-2)
        .map(([, beat]) => beat),
    ).toEqual([measureIndex * 4 + 1 / 3, (measureIndex + 1) * 4]);
  });

  it.each(["range", "multi", "placed"] as const)("preserves a fractional %s lead-in", (kind) => {
    const source = score([1]);
    source.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "space", duration: [1, 8] },
      note("selected", "quarter"),
    ];
    source.global.measures[0]!.chordSymbols = [{ ...harmony(), position: { fraction: [1, 24] } }];
    source.parts[0]!.measures[0]!.dynamics = [dynamic("selected", 0.5)];
    const elementIds = ["m0/chord0", "p0/m0/s0/selected", "p0/m0/dynselected"];
    const selection: SelectionState =
      kind === "range"
        ? { kind: "range", startElementId: elementIds[0]!, endElementId: elementIds[1]! }
        : {
            kind: "multi",
            elementIds,
            ...(kind === "placed"
              ? { rhythmicRange: { start: { measureIndex: 0, beat: 1 / 6 }, end: { measureIndex: 0, beat: 1.5 } } }
              : {}),
          };
    const paste = roundTrip(copy(source, selection));
    expect(paste.tracks![0]!.leadIn).toEqual([1, 12]);
    expect(offsetBeats(paste.chordSymbols![0]!.offset)).toBe(0);
    expect(paste.tracks![0]!.dynamics![0]!.offset).toEqual([1, 12]);
  });

  it("fails without mutating the source when generated padding cannot be represented exactly", () => {
    const source = score([1]);
    source.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "space", duration: [1, 65537] },
      note("selected", "quarter"),
    ];
    const snapshot = structuredClone(source);
    expect(() => copy(source)).toThrow(/exact/i);
    expect(source).toEqual(snapshot);
  });
});

import { describe, expect, it } from "vitest";
import type { ChordSymbol, NoteEvent, Score, SequenceContent } from "@viritura/core";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { computePasteResult, findPlacedSelection } from "../clipboard/computePasteResult";
import { computeRepeatResult } from "../clipboard/computeRepeatResult";
import { deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import {
  applyCut,
  applyPaste,
  pasteResultFromFragment,
  type ClipboardSelection,
  type PasteResult,
} from "../commands/clipboardCommands";
import type { SelectionState } from "../store/selectionStore";

function eighth(id: string): NoteEvent {
  return { type: "event", id, duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 3 } }] };
}

function score(layout: number[], measures = 3): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: measures }, (_, index) => ({ id: `m${index}`, time: { count: 6, unit: 8 } })),
    },
    parts: layout.map((staves, part) => ({
      staves,
      measures: Array.from({ length: measures }, (_, measure) => ({
        sequences: Array.from({ length: staves }, (_, staff) => ({
          staff: staff + 1,
          content: Array.from({ length: 6 }, (_, event) => eighth(`p${part}m${measure}s${staff}e${event}`)),
        })),
      })),
    })),
  };
}

function pianoPaste(lowerHarmony = false, voices = 1): PasteResult {
  const upper: NoteEvent[] = [0, 1].map((index) => ({
    ...eighth(`upper-${index}`),
    duration: { base: "quarter", dots: 1 },
  }));
  const lower = Array.from({ length: 6 }, (_, index) => eighth(`lower-${index}`));
  return {
    content: upper,
    sourceTimeSignature: { count: 6, unit: 8 },
    tracks: [upper, lower].flatMap((content, staffOffset) =>
      Array.from({ length: voices }, (_, voiceIndex) => ({
        partOffset: 0,
        staffOffset,
        sourceStaff: staffOffset + 1,
        voiceIndex,
        content: content.map((event) => ({ ...event, id: `${event.id}-v${voiceIndex}` })),
      })),
    ),
    dynamics: [
      {
        partOffset: 0,
        staffOffset: 1,
        measureOffset: 0,
        offset: [0, 1],
        dynamic: { id: "mp", type: "immediate", value: "mp", position: { fraction: [0, 1] } },
      },
    ],
    chordSymbols: [
      {
        partOffset: 0,
        staffOffset: lowerHarmony ? 1 : 0,
        sourceStaff: lowerHarmony ? 2 : 1,
        measureOffset: 0,
        offset: [0, 1],
        chordSymbol: { root: { step: "C" }, quality: "minor", position: { fraction: [0, 1] } },
      },
      {
        partOffset: 0,
        staffOffset: lowerHarmony ? 1 : 0,
        sourceStaff: lowerHarmony ? 2 : 1,
        measureOffset: 0,
        offset: [3, 8],
        chordSymbol: { root: { step: "E", alter: -1 }, quality: "major", position: { fraction: [3, 8] } },
      },
    ],
  };
}

function roundTrip(selection: ClipboardSelection): PasteResult {
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
  )!;
  expect(fragment).not.toBeNull();
  expect(fragment.chordSymbols ?? []).toEqual(selection.chordSymbols ?? []);
  expect(fragment.dynamics ?? []).toEqual(selection.dynamics ?? []);
  return pasteResultFromFragment(fragment);
}

function dynamics(paste: PasteResult) {
  return paste.tracks?.flatMap((track) => track.dynamics ?? []) ?? paste.dynamics ?? [];
}

function offsetValue(offset: [number, number] | undefined): number {
  expect(offset).toBeDefined();
  return offset![0] / offset![1];
}

describe("secondary physical staff annotation capture", () => {
  it("uses each staff's selected intervals and captures global harmony only through the first staff", () => {
    const source = score([2], 1);
    source.global.measures[0]!.time = { count: 4, unit: 4 };
    const measure = source.parts[0]!.measures[0]!;
    measure.sequences = [
      { staff: 1, content: Array.from({ length: 8 }, (_, index) => eighth(`upper-${index}`)) },
      { staff: 2, content: Array.from({ length: 8 }, (_, index) => eighth(`lower-${index}`)) },
      { staff: 2, content: [{ type: "space", duration: [5, 8] }, eighth("lower-voice")] },
    ];
    const positions = [{ staff: 1, beat: 3.5 }, ...[0, 2, 2.5, 3, 3.5].map((beat) => ({ staff: 2, beat }))];
    measure.dynamics = positions.map(({ staff, beat }) => ({
      id: `staff-${staff}-beat-${beat}`,
      type: "immediate",
      value: "mf",
      staff,
      position: { fraction: [beat * 2, 8] },
    }));
    source.global.measures[0]!.chordSymbols = [0, 2, 2.5, 3, 3.5].map((beat) => ({
      root: { step: "C" },
      quality: "minor",
      position: { fraction: [beat * 2, 8] },
    }));
    const snapshot = structuredClone(source);
    const captured = roundTrip(
      buildClipboardSelection(source, {
        kind: "multi",
        elementIds: [
          ...Array.from({ length: 8 }, (_, index) => `p0/m0/s0/upper-${index}`),
          "p0/m0/s1/lower-4",
          "p0/m0/s1/lower-5",
          "p0/m0/s2/lower-voice",
        ],
        rhythmicRange: {
          start: { measureIndex: 0, beat: 0 },
          end: { measureIndex: 0, beat: 4 },
          tracks: [
            {
              partIndex: 0,
              staff: 1,
              voice: 0,
              start: { measureIndex: 0, beat: 0 },
              end: { measureIndex: 0, beat: 4 },
            },
            {
              partIndex: 0,
              staff: 2,
              voice: 0,
              start: { measureIndex: 0, beat: 2 },
              end: { measureIndex: 0, beat: 3 },
            },
            {
              partIndex: 0,
              staff: 2,
              voice: 1,
              start: { measureIndex: 0, beat: 2.5 },
              end: { measureIndex: 0, beat: 3 },
            },
          ],
        },
      })!,
    );
    expect(dynamics(captured).map((item) => item.dynamic.id)).toEqual([
      "staff-1-beat-3.5",
      "staff-2-beat-2",
      "staff-2-beat-2.5",
    ]);
    expect(captured.chordSymbols?.map((item) => [item.staffOffset, offsetValue(item.offset) * 4])).toEqual([
      [0, 0],
      [0, 2],
      [0, 2.5],
      [0, 3],
      [0, 3.5],
    ]);
    expect(source).toEqual(snapshot);
  });

  it("recaptures a lower-staff hairpin ending exactly at a rebarred 6/8 selection end", () => {
    const paste = pianoPaste(true, 2);
    paste.dynamics!.push({
      partOffset: 0,
      staffOffset: 1,
      measureOffset: 0,
      endMeasureOffset: 0,
      offset: [1, 8],
      endOffset: [3, 4],
      dynamic: {
        id: "lower-hairpin",
        type: "gradual",
        wedgeType: "increasing",
        position: { fraction: [1, 8] },
        end: { measure: "source", position: { fraction: [3, 4] } },
      },
    });
    const target = score([1, 2]);
    for (const measure of target.global.measures) measure.time = { count: 2, unit: 4 };
    for (const part of target.parts) {
      for (const measure of part.measures) {
        for (const sequence of measure.sequences) sequence.content.splice(4);
      }
    }
    const placed: SequenceContent[] = [];
    const result = applyPaste(target, paste, 1, 1, 0, 0, placed);
    expect(result.parts[1]!.measures[1]!.dynamics).toEqual([
      {
        id: expect.any(String),
        type: "immediate",
        value: "mp",
        staff: 2,
        position: { fraction: [0, 16] },
      },
      {
        id: expect.any(String),
        type: "gradual",
        wedgeType: "increasing",
        staff: 2,
        position: { fraction: [2, 16] },
        end: { measure: "m2", position: { fraction: [4, 16] } },
      },
    ]);
    const selection = findPlacedSelection(result, placed, 1, 0).selection!;
    expect(selection).toMatchObject({ rhythmicRange: { end: { measureIndex: 2, beat: 1 } } });
    const captured = roundTrip(buildClipboardSelection(result, selection)!);
    expect(dynamics(captured)).toHaveLength(2);
    const hairpin = dynamics(captured).find((item) => item.dynamic.type === "gradual")!;
    expect(hairpin.staffOffset).toBe(1);
    expect(offsetValue(hairpin.offset)).toBe(1 / 8);
    expect(offsetValue(hairpin.endOffset)).toBe(3 / 4);
    expect(hairpin.endMeasureOffset).toBe(1);
    const repasted = applyPaste(score([1, 1]), captured, 0, 0, 0, 0);
    expect(repasted.parts[1]!.measures[0]!.dynamics).toEqual([
      {
        id: expect.any(String),
        type: "immediate",
        value: "mp",
        staff: 1,
        position: { fraction: [0, 16] },
      },
      {
        id: expect.any(String),
        type: "gradual",
        wedgeType: "increasing",
        staff: 1,
        position: { fraction: [2, 16] },
        end: { measure: "m0", position: { fraction: [12, 16] } },
      },
    ]);
  });

  it.each([
    { layout: [2], lowerPart: 0, lowerStaff: 2 },
    { layout: [1, 1], lowerPart: 1, lowerStaff: 1 },
  ])("routes the piano into $layout and recaptures once across voices", ({ layout, lowerPart, lowerStaff }) => {
    for (const lowerHarmony of [false, true]) {
      const target = score([1, ...layout]);
      for (const part of target.parts) part.chordSymbolVisibility = "hide";
      const snapshot = structuredClone(target);
      const placed: SequenceContent[] = [];
      const result = applyPaste(target, pianoPaste(lowerHarmony, 2), 1, 1, 0, 1, placed);
      expect(target).toEqual(snapshot);
      const lower = result.parts[lowerPart + 1]!.measures[1]!;
      expect(lower.dynamics).toEqual([
        {
          id: expect.any(String),
          type: "immediate",
          value: "mp",
          staff: lowerStaff,
          position: { fraction: [2, 16] },
        },
      ]);
      expect(result.parts.flatMap((part) => part.measures.flatMap((measure) => measure.dynamics ?? []))).toHaveLength(
        1,
      );
      const symbols = result.global.measures.flatMap((measure) => measure.chordSymbols ?? []);
      expect(symbols).toHaveLength(2);
      expect
        .soft(result.parts.map((part) => part.chordSymbolVisibility))
        .toEqual(["hide", ...layout.map(() => "show")]);
      expect(symbols).toEqual([
        { root: { step: "C" }, quality: "minor", position: { fraction: [1, 8] } },
        { root: { step: "E", alter: -1 }, quality: "major", position: { fraction: [1, 2] } },
      ]);
      expect(symbols.map((symbol) => symbol.position.fraction[0] / symbol.position.fraction[1])).toEqual([
        1 / 8,
        1 / 2,
      ]);
      const selection = findPlacedSelection(result, placed, 1, 0.5).selection!;
      const captured = roundTrip(buildClipboardSelection(result, selection)!);
      expect(captured.tracks).toHaveLength(4);
      expect(dynamics(captured)).toMatchObject([
        { staffOffset: 1, dynamic: { type: "immediate", value: "mp", staff: lowerStaff } },
      ]);
      expect(dynamics(captured)).toHaveLength(1);
      expect(offsetValue(dynamics(captured)[0]!.offset)).toBe(0);
      expect(captured.chordSymbols?.map((item) => [item.staffOffset, offsetValue(item.offset)])).toEqual([
        [0, 0],
        [0, 3 / 8],
      ]);
      const repasted = applyPaste(score([2]), captured, 0, 0, 0, 0);
      expect(repasted.parts[0]!.measures[0]!.dynamics).toEqual([
        {
          id: expect.any(String),
          type: "immediate",
          value: "mp",
          staff: 2,
          position: { fraction: [0, 16] },
        },
      ]);
      expect(repasted.global.measures[0]!.chordSymbols).toEqual([
        { root: { step: "C" }, quality: "minor", position: { fraction: [0, 1] } },
        { root: { step: "E", alter: -1 }, quality: "major", position: { fraction: [3, 8] } },
      ]);
      expect(repasted.parts[0]!.chordSymbolVisibility).toBe("show");
    }
  });

  it.each(["single", "range", "placed"] as const)(
    "copies lower-staff dynamics but not global harmony for a %s selection",
    (kind) => {
      const source = applyPaste(score([1, 2]), pianoPaste(true), 1, 1, 0, 0);
      const measure = source.parts[1]!.measures[1]!;
      measure.dynamics!.unshift({
        id: "upper",
        type: "immediate",
        value: "ff",
        staff: 1,
        position: { fraction: [0, 1] },
      });
      const globalHarmony: ChordSymbol = {
        root: { step: "G" },
        quality: "major",
        position: { fraction: [1, 4] },
      };
      source.global.measures[1]!.chordSymbols!.splice(1, 0, globalHarmony);
      const harmonySnapshot = structuredClone(source.global.measures[1]!.chordSymbols);
      const ids = measure.sequences[1]!.content.map((item) => `p1/m1/s1/${(item as NoteEvent).id}`);
      const selection: SelectionState =
        kind === "single"
          ? { kind: "single", elementId: ids[0]! }
          : kind === "range"
            ? { kind: "range", startElementId: ids[0]!, endElementId: ids.at(-1)! }
            : {
                kind: "multi",
                elementIds: ids,
                rhythmicRange: {
                  start: { measureIndex: 1, beat: 0 },
                  end: { measureIndex: 1, beat: 3 },
                  tracks: [
                    {
                      partIndex: 1,
                      staff: 2,
                      voice: 0,
                      start: { measureIndex: 1, beat: 0 },
                      end: { measureIndex: 1, beat: 3 },
                    },
                  ],
                },
              };
      const copied = buildClipboardSelection(source, selection)!;
      const captured = roundTrip(copied);
      expect(dynamics(captured)).toHaveLength(1);
      expect(dynamics(captured)[0]).toMatchObject({
        staffOffset: 0,
        dynamic: { type: "immediate", value: "mp", staff: 2 },
      });
      expect(captured.chordSymbols ?? []).toEqual([]);
      const result = applyPaste(score([1]), captured, 0, 0, 0, 0);
      expect(result.parts[0]!.measures[0]!.dynamics).toEqual([
        {
          id: expect.any(String),
          type: "immediate",
          value: "mp",
          staff: 1,
          position: { fraction: [0, 16] },
        },
      ]);
      expect(result.global.measures.flatMap((item) => item.chordSymbols ?? [])).toEqual([]);
      if (kind === "range") {
        const cut = applyCut(source, {
          partIndex: copied.partIndex,
          measureIndex: copied.measureIndex,
          sequenceIndex: copied.sequenceIndex,
          eventIndex: copied.eventIndex,
          replacements: copied.events.map((event) => ({
            type: "event",
            duration: (event as NoteEvent).duration,
            rest: {},
          })),
          cutLocations: copied.cutLocations,
          cutAnnotationLocations: copied.cutAnnotationLocations,
        });
        expect(cut.global.measures[1]!.chordSymbols).toEqual(harmonySnapshot);
        expect(cut.parts[1]!.measures[1]!.dynamics).toMatchObject([{ id: "upper", staff: 1 }]);
        expect(cut.parts[1]!.measures[1]!.dynamics).toHaveLength(1);
      }
    },
  );

  it.each(["single", "range", "placed"] as const)(
    "excludes annotations starting at the %s selection end but retains its hairpin endpoint",
    (kind) => {
      const source = applyPaste(score([2]), pianoPaste(true), 0, 0, 0, 0);
      const measure = source.parts[0]!.measures[0]!;
      measure.dynamics!.push(
        {
          id: "hairpin",
          type: "gradual",
          staff: 2,
          wedgeType: "increasing",
          position: { fraction: [0, 1] },
          end: { measure: "m0", position: { fraction: [1, 8] } },
        },
        { id: "next-note", type: "immediate", staff: 2, value: "ff", position: { fraction: [1, 8] } },
      );
      source.global.measures[0]!.chordSymbols![1]!.position.fraction = [1, 8];
      measure.sequences[0]!.content = Array.from({ length: 6 }, (_, index) => eighth(`upper-${index}`));
      const id = `p0/m0/s1/${(measure.sequences[1]!.content[0] as NoteEvent).id}`;
      const selectionFor = (elementId: string): SelectionState =>
        kind === "single"
          ? { kind: "single", elementId }
          : kind === "range"
            ? { kind: "range", startElementId: elementId, endElementId: elementId }
            : {
                kind: "multi",
                elementIds: [elementId],
                rhythmicRange: { start: { measureIndex: 0, beat: 0 }, end: { measureIndex: 0, beat: 0.5 } },
              };
      const captured = roundTrip(buildClipboardSelection(source, selectionFor(id))!);
      expect(dynamics(captured)).toHaveLength(2);
      expect(dynamics(captured).map((item) => item.dynamic.type)).toEqual(["immediate", "gradual"]);
      expect(offsetValue(dynamics(captured)[1]!.endOffset)).toBe(1 / 8);
      expect(captured.chordSymbols ?? []).toEqual([]);
      const result = applyPaste(score([2]), captured, 0, 0, 1, 2);
      expect(result.parts[0]!.measures[0]!.dynamics).toEqual([
        {
          id: expect.any(String),
          type: "immediate",
          staff: 2,
          value: "mp",
          position: { fraction: [4, 16] },
        },
        {
          id: expect.any(String),
          type: "gradual",
          wedgeType: "increasing",
          staff: 2,
          position: { fraction: [4, 16] },
          end: { measure: "m0", position: { fraction: [6, 16] } },
        },
      ]);
      expect(result.global.measures[0]!.chordSymbols ?? []).toEqual([]);
      const harmony = roundTrip(buildClipboardSelection(source, selectionFor("p0/m0/s0/upper-0"))!);
      expect(harmony.chordSymbols).toHaveLength(1);
      expect(harmony.chordSymbols![0]!.chordSymbol.root).toEqual({ step: "C" });
      expect(offsetValue(harmony.chordSymbols![0]!.offset)).toBe(0);
      const harmonyResult = applyPaste(score([2]), harmony, 0, 0, 1, 2);
      expect(harmonyResult.global.measures[0]!.chordSymbols).toEqual([
        { root: { step: "C" }, quality: "minor", position: { fraction: [1, 4] } },
      ]);
      expect(harmonyResult.parts[0]!.chordSymbolVisibility).toBe("show");
    },
  );

  it("captures and cuts a selected canonical chord without touching lower-staff dynamics or notes", () => {
    const source = applyPaste(score([2]), pianoPaste(true), 0, 0, 0, 0);
    const snapshot = structuredClone(source);
    const upper = source.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    const copied = buildClipboardSelection(source, {
      kind: "multi",
      elementIds: [`p0/m0/s0/${upper.id}`, "m0/chord0"],
    })!;
    expect(copied).not.toBeNull();
    const captured = roundTrip(copied);
    expect(captured.content).toHaveLength(1);
    expect(captured.chordSymbols).toHaveLength(1);
    expect(captured.chordSymbols![0]).toMatchObject({
      staffOffset: 0,
      chordSymbol: { root: { step: "C" }, quality: "minor" },
    });
    expect(dynamics(captured)).toEqual([]);
    const cut = applyCut(source, {
      partIndex: copied.partIndex,
      measureIndex: copied.measureIndex,
      sequenceIndex: copied.sequenceIndex,
      eventIndex: copied.eventIndex,
      replacements: [{ type: "event", duration: upper.duration, rest: {} }],
      cutLocations: copied.cutLocations,
      cutAnnotationLocations: copied.cutAnnotationLocations,
    });
    expect(cut.global.measures[0]!.chordSymbols).toEqual([snapshot.global.measures[0]!.chordSymbols![1]]);
    expect(cut.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({ rest: {} });
    expect(cut.parts[0]!.measures[0]!.sequences[1]).toEqual(snapshot.parts[0]!.measures[0]!.sequences[1]);
    expect(cut.parts[0]!.measures[0]!.dynamics).toEqual(snapshot.parts[0]!.measures[0]!.dynamics);
    expect(source).toEqual(snapshot);
  });

  it("captures global harmony only from the selected visible part's first staff", () => {
    const source = score([1, 2]);
    source.parts[0]!.chordSymbolVisibility = "hide";
    source.parts[1]!.chordSymbolVisibility = "show";
    const harmony: ChordSymbol = {
      root: { step: "D" },
      quality: "minor",
      position: { fraction: [0, 1] },
    };
    source.global.measures[0]!.chordSymbols = [harmony];
    for (const [part, staff, expected] of [
      [0, 0, false],
      [1, 0, true],
      [1, 1, false],
    ] as const) {
      const captured = roundTrip(
        buildClipboardSelection(source, {
          kind: "single",
          elementId: `p${part}/m0/s${staff}/p${part}m0s${staff}e0`,
        })!,
      );
      expect(captured.chordSymbols ?? []).toHaveLength(expected ? 1 : 0);
      if (expected) {
        expect(captured.chordSymbols![0]).toMatchObject({ staffOffset: 0, chordSymbol: harmony });
      }
    }
  });

  it.each(["sourceStaff", "staffOffset"] as const)(
    "routes transient %s metadata without changing concert harmony in transposing destinations",
    (routing) => {
      const target = score([1, 1, 1]);
      for (const part of target.parts) part.chordSymbolVisibility = "hide";
      target.parts[1]!.transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
      target.parts[2]!.transposition = { interval: { halfSteps: 9, staffDistance: 5 } };
      const paste = pianoPaste(true);
      paste.chordSymbols = [paste.chordSymbols![0]!];
      const captured = paste.chordSymbols[0]!;
      captured.chordSymbol.bass = { step: "B", alter: -1 };
      if (routing === "sourceStaff") delete captured.staffOffset;
      else captured.sourceStaff = 1;
      const targetSnapshot = structuredClone(target);
      const pasteSnapshot = structuredClone(paste);
      const result = applyPaste(target, paste, 1, 0, 0, 0);
      expect(result.global.measures[0]!.chordSymbols).toEqual([captured.chordSymbol]);
      expect.soft(result.parts.map((part) => part.chordSymbolVisibility)).toEqual(["hide", "show", "show"]);
      expect(result.parts.map((part) => part.transposition)).toEqual(target.parts.map((part) => part.transposition));
      expect(target).toEqual(targetSnapshot);
      expect(paste).toEqual(pasteSnapshot);
    },
  );

  it.each([false, true])(
    "merges coincident physical-staff harmony with identical=%s and exposes paste/repeat warnings",
    (identical) => {
      const target = score([2]);
      const retained: ChordSymbol = {
        root: { step: "A" },
        quality: "minor",
        position: { fraction: [1, 4] },
      };
      target.global.measures[0]!.chordSymbols = [
        { root: { step: "F" }, quality: "major", position: { fraction: [2, 16] } },
        retained,
      ];
      const paste = pianoPaste();
      const upper = { ...paste.chordSymbols![0]!, offset: [0, 1] as [number, number] };
      const lower = structuredClone(upper);
      lower.staffOffset = 1;
      lower.sourceStaff = 2;
      lower.offset = [0, 8];
      lower.chordSymbol.position.fraction = [0, 8];
      if (!identical) lower.chordSymbol.root = { step: "G" };
      paste.chordSymbols = [lower, upper];
      const snapshot = structuredClone(target);
      const warnings: string[] = [];
      const placed: SequenceContent[] = [];
      const result = applyPaste(target, paste, 0, 0, 0, 1, placed, 0.5, (message) => warnings.push(message));
      expect(placed.length).toBeGreaterThan(0);
      expect(result.global.measures[0]!.chordSymbols).toEqual([
        { ...upper.chordSymbol, position: { fraction: [1, 8] } },
        retained,
      ]);
      expect(warnings).toHaveLength(identical ? 0 : 1);
      const computed = computePasteResult(target, { kind: "single", elementId: "p0/m0/s0/p0m0s0e1" }, paste)!;
      expect(computed.newScore.global).toEqual(result.global);
      expect(computed.warnings).toEqual(warnings);
      const copied = buildClipboardSelection(target, {
        kind: "single",
        elementId: "p0/m0/s0/p0m0s0e0",
      })!;
      copied.chordSymbols = paste.chordSymbols;
      const repeated = computeRepeatResult(target, copied)!;
      expect(repeated.newScore.global.measures[0]!.chordSymbols).toEqual(result.global.measures[0]!.chordSymbols);
      expect(repeated.warnings).toEqual(warnings);
      expect(target).toEqual(snapshot);
    },
  );
});

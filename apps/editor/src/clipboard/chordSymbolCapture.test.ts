import { describe, expect, it } from "vitest";
import type { ChordSymbol, Score } from "@viritura/core";
import { parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { captureTimedSelection } from "./captureTimedSelection";
import { captureChordSymbols, captureSelectedChordSymbols, clipboardAnnotationLocation } from "./chordSymbolCapture";
import { findPlacedAnnotationIds } from "./annotations/placedSelection";
import { serializeFragment } from "./serialize";
import { deserializeFragment } from "./deserialize";
import type { PasteResult } from "../commands/clipboardCommands";

function fixture(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          chordSymbols: [
            { position: { fraction: [0, 1] }, root: { step: "C" } },
            { position: { fraction: [1, 4] }, root: { step: "G" }, bass: { step: "B" } },
          ],
        },
        { chordSymbols: [{ position: { fraction: [1, 6] }, rawText: "NC" }] },
      ],
    },
    parts: Array.from({ length: 3 }, (_, part) => ({
      id: `part-${part}`,
      staves: 2,
      measures: Array.from({ length: 2 }, (_, measure) => ({
        sequences: [1, 2].map((staff) => ({
          staff,
          content: [
            {
              type: "event" as const,
              id: `note-${part}-${measure}-${staff}`,
              duration: { base: "whole" as const },
              notes: [{ pitch: { step: "C" as const, octave: 4 } }],
            },
          ],
        })),
      })),
    })),
  };
}

const noteSelection = (part: number, staff = 1) => ({
  kind: "single" as const,
  elementType: "event" as const,
  elementId: `p${part}/m0/s${staff - 1}/note-${part}-0-${staff}`,
});

describe("global chord capture", () => {
  it.each([
    { part: 0, visibility: "auto", count: 2 },
    { part: 1, visibility: "auto", count: 0 },
    { part: 1, visibility: "show", count: 2 },
    { part: 0, visibility: "hide", count: 0 },
  ] as const)("scopes $visibility harmony to source part $part", ({ part, visibility, count }) => {
    const score = fixture();
    score.parts[part]!.chordSymbolVisibility = visibility;
    const before = structuredClone(score);
    const captured = buildClipboardSelection(score, noteSelection(part))!;
    expect(captured.chordSymbols).toHaveLength(count);
    expect(score).toEqual(before);
    expect(score.parts.every((source) => source.measures.every((measure) => !("chordSymbols" in measure)))).toBe(true);
  });

  it("does not capture upper-staff harmony incidentally from a lower-staff note", () => {
    const score = fixture();
    score.parts[0]!.chordSymbolVisibility = "show";
    expect(buildClipboardSelection(score, noteSelection(0, 2))!.chordSymbols).toEqual([]);
  });

  it("captures a shared progression only once across shown parts", () => {
    const score = fixture();
    score.parts.forEach((part) => {
      part.chordSymbolVisibility = "show";
    });
    const captured = buildClipboardSelection(score, {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 2,
      startStaffIndex: 0,
      endStaffIndex: 5,
      startMeasure: 0,
      endMeasure: 1,
    })!;
    expect(captured.chordSymbols).toHaveLength(3);
    expect(captured.chordSymbols!.map((symbol) => symbol.offset)).toEqual([
      [0, 1],
      [1, 4],
      [7, 6],
    ]);
  });

  it("preserves root part identities when a structural view starts with a later part and lower staff", () => {
    const score = fixture();
    score.layouts = [
      {
        id: "extracted",
        content: [
          {
            type: "group",
            content: [
              { type: "staff", sources: [{ part: "part-2", staff: 2 }] },
              { type: "staff", sources: [{ part: "part-1" }] },
            ],
          },
        ],
      },
    ];
    score.scores = [{}, { layout: "extracted" }];
    const before = structuredClone(score);
    expect(buildClipboardSelection(score, noteSelection(2, 2), 1)!.chordSymbols).toHaveLength(2);
    expect(buildClipboardSelection(score, noteSelection(0), 1)!.chordSymbols).toEqual([]);
    expect(buildClipboardSelection(score, noteSelection(1), 1)!.chordSymbols).toEqual([]);
    expect(score.parts.map((part) => part.id)).toEqual(["part-0", "part-1", "part-2"]);
    expect(score).toEqual(before);
  });

  it("deduplicates global identities across render copies while retaining source context", () => {
    const score = fixture();
    const locations = ["m0/chord1/p2/staff2", "m0/chord1/p0/staff1", "m0/chord1"].map((id) =>
      clipboardAnnotationLocation(id)!,
    );
    expect(locations[0]).toMatchObject({ kind: "global", partIndex: 2, sourceStaff: 2 });
    const captured = captureSelectedChordSymbols(score, locations, { measureIndex: 0, beat: 0 }, 1, 0);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ partOffset: 1, staffOffset: 3, offset: [1, 4] });
    expect(captured[0]!.chordSymbol).toEqual(score.global.measures[0]!.chordSymbols![1]);
    expect(captured[0]!.chordSymbol).not.toBe(score.global.measures[0]!.chordSymbols![1]);
  });

  it("inherits authored system layouts and respects within-system changes without remapping parts", () => {
    const score = fixture();
    score.global.measures = Array.from({ length: 4 }, (_, index) => ({
      ...structuredClone(score.global.measures[0]!),
      id: `measure-${index}`,
    }));
    score.layouts = [1, 2].map((part) => ({
      id: `layout-${part}`,
      content: [{ type: "staff", sources: [{ part: `part-${part}`, staff: 1 }] }],
    }));
    score.scores = [
      {
        pages: [
          {
            systems: [
              {
                measure: "measure-0",
                layout: "layout-1",
                layoutChanges: [{ location: { measure: "measure-1" }, layout: "layout-2" }],
              },
              { measure: "measure-2" },
              { measure: "measure-3", layout: "layout-2" },
            ],
          },
        ],
      },
    ];
    const captured = (part: number) =>
      captureChordSymbols(score, part, 0, 3, 0, Infinity).map((symbol) => symbol.measureOffset);
    expect(captured(0)).toEqual([]);
    expect(captured(1)).toEqual([0, 0, 2, 2]);
    expect(captured(2)).toEqual([1, 1, 3, 3]);
    expect(score.parts.map((part) => part.id)).toEqual(["part-0", "part-1", "part-2"]);
  });

  it("recovers exact origins after accumulated fractional spaces", () => {
    const score = fixture();
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    const note = sequence.content[0]!;
    sequence.content = [
      ...Array.from({ length: 7 }, () => ({ type: "space" as const, duration: [1, 12] as [number, number] })),
      note,
    ];
    score.global.measures[0]!.chordSymbols = [{ position: { fraction: [7, 12] }, root: { step: "C" } }];
    const captured = buildClipboardSelection(score, noteSelection(0))!;
    expect(captured.chordSymbols).toHaveLength(1);
    expect(captured.chordSymbols![0]!.offset).toEqual([0, 1]);
    expect(captured.chordSymbols![0]!.chordSymbol.position.fraction).toEqual([0, 1]);
  });

  it("keeps explicit global identities outside occupied tracks, even on hidden parts", () => {
    const score = fixture();
    score.parts[2]!.chordSymbolVisibility = "hide";
    const span = {
      start: { measureIndex: 0, beat: 0 },
      end: { measureIndex: 0, beat: 4 },
      tracks: [
        { partIndex: 2, staff: 2, voice: 0, start: { measureIndex: 0, beat: 2 }, end: { measureIndex: 0, beat: 4 } },
      ],
    };
    const elementIds = [noteSelection(2, 2).elementId, "m0/chord0/p2/staff2", "m0/chord0"];
    const captured = captureTimedSelection(score, { kind: "multi", elementIds }, span)!;
    expect(captured.chordSymbols).toHaveLength(1);
    expect(captured.chordSymbols![0]).toMatchObject({ staffOffset: 0, offset: [0, 1] });
    expect(captured.cutAnnotationLocations?.[0]).toEqual({
      kind: "global",
      type: "chord",
      measureIndex: 0,
      annotationIndex: 0,
    });
  });

  it("preserves exact offsets through native clipboard and MNX roundtrips", () => {
    const score = fixture();
    score.global.measures[0]!.chordSymbols = [
      { position: { fraction: [1, 8192] }, root: { step: "D", alter: -1 }, bass: { step: "F" } },
    ];
    const before = structuredClone(score);
    const captured = buildClipboardSelection(score, noteSelection(0))!;
    const fragment = deserializeFragment(
      serializeFragment(
        captured.events,
        captured.timeSignature,
        captured.keySignature,
        captured.tracks,
        captured.clef,
        captured.transposition,
        captured.dynamics,
        captured.measureRepeats,
        captured.lyrics,
        captured.chordSymbols,
      ),
    )!;
    expect(fragment.chordSymbols).toEqual(captured.chordSymbols);
    expect(fragment.chordSymbols![0]).toMatchObject({ offset: [1, 8192] });
    const wire = serializeMnx(score);
    const validation = validateRawScore(wire);
    expect(validation, JSON.stringify(validation)).toMatchObject({ ok: true });
    expect(parseMnx(wire).global.measures[0]!.chordSymbols).toEqual(score.global.measures[0]!.chordSymbols);
    expect(score).toEqual(before);
  });

  it("retains grace context in transient captures when shifting the origin", () => {
    const score = fixture();
    score.global.measures[0]!.chordSymbols![1]!.position.graceIndex = 2;
    const captured = captureSelectedChordSymbols(
      score,
      [clipboardAnnotationLocation("m0/chord1")!],
      { measureIndex: 0, beat: 0.5 },
      0,
      0,
    );
    expect(captured[0]!.chordSymbol.position).toEqual({ fraction: [1, 8], graceIndex: 2 });
    expect(score.global.measures[0]!.chordSymbols![1]!.position.fraction).toEqual([1, 4]);
  });

  it("uses half-open incidental intervals and retains explicitly selected endpoints", () => {
    const score = fixture();
    expect(captureChordSymbols(score, 0, 0, 0, 0, 1)).toHaveLength(1);
    const result = captureChordSymbols(score, 0, 0, 0, 0, 1, 0, 0, new Set([2]), {
      locations: [clipboardAnnotationLocation("m0/chord1")!],
      tracks: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.offset).toEqual([1, 4]);
  });
});

describe("global placed harmony identities", () => {
  it("identifies the final global index, distinguishing grace onsets and ignoring staff routing", () => {
    const before = fixture();
    const after = structuredClone(before);
    const chord: ChordSymbol = { position: { fraction: [1, 4], graceIndex: 1 }, root: { step: "D" } };
    after.global.measures[1]!.chordSymbols = [
      { ...chord, position: { fraction: [1, 4], graceIndex: 0 } },
      chord,
      { ...chord, position: { fraction: [1, 4] } },
    ];
    const paste: PasteResult = {
      events: [],
      chordSymbols: [
        { measureOffset: 0, offset: [1, 4], staffOffset: 99, chordSymbol: chord },
        { measureOffset: 0, offset: [1, 4], staffOffset: 0, chordSymbol: chord },
      ],
    };
    const origin = { partIndex: 2, staffIndex: 1, measureIndex: 1, beat: 0 };
    expect(findPlacedAnnotationIds(before, after, paste, origin)).toEqual(["m1/chord1"]);
    expect(findPlacedAnnotationIds(before, before, paste, origin)).toEqual([]);
  });
});

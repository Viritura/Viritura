import { describe, expect, it } from "vitest";
import type { Clef, Score } from "@viritura/core";
import type { SelectionState } from "../store/selectionStore";
import { applyPaste, pasteResultFromFragment } from "../commands/clipboardCommands";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { deserializeFragment } from "./deserialize";
import { serializeFragment } from "./serialize";
import { computeRepeatResult } from "./computeRepeatResult";
import { getActiveClef, resolveActiveTimeKey } from "./sourceContext";

const treble: Clef = { sign: "G", staffPosition: -2 };
const bass: Clef = { sign: "F", staffPosition: 2, octave: -1, showOctave: true };
const alto: Clef = { sign: "C", staffPosition: 0 };

function score(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: -2 } }, {}, { key: { fifths: 3 } }] },
    parts: [
      {
        staves: 2,
        measures: Array.from({ length: 3 }, (_, m) => ({
          sequences: [1, 2].map((staff) => ({
            staff,
            content: [{ type: "event" as const, id: `m${m}s${staff}`, duration: { base: "whole" as const }, rest: {} }],
          })),
          clefs:
            m === 0
              ? [
                  { staff: 1, clef: treble },
                  { staff: 2, clef: treble },
                  { staff: 2, clef: bass, position: { fraction: [1, 2] as [number, number] } },
                ]
              : m === 2
                ? [{ staff: 2, clef: alto, position: { fraction: [1, 2] as [number, number] } }]
                : [],
        })),
      },
    ],
  };
}

function bars(start = 1, end = 2): SelectionState {
  return {
    kind: "measure",
    startPartIndex: 0,
    endPartIndex: 0,
    startStaffIndex: 1,
    endStaffIndex: 1,
    startLocalStaffIndex: 1,
    endLocalStaffIndex: 1,
    startMeasure: start,
    endMeasure: end,
  };
}

function roundTrip(source: Score, selection: SelectionState) {
  const captured = buildClipboardSelection(source, selection)!;
  const text = serializeFragment(
    captured.events,
    captured.timeSignature,
    captured.keySignature,
    captured.tracks,
    captured.clef,
    captured.transposition,
    captured.dynamics,
    captured.measureRepeats,
    captured.lyrics,
    { chordSymbols: captured.chordSymbols, measureSignatures: captured.measureSignatures },
  );
  return { captured, text, paste: pasteResultFromFragment(deserializeFragment(text)!) };
}

describe("whole-bar clipboard signatures", () => {
  it.each([
    [treble, bass],
    [bass, treble],
    [treble, alto],
  ])("keeps destination clef and sounding pitches when copying bars between instruments (%j to %j)", (from, to) => {
    const source: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}, {}] },
      parts: [from, to].map((clef, partIndex) => ({
        id: `part${partIndex}`,
        measures: Array.from({ length: 3 }, (_, measureIndex) => ({
          ...(measureIndex === 0 ? { clefs: [{ clef }] } : {}),
          sequences: [
            {
              content: [
                {
                  type: "event" as const,
                  id: `p${partIndex}m${measureIndex}`,
                  duration: { base: "whole" as const },
                  notes: [{ pitch: { step: "C" as const, octave: 4 } }],
                },
              ],
            },
          ],
        })),
      })),
    };
    const { paste } = roundTrip(source, {
      ...bars(0, 1),
      startStaffIndex: 0,
      endStaffIndex: 0,
      startLocalStaffIndex: 0,
      endLocalStaffIndex: 0,
    });
    const result = applyPaste(source, paste, 1, 0, 0, 0);
    for (const measureIndex of [0, 1, 2]) {
      expect(getActiveClef(result, 1, measureIndex, 1)).toEqual(to);
    }
    for (const measureIndex of [0, 1]) {
      const event = result.parts[1]!.measures[measureIndex]!.sequences[0]!.content[0]!;
      expect(event.type).toBe("event");
      if (event.type === "event") expect(event.notes?.map((note) => note.pitch)).toEqual([{ step: "C", octave: 4 }]);
    }
    expect(source.parts[1]!.measures[0]!.clefs).toEqual([{ clef: to }]);
  });

  it("round-trips inherited context and later changes onto the destination staff without mutating either score", () => {
    const source = score();
    const destination = score();
    destination.global.measures[0]!.key = { fifths: 0 };
    const before = structuredClone(destination);
    const sourceBefore = structuredClone(source);
    const { captured, paste } = roundTrip(source, bars());
    expect(captured.measureSignatures).toMatchObject([
      { offset: [0, 1], key: { fifths: -2 }, clefs: [{ staffOffset: 0, clef: { clef: bass } }] },
      { offset: [1, 1], key: { fifths: 3 }, clefs: [{ staffOffset: 0, clef: { clef: alto } }] },
    ]);
    const result = applyPaste(destination, paste, 0, 1, 0, 0);
    expect(result.global.measures[1]!.key).toEqual({ fifths: -2 });
    expect(result.global.measures[2]!.key).toEqual({ fifths: 3 });
    expect(result.global.measures[0]!.barline).toEqual({ type: "double" });
    expect(result.global.measures[1]!.barline).toEqual({ type: "double" });
    expect(result.parts[0]!.measures[1]!.clefs).toEqual([]);
    expect(getActiveClef(result, 0, 1, 1)).toEqual(treble);
    expect(result.parts[0]!.measures[2]!.clefs).toContainEqual({
      staff: 1,
      clef: alto,
      position: { fraction: [1, 2] },
    });
    expect(result.parts[0]!.measures[2]!.clefs).toContainEqual(before.parts[0]!.measures[2]!.clefs![0]);
    expect(destination).toEqual(before);
    expect(source).toEqual(sourceBefore);
  });

  it("preserves explicit barlines and repeats when pasting key changes", () => {
    const { paste } = roundTrip(score(), bars());
    const destination = score();
    destination.global.measures[0]!.key = { fifths: 0 };
    destination.global.measures[0]!.barline = { type: "regular" };
    destination.global.measures[1]!.repeatEnd = {};

    const result = applyPaste(destination, paste, 0, 1, 0, 0);

    expect(result.global.measures[0]!.barline).toEqual({ type: "regular" });
    expect(result.global.measures[1]!.repeatEnd).toEqual({});
    expect(result.global.measures[1]!.barline).toBeUndefined();
  });

  it("preserves the destination starting clef and copies mid-bar changes", () => {
    const { paste } = roundTrip(score(), bars(0, 0));
    const result = applyPaste(score(), paste, 0, 1, 1, 0);
    expect(result.parts[0]!.measures[1]!.clefs).toEqual([{ staff: 2, clef: bass, position: { fraction: [1, 2] } }]);
  });

  it("replaces destination-only signature changes inside copied bars while retaining other staves", () => {
    const source = score();
    delete source.global.measures[2]!.key;
    source.parts[0]!.measures[2]!.clefs = [];
    const { paste } = roundTrip(source, bars());
    const destination = score();
    destination.parts[0]!.measures[1]!.clefs = [
      { staff: 1, clef: treble, position: { fraction: [1, 4] } },
      { staff: 2, clef: alto, position: { fraction: [1, 4] } },
    ];
    destination.parts[0]!.measures[2]!.clefs!.push({
      staff: 1,
      clef: treble,
      position: { fraction: [1, 4] },
    });
    const result = applyPaste(destination, paste, 0, 1, 0, 0);
    expect(resolveActiveTimeKey(result, 2).key).toEqual({ fifths: -2 });
    expect(result.parts[0]!.measures[1]!.clefs).toEqual([{ staff: 2, clef: alto, position: { fraction: [1, 4] } }]);
    expect(result.parts[0]!.measures[2]!.clefs).toEqual([{ staff: 2, clef: alto, position: { fraction: [1, 2] } }]);
    expect(result.parts[0]!.measures[0]).toEqual(destination.parts[0]!.measures[0]);
  });

  it("maps physical staves between a grand staff and separate parts", () => {
    const source = score();
    const selection = { ...bars(0, 0), startStaffIndex: 0, startLocalStaffIndex: 0 };
    const { paste } = roundTrip(source, selection);
    const destination: Score = {
      ...score(),
      parts: [1, 2].map((staff) => ({
        measures: score().parts[0]!.measures.map((m) => ({
          sequences: [{ content: structuredClone(m.sequences[staff - 1]!.content) }],
        })),
      })),
    };
    const result = applyPaste(destination, paste, 0, 1, 0, 0);
    expect(result.parts[0]!.measures[1]!.clefs).toBeUndefined();
    expect(result.parts[1]!.measures[1]!.clefs).toEqual([{ staff: 1, clef: bass, position: { fraction: [1, 2] } }]);
  });

  it("retains clefs before a mid-bar paste and at its exact endpoint", () => {
    const { paste } = roundTrip(score(), bars(0, 0));
    const destination = score();
    destination.global.measures[1]!.key = { fifths: 4 };
    destination.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "event", duration: { base: "quarter" }, rest: {} },
      { type: "event", duration: { base: "half", dots: 1 }, rest: {} },
    ];
    destination.parts[0]!.measures[0]!.clefs = [
      { staff: 1, clef: alto },
      { staff: 1, clef: bass, position: { fraction: [1, 4] } },
    ];
    destination.parts[0]!.measures[1]!.clefs = [
      { staff: 1, clef: alto },
      { staff: 1, clef: alto, position: { fraction: [1, 4] } },
    ];
    const result = applyPaste(destination, paste, 0, 0, 0, 1);
    expect(result.parts[0]!.measures[0]!.clefs).toEqual([
      { staff: 1, clef: alto },
      { staff: 1, clef: bass, position: { fraction: [1, 4] } },
      { staff: 1, clef: bass, position: { fraction: [3, 4] } },
    ]);
    expect(result.parts[0]!.measures[1]!.clefs).toEqual([{ staff: 1, clef: alto, position: { fraction: [1, 4] } }]);
    expect(resolveActiveTimeKey(result, 1).key).toEqual({ fifths: -2 });
    expect(result.global.measures[2]).toEqual(destination.global.measures[2]);
    expect(result.parts[0]!.measures[2]).toEqual(destination.parts[0]!.measures[2]);
  });

  it("remaps signature timing when destination bars are shorter", () => {
    const { paste } = roundTrip(score(), bars(0, 2));
    const destination = score();
    destination.global.measures[0]!.time = { count: 2, unit: 4 };
    const result = applyPaste(destination, paste, 0, 0, 0, 0);
    expect(result.parts[0]!.measures[1]!.clefs).toContainEqual({
      staff: 1,
      clef: bass,
      position: { fraction: [0, 1] },
    });
    expect(result.global.measures[4]!.key).toEqual({ fifths: 3 });
    expect(result.parts[0]!.measures[5]!.clefs).toContainEqual({
      staff: 1,
      clef: alto,
      position: { fraction: [0, 1] },
    });
  });

  it("leaves destination signatures unchanged for notes and legacy fragments", () => {
    const destination = score();
    const { paste } = roundTrip(score(), { kind: "single", elementType: "event", elementId: "p0/m1/s1/m1s2" });
    expect(paste.measureSignatures).toBeUndefined();
    const result = applyPaste(destination, paste, 0, 2, 0, 0);
    expect(result.global.measures).toEqual(destination.global.measures);
    expect(result.parts[0]!.measures[2]!.clefs).toEqual(destination.parts[0]!.measures[2]!.clefs);
    const { text } = roundTrip(score(), bars());
    const legacy = JSON.parse(text);
    legacy.version = 5;
    delete legacy.measureSignatures;
    expect(deserializeFragment(JSON.stringify(legacy))?.version).toBe(5);
  });

  it("repeats whole bars with their signatures", () => {
    const source = score();
    const { captured } = roundTrip(source, bars(0, 0));
    const result = computeRepeatResult(source, captured)!;
    expect(result.newScore.parts[0]!.measures[1]!.clefs).toContainEqual({
      staff: 2,
      clef: bass,
      position: { fraction: [1, 2] },
    });
    expect(resolveActiveTimeKey(result.newScore, 1).key).toEqual({ fifths: -2 });
  });

  it.each([
    [{ offset: [0, 0] }],
    [{ offset: [0, 1], duration: [0, 1] }],
    [{ offset: [0, 1], staffOffsets: [-1] }],
    [{ offset: [0, 1], clefs: [{ staffOffset: -1, clef: { clef: bass } }] }],
    [{ offset: [0, 1], clefs: [{ staffOffset: 0, clef: { clef: bass, position: { fraction: [1, 0] } } }] }],
  ])("rejects malformed signature data: %j", (...signatures) => {
    const { text } = roundTrip(score(), bars());
    expect(
      deserializeFragment(
        JSON.stringify({
          ...JSON.parse(text),
          measureSignatures: signatures.map((entry) => ({ duration: [1, 1], staffOffsets: [0], ...entry })),
        }),
      ),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import type { SelectionState } from "../store/selectionStore";
import { applyCut, pasteResultFromFragment } from "../commands/clipboardCommands";
import { resolveRangeElementIds } from "../store/selectionUtils";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { computePasteResult } from "./computePasteResult";
import { deserializeFragment } from "./deserialize";
import { serializeFragment } from "./serialize";
import { laneOfSequence } from "../voiceLanes";
import { SpatialIndex } from "@viritura/renderer";
import { computeSelectedIds } from "../components/ScoreCanvas/computeSelectedIds";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";

function note(id: string, octave: 3 | 5): NoteEvent {
  return { type: "event", id, duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave } }] };
}

function piano(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}, {}] },
    parts: [
      {
        name: "Piano",
        staves: 2,
        measures: Array.from({ length: 3 }, (_, m) => ({
          sequences: [
            { staff: 1, content: [note(`upper-${m}`, 5)] },
            { staff: 2, content: [note(`lower-${m}`, 3)] },
          ],
          dynamics: [1, 2].map((staff) => ({
            id: `dynamic-${m}-${staff}`,
            type: "immediate" as const,
            value: "mf" as const,
            staff,
            position: { fraction: [0, 1] as [number, number] },
          })),
        })),
      },
    ],
  };
}

function measures(startStaff: number, endStaff = startStaff): SelectionState {
  return {
    kind: "measure",
    startPartIndex: 0,
    endPartIndex: 0,
    startStaffIndex: startStaff - 1,
    endStaffIndex: endStaff - 1,
    startLocalStaffIndex: startStaff - 1,
    endLocalStaffIndex: endStaff - 1,
    startMeasure: 0,
    endMeasure: 0,
  };
}

function capturedPaste(score: Score, selection: SelectionState) {
  const captured = buildClipboardSelection(score, selection)!;
  expect(captured).not.toBeNull();
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
  return { captured, paste: pasteResultFromFragment(fragment) };
}

describe("staff-scoped piano copy and paste", () => {
  it.each([1, 2])("copies only staff %i, with voice 1 and a zero staff offset", (staff) => {
    const score = piano();
    const index = new SpatialIndex([
      { id: "p0/m0/s0/upper-0", x: 0, y: 0, width: 10, height: 10 },
      { id: "p0/m0/s1/lower-0", x: 0, y: 100, width: 10, height: 10 },
    ]);
    expect([...computeSelectedIds(measures(staff), index, score)]).toEqual([
      `p0/m0/s${staff - 1}/${staff === 1 ? "upper" : "lower"}-0`,
    ]);
    const { captured, paste } = capturedPaste(score, measures(staff));
    expect(captured.tracks).toMatchObject([{ staffOffset: 0, sourceStaff: staff, voiceIndex: 0 }]);
    expect(captured.tracks).toHaveLength(1);
    expect(captured.cutLocations?.map((location) => location.sequenceIndex)).toEqual([staff - 1]);
    expect(captured.tracks![0]!.dynamics).toHaveLength(1);
    expect(captured.tracks![0]!.dynamics![0]!.dynamic.staff).toBe(staff);

    for (const destinationStaff of [1, 2]) {
      const result = computePasteResult(
        score,
        {
          ...measures(destinationStaff),
          startMeasure: 1,
          endMeasure: 1,
        },
        paste,
      )!;
      const sequences = result.newScore.parts[0]!.measures[1]!.sequences;
      expect(sequences).toHaveLength(2);
      expect(sequences[2 - destinationStaff]).toEqual(score.parts[0]!.measures[1]!.sequences[2 - destinationStaff]);
      expect(sequences[destinationStaff - 1]!.content).toMatchObject([
        { notes: [{ pitch: { octave: staff === 1 ? 5 : 3 } }] },
      ]);
      expect(laneOfSequence(sequences, destinationStaff - 1)).toBe(1);
    }

    const cut = applyCut(score, {
      ...captured,
      replacements: [],
    });
    expect(cut.parts[0]!.measures[0]!.sequences[2 - staff]).toEqual(score.parts[0]!.measures[0]!.sequences[2 - staff]);
    expect(cut.parts[0]!.measures[0]!.sequences[staff - 1]).toMatchObject({ content: [], fullMeasure: {} });
    expect(cut.parts[0]!.measures[0]!.dynamics).toEqual(
      score.parts[0]!.measures[0]!.dynamics?.filter((dynamic) => dynamic.staff !== staff),
    );
    const deleted = computeDeleteSelection(score, measures(staff));
    expect(deleted.kind).toBe("measure");
    if (deleted.kind === "measure") expect(deleted.score).toEqual(cut);
  });

  it.each([false, true])("cuts only boundary staves across parts and measures (reverse=%s)", (reverse) => {
    const score = piano();
    score.parts.push(structuredClone(score.parts[0]!));
    const selection: SelectionState = {
      kind: "measure",
      startPartIndex: reverse ? 1 : 0,
      endPartIndex: reverse ? 0 : 1,
      startStaffIndex: reverse ? 2 : 1,
      endStaffIndex: reverse ? 1 : 2,
      startLocalStaffIndex: reverse ? 0 : 1,
      endLocalStaffIndex: reverse ? 1 : 0,
      startMeasure: reverse ? 1 : 0,
      endMeasure: reverse ? 0 : 1,
    };
    const captured = buildClipboardSelection(score, selection)!;
    const cut = applyCut(score, { ...captured, replacements: [] });
    for (const [partIndex, part] of cut.parts.entries()) {
      for (const [measureIndex, measure] of part.measures.entries()) {
        const original = score.parts[partIndex]!.measures[measureIndex]!;
        if (measureIndex === 2) {
          expect(measure).toEqual(original);
          continue;
        }
        const selectedStaff = partIndex === 0 ? 2 : 1;
        expect(measure.sequences[selectedStaff - 1]?.content).toEqual([]);
        expect(measure.sequences[2 - selectedStaff]).toEqual(original.sequences[2 - selectedStaff]);
        expect(measure.dynamics).toEqual(original.dynamics?.filter((dynamic) => dynamic.staff !== selectedStaff));
      }
    }
    const deleted = computeDeleteSelection(score, selection);
    expect(deleted.kind).toBe("measure");
    if (deleted.kind === "measure") expect(deleted.score).toEqual(cut);
  });

  it.each([
    [1, 2],
    [2, 1],
  ])("keeps both staves when selected from staff %i to staff %i", (start, end) => {
    const { captured } = capturedPaste(piano(), measures(start, end));
    expect(captured.tracks).toMatchObject([
      { staffOffset: 0, sourceStaff: 1, voiceIndex: 0 },
      { staffOffset: 1, sourceStaff: 2, voiceIndex: 0 },
    ]);
  });

  it.each([1, 2])("preserves other-staff annotations and shared repeats when clearing staff %i", (staff) => {
    const score = piano();
    const measure = score.parts[0]!.measures[0]!;
    measure.measureRepeat = { number: 1 };
    measure.sequences = [1, 2].map((sourceStaff) => ({
      staff: sourceStaff,
      content: [
        {
          ...note(`event-${sourceStaff}`, sourceStaff === 1 ? 5 : 3),
          notes: ["a", "b"].map((suffix) => ({
            id: `note-${sourceStaff}-${suffix}`,
            pitch: { step: "C" as const, octave: sourceStaff === 1 ? 5 : 3 },
          })),
        },
      ],
    }));
    measure.expressions = [1, 2].map((sourceStaff) => ({
      staff: sourceStaff,
      position: { fraction: [0, 1] },
      text: [{ text: `staff ${sourceStaff}` }],
    }));
    measure.pedals = [1, 2].map((sourceStaff) => ({
      staff: sourceStaff,
      type: "sustain",
      position: { fraction: [0, 1] },
      end: { measure: "1", position: { fraction: [0, 1] } },
    }));
    measure.ottavas = [1, 2].map((sourceStaff) => ({
      staff: sourceStaff,
      value: 1,
      position: { fraction: [0, 1] },
      end: { measure: "1", position: { fraction: [0, 1] } },
    }));
    measure.arpeggios = [1, 2].map((sourceStaff) => ({
      position: { fraction: [0, 1] },
      span: { start: `note-${sourceStaff}-a`, end: `note-${sourceStaff}-b` },
    }));
    measure.nonArpeggios = structuredClone(measure.arpeggios);
    measure.beams = [1, 2].map((sourceStaff) => ({ events: [`event-${sourceStaff}`] }));
    const original = structuredClone(score);
    const deleted = computeDeleteSelection(score, measures(staff));
    expect(deleted.kind).toBe("measure");
    if (deleted.kind !== "measure") return;
    const cleared = deleted.score.parts[0]!.measures[0]!;
    const otherStaff = 3 - staff;
    expect(cleared.sequences[2 - staff]).toEqual(measure.sequences[2 - staff]);
    for (const key of ["dynamics", "expressions", "pedals", "ottavas"] as const) {
      expect(cleared[key]).toEqual(measure[key]?.filter((value) => value.staff === otherStaff));
    }
    expect(cleared.arpeggios).toEqual([measure.arpeggios[otherStaff - 1]]);
    expect(cleared.nonArpeggios).toEqual([measure.nonArpeggios[otherStaff - 1]]);
    expect(cleared.beams).toEqual([measure.beams[otherStaff - 1]]);
    expect(cleared.measureRepeat).toEqual({ number: 1 });
    expect(score).toEqual(original);
    const both = computeDeleteSelection(score, measures(1, 2));
    expect(both.kind).toBe("measure");
    if (both.kind === "measure") {
      expect(both.score.parts[0]!.measures[0]!.measureRepeat).toBeUndefined();
      expect(both.score.parts[0]!.measures[0]!.arpeggios).toBeUndefined();
    }
  });

  it("captures all voices on the selected staff without borrowing voices from the other staff", () => {
    const score = piano();
    score.parts[0]!.measures[0]!.sequences.push({ staff: 2, content: [note("lower-voice-2", 3)] });
    const { captured } = capturedPaste(score, measures(2));
    expect(captured.tracks).toMatchObject([
      { staffOffset: 0, sourceStaff: 2, voiceIndex: 0 },
      { staffOffset: 0, sourceStaff: 2, voiceIndex: 1 },
    ]);
  });

  it("captures a selected lower-staff full-measure rest without copying upper-staff notes", () => {
    const score = piano();
    score.parts[0]!.measures[0]!.sequences[1] = {
      staff: 2,
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    };
    const { captured } = capturedPaste(score, measures(2));
    expect(captured.tracks).toHaveLength(1);
    expect(captured.tracks![0]).toMatchObject({ staffOffset: 0, sourceStaff: 2, voiceIndex: 0 });
    expect(captured.events).toMatchObject([{ rest: {} }]);
  });

  it.each([false, true])("clips multi-part measure capture at the selected boundary staves (reverse=%s)", (reverse) => {
    const score = piano();
    score.parts.push(structuredClone(score.parts[0]!));
    const selection: SelectionState = {
      kind: "measure",
      startPartIndex: reverse ? 1 : 0,
      endPartIndex: reverse ? 0 : 1,
      startStaffIndex: reverse ? 2 : 1,
      endStaffIndex: reverse ? 1 : 2,
      startLocalStaffIndex: reverse ? 0 : 1,
      endLocalStaffIndex: reverse ? 1 : 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    const captured = buildClipboardSelection(score, selection)!;
    expect(captured.tracks).toMatchObject([
      { partOffset: 0, staffOffset: 0, sourceStaff: 2, voiceIndex: 0 },
      { partOffset: 1, staffOffset: 1, sourceStaff: 1, voiceIndex: 0 },
    ]);
  });

  it("includes both physical staves when endpoints share an array slot but name different staves", () => {
    const score = piano();
    score.parts[0]!.measures[1]!.sequences.reverse();
    const ids = resolveRangeElementIds("p0/m0/s0/upper-0", "p0/m1/s0/lower-1", score);
    expect(ids).toEqual(
      expect.arrayContaining(["p0/m0/s0/upper-0", "p0/m0/s1/lower-0", "p0/m1/s0/lower-1", "p0/m1/s1/upper-1"]),
    );
  });

  it.each([false, true])("keeps a lower-staff range on voice 1 when sequences reorder (reverse=%s)", (reverse) => {
    const score = piano();
    score.parts[0]!.measures[1]!.sequences.reverse();
    const endpoints = ["p0/m0/s1/lower-0", "p0/m1/s0/lower-1"];
    if (reverse) endpoints.reverse();
    const ids = resolveRangeElementIds(endpoints[0]!, endpoints[1]!, score);
    expect(ids.filter((id) => id.includes("/lower-"))).toHaveLength(2);
    expect(ids.some((id) => id.includes("/upper-"))).toBe(false);
    const { captured, paste } = capturedPaste(score, {
      kind: "range",
      startElementId: endpoints[0]!,
      endElementId: endpoints[1]!,
    });
    expect(captured.events).toHaveLength(2);
    expect(captured.tracks ?? []).toHaveLength(0);
    const result = computePasteResult(
      score,
      {
        ...measures(2),
        startMeasure: 2,
        endMeasure: 2,
      },
      paste,
    )!;
    expect(result.newScore.parts[0]!.measures[2]!.sequences[0]).toEqual(score.parts[0]!.measures[2]!.sequences[0]);
    expect(result.newScore.parts[0]!.measures[3]!.sequences.filter((sequence) => sequence.staff === 2)).toHaveLength(1);
    expect(laneOfSequence(result.newScore.parts[0]!.measures[3]!.sequences, 1)).toBe(1);
  });
});

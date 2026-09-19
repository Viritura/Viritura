import { describe, expect, it } from "vitest";
import { walkSequenceEvents, type NoteEvent, type Score } from "@viritura/core";
import type { ClipboardSelection } from "../commands/clipboardCommands";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { computeRepeatResult } from "./computeRepeatResult";

function wholeNote(id: string, step: "C" | "D" | "G" = "C"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "whole" },
    notes: [{ id: `${id}-note`, pitch: { step, octave: 4 } }],
  };
}

function unrelatedPart(measures = 2): Score["parts"][number] {
  return {
    name: "Unrelated instrument",
    measures: Array.from({ length: measures }, (_, index) => ({
      sequences: [{ content: [wholeNote(`unrelated-${index}`, "G")] }],
    })),
  };
}

function pianoScore(staves = 2): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
    parts: [
      {
        name: "Piano",
        staves,
        measures: [{ sequences: [{ staff: staves, content: [wholeNote("source")] }] }, { sequences: [] }],
      },
      unrelatedPart(),
    ],
  };
}

function selectMeasures(score: Score, endPartIndex = 0, endMeasure = 0, startPartIndex = 0): ClipboardSelection {
  const selection = buildClipboardSelection(score, {
    kind: "measure",
    startPartIndex,
    endPartIndex,
    startMeasure: 0,
    endMeasure,
  });
  expect(selection).not.toBeNull();
  return selection!;
}

function repeatWithoutMutation(score: Score, selection: ClipboardSelection): Score {
  const sourceBytes = JSON.stringify(score);
  const selectionBytes = JSON.stringify(selection);
  const unrelatedBytes = JSON.stringify(score.parts.at(-1));
  const result = computeRepeatResult(score, selection);

  expect(JSON.stringify(score)).toBe(sourceBytes);
  expect(JSON.stringify(selection)).toBe(selectionBytes);
  expect(result).not.toBeNull();
  expect(JSON.stringify(result!.newScore.parts.at(-1))).toBe(unrelatedBytes);
  expect(result!.newScore.parts).toHaveLength(score.parts.length);
  expect(result!.newScore.parts.map((part) => part.staves)).toEqual(score.parts.map((part) => part.staves));
  return result!.newScore;
}

function expectRepeatedNote(score: Score, part: number, measure: number, staff: number, source: NoteEvent): void {
  const sequences = score.parts[part]!.measures[measure]!.sequences.filter(
    (sequence) => (sequence.staff ?? 1) === staff,
  );
  expect(sequences).toHaveLength(1);
  expect(sequences[0]!.content).toEqual([
    expect.objectContaining({
      type: "event",
      duration: source.duration,
      notes: [expect.objectContaining({ pitch: source.notes![0]!.pitch })],
    }),
  ]);
  const repeated = sequences[0]!.content[0] as NoteEvent;
  expect(repeated.id).not.toBe(source.id);
  expect(repeated.notes![0]!.id).not.toBe(source.notes![0]!.id);
  const notes = score.parts[part]!.measures[measure]!.sequences.flatMap((sequence) =>
    [...walkSequenceEvents(sequence.content)].filter(({ event }) => event.notes?.length),
  );
  expect(notes).toHaveLength(1);
}

describe("repeat physical staff origin", () => {
  it.each([2, 3])("keeps a whole-measure repeat on staff %i despite missing leading staves", (staves) => {
    const score = pianoScore(staves);
    const selection = selectMeasures(score);
    expect(selection.tracks).toMatchObject([
      { partOffset: 0, staffOffset: staves - 1, sourceStaff: staves, voiceIndex: 0 },
    ]);

    const repeated = repeatWithoutMutation(score, selection);

    expectRepeatedNote(repeated, 0, 1, staves, wholeNote("source"));
    expect(repeated.parts[0]!.measures[1]!.sequences.every((sequence) => (sequence.staff ?? 1) <= staves)).toBe(true);
  });

  it.each([
    { emptyStaves: [1], precedingPart: false },
    { emptyStaves: [2], precedingPart: false },
    { emptyStaves: [2, 3], precedingPart: true },
  ])("recovers the origin before entirely empty selected parts: %j", ({ emptyStaves, precedingPart }) => {
    const score = pianoScore();
    const emptyParts = emptyStaves.map((staves) => ({
      staves,
      measures: [{ sequences: [] }, { sequences: [] }],
    }));
    score.parts.unshift(...emptyParts);
    if (precedingPart) score.parts.unshift({ ...unrelatedPart(), staves: 3 });
    const startPart = precedingPart ? 1 : 0;
    const pianoPart = startPart + emptyParts.length;
    const selection = selectMeasures(score, pianoPart, 0, startPart);
    expect(selection.tracks).toMatchObject([
      {
        partOffset: emptyParts.length,
        staffOffset: emptyStaves.reduce((sum, staves) => sum + staves, 0) + 1,
        sourceStaff: 2,
      },
    ]);

    const repeated = repeatWithoutMutation(score, selection);

    expectRepeatedNote(repeated, pianoPart, 1, 2, wholeNote("source"));
    for (let partIndex = startPart; partIndex < pianoPart; partIndex++) {
      expect(
        repeated.parts[partIndex]!.measures.flatMap((measure) =>
          measure.sequences.flatMap((sequence) => sequence.content),
        ),
      ).toEqual([]);
    }
    if (precedingPart) expect(JSON.stringify(repeated.parts[0])).toBe(JSON.stringify(score.parts[0]));
  });

  it.each(["measure", "range"] as const)("recovers a shared origin across selected parts (%s)", (kind) => {
    const score = pianoScore(3);
    score.parts.splice(1, 0, {
      staves: 2,
      measures: [{ sequences: [{ staff: 2, content: [wholeNote("second-part", "D")] }] }, { sequences: [] }],
    });
    const selection =
      kind === "measure"
        ? selectMeasures(score, 1)
        : buildClipboardSelection(score, {
            kind: "range",
            startElementId: "p0/m0/s0/source",
            endElementId: "p1/m0/s0/second-part",
          })!;
    expect(selection.tracks).toMatchObject([
      { partOffset: 0, staffOffset: kind === "measure" ? 2 : 0, sourceStaff: 3 },
      { partOffset: 1, staffOffset: kind === "measure" ? 4 : 2, sourceStaff: 2 },
    ]);
    selection.tracks!.reverse();

    const repeated = repeatWithoutMutation(score, selection);

    expectRepeatedNote(repeated, 0, 1, 3, wholeNote("source"));
    expectRepeatedNote(repeated, 1, 1, 2, wholeNote("second-part", "D"));
  });

  it.each([
    { sourceStaves: [2], destinationStaves: [2, 1] },
    { sourceStaves: [2, 1], destinationStaves: [1, 2] },
    { sourceStaves: [1, 2], destinationStaves: [2] },
    { sourceStaves: [2], destinationStaves: [1] },
  ])("ignores missing or reordered source/destination sequences: %j", ({ sourceStaves, destinationStaves }) => {
    const score = pianoScore();
    score.parts[0]!.measures[0]!.sequences = sourceStaves.map((staff) => ({
      staff,
      content: staff === 2 ? [wholeNote("source")] : [],
    }));
    score.parts[0]!.measures[1]!.sequences = destinationStaves.map((staff) => ({ staff, content: [] }));
    const selection = selectMeasures(score);

    const repeated = repeatWithoutMutation(score, selection);

    expectRepeatedNote(repeated, 0, 1, 2, wholeNote("source"));
    expect(repeated.parts[0]!.measures[1]!.sequences.map((sequence) => sequence.staff)).toEqual(
      destinationStaves.includes(2) ? destinationStaves : [...destinationStaves, 2],
    );
  });

  it.each([false, true])("keeps a two-bar repeat on staff 2 when staff 1 is missing at the end: %s", (missingAtEnd) => {
    const score = pianoScore();
    score.global.measures.push({}, {});
    score.parts[0]!.measures = [
      {
        sequences: [{ staff: 2, content: [wholeNote("source")] }, ...(missingAtEnd ? [{ staff: 1, content: [] }] : [])],
      },
      {
        sequences: [
          ...(missingAtEnd ? [] : [{ staff: 1, content: [] }]),
          { staff: 2, content: [wholeNote("second-bar", "D")] },
        ],
      },
      {
        sequences: [
          { staff: 2, content: [] },
          { staff: 1, content: [] },
        ],
      },
      { sequences: [{ staff: 2, content: [] }] },
    ];
    score.parts[1] = unrelatedPart(4);
    const selection = selectMeasures(score, 0, 1);
    expect(selection.tracks).toMatchObject([
      { staffOffset: 1, sourceStaff: 2, content: [{ id: "source" }, { id: "second-bar" }] },
    ]);

    const repeated = repeatWithoutMutation(score, selection);

    expectRepeatedNote(repeated, 0, 2, 2, wholeNote("source"));
    expectRepeatedNote(repeated, 0, 3, 2, wholeNote("second-bar", "D"));
  });

  it.each([false, true])("retains legacy source lookup without physical origin metadata (tracks: %s)", (withTracks) => {
    const score = pianoScore();
    const selection = selectMeasures(score);
    if (withTracks) {
      selection.tracks = [{ partOffset: 0, voiceIndex: 0, staffOffset: 0, content: selection.events }];
    } else {
      delete selection.tracks;
    }

    const repeated = repeatWithoutMutation(score, selection);

    expectRepeatedNote(repeated, 0, 1, 2, wholeNote("source"));
  });
});

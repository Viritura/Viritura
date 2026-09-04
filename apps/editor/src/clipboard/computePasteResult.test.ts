import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import type { PasteResult } from "../commands/clipboardCommands";
import type { SelectionState } from "../store/selectionStore";
import { computePasteResult } from "./computePasteResult";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { pasteResultFromFragment } from "../commands/clipboardCommands";
import { deserializeFragment } from "./deserialize";
import { serializeFragment } from "./serialize";

function harpPart(name: string) {
  return {
    name,
    staves: 2,
    measures: [
      {
        sequences: [
          { staff: 1, content: [], fullMeasure: { visualDuration: { base: "whole" as const } } },
          { staff: 2, content: [], fullMeasure: { visualDuration: { base: "whole" as const } } },
        ],
      },
    ],
  };
}

const paste: PasteResult = {
  content: [
    {
      type: "event",
      id: "copied-lower-staff-note",
      duration: { base: "whole" },
      notes: [{ pitch: { step: "C", octave: 4 } }],
    },
  ],
  sourceTimeSignature: { count: 4, unit: 4 },
  sourceKeySignature: { fifths: 0 },
};

describe("computePasteResult grand-staff destinations", () => {
  it.each([
    {
      label: "selected lower-staff bar",
      selection: {
        kind: "measure",
        startPartIndex: 1,
        endPartIndex: 1,
        startStaffIndex: 3,
        endStaffIndex: 3,
        startLocalStaffIndex: 1,
        endLocalStaffIndex: 1,
        startMeasure: 0,
        endMeasure: 0,
      } satisfies SelectionState,
    },
    {
      label: "selected lower-staff measure repeat",
      selection: {
        kind: "single",
        elementId: "p1/m0/measurerepeat",
        elementType: "measure-repeat",
        measureAnchor: { partIndex: 1, measureIndex: 0, staffIndex: 3, localStaffIndex: 1 },
      } satisfies SelectionState,
    },
  ])("pastes Harp 1 material into Harp 2's second staff from a $label", ({ selection }) => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [harpPart("Harp 1"), harpPart("Harp 2")],
    };
    if (selection.kind === "single") {
      score.parts[1]!.measures[0]!.measureRepeat = { number: 1 };
    }

    const result = computePasteResult(score, selection, paste);

    expect(result).not.toBeNull();
    expect(result!.newScore.parts[1]!.measures[0]!.sequences[0]!.content).toEqual([]);
    expect(result!.newScore.parts[1]!.measures[0]!.sequences[1]!.content[0]).toMatchObject({
      id: "copied-lower-staff-note",
      notes: [{ pitch: { step: "C", octave: 4 } }],
    });
  });

  it("copies repeat structures and attached dynamics into another harp", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ id: "m0", time: { count: 4, unit: 4 } }, { id: "m1" }, { id: "m2" }, { id: "m3" }],
      },
      parts: [
        {
          ...harpPart("Harp 1"),
          measures: Array.from({ length: 4 }, (_, measureIndex) => ({
            sequences: [
              { staff: 1, content: [] },
              { staff: 2, content: [] },
            ],
            ...(measureIndex >= 1 && measureIndex <= 2
              ? { measureRepeat: { number: 1, counter: { count: measureIndex + 1 } } }
              : {}),
            ...(measureIndex === 1
              ? {
                  dynamics: [
                    {
                      id: "source-mf",
                      type: "immediate" as const,
                      value: "mf",
                      staff: 2,
                      position: { fraction: [0, 1] as [number, number] },
                    },
                  ],
                }
              : {}),
          })),
        },
        {
          ...harpPart("Harp 2"),
          measures: Array.from({ length: 4 }, () => ({
            sequences: [
              { staff: 1, content: [] },
              { staff: 2, content: [] },
            ],
          })),
        },
      ],
    };
    const copied = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m1/measurerepeat",
      endElementId: "p0/m2/measurerepeat",
    });
    expect(copied).not.toBeNull();
    expect(copied!.events).toEqual([]);

    const serialized = serializeFragment(
      copied!.events,
      copied!.timeSignature,
      copied!.keySignature,
      copied!.tracks,
      copied!.clef,
      copied!.transposition,
      copied!.dynamics,
      copied!.measureRepeats,
    );
    const fragment = deserializeFragment(serialized)!;
    const result = computePasteResult(
      score,
      {
        kind: "measure",
        startPartIndex: 1,
        endPartIndex: 1,
        startStaffIndex: 3,
        endStaffIndex: 3,
        startLocalStaffIndex: 1,
        endLocalStaffIndex: 1,
        startMeasure: 1,
        endMeasure: 1,
      },
      pasteResultFromFragment(fragment),
    );

    expect(result).not.toBeNull();
    expect(result!.newScore.parts[1]!.measures[1]!.measureRepeat).toEqual({
      number: 1,
      counter: { count: 2 },
    });
    expect(result!.newScore.parts[1]!.measures[2]!.measureRepeat).toEqual({
      number: 1,
      counter: { count: 3 },
    });
    expect(result!.newScore.parts[1]!.measures[1]!.dynamics![0]).toMatchObject({
      type: "immediate",
      value: "mf",
      staff: 2,
    });
    expect(result!.newScore.parts[1]!.measures[1]!.dynamics![0]!.id).not.toBe("source-mf");
  });
});

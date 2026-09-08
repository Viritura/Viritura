import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { applyCut, cutToClipboard, type PasteResult } from "../commands/clipboardCommands";
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
  it("uses the active input cursor after a tuplet instead of the copied selection", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Flute",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "tuplet",
                      inner: { multiple: 5, duration: { base: "16th" } },
                      outer: { multiple: 4, duration: { base: "16th" } },
                      content: ["t1", "t2", "t3", "t4", "t5"].map((id) => ({
                        type: "event" as const,
                        id,
                        duration: { base: "16th" as const },
                        notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
                      })),
                    },
                    {
                      type: "event",
                      id: "blue",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "E", octave: 4 } }],
                    },
                    { type: "event", id: "destination", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "tail", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = computePasteResult(
      score,
      { kind: "single", elementId: "p0/m0/s0/blue", elementType: "event" },
      {
        content: [
          {
            type: "event",
            id: "pasted-blue",
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "E", octave: 4 } }],
          },
        ],
        sourceTimeSignature: { count: 4, unit: 4 },
        sourceKeySignature: { fifths: 0 },
      },
      { measureIndex: 0, beatPosition: 2, partIndex: 0, staffIndex: 0, voice: 0 },
    );

    const content = result!.newScore.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[0]).toMatchObject({ type: "tuplet", inner: { multiple: 5 }, outer: { multiple: 4 } });
    expect(content[1]).toMatchObject({ type: "event", id: "blue" });
    expect(content[2]).toMatchObject({ type: "event", id: "pasted-blue" });
    expect(result!.cursorAfterPaste).toEqual({
      measureIndex: 0,
      beatPosition: 3,
      partIndex: 0,
      staffIndex: 0,
    });
  });

  it("anchors a paste on the containing tuplet when an inner event is selected", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Flute",
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", id: "before", duration: { base: "quarter" }, rest: {} },
                    {
                      type: "tuplet",
                      inner: { multiple: 3, duration: { base: "eighth" } },
                      outer: { multiple: 2, duration: { base: "eighth" } },
                      content: ["one", "two", "three"].map((id) => ({
                        type: "event" as const,
                        id,
                        duration: { base: "eighth" as const },
                        rest: {},
                      })),
                    },
                    {
                      type: "event",
                      id: "after",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "A", octave: 4 } }],
                    },
                    { type: "event", id: "tail", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = computePasteResult(
      score,
      { kind: "single", elementId: "p0/m0/s0/three", elementType: "event" },
      {
        content: [
          {
            type: "event",
            id: "pasted",
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "G", octave: 4 } }],
          },
        ],
        sourceTimeSignature: { count: 4, unit: 4 },
        sourceKeySignature: { fifths: 0 },
      },
    );

    const content = result!.newScore.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[1]).toMatchObject({ type: "event", id: "pasted" });
    expect(content[2]).toMatchObject({ type: "event", id: "after" });
  });

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

  it("preserves dynamics for every part in a multi-part repeat selection", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}, {}] },
      parts: ["Harp 1", "Harp 2", "Harp 3", "Harp 4"].map((name, partIndex) => ({
        name,
        measures: [
          { sequences: [{ content: [] }] },
          {
            sequences: [{ content: [] }],
            ...(partIndex < 2
              ? {
                  measureRepeat: { number: 1 },
                  dynamics: [
                    {
                      id: `dynamic-${partIndex}`,
                      type: "immediate" as const,
                      value: partIndex === 0 ? "p" : "f",
                      position: { fraction: [0, 1] as [number, number] },
                    },
                  ],
                }
              : {}),
          },
        ],
      })),
    };
    const copied = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m1/measurerepeat",
      endElementId: "p1/m1/measurerepeat",
    })!;
    const fragment = deserializeFragment(
      serializeFragment(
        copied.events,
        copied.timeSignature,
        copied.keySignature,
        copied.tracks,
        copied.clef,
        copied.transposition,
        copied.dynamics,
        copied.measureRepeats,
      ),
    )!;

    const result = computePasteResult(
      score,
      {
        kind: "measure",
        startPartIndex: 2,
        endPartIndex: 2,
        startStaffIndex: 2,
        endStaffIndex: 2,
        startMeasure: 1,
        endMeasure: 1,
      },
      pasteResultFromFragment(fragment),
    )!;

    expect(result.newScore.parts[2]!.measures[1]!.dynamics![0]!.value).toBe("p");
    expect(result.newScore.parts[3]!.measures[1]!.dynamics![0]!.value).toBe("f");
  });

  it("cuts repeat-only structural selections from their source measures", async () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}, {}] },
      parts: [
        {
          name: "Harp",
          measures: [
            { sequences: [{ content: [] }], measureRepeat: { number: 1 } },
            { sequences: [{ content: [] }], measureRepeat: { number: 1 } },
          ],
        },
      ],
    };
    const copied = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m0/measurerepeat",
      endElementId: "p0/m1/measurerepeat",
    })!;
    const cut = await cutToClipboard(copied);

    expect(cut).not.toBeNull();
    const result = applyCut(score, cut!);
    expect(result.parts[0]!.measures.every((measure) => measure.measureRepeat === undefined)).toBe(true);
  });

  it("keeps notes and repeats together in a mixed multi-selection", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}, {}] },
      parts: [
        {
          name: "Harp",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "note",
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
            { sequences: [{ content: [] }], measureRepeat: { number: 1 } },
          ],
        },
      ],
    };
    const copied = buildClipboardSelection(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/note", "p0/m1/measurerepeat"],
    });

    expect(copied?.events).toHaveLength(1);
    expect(copied?.measureRepeats).toHaveLength(1);
  });
});

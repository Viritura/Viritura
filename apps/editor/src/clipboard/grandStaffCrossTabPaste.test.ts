import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import type { SelectionState } from "../store/selectionStore";
import { pasteResultFromFragment } from "../commands/clipboardCommands";
import { laneOfSequence } from "../voiceLanes";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { computePasteResult } from "./computePasteResult";
import { deserializeFragment } from "./deserialize";
import { serializeFragment } from "./serialize";

function piano(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
    parts: [
      {
        name: "Piano",
        staves: 2,
        measures: Array.from({ length: 2 }, (_, measure) => ({
          sequences: [1, 2].map((staff) => ({
            staff,
            content: [
              {
                type: "event",
                id: `${staff === 1 ? "upper" : "lower"}-${measure}`,
                duration: { base: "whole" },
                notes: [{ pitch: { step: "C", octave: staff === 1 ? 5 : 3 } }],
              },
            ],
          })),
        })),
      },
    ],
  };
}

function copiedPiano() {
  const captured = buildClipboardSelection(piano(), {
    kind: "measure",
    startPartIndex: 0,
    endPartIndex: 0,
    startStaffIndex: 0,
    endStaffIndex: 1,
    startLocalStaffIndex: 0,
    endLocalStaffIndex: 1,
    startMeasure: 0,
    endMeasure: 0,
  })!;
  const fragment = deserializeFragment(
    serializeFragment(captured.events, captured.timeSignature, captured.keySignature, captured.tracks),
  )!;
  return pasteResultFromFragment(fragment);
}

describe("grand-staff paste into a separate document", () => {
  it.each(["range", "multi"] as const)("pastes both copied staves into a %s selection", (kind) => {
    const paste = copiedPiano();
    const destination = piano();
    const selection: SelectionState =
      kind === "range"
        ? { kind, startElementId: "p0/m1/s1/lower-1", endElementId: "p0/m1/s0/upper-1" }
        : { kind, elementIds: ["p0/m1/s1/lower-1", "p0/m1/s0/upper-1"] };
    const result = computePasteResult(destination, selection, paste);
    expect(result).not.toBeNull();
    const sequences = result!.newScore.parts[0]!.measures[1]!.sequences;
    expect(sequences).toHaveLength(2);
    expect(sequences[0]!.content).toEqual(paste.tracks![0]!.content);
    expect(sequences[1]!.content).toEqual(paste.tracks![1]!.content);
    expect(result!.newScore.parts).toHaveLength(1);
    expect(laneOfSequence(sequences, 0)).toBe(1);
    expect(laneOfSequence(sequences, 1)).toBe(1);
  });

  it("anchors a reverse both-staff measure selection at the upper staff", () => {
    const paste = copiedPiano();
    const destination = piano();
    const result = computePasteResult(
      destination,
      {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 1,
        endStaffIndex: 0,
        startLocalStaffIndex: 1,
        endLocalStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 1,
      },
      paste,
    )!;
    expect(result.newScore.parts).toHaveLength(1);
    expect(result.newScore.parts[0]!.staves).toBe(2);
    expect(result.newScore.parts[0]!.measures[1]!.sequences).toHaveLength(2);
    expect(result.newScore.parts[0]!.measures[1]!.sequences[0]!.content).toEqual(paste.tracks![0]!.content);
    expect(result.newScore.parts[0]!.measures[1]!.sequences[1]!.content).toEqual(paste.tracks![1]!.content);
  });

  it("pastes into both selected full-measure rest placeholders", () => {
    const paste = copiedPiano();
    const destination = piano();
    destination.parts[0]!.measures[1]!.sequences = [1, 2].map((staff) => ({
      staff,
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    }));
    const result = computePasteResult(
      destination,
      {
        kind: "range",
        startElementId: "p0/m1/s1/e0",
        endElementId: "p0/m1/s0/e0",
      },
      paste,
    )!;
    expect(result).not.toBeNull();
    expect(result.newScore.parts[0]!.measures[1]!.sequences).toMatchObject([
      { staff: 1, content: paste.tracks![0]!.content },
      { staff: 2, content: paste.tracks![1]!.content },
    ]);
  });
});

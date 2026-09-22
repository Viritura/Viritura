import { describe, expect, it } from "vitest";
import type { NoteEvent, Pitch, Score } from "@viritura/core";
import { computePasteResult } from "../clipboard/computePasteResult";
import type { PasteResult } from "../commands/clipboardCommands";
import { chordLineNoteIds } from "../store/chordNoteSelection";
import type { Selection } from "../store/selectionStore";

function pitch(step: Pitch["step"], octave: number): Pitch {
  return { step, octave: octave as Pitch["octave"] };
}

function chord(id: string, pitches: [Pitch["step"], number][], base: NoteEvent["duration"]["base"]): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: pitches.map(([step, octave], index) => ({ id: `${id}-n${index}`, pitch: pitch(step, octave) })),
  };
}

function singleMeasureScore(events: NoteEvent[]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ name: "Piano", measures: [{ sequences: [{ content: events }] }] }],
  };
}

function stepsAt(score: Score, index: number): string[] {
  const item = score.parts[0]!.measures[0]!.sequences[0]!.content[index]!;
  if (item.type !== "event" || !item.notes) return [];
  return item.notes.map((note) => `${note.pitch.step}${note.pitch.octave}`);
}

const selectFirst: Selection = { kind: "single", elementId: "p0/m0/s0/e0", elementType: "event" };

describe("chordLineNoteIds", () => {
  it("picks the highest notehead of a chord regardless of stored order", () => {
    const score = singleMeasureScore([
      chord(
        "e0",
        [
          ["G", 4],
          ["C", 4],
          ["E", 4],
        ],
        "whole",
      ),
    ]);
    expect(chordLineNoteIds(score, selectFirst, "top")).toEqual(["p0/m0/s0/e0/n0"]);
    expect(chordLineNoteIds(score, selectFirst, "bottom")).toEqual(["p0/m0/s0/e0/n1"]);
  });

  it("follows the requested line across every chord in a range", () => {
    const score = singleMeasureScore([
      chord(
        "e0",
        [
          ["C", 4],
          ["G", 4],
        ],
        "half",
      ),
      chord(
        "e1",
        [
          ["D", 4],
          ["A", 4],
        ],
        "half",
      ),
    ]);
    const range: Selection = { kind: "range", startElementId: "p0/m0/s0/e0", endElementId: "p0/m0/s0/e1" };
    expect(chordLineNoteIds(score, range, "top")).toEqual(["p0/m0/s0/e0/n1", "p0/m0/s0/e1/n1"]);
    expect(chordLineNoteIds(score, range, "bottom")).toEqual(["p0/m0/s0/e0/n0", "p0/m0/s0/e1/n0"]);
  });

  it("skips rests and honours a depth below the top", () => {
    const score = singleMeasureScore([
      chord(
        "e0",
        [
          ["C", 4],
          ["E", 4],
          ["G", 4],
        ],
        "half",
      ),
      { type: "event", id: "e1", duration: { base: "half" }, rest: {} },
    ]);
    const range: Selection = { kind: "range", startElementId: "p0/m0/s0/e0", endElementId: "p0/m0/s0/e1" };
    expect(chordLineNoteIds(score, range, "top", 1)).toEqual(["p0/m0/s0/e0/n1"]);
  });
});

describe("paste and merge", () => {
  const pasteChord: PasteResult = {
    content: [chord("pasted", [["E", 4]], "whole")],
  };

  function paste(score: Score, merge: boolean) {
    return computePasteResult(
      score,
      { kind: "single", elementId: "p0/m0/s0/e0", elementType: "event" },
      structuredClone(pasteChord),
      undefined,
      { merge },
    )!;
  }

  it("replaces the destination chord without the merge option", () => {
    const score = singleMeasureScore([chord("e0", [["C", 4]], "whole")]);
    expect(stepsAt(paste(score, false).newScore, 0)).toEqual(["E4"]);
  });

  it("adds the pasted pitch to the destination chord when merging", () => {
    const score = singleMeasureScore([chord("e0", [["C", 4]], "whole")]);
    expect(stepsAt(paste(score, true).newScore, 0)).toEqual(["C4", "E4"]);
  });

  it("does not duplicate a pitch the destination already has", () => {
    const score = singleMeasureScore([chord("e0", [["E", 4]], "whole")]);
    expect(stepsAt(paste(score, true).newScore, 0)).toEqual(["E4"]);
  });

  it("keeps the pasted rhythm and warns when the destination disagrees", () => {
    const score = singleMeasureScore([chord("e0", [["C", 4]], "half"), chord("e1", [["D", 4]], "half")]);
    const result = paste(score, true);
    expect(stepsAt(result.newScore, 0)).toEqual(["E4"]);
    expect(result.warnings.join(" ")).toContain("different rhythm");
  });

  it("leaves the source score untouched", () => {
    const score = singleMeasureScore([chord("e0", [["C", 4]], "whole")]);
    const snapshot = structuredClone(score);
    paste(score, true);
    expect(score).toEqual(snapshot);
  });
});

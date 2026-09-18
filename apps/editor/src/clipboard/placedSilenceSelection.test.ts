import { describe, expect, it } from "vitest";
import type { NoteEvent, Score, SequenceContent, Space } from "@viritura/core";
import { sequenceContentBeats } from "../commands/noteCommands";
import type { SelectionState } from "../store/selectionStore";
import type { ClipboardTrack } from "./ClipboardFragment";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { computePasteResult } from "./computePasteResult";
import { computeRepeatResult } from "./computeRepeatResult";
import { assignFreshTrackIds } from "./deserialize";

type Placement = NonNullable<ReturnType<typeof computeRepeatResult>>;

function note(id: string, step: "C" | "D" | "G", base: NoteEvent["duration"]["base"] = "quarter"): NoteEvent {
  return { type: "event", id, duration: { base }, notes: [{ id: `${id}-note`, pitch: { step, octave: 4 } }] };
}

function space(duration: Space["duration"]): Space {
  return { type: "space", duration };
}

function wholeMeasure(measure = 0): SelectionState {
  return {
    kind: "measure",
    startPartIndex: 0,
    endPartIndex: 0,
    startStaffIndex: 0,
    endStaffIndex: 0,
    startMeasure: measure,
    endMeasure: measure,
  };
}

function fixture(secondary: SequenceContent[], destination: "quarter" | "whole" = "quarter"): Score {
  return {
    mnx: { version: 1 },
    global: { measures: Array.from({ length: 3 }, () => ({ time: { count: 4, unit: 4 } })) },
    parts: [
      {
        measures: Array.from({ length: 3 }, (_, measure) => ({
          sequences: [
            {
              staff: 1,
              content: [0, 1, 2, 3].map((beat) => note(`primary-${measure}-${beat}`, "C")),
            },
            {
              staff: 1,
              content:
                measure === 0
                  ? secondary
                  : Array.from({ length: destination === "whole" ? 1 : 4 }, (_, beat) =>
                      note(`destination-${measure}-${beat}`, "D", destination),
                    ),
            },
          ],
        })),
      },
      {
        name: "Unrelated part",
        measures: Array.from({ length: 3 }, (_, measure) => ({
          sequences: [{ content: [note(`untouched-${measure}`, "D", "whole")] }],
        })),
      },
    ],
  };
}

function contentAt(score: Score, measure: number, voice = 1): SequenceContent[] {
  return score.parts[0]!.measures[measure]!.sequences[voice]!.content;
}

function profile(content: SequenceContent[]) {
  let beat = 0;
  return content.flatMap((item) => {
    const start = beat;
    const beats = sequenceContentBeats(item);
    beat += beats;
    return item.type === "event" && item.notes ? [[start, beats, item.notes[0]!.pitch.step]] : [];
  });
}

function spaces(content: SequenceContent[]) {
  return content.filter((item) => item.type === "space").map((item) => item.duration);
}

function ids(content: SequenceContent[]) {
  return content.flatMap((item) =>
    item.type === "event" ? [item.id, ...(item.notes ?? []).map((entry) => entry.id)] : [],
  );
}

function recapture(result: Placement, measure: number, secondaryStart = 0, secondaryEnd = 4) {
  expect(result.selection?.kind).toBe("multi");
  if (result.selection?.kind !== "multi") throw new Error("Expected an automatic timed selection");
  expect(result.selection.rhythmicRange).toEqual({
    start: { measureIndex: measure, beat: 0 },
    end: { measureIndex: measure, beat: 4 },
    tracks: [0, 1].map((voice) => ({
      partIndex: 0,
      staff: 1,
      voice,
      start: { measureIndex: measure, beat: voice === 0 ? 0 : secondaryStart },
      end: { measureIndex: measure, beat: voice === 0 ? 4 : secondaryEnd },
    })),
  });
  const captured = buildClipboardSelection(result.newScore, result.selection!)!;
  expect(captured).not.toBeNull();
  expect(captured.captureOrigin).toEqual({ measureIndex: measure, beat: 0 });
  expect(captured.tracks).toHaveLength(2);
  expect(captured.events).toEqual(captured.tracks![0]!.content);
  expect(profile(captured.events)).toEqual([
    [0, 1, "C"],
    [1, 1, "C"],
    [2, 1, "C"],
    [3, 1, "C"],
  ]);
  expect([...result.selection.elementIds].sort()).toEqual(
    captured
      .tracks!.flatMap((track) =>
        track.content.flatMap((item) =>
          item.type === "event" ? [`p0/m${measure}/s${track.voiceIndex}/${item.id}`] : [],
        ),
      )
      .sort(),
  );
  return captured;
}

function expectPreserved(before: Score, after: Score, measure: number) {
  expect(after.parts[1]).toEqual(before.parts[1]);
  expect(after.global).toEqual(before.global);
  for (let previous = 0; previous < measure; previous++) {
    expect(after.parts[0]!.measures[previous]).toEqual(before.parts[0]!.measures[previous]);
  }
  expect(profile(contentAt(after, measure, 0))).toEqual(profile(contentAt(before, 0, 0)));
}

describe("automatic selections preserve occupied silence rather than voice offsets", () => {
  it.each(["quarter", "whole"] as const)(
    "overwrites a destination %s at beat zero with explicit leading silence on the second Repeat",
    (destination) => {
      const secondary = [space([1, 4]), note("g-1", "G"), note("g-2", "G"), space([1, 4])];
      const score = fixture(secondary, destination);
      const snapshot = structuredClone(score);
      let current = score;
      let captured = buildClipboardSelection(score, wholeMeasure())!;
      for (const measure of [1, 2]) {
        const before = structuredClone(current);
        const result = computeRepeatResult(current, captured)!;
        captured = recapture(result, measure);
        expect(captured.tracks![1]!.leadIn).toBeUndefined();
        expect(spaces(captured.tracks![1]!.content)).toEqual([
          [1, 4],
          [1, 4],
        ]);
        for (const bar of Array.from({ length: measure }, (_, index) => index + 1)) {
          const placed = contentAt(result.newScore, bar);
          expect(placed.map((item) => item.type)).toEqual(["space", "event", "event", "space"]);
          expect(profile(placed)).toEqual([
            [1, 1, "G"],
            [2, 1, "G"],
          ]);
          expect(spaces(placed)).toEqual(spaces(secondary));
          expect(placed.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(4);
        }
        expectPreserved(before, result.newScore, measure);
        expect(current).toEqual(before);
        current = result.newScore;
      }
      expect(score).toEqual(snapshot);
    },
  );

  it.each([
    { name: "third-beat", leading: [1, 12], trailing: [2, 3], beat: 1 / 3 },
    { name: "denominator above 4096", leading: [1, 8192], trailing: [6143, 8192], beat: 1 / 2048 },
  ] satisfies { name: string; leading: Space["duration"]; trailing: Space["duration"]; beat: number }[])(
    "retains exact $name spaces through two automatic Repeat selections",
    ({ leading, trailing, beat }) => {
      const score = fixture([space(leading), note("fractional-g", "G"), space(trailing)], "whole");
      const snapshot = structuredClone(score);
      let current = score;
      let captured = buildClipboardSelection(score, wholeMeasure())!;
      for (const measure of [1, 2]) {
        const before = structuredClone(current);
        const result = computeRepeatResult(current, captured)!;
        captured = recapture(result, measure);
        const secondary = captured.tracks![1]!;
        expect(secondary.leadIn).toBeUndefined();
        expect(secondary.content.map((item) => item.type)).toEqual(["space", "event", "space"]);
        expect(spaces(secondary.content)).toEqual([leading, trailing]);
        expect(profile(secondary.content)).toEqual([[beat, 1, "G"]]);
        for (let bar = 1; bar <= measure; bar++) {
          const placed = contentAt(result.newScore, bar);
          expect(placed.map((item) => item.type)).toEqual(["space", "event", "space"]);
          expect(spaces(placed)).toEqual([leading, trailing]);
          expect(profile(placed)).toEqual([[beat, 1, "G"]]);
          expect(placed.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(4);
        }
        expectPreserved(before, result.newScore, measure);
        expect(current).toEqual(before);
        current = result.newScore;
      }
      expect(score).toEqual(snapshot);
    },
  );

  it("preserves destination notes before a true leadIn and after the secondary track ends", () => {
    const sourceG = note("source-g", "G");
    const score = fixture([space([1, 4]), sourceG, space([1, 2])]);
    const snapshot = structuredClone(score);
    const primary = contentAt(score, 0, 0);
    const tracks: ClipboardTrack[] = [
      { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: primary },
      { partOffset: 0, staffOffset: 0, voiceIndex: 1, leadIn: [1, 4], content: [sourceG] },
    ];
    const first = computePasteResult(score, wholeMeasure(1), assignFreshTrackIds(primary, tracks))!;
    const captured = recapture(first, 1, 1, 2);
    expect(captured.tracks![1]!.leadIn).toEqual([1, 4]);
    expect(captured.tracks![1]!.content).toHaveLength(1);
    expect(profile(captured.tracks![1]!.content)).toEqual([[0, 1, "G"]]);
    const firstSnapshot = structuredClone(first.newScore);
    const second = computeRepeatResult(first.newScore, captured)!;
    const recaptured = recapture(second, 2, 1, 2);
    expect(recaptured.tracks![1]!.leadIn).toEqual([1, 4]);
    expect(recaptured.tracks![1]!.content).toHaveLength(1);
    for (const measure of [1, 2]) {
      const placed = contentAt(second.newScore, measure);
      const original = contentAt(score, measure);
      expect(profile(placed)).toEqual([
        [0, 1, "D"],
        [1, 1, "G"],
        [2, 1, "D"],
        [3, 1, "D"],
      ]);
      expect(placed[0]).toEqual(original[0]);
      expect(placed.slice(2)).toEqual(original.slice(2));
      expect(spaces(placed)).toEqual([]);
      const freshIds = [...ids(contentAt(second.newScore, measure, 0)), ...ids([placed[1]!])];
      expect(new Set(freshIds).size).toBe(freshIds.length);
      const precedingIds = [0, 1].flatMap((voice) => ids(contentAt(second.newScore, measure - 1, voice)));
      expect(freshIds.every((id) => id !== undefined && !precedingIds.includes(id))).toBe(true);
    }
    expectPreserved(score, first.newScore, 1);
    expectPreserved(firstSnapshot, second.newScore, 2);
    expect(first.newScore).toEqual(firstSnapshot);
    expect(score).toEqual(snapshot);
  });
});

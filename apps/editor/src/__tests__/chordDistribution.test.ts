import { describe, expect, it } from "vitest";
import { isRest, type Note, type NoteEvent, type Score, type SequenceContent } from "@viritura/core";
import type { ClipboardFragment, ClipboardTrack } from "../clipboard/ClipboardFragment";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { computePasteResult } from "../clipboard/computePasteResult";
import { pasteResultFromFragment } from "../commands/clipboardCommands";
import {
  explodeFragment,
  FragmentDistributionError,
  mergeNotesIntoEvent,
  reduceFragment,
} from "../score/chordDistribution";
import { allocateTopDown } from "../score/chordDistribution/allocation";
import { buildBeatGrid } from "../score/chordDistribution/beatGrid";

function noteEvent(id: string, step: Note["pitch"]["step"], octave: number, base = "quarter"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: [{ id: `${id}-note`, pitch: { step, octave } }],
  } as NoteEvent;
}

function track(content: SequenceContent[], staffOffset: number, voiceIndex = 0): ClipboardTrack {
  return { partOffset: staffOffset, staffOffset, voiceIndex, content };
}

function fragment(tracks: ClipboardTrack[]): ClipboardFragment {
  return {
    type: "viritura/fragment",
    version: 1,
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    content: tracks[0]?.content ?? [],
    tracks,
  };
}

function eventPitches(content: readonly SequenceContent[]): string[][] {
  return content
    .filter((item): item is NoteEvent => item.type === "event")
    .map((event) =>
      isRest(event)
        ? []
        : (event.notes ?? []).map((note) => `${note.pitch.step}${note.pitch.alter ?? 0}/${note.pitch.octave}`),
    );
}

describe("allocateTopDown", () => {
  it("gives one entry to each slot and stacks overflow on the last", () => {
    expect(allocateTopDown([1, 2, 3, 4], 3)).toEqual([[1], [2], [3, 4]]);
  });

  it("leaves surplus slots empty", () => {
    expect(allocateTopDown([1], 3)).toEqual([[1], [], []]);
  });
});

describe("clipboard fragment distribution", () => {
  it("reduces two tracks to one low-to-high chordal track", () => {
    const source = fragment([track([noteEvent("c", "C", 4)], 0), track([noteEvent("e", "E", 4)], 1)]);

    const result = reduceFragment(source);

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks![0]).toMatchObject({ partOffset: 0, staffOffset: 0, voiceIndex: 0 });
    expect(eventPitches(result.tracks![0]!.content)).toEqual([["C0/4", "E0/4"]]);
    expect(eventPitches(source.tracks![0]!.content)).toEqual([["C0/4"]]);
  });

  it("explodes a three-note chord top-down across three tracks", () => {
    const source = fragment([
      track(
        [
          {
            ...noteEvent("chord", "C", 4),
            notes: [
              { id: "c", pitch: { step: "C", octave: 4 } },
              { id: "e", pitch: { step: "E", octave: 4 } },
              { id: "g", pitch: { step: "G", octave: 4 } },
            ],
          },
        ],
        0,
      ),
    ]);

    const result = explodeFragment(source);

    expect(result.tracks?.map((entry) => entry.staffOffset)).toEqual([0, 1, 2]);
    expect(result.tracks?.map((entry) => eventPitches(entry.content))).toEqual([[["G0/4"]], [["E0/4"]], [["C0/4"]]]);
  });

  it("stacks overflow on the last requested track", () => {
    const source = fragment([
      track(
        [
          {
            ...noteEvent("chord", "C", 4),
            notes: ["C", "E", "G", "B"].map((step, index) => ({
              id: `n${index}`,
              pitch: { step, octave: 4 },
            })) as Note[],
          },
        ],
        0,
      ),
    ]);

    const result = explodeFragment(source, 2);

    expect(result.tracks?.map((entry) => eventPitches(entry.content))).toEqual([
      [["B0/4"]],
      [["C0/4", "E0/4", "G0/4"]],
    ]);
  });

  it("writes rests to requested tracks that receive no pitches", () => {
    const source = fragment([
      track(
        [
          {
            ...noteEvent("chord", "C", 4),
            notes: [
              { id: "c", pitch: { step: "C", octave: 4 } },
              { id: "g", pitch: { step: "G", octave: 4 } },
            ],
          },
        ],
        0,
      ),
    ]);

    const result = explodeFragment(source, 3);

    expect(eventPitches(result.tracks![2]!.content)).toEqual([[]]);
  });

  it("uses the union rhythm when a half note sounds against running eighths", () => {
    const source = fragment([
      track([noteEvent("half", "C", 4, "half")], 0),
      track(
        [
          noteEvent("e1", "E", 4, "eighth"),
          noteEvent("f", "F", 4, "eighth"),
          noteEvent("g", "G", 4, "eighth"),
          noteEvent("a", "A", 4, "eighth"),
        ],
        1,
      ),
    ]);

    const result = reduceFragment(source);
    const events = result.tracks![0]!.content.filter((item): item is NoteEvent => item.type === "event");

    expect(events.map((event) => event.duration.base)).toEqual(["eighth", "eighth", "eighth", "eighth"]);
    expect(eventPitches(events)).toEqual([
      ["C0/4", "E0/4"],
      ["C0/4", "F0/4"],
      ["C0/4", "G0/4"],
      ["C0/4", "A0/4"],
    ]);
    expect(events[0]!.notes?.[0]!.ties?.[0]?.target).toBe(events[1]!.notes?.[0]!.id);
  });

  it("refuses fragments containing a secondary voice", () => {
    const source = fragment([track([noteEvent("c", "C", 4)], 0), track([noteEvent("e", "E", 4)], 0, 1)]);

    expect(() => reduceFragment(source)).toThrow(FragmentDistributionError);
  });

  it("refuses flat-grid transforms for unsupported rhythmic containers", () => {
    const grid = buildBeatGrid([{ content: [{ type: "grace", content: [] }], leadInBeats: 0 }], { count: 4, unit: 4 });

    expect(grid).toBeNull();
  });
});

describe("copy, reduce, and paste workflow", () => {
  it("copies two single-voice staves, chords the destination, and leaves the sources untouched", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        { name: "Flute 1", measures: [{ sequences: [{ content: [noteEvent("fl1", "C", 5, "whole")] }] }] },
        { name: "Flute 2", measures: [{ sequences: [{ content: [noteEvent("fl2", "E", 5, "whole")] }] }] },
        { name: "Destination", measures: [{ sequences: [{ content: [] }] }] },
      ],
    };
    const sourceSnapshot = structuredClone(score.parts.slice(0, 2));
    const copied = buildClipboardSelection(score, {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 1,
      startStaffIndex: 0,
      endStaffIndex: 1,
      startLocalStaffIndex: 0,
      endLocalStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    });
    expect(copied).not.toBeNull();
    const copiedFragment = fragment(copied!.tracks);

    const result = computePasteResult(
      score,
      {
        kind: "measure",
        startPartIndex: 2,
        endPartIndex: 2,
        startStaffIndex: 2,
        endStaffIndex: 2,
        startLocalStaffIndex: 0,
        endLocalStaffIndex: 0,
        startMeasure: 0,
        endMeasure: 0,
      },
      pasteResultFromFragment(reduceFragment(copiedFragment)),
    );

    expect(result).not.toBeNull();
    expect(result!.newScore.parts.slice(0, 2)).toEqual(sourceSnapshot);
    expect(eventPitches(result!.newScore.parts[2]!.measures[0]!.sequences[0]!.content)).toEqual([["C0/5", "E0/5"]]);
  });
});

describe("mergeNotesIntoEvent", () => {
  it("adds pitches and keeps the chord ordered low to high", () => {
    const target = noteEvent("target", "G", 4);
    mergeNotesIntoEvent(target, [{ pitch: { step: "C", octave: 4 } }, { pitch: { step: "E", octave: 4 } }]);
    expect(eventPitches([target])).toEqual([["C0/4", "E0/4", "G0/4"]]);
  });

  it("drops duplicate pitches", () => {
    const target = noteEvent("target", "C", 4);
    expect(mergeNotesIntoEvent(target, [{ pitch: { step: "C", octave: 4 } }])).toBe(false);
  });
});

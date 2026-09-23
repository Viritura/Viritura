import { describe, expect, it } from "vitest";
import { isRest, type Note, type NoteEvent, type Score, type SequenceContent, type Tuplet } from "@viritura/core";
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

  it("spells a silent staff's rest from its position within a later measure", () => {
    const chord = (id: string, base: string): NoteEvent =>
      ({
        type: "event",
        id,
        duration: { base },
        notes: [
          { id: `${id}-c`, pitch: { step: "C", octave: 4 } },
          { id: `${id}-e`, pitch: { step: "E", octave: 4 } },
        ],
      }) as NoteEvent;
    // Measure 2 is a single note, so the lower staff falls silent for that whole
    // measure. Its rest has to be spelled from beat 0 of the measure, not from
    // the fragment-absolute beat 4.
    const source = fragment([track([chord("m1", "whole"), noteEvent("solo", "E", 4, "whole")], 0)]);

    const lower = explodeFragment(source, 2).tracks![1]!.content as NoteEvent[];
    const rests = lower.filter((event) => isRest(event));

    expect(rests.map((event) => event.duration)).toEqual([{ base: "half" }, { base: "half" }]);
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
    const grid = buildBeatGrid([{ content: [{ type: "grace", content: [] }], leadInBeats: 0 }], {
      timeSignature: { count: 4, unit: 4 },
      metered: true,
      startBeat: 0,
    });

    expect(grid).toBeNull();
  });
});

describe("expression carried through distribution", () => {
  function articulated(event: NoteEvent, markings: NoteEvent["markings"]): NoteEvent {
    return { ...event, markings };
  }

  it("repeats a chord's articulations on every exploded staff", () => {
    const chord: NoteEvent = {
      type: "event",
      id: "chord",
      duration: { base: "quarter" },
      notes: [
        { id: "n1", pitch: { step: "C", octave: 4 } },
        { id: "n2", pitch: { step: "E", octave: 4 } },
        { id: "n3", pitch: { step: "G", octave: 4 } },
      ],
      markings: { staccato: {}, accent: {} },
      fermata: {},
    };

    const result = explodeFragment(fragment([track([chord], 0)]));

    expect(result.tracks).toHaveLength(3);
    for (const target of result.tracks!) {
      const event = target.content[0] as NoteEvent;
      expect(event.markings).toEqual({ staccato: {}, accent: {} });
      expect(event.fermata).toEqual({});
    }
  });

  it("absorbs every source staff's articulations into the reduced chord", () => {
    const source = fragment([
      track([articulated(noteEvent("top", "G", 5), { accent: {} })], 0),
      track([articulated(noteEvent("bottom", "C", 5), { staccato: {} })], 1),
    ]);

    const event = reduceFragment(source).tracks![0]!.content[0] as NoteEvent;

    expect(event.markings).toEqual({ accent: {}, staccato: {} });
  });

  it("does not restate articulations on a tied continuation", () => {
    const source = fragment([
      track([articulated(noteEvent("held", "C", 4, "half"), { accent: {} })], 0),
      track([noteEvent("e1", "E", 4), noteEvent("e2", "F", 4)], 1),
    ]);

    const events = reduceFragment(source).tracks![0]!.content as NoteEvent[];

    expect(events[0]!.markings).toEqual({ accent: {} });
    expect(events[1]!.markings).toBeUndefined();
  });

  it("drops stem overrides and id-bound spanners that no longer resolve", () => {
    const chord: NoteEvent = {
      type: "event",
      id: "chord",
      duration: { base: "quarter" },
      notes: [
        { id: "n1", pitch: { step: "C", octave: 4 } },
        { id: "n2", pitch: { step: "G", octave: 4 } },
      ],
      stemDirection: "down",
      slurs: [{ target: "somewhere-else" }],
    };

    const result = explodeFragment(fragment([track([chord], 0)]));

    for (const target of result.tracks!) {
      const event = target.content[0] as NoteEvent;
      expect(event.stemDirection).toBeUndefined();
      expect(event.slurs).toBeUndefined();
    }
  });

  it("gives every exploded staff the source dynamics", () => {
    const source = fragment([
      {
        ...track([noteEvent("chord", "C", 4)], 0),
        content: [
          {
            type: "event",
            id: "chord",
            duration: { base: "quarter" },
            notes: [
              { id: "n1", pitch: { step: "C", octave: 4 } },
              { id: "n2", pitch: { step: "G", octave: 4 } },
            ],
          } as NoteEvent,
        ],
        dynamics: [
          {
            measureOffset: 0,
            dynamic: { id: "d1", type: "immediate", value: "ff", position: { fraction: [0, 4] } },
          },
        ],
      },
    ]);

    const result = explodeFragment(source);

    expect(result.tracks).toHaveLength(2);
    expect(result.tracks!.map((target) => target.dynamics?.map((item) => item.dynamic.value))).toEqual([
      ["ff"],
      ["ff"],
    ]);
    expect(result.dynamics).toBeUndefined();
  });

  it("collapses duplicate dynamics when reducing and keeps the topmost staff's reading", () => {
    const dynamicAt = (id: string, value: string) => ({
      measureOffset: 0,
      dynamic: { id, type: "immediate" as const, value, position: { fraction: [0, 4] as [number, number] } },
    });
    const source = fragment([
      { ...track([noteEvent("top", "G", 5)], 0), dynamics: [dynamicAt("d1", "p")] },
      { ...track([noteEvent("bottom", "C", 5)], 1), dynamics: [dynamicAt("d2", "f")] },
    ]);

    const result = reduceFragment(source);

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks![0]!.dynamics?.map((item) => item.dynamic.value)).toEqual(["p"]);
  });
});

describe("tuplet distribution", () => {
  function triplet(pitches: [Note["pitch"]["step"], number][], idPrefix: string): Tuplet {
    return {
      type: "tuplet",
      inner: { duration: { base: "eighth" }, multiple: 3 },
      outer: { duration: { base: "eighth" }, multiple: 2 },
      content: pitches.map(([step, octave], index) => noteEvent(`${idPrefix}${index}`, step, octave, "eighth")),
    };
  }

  it("explodes a tuplet of chords into a tuplet on every staff", () => {
    const chordTriplet: Tuplet = {
      type: "tuplet",
      inner: { duration: { base: "eighth" }, multiple: 3 },
      outer: { duration: { base: "eighth" }, multiple: 2 },
      bracket: "yes",
      content: [0, 1, 2].map((index) => ({
        type: "event",
        id: `t${index}`,
        duration: { base: "eighth" },
        notes: [
          { id: `t${index}-lo`, pitch: { step: "C", octave: 4 } },
          { id: `t${index}-hi`, pitch: { step: "G", octave: 4 } },
        ],
      })) as NoteEvent[],
    };

    const result = explodeFragment(fragment([track([chordTriplet], 0)]));

    expect(result.tracks).toHaveLength(2);
    for (const [index, target] of result.tracks!.entries()) {
      const tuplet = target.content[0] as Tuplet;
      expect(tuplet.type).toBe("tuplet");
      expect(tuplet.bracket).toBe("yes");
      expect(tuplet.inner).toEqual({ duration: { base: "eighth" }, multiple: 3 });
      expect(eventPitches(tuplet.content)).toEqual(
        index === 0 ? [["G0/4"], ["G0/4"], ["G0/4"]] : [["C0/4"], ["C0/4"], ["C0/4"]],
      );
    }
  });

  it("reduces aligned tuplets from two staves into one chordal tuplet", () => {
    const source = fragment([
      track(
        [
          triplet(
            [
              ["G", 5],
              ["A", 5],
              ["B", 5],
            ],
            "top",
          ),
        ],
        0,
      ),
      track(
        [
          triplet(
            [
              ["C", 5],
              ["D", 5],
              ["E", 5],
            ],
            "low",
          ),
        ],
        1,
      ),
    ]);

    const result = reduceFragment(source);

    expect(result.tracks).toHaveLength(1);
    const tuplet = result.tracks![0]!.content[0] as Tuplet;
    expect(tuplet.type).toBe("tuplet");
    expect(eventPitches(tuplet.content)).toEqual([
      ["C0/5", "G0/5"],
      ["D0/5", "A0/5"],
      ["E0/5", "B0/5"],
    ]);
  });

  it("distributes a tuplet's articulations alongside its pitches", () => {
    const marked = triplet(
      [
        ["C", 4],
        ["E", 4],
        ["G", 4],
      ],
      "m",
    );
    marked.content = marked.content.map((item) => ({ ...(item as NoteEvent), markings: { staccato: {} } }));

    const tuplet = explodeFragment(fragment([track([marked], 0)])).tracks![0]!.content[0] as Tuplet;

    expect(tuplet.content.map((item) => (item as NoteEvent).markings)).toEqual([
      { staccato: {} },
      { staccato: {} },
      { staccato: {} },
    ]);
  });

  it("keeps plain runs on either side of a tuplet", () => {
    const source = fragment([
      track(
        [
          noteEvent("before", "C", 4, "quarter"),
          triplet(
            [
              ["D", 4],
              ["E", 4],
              ["F", 4],
            ],
            "t",
          ),
        ],
        0,
      ),
    ]);

    const content = reduceFragment(source).tracks![0]!.content;

    expect(content.map((item) => item.type)).toEqual(["event", "tuplet"]);
  });

  it("notates a silent staff's share of a tuplet as a plain rest", () => {
    const source = fragment([
      track(
        [
          triplet(
            [
              ["C", 4],
              ["E", 4],
              ["G", 4],
            ],
            "t",
          ),
        ],
        0,
      ),
    ]);

    const result = explodeFragment(source, 4);

    expect((result.tracks![0]!.content[0] as Tuplet).type).toBe("tuplet");
    const silent = result.tracks![3]!.content as NoteEvent[];
    expect(silent.every((item) => item.type === "event" && isRest(item))).toBe(true);
    expect(silent.map((item) => item.duration.base)).toEqual(["quarter"]);
  });

  it("refuses a tuplet sounding against unmatched rhythm on another staff", () => {
    const source = fragment([
      track(
        [
          triplet(
            [
              ["C", 5],
              ["D", 5],
              ["E", 5],
            ],
            "t",
          ),
        ],
        0,
      ),
      track([noteEvent("straight", "G", 4, "quarter")], 1),
    ]);

    expect(() => reduceFragment(source)).toThrow(FragmentDistributionError);
  });

  it("refuses staves whose tuplet ratios differ over the same beats", () => {
    const quintuplet: Tuplet = {
      type: "tuplet",
      inner: { duration: { base: "16th" }, multiple: 5 },
      outer: { duration: { base: "eighth" }, multiple: 2 },
      content: [0, 1, 2, 3, 4].map((index) => noteEvent(`q${index}`, "C", 5, "16th")),
    };
    const source = fragment([
      track(
        [
          triplet(
            [
              ["C", 5],
              ["D", 5],
              ["E", 5],
            ],
            "t",
          ),
        ],
        0,
      ),
      track([quintuplet], 1),
    ]);

    expect(() => reduceFragment(source)).toThrow(FragmentDistributionError);
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

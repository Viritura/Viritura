import { describe, expect, it } from "vitest";
import type { Note, NoteEvent, Pitch, Score } from "@viritura/core";
import { allocateTopDown } from "../score/chordDistribution/allocation";
import { buildBeatGrid, maxSimultaneity } from "../score/chordDistribution/beatGrid";
import type { MeasureWindow } from "../score/chordDistribution/selectionRange";
import { mergeNotesIntoEvent } from "../score/chordDistribution/chordMerge";
import { redistributeStaves } from "../score/chordDistribution/redistribute";
import { applyDistribution } from "../score/chordDistribution/selectionPlan";
import { scoreStaffOrder, type StaffRef } from "../score/chordDistribution/staffOrder";
import type { Selection } from "../store/selectionStore";

function pitch(step: Pitch["step"], octave: number): Pitch {
  return { step, octave: octave as Pitch["octave"] };
}

/** Windows covering whole 4/4 measures, the scope these fixtures all use. */
function wholeMeasures(start: number, end: number): MeasureWindow[] {
  return Array.from({ length: end - start + 1 }, (_, offset) => ({
    measureIndex: start + offset,
    start: 0,
    end: 4,
  }));
}

function note(step: Pitch["step"], octave: number, id?: string): Note {
  return { ...(id ? { id } : {}), pitch: pitch(step, octave) };
}

function chord(base: "whole" | "half" | "quarter", pitches: Note[], id: string): NoteEvent {
  return { type: "event", id, duration: { base }, notes: pitches };
}

function rest(base: "whole" | "half" | "quarter", id: string): NoteEvent {
  return { type: "event", id, duration: { base }, rest: {} };
}

/** Three single-staff parts in 4/4; only the top staff carries music. */
function chordOnTopStaff(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Violin I",
        measures: [
          {
            sequences: [{ content: [chord("whole", [note("C", 4), note("E", 4), note("G", 4)], "top")] }],
          },
        ],
      },
      { name: "Violin II", measures: [{ sequences: [{ content: [rest("whole", "r2")] }] }] },
      { name: "Viola", measures: [{ sequences: [{ content: [rest("whole", "r3")] }] }] },
    ],
  };
}

function notesOf(score: Score, partIndex: number): Note[][] {
  const content = score.parts[partIndex]!.measures[0]!.sequences[0]!.content;
  return content.map((item) => (item.type === "event" ? (item.notes ?? []) : []));
}

function steps(score: Score, partIndex: number): string[][] {
  return notesOf(score, partIndex).map((notes) => notes.map((entry) => `${entry.pitch.step}${entry.pitch.octave}`));
}

const allStaves = (score: Score) => scoreStaffOrder(score);
/** Wrap canonical staves as one-member visible staves (the uncondensed case). */
const visible = (refs: readonly StaffRef[]) => refs.map((ref) => ({ members: [ref] }));

describe("allocateTopDown", () => {
  it("gives one entry to each slot and stacks overflow on the last", () => {
    expect(allocateTopDown([1, 2, 3, 4], 2)).toEqual([[1], [2, 3, 4]]);
  });

  it("leaves surplus slots empty", () => {
    expect(allocateTopDown([1], 3)).toEqual([[1], [], []]);
  });

  it("returns nothing when there are no targets", () => {
    expect(allocateTopDown([1, 2], 0)).toEqual([]);
  });
});

describe("buildBeatGrid", () => {
  it("splits a measure at the union of source onsets", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        { name: "A", measures: [{ sequences: [{ content: [chord("whole", [note("C", 5)], "a")] }] }] },
        {
          name: "B",
          measures: [
            {
              sequences: [{ content: [chord("half", [note("E", 4)], "b1"), chord("half", [note("F", 4)], "b2")] }],
            },
          ],
        },
      ],
    };
    const grid = buildBeatGrid(score, allStaves(score), wholeMeasures(0, 0));
    expect(grid.measures[0]!.slots.map((slot) => [slot.beat, slot.beats])).toEqual([
      [0, 2],
      [2, 2],
    ]);
    // The whole note sounds through both slots, continuing into the second.
    expect(grid.measures[0]!.slots[1]!.notes.map((entry) => entry.continuation)).toEqual([true, false]);
    expect(maxSimultaneity(grid)).toBe(2);
  });

  it("reports measures whose sources contain unsupported containers", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "A",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "tuplet",
                      inner: { duration: { base: "eighth" }, multiple: 3 },
                      outer: { duration: { base: "quarter" }, multiple: 1 },
                      content: [chord("quarter", [note("C", 4)], "t1")],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const grid = buildBeatGrid(score, allStaves(score), wholeMeasures(0, 0));
    expect(grid.measures).toHaveLength(0);
    expect(grid.skippedMeasures).toEqual([0]);
  });
});

describe("redistributeStaves", () => {
  it("explodes a chord top-down across three staves", () => {
    const score = chordOnTopStaff();
    const staves = allStaves(score);
    const { score: next, changed } = redistributeStaves(score, {
      sources: visible([staves[0]!]),
      targets: visible(staves),
      windows: wholeMeasures(0, 0),
    });

    expect(changed).toBe(true);
    expect(steps(next, 0)).toEqual([["G4"]]);
    expect(steps(next, 1)).toEqual([["E4"]]);
    expect(steps(next, 2)).toEqual([["C4"]]);
  });

  it("stacks overflow on the bottom staff when the chord is taller than the target count", () => {
    const score = chordOnTopStaff();
    const staves = allStaves(score);
    const { score: next } = redistributeStaves(score, {
      sources: visible([staves[0]!]),
      targets: visible([staves[0]!, staves[1]!]),
      windows: wholeMeasures(0, 0),
    });

    expect(steps(next, 0)).toEqual([["G4"]]);
    expect(steps(next, 1)).toEqual([["C4", "E4"]]);
  });

  it("rests target staves that receive nothing", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        { name: "A", measures: [{ sequences: [{ content: [chord("whole", [note("C", 5)], "a")] }] }] },
        { name: "B", measures: [{ sequences: [{ content: [chord("whole", [note("G", 4)], "b")] }] }] },
      ],
    };
    const staves = allStaves(score);
    const { score: next } = redistributeStaves(score, {
      sources: visible([staves[0]!]),
      targets: visible(staves),
      windows: wholeMeasures(0, 0),
    });

    expect(steps(next, 0)).toEqual([["C5"]]);
    const second = next.parts[1]!.measures[0]!.sequences[0]!.content[0]!;
    expect(second.type === "event" && second.rest).toBeTruthy();
  });

  it("reduces many staves onto the top staff and rests the rest", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        { name: "A", measures: [{ sequences: [{ content: [chord("whole", [note("G", 4)], "a")] }] }] },
        { name: "B", measures: [{ sequences: [{ content: [chord("whole", [note("E", 4)], "b")] }] }] },
        { name: "C", measures: [{ sequences: [{ content: [chord("whole", [note("C", 4)], "c")] }] }] },
      ],
    };
    const staves = allStaves(score);
    const { score: next } = redistributeStaves(score, {
      sources: visible(staves),
      targets: visible([staves[0]!]),
      windows: wholeMeasures(0, 0),
    });

    expect(steps(next, 0)).toEqual([["C4", "E4", "G4"]]);
    for (const partIndex of [1, 2]) {
      const item = next.parts[partIndex]!.measures[0]!.sequences[0]!.content[0]!;
      expect(item.type === "event" && item.rest).toBeTruthy();
    }
  });

  it("ties a sustained pitch across the slots the grid splits it into", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        { name: "A", measures: [{ sequences: [{ content: [chord("whole", [note("C", 5)], "a")] }] }] },
        {
          name: "B",
          measures: [
            {
              sequences: [{ content: [chord("half", [note("E", 4)], "b1"), chord("half", [note("F", 4)], "b2")] }],
            },
          ],
        },
      ],
    };
    const staves = allStaves(score);
    const { score: next } = redistributeStaves(score, {
      sources: visible(staves),
      targets: visible(staves),
      windows: wholeMeasures(0, 0),
    });

    const top = notesOf(next, 0);
    expect(top.map((notes) => notes.map((entry) => `${entry.pitch.step}${entry.pitch.octave}`))).toEqual([
      ["C5"],
      ["C5"],
    ]);
    expect(top[0]![0]!.ties?.[0]?.target).toBe(top[1]![0]!.id);
    // The lower staff re-articulates because the pitch changed.
    expect(notesOf(next, 1)[0]![0]!.ties).toBeUndefined();
  });

  it("leaves measures with unsupported containers alone and warns", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, { time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "A",
          measures: [
            { sequences: [{ content: [chord("whole", [note("C", 4), note("G", 4)], "m0")] }] },
            {
              sequences: [
                {
                  content: [
                    {
                      type: "tuplet",
                      inner: { duration: { base: "eighth" }, multiple: 3 },
                      outer: { duration: { base: "quarter" }, multiple: 1 },
                      content: [chord("quarter", [note("D", 4)], "t")],
                    },
                    rest("half", "r"),
                    rest("quarter", "r2"),
                  ],
                },
              ],
            },
          ],
        },
        {
          name: "B",
          measures: [
            { sequences: [{ content: [rest("whole", "b0")] }] },
            { sequences: [{ content: [rest("whole", "b1")] }] },
          ],
        },
      ],
    };
    const staves = allStaves(score);
    const result = redistributeStaves(score, {
      sources: visible([staves[0]!]),
      targets: visible(staves),
      windows: wholeMeasures(0, 1),
    });

    expect(steps(result.score, 0)).toEqual([["G4"]]);
    expect(steps(result.score, 1)).toEqual([["C4"]]);
    expect(result.score.parts[0]!.measures[1]!.sequences[0]!.content[0]!.type).toBe("tuplet");
    expect(result.warnings.join(" ")).toContain("Measures 2");
  });
});

describe("applyDistribution", () => {
  const selectTop: Selection = { kind: "single", elementId: "p0/m0/s0/top", elementType: "event" };

  it("annexes staves below the selection when exploding", () => {
    const score = chordOnTopStaff();
    const result = applyDistribution(score, selectTop, "explode");
    expect(result?.changed).toBe(true);
    expect(steps(result!.score, 0)).toEqual([["G4"]]);
    expect(steps(result!.score, 1)).toEqual([["E4"]]);
    expect(steps(result!.score, 2)).toEqual([["C4"]]);
  });

  it("does not annex staves when reducing", () => {
    const score = chordOnTopStaff();
    const result = applyDistribution(score, selectTop, "reduce");
    expect(steps(result!.score, 0)).toEqual([["C4", "E4", "G4"]]);
    expect(steps(result!.score, 1)).toEqual([[]]);
  });

  it("returns null when nothing is selected", () => {
    expect(applyDistribution(chordOnTopStaff(), { kind: "none" }, "explode")).toBeNull();
  });

  it("rewrites only the selected span and leaves the target staff's other music alone", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "A",
          measures: [
            {
              sequences: [
                {
                  content: [chord("half", [note("C", 4), note("E", 4)], "src"), chord("half", [note("D", 4)], "keepA")],
                },
              ],
            },
          ],
        },
        {
          name: "B",
          measures: [
            {
              sequences: [{ content: [chord("half", [note("B", 3)], "b1"), chord("half", [note("A", 3)], "keepB")] }],
            },
          ],
        },
      ],
    };
    const result = applyDistribution(
      score,
      { kind: "single", elementId: "p0/m0/s0/src", elementType: "event" },
      "explode",
    );

    expect(result?.changed).toBe(true);
    // The unselected second half of both staves survives verbatim.
    expect(steps(result!.score, 0)).toEqual([["E4"], ["D4"]]);
    expect(steps(result!.score, 1)).toEqual([["C4"], ["A3"]]);
  });

  /**
   * A condensed staff renders several parts as one line. Distribution has to
   * follow the *rendered* order: pooling both halves of the condensed staff as
   * one source, and treating the next staff down as the next visible staff —
   * not the hidden sibling sharing the staff the notes came from.
   */
  it("pools a condensed staff and explodes onto the next visible staff", () => {
    const part = (id: string, name: string, step: Pitch["step"], octave: number, eventId: string) => ({
      id,
      name,
      measures: [{ sequences: [{ content: [chord("whole", [note(step, octave)], eventId)] }] }],
    });
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        part("P1", "Flute", "G", 5, "fl1"),
        part("P2", "Flute", "D", 5, "fl2"),
        part("P3", "Oboe", "G", 4, "ob1"),
        part("P4", "Oboe", "D", 4, "ob2"),
      ],
      layouts: [
        {
          id: "condensed",
          content: [
            { type: "staff", sources: [{ part: "P1" }, { part: "P2" }] },
            { type: "staff", sources: [{ part: "P3" }, { part: "P4" }] },
          ],
        },
      ],
      scores: [{ name: "Condensed", layout: "condensed" }],
    };

    const selection: Selection = { kind: "single", elementId: "p0/m0/s0/fl1", elementType: "event" };
    const result = applyDistribution(score, selection, "explode", 0);

    expect(result?.changed).toBe(true);
    // Both flute parts pool into one source, so the pair explodes across the
    // two *visible* staves rather than vanishing into the condensed sibling.
    expect(steps(result!.score, 0)).toEqual([["G5"]]);
    expect(steps(result!.score, 2)).toEqual([["D5"]]);
    // The condensed siblings are silenced (rest granularity is not significant).
    expect(steps(result!.score, 1).flat()).toEqual([]);
    expect(steps(result!.score, 3).flat()).toEqual([]);
  });

  it("reduces a canvas range through the condensed projection's canonical events", () => {
    const part = (id: string, step: Pitch["step"], octave: number, prefix: string) => ({
      id,
      measures: [
        {
          sequences: [
            {
              content: [
                chord("half", [note(step, octave)], `${prefix}1`),
                chord("half", [note(step, octave + 1)], `${prefix}2`),
              ],
            },
          ],
        },
      ],
    });
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [part("P1", "G", 4, "fl1-"), part("P2", "E", 4, "fl2-")],
      layouts: [
        {
          id: "condensed",
          content: [{ type: "staff", sources: [{ part: "P1" }, { part: "P2" }] }],
        },
      ],
      scores: [{ name: "Condensed", layout: "condensed" }],
    };
    // This is the range shape emitted by two Shift-clicks on the canvas. The
    // pointer metadata identifies the visual condensed row; unlike the older
    // tests, it is not a fabricated bare event selection.
    const selection: Selection = {
      kind: "range",
      startElementId: "p0/m0/s0/fl1-1",
      endElementId: "p0/m0/s0/fl1-2",
      measureAnchor: { partIndex: 0, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
      measureFocus: { partIndex: 0, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
    };

    const result = applyDistribution(score, selection, "reduce", 0);

    expect(result?.changed).toBe(true);
    expect(steps(result!.score, 0)).toEqual([
      ["E4", "G4"],
      ["E5", "G5"],
    ]);
    expect(steps(result!.score, 1).flat()).toEqual([]);
  });
});

describe("mergeNotesIntoEvent", () => {
  it("adds pitches and keeps the chord ordered low to high", () => {
    const event = chord("whole", [note("E", 4)], "x");
    expect(mergeNotesIntoEvent(event, [note("C", 4), note("G", 4)])).toBe(true);
    expect(event.notes!.map((entry) => entry.pitch.step)).toEqual(["C", "E", "G"]);
  });

  it("drops duplicates of a pitch already in the chord", () => {
    const event = chord("whole", [note("E", 4)], "x");
    expect(mergeNotesIntoEvent(event, [note("E", 4)])).toBe(false);
    expect(event.notes).toHaveLength(1);
  });

  it("turns a rest into the incoming chord", () => {
    const event = rest("whole", "r");
    expect(mergeNotesIntoEvent(event, [note("C", 4)])).toBe(true);
    expect(event.rest).toBeUndefined();
    expect(event.notes).toHaveLength(1);
  });

  it("gives merged notes fresh identities", () => {
    const event = chord("whole", [note("E", 4, "keep")], "x");
    const incoming = note("C", 4, "source");
    mergeNotesIntoEvent(event, [incoming]);
    expect(event.notes!.find((entry) => entry.pitch.step === "C")!.id).not.toBe("source");
  });
});

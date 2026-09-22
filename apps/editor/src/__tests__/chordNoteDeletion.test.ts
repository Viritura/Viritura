/**
 * Deleting a notehead removes that note, not its chord.
 *
 * The event-level primitive replaces an event with a rest, which is only the
 * right answer once the event has no notes left. These tests pin the split:
 * partial selections thin the chord, full ones fall through to the rest.
 */

import { describe, it, expect } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { removeChordNotes, groupNoteheadsByEvent, isNoteheadId } from "../commands/chordNoteDeletion";

const CHORD = "p0/m0/s0/c1";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "c1",
                    duration: { base: "quarter" },
                    notes: [
                      { id: "c1n0", pitch: { step: "C", octave: 4 } },
                      { id: "c1n1", pitch: { step: "E", octave: 4 } },
                      { id: "c1n2", pitch: { step: "G", octave: 4 } },
                    ],
                  },
                  {
                    type: "event",
                    id: "e2",
                    duration: { base: "quarter" },
                    notes: [{ id: "e2n0", pitch: { step: "A", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

function eventAt(score: Score, index: number): NoteEvent {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[index] as NoteEvent;
}

function steps(score: Score, index: number): string[] {
  return (eventAt(score, index).notes ?? []).map((n) => n.pitch.step);
}

function resultScore(result: ReturnType<typeof computeDeleteSelection>): Score {
  return (result as { score: Score }).score;
}

describe("isNoteheadId / groupNoteheadsByEvent", () => {
  it("recognises a notehead id and nothing else", () => {
    expect(isNoteheadId(`${CHORD}/n2`)).toBe(true);
    expect(isNoteheadId(CHORD)).toBe(false);
    expect(isNoteheadId(`${CHORD}/acc0`)).toBe(false);
  });

  it("collects every notehead of one chord under its event id", () => {
    const groups = groupNoteheadsByEvent([`${CHORD}/n0`, `${CHORD}/n2`, "p0/m0/s0/e2", "p0/m0/s0/e2/n0"]);
    expect(groups.get(CHORD)).toEqual([0, 2]);
    expect(groups.get("p0/m0/s0/e2")).toEqual([0]);
  });
});

describe("removeChordNotes", () => {
  it("removes the named notes and keeps the rest of the chord", () => {
    const score = makeScore();
    expect(removeChordNotes(score, CHORD, [0, 2])).toBe("removed");
    expect(steps(score, 0)).toEqual(["E"]);
    expect(eventAt(score, 0).rest).toBeUndefined();
  });

  it("reports a full-chord selection instead of emptying the event", () => {
    const score = makeScore();
    expect(removeChordNotes(score, CHORD, [0, 1, 2])).toBe("wholeEvent");
    // Untouched: producing the rest is the event-level primitive's job.
    expect(steps(score, 0)).toEqual(["C", "E", "G"]);
  });

  it("drops a tie aimed at a note that no longer exists", () => {
    const score = makeScore();
    eventAt(score, 0).notes![0]!.ties = [{ target: "e2n0" }];
    eventAt(score, 1).notes![0]!.ties = [{ target: "c1n2" }];

    expect(removeChordNotes(score, CHORD, [2])).toBe("removed");
    // The tie into the removed G goes; the one into A is untouched.
    expect(eventAt(score, 1).notes![0]!.ties).toBeUndefined();
    expect(eventAt(score, 0).notes![0]!.ties).toEqual([{ target: "e2n0" }]);
  });

  it("keeps a slur but drops the endpoint refinement naming a removed note", () => {
    const score = makeScore();
    eventAt(score, 0).slurs = [{ target: "e2", startNote: "c1n2", endNote: "e2n0" }];

    expect(removeChordNotes(score, CHORD, [2])).toBe("removed");
    const slur = eventAt(score, 0).slurs![0]!;
    expect(slur.target).toBe("e2");
    expect(slur.startNote).toBeUndefined();
    expect(slur.endNote).toBe("e2n0");
  });
});

describe("computeDeleteSelection — chord notes", () => {
  it("a single selected notehead leaves the rest of the chord", () => {
    const result = computeDeleteSelection(makeScore(), { kind: "single", elementId: `${CHORD}/n1` } as never);
    expect(result.kind).toBe("single");
    expect(steps(resultScore(result), 0)).toEqual(["C", "G"]);
  });

  it("clears the selection — the selected notehead is gone", () => {
    const result = computeDeleteSelection(makeScore(), { kind: "single", elementId: `${CHORD}/n1` } as never);
    expect((result as { nextSelection: { kind: string } }).nextSelection.kind).toBe("clear");
  });

  it("selecting the chord event itself still blanks it to a rest", () => {
    const result = computeDeleteSelection(makeScore(), { kind: "single", elementId: CHORD } as never);
    expect(eventAt(resultScore(result), 0).rest).toBeDefined();
  });

  it("a multi selection thins the chord by exactly the selected noteheads", () => {
    const result = computeDeleteSelection(makeScore(), {
      kind: "multi",
      elementIds: [`${CHORD}/n0`, `${CHORD}/n1`],
    } as never);
    expect(steps(resultScore(result), 0)).toEqual(["G"]);
  });

  it("a multi selection covering every notehead blanks the chord", () => {
    const result = computeDeleteSelection(makeScore(), {
      kind: "multi",
      elementIds: [`${CHORD}/n0`, `${CHORD}/n1`, `${CHORD}/n2`],
    } as never);
    const ev = eventAt(resultScore(result), 0);
    expect(ev.rest).toBeDefined();
    expect(ev.notes).toBeUndefined();
  });

  it("a chord selected both ways blanks, rather than thinning first", () => {
    const result = computeDeleteSelection(makeScore(), {
      kind: "multi",
      elementIds: [`${CHORD}/n1`, CHORD],
    } as never);
    expect(eventAt(resultScore(result), 0).rest).toBeDefined();
  });

  it("mixes a chord note with a whole event in one selection", () => {
    const result = computeDeleteSelection(makeScore(), {
      kind: "multi",
      elementIds: [`${CHORD}/n0`, "p0/m0/s0/e2"],
    } as never);
    const score = resultScore(result);
    expect(steps(score, 0)).toEqual(["E", "G"]);
    expect(eventAt(score, 1).rest).toBeDefined();
  });
});

/**
 * Percussion hits live in `kitNotes`, not `notes`. The engine numbers
 * noteheads across both (pitched first, then kit), so removal has to address
 * that combined sequence — reading only `notes` made Delete a silent no-op on
 * a drum staff.
 */
const KIT_CHORD = "p0/m0/s0/k1";

function makeKitScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Drum Kit",
        kit: {
          kick: { staffPosition: -4, sound: "kick-sound" },
          snare: { staffPosition: 0, sound: "snare-sound" },
        },
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "k1",
                    duration: { base: "quarter" },
                    kitNotes: [{ kitComponent: "kick" }, { kitComponent: "snare" }],
                  },
                  {
                    type: "event",
                    id: "k2",
                    duration: { base: "quarter" },
                    kitNotes: [{ kitComponent: "snare" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

function kitComponents(score: Score, index: number): string[] {
  return (eventAt(score, index).kitNotes ?? []).map((k) => k.kitComponent);
}

describe("removeChordNotes — percussion kit notes", () => {
  it("removes one drum and leaves the other sounding", () => {
    const score = makeKitScore();
    expect(removeChordNotes(score, KIT_CHORD, [0])).toBe("removed");
    expect(kitComponents(score, 0)).toEqual(["snare"]);
    expect(eventAt(score, 0).rest).toBeUndefined();
  });

  it("reports a full kit-chord selection instead of emptying the event", () => {
    const score = makeKitScore();
    expect(removeChordNotes(score, KIT_CHORD, [0, 1])).toBe("wholeEvent");
    expect(kitComponents(score, 0)).toEqual(["kick", "snare"]);
  });

  it("drops the kitNotes array once its last hit goes", () => {
    const score = makeKitScore();
    // A lone remaining hit removed one at a time, rather than as a full selection.
    expect(removeChordNotes(score, KIT_CHORD, [1])).toBe("removed");
    expect(removeChordNotes(score, KIT_CHORD, [0])).toBe("wholeEvent");
    expect(kitComponents(score, 0)).toEqual(["kick"]);
  });
});

describe("computeDeleteSelection — percussion kit notes", () => {
  it("deleting one drum notehead is no longer a silent no-op", () => {
    const result = computeDeleteSelection(makeKitScore(), {
      kind: "single",
      elementId: `${KIT_CHORD}/n0`,
    } as never);
    expect(result.kind).toBe("single");
    expect(kitComponents(resultScore(result), 0)).toEqual(["snare"]);
  });

  it("selecting the last remaining drum blanks the event to a rest", () => {
    const score = makeKitScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.kitNotes = [{ kitComponent: "snare" }];
    const result = computeDeleteSelection(score, { kind: "single", elementId: `${KIT_CHORD}/n0` } as never);
    const ev = eventAt(resultScore(result), 0);
    expect(ev.rest).toBeDefined();
    expect(ev.kitNotes).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import type { Score } from "../model/score";
import type { Part } from "../model/part";
import { applyPatchesToScore, patch, PatchTargetMissing } from "../patches";

function makeScore(): Score {
  const part: Part = {
    id: "p1",
    name: "Piano",
    measures: [
      {
        sequences: [
          {
            content: [
              {
                type: "event",
                id: "e1",
                duration: { base: "quarter" },
                notes: [
                  { id: "n1", pitch: { step: "C", octave: 4 } },
                  { id: "n2", pitch: { step: "E", octave: 4 } },
                ],
              },
              {
                type: "event",
                id: "e2",
                duration: { base: "quarter" },
                notes: [{ id: "n3", pitch: { step: "G", octave: 4 } }],
              },
              {
                type: "event",
                id: "e3",
                duration: { base: "half" },
                rest: {},
              },
            ],
          },
        ],
      },
    ],
  };
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, barline: { type: "regular" } }] },
    parts: [part],
  };
}

const locator = (eventId: string) => ({
  sequencePath: { partId: "p1", measureIndex: 0, voice: 0 },
  eventId,
});

describe("applyPatchesToScore", () => {
  it("returns the input unchanged when given no patches", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, []);
    expect(next).toBe(score);
  });

  it("does not mutate the input score (Immer immutability)", () => {
    const score = makeScore();
    const before = JSON.stringify(score);
    applyPatchesToScore(score, [patch.setNotePitch(locator("e1"), "n1", { step: "D", octave: 5 })]);
    expect(JSON.stringify(score)).toBe(before);
  });

  it("setNotePitch updates a single note's pitch by id", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [
      patch.setNotePitch(locator("e1"), "n2", { step: "F", octave: 4, alter: 1 }),
    ]);
    const updated = next.parts[0]!.measures[0]!.sequences[0]!.content[0];
    expect(updated?.type).toBe("event");
    expect((updated as { notes: { id?: string; pitch: unknown }[] }).notes[1]!.pitch).toEqual({
      step: "F",
      octave: 4,
      alter: 1,
    });
    // Sibling note untouched.
    expect((updated as { notes: { id?: string; pitch: unknown }[] }).notes[0]!.pitch).toEqual({
      step: "C",
      octave: 4,
    });
  });

  it("setNoteField updates accidentalDisplay and clears with undefined", () => {
    const score = makeScore();
    const withAccidental = applyPatchesToScore(score, [
      patch.setNoteField(locator("e1"), "n1", {
        field: "accidentalDisplay",
        value: { show: true, force: true },
      }),
    ]);
    const note = (
      withAccidental.parts[0]!.measures[0]!.sequences[0]!.content[0] as {
        notes: { accidentalDisplay?: unknown }[];
      }
    ).notes[0]!;
    expect(note.accidentalDisplay).toEqual({ show: true, force: true });

    const cleared = applyPatchesToScore(withAccidental, [
      patch.setNoteField(locator("e1"), "n1", { field: "accidentalDisplay", value: undefined }),
    ]);
    const clearedNote = (
      cleared.parts[0]!.measures[0]!.sequences[0]!.content[0] as {
        notes: { accidentalDisplay?: unknown }[];
      }
    ).notes[0]!;
    expect(clearedNote.accidentalDisplay).toBeUndefined();
  });

  it("addNoteToEvent appends a new note and clears any rest marker", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [
      patch.addNoteToEvent(locator("e3"), { id: "n4", pitch: { step: "A", octave: 4 } }),
    ]);
    const e3 = next.parts[0]!.measures[0]!.sequences[0]!.content[2] as {
      rest?: unknown;
      notes?: { id?: string }[];
    };
    expect(e3.rest).toBeUndefined();
    expect(e3.notes).toHaveLength(1);
    expect(e3.notes![0]!.id).toBe("n4");
  });

  it("removeNoteFromEvent strips a note by id", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [patch.removeNoteFromEvent(locator("e1"), "n1")]);
    const e1 = next.parts[0]!.measures[0]!.sequences[0]!.content[0] as {
      notes: { id?: string }[];
    };
    expect(e1.notes).toHaveLength(1);
    expect(e1.notes[0]!.id).toBe("n2");
  });

  it("setEventField updates duration", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [
      patch.setEventField(locator("e1"), { field: "duration", value: { base: "eighth" } }),
    ]);
    const e1 = next.parts[0]!.measures[0]!.sequences[0]!.content[0] as { duration: unknown };
    expect(e1.duration).toEqual({ base: "eighth" });
  });

  it("setEventField with undefined clears optional fields", () => {
    const withStem = applyPatchesToScore(makeScore(), [
      patch.setEventField(locator("e1"), { field: "stemDirection", value: "up" }),
    ]);
    const cleared = applyPatchesToScore(withStem, [
      patch.setEventField(locator("e1"), { field: "stemDirection", value: undefined }),
    ]);
    const e1 = cleared.parts[0]!.measures[0]!.sequences[0]!.content[0] as {
      stemDirection?: unknown;
    };
    expect(e1.stemDirection).toBeUndefined();
  });

  it("spliceSequenceContent replaces a single event by id", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [
      patch.spliceSequenceContent({
        sequencePath: { partId: "p1", measureIndex: 0, voice: 0 },
        removeFromEventId: "e2",
        removeToEventId: "e2",
        insert: [
          { type: "event", id: "e2a", duration: { base: "eighth" }, rest: {} },
          { type: "event", id: "e2b", duration: { base: "eighth" }, rest: {} },
        ],
      }),
    ]);
    const content = next.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content.map((c) => (c as { id?: string }).id)).toEqual(["e1", "e2a", "e2b", "e3"]);
  });

  it("spliceSequenceContent finds events nested inside a tuplet", () => {
    // Build a score with a tuplet containing two events.
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 }, barline: { type: "regular" } }] },
      parts: [
        {
          id: "p1",
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "tuplet",
                      inner: { duration: { base: "quarter" }, multiple: 3 },
                      outer: { duration: { base: "quarter" }, multiple: 2 },
                      content: [
                        {
                          type: "event",
                          id: "t1",
                          duration: { base: "quarter" },
                          notes: [{ id: "tn1", pitch: { step: "C", octave: 4 } }],
                        },
                        {
                          type: "event",
                          id: "t2",
                          duration: { base: "quarter" },
                          notes: [{ id: "tn2", pitch: { step: "D", octave: 4 } }],
                        },
                        {
                          type: "event",
                          id: "t3",
                          duration: { base: "quarter" },
                          notes: [{ id: "tn3", pitch: { step: "E", octave: 4 } }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const next = applyPatchesToScore(score, [
      patch.spliceSequenceContent({
        sequencePath: { partId: "p1", measureIndex: 0, voice: 0 },
        removeFromEventId: "t2",
        removeToEventId: "t2",
        insert: [{ type: "event", id: "tX", duration: { base: "quarter" }, rest: {} }],
      }),
    ]);
    const tuplet = next.parts[0]!.measures[0]!.sequences[0]!.content[0] as {
      content: { id?: string }[];
    };
    expect(tuplet.content.map((c) => c.id)).toEqual(["t1", "tX", "t3"]);
  });

  it("throws PatchTargetMissing for unknown event id", () => {
    const score = makeScore();
    expect(() =>
      applyPatchesToScore(score, [patch.setNotePitch(locator("nope"), "n1", { step: "D", octave: 4 })]),
    ).toThrow(PatchTargetMissing);
  });

  it("applies multiple patches in order", () => {
    const score = makeScore();
    const next = applyPatchesToScore(score, [
      patch.setNotePitch(locator("e1"), "n1", { step: "D", octave: 5 }),
      patch.setEventField(locator("e1"), { field: "duration", value: { base: "half" } }),
      patch.removeNoteFromEvent(locator("e1"), "n2"),
    ]);
    const e1 = next.parts[0]!.measures[0]!.sequences[0]!.content[0] as {
      duration: unknown;
      notes: { id?: string; pitch: unknown }[];
    };
    expect(e1.duration).toEqual({ base: "half" });
    expect(e1.notes).toHaveLength(1);
    expect(e1.notes[0]!.pitch).toEqual({ step: "D", octave: 5 });
  });
});

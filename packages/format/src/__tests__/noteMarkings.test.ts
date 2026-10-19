import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx";
import { serializeMnx } from "../mnx/serializer";

const scoreWithNoteMarkings = {
  mnx: { version: 1 },
  global: { measures: [{ id: "m0" }] },
  parts: [
    {
      id: "p0",
      name: "Trumpet",
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  id: "ev0",
                  duration: { base: "quarter" },
                  notes: [
                    { id: "n0", pitch: { step: "C", octave: 4 }, markings: { slideIn: { type: "scoop", id: "s0" } } },
                    {
                      id: "n1",
                      pitch: { step: "E", octave: 4 },
                      markings: {
                        slideIn: { type: "plop", _c: "upward approach" },
                        slideOut: { type: "falloff", _x: { custom: "retained" } },
                      },
                    },
                    { id: "n2", pitch: { step: "G", octave: 4 }, markings: { slideOut: { type: "doit" } } },
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

describe("MNX note markings", () => {
  it("promotes, serializes and reopens note-scoped markings without moving them to the chord", () => {
    const score = parseMnx(scoreWithNoteMarkings);
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(event.type).toBe("event");
    if (event.type !== "event") throw new Error("Expected event");

    expect(event.markings).toBeUndefined();
    expect(event.notes?.map((note) => note.markings)).toEqual([
      { slideIn: { type: "scoop", id: "s0" } },
      {
        slideIn: { type: "plop", _c: "upward approach" },
        slideOut: { type: "falloff", _x: { custom: "retained" } },
      },
      { slideOut: { type: "doit" } },
    ]);

    const serialized = serializeMnx(score);
    expect(serialized.parts[0]?.measures[0]?.sequences[0]?.content[0]).toMatchObject({
      notes: scoreWithNoteMarkings.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes,
    });
    expect(parseMnx(serialized)).toEqual(score);
  });

  it("rejects invalid slide types at the validated boundary", () => {
    const invalid = structuredClone(scoreWithNoteMarkings);
    invalid.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes[0]!.markings!.slideIn!.type = "glissando";
    expect(() => parseMnx(invalid)).toThrow(/type must be one of scoop, plop/);
  });
});

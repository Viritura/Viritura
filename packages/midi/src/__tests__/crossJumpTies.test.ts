import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRest, type NoteEvent, type Score } from "@viritura/core";
import { parseMnx } from "../../../format/src/index";
import { generateTimeline, generatePerformanceEvents } from "../index";

function fixture(): Score {
  return parseMnx(
    JSON.parse(readFileSync(new URL("../../../format/fixtures/mnx/cross-jump-ties.mnx", import.meta.url), "utf8")),
  );
}

function chord(score: Score, measure: number): NoteEvent {
  const event = score.parts[0]!.measures[measure]!.sequences[0]!.content[0]!;
  if (event.type !== "event" || isRest(event)) throw new Error("Expected fixture chord");
  return event;
}

function noteOns(score: Score) {
  const timeline = generateTimeline(score, { includeGlobalChords: false });
  const performance = generatePerformanceEvents(score, 0);
  return {
    timeline,
    midi: timeline.events.filter((event) => event.type === "noteOn"),
    native: performance.filter((event) => event.kind === "noteOn"),
  };
}

describe("explicit crossJump tie playback", () => {
  it("sustains a chord through a backward repeat and skipped first ending without reattacks or early releases", () => {
    const { timeline, midi, native } = noteOns(fixture());
    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0, 2, 3]);
    expect(midi).toHaveLength(3);
    expect(native).toHaveLength(3);
    expect(timeline.events.filter((event) => event.type === "noteOff")).toHaveLength(3);
    for (const event of timeline.events.filter((event) => event.type === "noteOff"))
      expect(event.time).toBeCloseTo(7.8);
    for (const event of native) expect(event.note.duration).toBeCloseTo(8);
  });

  it.each([undefined, "nextNote"] as const)(
    "does not carry a %s tie across an unrelated repeat entry",
    (targetType) => {
      const score = fixture();
      for (const note of chord(score, 1).notes) {
        for (const tie of note.ties ?? []) tie.targetType = targetType;
      }
      const { midi, native } = noteOns(score);
      expect(midi).toHaveLength(6);
      expect(native).toHaveLength(6);
    },
  );

  it("keeps voices independent when another hand attacks the same pitch at a repeat entry", () => {
    const score = fixture();
    const part = score.parts[0]!;
    part.staves = 2;
    for (const [index, measure] of part.measures.entries()) {
      measure.sequences.push({
        voice: "lower",
        staff: 2,
        content: [
          index === 3
            ? { type: "event", id: `lower${index}`, duration: { base: "whole" }, rest: {} }
            : {
                type: "event",
                id: `lower${index}`,
                duration: { base: "whole" },
                notes: [{ id: `lowerNote${index}`, pitch: { step: "C", octave: 4 } }],
              },
        ],
      });
    }
    const { midi, native } = noteOns(score);
    expect(midi).toHaveLength(7);
    expect(native).toHaveLength(7);
    expect(native.filter((event) => event.note.id.startsWith("lowerNote"))).toHaveLength(4);
    expect(native.find((event) => event.note.id === "n0C")!.note.duration).toBeCloseTo(8);
  });

  it("does not sustain into a later event merely because it has the target id and the same pitch", () => {
    const score = fixture();
    const first = chord(score, 0);
    first.duration = { base: "half" };
    for (const note of first.notes) delete note.ties;
    const later = structuredClone(first);
    later.id = "later";
    for (const note of later.notes) note.id = `later${note.pitch.step}`;
    score.parts[0]!.measures[0]!.sequences[0]!.content.push(later);
    for (const note of chord(score, 1).notes)
      note.ties = [{ target: `later${note.pitch.step}`, targetType: "crossJump" }];
    const { midi, native } = noteOns(score);
    expect(midi).toHaveLength(18);
    expect(native).toHaveLength(18);
  });

  it("retains crossJump sustains when D.C. forces navigation realization of the entire route", () => {
    const score = fixture();
    score.global.measures[0]!.fine = { location: { fraction: [1, 1] } };
    score.global.measures[3]!.jump = { type: "dcAlFine", location: { fraction: [1, 1] } };
    const { timeline, midi, native } = noteOns(score);
    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0, 2, 3, 0]);
    expect(midi).toHaveLength(6);
    expect(native).toHaveLength(6);
    for (const event of native.slice(0, 3)) expect(event.note.duration).toBeCloseTo(8);
    expect(timeline.events.filter((event) => event.type === "noteOff" && event.time < 9)).toHaveLength(3);
    for (const event of timeline.events.filter((event) => event.type === "noteOff" && event.time < 9))
      expect(event.time).toBeCloseTo(7.8);
  });

  it("joins notes across a mid-measure D.S. entry without holding through removed beats", () => {
    const score = parseMnx({
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
          { segno: { location: { fraction: [1, 4] } }, fine: { location: { fraction: [1, 2] } } },
          { jump: { type: "dsAlFine", location: { fraction: [3, 4] } } },
        ],
      },
      parts: [
        {
          id: "p",
          measures: [
            { sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }] },
            {
              sequences: [
                {
                  content: [
                    { duration: { base: "quarter" }, rest: {} },
                    {
                      id: "destination",
                      duration: { base: "quarter" },
                      notes: [{ id: "target", pitch: { step: "C", octave: 5 } }],
                    },
                    { duration: { base: "half" }, rest: {} },
                  ],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [
                    { duration: { base: "half" }, rest: {} },
                    {
                      id: "source",
                      duration: { base: "quarter" },
                      notes: [
                        {
                          id: "sourceNote",
                          pitch: { step: "C", octave: 5 },
                          ties: [{ target: "target", targetType: "crossJump" }],
                        },
                      ],
                    },
                    { duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const { timeline, midi, native } = noteOns(score);
    expect(timeline.totalBeats).toBe(12);
    expect(midi).toHaveLength(2);
    expect(native).toHaveLength(2);
    expect(native.find((event) => event.note.id === "sourceNote")!.note.duration).toBeCloseTo(1);
    expect(timeline.events.find((event) => event.type === "noteOff" && event.time > 5)!.time).toBeCloseTo(6, 1);
  });
});

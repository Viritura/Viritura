import { describe, expect, it } from "vitest";
import { textContentFromPlain, type Part, type Score } from "@viritura/core";
import { generateTimeline } from "../timeline";
import { playbackInstruments } from "./index";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: 3 }, () => ({
        time: { count: 4, unit: 4 },
        tempos: [{ bpm: 120, value: { base: "quarter" as const } }],
      })),
    },
    parts: [
      {
        id: "wind",
        name: "Flute",
        _x: {
          viritura: {
            instruments: {
              flute: { instrumentId: "wind.flutes.flute", midiProgram: 73 },
              piccolo: {
                instrumentId: "wind.flutes.flute.piccolo",
                midiProgram: 72,
                transposition: { chromatic: -12, diatonic: -7 },
              },
            },
            initialInstrument: "flute",
          },
        },
        measures: Array.from({ length: 3 }, (_, index) => ({
          instrumentChanges: index === 1 ? [{ instrument: "piccolo" }] : undefined,
          sequences: [
            {
              content: Array.from({ length: 4 }, (_, noteIndex) => ({
                type: "event" as const,
                id: `m${index}n${noteIndex}`,
                duration: { base: "quarter" as const },
                notes: [{ pitch: { step: "C" as const, octave: 5 } }],
              })),
            },
          ],
        })),
      },
    ],
  };
}

describe("instrument playback timeline", () => {
  it("preserves short-note release duration when an early attack is clamped to a change", () => {
    const input = score();
    input.global.measures.forEach((measure) => {
      measure.tempos = [{ bpm: 200, value: { base: "quarter" } }];
    });
    const part = input.parts[0]!;
    part.measures[1]!.sequences = [
      {
        content: [
          {
            type: "event",
            id: "short",
            duration: { base: "64th" },
            markings: { staccato: {} },
            notes: [{ pitch: { step: "C", octave: 5 } }],
          },
        ],
      },
    ];
    input.parts = [{ name: "Empty 1", measures: [] }, { name: "Empty 2", measures: [] }, part];
    const events = generateTimeline(input).events;
    const attack = events.find((event) => event.type === "noteOn" && event.scoreEventId === "short")!;
    const release = events.find((event) => event.type === "noteOff" && event.scoreEventId === "short")!;
    expect(attack.time).toBeCloseTo(1.2);
    expect(release.time - attack.time).toBeCloseTo(0.009375);
    expect(release.playbackInstrumentKey).toBe(attack.playbackInstrumentKey);
  });

  it("switches at the exact boundary, persists, and keeps sounding pitches", () => {
    const input = score();
    const before = structuredClone(input);
    const timeline = generateTimeline(input);
    const changes = timeline.events.filter((event) => event.instrumentChange);
    expect(changes.map((event) => [event.time, event.program, event.playbackInstrumentKey])).toEqual([
      [0, 73, "initial"],
      [2, 72, "instrument:piccolo"],
    ]);
    const notes = timeline.events.filter((event) => event.type === "noteOn");
    expect(notes.every((note) => note.midiNote === 72)).toBe(true);
    expect(notes.slice(0, 4).every((note) => note.playbackInstrumentKey === "initial")).toBe(true);
    expect(notes.slice(4).every((note) => note.playbackInstrumentKey === "instrument:piccolo")).toBe(true);
    expect(notes[4]!.time).toBeGreaterThanOrEqual(2);
    expect(input).toEqual(before);
  });

  it("handles fractional changes with releases routed to their attack's timbre", () => {
    const input = score();
    input.parts[0]!.measures[0]!.instrumentChanges = [{ instrument: "piccolo", position: { fraction: [1, 2] } }];
    const timeline = generateTimeline(input);
    const notes = timeline.events.filter((event) => event.type === "noteOn" && event.scoreBeat! < 4);
    expect(notes.map((note) => note.playbackInstrumentKey)).toEqual([
      "initial",
      "initial",
      "instrument:piccolo",
      "instrument:piccolo",
    ]);
    const off = timeline.events.find((event) => event.type === "noteOff" && event.scoreBeat === 1)!;
    expect(off.playbackInstrumentKey).toBe("initial");
    expect(timeline.events.find((event) => event.instrumentChange && event.time === 1)?.program).toBe(72);
  });

  it("does not change timbre or sounding pitch for transposition-only changes", () => {
    const input = score();
    input.parts[0]!.measures[1]!.instrumentChanges = [{ transposition: { chromatic: 2, diatonic: 1 } }];
    const timeline = generateTimeline(input);
    expect(timeline.events.some((event) => event.instrumentChange)).toBe(false);
    expect(timeline.events.filter((event) => event.type === "noteOn").every((note) => note.midiNote === 72)).toBe(true);
  });

  it("restores written instrument state at repeat destinations", () => {
    const input = score();
    input.global.measures[0]!.repeatStart = {};
    input.global.measures[1]!.repeatEnd = {};
    const timeline = generateTimeline(input);
    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0, 1, 2]);
    expect(
      timeline.events
        .filter((event) => event.instrumentChange)
        .map((event) => [event.time, event.playbackInstrumentKey]),
    ).toEqual([
      [0, "initial"],
      [2, "instrument:piccolo"],
      [4, "initial"],
      [6, "instrument:piccolo"],
    ]);
  });

  it("uses resolved programs instead of notation fallbacks", () => {
    const timeline = generateTimeline(score(), {
      instrumentPrograms: new Map([
        [
          0,
          new Map([
            ["initial", 58],
            ["instrument:piccolo", 72],
          ]),
        ],
      ]),
    });
    expect(timeline.events.filter((event) => event.instrumentChange).map((event) => event.program)).toEqual([58, 72]);
  });

  it("rejects broken references rather than silently playing the original sound", () => {
    const input = score();
    input.parts[0]!.measures[1]!.instrumentChanges = [{ instrument: "missing" }];
    expect(() => generateTimeline(input)).toThrow('Unknown instrument "missing"');
    const part: Part = { name: "Bad", measures: [], _x: { viritura: { initialInstrument: "missing" } } };
    expect(() => playbackInstruments(part)).toThrow("Unknown initial instrument");
  });

  it("keeps long overlapping note releases with the original timbre", () => {
    const input = score();
    const measure = input.parts[0]!.measures[0]!;
    measure.instrumentChanges = [{ instrument: "piccolo", position: { fraction: [1, 4] } }];
    measure.sequences.push({
      voice: "long",
      content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }],
    });
    const timeline = generateTimeline(input);
    const longOff = timeline.events.find(
      (event) => event.type === "noteOff" && event.scoreBeat === 0 && event.time > 1,
    )!;
    expect(longOff.playbackInstrumentKey).toBe("initial");
    expect(
      timeline.events
        .filter((event) => event.type === "noteOff" && event.scoreBeat === 1)
        .every((event) => event.playbackInstrumentKey === "instrument:piccolo"),
    ).toBe(true);
  });

  it("keeps a tied release on the attack instrument across a change", () => {
    const input = score();
    input.parts[0]!.measures[0]!.sequences = [
      {
        content: [
          {
            type: "event",
            duration: { base: "whole" },
            notes: [{ id: "a", pitch: { step: "C", octave: 5 }, ties: [{ target: "b" }] }],
          },
        ],
      },
    ];
    input.parts[0]!.measures[1]!.sequences = [
      {
        content: [
          {
            type: "event",
            duration: { base: "whole" },
            notes: [{ id: "b", pitch: { step: "C", octave: 5 } }],
          },
        ],
      },
    ];
    const events = generateTimeline(input).events;
    expect(events.filter((event) => event.type === "noteOn" && event.scoreBeat! < 8)).toHaveLength(1);
    const release = events.find((event) => event.type === "noteOff" && event.scoreBeat === 0)!;
    expect(release.time).toBeGreaterThan(2);
    expect(release.playbackInstrumentKey).toBe("initial");
  });

  it("scopes part-wide techniques to the note lanes and initial timbre", () => {
    const input = score();
    input.parts[0]!.measures[0]!.expressions = [
      {
        text: textContentFromPlain("pizz."),
        position: { fraction: [0, 1] },
      },
    ];
    const events = generateTimeline(input, { partPrograms: [40] }).events;
    const lanes = new Set(events.filter((event) => event.type === "noteOn").map((event) => event.playbackLaneId));
    const pizz = events.filter((event) => event.type === "programChange" && !event.instrumentChange);
    expect(pizz).toHaveLength(1);
    expect(pizz[0]!.playbackInstrumentKey).toBe("initial");
    expect(lanes.has(pizz[0]!.playbackLaneId)).toBe(true);
    const atStart = events.filter((event) => event.type === "programChange" && event.time === 0);
    expect(atStart[0]!.instrumentChange).toBe(true);
    expect(atStart[1]!.program).toBe(45);
  });

  it("reports unavailable physical MIDI program selection without changing browser routing", () => {
    const input = score();
    input.parts[0]!._x!.viritura!.instruments!.piccolo!.midiProgram = undefined;
    const timeline = generateTimeline(input);
    expect(timeline.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "instrument-program-unavailable",
      }),
    );
    expect(timeline.events.some((event) => event.playbackInstrumentKey === "instrument:piccolo")).toBe(true);
  });
});

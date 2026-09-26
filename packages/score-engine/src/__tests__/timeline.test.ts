/**
 * Timeline + beat-mapping smoke tests.
 *
 * Uses a hand-built minimal MNX document and asserts the public Timeline
 * shape. We don't depend on @viritura/format internals here — we feed raw
 * MNX through the Engine like an external consumer would.
 */

import { describe, it, expect } from "vitest";
import { createEngine } from "../engine";

const MINIMAL_MNX = {
  mnx: { version: 1 },
  global: {
    measures: [{ time: { count: 4, unit: 4 }, tempos: [{ value: { base: "quarter" }, bpm: 120 }] }, {}],
  },
  parts: [
    {
      id: "p1",
      name: "Piano",
      measures: [
        {
          sequences: [
            {
              content: [
                { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
                { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
                { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 4 } }] },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }],
            },
          ],
        },
      ],
    },
  ],
  scores: [{ name: "Score", layout: "default" }],
  layouts: [{ id: "default", content: [{ type: "staff", sources: [{ part: "p1" }] }] }],
};

describe("Engine.timeline", () => {
  const engine = createEngine();

  it("produces a timeline with the public Timeline shape", () => {
    const tl = engine.timeline(MINIMAL_MNX);
    expect(tl.totalSeconds).toBeGreaterThan(0);
    expect(tl.totalBeats).toBeGreaterThan(0);
    expect(tl.partIds).toEqual(["p1"]);
    expect(tl.tempoMap.length).toBeGreaterThan(0);
    expect(tl.tempoMap[0]?.bpm).toBe(120);
  });

  it("emits one TimedEvent per pitched note (5 notes total)", () => {
    const tl = engine.timeline(MINIMAL_MNX);
    const noteEvents = tl.events.filter((e) => !e.isRest);
    expect(noteEvents.length).toBe(5);
    expect(noteEvents.every((e) => typeof e.midiPitch === "number")).toBe(true);
    expect(noteEvents.every((e) => e.partId === "p1")).toBe(true);
    expect(noteEvents.every((e) => e.durationBeats > 0)).toBe(true);
  });

  it("events are sorted by beat", () => {
    const tl = engine.timeline(MINIMAL_MNX);
    for (let i = 1; i < tl.events.length; i++) {
      expect(tl.events[i]!.beat).toBeGreaterThanOrEqual(tl.events[i - 1]!.beat);
    }
  });

  it("accepts both string and object MNX input", () => {
    const fromString = engine.timeline(JSON.stringify(MINIMAL_MNX));
    const fromObject = engine.timeline(MINIMAL_MNX);
    expect(fromString.events.length).toBe(fromObject.events.length);
    expect(fromString.totalSeconds).toBe(fromObject.totalSeconds);
  });

  it("is deterministic — same input → same output", () => {
    const a = engine.timeline(MINIMAL_MNX);
    const b = engine.timeline(MINIMAL_MNX);
    expect(a).toEqual(b);
  });

  it("uses the actual 6/8 and 3/4 meter lengths for beats and tempo changes", () => {
    const score = structuredClone(MINIMAL_MNX) as Record<string, unknown>;
    const global = score["global"] as { measures: Record<string, unknown>[] };
    global.measures = [
      { time: { count: 6, unit: 8 }, tempos: [{ value: { base: "quarter" }, bpm: 120 }] },
      { time: { count: 3, unit: 4 }, tempos: [{ value: { base: "quarter" }, bpm: 90 }] },
    ];
    const parts = score["parts"] as { measures: { sequences: { content: unknown[] }[] }[] }[];
    parts[0]!.measures = [
      {
        sequences: [
          {
            content: [
              { type: "event", duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
              { type: "event", duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
            ],
          },
        ],
      },
      {
        sequences: [
          { content: [{ type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 4 } }] }] },
        ],
      },
    ];
    const timeline = engine.timeline(score);
    expect(timeline.tempoMap.map((segment) => segment.beat)).toEqual([0, 3]);
    expect(timeline.totalBeats).toBe(6);
    expect(timeline.events.map((event) => event.beat)).toEqual([0, 0.5, 3]);
    expect(timeline.events[1]?.durationBeats).toBe(0.5);
  });

  it("uses one visual pass when ignoring repeats, and expanded order by default", () => {
    const score = structuredClone(MINIMAL_MNX) as Record<string, unknown>;
    const global = score["global"] as { measures: Record<string, unknown>[] };
    global.measures[0]!["repeatStart"] = {};
    global.measures[1]!["repeatEnd"] = { times: 2 };
    const expanded = engine.timeline(score);
    const ignored = engine.timeline(score, { repeatExpansion: "ignore" });
    expect(ignored.totalBeats).toBe(8);
    expect(expanded.totalBeats).toBe(16);
    expect(ignored.events).toHaveLength(5);
    expect(expanded.events).toHaveLength(10);
    expect(engine.timeline(score, { repeatExpansion: "expand" })).toEqual(expanded);
  });

  it("preserves authored IDs and substitutes #0 for an absent part ID", () => {
    const score = structuredClone(MINIMAL_MNX) as Record<string, unknown>;
    const parts = score["parts"] as {
      id?: string;
      measures: { sequences: { content: Record<string, unknown>[] }[] }[];
    }[];
    delete parts[0]!.id;
    parts[0]!.measures[0]!.sequences[0]!.content[0]!["id"] = "authored-event";
    const a = engine.timeline(score);
    expect(a.partIds).toEqual(["#0"]);
    expect(a.events.every((event) => event.partId === "#0")).toBe(true);
    expect(a.events[0]?.eventId).toBe("authored-event");
    expect(a.events[1]?.eventId).toBeUndefined();
    expect(engine.timeline(score)).toEqual(a);
  });
});

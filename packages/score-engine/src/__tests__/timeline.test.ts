/**
 * Timeline + beat-mapping smoke tests.
 *
 * Uses a hand-built minimal MNX document and asserts the public Timeline
 * shape. We don't depend on @viritura/format internals here — we feed raw
 * MNX through the Engine like an external consumer would.
 */

import { describe, it, expect } from "vitest";
import { Engine } from "../engine";

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
  const engine = new Engine();

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
    expect(a.events).toEqual(b.events);
    expect(a.tempoMap).toEqual(b.tempoMap);
  });
});

describe("Engine.beatToCanvas / canvasToBeat", () => {
  const engine = new Engine();

  it("returns null for an unknown partId", () => {
    const fakeDl = {
      width: 800,
      height: 600,
      commands: [],
      measureBounds: [],
    } as unknown as Parameters<typeof engine.beatToCanvas>[0];
    expect(engine.beatToCanvas(fakeDl, 0, "p99")).toBeNull();
  });

  it("returns null for malformed partId", () => {
    const fakeDl = {
      width: 800,
      height: 600,
      commands: [],
      measureBounds: [],
    } as unknown as Parameters<typeof engine.beatToCanvas>[0];
    expect(engine.beatToCanvas(fakeDl, 0, "not-a-part")).toBeNull();
  });

  it("returns null when canvas hit lands outside any measure", () => {
    const fakeDl = {
      width: 800,
      height: 600,
      commands: [],
      measureBounds: [],
    } as unknown as Parameters<typeof engine.canvasToBeat>[0];
    expect(engine.canvasToBeat(fakeDl, 0, 5000, 5000)).toBeNull();
  });
});

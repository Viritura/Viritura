import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { cc11Events, type DynamicsEnvelope } from "../dynamicsEnvelope";
import { playbackLaneId, selectDynamicResponseProfile } from "../dynamicPlayback";
import { generateTimeline } from "../timeline";

function scopedScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
        },
      ],
    },
    parts: [
      {
        id: "part-1",
        name: "Violin",
        staves: 2,
        measures: [
          {
            dynamics: [
              {
                id: "upper-p",
                type: "immediate",
                value: "p",
                voice: "up",
                position: { fraction: [0, 1] },
              },
              {
                id: "lower-f",
                type: "immediate",
                value: "f",
                staff: 2,
                voice: "down",
                position: { fraction: [0, 1] },
              },
            ],
            sequences: [
              {
                staff: 1,
                voice: "up",
                content: [
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 5 } }],
                  },
                ],
              },
              {
                staff: 2,
                voice: "down",
                content: [
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 3 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("dynamic playback lanes", () => {
  it("keeps simultaneous scoped voices on distinct lanes and levels", () => {
    const timeline = generateTimeline(scopedScore());
    const notes = timeline.events.filter((event) => event.type === "noteOn");
    expect(notes).toHaveLength(2);
    const byLane = new Map(notes.map((event) => [event.playbackLaneId, event]));
    const upperLane = playbackLaneId(0, 1, "up");
    const lowerLane = playbackLaneId(0, 2, "down");
    expect(new Set(byLane.keys())).toEqual(new Set([upperLane, lowerLane]));
    expect(byLane.get(lowerLane)!.velocity).toBeGreaterThan(byLane.get(upperLane)!.velocity);
    expect(byLane.get(lowerLane)!.channel).not.toBe(byLane.get(upperLane)!.channel);
    const ccLanes = new Set(
      timeline.events
        .filter((event) => event.type === "controlChange" && event.cc === 11)
        .map((event) => event.playbackLaneId),
    );
    expect(ccLanes).toEqual(new Set([playbackLaneId(0, 1, "up"), playbackLaneId(0, 2, "down")]));
  });

  it("routes a cross-staff event through its effective staff lane", () => {
    const score = scopedScore();
    const part = score.parts[0]!;
    const measure = part.measures[0]!;
    measure.dynamics = [
      {
        id: "upper-p",
        type: "immediate",
        value: "p",
        staff: 1,
        voice: "up",
        position: { fraction: [0, 1] },
      },
      {
        id: "lower-f",
        type: "immediate",
        value: "f",
        staff: 2,
        voice: "up",
        position: { fraction: [0, 1] },
      },
    ];
    measure.sequences = [
      {
        staff: 1,
        voice: "up",
        content: [
          {
            type: "event",
            staff: 2,
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "C", octave: 4 } }],
          },
        ],
      },
    ];

    const timeline = generateTimeline(score);
    const note = timeline.events.find((event) => event.type === "noteOn")!;
    expect(note.playbackLaneId).toBe(playbackLaneId(0, 2, "up"));
    expect(note.velocity).toBeGreaterThan(80);
  });
});

describe("instrument response profiles", () => {
  it("classifies struck, organ, sustained, and fallback programs", () => {
    expect(selectDynamicResponseProfile(0)).toBe("struck-plucked");
    expect(selectDynamicResponseProfile(19)).toBe("organ-fixed-attack");
    expect(selectDynamicResponseProfile(40)).toBe("sustained-expressive");
    expect(selectDynamicResponseProfile(80)).toBe("fallback");
  });
});

describe("quantization-crossing CC11", () => {
  it("emits each rounded value once and never exceeds the 7-bit domain", () => {
    const envelope: DynamicsEnvelope = {
      anchors: [],
      attacks: [],
      ramps: [
        {
          groupId: "ramp-1",
          startTime: 0,
          endTime: 9,
          start: { velocity: 1, cc11: 0 },
          end: { velocity: 122, cc11: 127 },
        },
      ],
    };
    const events = cc11Events(envelope);
    expect(events).toHaveLength(128);
    expect(events[0]).toEqual({ time: 0, value: 0 });
    expect(events.at(-1)!.value).toBe(127);
    expect(new Set(events.map((event) => event.value)).size).toBe(events.length);
  });
});

import { describe, expect, it } from "vitest";
import { createDynamicGroup, type DynamicGroup, type Score } from "@viritura/core";
import {
  buildDynamicsEnvelope,
  cc11Events,
  DYNAMIC_AXES,
  noteVelocityAt,
  playbackVelocityAt,
  sampleDynamics,
} from "../dynamicsEnvelope";
import { realizeDynamicsEnvelope, type DynamicResponseProfile } from "../dynamicPlayback";
import { generateTimeline } from "../timeline";

function dynamic(value: string, beat: number, playbackVelocity?: number): DynamicGroup {
  return {
    ...createDynamicGroup(value, { fraction: [beat, 4] }, `${value}-${beat}`),
    ...(playbackVelocity === undefined ? {} : { playbackVelocity }),
  };
}

function gradual(
  startBeat: number,
  endBeat: number,
  playbackVelocity?: number,
  wedgeType: "increasing" | "decreasing" = "increasing",
): DynamicGroup {
  return {
    id: `gradual-${startBeat}`,
    type: "gradual",
    position: { fraction: [startBeat, 4] },
    end: { measure: "m1", position: { fraction: [endBeat, 4] } },
    wedgeType,
    ...(playbackVelocity === undefined ? {} : { playbackVelocity }),
  };
}

function envelope(groups: DynamicGroup[]) {
  const score: Score = {
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
        name: "Part",
        measures: [
          {
            dynamics: groups,
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
              },
            ],
          },
        ],
      },
    ],
  };
  const timeline = generateTimeline(score);
  return buildDynamicsEnvelope(score.parts[0]!, [0], timeline.measureStartBeats, timeline.model, score.global.measures);
}

const profiles: DynamicResponseProfile[] = ["fallback", "sustained-expressive", "struck-plucked", "organ-fixed-attack"];

describe("independent dynamic attack calibration", () => {
  it.each([1, 96, 127])("keeps mf semantic axes unchanged at attack velocity %i", (velocity) => {
    const env = envelope([dynamic("mf", 1, velocity), dynamic("f", 3)]);
    expect(playbackVelocityAt(env, 0)).toBeUndefined();
    expect(noteVelocityAt(env, 0)).toBe(84);
    for (const time of [0.5, 0.75, 1, 1.49]) {
      expect(sampleDynamics(env, time)).toEqual(DYNAMIC_AXES.mf);
      expect(playbackVelocityAt(env, time)).toBe(velocity);
      expect(noteVelocityAt(env, time)).toBe(velocity);
    }
    expect(playbackVelocityAt(env, 1.5)).toBeUndefined();
    expect(noteVelocityAt(env, 1.5)).toBe(98);
    expect(cc11Events(env)).toEqual(cc11Events(envelope([dynamic("mf", 1), dynamic("f", 3)])));
  });

  it.each(profiles)("bypasses %s attack projection but leaves its expression untouched", (profile) => {
    const semantic = envelope([dynamic("mf", 0), dynamic("fp", 1), gradual(2, 4)]);
    const calibrated = envelope([dynamic("mf", 0, 96), dynamic("fp", 1, 1), gradual(2, 4, 127)]);
    const env = realizeDynamicsEnvelope(calibrated, profile);
    const normal = realizeDynamicsEnvelope(semantic, profile);
    expect(noteVelocityAt(env, 0)).toBe(96);
    expect(noteVelocityAt(env, 0.5)).toBe(1);
    expect(noteVelocityAt(env, 1)).toBe(127);
    expect(playbackVelocityAt(env, 0.75)).toBeUndefined();
    for (const time of [0, 0.5, 0.75, 1, 1.5, 2, 3]) {
      expect(sampleDynamics(env, time)).toEqual(sampleDynamics(normal, time));
    }
    expect(cc11Events(env)).toEqual(cc11Events(normal));
  });

  it("steps relative and open gradual levels from mf, not its extreme attack calibration", () => {
    const env = envelope([
      dynamic("mf", 0, 1),
      gradual(0, 2),
      { id: "relative", type: "relative", relativeValue: "louder", position: { fraction: [3, 4] } },
    ]);
    expect(sampleDynamics(env, 1)).toEqual(DYNAMIC_AXES.f);
    expect(sampleDynamics(env, 1.5)).toEqual(DYNAMIC_AXES.f);
    expect(noteVelocityAt(env, 0)).toBe(1);
    expect(noteVelocityAt(env, 0.5)).toBe(50);
    expect(noteVelocityAt(env, 1)).toBe(98);
    expect(playbackVelocityAt(env, 1.5)).toBeUndefined();
  });

  it("interpolates into an explicit endpoint without changing the standing start", () => {
    const env = envelope([dynamic("p", 0), gradual(0, 2), dynamic("f", 2, 96)]);
    expect(noteVelocityAt(env, 0)).toBe(64);
    expect(noteVelocityAt(env, 0.5)).toBe(80);
    expect(noteVelocityAt(env, 1)).toBe(96);
    expect(sampleDynamics(env, 1)).toEqual(DYNAMIC_AXES.f);
  });

  it.each(profiles)("uses the browser's %s mapping for uncalibrated endpoints", (profile) => {
    const times = [0, 0.25, 0.5, 0.75, 1];
    const fixed = profile === "organ-fixed-attack";
    const outgoing = realizeDynamicsEnvelope(
      envelope([dynamic("mf", 0, 100), gradual(0, 2), dynamic("f", 2)]),
      profile,
    );
    expect(times.map((time) => noteVelocityAt(outgoing, time))).toEqual(
      fixed ? [100, 96, 92, 88, 84] : [100, 100, 99, 99, 98],
    );
    const incoming = realizeDynamicsEnvelope(
      envelope([dynamic("mf", 0), gradual(0, 2), dynamic("f", 2, 100)]),
      profile,
    );
    expect(times.map((time) => noteVelocityAt(incoming, time))).toEqual([84, 88, 92, 96, 100]);
    const explicit = realizeDynamicsEnvelope(
      envelope([dynamic("mf", 0, 20), gradual(0, 2), dynamic("f", 2, 100)]),
      profile,
    );
    expect(times.map((time) => noteVelocityAt(explicit, time))).toEqual([20, 40, 60, 80, 100]);
  });

  it("restores normal mapping at a non-overridden endpoint, not one note afterward", () => {
    const env = envelope([dynamic("mf", 0, 96), gradual(0, 2, 1), dynamic("f", 2)]);
    expect(playbackVelocityAt(env, 0.5)).toBe(50);
    expect(playbackVelocityAt(env, 1)).toBeUndefined();
    expect(playbackVelocityAt(env, 1.5)).toBeUndefined();
    expect(noteVelocityAt(env, 1)).toBe(98);
  });

  it("interrupts attack calibration at an interior non-overridden dynamic", () => {
    const calibrated = envelope([dynamic("p", 0, 20), gradual(0, 4), dynamic("mf", 1), dynamic("f", 4)]);
    const normal = envelope([dynamic("p", 0), gradual(0, 4), dynamic("mf", 1), dynamic("f", 4)]);
    expect(playbackVelocityAt(calibrated, 0.25)).toBe(30);
    for (const time of [0.5, 0.75, 1, 1.5, 2]) {
      expect(playbackVelocityAt(calibrated, time)).toBeUndefined();
      expect(noteVelocityAt(calibrated, time)).toBe(noteVelocityAt(normal, time));
    }
  });

  it("uses a new gradual override at a chained seam rather than the previous endpoint", () => {
    const env = envelope([dynamic("mf", 0), gradual(0, 2, 20), gradual(2, 4, 96, "decreasing")]);
    expect(noteVelocityAt(env, 0)).toBe(20);
    expect(noteVelocityAt(env, 0.5)).toBe(59);
    expect(noteVelocityAt(env, 1)).toBe(96);
    expect(noteVelocityAt(env, 1.5)).toBe(90);
    expect(noteVelocityAt(env, 2)).toBe(84);
    expect(playbackVelocityAt(env, 2.1)).toBeUndefined();
    expect(sampleDynamics(env, 1)).toEqual(DYNAMIC_AXES.f);
  });

  it("keeps the newest overlapping ramp's calibration throughout its span", () => {
    const env = envelope([gradual(0, 4), gradual(1, 3, 20)]);
    expect(playbackVelocityAt(env, 0.25)).toBeUndefined();
    expect(playbackVelocityAt(env, 0.5)).toBe(20);
    expect(playbackVelocityAt(env, 1)).toBe(59);
    expect(playbackVelocityAt(env, 1.5)).toBe(98);
    expect(playbackVelocityAt(env, 1.75)).toBeUndefined();
  });

  it("inherits the last coincident persistent calibration, including a relative reset", () => {
    const relative: DynamicGroup = {
      id: "relative",
      type: "relative",
      relativeValue: "louder",
      position: { fraction: [0, 1] },
    };
    const env = envelope([dynamic("mf", 0, 96), relative, gradual(0, 2)]);
    expect(playbackVelocityAt(env, 0)).toBeUndefined();
    expect(playbackVelocityAt(env, 0.5)).toBeUndefined();
    const overridden = envelope([dynamic("mf", 0, 96), { ...relative, playbackVelocity: 1 }, gradual(0, 2)]);
    expect(playbackVelocityAt(overridden, 0)).toBe(1);
    expect(playbackVelocityAt(overridden, 0.5)).toBe(50);
  });

  it("limits a gradual-only calibration to its span", () => {
    const env = envelope([gradual(1, 3, 96)]);
    expect(playbackVelocityAt(env, 0)).toBeUndefined();
    expect(noteVelocityAt(env, 0.5)).toBe(96);
    expect(noteVelocityAt(env, 1)).toBe(97);
    expect(noteVelocityAt(env, 1.5)).toBe(98);
    expect(playbackVelocityAt(env, 1.6)).toBeUndefined();
    expect(noteVelocityAt(env, 1.6)).toBe(84);
  });

  it("lets a semantic accent supersede a standing override only at its onset", () => {
    const env = envelope([dynamic("mf", 0, 1), dynamic("sfz", 1)]);
    expect(playbackVelocityAt(env, 0.5)).toBeUndefined();
    expect(noteVelocityAt(env, 0.5)).toBe(envelope([dynamic("sfz", 1)]).attacks[0]!.attackVelocity);
    expect(playbackVelocityAt(env, 0.75)).toBe(1);
  });

  it("retains niente expression even with a nonzero explicit trigger velocity", () => {
    for (const profile of profiles) {
      const env = realizeDynamicsEnvelope(envelope([dynamic("n", 0, 96)]), profile);
      expect(noteVelocityAt(env, 0)).toBe(96);
      expect(sampleDynamics(env, 0)).toEqual(DYNAMIC_AXES.n);
      expect(cc11Events(env)).toEqual([{ time: 0, value: 0 }]);
    }
  });

  it.each([0, -1, 128, 1.5, NaN, Infinity, -Infinity])("ignores invalid override %s on all group types", (value) => {
    const groups: DynamicGroup[] = [
      dynamic("mf", 0, value),
      {
        id: "relative",
        type: "relative",
        relativeValue: "louder",
        position: { fraction: [1, 4] },
        playbackVelocity: value,
      },
      dynamic("fp", 2, value),
      gradual(3, 4, value),
    ];
    const normal = groups.map((group) => {
      const copy = { ...group };
      delete copy.playbackVelocity;
      return copy;
    });
    expect(envelope(groups)).toStrictEqual(envelope(normal));
  });

  it("does not add attack metadata to ordinary envelope levels", () => {
    const env = envelope([dynamic("p", 0), gradual(0, 2), dynamic("f", 2)]);
    expect(env.anchors).toEqual([
      { time: 0, ...DYNAMIC_AXES.p },
      { time: 1, ...DYNAMIC_AXES.f },
    ]);
    expect(env.ramps[0]).toEqual({
      groupId: "gradual-0",
      startTime: 0,
      endTime: 1,
      start: DYNAMIC_AXES.p,
      end: DYNAMIC_AXES.f,
    });
    for (const time of [0, 0.5, 1, 1.5]) expect(playbackVelocityAt(env, time)).toBeUndefined();
  });
});

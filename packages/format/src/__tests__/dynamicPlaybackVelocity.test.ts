import { describe, expect, it } from "vitest";
import type { DynamicGroup, Score } from "@viritura/core";
import {
  DeltaSerializer,
  parseMnx,
  RawScoreValidationFailure,
  serializeDynamicGroup,
  serializeMnx,
  validateRawScore,
} from "../mnx";

const groupKinds: DynamicGroup[] = [
  { id: "immediate", type: "immediate", position: { fraction: [0, 1] }, value: "mf" },
  { id: "relative", type: "relative", position: { fraction: [0, 1] }, relativeValue: "louder" },
  { id: "accent", type: "accent", position: { fraction: [0, 1] }, value: "f", residualValue: "p" },
  {
    id: "gradual",
    type: "gradual",
    position: { fraction: [0, 1] },
    end: { measure: "m1", position: { fraction: [1, 1] } },
    wedgeType: "increasing",
  },
];

function nativeScore(group: DynamicGroup): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "part",
        name: "Piano",
        measures: [
          {
            dynamics: [group],
            sequences: [
              {
                content: [
                  {
                    id: "event",
                    type: "event",
                    duration: { base: "whole" },
                    notes: [{ id: "note", pitch: { step: "C", octave: 4 } }],
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

function rawScore(group: Record<string, unknown>) {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [
      {
        measures: [
          {
            dynamics: [group],
            sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
          },
        ],
      },
    ],
  };
}

describe("dynamic-group playback velocity persistence", () => {
  describe.each(groupKinds)("$type groups", (group) => {
    it.each([1, 96, 127])("round-trips explicit MIDI attack %i through the vendor extension", (playbackVelocity) => {
      const authored = { ...group, playbackVelocity };
      const wire = serializeDynamicGroup(authored);
      expect(wire).toEqual({ ...group, _x: { viritura: { playbackVelocity } } });
      expect(wire).not.toHaveProperty("playbackVelocity");

      const serialized = serializeMnx(nativeScore(authored));
      expect(validateRawScore(serialized).ok).toBe(true);
      const reloaded = parseMnx(JSON.parse(JSON.stringify(serialized)));
      expect(reloaded.parts[0]!.measures[0]!.dynamics).toEqual([authored]);
      expect(serializeMnx(reloaded)).toEqual(serialized);
    });

    it("does not synthesize metadata when the override is absent", () => {
      expect(serializeDynamicGroup(group)).toEqual(group);
      const reloaded = parseMnx(serializeMnx(nativeScore(group)));
      expect(reloaded.parts[0]!.measures[0]!.dynamics?.[0]).not.toHaveProperty("playbackVelocity");
    });
  });

  it("preserves mf and 96 independently alongside engraving placement", () => {
    const group: DynamicGroup = {
      ...groupKinds[0]!,
      playbackVelocity: 96,
      manualOffset: [1.5, -0.5],
      avoidCollisions: false,
    };
    const wire = serializeDynamicGroup(group);
    expect(wire).toMatchObject({
      type: "immediate",
      value: "mf",
      _x: { viritura: { playbackVelocity: 96, manualOffset: [1.5, -0.5], avoidCollisions: false } },
    });
    expect(parseMnx(rawScore(wire)).parts[0]!.measures[0]!.dynamics).toEqual([group]);
  });

  it("updates and removes the override in incremental saves and engine patches", () => {
    const serializer = new DeltaSerializer();
    serializer.serialize(nativeScore(groupKinds[0]!));
    for (const playbackVelocity of [96, 127, undefined]) {
      const group = { ...groupKinds[0]! };
      if (playbackVelocity !== undefined) group.playbackVelocity = playbackVelocity;
      const score = nativeScore(group);
      const result = serializer.serialize(score);
      expect(result.json).toBe(JSON.stringify(serializeMnx(score)));
      expect(parseMnx(JSON.parse(result.json)).parts[0]!.measures[0]!.dynamics).toEqual([group]);
      const patch: unknown = JSON.parse(
        serializer.buildPatch(result.changedGlobalMeasures, result.changedPartMeasures),
      );
      expect(patch).toMatchObject({
        partMeasures: { "0": { "0": { dynamics: [serializeDynamicGroup(group)] } } },
      });
    }
  });

  it.each([0, -1, 128, 96.5, "96", null, true, {}, [], NaN, Infinity, -Infinity])(
    "rejects invalid imported playbackVelocity %j instead of silently dropping it",
    (playbackVelocity) => {
      const raw = rawScore({ ...groupKinds[0]!, _x: { viritura: { playbackVelocity } } });
      const result = validateRawScore(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({ pointer: "/parts/0/measures/0/dynamics/0/_x/viritura/playbackVelocity" }),
        );
      }
      expect(() => parseMnx(raw)).toThrow(RawScoreValidationFailure);
    },
  );

  it.each([0, 128, 1.5])("rejects an invalid native attack %s when reloading serialized MNX", (playbackVelocity) => {
    const serialized = serializeMnx(nativeScore({ ...groupKinds[0]!, playbackVelocity }));
    expect(() => parseMnx(serialized)).toThrow(RawScoreValidationFailure);
  });

  it("rejects playbackVelocity as a top-level MNX dynamic-group attribute", () => {
    expect(() => parseMnx(rawScore({ ...groupKinds[0]!, playbackVelocity: 96 }))).toThrow(RawScoreValidationFailure);
  });
});

import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { mirrorTupletAt, rhythmSourceOptions, resolveRhythmSlot } from ".";

function event(duration: import("@viritura/core").Duration, rest = false) {
  return rest
    ? { type: "event" as const, duration, rest: {} }
    : { type: "event" as const, duration, notes: [{ pitch: { step: "C" as const, octave: 4 as const } }] };
}

function sourceScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, { time: { count: 3, unit: 4 } }] },
    parts: [
      {
        name: "Source",
        measures: [
          {
            sequences: [
              {
                staff: 1,
                content: [event({ base: "quarter" }), event({ base: "quarter" }, true), event({ base: "half" })],
              },
              { staff: 1, content: [event({ base: "half" }), event({ base: "half" })] },
            ],
          },
          { sequences: [{ staff: 1, content: [event({ base: "half" }), event({ base: "quarter" })] }] },
        ],
      },
      {
        name: "Target",
        measures: [{ sequences: [{ content: [event({ base: "whole" }, true)] }] }, { sequences: [{ content: [] }] }],
      },
    ],
  };
}

describe("rhythm lock source resolution", () => {
  it("resolves an exact physical part, staff, and voice source slot", () => {
    const result = resolveRhythmSlot(sourceScore(), { partIndex: 0, staffIndex: 0, voice: 2 }, 0, 2);
    expect(result).toMatchObject({ kind: "slot", slot: { duration: { base: "half" }, isRest: false } });
  });

  it("returns a source rest as an automatic rest slot", () => {
    const result = resolveRhythmSlot(sourceScore(), { partIndex: 0, staffIndex: 0, voice: 1 }, 0, 1);
    expect(result).toMatchObject({ kind: "slot", slot: { duration: { base: "quarter" }, isRest: true } });
  });

  it("requires a source event boundary instead of splitting a source slot", () => {
    expect(resolveRhythmSlot(sourceScore(), { partIndex: 0, staffIndex: 0, voice: 1 }, 0, 0.5)).toEqual({
      kind: "not-at-boundary",
    });
  });

  it("uses the next global measure's meter-aligned source content", () => {
    const result = resolveRhythmSlot(sourceScore(), { partIndex: 0, staffIndex: 0, voice: 1 }, 1, 2);
    expect(result).toMatchObject({ kind: "slot", slot: { duration: { base: "quarter" }, isRest: false } });
  });

  it("reports source exhaustion for a missing voice or measure", () => {
    expect(resolveRhythmSlot(sourceScore(), { partIndex: 0, staffIndex: 0, voice: 2 }, 1, 0)).toEqual({
      kind: "exhausted",
    });
  });

  it("skips grace groups and resolves the following metrical principal event", () => {
    const score = sourceScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content.unshift({
      type: "grace",
      content: [event({ base: "16th" })],
    });
    expect(resolveRhythmSlot(score, { partIndex: 0, staffIndex: 0, voice: 1 }, 0, 0)).toMatchObject({
      kind: "slot",
      slot: { duration: { base: "quarter" } },
    });
  });

  it("returns written inner duration and scaled timing for tuplet slots", () => {
    const score = sourceScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tuplet",
        inner: { multiple: 3, duration: { base: "eighth" } },
        outer: { multiple: 2, duration: { base: "eighth" } },
        content: [event({ base: "eighth" }), event({ base: "eighth" }, true), event({ base: "eighth" })],
      },
    ];
    const result = resolveRhythmSlot(score, { partIndex: 0, staffIndex: 0, voice: 1 }, 0, 1 / 3);
    expect(result).toMatchObject({
      kind: "slot",
      slot: { duration: { base: "eighth" }, isRest: true, realBeats: 1 / 3, tuplet: { eventIndex: 1 } },
    });
  });

  it("mirrors a source tuplet as empty target slots before note entry", () => {
    const score = sourceScore();
    const sourceTuplet = {
      type: "tuplet" as const,
      inner: { multiple: 3, duration: { base: "eighth" as const } },
      outer: { multiple: 2, duration: { base: "eighth" as const } },
      content: [event({ base: "eighth" }), event({ base: "eighth" }, true), event({ base: "eighth" })],
    };
    score.parts[0]!.measures[0]!.sequences[0]!.content = [sourceTuplet];
    mirrorTupletAt(score, { partIndex: 1, voice: 0 }, 0, sourceTuplet, 0);

    const created = score.parts[1]!.measures[0]!.sequences[0]!.content[0];
    expect(created).toMatchObject({
      type: "tuplet",
      inner: sourceTuplet.inner,
      outer: sourceTuplet.outer,
    });
    expect(created?.type === "tuplet" && created.content.every((item) => item.type === "event" && item.rest)).toBe(
      true,
    );
  });

  it("lists physical source voices even when a later measure introduces one", () => {
    const score = sourceScore();
    score.parts[0]!.measures[1]!.sequences.push({ staff: 1, content: [] });
    expect(rhythmSourceOptions(score).map((option) => option.value)).toContain("0:0:2");
  });
});

import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { applyBreathFermata } from "../radialMenu/radialMenuActions";
import type { BreathFermataSelection } from "../radialMenu/breathFermataMenu";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev-1",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
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

describe("applyBreathFermata — breath marks", () => {
  it("applies breath comma to an event", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "breath", symbol: "comma" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(ev.type).toBe("event");
    if (ev.type === "event") {
      expect(ev.markings?.breath).toEqual({});
    }
  });

  it("applies breath tick to an event", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "breath", symbol: "tick" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.markings?.breath).toEqual({ symbol: "tick" });
    }
  });

  it("does not mutate the original score", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "breath", symbol: "comma" };
    applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    const ev = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.markings).toBeUndefined();
    }
  });
});

describe("applyBreathFermata — fermata", () => {
  it("applies normal fermata to an event", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "fermata", shape: "normal" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.fermata).toEqual({});
    }
  });

  it("applies square fermata to an event", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "fermata", shape: "square" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.fermata).toEqual({ symbol: "square" });
    }
  });
});

describe("applyBreathFermata — caesura", () => {
  it("adds caesura to event markings", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "caesura" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.markings?.caesura).toEqual({});
    }
  });

  it("overwrites existing caesura on event", () => {
    const score = makeScore();
    const ev = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      ev.markings = { ...ev.markings, caesura: { style: "thick" } };
    }
    const resolved: BreathFermataSelection = { kind: "caesura" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const evResult = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (evResult.type === "event") {
      // Normal caesura replaces the existing thick one
      expect(evResult.markings?.caesura).toEqual({});
    }
  });

  it("does not mutate the original score", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "caesura" };
    applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    const ev = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.markings?.caesura).toBeUndefined();
    }
  });
});

describe("applyBreathFermata — edge cases", () => {
  it("returns null for non-single selection", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "breath", symbol: "comma" };
    expect(applyBreathFermata(score, { kind: "none" }, resolved)).toBeNull();
  });

  it("returns null for unresolvable event id", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "fermata", shape: "normal" };
    expect(applyBreathFermata(score, { kind: "single", elementId: "p9/m9/s9/ev-missing" }, resolved)).toBeNull();
  });

  it("returns null for invalid barline id with caesura", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "caesura" };
    expect(applyBreathFermata(score, { kind: "single", elementId: "m99/barline" }, resolved)).toBeNull();
  });
});

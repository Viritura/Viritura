import { describe, it, expect } from "vitest";
import { createDynamicGroup, type DynamicValue, type Score } from "@viritura/core";
import { generateTimeline } from "../timeline";
import {
  DYNAMIC_AXES,
  DEFAULT_DYNAMIC,
  dynamicToAxes,
  buildDynamicsEnvelope,
  sampleDynamics,
  cc11Events,
} from "../dynamicsEnvelope";

const CC_EXPRESSION = 11;

type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

function quarter(step: Step, octave: number) {
  return { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step, octave } }] };
}

/** A dynamic marking at a given quarter-beat within the measure. */
function dyn(value: DynamicValue, beat: number) {
  return createDynamicGroup(value, { fraction: [beat, 4] });
}

/**
 * Single-part 4/4 @ 120 bpm score. Each measure: 4 quarter A4 plus optional
 * dynamics list.
 */
function buildScore(measures: { dynamics?: { value: DynamicValue; beat: number }[] }[]): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: measures.map(() => ({
        time: { count: 4, unit: 4 },
        tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
      })),
    },
    parts: [
      {
        id: "p1",
        name: "Violin",
        measures: measures.map((m) => ({
          sequences: [{ content: [quarter("A", 4), quarter("A", 4), quarter("A", 4), quarter("A", 4)] }],
          ...(m.dynamics ? { dynamics: m.dynamics.map((d) => dyn(d.value, d.beat)) } : {}),
        })),
      } as never,
    ],
  };
}

function noteOns(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "noteOn");
}
function controlChanges(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "controlChange");
}
function cc11(tl: ReturnType<typeof generateTimeline>) {
  return controlChanges(tl).filter((e) => e.cc === CC_EXPRESSION);
}

describe("DYNAMIC_AXES coupling table", () => {
  it("maps each dynamic to coupled velocity + cc11", () => {
    expect(dynamicToAxes("mf")).toEqual({ velocity: 84, cc11: 100 });
    expect(dynamicToAxes("f")).toEqual({ velocity: 98, cc11: 112 });
    expect(dynamicToAxes("pp")).toEqual({ velocity: 52, cc11: 50 });
  });

  it("maps niente to zero expression while retaining a trigger velocity", () => {
    expect(dynamicToAxes("n")).toEqual({ velocity: 1, cc11: 0 });
  });

  it("is monotonic in both axes from ppp → fff", () => {
    const order: DynamicValue[] = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];
    for (let i = 1; i < order.length; i++) {
      const lo = DYNAMIC_AXES[order[i - 1]!]!;
      const hi = DYNAMIC_AXES[order[i]!]!;
      expect(hi.velocity).toBeGreaterThan(lo.velocity);
      expect(hi.cc11).toBeGreaterThanOrEqual(lo.cc11);
    }
  });

  it("never lets either axis encode the level alone (both move together)", () => {
    // The whole point of coupling: a louder dynamic raises BOTH axes, so neither
    // axis carries the full range (which would stack to an extreme product).
    expect(DYNAMIC_AXES.fff!.velocity).toBeLessThan(128);
    expect(DYNAMIC_AXES.ppp!.cc11).toBeGreaterThan(0);
  });
});

describe("buildDynamicsEnvelope + sampleDynamics", () => {
  it("is position-aware within a measure (step function)", () => {
    // p at beat 0, f at beat 2 (= 1.0s @ 120bpm).
    const score = buildScore([
      {
        dynamics: [
          { value: "p", beat: 0 },
          { value: "f", beat: 2 },
        ],
      },
    ]);
    const tl = generateTimeline(score);
    const env = buildDynamicsEnvelope(score.parts[0]!, [0], tl.measureStartBeats, tl.model, score.global.measures);
    expect(sampleDynamics(env, 0).velocity).toBe(DYNAMIC_AXES.p!.velocity);
    expect(sampleDynamics(env, 0.9).velocity).toBe(DYNAMIC_AXES.p!.velocity);
    expect(sampleDynamics(env, 1.0).velocity).toBe(DYNAMIC_AXES.f!.velocity);
    expect(sampleDynamics(env, 5.0).velocity).toBe(DYNAMIC_AXES.f!.velocity);
  });

  it("defaults to mf before any marking", () => {
    const score = buildScore([{}]);
    const tl = generateTimeline(score);
    const env = buildDynamicsEnvelope(score.parts[0]!, [0], tl.measureStartBeats, tl.model, score.global.measures);
    expect(sampleDynamics(env, 0)).toEqual(DEFAULT_DYNAMIC);
  });
});

describe("cc11Events", () => {
  it("emits a baseline at t=0 then one event per change, de-duplicated", () => {
    const score = buildScore([{ dynamics: [{ value: "f", beat: 2 }] }]);
    const tl = generateTimeline(score);
    const env = buildDynamicsEnvelope(score.parts[0]!, [0], tl.measureStartBeats, tl.model, score.global.measures);
    const evs = cc11Events(env);
    expect(evs[0]).toEqual({ time: 0, value: DEFAULT_DYNAMIC.cc11 }); // mf baseline
    expect(evs[1]).toEqual({ time: 1.0, value: DYNAMIC_AXES.f!.cc11 }); // f at beat 2
    expect(evs).toHaveLength(2);
  });

  it("a dynamic at t=0 replaces the baseline (no duplicate)", () => {
    const score = buildScore([{ dynamics: [{ value: "pp", beat: 0 }] }]);
    const tl = generateTimeline(score);
    const env = buildDynamicsEnvelope(score.parts[0]!, [0], tl.measureStartBeats, tl.model, score.global.measures);
    const evs = cc11Events(env);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toEqual({ time: 0, value: DYNAMIC_AXES.pp!.cc11 });
  });
});

describe("generateTimeline — coupled dynamics integration", () => {
  it("emits a single CC11 baseline (mf) for a part with no dynamics", () => {
    const tl = generateTimeline(buildScore([{}]));
    const ccs = cc11(tl);
    expect(ccs).toHaveLength(1);
    expect(ccs[0]!.time).toBe(0);
    expect(ccs[0]!.value).toBe(DEFAULT_DYNAMIC.cc11);
  });

  it("emits exactly one CC11 per dynamic level (no stacking / double-write)", () => {
    const tl = generateTimeline(buildScore([{ dynamics: [{ value: "f", beat: 0 }] }]));
    const ccs = cc11(tl);
    // One event at t=0 carrying f's cc11 (the f at beat 0 replaces the baseline).
    expect(ccs).toHaveLength(1);
    expect(ccs[0]!.value).toBe(DYNAMIC_AXES.f!.cc11);
  });

  it("louder dynamic ⇒ higher noteOn velocity (coupled with CC11)", () => {
    const soft = generateTimeline(buildScore([{ dynamics: [{ value: "pp", beat: 0 }] }]));
    const loud = generateTimeline(buildScore([{ dynamics: [{ value: "ff", beat: 0 }] }]));
    // Compare the downbeat note of each (same metric position → fair comparison).
    const softVel = noteOns(soft)[0]!.velocity;
    const loudVel = noteOns(loud)[0]!.velocity;
    expect(loudVel).toBeGreaterThan(softVel);
  });

  it("velocity tracks the position-aware dynamic within a measure", () => {
    // p (beats 0–1) then f (beats 2–3). Notes 0,1 should be softer than 2,3.
    const tl = generateTimeline(
      buildScore([
        {
          dynamics: [
            { value: "p", beat: 0 },
            { value: "f", beat: 2 },
          ],
        },
      ]),
    );
    const vels = noteOns(tl).map((e) => e.velocity);
    // Note 0 (p downbeat) vs note 2 (f, beat 2). Both get metric/humanize, but
    // the f base (98) clears the p base (64) by far more than the ±8 deltas.
    expect(vels[2]!).toBeGreaterThan(vels[0]! + 20);
  });
});

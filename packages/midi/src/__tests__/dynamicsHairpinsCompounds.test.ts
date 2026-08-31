import { describe, it, expect } from "vitest";
import { createDynamicGroup, generateId, type DynamicValue, type Score } from "@viritura/core";
import { generateTimeline } from "../timeline";
import { DYNAMIC_AXES, buildDynamicsEnvelope, sampleDynamics, noteVelocityAt, cc11Events } from "../dynamicsEnvelope";

const CC_EXPRESSION = 11;

type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

function quarter(step: Step, octave: number) {
  return { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step, octave } }] };
}
function dyn(value: string, beat: number) {
  return createDynamicGroup(value, { fraction: [beat, 4] });
}
/** A hairpin from `startBeat` (this measure) to `endMeasure`/`endBeat`. */
function hairpin(type: "crescendo" | "decrescendo", startBeat: number, endMeasure: string, endBeat: number) {
  return {
    id: generateId(),
    type: "gradual" as const,
    position: { fraction: [startBeat, 4] as [number, number] },
    end: { measure: endMeasure, position: { fraction: [endBeat, 4] as [number, number] } },
    wedgeType: type === "crescendo" ? ("increasing" as const) : ("decreasing" as const),
  };
}

interface MeasureSpec {
  dynamics?: { value: DynamicValue | "fp" | "sfz" | "sfp"; beat: number }[];
  hairpins?: ReturnType<typeof hairpin>[];
  expressions?: { text: string; beat: number }[];
}

/** Single-part 4/4 @ 120 bpm score; each global measure gets id `m1`, `m2`, … */
function buildScore(measures: MeasureSpec[]): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: measures.map((_, i) => ({
        id: `m${i + 1}`,
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
          ...(m.dynamics || m.hairpins
            ? { dynamics: [...(m.dynamics?.map((d) => dyn(d.value, d.beat)) ?? []), ...(m.hairpins ?? [])] }
            : {}),
          ...(m.expressions
            ? {
                expressions: m.expressions.map((expression) => ({
                  text: expression.text,
                  position: { fraction: [expression.beat, 4] },
                })),
              }
            : {}),
        })),
      } as never,
    ],
  };
}

function envOf(score: Score) {
  const tl = generateTimeline(score);
  return buildDynamicsEnvelope(
    score.parts[0]!,
    score.global.measures.map((_, i) => i),
    tl.measureStartBeats,
    tl.model,
    score.global.measures,
  );
}
function noteOns(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "noteOn");
}
function cc11(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "controlChange" && e.cc === CC_EXPRESSION);
}

// ═══════════════════════════════════════════
// Stage 2 — hairpin ramps
// ═══════════════════════════════════════════

describe("hairpin ramps — sampleDynamics interpolation", () => {
  it("crescendo p→f interpolates velocity continuously across the span", () => {
    // m1: p at beat 0, crescendo beat 0 → m2 beat 0; m2: f at beat 0.
    const score = buildScore([
      { dynamics: [{ value: "p", beat: 0 }], hairpins: [hairpin("crescendo", 0, "m2", 0)] },
      { dynamics: [{ value: "f", beat: 0 }] },
    ]);
    const env = envOf(score);
    // Span is 0 → 2.0s (one 4/4 measure @120). Endpoints exact, middle blended.
    expect(sampleDynamics(env, 0).velocity).toBe(DYNAMIC_AXES.p!.velocity);
    expect(sampleDynamics(env, 2.0).velocity).toBe(DYNAMIC_AXES.f!.velocity);
    const mid = sampleDynamics(env, 1.0).velocity;
    expect(mid).toBeGreaterThan(DYNAMIC_AXES.p!.velocity);
    expect(mid).toBeLessThan(DYNAMIC_AXES.f!.velocity);
  });

  it("decrescendo f→p interpolates downward", () => {
    const score = buildScore([
      { dynamics: [{ value: "f", beat: 0 }], hairpins: [hairpin("decrescendo", 0, "m2", 0)] },
      { dynamics: [{ value: "p", beat: 0 }] },
    ]);
    const env = envOf(score);
    expect(sampleDynamics(env, 0).velocity).toBe(DYNAMIC_AXES.f!.velocity);
    expect(sampleDynamics(env, 2.0).velocity).toBe(DYNAMIC_AXES.p!.velocity);
    expect(sampleDynamics(env, 1.0).velocity).toBeLessThan(DYNAMIC_AXES.f!.velocity);
  });

  it("falls back to one rung when no target dynamic is written at the end", () => {
    // No starting dynamic (mf default), crescendo with nothing at the end → mf→f.
    const score = buildScore([
      { hairpins: [hairpin("crescendo", 0, "m2", 0)] },
      {}, // no target dynamic at the end
    ]);
    const env = envOf(score);
    expect(sampleDynamics(env, 2.0).velocity).toBe(DYNAMIC_AXES.f!.velocity); // one rung above mf
  });

  it("treats cresc. expression text with an endpoint dynamic like a crescendo hairpin", () => {
    const score = buildScore([
      { dynamics: [{ value: "p", beat: 0 }], expressions: [{ text: "cresc.", beat: 0 }] },
      { dynamics: [{ value: "f", beat: 0 }] },
    ]);
    const env = envOf(score);

    expect(sampleDynamics(env, 0).velocity).toBe(DYNAMIC_AXES.p!.velocity);
    expect(sampleDynamics(env, 1).velocity).toBeGreaterThan(DYNAMIC_AXES.p!.velocity);
    expect(sampleDynamics(env, 1).velocity).toBeLessThan(DYNAMIC_AXES.f!.velocity);
    expect(sampleDynamics(env, 2).velocity).toBe(DYNAMIC_AXES.f!.velocity);
  });

  it("treats dim. as the inverse textual gradual dynamic", () => {
    const score = buildScore([
      { dynamics: [{ value: "f", beat: 0 }], expressions: [{ text: "dim.", beat: 0 }] },
      { dynamics: [{ value: "p", beat: 0 }] },
    ]);
    const env = envOf(score);

    expect(sampleDynamics(env, 1).velocity).toBeLessThan(DYNAMIC_AXES.f!.velocity);
    expect(sampleDynamics(env, 2).velocity).toBe(DYNAMIC_AXES.p!.velocity);
  });

  it("starts an unanchored post-rest crescendo quietly instead of retaining ff", () => {
    const score = buildScore([
      { dynamics: [{ value: "ff", beat: 0 }] },
      {},
      { hairpins: [hairpin("crescendo", 0, "m4", 0)] },
      {},
    ]);
    score.parts[0]!.measures[1]!.sequences[0]!.content = [{ type: "event", duration: { base: "whole" }, rest: {} }];
    const env = envOf(score);

    expect(sampleDynamics(env, 4).velocity).toBe(DYNAMIC_AXES.p!.velocity);
  });

  it("applies the same post-rest rule to cresc. expression text", () => {
    const score = buildScore([
      { dynamics: [{ value: "ff", beat: 0 }] },
      {},
      { expressions: [{ text: "cresc.", beat: 0 }] },
      { dynamics: [{ value: "f", beat: 0 }] },
    ]);
    score.parts[0]!.measures[1]!.sequences[0]!.content = [{ type: "event", duration: { base: "whole" }, rest: {} }];
    const env = envOf(score);

    expect(sampleDynamics(env, 4).velocity).toBe(DYNAMIC_AXES.p!.velocity);
  });

  it("keeps an explicit post-rest starting dynamic authoritative", () => {
    const score = buildScore([
      { dynamics: [{ value: "ff", beat: 0 }] },
      {},
      {
        dynamics: [{ value: "mf", beat: 0 }],
        hairpins: [hairpin("crescendo", 0, "m4", 0)],
      },
      {},
    ]);
    score.parts[0]!.measures[1]!.sequences[0]!.content = [{ type: "event", duration: { base: "whole" }, rest: {} }];
    expect(sampleDynamics(envOf(score), 4).velocity).toBe(DYNAMIC_AXES.mf!.velocity);
  });

  it("retains the standing dynamic when no silent measure precedes the crescendo", () => {
    const score = buildScore([
      { dynamics: [{ value: "ff", beat: 0 }] },
      {},
      { hairpins: [hairpin("crescendo", 0, "m4", 0)] },
      {},
    ]);
    expect(sampleDynamics(envOf(score), 4).velocity).toBe(DYNAMIC_AXES.ff!.velocity);
  });
});

describe("hairpin ramps — CC11 grid", () => {
  it("emits a fine, monotonically rising CC11 grid across a crescendo", () => {
    const score = buildScore([
      { dynamics: [{ value: "p", beat: 0 }], hairpins: [hairpin("crescendo", 0, "m2", 0)] },
      { dynamics: [{ value: "f", beat: 0 }] },
    ]);
    const tl = generateTimeline(score);
    const ccs = cc11(tl).filter((e) => e.time <= 2.0 + 1e-6);
    // Many steps (≈30 ms grid over 2 s), non-decreasing, ending at f's cc11.
    expect(ccs.length).toBeGreaterThan(20);
    for (let i = 1; i < ccs.length; i++) expect(ccs[i]!.value!).toBeGreaterThanOrEqual(ccs[i - 1]!.value!);
    expect(ccs[0]!.value).toBe(DYNAMIC_AXES.p!.cc11);
    expect(ccs[ccs.length - 1]!.value).toBe(DYNAMIC_AXES.f!.cc11);
  });
});

describe("hairpin ramps — note velocity anti-zipper", () => {
  it("notes across the cresc get progressively higher velocity (no snap)", () => {
    const score = buildScore([
      { dynamics: [{ value: "p", beat: 0 }], hairpins: [hairpin("crescendo", 0, "m2", 0)] },
      { dynamics: [{ value: "f", beat: 0 }] },
    ]);
    const tl = generateTimeline(score);
    const vels = noteOns(tl)
      .slice(0, 4)
      .map((e) => e.velocity); // m1 beats 0..3
    // Strictly trending up: last note of the cresc well above the first. The p→f
    // base spread (64→98) dwarfs the ±6 metric / ±2 humanize noise.
    expect(vels[3]!).toBeGreaterThan(vels[0]! + 10);
  });
});

describe("hairpin ramps — chaining & open ends", () => {
  it("chains a messa di voce: cresc then dim share the peak (mf→f→mf)", () => {
    // m1: cresc beats 0→2, dim beats 2→4. No explicit dynamics anywhere.
    const score = buildScore([{ hairpins: [hairpin("crescendo", 0, "m1", 2), hairpin("decrescendo", 2, "m1", 4)] }]);
    const env = envOf(score);
    // Start mf (default), peak at 1.0s = f (one rung up), back to mf at 2.0s.
    expect(sampleDynamics(env, 0).velocity).toBe(DYNAMIC_AXES.mf!.velocity);
    expect(sampleDynamics(env, 1.0).velocity).toBe(DYNAMIC_AXES.f!.velocity);
    expect(sampleDynamics(env, 2.0).velocity).toBe(DYNAMIC_AXES.mf!.velocity);
    // The seam has NO discontinuity: just past the peak the dim is already
    // descending from f, not snapped back to a standing mf.
    expect(sampleDynamics(env, 1.05).velocity).toBeLessThan(DYNAMIC_AXES.f!.velocity);
    expect(sampleDynamics(env, 1.05).velocity).toBeGreaterThan(DYNAMIC_AXES.mf!.velocity);
  });

  it("chains from an explicit peak: p →(cresc)→ ff →(dim, open)→ f", () => {
    // m1: p at beat 0, cresc 0→2; ff at beat 2, dim 2→4 (open).
    const score = buildScore([
      {
        dynamics: [
          { value: "p", beat: 0 },
          { value: "ff", beat: 2 },
        ],
        hairpins: [hairpin("crescendo", 0, "m1", 2), hairpin("decrescendo", 2, "m1", 4)],
      },
    ]);
    const env = envOf(score);
    expect(sampleDynamics(env, 0).velocity).toBe(DYNAMIC_AXES.p!.velocity);
    expect(sampleDynamics(env, 1.0).velocity).toBe(DYNAMIC_AXES.ff!.velocity); // explicit peak
    // Open dim chains from ff, steps one rung down → f by the end.
    expect(sampleDynamics(env, 2.0).velocity).toBe(DYNAMIC_AXES.f!.velocity);
  });

  it("an open decrescendo with no context steps one rung down (p→pp)", () => {
    const score = buildScore([
      { dynamics: [{ value: "p", beat: 0 }], hairpins: [hairpin("decrescendo", 0, "m2", 0)] },
      {},
    ]);
    const env = envOf(score);
    expect(sampleDynamics(env, 0).velocity).toBe(DYNAMIC_AXES.p!.velocity);
    expect(sampleDynamics(env, 2.0).velocity).toBe(DYNAMIC_AXES.pp!.velocity);
  });

  it("does NOT chain when a gap separates the two hairpins", () => {
    // cresc in m1 (beats 0→2), dim in m2 (beats 0→4) — a 1-beat gap between.
    const score = buildScore([
      { hairpins: [hairpin("crescendo", 0, "m1", 2)] },
      { hairpins: [hairpin("decrescendo", 0, "m2", 4)] },
    ]);
    const env = envOf(score);
    // cresc mf→f ends at 1.0s; standing level resumes (mf) in the gap; the dim
    // starts fresh from the standing mf at 2.0s (NOT chained from f).
    expect(sampleDynamics(env, 2.0).velocity).toBe(DYNAMIC_AXES.mf!.velocity);
  });
});

// ═══════════════════════════════════════════
// Stage 3 — compound dynamics (fp / sfz / …)
// ═══════════════════════════════════════════

describe("compound dynamics — fp (loud attack, piano body)", () => {
  it("note at the fp gets a forte attack; the next note is piano", () => {
    const tl = generateTimeline(buildScore([{ dynamics: [{ value: "fp", beat: 0 }] }]));
    const vels = noteOns(tl).map((e) => e.velocity);
    // Beat-0 note ≈ f attack (98+); beat-1 note ≈ p body (64). Big gap.
    expect(vels[0]!).toBeGreaterThan(vels[1]! + 20);
  });

  it("keeps CC11 at the piano body while velocity carries the attack", () => {
    const env = envOf(buildScore([{ dynamics: [{ value: "fp", beat: 0 }] }]));
    const evs = cc11Events(env);
    expect(evs).toEqual([{ time: 0, value: DYNAMIC_AXES.p!.cc11 }]);
  });

  it("leaves a persistent piano level for later notes", () => {
    const env = envOf(buildScore([{ dynamics: [{ value: "fp", beat: 0 }] }]));
    // Sampled level well after the fp = piano (not forte).
    expect(sampleDynamics(env, 1.5).velocity).toBe(DYNAMIC_AXES.p!.velocity);
  });
});

describe("compound dynamics — sfz (accent, no standing change)", () => {
  it("accents only the marked note; the rest stays at context (mf)", () => {
    const tl = generateTimeline(buildScore([{ dynamics: [{ value: "sfz", beat: 0 }] }]));
    const vels = noteOns(tl).map((e) => e.velocity);
    // Beat-0 sforzando ≈ ff attack; later notes return to mf default.
    expect(vels[0]!).toBeGreaterThan(vels[1]! + 15);
  });

  it("leaves standing CC11 unchanged", () => {
    const env = envOf(buildScore([{ dynamics: [{ value: "sfz", beat: 0 }] }]));
    const evs = cc11Events(env);
    expect(evs).toEqual([{ time: 0, value: DYNAMIC_AXES.mf!.cc11 }]);
    // No persistent anchor: the level after the sforzando is unchanged (mf).
    expect(sampleDynamics(env, 1.5).velocity).toBe(DYNAMIC_AXES.mf!.velocity);
  });
});

describe("compound dynamics — sfp (sforzando-piano)", () => {
  it("forte attack settling to piano", () => {
    const env = envOf(buildScore([{ dynamics: [{ value: "sfp", beat: 0 }] }]));
    expect(noteVelocityAt(env, 0)).toBe(DYNAMIC_AXES.f!.velocity); // attack
    expect(sampleDynamics(env, 1.5).velocity).toBe(DYNAMIC_AXES.p!.velocity); // body
  });
});

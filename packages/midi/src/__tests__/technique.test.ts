import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { generateTimeline } from "../timeline";

const GM_VIOLIN = 40;
const GM_PIZZICATO_STRINGS = 45;
const GM_FLUTE = 73;
const GM_TRUMPET = 56;

// Mute CC numbers (mirror timeline.ts).
const CC_BRIGHTNESS = 74;
const CC_RESONANCE = 71;
const CC_EXPRESSION = 11;

type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

function quarter(step: Step, octave: number) {
  return { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step, octave } }] };
}

function expr(text: string, beatNum: number) {
  // position.fraction is a fraction of a whole note; beat N (quarters) = [N, 4].
  return { text, position: { fraction: [beatNum, 4] as [number, number] } };
}

/**
 * Build a single-string-part score. `measures` is an array of measure specs:
 * each has 4 quarter notes plus an optional list of [text, beat] expressions.
 */
function buildStringScore(measures: { expressions?: { text: string; beat: number }[] }[]): Score {
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
        id: "vln",
        name: "Violin",
        measures: measures.map((m) => ({
          sequences: [
            {
              content: [quarter("A", 4), quarter("A", 4), quarter("A", 4), quarter("A", 4)],
            },
          ],
          ...(m.expressions ? { expressions: m.expressions.map((e) => expr(e.text, e.beat)) } : {}),
        })),
      } as never,
    ],
  };
}

function programChanges(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "programChange").map((e) => ({ time: e.time, program: e.program }));
}

function controlChanges(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "controlChange").map((e) => ({ time: e.time, cc: e.cc, value: e.value }));
}

/** Map of cc → value for the controlChange events emitted at a given time. */
function ccAt(tl: ReturnType<typeof generateTimeline>, time: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of controlChanges(tl)) {
    if (Math.abs(e.time - time) < 1e-6) m.set(e.cc!, e.value!);
  }
  return m;
}

describe("generateTimeline — pizz/arco keyswitch", () => {
  it("emits a programChange to Pizzicato Strings at the pizz. marking", () => {
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "pizz.", beat: 0 }] }]), {
      partPrograms: [GM_VIOLIN],
    });
    const pcs = programChanges(tl);
    expect(pcs).toHaveLength(1);
    expect(pcs[0]!.program).toBe(GM_PIZZICATO_STRINGS);
    expect(pcs[0]!.time).toBeCloseTo(0, 5);
  });

  it("restores the baseline program at an arco marking", () => {
    // Measure 1: pizz at beat 0. Measure 2: arco at beat 0.
    const tl = generateTimeline(
      buildStringScore([{ expressions: [{ text: "pizz.", beat: 0 }] }, { expressions: [{ text: "arco", beat: 0 }] }]),
      { partPrograms: [GM_VIOLIN] },
    );
    const pcs = programChanges(tl);
    expect(pcs).toHaveLength(2);
    expect(pcs[0]!.program).toBe(GM_PIZZICATO_STRINGS);
    expect(pcs[1]!.program).toBe(GM_VIOLIN);
    // Second measure starts at 2s (4 quarters @ 120bpm = 2s).
    expect(pcs[1]!.time).toBeCloseTo(2, 5);
  });

  it("persists the technique across measures without re-emitting", () => {
    // pizz in measure 1, nothing in measure 2 → no second programChange.
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "pizz.", beat: 0 }] }, {}]), {
      partPrograms: [GM_VIOLIN],
    });
    expect(programChanges(tl)).toHaveLength(1);
  });

  it("collapses a redundant repeat of the same technique", () => {
    const tl = generateTimeline(
      buildStringScore([{ expressions: [{ text: "pizz.", beat: 0 }] }, { expressions: [{ text: "pizz.", beat: 0 }] }]),
      { partPrograms: [GM_VIOLIN] },
    );
    expect(programChanges(tl)).toHaveLength(1);
  });

  it("switches mid-measure at the marking's beat", () => {
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "pizz.", beat: 2 }] }]), {
      partPrograms: [GM_VIOLIN],
    });
    const pcs = programChanges(tl);
    expect(pcs).toHaveLength(1);
    // Beat 2 @ 120bpm = 1s.
    expect(pcs[0]!.time).toBeCloseTo(1, 5);
  });

  it("ignores pizz/arco on a non-string instrument", () => {
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "pizz.", beat: 0 }] }]), {
      partPrograms: [GM_FLUTE],
    });
    expect(programChanges(tl)).toHaveLength(0);
  });

  it("ignores non-technique expressions like dynamics text", () => {
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "dolce", beat: 0 }] }]), {
      partPrograms: [GM_VIOLIN],
    });
    expect(programChanges(tl)).toHaveLength(0);
  });
});

describe("generateTimeline — con sord. (mute) keyswitch", () => {
  it("emits the string mute filter curve (CC 74/71, timbre only) at con sord.", () => {
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "con sord.", beat: 0 }] }]), {
      partPrograms: [GM_VIOLIN],
    });
    const cc = ccAt(tl, 0);
    // Strings muted curve is timbre only: brightness 44, resonance 70. The mute
    // no longer touches CC 11 — that axis is owned by the dynamics system, which
    // emits its mf baseline (100) at t=0.
    expect(cc.get(CC_BRIGHTNESS)).toBe(44);
    expect(cc.get(CC_RESONANCE)).toBe(70);
    expect(cc.get(CC_EXPRESSION)).toBe(100);
  });

  it("emits a pinched, resonant (not silencing) curve for brass mute", () => {
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "con sord.", beat: 0 }] }]), {
      partPrograms: [GM_TRUMPET],
    });
    const cc = ccAt(tl, 0);
    // Brass muted curve is timbre only: brightness 58, resonance 84. The cutoff
    // stays near neutral so a muted trumpet's upper harmonics survive (a hard
    // lowpass made high brass inaudible); the nasal pinch is resonance. CC 11 at
    // t=0 is the dynamics mf baseline (100), not a mute level dip.
    expect(cc.get(CC_BRIGHTNESS)).toBe(58);
    expect(cc.get(CC_RESONANCE)).toBe(84);
    expect(cc.get(CC_EXPRESSION)).toBe(100);
  });

  it("restores the neutral curve at senza sord.", () => {
    const tl = generateTimeline(
      buildStringScore([
        { expressions: [{ text: "con sord.", beat: 0 }] },
        { expressions: [{ text: "senza sord.", beat: 0 }] },
      ]),
      { partPrograms: [GM_VIOLIN] },
    );
    // Second measure starts at 2s; open curve = 64/64 (timbre only, no CC 11).
    const cc = ccAt(tl, 2);
    expect(cc.get(CC_BRIGHTNESS)).toBe(64);
    expect(cc.get(CC_RESONANCE)).toBe(64);
    expect(cc.get(CC_EXPRESSION)).toBeUndefined();
  });

  it("does NOT touch CC 7 (channel volume belongs to the mixer)", () => {
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "con sord.", beat: 0 }] }]), {
      partPrograms: [GM_VIOLIN],
    });
    expect(controlChanges(tl).some((e) => e.cc === 7)).toBe(false);
  });

  it("persists the mute across measures without re-emitting", () => {
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "con sord.", beat: 0 }] }, {}]), {
      partPrograms: [GM_VIOLIN],
    });
    // Two mute CCs (74/71) at the marking, none repeated in the empty second
    // measure, plus the single dynamics CC 11 baseline at t=0 = 3 total.
    expect(controlChanges(tl)).toHaveLength(3);
  });

  it("omits mute on woodwinds (only the dynamics CC 11 baseline remains)", () => {
    const tl = generateTimeline(buildStringScore([{ expressions: [{ text: "con sord.", beat: 0 }] }]), {
      partPrograms: [GM_FLUTE],
    });
    const ccs = controlChanges(tl);
    expect(ccs).toHaveLength(1);
    expect(ccs[0]!.cc).toBe(CC_EXPRESSION);
    expect(ccs[0]!.value).toBe(100);
  });

  it("mute and pizz are independent on strings", () => {
    // pizz at beat 0, con sord. at beat 2 — both should apply.
    const tl = generateTimeline(
      buildStringScore([
        {
          expressions: [
            { text: "pizz.", beat: 0 },
            { text: "con sord.", beat: 2 },
          ],
        },
      ]),
      { partPrograms: [GM_VIOLIN] },
    );
    expect(programChanges(tl)).toHaveLength(1);
    expect(programChanges(tl)[0]!.program).toBe(GM_PIZZICATO_STRINGS);
    // Mute curve applied at beat 2 = 1s.
    const cc = ccAt(tl, 1);
    expect(cc.get(CC_BRIGHTNESS)).toBe(44);
  });
});

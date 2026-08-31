import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { generateTimeline } from "../timeline";

type Step = "C" | "D" | "E" | "F" | "G" | "B" | "A";

function note(step: Step, octave: number, base: string, extra?: Record<string, unknown>) {
  return { type: "event", duration: { base }, notes: [{ pitch: { step, octave } }], ...extra };
}

/** quarter-note seconds at 120 bpm. */
const Q = 0.5;
// off.time for a legato note is computed from the SAME jittered onset the next
// note uses, so the overlap delta is deterministic (jitter cancels). The legato
// constant in timeline.ts.
const OVERLAP = 0.02;

// MIDI: C5 = 72, D5 = 74, E5 = 76.
const C5 = 72;
const D5 = 74;
const E5 = 76;

/** Build a one-part 4/4 @ 120 bpm score from per-measure content arrays. */
function buildScore(measures: object[][]): Score {
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
        measures: measures.map((content) => ({ sequences: [{ content }] })),
      } as never,
    ],
  };
}

function noteOns(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "noteOn");
}
function noteOffs(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((e) => e.type === "noteOff");
}
const onOf = (tl: ReturnType<typeof generateTimeline>, midi: number) => noteOns(tl).find((e) => e.midiNote === midi)!;
const offOf = (tl: ReturnType<typeof generateTimeline>, midi: number) => noteOffs(tl).find((e) => e.midiNote === midi)!;

describe("generateTimeline — slur legato overlap", () => {
  it("an interior slur note's release overlaps the next note's onset", () => {
    const tl = generateTimeline(
      buildScore([
        [note("C", 5, "quarter", { id: "e1", slurs: [{ target: "e2" }] }), note("D", 5, "quarter", { id: "e2" })],
      ]),
    );
    const off = offOf(tl, C5);
    const on2 = onOf(tl, D5);
    // C5 releases OVERLAP after D5 speaks (legato glue).
    expect(off.time - on2.time).toBeCloseTo(OVERLAP, 3);
    expect(off.time).toBeGreaterThan(on2.time);
  });

  it("without a slur the same note releases before the next onset (détaché)", () => {
    const tl = generateTimeline(
      buildScore([[note("C", 5, "quarter", { id: "e1" }), note("D", 5, "quarter", { id: "e2" })]]),
    );
    const off = offOf(tl, C5);
    const on2 = onOf(tl, D5);
    // Default articulation = 0.9 → releases ~10% of a quarter before the next
    // note. off and the next onset carry independent ±15ms jitter, so the gap is
    // ~0.05s within a jitter-wide tolerance — the point is it stays POSITIVE.
    expect(off.time).toBeLessThan(on2.time);
    expect(on2.time - off.time).toBeCloseTo(0.1 * Q, 1);
  });

  it("the final note of a slur takes a normal (non-overlapping) release", () => {
    const tl = generateTimeline(
      buildScore([
        [note("C", 5, "quarter", { id: "e1", slurs: [{ target: "e2" }] }), note("D", 5, "quarter", { id: "e2" })],
      ]),
    );
    const on2 = onOf(tl, D5);
    const off2 = offOf(tl, D5);
    expect(off2.time - on2.time).toBeCloseTo(0.9 * Q, 3);
  });

  it("connects every interior note of a multi-note slur", () => {
    const tl = generateTimeline(
      buildScore([
        [
          note("C", 5, "quarter", { id: "e1", slurs: [{ target: "e3" }] }),
          note("D", 5, "quarter", { id: "e2" }),
          note("E", 5, "quarter", { id: "e3" }),
        ],
      ]),
    );
    // C5 and D5 are interior → overlap their successors; E5 is the final note.
    expect(offOf(tl, C5).time - onOf(tl, D5).time).toBeCloseTo(OVERLAP, 3);
    expect(offOf(tl, D5).time - onOf(tl, E5).time).toBeCloseTo(OVERLAP, 3);
    expect(offOf(tl, E5).time - onOf(tl, E5).time).toBeCloseTo(0.9 * Q, 3);
  });

  it("does not overlap a repeated pitch — releases exactly at the next onset", () => {
    const tl = generateTimeline(
      buildScore([
        [note("C", 5, "quarter", { id: "e1", slurs: [{ target: "e2" }] }), note("C", 5, "quarter", { id: "e2" })],
      ]),
    );
    const off1 = noteOffs(tl).find((e) => e.midiNote === C5)!;
    const on2 = noteOns(tl).filter((e) => e.midiNote === C5)[1]!;
    // Same pitch: gapless release-then-attack, no overlap (would steal the voice).
    expect(off1.time).toBeCloseTo(on2.time, 5);
  });

  it("caps the overlap to the next note's duration so it cannot reach the note after", () => {
    // Slur a quarter into a 128th note (0.0156s < OVERLAP). The overhang must
    // not exceed the short note's own length.
    const tl = generateTimeline(
      buildScore([
        [
          note("C", 5, "quarter", { id: "e1", slurs: [{ target: "e2" }] }),
          note("D", 5, "128th", { id: "e2" }),
          note("E", 5, "quarter", { id: "e3" }),
        ],
      ]),
    );
    const off1 = offOf(tl, C5);
    const on2 = onOf(tl, D5);
    const next128thDur = 0.03125 * Q; // 128th = 0.03125 quarter-beats → seconds
    expect(off1.time - on2.time).toBeCloseTo(next128thDur, 4);
    // The overhang ends within D5's own span — never past its end (= E5 onset).
    expect(off1.time).toBeLessThanOrEqual(on2.time + next128thDur + 1e-9);
  });

  it("connects a slur that crosses a bar line", () => {
    const tl = generateTimeline(
      buildScore([
        [note("C", 5, "whole", { id: "e1", slurs: [{ target: "e2" }] })],
        [note("D", 5, "whole", { id: "e2" })],
      ]),
    );
    const off1 = offOf(tl, C5);
    const on2 = onOf(tl, D5); // start of measure 2 = 2.0s
    expect(on2.time).toBeCloseTo(2.0, 2);
    expect(off1.time - on2.time).toBeCloseTo(OVERLAP, 3);
  });
});

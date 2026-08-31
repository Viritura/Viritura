/**
 * Solving the real cue.
 *
 * The Caminandes demo cue was fitted by hand with a throwaway script before this
 * solver existed. Re-deriving its spans here is the strongest check available:
 * these are the actual picture events, including the ones that forced odd bars,
 * and fractional BPM now lets every generated section land exactly.
 *
 * A failure here means the solver would have produced a worse cue than a person
 * did, which is the thing worth defending against.
 */

import { describe, expect, it } from "vitest";
import { fitSpan } from "../fitSpan";
import type { TimeSignature } from "../cueTypes";

const FOUR_FOUR: TimeSignature = { count: 4, unit: 4 };
const THREE_FOUR: TimeSignature = { count: 3, unit: 4 };
const TWO_FOUR: TimeSignature = { count: 2, unit: 4 };
const ONE_FOUR: TimeSignature = { count: 1, unit: 4 };

/** Section boundaries as spotted from the picture, in seconds. */
const SECTIONS = [
  { label: "fade up from black", from: 0, to: 2.0, meters: [TWO_FOUR], bars: [1, 1], bpm: [55, 70], want: 60 },
  { label: "title card", from: 2.0, to: 6.0, meters: [FOUR_FOUR], bars: [2, 2], bpm: [100, 140], want: 120 },
  { label: "Koro on the ice", from: 6.0, to: 16.25, meters: [FOUR_FOUR], bars: [3, 6], bpm: [92, 128], want: 108 },
  { label: "belly flop", from: 16.25, to: 21.39, meters: [THREE_FOUR], bars: [2, 3], bpm: [58, 84], want: 70 },
  { label: "standoff", from: 21.39, to: 30.25, meters: [FOUR_FOUR], bars: [3, 5], bpm: [92, 120], want: 108 },
  { label: "Koro realises", from: 30.25, to: 32.25, meters: [FOUR_FOUR], bars: [1, 2], bpm: [104, 138], want: 120 },
  { label: "the train", from: 32.25, to: 52.0, meters: [FOUR_FOUR], bars: [11, 15], bpm: [138, 168], want: 152 },
  { label: "landing on the cart", from: 52.0, to: 56.6, meters: [FOUR_FOUR], bars: [2, 3], bpm: [92, 126], want: 104 },
  { label: "into the tunnel", from: 56.6, to: 60.5, meters: [FOUR_FOUR], bars: [2, 3], bpm: [108, 138], want: 123 },
  { label: "berry bonanza", from: 60.5, to: 74.6, meters: [FOUR_FOUR], bars: [7, 10], bpm: [120, 150], want: 136 },
  { label: "head bonk", from: 74.6, to: 75.05, meters: [ONE_FOUR], bars: [1, 1], bpm: [110, 170], want: 133 },
  { label: "smug Oti", from: 75.05, to: 78.75, meters: [FOUR_FOUR], bars: [2, 3], bpm: [116, 146], want: 130 },
  {
    label: "burst into daylight",
    from: 78.75,
    to: 80.25,
    meters: [FOUR_FOUR],
    bars: [1, 2],
    bpm: [144, 180],
    want: 160,
  },
  { label: "chaotic flight", from: 80.25, to: 95.5, meters: [FOUR_FOUR], bars: [8, 11], bpm: [128, 156], want: 142 },
  { label: "comic deflate", from: 95.5, to: 101.8, meters: [FOUR_FOUR], bars: [2, 3], bpm: [64, 92], want: 76 },
  { label: "defeated", from: 101.8, to: 111.75, meters: [THREE_FOUR], bars: [3, 6], bpm: [58, 92], want: 72 },
  { label: "sunset, alone", from: 111.75, to: 117.0, meters: [THREE_FOUR], bars: [2, 3], bpm: [58, 78], want: 69 },
  { label: "a berry falls", from: 117.0, to: 121.0, meters: [THREE_FOUR], bars: [2, 3], bpm: [78, 100], want: 90 },
  { label: "the flock", from: 121.0, to: 133.5, meters: [FOUR_FOUR], bars: [4, 6], bpm: [84, 106], want: 96 },
  { label: "pull back", from: 133.5, to: 137.0, meters: [FOUR_FOUR], bars: [1, 2], bpm: [60, 80], want: 69 },
  { label: "credits", from: 137.0, to: 150.12, meters: [FOUR_FOUR], bars: [3, 6], bpm: [62, 88], want: 73 },
] as const;

const FRAME_RATE = 24;

function solve(section: (typeof SECTIONS)[number]) {
  return fitSpan({
    seconds: section.to - section.from,
    meters: section.meters,
    tailMeters: [THREE_FOUR, TWO_FOUR],
    minBars: section.bars[0],
    maxBars: section.bars[1],
    minBpm: section.bpm[0],
    maxBpm: section.bpm[1],
    preferredBpm: section.want,
    frameRate: FRAME_RATE,
  });
}

describe("solving the Caminandes cue from its spotted hits", () => {
  for (const section of SECTIONS) {
    it(`${section.label} lands on its target frame`, () => {
      const fit = solve(section);
      expect(fit.best, "no solution within the requested constraints").toBeDefined();
      expect(fit.best!.errorFrames).toBeCloseTo(0, 9);
    });
  }

  it("uses fractional BPM on a span integer BPM cannot divide", () => {
    const section = SECTIONS.find((s) => s.label === "defeated")!;
    const generous = fitSpan({
      seconds: section.to - section.from,
      meters: [THREE_FOUR, FOUR_FOUR],
      tailMeters: [TWO_FOUR, THREE_FOUR],
      minBars: 2,
      maxBars: 12,
      minBpm: 50,
      maxBpm: 100,
      preferredBpm: section.want,
      frameRate: FRAME_RATE,
    });
    expect(generous.best!.errorFrames).toBeCloseTo(0, 9);
    expect(Number.isInteger(generous.best!.bpm)).toBe(false);
  });

  it("keeps the whole cue inside a frame of every hit when solved span by span", () => {
    // Each span is solved against its own duration and the results accumulated,
    // which is what a real cue does. Error must not compound along the way.
    let clock = 0;
    const drifts: { label: string; frames: number }[] = [];
    for (const section of SECTIONS) {
      const fit = solve(section);
      expect(fit.best).toBeDefined();
      clock += (fit.best!.beats * 60) / fit.best!.bpm;
      drifts.push({ label: section.label, frames: (clock - section.to) * FRAME_RATE });
    }
    const worst = drifts.reduce((a, b) => (Math.abs(b.frames) > Math.abs(a.frames) ? b : a));
    // Accumulated drift across 21 spans is what the hand-fitted cue avoided by
    // anchoring each section to absolute picture time; the solver must not be
    // worse than that when driven the same way.
    expect(Math.abs(worst.frames), `worst drift at "${worst.label}"`).toBeLessThan(1e-9);
  });

  it("writes the exact fractional tempo on the train chase", () => {
    const fit = solve(SECTIONS.find((s) => s.label === "the train")!);
    expect(fit.best!.bpm).toBe(fit.best!.exactBpm);
    expect(Number.isInteger(fit.best!.bpm)).toBe(false);
  });
});

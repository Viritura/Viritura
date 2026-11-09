import { describe, it, expect } from "vitest";
import { generateTimeline } from "@viritura/midi";
import type { Score } from "@viritura/core";
import { buildClickTrack, countInLeadSeconds } from "./clickTrack";

/** Minimal 2-measure 4/4 score at 120 BPM with a single whole-note part. */
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] }, {}],
    },
    parts: [
      {
        id: "P1",
        measures: [
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
              },
            ],
          },
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

describe("buildClickTrack", () => {
  it.each(["linear", "early", "late", "smooth"] as const)(
    "follows a native %s ramp and keeps the count-in constant",
    (curve) => {
      const score = makeScore();
      score.global.measures[0]!.id = "m0";
      score.global.measures[0]!.gradualTempo = {
        position: { fraction: [0, 1] },
        end: { measure: "m0", position: { fraction: [1, 1] } },
        endRatio: 0.5,
        curve,
      };
      const timeline = generateTimeline(score);
      const clicks = buildClickTrack(timeline, { countInBeats: 2 });
      expect(clicks.slice(0, 2).map((click) => click.time)).toEqual([-1, -0.5]);
      expect(clicks.slice(2).map((click) => click.time)).toEqual(
        Array.from({ length: 8 }, (_, beat) => timeline.model.timeAtBeat(beat)),
      );
      expect(clicks[5]!.time - clicks[4]!.time).toBeGreaterThan(clicks[3]!.time - clicks[2]!.time);
    },
  );
  it.each([
    { count: 4, unit: 4 },
    { count: 6, unit: 8 },
  ])("does not groove standard clicks/count-in or the playhead clock in $count/$unit", (time) => {
    const score = makeScore();
    score.global.measures[0]!.time = time;
    score.global.measures[0]!.tempos![0]!.swing = {
      mode: "swing",
      subdivision: "16th",
      ratio: [3, 2],
    };
    const swung = generateTimeline(score);
    delete score.global.measures[0]!.tempos![0]!.swing;
    const straight = generateTimeline(score);
    expect(buildClickTrack(swung, { countInBeats: 4 })).toEqual(buildClickTrack(straight, { countInBeats: 4 }));
    expect(countInLeadSeconds(swung, 4)).toBe(countInLeadSeconds(straight, 4));
    for (const beat of [0, 0.25, 0.5, 1, 2.5, 3]) {
      expect(swung.model.timeAtBeat(beat)).toBe(straight.model.timeAtBeat(beat));
      expect(swung.model.beatAtTime(swung.model.timeAtBeat(beat))).toBeCloseTo(beat, 12);
    }
  });
  it("keeps the original beat accents when navigation returns inside a measure", () => {
    const score = makeScore();
    score.global.measures[0]!.segno = { location: { fraction: [1, 4] } };
    score.global.measures[1]!.jump = { type: "segno", location: { fraction: [1, 2] } };
    const timeline = generateTimeline(score);
    const clicks = buildClickTrack(timeline);
    expect(clicks).toHaveLength(13);
    expect(clicks.map((click) => click.time)).toEqual(
      Array.from({ length: 13 }, (_, beat) => timeline.model.timeAtBeat(beat)),
    );
    expect(clicks.filter((click) => click.accented).map((click) => click.time)).toEqual([0, 2, 4.5]);
    expect(clicks[6]!.accented).toBe(false);
  });

  it("emits one click per quarter beat in 4/4, accenting each downbeat", () => {
    const timeline = generateTimeline(makeScore());
    const clicks = buildClickTrack(timeline);

    // 2 bars × 4 quarter clicks = 8 clicks.
    expect(clicks).toHaveLength(8);

    // At 120 BPM a quarter is 0.5s. Clicks fall on 0, 0.5, 1.0, … 3.5s.
    expect(clicks.map((c) => Number(c.time.toFixed(3)))).toEqual([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);

    // Downbeats (bar starts) are accented; the rest are not.
    expect(clicks.map((c) => c.accented)).toEqual([true, false, false, false, true, false, false, false]);
  });

  it("is sorted ascending in time", () => {
    const clicks = buildClickTrack(generateTimeline(makeScore()));
    for (let i = 1; i < clicks.length; i++) {
      expect(clicks[i]!.time).toBeGreaterThanOrEqual(clicks[i - 1]!.time);
    }
  });

  it("returns an empty track for an empty score", () => {
    const empty = generateTimeline({ global: { measures: [] }, parts: [] } as unknown as Score);
    expect(buildClickTrack(empty)).toEqual([]);
  });
});

describe("buildClickTrack — count-in", () => {
  it("prepends count-in clicks at negative times, first accented", () => {
    const timeline = generateTimeline(makeScore());
    const clicks = buildClickTrack(timeline, { countInBeats: 4 });

    // 4 count-in + 8 measure clicks.
    expect(clicks).toHaveLength(12);

    // Count-in at 120 bpm (0.5 s/beat): -2.0, -1.5, -1.0, -0.5; first accented.
    const countIn = clicks.slice(0, 4);
    expect(countIn.map((c) => Number(c.time.toFixed(3)))).toEqual([-2.0, -1.5, -1.0, -0.5]);
    expect(countIn.map((c) => c.accented)).toEqual([true, false, false, false]);

    // The music's first click is still the downbeat at t=0.
    expect(clicks[4]!.time).toBeCloseTo(0, 5);
    expect(clicks[4]!.accented).toBe(true);
  });

  it("countInLeadSeconds is the count-in duration at the opening tempo", () => {
    const timeline = generateTimeline(makeScore());
    // 4 beats × 0.5 s/beat at 120 bpm.
    expect(countInLeadSeconds(timeline, 4)).toBeCloseTo(2.0, 5);
    expect(countInLeadSeconds(timeline, 0)).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { generateTimeline } from "@viritura/midi";
import type { Score } from "@viritura/core";
import { buildClickTrack, countInLeadSeconds } from "./clickTrack";
import { buildClickSessionProgram } from "./clickSession";

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
  it("does not insert a silent count-in when the opening click subdivision is zero", () => {
    const score = makeScore();
    score.global.measures[0]!.tempos![0]!.clickSubdivision = 0;
    const source = { ...generateTimeline(score), globalMeasures: score.global.measures };
    expect(countInLeadSeconds(source)).toBe(0);
    expect(buildClickTrack(source, { countIn: true })).toEqual([]);
  });
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
      const clicks = buildClickTrack(timeline, { countIn: true });
      expect(clicks.slice(0, 4).map((click) => click.time)).toEqual([-2, -1.5, -1, -0.5]);
      clicks.slice(4).forEach((click, beat) => expect(click.time).toBeCloseTo(timeline.model.timeAtBeat(beat), 12));
      expect(clicks[7]!.time - clicks[6]!.time).toBeGreaterThan(clicks[5]!.time - clicks[4]!.time);
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
    expect(buildClickTrack(swung, { countIn: true })).toEqual(buildClickTrack(straight, { countIn: true }));
    expect(countInLeadSeconds(swung)).toBe(countInLeadSeconds(straight));
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
    expect(clicks.filter((click) => click.level === "accent").map((click) => click.time)).toEqual([0, 2, 4.5]);
    expect(clicks[6]!.level).toBe("beat");
  });

  it("emits one click per quarter beat in 4/4, accenting each downbeat", () => {
    const timeline = generateTimeline(makeScore());
    const clicks = buildClickTrack(timeline);

    // 2 bars × 4 quarter clicks = 8 clicks.
    expect(clicks).toHaveLength(8);

    // At 120 BPM a quarter is 0.5s. Clicks fall on 0, 0.5, 1.0, … 3.5s.
    expect(clicks.map((c) => Number(c.time.toFixed(3)))).toEqual([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);

    // Downbeats (bar starts) are accented; the rest are not.
    expect(clicks.map((c) => c.level)).toEqual(["accent", "beat", "beat", "beat", "accent", "beat", "beat", "beat"]);
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

  it("uses 3+2+2+3 in 10/8 for both score clicks and a full-bar count-in", () => {
    const score = makeScore();
    score.global.measures[0]!.time = { count: 10, unit: 8, beatStructure: [3, 2, 2, 3] };
    const source = { ...generateTimeline(score), globalMeasures: score.global.measures };
    const clicks = buildClickTrack(source, { countIn: true });
    expect(clicks.map((click) => click.time)).toEqual([
      -2.5, -1.75, -1.25, -0.75, 0, 0.75, 1.25, 1.75, 2.5, 3.25, 3.75, 4.25,
    ]);
    expect(clicks.filter((click) => click.level === "accent").map((click) => click.time)).toEqual([-2.5, 0, 2.5]);
    expect(countInLeadSeconds(source)).toBe(2.5);
  });

  it("shares Click mode's tempo subdivisions, repeat restoration and fermata clicks", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 2, unit: 4 },
            tempos: [{ bpm: 120, value: { base: "quarter" }, clickSubdivision: 2 }],
            repeatStart: {},
            fermatas: [{ id: "hold", position: { fraction: [1, 4] }, clickBehavior: "keepClicking" }],
          },
          {
            tempos: [{ bpm: 60, value: { base: "quarter" } }],
            repeatEnd: {},
          },
        ],
      },
      parts: [
        {
          id: "P1",
          name: "Rests",
          measures: Array.from({ length: 2 }, () => ({
            sequences: [
              {
                content: Array.from({ length: 2 }, () => ({
                  type: "event" as const,
                  duration: { base: "quarter" as const },
                  rest: {},
                })),
              },
            ],
          })),
        },
      ],
    };
    const source = { ...generateTimeline(score), globalMeasures: score.global.measures };
    const clicks = buildClickTrack(source);
    const program = buildClickSessionProgram(source, { countoff: false });
    expect(clicks).toEqual(program.events);
    expect(clicks.slice(0, 4).map((click) => [click.time, click.level])).toEqual([
      [0, "accent"],
      [0.25, "subdivision"],
      [0.5, "beat"],
      [0.75, "subdivision"],
    ]);
    const holdStart = source.model.timeAtBeat(2, "release");
    const holdEnd = source.model.timeAtBeat(2);
    expect(clicks.some((click) => click.time >= holdStart && click.time < holdEnd)).toBe(true);
    const secondBar = source.measureStartTimes[1]!;
    expect(
      clicks
        .filter((click) => click.time >= secondBar && click.time < source.measureStartTimes[2]!)
        .map((click) => click.level),
    ).toEqual(["accent", "beat"]);
    const repeatStart = source.measureStartTimes[2]!;
    expect(clicks.find((click) => click.time === repeatStart + 0.25)?.level).toBe("subdivision");
  });
});

describe("buildClickTrack — count-in", () => {
  it("prepends count-in clicks at negative times, first accented", () => {
    const timeline = generateTimeline(makeScore());
    const clicks = buildClickTrack(timeline, { countIn: true });

    // 4 count-in + 8 measure clicks.
    expect(clicks).toHaveLength(12);

    // Count-in at 120 bpm (0.5 s/beat): -2.0, -1.5, -1.0, -0.5; first accented.
    const countIn = clicks.slice(0, 4);
    expect(countIn.map((c) => Number(c.time.toFixed(3)))).toEqual([-2.0, -1.5, -1.0, -0.5]);
    expect(countIn.map((c) => c.level)).toEqual(["accent", "beat", "beat", "beat"]);

    // The music's first click is still the downbeat at t=0.
    expect(clicks[4]!.time).toBeCloseTo(0, 5);
    expect(clicks[4]!.level).toBe("accent");
  });

  it("countInLeadSeconds is the count-in duration at the opening tempo", () => {
    const timeline = generateTimeline(makeScore());
    // 4 beats × 0.5 s/beat at 120 bpm.
    expect(countInLeadSeconds(timeline)).toBeCloseTo(2.0, 5);
  });
});

import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import { compilePlaybackTiming } from "@viritura/midi/timing";
import { buildClickSessionProgram } from "@viritura/playback/click";
import rehearsalMarks from "../../../../packages/format/fixtures/mnx/rehearsal-marks.mnx?raw";
import {
  clickBarAtTime,
  clickBarForMeasure,
  clickScorePosition,
  clickStartPosition,
  collectClickBars,
  describeClickBar,
} from "./barNavigation";
import { readClickDocument } from "./clickDocument";

describe("click bar navigation", () => {
  it("loads saved subdivision settings into the activity's program and countoff", () => {
    const document = readClickDocument(
      JSON.stringify({
        mnx: { version: 1 },
        global: {
          measures: [
            {
              time: { count: 4, unit: 4 },
              tempos: [{ bpm: 120, value: { base: "quarter" }, _x: { viritura: { clickSubdivision: 2 } } }],
            },
          ],
        },
        parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
      }),
    );
    const program = buildClickSessionProgram(document.timing);
    expect(program.countoffClicks).toBe(8);
    expect(program.events.map((event) => event.time)).toEqual(Array.from({ length: 16 }, (_, index) => index / 4));
    expect(clickScorePosition(document.timing, program, 2.75, 100)).toEqual({ measureIndex: 0, beat: 1.5 });
  });

  it("plays saved fermatas with the saved tempo subdivision", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            tempos: [{ bpm: 120, value: { base: "quarter" }, clickSubdivision: 3 }],
            fermatas: [{ id: "hold", position: { fraction: [1, 4] }, clickBehavior: "keepClicking" }],
          },
        ],
      },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: Array.from({ length: 4 }, () => ({
                    type: "event" as const,
                    duration: { base: "quarter" as const },
                    rest: {},
                  })),
                },
              ],
            },
          ],
        },
      ],
    };
    const document = readClickDocument(JSON.stringify(serializeMnx(score)));
    const program = buildClickSessionProgram(document.timing, { countoff: false });
    const holdClicks = program.events.filter((event) => event.time >= 1 && event.time < 1.5);
    expect(holdClicks.map((event) => Number(event.time.toFixed(6)))).toEqual([1, 1.166667, 1.333333]);
  });

  it("keeps authored rehearsal marks and context on their score bars", () => {
    const document = readClickDocument(rehearsalMarks);
    expect(document.bars.map((bar) => bar.rehearsal)).toEqual(["A", undefined, "B", "C", "D"]);
    expect(document.bars[1]?.rehearsalContext).toBe("A + 1 bar");
    expect(document.bars[2]?.rehearsalContext).toBe("B");
  });

  it("names visible tempo text changes but not bare metronome marks or gradual changes", () => {
    const tempo = (text: string | undefined, extra: object = {}) => ({
      bpm: 120,
      value: { base: "quarter" },
      ...(text ? { _x: { viritura: { text, ...extra } } } : {}),
    });
    const document = readClickDocument(
      JSON.stringify({
        mnx: { version: 1 },
        global: {
          measures: [
            { time: { count: 4, unit: 4 }, tempos: [tempo("Allegro")] },
            { tempos: [tempo(undefined)] },
            { tempos: [tempo("poco rit.")] },
            { tempos: [{ ...tempo("Più mosso"), location: { fraction: [1, 2] } }] },
            { tempos: [tempo("Hidden", { showText: false })] },
          ],
        },
        parts: [{ measures: Array.from({ length: 5 }, () => ({ sequences: [{ content: [] }] })) }],
      }),
    );
    expect(document.bars.map((bar) => bar.tempoName)).toEqual([
      "Allegro",
      undefined,
      undefined,
      "Più mosso",
      undefined,
    ]);
    expect(document.bars[3]?.tempoNameWithinBar).toBe(true);
  });

  it("distinguishes repeat visits and tracks the selected visit through countoff and tempo scaling", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 2, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }], repeatStart: {} },
          { repeatEnd: {} },
          { time: { count: 3, unit: 4 }, tempos: [{ bpm: 60, value: { base: "quarter" } }] },
        ],
      },
      parts: [],
    };
    const timing = compilePlaybackTiming(score);
    const bars = collectClickBars(score, timing);
    expect(bars.map((bar) => bar.number)).toEqual([1, 2, 1, 2, 3]);
    expect(describeClickBar(bars[2]!)).toBe("Bar 1, visit 2 of 2");
    expect(clickBarForMeasure(bars, 0, 3)).toBe(2);
    expect(clickBarForMeasure(bars, 0, 1)).toBe(0);
    expect(clickBarForMeasure(bars, 99, 0)).toBeUndefined();
    const program = buildClickSessionProgram(timing, { startTimelineMeasure: 2, tempoPercent: 50 });
    expect(program.countoffSeconds).toBe(2);
    expect(clickBarAtTime(timing, program, 0, 50)).toBe(2);
    expect(clickBarAtTime(timing, program, 1.9, 50)).toBe(2);
    expect(clickBarAtTime(timing, program, 3.99, 50)).toBe(2);
    expect(clickBarAtTime(timing, program, 4, 50)).toBe(3);
    expect(clickBarAtTime(timing, program, 6, 50)).toBe(4);
    expect(clickScorePosition(timing, program, 1, 50)).toEqual({ measureIndex: 0, beat: 0 });
    expect(clickScorePosition(timing, program, 3, 50)).toEqual({ measureIndex: 0, beat: 1 });
    expect(clickScorePosition(timing, program, 4.5, 50)).toEqual({ measureIndex: 1, beat: 0.5 });
    expect(clickScorePosition(timing, program, 8, 50)).toEqual({ measureIndex: 2, beat: 1 });
  });

  it("follows a shortened pickup after a full countoff", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ number: 0, time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] }, {}],
      },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                  ],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [
                    { type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const timing = compilePlaybackTiming(score);
    const bars = collectClickBars(score, timing);
    const program = buildClickSessionProgram(timing, { startTimelineMeasure: 0 });
    expect(bars[0]).toMatchObject({ number: 0, startable: true });
    expect(program.countoffSeconds).toBe(2);
    expect(clickBarAtTime(timing, program, 2.49, 100)).toBe(0);
    expect(clickBarAtTime(timing, program, 2.5, 100)).toBe(1);
  });

  it("does not offer an intra-bar jump destination as a bar-boundary start", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 } },
          { segno: { location: { fraction: [1, 4] } } },
          { fine: { location: { fraction: [1, 2] } } },
          { jump: { type: "dsAlFine", location: { fraction: [3, 4] } } },
        ],
      },
      parts: [],
    };
    const timing = compilePlaybackTiming(score);
    const bars = collectClickBars(score, timing);
    const partialIndex = timing.playedSpans!.findIndex((span) => span.startBeat > 0);
    expect(partialIndex).toBeGreaterThanOrEqual(0);
    expect(bars[partialIndex]!.startable).toBe(false);
    const fullVisit = clickBarForMeasure(bars, bars[partialIndex]!.measureIndex, partialIndex);
    expect(fullVisit).not.toBe(partialIndex);
    expect(bars[fullVisit!]!.startable).toBe(true);
    expect(clickBarForMeasure([bars[partialIndex]!], bars[partialIndex]!.measureIndex, 0)).toBeUndefined();
    expect(describeClickBar(bars[partialIndex]!)).toContain("partial visit");
    const program = buildClickSessionProgram(timing, { startTimelineMeasure: 0 });
    const elapsed = program.countoffSeconds + timing.measureStartTimes[partialIndex]! + 0.25;
    expect(clickScorePosition(timing, program, elapsed, 100)).toEqual({
      measureIndex: timing.playedSpans![partialIndex]!.measureIndex,
      beat: timing.playedSpans![partialIndex]!.startBeat + 0.5,
    });
    const restarted = buildClickSessionProgram(timing, { startTimelineMeasure: partialIndex });
    const restartPosition = {
      measureIndex: timing.playedSpans![partialIndex]!.measureIndex,
      beat: timing.playedSpans![partialIndex]!.startBeat,
    };
    expect(clickStartPosition(timing, partialIndex)).toEqual(restartPosition);
    expect(clickScorePosition(timing, restarted, 0, 100)).toEqual(restartPosition);
  });
});

import { describe, expect, it, vi } from "vitest";
import { generateTimeline } from "@viritura/midi";
import { compilePlaybackTiming } from "@viritura/midi/timing";
import type { Score } from "@viritura/core";
import type { ClickEngineEvent, ClickProgramEvent } from "@viritura/audio";
import { buildClickSessionProgram, describeClickCue, ClickSessionTransport, type ClickSessionEngine } from "./index";

type MeasureSpec = { time?: { count: number; unit: number }; bpm?: number };

function timelineFor(measures: MeasureSpec[]) {
  const score = {
    mnx: { version: 1 },
    global: {
      measures: measures.map(({ time, bpm }) => ({
        ...(time ? { time } : {}),
        ...(bpm ? { tempos: [{ bpm, value: { base: "quarter" } }] } : {}),
      })),
    },
    parts: [],
  } as unknown as Score;
  return generateTimeline(score);
}

const times = (events: readonly ClickProgramEvent[]) => events.map((event) => Number(event.time.toFixed(6)));
const levels = (events: readonly ClickProgramEvent[]) => events.map((event) => event.level);

describe("buildClickSessionProgram", () => {
  it.each(["timing", "timeline"] as const)(
    "overrides one grouped bar with six eighths and restores grouping on the next bar using %s",
    (pipeline) => {
      const score: Score = {
        mnx: { version: 1 },
        global: {
          measures: [
            {
              number: 111,
              time: { count: 6, unit: 8 },
              repeatStart: {},
              tempos: [{ bpm: 60, value: { base: "quarter" }, clickSubdivision: 2, clickGrouping: [3, 3, 2, 2, 2] }],
            },
            {
              number: 112,
              systemText: [
                {
                  id: "eighths",
                  text: [{ text: "Click eighths" }],
                  showText: false,
                  position: { fraction: [0, 1] },
                  tempo: { clickSubdivision: 3 },
                },
              ],
            },
            {
              number: 113,
              repeatEnd: {},
              systemText: [
                {
                  id: "restore-grouping",
                  text: [{ text: "Click grouping" }],
                  showText: false,
                  position: { fraction: [0, 1] },
                  tempo: { clickSubdivision: 2, clickGrouping: [3, 3, 2, 2, 2] },
                },
              ],
            },
          ],
        },
        parts: [],
      };
      const timing = pipeline === "timing" ? compilePlaybackTiming(score) : generateTimeline(score);
      const source = { ...timing, globalMeasures: score.global.measures };
      const program = buildClickSessionProgram(source, { countoff: false });
      const groupedOffsets = [0, 0.75, 1.5, 2, 2.5];
      const eighthOffsets = [0, 0.5, 1, 1.5, 2, 2.5];
      expect(times(program.events)).toEqual(
        [groupedOffsets, eighthOffsets, groupedOffsets, groupedOffsets, eighthOffsets, groupedOffsets].flatMap(
          (offsets, bar) => offsets.map((offset) => bar * 3 + offset),
        ),
      );
      expect(buildClickSessionProgram(source, { startMeasure: 1 }).countoffClicks).toBe(6);
      expect(buildClickSessionProgram(source, { startMeasure: 2 }).countoffClicks).toBe(5);
    },
  );

  it("does not replay future positioned click changes in synthetic countoff bars", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 6, unit: 8 },
            systemText: [
              {
                id: "group",
                text: [{ text: "2+3" }],
                position: { fraction: [1, 8] },
                tempo: { clickSubdivision: 2, clickGrouping: [3, 3, 2, 2, 2] },
              },
            ],
          },
        ],
      },
      parts: [],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const program = buildClickSessionProgram(source);
    expect(program.countoffClicks).toBe(2);
    expect(times(program.events)).toEqual([0, 0.75, 1.5, 1.875, 2.25, 2.5, 2.75]);
  });

  it("keeps a positioned grouping anchored to the bar grid and preserves it through a hold", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 6, unit: 8 },
            tempos: [{ bpm: 120, value: { base: "quarter" } }],
            systemText: [
              {
                id: "group",
                text: [{ text: "2+3" }],
                position: { fraction: [1, 8] },
                tempo: { clickSubdivision: 2, clickGrouping: [3, 3, 2, 2, 2] },
              },
            ],
            fermatas: [{ id: "hold", position: { fraction: [0, 1] }, clickBehavior: "keepClicking" }],
          },
        ],
      },
      parts: [
        {
          name: "Rests",
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", duration: { base: "quarter", dots: 1 }, rest: {} },
                    { type: "event", duration: { base: "quarter", dots: 1 }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const program = buildClickSessionProgram(source, { countoff: false });
    const begin = source.model.timeAtBeat(1.5, "release");
    const end = source.model.timeAtBeat(1.5);
    expect(times(program.events.filter((event) => event.time < begin - 1e-9))).toEqual([0, 0.375]);
    const during = program.events.filter((event) => event.time >= begin - 1e-9 && event.time < end - 1e-9);
    expect(times(during)).toEqual([0.75, 1.125, 1.375]);
    expect(levels(during)).toEqual(["subdivision", "beat", "subdivision"]);
  });

  it.each([
    { count: 6, subdivision: 2, unitSeconds: 0.25 },
    { count: 12, subdivision: 1, unitSeconds: 0.5 },
  ] as const)(
    "uses denominator-based grouping in $count/8 for score clicks and countoff",
    ({ count, subdivision, unitSeconds }) => {
      const score: Score = {
        mnx: { version: 1 },
        global: {
          measures: [
            {
              time: { count, unit: 8 },
              tempos: [
                { bpm: 60, value: { base: "quarter" }, clickSubdivision: subdivision, clickGrouping: [3, 3, 2, 2, 2] },
              ],
            },
            {},
          ],
        },
        parts: [],
      };
      const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
      const program = buildClickSessionProgram(source);
      const offsets = [0, 3, 6, 8, 10].map((position) => position * unitSeconds);
      const barSeconds = 12 * unitSeconds;
      expect(program.countoffClicks).toBe(5);
      expect(program.countoffSeconds).toBe(barSeconds);
      expect(times(program.events)).toEqual([0, 1, 2].flatMap((bar) => offsets.map((time) => bar * barSeconds + time)));
      expect(levels(program.events.slice(0, 5))).toEqual(
        count === 6
          ? ["accent", "subdivision", "beat", "subdivision", "subdivision"]
          : ["accent", "beat", "beat", "subdivision", "subdivision"],
      );
      expect(buildClickSessionProgram(source, { startMeasure: 1 }).countoffClicks).toBe(5);
    },
  );

  it("silences a mid-bar rit and keep-clicking hold without changing timing, then resumes regular clicks", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            id: "rit",
            time: { count: 4, unit: 4 },
            tempos: [{ bpm: 120, value: { base: "quarter" }, clickSubdivision: 2 }],
            systemText: [
              {
                id: "free",
                text: [{ text: "Free time" }],
                position: { fraction: [1, 2] },
                tempo: { clickSubdivision: 0 },
              },
            ],
            gradualTempo: {
              position: { fraction: [1, 2] },
              end: { measure: "rit", position: { fraction: [1, 1] } },
              endBpm: 60,
            },
            fermatas: [{ id: "hold", position: { fraction: [3, 4] }, clickBehavior: "keepClicking" }],
          },
          {},
          { tempos: [{ bpm: 120, value: { base: "quarter" } }] },
        ],
      },
      parts: [
        {
          name: "Rests",
          measures: Array.from({ length: 3 }, () => ({
            sequences: [
              {
                content: Array.from({ length: 4 }, () => ({
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
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const program = buildClickSessionProgram(source, { countoff: false, tempoPercent: 50 });
    const resume = source.model.timeAtBeat(source.measureStartBeats[2]!) * 2;
    expect(times(program.events.filter((event) => event.time < resume - 1e-9))).toEqual([0, 0.5, 1, 1.5]);
    expect(program.events.find((event) => event.time >= resume - 1e-9)?.time).toBeCloseTo(resume);
    expect(program.duration).toBeCloseTo(source.duration * 2);
    const silentStart = buildClickSessionProgram(source, { startMeasure: 1 });
    expect(silentStart.countoffClicks).toBe(0);
    expect(silentStart.countoffSeconds).toBe(0);
    const muted = buildClickSessionProgram(source, { resolutions: [{ fromMeasure: 0, subdivision: 0 }] });
    expect(muted.events).toEqual([]);
    expect(muted.duration).toBeCloseTo(source.duration);
  });

  it("uses the written grouping grid through repeats and a partial-bar jump", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 6, unit: 8 },
            tempos: [{ bpm: 60, value: { base: "quarter" }, clickSubdivision: 2, clickGrouping: [3, 3, 2, 2, 2] }],
            repeatStart: {},
            segno: { location: { fraction: [3, 8] } },
          },
          { repeatEnd: {} },
          { fine: { location: { fraction: [3, 8] } } },
          { jump: { type: "dsAlFine", location: { fraction: [3, 4] } } },
        ],
      },
      parts: [],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const visit = source.playedSpans!.findIndex((span) => span.measureIndex === 0 && span.startBeat === 1.5);
    expect(visit).toBeGreaterThan(0);
    const repeated = buildClickSessionProgram(source, { countoff: false });
    expect(times(repeated.events.slice(0, 15))).toEqual([
      0, 0.75, 1.5, 2, 2.5, 3, 3.75, 4.5, 5, 5.5, 6, 6.75, 7.5, 8, 8.5,
    ]);
    const program = buildClickSessionProgram(source, { startTimelineMeasure: visit, countoff: false });
    expect(times(program.events.slice(0, 3))).toEqual([0, 0.5, 1]);
    expect(levels(program.events.slice(0, 3))).toEqual(["beat", "subdivision", "subdivision"]);
    expect(buildClickSessionProgram(source, { startTimelineMeasure: visit }).countoffClicks).toBe(5);
  });

  it.each(["silent", "keepClicking"] as const)(
    "keeps coincident hold policies separate from each other and a caesura (%s first)",
    (firstPolicy) => {
      const score: Score = {
        mnx: { version: 1 },
        global: {
          measures: [
            {
              time: { count: 4, unit: 4 },
              tempos: [{ bpm: 120, value: { base: "quarter" } }],
              fermatas: [
                { id: "first", position: { fraction: [0, 1] }, clickBehavior: firstPolicy },
                { id: "second", position: { fraction: [1, 4] }, clickBehavior: "keepClicking" },
              ],
              caesura: {},
            },
            {},
          ],
        },
        parts: [
          {
            name: "Rest",
            measures: Array.from({ length: 2 }, () => ({
              sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" as const } } }],
            })),
          },
        ],
      };
      const timeline = generateTimeline(score);
      const program = buildClickSessionProgram(timeline, { countoff: false });
      const begin = timeline.model.timeAtBeat(4, "release");
      const resume = timeline.model.timeAtBeat(4);
      expect(resume).toBeCloseTo(6.5);
      const during = program.events.filter((event) => event.time >= begin && event.time < resume);
      expect(times(during)).toEqual(firstPolicy === "silent" ? [4, 4.5, 5, 5.5] : [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]);
    },
  );
  it.each(["silent", "keepClicking"] as const)(
    "honors %s global holds through a ritardando and session tempo scaling",
    (clickBehavior) => {
      const score: Score = {
        mnx: { version: 1 },
        global: {
          measures: [
            {
              id: "rit",
              time: { count: 4, unit: 4 },
              tempos: [{ bpm: 120, value: { base: "quarter" } }],
              gradualTempo: {
                position: { fraction: [0, 1] },
                end: { measure: "rit", position: { fraction: [1, 1] } },
                endBpm: 60,
              },
              fermatas: [{ id: "hold", position: { fraction: [3, 4] }, clickBehavior }],
            },
            {},
          ],
        },
        parts: [
          {
            name: "Silent staff",
            measures: [
              {
                sequences: [
                  {
                    content: [
                      { type: "event", duration: { base: "half", dots: 1 }, rest: {} },
                      { type: "event", duration: { base: "quarter" }, rest: {} },
                    ],
                  },
                ],
              },
              { sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] },
            ],
          },
        ],
      };
      const timeline = generateTimeline(score);
      const program = buildClickSessionProgram(timeline, { countoff: false, tempoPercent: 50 });
      const begin = timeline.model.timeAtBeat(4, "release") * 2;
      const resume = timeline.model.timeAtBeat(4) * 2;
      expect(resume - begin).toBeCloseTo(2);
      const during = program.events.filter((event) => event.time >= begin - 1e-9 && event.time < resume - 1e-9);
      expect(during).toHaveLength(clickBehavior === "silent" ? 0 : 1);
      if (clickBehavior === "keepClicking") expect(during[0]!.time).toBeCloseTo(begin);
      expect(program.events.some((event) => Math.abs(event.time - resume) < 1e-9)).toBe(true);
    },
  );
  it.each(["timing", "timeline"] as const)(
    "keeps the active tempo subdivision through a fermata using %s",
    (pipeline) => {
      const score: Score = {
        mnx: { version: 1 },
        global: {
          measures: [
            {
              time: { count: 4, unit: 4 },
              tempos: [{ bpm: 120, value: { base: "quarter" }, clickSubdivision: 2 }],
              systemText: [
                {
                  id: "triplets",
                  text: [{ text: "Triplets" }],
                  position: { fraction: [1, 4] },
                  tempo: { clickSubdivision: 3 },
                },
              ],
              fermatas: [{ id: "hold", position: { fraction: [1, 4] }, clickBehavior: "keepClicking" }],
            },
          ],
        },
        parts: [
          {
            name: "Rests",
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
      const timing = pipeline === "timing" ? compilePlaybackTiming(score) : generateTimeline(score);
      const source = { ...timing, globalMeasures: score.global.measures };
      const begin = source.model.timeAtBeat(2, "release") * 2;
      const end = source.model.timeAtBeat(2) * 2;
      const clicks = (resolutions?: { fromMeasure: number; subdivision: number }[]) =>
        buildClickSessionProgram(source, { countoff: false, tempoPercent: 50, resolutions }).events.filter(
          (event) => event.time >= begin - 1e-9 && event.time < end - 1e-9,
        );
      expect(times(clicks())).toEqual([2, 2.333333, 2.666667]);
      expect(levels(clicks())).toEqual(["beat", "subdivision", "subdivision"]);
      expect(times(clicks([{ fromMeasure: 0, subdivision: 4 }]))).toEqual([2, 2.25, 2.5, 2.75]);
    },
  );
  it("uses the new tempo's default subdivision when a hold begins at a tempo boundary", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            tempos: [{ bpm: 120, value: { base: "quarter" }, clickSubdivision: 3 }],
            fermatas: [{ id: "hold", position: { fraction: [3, 4] }, clickBehavior: "keepClicking" }],
          },
          { tempos: [{ bpm: 120, value: { base: "quarter" } }] },
        ],
      },
      parts: [
        {
          name: "Rests",
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
            { sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] },
          ],
        },
      ],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const begin = source.model.timeAtBeat(4, "release");
    const end = source.model.timeAtBeat(4);
    const during = buildClickSessionProgram(source, { countoff: false }).events.filter(
      (event) => event.time >= begin - 1e-9 && event.time < end - 1e-9,
    );
    expect(times(during)).toEqual([2]);
  });
  it("uses the written subdivision within a partial-bar jump destination", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
          {
            segno: { location: { fraction: [1, 4] } },
            systemText: [
              {
                id: "quintuplets",
                text: [{ text: "Quintuplets" }],
                position: { fraction: [5, 8] },
                tempo: { clickSubdivision: 5 },
              },
            ],
            fermatas: [{ id: "hold", position: { fraction: [1, 2] }, clickBehavior: "keepClicking" }],
          },
          { fine: { location: { fraction: [1, 2] } } },
          { jump: { type: "dsAlFine", location: { fraction: [3, 4] } } },
        ],
      },
      parts: [
        {
          name: "Rests",
          measures: Array.from({ length: 4 }, () => ({
            sequences: [
              {
                content: Array.from({ length: 4 }, () => ({
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
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const index = source.playedSpans!.findIndex((span) => span.measureIndex === 1 && span.startBeat === 1);
    expect(index).toBeGreaterThan(0);
    const holdBeat = source.measureStartBeats[index]! + 2;
    const begin = source.model.timeAtBeat(holdBeat, "release");
    const end = source.model.timeAtBeat(holdBeat);
    const program = buildClickSessionProgram(source, { startTimelineMeasure: index, countoff: false });
    const start = source.model.timeAtBeat(source.measureStartBeats[index]!);
    const during = program.events.filter(
      (event) => event.time >= begin - start - 1e-9 && event.time < end - start - 1e-9,
    );
    expect(during).toHaveLength(5);
    expect(during.map((event) => Number((event.time - (begin - start)).toFixed(6)))).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });
  it("counts off one fresh bar in the start bar's meter and tempo, not a replay of the previous bar", () => {
    const timeline = timelineFor([
      { time: { count: 4, unit: 4 }, bpm: 60 },
      { time: { count: 5, unit: 8 }, bpm: 120 },
    ]);
    const program = buildClickSessionProgram(timeline, { startMeasure: 1 });

    expect(program.countoffClicks).toBe(2);
    expect(program.countoffSeconds).toBeCloseTo(1.25);
    expect(program.startBpm).toBeCloseTo(120);
    expect(times(program.events)).toEqual([0, 0.75, 1.25, 2]);
    expect(levels(program.events)).toEqual(["accent", "beat", "accent", "beat"]);
    expect(program.duration).toBe(2.5);
  });

  it("scales the whole take, countoff included, by the session tempo percentage", () => {
    const timeline = timelineFor([{ time: { count: 2, unit: 4 }, bpm: 120 }, { bpm: 60 }]);
    const program = buildClickSessionProgram(timeline, { tempoPercent: 50 });

    expect(program.startBpm).toBeCloseTo(60);
    // Countoff 2×1 s, bar 1 at 60 BPM (1 s beats), bar 2 at 30 BPM (2 s beats).
    expect(times(program.events)).toEqual([0, 1, 2, 3, 4, 6]);
  });

  it("counts off two complete bars with an accent on each downbeat", () => {
    const timeline = timelineFor([{ time: { count: 4, unit: 4 }, bpm: 120 }]);
    const program = buildClickSessionProgram(timeline, { countoffBars: 2 });
    expect(program.countoffClicks).toBe(8);
    expect(program.countoffSeconds).toBe(4);
    expect(program.duration).toBe(6);
    expect(times(program.events)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]);
    expect(program.events.filter((event) => event.level === "accent").map((event) => event.time)).toEqual([0, 2, 4]);
    const without = buildClickSessionProgram(timeline, { countoff: false, countoffBars: 2 });
    expect(without.countoffClicks).toBe(0);
    expect(without.duration).toBe(2);
  });

  it("uses the authored beat groups and session tempo for both countoff bars", () => {
    const timeline = timelineFor([{ time: { count: 7, unit: 8 }, bpm: 120 }]);
    timeline.measureTimeSignatures[0]!.beatStructure = [2, 3, 2];
    const program = buildClickSessionProgram(timeline, { countoffBars: 2, tempoPercent: 50 });
    expect(program.countoffClicks).toBe(6);
    expect(program.countoffSeconds).toBe(7);
    expect(program.duration).toBe(10.5);
    expect(times(program.events)).toEqual([0, 1, 2.5, 3.5, 4.5, 6, 7, 8, 9.5]);
  });

  it("applies each resolution rule from its measure onward", () => {
    const timeline = timelineFor([{ time: { count: 2, unit: 4 }, bpm: 120 }, {}, {}]);
    const program = buildClickSessionProgram(timeline, {
      countoff: false,
      resolutions: [
        { fromMeasure: 2, subdivision: 1 },
        { fromMeasure: 1, subdivision: 3 },
      ],
    });

    expect(times(program.events)).toEqual([0, 0.5, 1, 1.166667, 1.333333, 1.5, 1.666667, 1.833333, 2, 2.5]);
    expect(levels(program.events).slice(2, 8)).toEqual([
      "accent",
      "subdivision",
      "subdivision",
      "beat",
      "subdivision",
      "subdivision",
    ]);
  });

  it("resets subdivisions to 1 at each tempo without its own setting and counts every countoff tick", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 2, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" }, clickSubdivision: 2 }] },
          { tempos: [{ bpm: 60, value: { base: "quarter" } }] },
          {},
        ],
      },
      parts: [],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const program = buildClickSessionProgram(source, { startMeasure: 1 });
    expect(program.countoffClicks).toBe(2);
    expect(program.countoffSeconds).toBe(2);
    expect(times(program.events)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(times(buildClickSessionProgram(source, { countoff: false }).events.slice(0, 5))).toEqual([
      0, 0.25, 0.5, 0.75, 1,
    ]);
  });

  it("resets to one click per beat at an explicit mid-tempo instruction but not at swing-only text", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 2, unit: 4 },
            tempos: [{ bpm: 60, value: { base: "quarter" }, clickSubdivision: 2 }],
            systemText: [
              {
                id: "swing",
                text: [{ text: "Swing" }],
                position: { fraction: [1, 4] },
                tempo: { swing: { mode: "swing", subdivision: "eighth", ratio: [2, 1] } },
              },
            ],
          },
          {
            systemText: [
              {
                id: "reset",
                text: [{ text: "Quarters" }],
                position: { fraction: [1, 4] },
                tempo: { clickSubdivision: 1 },
              },
            ],
          },
        ],
      },
      parts: [],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    expect(times(buildClickSessionProgram(source, { countoff: false }).events)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });

  it("changes subdivisions inside a grouped beat exactly once without interrupting a tempo ramp", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 2, unit: 4 },
            tempos: [{ bpm: 120, value: { base: "quarter" }, clickSubdivision: 2 }],
            gradualTempo: {
              position: { fraction: [0, 1] },
              end: { measure: "1", position: { fraction: [0, 1] } },
              endBpm: 60,
            },
            systemText: [
              {
                id: "subdivision",
                text: [{ text: "Click triplets" }],
                position: { fraction: [1, 8] },
                tempo: { clickSubdivision: 3 },
              },
            ],
          },
          {},
        ],
      },
      parts: [],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const program = buildClickSessionProgram(source, { countoff: false });
    const beats = [0, 0.5, 5 / 6, 1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3, 3, 10 / 3, 11 / 3];
    expect(program.events.map((event) => event.time)).toEqual(beats.map((beat) => source.model.timeAtBeat(beat)));
    expect(program.events.filter((event) => event.time === source.model.timeAtBeat(0.5))).toHaveLength(1);
    expect(program.events[1]!.level).toBe("subdivision");
    const intervals = program.events.slice(4, 6).map((event, index) => event.time - program.events[index + 3]!.time);
    expect(intervals[1]).toBeGreaterThan(intervals[0]!);
  });

  it("uses each repeated destination's written subdivision rather than carrying the previous pass's setting", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 1, unit: 4 }, tempos: [{ bpm: 60, value: { base: "quarter" } }], repeatStart: {} },
          { tempos: [{ bpm: 60, value: { base: "quarter" }, clickSubdivision: 2 }], repeatEnd: {} },
        ],
      },
      parts: [],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const program = buildClickSessionProgram(source, { countoff: false });
    expect(times(program.events)).toEqual([0, 1, 1.5, 2, 3, 3.5]);
    expect(buildClickSessionProgram(source, { startTimelineMeasure: 2 }).countoffClicks).toBe(1);
  });

  it("subdivides authored compound meter groups by five and applies tempo percentage to all ticks", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 6, unit: 8 },
            tempos: [{ bpm: 120, value: { base: "quarter" }, clickSubdivision: 5 }],
          },
        ],
      },
      parts: [],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const program = buildClickSessionProgram(source, { tempoPercent: 50 });
    expect(program.countoffClicks).toBe(10);
    expect(program.countoffSeconds).toBe(3);
    expect(times(program.events)).toEqual(Array.from({ length: 20 }, (_, index) => Number((index * 0.3).toFixed(6))));
    expect(program.events.filter((event) => event.level === "accent")).toHaveLength(2);
  });

  it("restores inherited subdivisions at an intra-bar jump destination", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
          {
            segno: { location: { fraction: [1, 4] } },
            systemText: [
              {
                id: "triplets",
                text: [{ text: "Click triplets" }],
                position: { fraction: [1, 8] },
                tempo: { clickSubdivision: 3 },
              },
            ],
          },
          { fine: { location: { fraction: [1, 2] } } },
          {
            jump: { type: "dsAlFine", location: { fraction: [3, 4] } },
            tempos: [{ bpm: 120, value: { base: "quarter" }, clickSubdivision: 5 }],
          },
        ],
      },
      parts: [],
    };
    const source = { ...compilePlaybackTiming(score), globalMeasures: score.global.measures };
    const partialIndex = source.playedSpans!.findIndex((span) => span.startBeat > 0);
    expect(partialIndex).toBeGreaterThan(0);
    const program = buildClickSessionProgram(source, { startTimelineMeasure: partialIndex });
    expect(program.countoffClicks).toBe(12);
    expect(times(program.events.slice(12, 15))).toEqual([2, 2.166667, 2.333333]);
  });

  it("subdivides compound beats across the full dotted-quarter pulse", () => {
    const timeline = timelineFor([{ time: { count: 6, unit: 8 }, bpm: 120 }]);
    const program = buildClickSessionProgram(timeline, {
      countoff: false,
      resolutions: [{ fromMeasure: 0, subdivision: 3 }],
    });

    expect(times(program.events)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25]);
    expect(levels(program.events)).toEqual([
      "accent",
      "subdivision",
      "subdivision",
      "beat",
      "subdivision",
      "subdivision",
    ]);
  });

  it("rejects invalid tempo percentages, subdivisions, and unperformed start bars", () => {
    const timeline = timelineFor([{ time: { count: 4, unit: 4 }, bpm: 120 }]);
    expect(() => buildClickSessionProgram(timeline, { tempoPercent: 0 })).toThrow(RangeError);
    expect(() => buildClickSessionProgram(timeline, { resolutions: [{ fromMeasure: 0, subdivision: 1.5 }] })).toThrow(
      RangeError,
    );
    expect(() => buildClickSessionProgram(timeline, { startMeasure: 4 })).toThrow(RangeError);
  });

  it("uses authored irregular beat groups for both countoff and subdivided playback", () => {
    const timeline = timelineFor([{ time: { count: 7, unit: 8 }, bpm: 120 }]);
    timeline.measureTimeSignatures[0]!.beatStructure = [2, 3, 2];
    const program = buildClickSessionProgram(timeline, {
      resolutions: [{ fromMeasure: 0, subdivision: 2 }],
    });
    expect(program.countoffClicks).toBe(6);
    expect(program.countoffSeconds).toBe(1.75);
    expect(program.duration).toBe(3.5);
    expect(times(program.events)).toEqual([0, 0.25, 0.5, 0.875, 1.25, 1.5, 1.75, 2, 2.25, 2.625, 3, 3.25]);
  });

  it("starts at the explicitly selected repeat visit with its own countoff", () => {
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
    const timeline = generateTimeline(score);
    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0, 1, 2]);
    const program = buildClickSessionProgram(timeline, { startTimelineMeasure: 2 });
    expect(program.startTimelineMeasure).toBe(2);
    expect(program.countoffSeconds).toBe(1);
    expect(program.duration).toBe(6);
    expect(times(program.events)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5]);
    const later = buildClickSessionProgram(timeline, { startTimelineMeasure: 4 });
    expect(later.countoffClicks).toBe(3);
    expect(later.countoffSeconds).toBe(3);
    expect(later.startBpm).toBe(60);
    expect(times(later.events)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(() => buildClickSessionProgram(timeline, { startTimelineMeasure: 5 })).toThrow(RangeError);
    expect(() => buildClickSessionProgram(timeline, { startTimelineMeasure: 1.5 })).toThrow(RangeError);
    expect(() => buildClickSessionProgram(timeline, { startMeasure: 0, startTimelineMeasure: 2 })).toThrow(RangeError);
  });
});

describe("describeClickCue", () => {
  it("states where the take starts and how many countoff clicks precede it", () => {
    expect(describeClickCue({ rehearsal: "O", measureNumber: 112, countoffClicks: 4 })).toBe(
      "Rehearsal O, 4 clicks free",
    );
    expect(describeClickCue({ measureNumber: 37, countoffClicks: 1 })).toBe("Bar 37, 1 click free");
    expect(describeClickCue({ rehearsal: " ", measureNumber: 9, countoffClicks: 0 })).toBe("Bar 9, no countoff");
  });
});

describe("ClickSessionTransport", () => {
  function fakeEngine() {
    let listener: ((event: ClickEngineEvent) => void) | undefined;
    const engine = {
      load: vi.fn(async (events: readonly ClickProgramEvent[]) => events.length),
      start: vi.fn(async () => ({ contextTime: 1 })),
      stop: vi.fn(async () => 2.5),
      dispose: vi.fn(async () => {}),
      onEvent: vi.fn((next: (event: ClickEngineEvent) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    } satisfies ClickSessionEngine;
    return { engine, emit: (event: ClickEngineEvent) => listener?.(event) };
  }

  it("releases score audio before loading, restarts with the countoff, and resumes without one", async () => {
    const { engine, emit } = fakeEngine();
    const order: string[] = [];
    const releaseScoreAudio = vi.fn(async () => {
      order.push("release");
    });
    engine.load.mockImplementation(async (events) => {
      order.push("load");
      return events.length;
    });
    const transport = new ClickSessionTransport({ releaseScoreAudio, createEngine: async () => engine });
    const program = buildClickSessionProgram(timelineFor([{ time: { count: 4, unit: 4 }, bpm: 120 }]));

    await expect(transport.play()).rejects.toThrow("Prepare");
    await transport.prepare(program);
    expect(order).toEqual(["release", "load"]);
    expect(engine.load).toHaveBeenCalledWith(program.events, program.duration);

    await transport.play();
    expect(engine.start).toHaveBeenLastCalledWith(0);
    await transport.pause();
    expect(transport.status).toBe("paused");
    await transport.resume();
    expect(engine.start).toHaveBeenLastCalledWith(2.5);

    await transport.play();
    expect(engine.stop).toHaveBeenCalledTimes(2);
    expect(engine.start).toHaveBeenLastCalledWith(0);
    emit({ type: "ended" });
    expect(transport.status).toBe("ready");

    await transport.dispose();
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(transport.status).toBe("idle");
  });
});

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

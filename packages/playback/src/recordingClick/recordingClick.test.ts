import { describe, expect, it, vi } from "vitest";
import { generateTimeline } from "@viritura/midi";
import type { Score } from "@viritura/core";
import type { ClickEngineEvent, ClickProgramEvent } from "@viritura/audio";
import {
  buildRecordingClickProgram,
  describeRecordingCue,
  RecordingClickTransport,
  type RecordingClickEngine,
} from "./index";

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

describe("buildRecordingClickProgram", () => {
  it("counts off one fresh bar in the start bar's meter and tempo, not a replay of the previous bar", () => {
    const timeline = timelineFor([
      { time: { count: 4, unit: 4 }, bpm: 60 },
      { time: { count: 5, unit: 8 }, bpm: 120 },
    ]);
    const program = buildRecordingClickProgram(timeline, { startMeasure: 1 });

    expect(program.countoffClicks).toBe(5);
    expect(program.countoffSeconds).toBeCloseTo(1.25);
    expect(program.startBpm).toBeCloseTo(120);
    expect(times(program.events)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25]);
    expect(levels(program.events).slice(0, 6)).toEqual(["accent", "beat", "beat", "beat", "beat", "accent"]);
  });

  it("scales the whole take, countoff included, by the session tempo percentage", () => {
    const timeline = timelineFor([{ time: { count: 2, unit: 4 }, bpm: 120 }, { bpm: 60 }]);
    const program = buildRecordingClickProgram(timeline, { tempoPercent: 50 });

    expect(program.startBpm).toBeCloseTo(60);
    // Countoff 2×1 s, bar 1 at 60 BPM (1 s beats), bar 2 at 30 BPM (2 s beats).
    expect(times(program.events)).toEqual([0, 1, 2, 3, 4, 6]);
  });

  it("applies each resolution rule from its measure onward", () => {
    const timeline = timelineFor([{ time: { count: 2, unit: 4 }, bpm: 120 }, {}, {}]);
    const program = buildRecordingClickProgram(timeline, {
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

  it("subdivides compound beats across the full dotted-quarter pulse", () => {
    const timeline = timelineFor([{ time: { count: 6, unit: 8 }, bpm: 120 }]);
    const program = buildRecordingClickProgram(timeline, {
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
    expect(() => buildRecordingClickProgram(timeline, { tempoPercent: 0 })).toThrow(RangeError);
    expect(() => buildRecordingClickProgram(timeline, { resolutions: [{ fromMeasure: 0, subdivision: 1.5 }] })).toThrow(
      RangeError,
    );
    expect(() => buildRecordingClickProgram(timeline, { startMeasure: 4 })).toThrow(RangeError);
  });
});

describe("describeRecordingCue", () => {
  it("states where the take starts and how many countoff clicks precede it", () => {
    expect(describeRecordingCue({ rehearsal: "O", measureNumber: 112, countoffClicks: 4 })).toBe(
      "Rehearsal O, 4 clicks free",
    );
    expect(describeRecordingCue({ measureNumber: 37, countoffClicks: 1 })).toBe("Bar 37, 1 click free");
    expect(describeRecordingCue({ rehearsal: " ", measureNumber: 9, countoffClicks: 0 })).toBe("Bar 9, no countoff");
  });
});

describe("RecordingClickTransport", () => {
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
    } satisfies RecordingClickEngine;
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
    const transport = new RecordingClickTransport({ releaseScoreAudio, createEngine: async () => engine });
    const program = buildRecordingClickProgram(timelineFor([{ time: { count: 4, unit: 4 }, bpm: 120 }]));

    await expect(transport.play()).rejects.toThrow("Prepare");
    await transport.prepare(program);
    expect(order).toEqual(["release", "load"]);
    expect(engine.load).toHaveBeenCalledWith(program.events);

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

import { describe, expect, it } from "vitest";
import type { NoteEvent, Score, Tempo } from "@viritura/core";
import { DEFAULT_BPM, generateTimeline, generatePerformanceEvents } from "../index";

function wholeNoteScore(measures: Score["global"]["measures"]): Score {
  return {
    mnx: { version: 1 },
    global: { measures },
    parts: [
      {
        id: "p",
        measures: measures.map((_, index) => ({
          sequences: [
            {
              content: [
                {
                  type: "event",
                  id: `e${index}`,
                  duration: { base: "whole" },
                  notes: [{ id: `n${index}`, pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
          ],
        })),
      },
    ],
  };
}

function navigationScore(): Score {
  const note = (measure: number, beat: number): NoteEvent => ({
    id: `e${measure}-${beat}`,
    type: "event",
    duration: { base: "quarter" },
    notes: [{ id: `n${measure}-${beat}`, pitch: { step: "C", octave: 4 } }],
  });
  const score: Score = {
    mnx: { version: 1 },
    global: {
      measures: [
        { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
        { segno: { location: { fraction: [1, 4] } } },
        { fine: { location: { fraction: [1, 2] } } },
        {},
      ],
    },
    parts: [
      {
        id: "p",
        name: "Part",
        measures: Array.from({ length: 4 }, (_, measure) => ({
          sequences: [{ content: Array.from({ length: 4 }, (_, beat) => note(measure, beat)) }],
        })),
      },
    ],
  };
  score.global.measures[3]!.jump = {
    type: "dsAlFine",
    location: { fraction: [3, 4] },
  };
  return score;
}

describe("location-aware navigation timing", () => {
  it.each<{ initial: Tempo[] | undefined; bpm: number }>([
    { initial: undefined, bpm: DEFAULT_BPM },
    { initial: [{ bpm: 90, value: { base: "quarter" } }], bpm: 90 },
    { initial: [{ bpm: 80, value: { base: "quarter", dots: 1 } }], bpm: 120 },
  ])("restores the opening tempo $bpm on D.C. replay", ({ initial, bpm }) => {
    const score = wholeNoteScore([
      { time: { count: 4, unit: 4 }, tempos: initial, fine: { location: { fraction: [1, 1] } } },
      { tempos: [{ bpm: 60, value: { base: "quarter" } }] },
      { jump: { type: "dcAlFine", location: { fraction: [1, 1] } } },
    ]);
    const timeline = generateTimeline(score);
    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 2, 0]);
    expect(timeline.model.bpmAtBeat(timeline.measureStartBeats[3]!)).toBe(bpm);
    expect(timeline.duration).toBeCloseTo(8 + (8 * 60) / bpm);
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    expect(native.at(-1)!.note.duration).toBeCloseTo((4 * 60) / bpm);
  });

  it("restores the implicit tempo before the opening measure's first mid-bar marking", () => {
    const score = wholeNoteScore([
      {
        time: { count: 4, unit: 4 },
        tempos: [{ bpm: 60, value: { base: "quarter" }, location: { fraction: [1, 2] } }],
        fine: { location: { fraction: [1, 4] } },
      },
      {},
      { jump: { type: "dcAlFine", location: { fraction: [1, 1] } } },
    ]);
    const timeline = generateTimeline(score);
    expect(timeline.model.bpmAtBeat(timeline.measureStartBeats[3]!)).toBe(DEFAULT_BPM);
    expect(timeline.duration).toBeCloseTo(11.5);
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    expect(native.at(-1)!.note.duration).toBeCloseTo(0.5);
  });

  it("exports every played mid-bar tempo change on the same axis as the tempo model", () => {
    const score = wholeNoteScore([
      {
        time: { count: 4, unit: 4 },
        tempos: [
          { bpm: 120, value: { base: "quarter" } },
          { bpm: 60, value: { base: "quarter" }, location: { fraction: [1, 2] } },
        ],
        fine: { location: { fraction: [1, 1] } },
      },
      { jump: { type: "dcAlFine", location: { fraction: [1, 1] } } },
    ]);
    const timeline = generateTimeline(score);
    expect(
      timeline.tempoMap.map(({ measureIndex, beatInMeasure, timeSeconds, bpm }) => [
        measureIndex,
        beatInMeasure,
        timeSeconds,
        bpm,
      ]),
    ).toEqual([
      [0, 0, 0, 120],
      [0, 2, 1, 60],
      [1, 0, 3, 60],
      [2, 0, 7, 120],
      [2, 2, 8, 60],
    ]);
    for (const entry of timeline.tempoMap) {
      const beat = timeline.measureStartBeats[entry.measureIndex]! + entry.beatInMeasure;
      expect(entry.timeSeconds).toBeCloseTo(timeline.model.timeAtBeat(beat));
      expect(entry.bpm).toBe(timeline.model.bpmAtBeat(beat));
    }
  });

  it("rebases destination tempo offsets and excludes changes at jump and Fine cuts", () => {
    const score = navigationScore();
    score.global.measures[1]!.tempos = [
      { bpm: 90, value: { base: "quarter" }, location: { fraction: [1, 4] } },
      { bpm: 80, value: { base: "quarter" }, location: { fraction: [3, 8] } },
      { bpm: 70, value: { base: "quarter" }, location: { fraction: [7, 8] } },
    ];
    score.global.measures[2]!.tempos = [{ bpm: 60, value: { base: "quarter" }, location: { fraction: [1, 2] } }];
    score.global.measures[3]!.tempos = [{ bpm: 30, value: { base: "quarter" }, location: { fraction: [3, 4] } }];
    const timeline = generateTimeline(score);
    expect(
      timeline.tempoMap.filter((entry) => entry.measureIndex === 4).map((entry) => [entry.beatInMeasure, entry.bpm]),
    ).toEqual([
      [0, 90],
      [0.5, 80],
      [2.5, 70],
    ]);
    expect(timeline.tempoMap.some((entry) => entry.bpm === 30)).toBe(false);
    expect(timeline.tempoMap.filter((entry) => entry.measureIndex === 5).map((entry) => entry.bpm)).toEqual([70]);
    for (const entry of timeline.tempoMap) {
      const beat = timeline.measureStartBeats[entry.measureIndex]! + entry.beatInMeasure;
      expect(entry.timeSeconds).toBeCloseTo(timeline.model.timeAtBeat(beat));
    }
  });

  it.each([undefined, "makeTime", "stealPrevious"] as const)(
    "preserves %s grace notes before a continuous measure downbeat",
    (graceType) => {
      const score = wholeNoteScore([{ time: { count: 4, unit: 4 } }, {}]);
      score.parts[0]!.measures[1]!.sequences[0]!.content.unshift({
        type: "grace",
        graceType,
        content: [
          {
            type: "event",
            id: "grace",
            duration: { base: "eighth" },
            notes: [{ pitch: { step: "D", octave: 4 } }],
          },
        ],
      });
      const normal = generateTimeline(score).events.filter(
        (event) => event.type === "noteOn" && event.scoreEventId === "grace",
      );
      const once = generateTimeline(score, { expandRepeats: false }).events.filter(
        (event) => event.type === "noteOn" && event.scoreEventId === "grace",
      );
      expect(normal).toHaveLength(1);
      expect(normal[0]!.time).toBeCloseTo(once[0]!.time);
      expect(normal[0]!.time).toBeLessThan(2);
    },
  );

  it("keeps grace anticipation across continuous spans but clips it at a replay destination", () => {
    const score = wholeNoteScore([
      { time: { count: 4, unit: 4 }, fine: { location: { fraction: [1, 1] } } },
      { jump: { type: "dcAlFine", location: { fraction: [1, 1] } } },
    ]);
    for (const [index, measure] of score.parts[0]!.measures.entries()) {
      measure.sequences[0]!.content.unshift({
        type: "grace",
        content: [
          {
            type: "event",
            id: `grace-${index}`,
            duration: { base: "eighth" },
            notes: [{ pitch: { step: "D", octave: 4 } }],
          },
        ],
      });
    }
    const timeline = generateTimeline(score);
    const first = timeline.events.filter((event) => event.type === "noteOn" && event.scoreEventId === "grace-0");
    const second = timeline.events.filter((event) => event.type === "noteOn" && event.scoreEventId === "grace-1");
    expect(first).toHaveLength(2);
    expect(first[1]!.time).toBeGreaterThanOrEqual(timeline.measureStartTimes[2]!);
    expect(second).toHaveLength(1);
    expect(second[0]!.time).toBeLessThan(timeline.measureStartTimes[1]!);
    expect(timeline.events.every((event) => event.time <= timeline.duration)).toBe(true);
  });

  it("does not play grace notes whose principal is in a skipped prefix or at a jump cut", () => {
    const score = navigationScore();
    for (const [measureIndex, offset] of [
      [1, 0],
      [3, 3],
    ] as const) {
      score.parts[0]!.measures[measureIndex]!.sequences[0]!.content.splice(offset, 0, {
        type: "grace",
        content: [
          {
            type: "event",
            id: `grace-${measureIndex}`,
            duration: { base: "eighth" },
            notes: [{ pitch: { step: "D", octave: 4 } }],
          },
        ],
      });
    }
    const notes = generateTimeline(score).events.filter((event) => event.type === "noteOn");
    expect(notes.filter((event) => event.scoreEventId === "grace-1")).toHaveLength(1);
    expect(notes.filter((event) => event.scoreEventId === "grace-3")).toHaveLength(0);
  });

  it("retains grace at an interior segno without anticipating before its performed destination", () => {
    const score = navigationScore();
    score.parts[0]!.measures[1]!.sequences[0]!.content.splice(1, 0, {
      type: "grace",
      graceType: "stealPrevious",
      content: [
        {
          type: "event",
          id: "segno-grace",
          duration: { base: "eighth" },
          notes: [{ pitch: { step: "D", octave: 4 } }],
        },
      ],
    });
    const timeline = generateTimeline(score);
    const grace = timeline.events.filter((event) => event.type === "noteOn" && event.scoreEventId === "segno-grace");
    expect(grace).toHaveLength(2);
    expect(grace[0]!.time).toBeLessThan(2.5);
    expect(grace[1]!.time).toBeGreaterThanOrEqual(timeline.measureStartTimes[4]!);
  });

  it("excludes steal-following grace when its shifted principal falls at a jump cut", () => {
    const score = navigationScore();
    score.global.measures[3]!.jump!.location.fraction = [17, 32];
    score.parts[0]!.measures[3]!.sequences[0]!.content.splice(2, 0, {
      type: "grace",
      graceType: "stealFollowing",
      content: [
        {
          type: "event",
          id: "following-grace",
          duration: { base: "eighth" },
          notes: [{ pitch: { step: "D", octave: 4 } }],
        },
      ],
    });
    expect(
      generateTimeline(score).events.filter(
        (event) => event.type === "noteOn" && event.scoreEventId === "following-grace",
      ),
    ).toHaveLength(0);
  });

  it("reattacks a tied destination when its source is outside the performed span", () => {
    const score = navigationScore();
    const content = score.parts[0]!.measures[1]!.sequences[0]!.content;
    const source = content[0];
    if (source?.type !== "event") throw new Error("Expected the first event in the navigation fixture");
    source.notes![0]!.ties = [{ target: "n1-1" }];
    const timeline = generateTimeline(score);
    const reattack = timeline.events.filter((event) => event.type === "noteOn" && event.scoreEventId === "e1-1");
    expect(reattack).toHaveLength(1);
    expect(reattack[0]!.time).toBeCloseTo(7.5, 1);
    const native = generatePerformanceEvents(score, 0).filter(
      (event) => event.kind === "noteOn" && event.note.id === "n1-1",
    );
    expect(native).toHaveLength(1);
    expect(native[0]!.time).toBeCloseTo(7.5);
  });

  it("does not apply relative dynamics in skipped measure prefixes or suffixes", () => {
    const score = navigationScore();
    score.parts[0]!.measures[1]!.dynamics = [
      { id: "played-once", type: "relative", relativeValue: "louder", position: { fraction: [1, 8] } },
    ];
    score.parts[0]!.measures[3]!.dynamics = [
      { id: "never-played", type: "relative", relativeValue: "louder", position: { fraction: [7, 8] } },
    ];
    const onsets = generateTimeline(score).events.filter((event) => event.type === "noteOn");
    const beforeJump = onsets.find((event) => event.scoreEventId === "e1-1")!;
    const replay = onsets.filter((event) => event.scoreEventId === "e1-1")[1]!;
    expect(replay.velocity).toBe(beforeJump.velocity);
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    const previous = native.find((event) => event.note.id === "n3-2")!;
    const repeated = native.filter((event) => event.note.id === "n1-1")[1]!;
    expect(repeated.note.dynamics).toBe(previous.note.dynamics);
  });

  it("does not carry techniques from unperformed material into the replay", () => {
    const score = navigationScore();
    score.parts[0]!.measures[1]!.expressions = [{ position: { fraction: [1, 8] }, text: [{ text: "pizz." }] }];
    score.parts[0]!.measures[2]!.expressions = [{ position: { fraction: [0, 1] }, text: [{ text: "arco" }] }];
    score.parts[0]!.measures[3]!.expressions = [{ position: { fraction: [7, 8] }, text: [{ text: "pizz." }] }];
    const notes = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    const initial = notes.filter((event) => event.note.id === "n1-1")[0]!;
    const repeated = notes.filter((event) => event.note.id === "n1-1")[1]!;
    expect(initial.note.state.pizzicato).toBe(true);
    expect(repeated.note.state.pizzicato).toBe(false);
  });

  it("clips a sounding note at a mid-measure jump instead of leaking into replay", () => {
    const score = navigationScore();
    score.parts[0]!.measures[3]!.sequences[0]!.content = [
      {
        id: "long",
        type: "event",
        duration: { base: "whole" },
        notes: [{ id: "long-note", pitch: { step: "G", octave: 4 } }],
      },
    ];
    const timeline = generateTimeline(score);
    const onset = timeline.events.find((event) => event.type === "noteOn" && event.scoreEventId === "long");
    expect(onset).toBeDefined();
    const release = timeline.events.find(
      (event) => event.type === "noteOff" && event.midiNote === onset!.midiNote && event.time > onset!.time,
    );
    expect(release?.time).toBeCloseTo(7.5);
    const native = generatePerformanceEvents(score, 0).find(
      (event) => event.kind === "noteOn" && event.note.id === "long-note",
    );
    expect(native?.kind === "noteOn" && native.note.duration).toBeCloseTo(1.5);
  });

  it("restores destination tempo after replaying an earlier score position", () => {
    const score = navigationScore();
    score.global.measures[2]!.tempos = [{ bpm: 60, value: { base: "quarter" } }];
    const timeline = generateTimeline(score);
    expect(timeline.duration).toBeCloseTo(14.5);
    const replayStart = timeline.measureStartBeats[4]!;
    expect(timeline.model.bpmAtBeat(replayStart)).toBe(120);
    expect(timeline.model.bpmAtBeat(timeline.measureStartBeats[5]!)).toBe(60);
  });

  it("plays only the selected measure spans with consistent MIDI and performance duration", () => {
    const score = navigationScore();
    const timeline = generateTimeline(score);
    expect(timeline.totalBeats).toBe(20);
    expect(timeline.duration).toBeCloseTo(10);
    expect(timeline.playedSpans?.map((span) => [span.measureIndex, span.startBeat, span.endBeat])).toEqual([
      [0, 0, 4],
      [1, 0, 4],
      [2, 0, 4],
      [3, 0, 3],
      [1, 1, 4],
      [2, 0, 2],
    ]);
    const onsets = timeline.events.filter((event) => event.type === "noteOn");
    expect(onsets).toHaveLength(20);
    expect(onsets.map((event) => event.scoreEventId)).toEqual([
      "e0-0",
      "e0-1",
      "e0-2",
      "e0-3",
      "e1-0",
      "e1-1",
      "e1-2",
      "e1-3",
      "e2-0",
      "e2-1",
      "e2-2",
      "e2-3",
      "e3-0",
      "e3-1",
      "e3-2",
      "e1-1",
      "e1-2",
      "e1-3",
      "e2-0",
      "e2-1",
    ]);
    const performance = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    expect(performance).toHaveLength(20);
    performance.forEach((event, index) => {
      expect(event.time).toBeCloseTo(onsets[index]!.scoreBeat! * 0.5, 2);
    });
    expect(timeline.events.every((event) => event.time <= timeline.duration)).toBe(true);
  });

  it("plays once in score order when navigation is disabled", () => {
    const timeline = generateTimeline(navigationScore(), { expandRepeats: false });
    expect(timeline.totalBeats).toBe(16);
    expect(
      generatePerformanceEvents(navigationScore(), 0, { expandRepeats: false }).filter(
        (event) => event.kind === "noteOn",
      ),
    ).toHaveLength(16);
  });
});

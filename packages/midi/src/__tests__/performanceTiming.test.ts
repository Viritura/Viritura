import { describe, expect, it } from "vitest";
import { createDynamicGroup, type GlobalMeasure, type NoteEvent, type Score } from "@viritura/core";
import { generatePerformanceEvents, generateTimeline } from "../index";

interface TimingCase {
  name: string;
  firstMeasure: GlobalMeasure;
  quarters: number;
  fermata?: boolean;
  caesura?: boolean;
  nextStart: number;
}

const cases: TimingCase[] = [
  {
    name: "quarter-note pickup",
    firstMeasure: { number: 0 },
    quarters: 1,
    nextStart: 0.5,
  },
  {
    name: "pickup with an audible fermata",
    firstMeasure: { number: 0 },
    quarters: 1,
    fermata: true,
    nextStart: 1,
  },
  {
    name: "cadenza longer than its nominal meter",
    firstMeasure: { time: { count: 4, unit: 4, display: "senzaMisura" } },
    quarters: 7,
    nextStart: 3.5,
  },
  {
    name: "cadenza with a visual-only fermata",
    firstMeasure: { time: { count: 4, unit: 4, display: "senzaMisura" } },
    quarters: 7,
    fermata: true,
    nextStart: 3.5,
  },
  {
    name: "cadenza retaining a caesura but suppressing its fermata",
    firstMeasure: { time: { count: 4, unit: 4, display: "senzaMisura" } },
    quarters: 7,
    fermata: true,
    caesura: true,
    nextStart: 4,
  },
  {
    name: "ordinary measure retaining its fermata",
    firstMeasure: {},
    quarters: 4,
    fermata: true,
    nextStart: 2.5,
  },
];

function timingScore(testCase: TimingCase): Score {
  const note = (id: string, base: "quarter" | "whole" = "quarter"): NoteEvent => ({
    type: "event",
    duration: { base },
    notes: [{ id, pitch: { step: "A", octave: 5 } }],
  });
  const firstContent = Array.from({ length: testCase.quarters }, (_, i) => note(`opening-${i}`));
  if (testCase.fermata) firstContent[0]!.fermata = {};
  if (testCase.caesura) firstContent[0]!.markings = { caesura: {} };
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
          ...testCase.firstMeasure,
        },
        {
          // Leave the pickup's following meter inherited to guard against 1/4 leaking forward.
          ...(testCase.firstMeasure.time ? { time: { count: 4, unit: 4 } } : {}),
          chordSymbols: [{ root: { step: "C" }, position: { fraction: [0, 1] } }],
        },
        { chordSymbols: [{ root: { step: "D" }, position: { fraction: [0, 1] } }] },
      ],
    },
    parts: [
      {
        id: "solo",
        name: "Solo",
        measures: [
          { sequences: [{ content: firstContent }] },
          {
            sequences: [{ content: [note("return", "whole")] }],
            dynamics: [createDynamicGroup("f", { fraction: [0, 1] }, "return-f")],
            expressions: [{ text: "pizz.", position: { fraction: [0, 1] } }],
          },
          { sequences: [{ content: [note("following")] }] },
        ],
      },
      {
        id: "ensemble",
        name: "Ensemble",
        measures: [
          { sequences: [{ content: [] }] },
          { sequences: [{ content: [note("ensemble-return", "whole")] }] },
          { sequences: [{ content: [note("ensemble-following")] }] },
        ],
      },
    ],
  };
}

describe("native chord and instrument timing integration", () => {
  it.each(["simile", "simile with repeat", "simile with D.S. al Fine"])(
    "shares fermata timing through $0",
    (navigation) => {
      const score: Score = {
        mnx: { version: 1 },
        global: {
          measures: [
            { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
            {},
            { chordSymbols: [{ root: { step: "C" }, position: { fraction: [0, 1] } }] },
          ],
        },
        parts: [
          {
            id: "solo",
            name: "Solo",
            measures: [
              {
                sequences: [
                  {
                    content: [
                      {
                        type: "event",
                        duration: { base: "whole" },
                        fermata: {},
                        notes: [{ id: "held", pitch: { step: "A", octave: 5 } }],
                      },
                    ],
                  },
                ],
              },
              { measureRepeat: { number: 1 }, sequences: [{ content: [] }] },
              {
                sequences: [
                  {
                    content: [
                      {
                        type: "event",
                        duration: { base: "whole" },
                        markings: { tenuto: {} },
                        notes: [{ id: "return", pitch: { step: "B", octave: 5 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      if (navigation === "simile with repeat") {
        score.global.measures[0]!.repeatStart = {};
        score.global.measures[2]!.repeatEnd = {};
      } else if (navigation === "simile with D.S. al Fine") {
        score.global.measures[0]!.segno = { location: { fraction: [0, 1] } };
        score.global.measures[2]!.fine = { location: { fraction: [1, 1] } };
        score.global.measures[2]!.jump = { type: "dsalfine", location: { fraction: [1, 1] } };
      }

      const before = structuredClone(score);
      const timeline = generateTimeline(score);
      const replay = navigation !== "simile";
      const starts = replay ? [0, 4, 8, 10, 14, 18] : [0, 4, 8];
      expect(timeline.expandedMeasureToOriginal).toEqual(replay ? [0, 1, 2, 0, 1, 2] : [0, 1, 2]);
      expect(timeline.measureStartTimes).toEqual(starts);
      expect(timeline.duration).toBe(replay ? 20 : 10);

      for (const partIndex of [0, score.parts.length]) {
        const events = generatePerformanceEvents(score, partIndex);
        const ons = events.filter((event) => event.kind === "noteOn");
        const offs = events.filter((event) => event.kind === "noteOff");
        if (partIndex === 0) {
          expect(ons.map((event) => event.time)).toEqual(starts);
          expect(ons.filter((event) => event.note.id === "return").map((event) => event.note.duration)).toEqual(
            replay ? [2, 2] : [2],
          );
          expect(ons.slice(0, 2).map((event) => event.note.id)).toEqual(["held", "held~r1"]);
        } else {
          expect([...new Set(ons.map((event) => event.time))]).toEqual(replay ? [8, 18] : [8]);
          expect(ons).toHaveLength(replay ? 8 : 4);
          expect(new Set(ons.map((event) => event.note.id)).size).toBe(ons.length);
          expect(ons.every((event) => event.note.duration === 2)).toBe(true);
        }
        for (const kind of ["noteOn", "noteOff"] as const) {
          const native = events
            .filter((event) => event.kind === kind)
            .filter((event) => partIndex !== 0 || event.note.id === "return");
          const browser = timeline.events.filter(
            (event) =>
              event.partIndex === partIndex && event.type === kind && (partIndex !== 0 || event.midiNote === 83),
          );
          expect(native).toHaveLength(browser.length);
          native.forEach((event, index) => {
            expect(event.note.pitch).toBe(browser[index]!.midiNote);
            // Browser instrument notes have intentional ±15 ms humanization.
            if (partIndex === 0) expect(Math.abs(event.time - browser[index]!.time)).toBeLessThanOrEqual(0.015);
            else expect(event.time).toBe(browser[index]!.time);
          });
        }
        for (const onset of ons) {
          expect(onset.note.startTime).toBe(onset.time);
          expect(offs.filter((event) => event.note === onset.note)).toEqual([
            { kind: "noteOff", time: onset.time + onset.note.duration, note: onset.note },
          ]);
        }
      }
      expect(score).toEqual(before);
    },
  );

  it.each(cases)("aligns both streams through $name", (testCase) => {
    const score = timingScore(testCase);
    const before = structuredClone(score);
    const timeline = generateTimeline(score);
    const chords = generatePerformanceEvents(score, score.parts.length);
    const chordOns = chords.filter((event) => event.kind === "noteOn");
    const chordOffs = chords.filter((event) => event.kind === "noteOff");
    const starts = [testCase.nextStart, testCase.nextStart + 2];
    expect(timeline.measureStartTimes.slice(1)).toEqual(starts);
    expect([...new Set(chordOns.map((event) => event.time))]).toEqual(starts);
    expect([...new Set(chordOffs.map((event) => event.time))]).toEqual(starts.map((time) => time + 2));
    expect(chordOns).toHaveLength(8);

    for (const partIndex of [0, 1]) {
      const events = generatePerformanceEvents(score, partIndex);
      const ons = events.filter((event) => event.kind === "noteOn");
      const offs = events.filter((event) => event.kind === "noteOff");
      const returning = ons.filter((event) => /return|following/.test(event.note.id));
      expect(returning.map((event) => event.time)).toEqual(starts);
      expect(returning.map((event) => event.note.startTime)).toEqual(starts);
      expect(returning.map((event) => event.note.duration)).toEqual([2, 0.5]);
      expect(offs.slice(-2).map((event) => event.time)).toEqual([starts[1], starts[1]! + 0.5]);
      if (partIndex === 0) {
        if (testCase.firstMeasure.time?.display === "senzaMisura") {
          expect(ons[0]!.note.duration).toBe(0.5);
        }
        expect(events.find((event) => event.kind === "technique")?.time).toBe(testCase.nextStart);
        expect(events.find((event) => event.kind === "dynamics" && event.value === 112 / 127)?.time).toBe(
          testCase.nextStart,
        );
      }
    }
    expect(score).toEqual(before);
  });
});

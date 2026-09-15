import { describe, expect, it } from "vitest";
import { createDynamicGroup, type PartMeasure, type Score } from "@viritura/core";
import { generateTimeline } from "../timeline";

/** quarter-note seconds at 120 bpm. */
const Q = 0.5;
const PREC = 1;

function note(step: "C" | "D", octave: number, base: string, dots?: number) {
  return {
    type: "event",
    duration: dots ? { base, dots } : { base },
    notes: [{ pitch: { step, octave } }],
  };
}

/**
 * A two-staff part (e.g. piano) sharing one part index. Global 2/4 @ 120bpm.
 * Staff 1 writes ordinary quarter notes; staff 2 carries a `fitMeasure`
 * staff-local meter and writes its own rhythm in that meter's note values.
 */
function buildScore(staff2Measure: PartMeasure): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 2, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
        },
      ],
    },
    parts: [
      {
        id: "p1",
        name: "Piano",
        staves: 2,
        measures: [
          {
            sequences: [
              { staff: 1, content: [note("C", 4, "quarter"), note("D", 4, "quarter")] },
              ...staff2Measure.sequences,
            ],
            ...(staff2Measure.staffMeters ? { staffMeters: staff2Measure.staffMeters } : {}),
            ...(staff2Measure.dynamics ? { dynamics: staff2Measure.dynamics } : {}),
            ...(staff2Measure.expressions ? { expressions: staff2Measure.expressions } : {}),
          } as never,
        ],
      } as never,
    ],
  };
}

function onOctaveOnsetTimes(tl: ReturnType<typeof generateTimeline>, octave: number) {
  return tl.events
    .filter((e) => e.type === "noteOn")
    .filter((e) => Math.floor((e.midiNote - 12) / 12) === octave)
    .map((e) => e.time)
    .sort((a, b) => a - b);
}

describe("generateTimeline — fitMeasure staff-local meter", () => {
  it("scales a staff's written beats into global-equivalent playback time", () => {
    // Staff 2: fitMeasure 6/8 (two dotted-quarter pulses, ratio 2/3 vs. the
    // global 2/4's two quarter-note pulses) — two dotted quarters written.
    const score = buildScore({
      sequences: [{ staff: 2, content: [note("C", 3, "quarter", 1), note("D", 3, "quarter", 1)] }],
      staffMeters: [{ staff: 2, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" }],
    } as unknown as PartMeasure);

    const tl = generateTimeline(score);
    // Both staves are on the same part index in this fixture, so distinguish
    // by pitch octave instead: staff 1 uses octave 4, staff 2 uses octave 3.
    const staff1 = onOctaveOnsetTimes(tl, 4);
    const staff2 = onOctaveOnsetTimes(tl, 3);
    expect(staff1).toHaveLength(2);
    expect(staff2).toHaveLength(2);
    // Both onsets must line up: written 1.5-beat pulses scaled by 2/3 land
    // at the same global-equivalent beat 0 and beat 1 the ordinary staff does.
    expect(staff2[0]).toBeCloseTo(staff1[0]!, PREC);
    expect(staff2[1]).toBeCloseTo(staff1[1]!, PREC);
    expect(staff2[1]).toBeCloseTo(Q, PREC);
  });

  it("does not scale an ordinary staff with no staffMeters entry", () => {
    const score = buildScore({
      sequences: [{ staff: 2, content: [note("C", 3, "quarter"), note("D", 3, "quarter")] }],
    } as unknown as PartMeasure);

    const tl = generateTimeline(score);
    const staff2 = onOctaveOnsetTimes(tl, 3);
    expect(staff2[0]).toBeCloseTo(0, PREC);
    expect(staff2[1]).toBeCloseTo(Q, PREC);
  });

  it("scales staff-scoped dynamics and techniques with the effective local meter", () => {
    const score = buildScore({
      sequences: [{ staff: 2, content: [note("C", 3, "quarter", 1), note("D", 3, "quarter", 1)] }],
      staffMeters: [{ staff: 2, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" }],
      dynamics: [{ ...createDynamicGroup("f", { fraction: [3, 8] }, "staff-2-f"), staff: 2 }],
      expressions: [{ text: "pizz.", position: { fraction: [3, 8] }, staff: 2 }],
    } as unknown as PartMeasure);

    const tl = generateTimeline(score, { partPrograms: [40] });
    const dynamicEvents = tl.events.filter((event) => event.type === "controlChange" && event.cc === 11);
    const dynamic = dynamicEvents.find((event) => event.time > 0.1);
    const technique = tl.events.find((event) => event.type === "programChange" && event.program === 45);
    expect(dynamic?.time).toBeCloseTo(Q, PREC);
    expect(technique?.time).toBeCloseTo(Q, PREC);
  });
});

import { describe, it, expect } from "vitest";
import type { Duration, GlobalMeasure, NoteEvent, Pitch, Score, SequenceContent } from "@viritura/core";
import { generateTimeline, generatePerformanceEvents, compilePlaybackTiming } from "../index";
import { buildHoldSchedule } from "../holds";

function note(step: Pitch["step"], octave: number, base: Duration["base"], extra: Partial<NoteEvent> = {}): NoteEvent {
  return { type: "event", duration: { base }, notes: [{ pitch: { step, octave } }], ...extra };
}

const Q = 0.5;
// Browser playback has deterministic timing humanization up to 15 ms.
const PREC = 1;

function buildScore(measures: SequenceContent[][], globalExtra: GlobalMeasure[] = []): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: measures.map((_, i) => ({
        time: { count: 4, unit: 4 },
        tempos: [{ bpm: 120, value: { base: "quarter" } }],
        ...globalExtra[i],
      })),
    },
    parts: [{ id: "p1", name: "Violin", measures: measures.map((content) => ({ sequences: [{ content }] })) }],
  };
}

function noteOns(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((event) => event.type === "noteOn");
}

function noteOffs(tl: ReturnType<typeof generateTimeline>) {
  return tl.events.filter((event) => event.type === "noteOff");
}

function holds(score: Score) {
  return buildHoldSchedule(
    score,
    score.global.measures.map((_, i) => i),
    score.global.measures,
  );
}

function ensembleScore(position: [number, number] = [0, 1]): Score {
  const score = buildScore(
    [[note("C", 5, "whole")], [note("G", 5, "whole")]],
    [{ fermatas: [{ id: "ensemble", position: { fraction: position } }] }],
  );
  score.parts.push({
    id: "vc",
    name: "Cello",
    measures: [
      {
        sequences: [
          {
            content: [note("C", 3, "half"), { type: "event", duration: { base: "half" }, rest: {} }],
          },
        ],
      },
      { sequences: [{ content: [note("G", 3, "whole")] }] },
    ],
  });
  return score;
}

describe("global fermata holds", () => {
  it.each([{}, { duration: "long" }, { duration: "none" }] satisfies NonNullable<NoteEvent["fermata"]>[])(
    "leaves local fermata notation %j inaudible",
    (fermata) => {
      const score = buildScore([[note("C", 5, "half", { fermata }), note("D", 5, "half")]]);
      expect(holds(score)).toEqual([[]]);
      expect(compilePlaybackTiming(score).duration).toBe(2);
      expect(noteOns(generateTimeline(score))[1]!.time).toBeCloseTo(1, PREC);
      expect(generatePerformanceEvents(score, 0).find((event) => event.kind === "noteOn")?.note.duration).toBe(1);
    },
  );

  it.each([
    { multiplier: undefined, seconds: 4 },
    { multiplier: 2.5, seconds: 5 },
    { multiplier: 1, seconds: 2 },
  ])("uses the global multiplier $multiplier independently of local hints", ({ multiplier, seconds }) => {
    const score = buildScore(
      [[note("C", 5, "whole", { fermata: { duration: "none" } })], [note("D", 5, "whole")]],
      [{ fermatas: [{ id: "hold", position: { fraction: [0, 1] }, multiplier }] }],
    );
    const tl = generateTimeline(score);
    expect(tl.measureStartTimes[1]).toBe(seconds);
    if (multiplier !== 1) expect(noteOffs(tl)[0]!.time).toBeCloseTo(seconds, PREC);
    expect(generatePerformanceEvents(score, 0).find((event) => event.kind === "noteOn")).toMatchObject({
      kind: "noteOn",
      note: { duration: seconds },
    });
  });

  it("inserts the hold at the driver's end, not at an interior global anchor", () => {
    const score = buildScore(
      [[note("C", 5, "half"), note("D", 5, "half")]],
      [{ fermatas: [{ id: "interior", position: { fraction: [1, 4] } }] }],
    );
    expect(holds(score)[0]).toEqual([
      {
        atBeat: 2,
        extraBeats: 2,
        kind: "fermata",
        startBeat: 1,
        spanEndBeat: 2,
        clickBehavior: "silent",
        fermataId: "interior",
      },
    ]);
    const tl = generateTimeline(score);
    expect(noteOns(tl)[1]!.time).toBeCloseTo(2, PREC);
    expect(noteOffs(tl).find((event) => event.midiNote === 72)!.time).toBeCloseTo(noteOns(tl)[1]!.time, PREC);
  });

  it("uses the shortest duration when sounding events have the same latest onset", () => {
    const score = ensembleScore();
    expect(holds(score)[0]![0]).toMatchObject({ atBeat: 2, extraBeats: 2 });
    const tl = generateTimeline(score, { partPrograms: [40, 42] });
    expect(tl.measureStartTimes[1]).toBe(3);
    expect(noteOffs(tl).find((event) => event.midiNote === 48)!.time).toBeCloseTo(2, PREC);
    expect(noteOffs(tl).find((event) => event.midiNote === 72)!.time).toBeCloseTo(3, PREC);
    for (const partIndex of [0, 1]) {
      const native = generatePerformanceEvents(score, partIndex).filter((event) => event.kind === "noteOn");
      expect(native[1]!.time).toBe(3);
      expect(native[0]!.note.duration).toBe(partIndex === 0 ? 3 : 2);
    }
  });

  it("prioritizes the latest onset over a shorter earlier sounding event", () => {
    const score = buildScore(
      [[note("C", 5, "half"), note("D", 5, "half")]],
      [{ fermatas: [{ id: "latest", position: { fraction: [1, 4] } }] }],
    );
    score.parts.push({
      name: "Later voice",
      measures: [
        {
          sequences: [
            {
              content: [
                { type: "event", duration: { base: "quarter" }, rest: {} },
                note("E", 4, "half", { duration: { base: "half", dots: 1 } }),
              ],
            },
          ],
        },
      ],
    });
    expect(holds(score)[0]![0]).toMatchObject({ startBeat: 1, atBeat: 4, extraBeats: 3 });
    expect(compilePlaybackTiming(score).duration).toBe(3.5);
  });

  it("sustains overlapping long notes through a later quarter-note driver's hold", () => {
    const score = ensembleScore([3, 4]);
    score.parts[1]!.measures[0]!.sequences[0]!.content = [
      note("C", 3, "half"),
      note("D", 3, "quarter"),
      note("E", 3, "quarter"),
    ];
    expect(holds(score)[0]![0]).toMatchObject({ atBeat: 4, extraBeats: 1, startBeat: 3 });
    const tl = generateTimeline(score);
    expect(tl.measureStartTimes[1]).toBe(2.5);
    expect(noteOffs(tl).find((event) => event.midiNote === 72)!.time).toBeCloseTo(2.5, PREC);
  });

  it("canonicalizes equivalent fractional positions into one hold", () => {
    const score = buildScore(
      [[note("C", 5, "whole")]],
      [
        {
          fermatas: [
            { id: "first", position: { fraction: [1, 2] } },
            { id: "duplicate", position: { fraction: [2, 4] } },
          ],
        },
      ],
    );
    expect(holds(score)[0]).toHaveLength(1);
    expect(compilePlaybackTiming(score).duration).toBe(4);
  });

  it("keeps distinct global times separate even when a whole note bridges them", () => {
    const score = ensembleScore();
    score.global.measures[0]!.fermatas = [
      { id: "first", position: { fraction: [0, 1] } },
      { id: "last", position: { fraction: [3, 4] } },
    ];
    score.parts[1]!.measures[0]!.sequences[0]!.content = [
      note("C", 3, "quarter"),
      note("D", 3, "quarter"),
      note("E", 3, "quarter"),
      note("F", 3, "quarter"),
    ];
    expect(holds(score)[0]!.map((hold) => [hold.atBeat, hold.extraBeats])).toEqual([
      [1, 1],
      [4, 1],
    ]);
    const tl = generateTimeline(score);
    expect(tl.measureStartTimes[1]).toBe(3);
    expect(noteOffs(tl).find((event) => event.midiNote === 72)!.time).toBeCloseTo(3, PREC);
    expect(noteOffs(tl).find((event) => event.midiNote === 48)!.time).toBeCloseTo(1, PREC);
    expect(noteOns(tl).find((event) => event.midiNote === 53)!.time).toBeCloseTo(2, PREC);
    expect(noteOffs(tl).find((event) => event.midiNote === 53)!.time).toBeCloseTo(3, PREC);
  });

  it("uses ordinary rests and full-measure rests as duration drivers", () => {
    const score = buildScore(
      [[{ type: "event", duration: { base: "half" }, rest: {} }], [note("D", 5, "whole")]],
      [{ fermatas: [{ id: "rest", position: { fraction: [0, 1] } }] }],
    );
    expect(holds(score)[0]![0]).toMatchObject({ atBeat: 2, extraBeats: 2 });
    expect(compilePlaybackTiming(score).measureStartTimes[1]).toBe(3);
    score.parts[0]!.measures[0]!.sequences = [
      {
        content: [],
        fullMeasure: { visualDuration: { base: "whole" } },
      },
    ];
    expect(holds(score)[0]![0]).toMatchObject({ atBeat: 4, extraBeats: 4 });
    expect(compilePlaybackTiming(score).measureStartTimes[1]).toBe(4);
  });

  it("does not let grace notes drive holds or create carriers where no timed event sounds", () => {
    const score = buildScore(
      [[{ type: "grace", content: [note("D", 5, "32nd")] }, note("C", 5, "whole")]],
      [{ fermatas: [{ id: "grace", position: { fraction: [0, 1] } }] }],
    );
    expect(holds(score)[0]![0]).toMatchObject({ atBeat: 4, extraBeats: 4 });
    score.parts[0]!.measures[0]!.sequences[0]!.content.pop();
    expect(holds(score)).toEqual([[]]);
  });

  it("scales a fitMeasure staff's duration and carrier matching to the global axis", () => {
    const score = buildScore(
      [
        [
          note("C", 5, "quarter", { duration: { base: "quarter", dots: 1 } }),
          note("D", 5, "quarter", { duration: { base: "quarter", dots: 1 } }),
        ],
      ],
      [{ time: { count: 2, unit: 4 }, fermatas: [{ id: "staff", position: { fraction: [0, 1] } }] }],
    );
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.staffMeters = [
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
    ];
    score.parts[0]!.measures[0]!.sequences[0]!.staff = 2;
    expect(holds(score)[0]![0]).toMatchObject({ atBeat: 1, extraBeats: 1 });
    const tl = generateTimeline(score);
    expect(noteOffs(tl)[0]!.time).toBeCloseTo(1, PREC);
    expect(noteOns(tl)[1]!.time).toBeCloseTo(1, PREC);
  });

  it("uses the scaled duration and exact onset of a triplet eighth driver", () => {
    const score = ensembleScore([11, 12]);
    score.parts[1]!.measures[0]!.sequences[0]!.content = [
      note("C", 3, "half"),
      note("D", 3, "quarter"),
      {
        type: "tuplet",
        inner: { multiple: 3, duration: { base: "eighth" } },
        outer: { multiple: 2, duration: { base: "eighth" } },
        content: [note("E", 3, "eighth"), note("F", 3, "eighth"), note("G", 3, "eighth")],
      },
    ];
    const hold = holds(score)[0]![0]!;
    expect(hold.startBeat).toBeCloseTo(11 / 3);
    expect(hold.atBeat).toBeCloseTo(4);
    expect(hold.extraBeats).toBeCloseTo(1 / 3);
    const tl = generateTimeline(score);
    expect(tl.measureStartTimes[1]).toBeCloseTo(2 + 1 / 6);
    expect(noteOffs(tl).find((event) => event.midiNote === 72)!.time).toBeCloseTo(2 + 1 / 6, PREC);
  });

  it("keeps a slurred carrier ringing through its global hold", () => {
    const score = buildScore(
      [[note("C", 5, "half", { slurs: [{ target: "n2" }] }), note("D", 5, "half", { id: "n2" })]],
      [{ fermatas: [{ id: "slur", position: { fraction: [0, 1] } }] }],
    );
    const tl = generateTimeline(score);
    expect(noteOffs(tl).find((event) => event.midiNote === 72)!.time).toBeCloseTo(2, PREC);
  });

  it.each(["silent", "keepClicking"] satisfies ("silent" | "keepClicking")[])(
    "exports %s click behavior with the hold timing",
    (clickBehavior) => {
      const score = buildScore(
        [[note("C", 5, "whole")]],
        [{ fermatas: [{ id: "click", position: { fraction: [0, 1] }, clickBehavior }] }],
      );
      const timing = compilePlaybackTiming(score);
      expect(holds(score)[0]![0]!.clickBehavior).toBe(clickBehavior);
      expect(timing.fermataHolds).toEqual([{ beat: 4, clickBehavior }]);
      expect(generateTimeline(score).fermataHolds).toEqual(timing.fermataHolds);
    },
  );

  it("times a hold at a ritardando endpoint using the endpoint tempo", () => {
    const score = buildScore(
      [[note("C", 5, "whole")], [note("D", 5, "whole")]],
      [
        {
          id: "m0",
          gradualTempo: {
            position: { fraction: [0, 1] },
            end: { measure: "m1", position: { fraction: [0, 1] } },
            endBpm: 60,
          },
          fermatas: [{ id: "rit", position: { fraction: [0, 1] } }],
        },
        { id: "m1", tempos: [{ bpm: 60, value: { base: "quarter" } }] },
      ],
    );
    const timing = compilePlaybackTiming(score);
    expect(timing.measureStartTimes[1]).toBeCloseTo(4 * Math.log(2) + 4, 10);
  });

  it("does not automatically copy global time anchors through a per-part simile", () => {
    const score = buildScore(
      [[note("C", 5, "whole", { fermata: {} })], [], [note("G", 5, "whole")]],
      [{ fermatas: [{ id: "source", position: { fraction: [0, 1] } }] }],
    );
    score.parts[0]!.measures[1]!.measureRepeat = { number: 1 };
    expect(compilePlaybackTiming(score).measureStartTimes).toEqual([0, 4, 6]);
    score.global.measures[1]!.fermatas = [{ id: "simile", position: { fraction: [0, 1] } }];
    expect(compilePlaybackTiming(score).measureStartTimes).toEqual([0, 4, 8]);
  });

  it("honors an explicit global fermata in a cadenza while keeping local notation visual-only", () => {
    const score = buildScore(
      [
        [note("C", 5, "whole", { fermata: {} }), note("D", 5, "half", { fermata: { duration: "long" } })],
        [note("G", 5, "whole")],
      ],
      [
        {
          time: { count: 4, unit: 4, display: "senzaMisura" },
          fermatas: [{ id: "cadenza", position: { fraction: [1, 1] } }],
        },
      ],
    );
    expect(compilePlaybackTiming(score).measureStartTimes[1]).toBe(4);
    const tl = generateTimeline(score);
    expect(tl.measureStartTimes[1]).toBe(4);
    expect(noteOffs(tl).find((event) => event.midiNote === 74)!.time).toBeCloseTo(4, PREC);
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    expect(native[1]!.note.duration).toBe(2);
    expect(native[2]!.time).toBe(4);
  });
});

describe("generateTimeline - caesura pauses", () => {
  it("max-merges coincident global/event caesuras across parts and both grand staves", () => {
    const score = buildScore(
      [[note("C", 4, "whole", { markings: { caesura: { style: "short", marks: 1 } } })]],
      [{ caesura: { marks: 2 } }],
    );
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences.push({
      staff: 2,
      content: structuredClone(score.parts[0]!.measures[0]!.sequences[0]!.content),
    });
    score.parts.push(structuredClone(score.parts[0]!));
    expect(holds(score)).toEqual([[{ atBeat: 4, extraBeats: 1, kind: "caesura" }]]);
    score.global.measures[0]!.caesura!.marks = 1;
    expect(holds(score)[0]).toHaveLength(1);
    score.global.measures[0]!.caesura!.style = "short";
    expect(holds(score)[0]![0]!.extraBeats).toBe(0.5);
  });

  it("scales a fitMeasure staff's caesura position to the global axis", () => {
    const score = buildScore(
      [
        [
          note("C", 5, "quarter", { duration: { base: "quarter", dots: 1 }, markings: { caesura: {} } }),
          note("D", 5, "quarter", { duration: { base: "quarter", dots: 1 } }),
        ],
      ],
      [{ time: { count: 2, unit: 4 } }],
    );
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.staffMeters = [
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
    ];
    score.parts[0]!.measures[0]!.sequences[0]!.staff = 2;
    expect(noteOns(generateTimeline(score))[1]!.time).toBeCloseTo(1, PREC);
  });

  it("inserts silence after the carrier without extending it", () => {
    const tl = generateTimeline(
      buildScore([[note("C", 5, "quarter", { markings: { caesura: {} } }), note("D", 5, "quarter")]]),
    );
    expect(noteOffs(tl).find((event) => event.midiNote === 72)!.time).toBeLessThan(Q + 0.05);
    expect(noteOns(tl).find((event) => event.midiNote === 74)!.time).toBeCloseTo(1, PREC);
  });

  it("a short caesura inserts half a beat", () => {
    const tl = generateTimeline(
      buildScore([[note("C", 5, "quarter", { markings: { caesura: { style: "short" } } }), note("D", 5, "quarter")]]),
    );
    expect(noteOns(tl).find((event) => event.midiNote === 74)!.time).toBeCloseTo(0.75, PREC);
  });

  it("a global measure caesura pauses at the measure end", () => {
    const tl = generateTimeline(
      buildScore(
        [
          [note("C", 5, "quarter"), note("C", 5, "quarter"), note("C", 5, "quarter"), note("C", 5, "quarter")],
          [note("D", 5, "whole")],
        ],
        [{ caesura: {} }],
      ),
    );
    expect(noteOns(tl).find((event) => event.midiNote === 74)!.time).toBeCloseTo(2.5, PREC);
  });

  it("no holds leave onsets unchanged", () => {
    const ons = noteOns(generateTimeline(buildScore([[note("C", 5, "half"), note("D", 5, "half")]])));
    expect(ons[0]!.time).toBeCloseTo(0, PREC);
    expect(ons[1]!.time).toBeCloseTo(1, PREC);
  });
});

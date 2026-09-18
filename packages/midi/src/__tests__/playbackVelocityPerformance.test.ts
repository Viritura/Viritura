import { describe, expect, it } from "vitest";
import {
  createDynamicGroup,
  type DynamicGroup,
  type NoteEvent,
  type Score,
  type SequenceContent,
} from "@viritura/core";
import {
  generatePerformanceEvents,
  performanceNoteVelocity,
  type PerformanceEvent,
  type PerformanceNote,
} from "../performanceEvents";

function note(id: string, options: Partial<NoteEvent> = {}): NoteEvent {
  return {
    type: "event",
    duration: { base: "quarter" },
    notes: [{ id, pitch: { step: "C", octave: 4 } }],
    ...options,
  };
}

function quarterNotes(): NoteEvent[] {
  return [0, 1, 2, 3].map((index) => note(`note-${index}`));
}

function dynamic(value: string, beat: number, playbackVelocity?: number): DynamicGroup {
  return {
    ...createDynamicGroup(value, { fraction: [beat, 4] }, `dynamic-${value}-${beat}`),
    ...(playbackVelocity === undefined ? {} : { playbackVelocity }),
  };
}

function scoreWith(dynamics: DynamicGroup[] = [], content: SequenceContent[] = quarterNotes()): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
        },
      ],
    },
    parts: [
      {
        name: "Violin",
        measures: [{ dynamics, sequences: [{ content }] }],
      },
    ],
  };
}

function noteOns(events: readonly PerformanceEvent[]): PerformanceNote[] {
  return events.flatMap((event) => (event.kind === "noteOn" ? [event.note] : []));
}

function rampScore(fromVelocity?: number, toVelocity?: number): Score {
  return scoreWith(
    [
      dynamic("mf", 0, fromVelocity),
      {
        id: "crescendo",
        type: "gradual",
        position: { fraction: [0, 4] },
        end: { measure: "m1", position: { fraction: [2, 4] } },
        wedgeType: "increasing",
      },
      dynamic("f", 2, toVelocity),
    ],
    Array.from({ length: 5 }, (_, index) => note(`eighth-${index}`, { duration: { base: "eighth" } })),
  );
}

function expectUnchangedSemantics(score: Score, events: readonly PerformanceEvent[]): void {
  const semanticScore = structuredClone(score);
  for (const part of semanticScore.parts) {
    for (const measure of part.measures) {
      for (const group of measure.dynamics ?? []) delete group.playbackVelocity;
    }
  }
  const semanticEvents = events.map((event) => {
    if (event.kind !== "noteOn" && event.kind !== "noteOff") return event;
    const semanticNote = { ...event.note };
    delete semanticNote.playbackVelocity;
    delete semanticNote.playbackVelocityInterpolation;
    return { ...event, note: semanticNote };
  });
  expect(semanticEvents).toStrictEqual(generatePerformanceEvents(semanticScore, 0));
}

describe("performance note playback velocity", () => {
  it.each([1, 96, 127])("exposes mf attack velocity %i without changing semantic dynamics or events", (velocity) => {
    const score = scoreWith([dynamic("mf", 0, velocity)]);
    score.parts[0]!.measures[0]!.expressions = [
      { text: "pizz.", position: { fraction: [0, 4] } },
      { text: "arco", position: { fraction: [2, 4] } },
    ];
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);

    expect(notes).toHaveLength(4);
    for (const performanceNote of notes) {
      expect(performanceNote.playbackVelocity).toBe(velocity);
      expect(performanceNote.dynamics).toBe(100 / 127);
    }
    const offs = events.filter((event) => event.kind === "noteOff");
    expect(offs).toHaveLength(4);
    offs.forEach((event, index) => expect(event.note).toBe(notes[index]));
    expectUnchangedSemantics(score, events);
  });

  it.each([false, true])("omits the property when no override exists (notated dynamics: %s)", (notated) => {
    const events = generatePerformanceEvents(scoreWith(notated ? [dynamic("mf", 0)] : []), 0);

    expect(noteOns(events)).toHaveLength(4);
    for (const event of events) {
      if (event.kind === "noteOn" || event.kind === "noteOff") {
        expect(event.note).not.toHaveProperty("playbackVelocity");
        expect(event.note.dynamics).toBe(100 / 127);
      }
    }
  });

  it("samples effective immediate and relative groups rather than their storage order", () => {
    const score = scoreWith([
      dynamic("f", 3),
      {
        id: "relative",
        type: "relative",
        position: { fraction: [2, 4] },
        relativeValue: "louder",
        playbackVelocity: 41,
      },
      dynamic("mf", 1, 96),
    ]);
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);

    expect(notes.map((performanceNote) => performanceNote.playbackVelocity)).toEqual([undefined, 96, 41, undefined]);
    expect(notes[0]).not.toHaveProperty("playbackVelocity");
    expect(notes[3]).not.toHaveProperty("playbackVelocity");
    expectUnchangedSemantics(score, events);
  });

  it.each(["immediate", "relative"] as const)("persists an explicit %s override into later measures", (type) => {
    const group: DynamicGroup =
      type === "immediate"
        ? dynamic("mf", 0, 96)
        : {
            id: "relative",
            type,
            position: { fraction: [0, 1] },
            relativeValue: "louder",
            playbackVelocity: 96,
          };
    const score = scoreWith([group], [note("first")]);
    score.global.measures.push({ id: "m2" });
    score.parts[0]!.measures.push({ sequences: [{ content: [note("later")] }] });
    const events = generatePerformanceEvents(score, 0);

    expect(noteOns(events).map((performanceNote) => performanceNote.playbackVelocity)).toEqual([96, 96]);
    expect(noteOns(events)[1]!.startTime).toBe(2);
    expectUnchangedSemantics(score, events);
  });

  it("resamples overrides at each repeated measure occurrence", () => {
    const score = scoreWith([dynamic("mf", 0, 96), dynamic("f", 2)]);
    score.global.measures[0]!.repeatStart = {};
    score.global.measures[0]!.repeatEnd = { times: 2 };
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);

    expect(notes.map((performanceNote) => performanceNote.startTime)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(notes.map((performanceNote) => performanceNote.playbackVelocity)).toEqual([
      96,
      96,
      undefined,
      undefined,
      96,
      96,
      undefined,
      undefined,
    ]);
    expectUnchangedSemantics(score, events);
  });

  it("limits accent overrides to the onset and restores the persistent override afterward", () => {
    const score = scoreWith([dynamic("mf", 0, 96), dynamic("sfz", 1, 127)]);
    const events = generatePerformanceEvents(score, 0);

    expect(noteOns(events).map((performanceNote) => performanceNote.playbackVelocity)).toEqual([96, 127, 96, 96]);
    expectUnchangedSemantics(score, events);
  });

  it("does not turn an accent residual into a persistent attack override", () => {
    const score = scoreWith([dynamic("mf", 0, 96), dynamic("fp", 1, 1)]);
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);

    expect(notes.map((performanceNote) => performanceNote.playbackVelocity)).toEqual([96, 1, undefined, undefined]);
    expect(notes.map((performanceNote) => performanceNote.dynamics)).toEqual([100 / 127, 66 / 127, 66 / 127, 66 / 127]);
    expect(notes[2]).not.toHaveProperty("playbackVelocity");
    expectUnchangedSemantics(score, events);
  });

  it("interpolates explicit attack velocities across a gradual dynamic without changing expression", () => {
    const score = scoreWith([
      dynamic("p", 0, 20),
      {
        id: "crescendo",
        type: "gradual",
        position: { fraction: [0, 4] },
        end: { measure: "m1", position: { fraction: [2, 4] } },
        wedgeType: "increasing",
      },
      dynamic("f", 2, 100),
    ]);
    const events = generatePerformanceEvents(score, 0);

    expect(noteOns(events).map((performanceNote) => performanceNote.playbackVelocity)).toEqual([20, 60, 100, 100]);
    expectUnchangedSemantics(score, events);
  });

  it.each([
    { from: 100, to: undefined, expected: [100, 103, 106, 109, 112] },
    { from: undefined, to: 120, expected: [100, 105, 110, 115, 120] },
    { from: 120, to: 100, expected: [120, 115, 110, 105, 100] },
    { from: undefined, to: undefined, expected: [100, 103, 106, 109, 112] },
  ])("resolves $from -> $to against the consumer's native attack endpoints", ({ from, to, expected }) => {
    const score = rampScore(from, to);
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);
    const nativeVelocity = (dynamics: number) => Math.max(1, Math.round(dynamics * 127));
    expect(notes.map((performanceNote) => performanceNoteVelocity(performanceNote, nativeVelocity))).toEqual(expected);
    expectUnchangedSemantics(score, events);

    for (const [index, performanceNote] of notes.entries()) {
      if (index < 4 && (from === undefined) !== (to === undefined)) {
        expect(performanceNote).not.toHaveProperty("playbackVelocity");
        expect(performanceNote.playbackVelocityInterpolation).toStrictEqual({
          from: { dynamics: 100 / 127, ...(from === undefined ? {} : { playbackVelocity: from }) },
          to: { dynamics: 112 / 127, ...(to === undefined ? {} : { playbackVelocity: to }) },
          progress: index / 4,
        });
      } else {
        expect(performanceNote).not.toHaveProperty("playbackVelocityInterpolation");
        if (from === undefined && to === undefined) expect(performanceNote).not.toHaveProperty("playbackVelocity");
      }
    }
  });

  it("lets nonlinear and fixed-attack consumers supply their own missing endpoint", () => {
    const notes = noteOns(generatePerformanceEvents(rampScore(100), 0));
    expect(notes.map((n) => performanceNoteVelocity(n, (dynamics) => Math.round(20 + 80 * dynamics ** 2)))).toEqual([
      100, 96, 91, 87, 82,
    ]);
    expect(notes.map((n) => performanceNoteVelocity(n, () => 80))).toEqual([100, 95, 90, 85, 80]);
  });

  it("keeps mixed interpolation within its sounding staff lane", () => {
    const score = rampScore(100);
    const part = score.parts[0]!;
    part.staves = 2;
    const measure = part.measures[0]!;
    measure.dynamics = measure.dynamics!.map((group) => ({ ...group, staff: 2 }));
    measure.sequences = [1, 2].map((staff) => ({ ...measure.sequences[0]!, staff }));
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);
    expect(
      notes.filter((_, index) => index % 2 === 0).every((n) => n.playbackVelocityInterpolation === undefined),
    ).toBe(true);
    expect(
      notes
        .filter((_, index) => index % 2 === 1)
        .slice(0, 4)
        .map((n) => n.playbackVelocityInterpolation?.progress),
    ).toEqual([0, 0.25, 0.5, 0.75]);
    expectUnchangedSemantics(score, events);
  });

  it.each([
    { scope: { staff: 2 }, expected: [undefined, undefined, 96, 96] },
    { scope: { voice: "lower" }, expected: [undefined, 96, undefined, 96] },
    { scope: { staff: 2, voice: "lower" }, expected: [undefined, undefined, undefined, 96] },
    { scope: { voice: "missing" }, expected: [undefined, undefined, undefined, undefined] },
    { scope: { staff: 3 }, expected: [undefined, undefined, undefined, undefined] },
  ])("does not leak an override outside scope $scope", ({ scope, expected }) => {
    const score = scoreWith([{ ...dynamic("mf", 0, 96), ...scope }]);
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [1, 2].flatMap((staff) =>
      ["upper", "lower"].map((voice) => ({ staff, voice, content: [note(`${staff}-${voice}`)] })),
    );
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);

    expect(notes.map((performanceNote) => performanceNote.playbackVelocity)).toEqual(expected);
    notes.forEach((performanceNote, index) => {
      if (expected[index] === undefined) expect(performanceNote).not.toHaveProperty("playbackVelocity");
    });
    expectUnchangedSemantics(score, events);
  });

  it("does not let a later scoped dynamic clear another lane's part-wide override", () => {
    const score = scoreWith([dynamic("mf", 0, 96), { ...dynamic("p", 1), voice: "lower" }]);
    score.parts[0]!.measures[0]!.sequences = ["upper", "lower"].map((voice) => ({
      voice,
      content: [note(`${voice}-first`), note(`${voice}-later`)],
    }));
    const events = generatePerformanceEvents(score, 0);
    const byId = new Map(noteOns(events).map((performanceNote) => [performanceNote.id, performanceNote]));

    expect(byId.get("upper-later")!.playbackVelocity).toBe(96);
    expect(byId.get("lower-later")).not.toHaveProperty("playbackVelocity");
    expectUnchangedSemantics(score, events);
  });

  it("uses the dynamic program's implicit voice identities for unnamed sequences", () => {
    const score = scoreWith([{ ...dynamic("mf", 0, 96), voice: "sequence:1" }]);
    score.parts[0]!.measures[0]!.sequences = [{ content: [note("first-voice")] }, { content: [note("second-voice")] }];
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);

    expect(notes[0]).not.toHaveProperty("playbackVelocity");
    expect(notes[1]!.playbackVelocity).toBe(96);
    expectUnchangedSemantics(score, events);
  });

  it("uses the event's sounding staff for grace, tremolo, and tuplet notes", () => {
    const score = scoreWith(
      [{ ...dynamic("mf", 0, 96), staff: 2 }],
      [
        note("upper"),
        { type: "grace", content: [note("grace", { staff: 2 })] },
        {
          type: "tremolo",
          marks: 2,
          outer: { duration: { base: "quarter" }, multiple: 1 },
          content: [note("tremolo-lower", { staff: 2 }), note("tremolo-upper")],
        },
        {
          type: "tuplet",
          inner: { duration: { base: "eighth" }, multiple: 3 },
          outer: { duration: { base: "quarter" }, multiple: 1 },
          content: [0, 1, 2].map((index) => note(`tuplet-${index}`, { staff: 2, duration: { base: "eighth" } })),
        },
      ],
    );
    score.parts[0]!.staves = 2;
    const events = generatePerformanceEvents(score, 0);

    expect(noteOns(events).map((performanceNote) => performanceNote.playbackVelocity)).toEqual([
      undefined,
      96,
      96,
      undefined,
      96,
      96,
      96,
    ]);
    expectUnchangedSemantics(score, events);
  });

  it("samples staff-local override positions at absolute performance times", () => {
    const score = scoreWith([{ ...dynamic("mf", 0, 96), position: { fraction: [3, 8] }, staff: 2 }]);
    score.global.measures[0]!.time = { count: 2, unit: 4 };
    score.parts[0]!.staves = 2;
    const measure = score.parts[0]!.measures[0]!;
    measure.staffMeters = [{ staff: 2, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" }];
    measure.sequences = [
      {
        staff: 2,
        content: [
          note("before", { duration: { base: "quarter", dots: 1 } }),
          note("after", { duration: { base: "quarter", dots: 1 } }),
        ],
      },
    ];
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);

    expect(notes[0]).not.toHaveProperty("playbackVelocity");
    expect(notes[1]).toMatchObject({ startTime: 0.5, duration: 0.5, playbackVelocity: 96 });
    expectUnchangedSemantics(score, events);
  });

  it("retains the original attack override on a tie while later attacks use the new value", () => {
    const score = scoreWith(
      [dynamic("mf", 0, 96), dynamic("mf", 1, 1)],
      [
        note("tie-start", {
          notes: [{ id: "tie-start", pitch: { step: "C", octave: 4 }, ties: [{ target: "tie-end" }] }],
        }),
        note("tie-end"),
        note("new-attack"),
      ],
    );
    const events = generatePerformanceEvents(score, 0);
    const notes = noteOns(events);

    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ id: "tie-start", startTime: 0, duration: 1, playbackVelocity: 96 });
    expect(notes[1]).toMatchObject({ id: "new-attack", startTime: 1, playbackVelocity: 1 });
    const tieOff = events.find((event) => event.kind === "noteOff" && event.note.id === "tie-start");
    expect(tieOff).toMatchObject({ time: 1, note: { playbackVelocity: 96 } });
    expectUnchangedSemantics(score, events);
  });
});

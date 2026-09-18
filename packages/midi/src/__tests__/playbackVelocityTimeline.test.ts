import { describe, expect, it } from "vitest";
import {
  createDynamicGroup,
  type DynamicGroup,
  type Markings,
  type NoteEvent,
  type Score,
  type SequenceContent,
} from "@viritura/core";
import { applyArticulationVelocity, metricAccentOffset, velocityHumanize } from "../dynamics";
import { playbackLaneId } from "../dynamicPlayback";
import { generateTimeline, type TimelineOptions } from "../timeline";
import type { MidiTimeline } from "../types";

function note(options: Partial<NoteEvent> = {}): NoteEvent {
  return {
    type: "event",
    duration: { base: "quarter" },
    notes: [{ pitch: { step: "C", octave: 4 } }],
    ...options,
  };
}

function quarters(): NoteEvent[] {
  return Array.from({ length: 4 }, () => note());
}

function dynamic(value: string, beat: number, playbackVelocity?: number): DynamicGroup {
  return {
    ...createDynamicGroup(value, { fraction: [beat, 4] }, `${value}-${beat}`),
    ...(playbackVelocity === undefined ? {} : { playbackVelocity }),
  };
}

function crescendo(playbackVelocity?: number): DynamicGroup {
  return {
    id: "crescendo",
    type: "gradual",
    position: { fraction: [0, 4] },
    end: { measure: "m1", position: { fraction: [2, 4] } },
    wedgeType: "increasing",
    ...(playbackVelocity === undefined ? {} : { playbackVelocity }),
  };
}

function scoreWith(dynamics: DynamicGroup[] = [], content: SequenceContent[] = quarters()): Score {
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
    parts: [{ name: "Part", measures: [{ dynamics, sequences: [{ content }] }] }],
  };
}

function withoutOverrides(score: Score): Score {
  const result = structuredClone(score);
  for (const part of result.parts) {
    for (const measure of part.measures) {
      for (const group of measure.dynamics ?? []) delete group.playbackVelocity;
    }
  }
  return result;
}

function attacks(timeline: MidiTimeline) {
  return timeline.events.filter((event) => event.type === "noteOn");
}

function velocities(timeline: MidiTimeline): number[] {
  return attacks(timeline).map((event) => event.velocity);
}

function defaultVelocity(base: number, beat: number, measureTime = 0, markings?: Markings): number {
  return Math.min(
    127,
    Math.max(
      1,
      applyArticulationVelocity(base, markings) +
        metricAccentOffset(beat, { count: 4, unit: 4 }) +
        velocityHumanize(measureTime, beat),
    ),
  );
}

function expectOnlyAttackChanges(score: Score, actual: MidiTimeline, options?: TimelineOptions): MidiTimeline {
  const baseline = generateTimeline(withoutOverrides(score), options);
  const omitAttackVelocity = (timeline: MidiTimeline) =>
    timeline.events.map((event) => (event.type === "noteOn" ? { ...event, velocity: 0 } : event));
  expect(omitAttackVelocity(actual)).toStrictEqual(omitAttackVelocity(baseline));
  expect(actual.measureStartTimes).toEqual(baseline.measureStartTimes);
  expect(actual.duration).toBe(baseline.duration);
  return baseline;
}

interface AttackCase {
  name: string;
  content: SequenceContent[];
  beats: number[];
  fixedShaping?: boolean;
  program?: number;
  kit?: boolean;
}

const repeatedCases: AttackCase[] = [
  ...([1, 2, 3] as const).map((marks) => ({
    name: `${marks}-slash measured tremolo`,
    content: [note({ duration: { base: "half" }, markings: { tremolo: { marks } } })],
    beats: Array.from({ length: 2 * 2 ** marks }, (_, index) => index / 2 ** marks),
    fixedShaping: true,
  })),
  {
    name: "trill",
    content: [note({ duration: { base: "half" }, markings: { trill: {} } })],
    beats: Array.from({ length: 14 }, (_, index) => (index * 2) / 14),
    fixedShaping: true,
  },
  {
    name: "multi-note tremolo",
    content: [
      {
        type: "tremolo",
        marks: 3,
        outer: { duration: { base: "half" }, multiple: 1 },
        content: [note(), note({ notes: [{ pitch: { step: "E", octave: 4 } }] })],
      },
    ],
    beats: Array.from({ length: 8 }, (_, index) => index / 4),
  },
];

const attackCases: AttackCase[] = [
  ...repeatedCases,
  {
    name: "string tremolo sample",
    content: [note({ duration: { base: "half" }, markings: { tremolo: { marks: 3 } } })],
    beats: [0],
    program: 40,
  },
  {
    name: "short trill fallback",
    content: [note({ duration: { base: "32nd" }, markings: { trill: {} } })],
    beats: [0],
  },
  {
    name: "preceding grace notes",
    content: [{ type: "space", duration: [1, 4] }, { type: "grace", content: [note(), note()] }, note()],
    beats: [0.75, 0.875, 1],
  },
  {
    name: "following grace notes",
    content: [{ type: "grace", graceType: "stealFollowing", content: [note(), note()] }, note()],
    beats: [0, 0.125, 0.25],
  },
  {
    name: "tuplet",
    content: [
      {
        type: "tuplet",
        inner: { duration: { base: "eighth" }, multiple: 3 },
        outer: { duration: { base: "quarter" }, multiple: 1 },
        content: Array.from({ length: 3 }, () => note({ duration: { base: "eighth" } })),
      },
    ],
    beats: [0, 1 / 3, 2 / 3],
  },
  {
    name: "chord",
    content: [note({ notes: [{ pitch: { step: "C", octave: 4 } }, { pitch: { step: "E", octave: 4 } }] })],
    beats: [0, 0],
  },
  {
    name: "kit hit",
    content: [note({ notes: undefined, kitNotes: [{ kitComponent: "snare" }] })],
    beats: [0],
    kit: true,
  },
  {
    name: "kit roll",
    content: [
      note({
        notes: undefined,
        kitNotes: [{ kitComponent: "snare" }],
        duration: { base: "half" },
        markings: { tremolo: { marks: 3 } },
      }),
    ],
    beats: [0],
    kit: true,
  },
];

function caseScore(testCase: AttackCase, dynamics: DynamicGroup[]): Score {
  const score = scoreWith(dynamics, testCase.content);
  if (testCase.kit) {
    score.global.sounds = { snare: { midiNumber: 38 } };
    score.parts[0]!.kit = { snare: { sound: "snare", staffPosition: 1 } };
  }
  return score;
}

describe("MIDI timeline authored attack velocity", () => {
  it.each([1, 96, 127])("emits exact mf velocity %i on every metric subdivision across measures", (velocity) => {
    const content = Array.from({ length: 16 }, () => note({ duration: { base: "16th" } }));
    const score = scoreWith([dynamic("mf", 0, velocity)], content);
    score.global.measures.push({ id: "m2" });
    score.parts[0]!.measures.push({ sequences: [{ content }] });
    const timeline = generateTimeline(score);

    expect(velocities(timeline)).toEqual(Array<number>(32).fill(velocity));
    const baseline = expectOnlyAttackChanges(score, timeline);
    expect(velocities(baseline)).toEqual(
      [0, 2].flatMap((time) => Array.from({ length: 16 }, (_, index) => defaultVelocity(84, index / 4, time))),
    );
    expect(new Set(velocities(baseline)).size).toBeGreaterThan(1);
  });

  it.each(Array.from({ length: 128 }, (_, program) => program))(
    "never remaps explicit attacks with GM program %i, including fixed-attack organs",
    (program) => {
      for (const velocity of [1, 96, 127]) {
        const score = scoreWith([dynamic("mf", 0, velocity), dynamic("f", 2)]);
        const options = { partPrograms: [program] };
        const timeline = generateTimeline(score, options);
        const baseline = expectOnlyAttackChanges(score, timeline, options);

        expect(velocities(timeline).slice(0, 2)).toEqual([velocity, velocity]);
        expect(attacks(timeline).slice(2)).toEqual(attacks(baseline).slice(2));
        expect(velocities(baseline).slice(2)).toEqual(
          [2, 3].map((beat) => defaultVelocity(program >= 16 && program <= 23 ? 84 : 98, beat)),
        );
      }
    },
  );

  it.each([false, true])("retains default metric and humanized shaping without overrides (mf: %s)", (notated) => {
    const timeline = generateTimeline(scoreWith(notated ? [dynamic("mf", 0)] : []));
    expect(velocities(timeline)).toEqual([0, 1, 2, 3].map((beat) => defaultVelocity(84, beat)));
  });

  it.each([0, 128, 1.5, NaN, Infinity])("ignores invalid attack velocity %s", (velocity) => {
    const score = scoreWith([dynamic("mf", 0, velocity)]);
    expect(generateTimeline(score).events).toEqual(generateTimeline(withoutOverrides(score)).events);
  });

  it("steps the semantic ladder from mf even when its attack is 1, and clears overrides on relative steps", () => {
    const relative = (beat: number, relativeValue: "louder" | "softer", playbackVelocity?: number): DynamicGroup => ({
      id: `relative-${beat}`,
      type: "relative",
      position: { fraction: [beat, 4] },
      relativeValue,
      ...(playbackVelocity === undefined ? {} : { playbackVelocity }),
    });
    const score = scoreWith([
      dynamic("mf", 0, 1),
      relative(1, "louder"),
      relative(2, "softer", 96),
      relative(3, "louder"),
    ]);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual([1, defaultVelocity(98, 1), 96, defaultVelocity(98, 3)]);
    expectOnlyAttackChanges(score, timeline);
  });

  it("persists a relative override into later measures until an uncalibrated immediate dynamic", () => {
    const score = scoreWith([
      {
        id: "relative",
        type: "relative",
        relativeValue: "louder",
        position: { fraction: [0, 1] },
        playbackVelocity: 96,
      },
    ]);
    score.global.measures.push({ id: "m2" });
    score.parts[0]!.measures.push({ dynamics: [dynamic("p", 2)], sequences: [{ content: quarters() }] });
    const timeline = generateTimeline(score);
    const baseline = expectOnlyAttackChanges(score, timeline);
    expect(velocities(timeline).slice(0, 6)).toEqual(Array<number>(6).fill(96));
    expect(attacks(timeline).slice(6)).toEqual(attacks(baseline).slice(6));
  });

  it.each([1, 127])(
    "limits accent velocity %i to its onset, including attacks below the persistent level",
    (velocity) => {
      const score = scoreWith([dynamic("mf", 0, 96), dynamic("sfz", 1, velocity)]);
      const timeline = generateTimeline(score);
      expect(velocities(timeline)).toEqual([96, velocity, 96, 96]);
      expectOnlyAttackChanges(score, timeline);
    },
  );

  it("clears the old persistent attack at an accent residual", () => {
    const score = scoreWith([dynamic("mf", 0, 96), dynamic("fp", 1, 1)]);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual([96, 1, defaultVelocity(64, 2), defaultVelocity(64, 3)]);
    expectOnlyAttackChanges(score, timeline);
  });

  it("reapplies and clears the authored attack independently on each repeat", () => {
    const score = scoreWith([dynamic("mf", 0, 96), dynamic("f", 2)]);
    score.global.measures[0]!.repeatStart = {};
    score.global.measures[0]!.repeatEnd = { times: 2 };
    const timeline = generateTimeline(score);
    const baseline = expectOnlyAttackChanges(score, timeline);
    expect(timeline.expandedMeasureToOriginal).toEqual([0, 0]);
    expect(velocities(timeline)).toEqual(
      velocities(baseline).map((velocity, index) => (index % 4 < 2 ? 96 : velocity)),
    );
    expect(attacks(timeline)).toHaveLength(8);
  });

  it.each([
    { scope: { staff: 2 }, selected: [false, false, true, true] },
    { scope: { voice: "lower" }, selected: [false, true, false, true] },
    { scope: { staff: 2, voice: "lower" }, selected: [false, false, false, true] },
  ])("isolates authored attacks to scope $scope", ({ scope, selected }) => {
    const score = scoreWith([{ ...dynamic("mf", 0, 96), ...scope }]);
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [1, 2].flatMap((staff) =>
      ["upper", "lower"].map((voice) => ({ staff, voice, content: quarters() })),
    );
    const timeline = generateTimeline(score);
    const baseline = expectOnlyAttackChanges(score, timeline);
    const laneIds = [1, 2].flatMap((staff) => ["upper", "lower"].map((voice) => playbackLaneId(0, staff, voice)));
    laneIds.forEach((laneId, index) => {
      const actual = attacks(timeline).filter((event) => event.playbackLaneId === laneId);
      const original = attacks(baseline).filter((event) => event.playbackLaneId === laneId);
      expect(actual).toHaveLength(4);
      expect(actual.map((event) => event.velocity)).toEqual(
        selected[index] ? [96, 96, 96, 96] : original.map((event) => event.velocity),
      );
    });
  });

  it("uses sounding-staff overrides for cross-staff notes, grace notes, tremolos, and tuplets", () => {
    const lower = () => note({ staff: 2 });
    const score = scoreWith(
      [{ ...dynamic("mf", 0, 96), staff: 2, voice: "upper" }],
      [
        note(),
        { type: "grace", content: [lower()] },
        lower(),
        {
          type: "tremolo",
          marks: 2,
          outer: { duration: { base: "quarter" }, multiple: 1 },
          content: [lower(), note()],
        },
        {
          type: "tuplet",
          inner: { duration: { base: "eighth" }, multiple: 3 },
          outer: { duration: { base: "quarter" }, multiple: 1 },
          content: Array.from({ length: 3 }, () => note({ staff: 2, duration: { base: "eighth" } })),
        },
      ],
    );
    score.parts[0]!.staves = 2;
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    sequence.staff = 1;
    sequence.voice = "upper";
    const timeline = generateTimeline(score);
    const baseline = expectOnlyAttackChanges(score, timeline);
    const lowerLane = playbackLaneId(0, 2, "upper");
    expect(
      attacks(timeline)
        .filter((event) => event.playbackLaneId === lowerLane)
        .map((event) => event.velocity),
    ).toEqual(Array<number>(7).fill(96));
    expect(attacks(timeline).filter((event) => event.playbackLaneId !== lowerLane)).toEqual(
      attacks(baseline).filter((event) => event.playbackLaneId !== lowerLane),
    );
  });

  it("does not let a scoped clearing dynamic erase another lane's override", () => {
    const score = scoreWith([dynamic("mf", 0, 96), { ...dynamic("p", 1), voice: "lower" }]);
    score.parts[0]!.measures[0]!.sequences = ["upper", "lower"].map((voice) => ({ voice, content: quarters() }));
    const timeline = generateTimeline(score);
    const baseline = expectOnlyAttackChanges(score, timeline);
    const byLane = (source: MidiTimeline, voice: string) =>
      attacks(source).filter((event) => event.playbackLaneId === playbackLaneId(0, 1, voice));
    expect(byLane(timeline, "upper").map((event) => event.velocity)).toEqual([96, 96, 96, 96]);
    expect(byLane(timeline, "lower").slice(1)).toEqual(byLane(baseline, "lower").slice(1));
  });

  it.each([undefined, 16, 40, 0])(
    "interpolates explicit ramp endpoints without profile remapping (program %s)",
    (program) => {
      const score = scoreWith([dynamic("p", 0, 20), crescendo(), dynamic("f", 2, 100)]);
      const options = { partPrograms: [program ?? -1] };
      const timeline = generateTimeline(score, options);
      expect(velocities(timeline)).toEqual([20, 60, 100, 100]);
      expectOnlyAttackChanges(score, timeline, options);
    },
  );

  it.each([0, 16, 40, 80])(
    "retains browser SF2's attack mapping for mixed eighth-note endpoints (program %i)",
    (program) => {
      const content = Array.from({ length: 5 }, () => note({ duration: { base: "eighth" } }));
      const score = scoreWith([dynamic("mf", 0, 100), crescendo(), dynamic("f", 2)], content);
      const options = { partPrograms: [program] };
      const timeline = generateTimeline(score, options);
      const target = program === 16 ? 84 : 98;
      expect(velocities(timeline)).toEqual([
        100,
        Math.round(100 * 0.75 + target * 0.25),
        Math.round((100 + target) / 2),
        Math.round(100 * 0.25 + target * 0.75),
        defaultVelocity(target, 2),
      ]);
      expectOnlyAttackChanges(score, timeline, options);
    },
  );

  it.each([0, 16, 40, 80])(
    "interpolates a gradual group's start override to its normal target (program %i)",
    (program) => {
      const score = scoreWith([dynamic("p", 0), crescendo(40), dynamic("f", 2)]);
      const options = { partPrograms: [program] };
      const timeline = generateTimeline(score, options);
      const target = program === 16 ? 84 : 98;
      expect(velocities(timeline)).toEqual([
        40,
        (40 + target) / 2,
        defaultVelocity(target, 2),
        defaultVelocity(target, 3),
      ]);
      expectOnlyAttackChanges(score, timeline, options);
    },
  );

  it.each([
    { markings: { accent: {} }, expected: 116 },
    { markings: { strongAccent: {} }, expected: 126 },
    { markings: { stress: {} }, expected: 111 },
    { markings: { unstress: {} }, expected: 81 },
    { markings: { softAccent: {} }, expected: 106 },
    { markings: { accent: {}, strongAccent: {} }, expected: 127 },
  ])("retains additional articulation adjustments $markings", ({ markings, expected }) => {
    const score = scoreWith(
      [dynamic("mf", 0, 96)],
      quarters().map((event) => ({ ...event, markings })),
    );
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual(Array<number>(4).fill(expected));
    expectOnlyAttackChanges(score, timeline);
  });
});

describe("authored attacks in generated MIDI notes", () => {
  it.each(attackCases)("preserves exact attacks and default shaping for $name", (testCase) => {
    const options = { partPrograms: [testCase.program ?? -1] };
    for (const velocity of [1, 96, 127]) {
      const score = caseScore(testCase, [dynamic("mf", 0, velocity)]);
      const timeline = generateTimeline(score, options);
      const baseline = expectOnlyAttackChanges(score, timeline, options);
      expect(velocities(timeline)).toEqual(testCase.beats.map(() => velocity));
      expect(velocities(baseline)).toEqual(
        testCase.beats.map((beat) => defaultVelocity(84, testCase.fixedShaping ? 0 : beat)),
      );
    }
  });

  it.each(attackCases)("samples a ramp at each generated $name onset", (testCase) => {
    const score = caseScore(testCase, [dynamic("p", 0, 20), crescendo(), dynamic("f", 2, 100)]);
    const options = { partPrograms: [testCase.program ?? -1] };
    const timeline = generateTimeline(score, options);
    expect(velocities(timeline)).toEqual(testCase.beats.map((beat) => Math.round(20 + 40 * beat)));
    expectOnlyAttackChanges(score, timeline, options);
  });

  it.each(attackCases)("skips automatic offbeat shaping for an explicit $name attack", (testCase) => {
    const score = caseScore(testCase, [dynamic("mf", 0.5, 96)]);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [{ type: "space", duration: [1, 8] }, ...testCase.content];
    const options = { partPrograms: [testCase.program ?? -1] };
    const timeline = generateTimeline(score, options);
    const baseline = expectOnlyAttackChanges(score, timeline, options);
    expect(velocities(timeline)).toEqual(testCase.beats.map(() => 96));
    expect(velocities(baseline)).toEqual(
      testCase.beats.map((beat) => defaultVelocity(84, testCase.fixedShaping ? 0.5 : beat + 0.5)),
    );
  });

  it.each(repeatedCases)("honors an override that begins after a $name starts", (testCase) => {
    const score = caseScore(testCase, [dynamic("mf", 0), dynamic("f", 1, 96)]);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual(
      testCase.beats.map((beat) => (beat < 1 ? defaultVelocity(84, testCase.fixedShaping ? 0 : beat) : 96)),
    );
    expectOnlyAttackChanges(score, timeline);
  });

  it.each(repeatedCases)("applies a later accent to only its sampled $name attack", (testCase) => {
    const accentBeat = testCase.beats[1]!;
    const score = caseScore(testCase, [dynamic("mf", 0, 96), dynamic("sfz", accentBeat, 1)]);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual(testCase.beats.map((_, index) => (index === 1 ? 1 : 96)));
    expectOnlyAttackChanges(score, timeline);
  });

  it.each(repeatedCases)("does not freeze an onset-only accent override through a $name", (testCase) => {
    const score = caseScore(testCase, [dynamic("mf", 0), dynamic("sfz", 0, 1)]);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual(
      testCase.beats.map((beat) => (beat === 0 ? 1 : defaultVelocity(84, testCase.fixedShaping ? 0 : beat))),
    );
    expectOnlyAttackChanges(score, timeline);
  });

  it.each(repeatedCases)("retains legacy onset shaping for a $name without explicit ramp attacks", (testCase) => {
    const score = caseScore(testCase, [dynamic("p", 0), crescendo(), dynamic("f", 2)]);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual(
      testCase.beats.map((beat) =>
        testCase.fixedShaping ? defaultVelocity(64, 0) : defaultVelocity(Math.round(64 + 17 * beat), beat),
      ),
    );
  });

  it.each(repeatedCases)("clears a persistent override during a $name", (testCase) => {
    const score = caseScore(testCase, [dynamic("mf", 0, 96), dynamic("p", 1)]);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual(
      testCase.beats.map((beat) => (beat < 1 ? 96 : defaultVelocity(64, testCase.fixedShaping ? 0 : beat))),
    );
    expectOnlyAttackChanges(score, timeline);
  });

  it.each(repeatedCases)("restores the current dynamic after an intervening $name override", (testCase) => {
    const score = caseScore(testCase, [dynamic("p", 0), dynamic("f", 0.5, 96), dynamic("ff", 1)]);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual(
      testCase.beats.map((beat) => {
        if (beat >= 0.5 && beat < 1) return 96;
        return defaultVelocity(beat < 0.5 ? 64 : 112, testCase.fixedShaping ? 0 : beat);
      }),
    );
    expectOnlyAttackChanges(score, timeline);
  });

  it.each(repeatedCases)("retains authored articulation accents on every generated $name attack", (testCase) => {
    const content = structuredClone(testCase.content);
    for (const item of content) {
      const events = item.type === "event" ? [item] : item.type === "tremolo" ? item.content : [];
      for (const event of events) event.markings = { ...event.markings, accent: {} };
    }
    const score = scoreWith([dynamic("mf", 0, 96)], content);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual(testCase.beats.map(() => 116));
    expectOnlyAttackChanges(score, timeline);
  });

  it("samples preceding grace attacks before, not at, the following note's dynamic", () => {
    const testCase = attackCases.find((candidate) => candidate.name === "preceding grace notes")!;
    const score = caseScore(testCase, [dynamic("mf", 0, 1), dynamic("f", 1, 96)]);
    const timeline = generateTimeline(score);
    expect(velocities(timeline)).toEqual([1, 1, 96]);
    expectOnlyAttackChanges(score, timeline);
  });
});

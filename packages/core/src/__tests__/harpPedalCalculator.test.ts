import { describe, expect, it } from "vitest";
import {
  calculateHarpPedalSolutions,
  harpPedalSpellingMidi,
  type NoteEvent,
  type Pitch,
  type Score,
  type SequenceContent,
} from "../index";
import { bestPedalTransfers, PEDAL_LETTERS, PEDAL_TUNINGS, type SearchLabel } from "../model/harp/searchTransitions";

function score(
  measureContent: SequenceContent[][],
  pedalSettings: Score["parts"][number]["measures"][number]["harpPedals"][] = [],
): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: measureContent.map((_, index) => ({
        id: `m${index + 1}`,
        time: { count: 4, unit: 4 },
      })),
    },
    parts: [
      {
        id: "harp",
        name: "Harp",
        staves: 2,
        _x: { viritura: { instrumentId: "pluck.harp" } },
        measures: measureContent.map((content, index) => ({
          harpPedals: pedalSettings[index],
          sequences: [{ staff: 1, content }],
        })),
      },
    ],
  };
}

function note(
  id: string,
  step: Pitch["step"],
  alter = 0,
  duration: "quarter" | "eighth" | "whole" = "quarter",
): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: duration },
    notes: [{ id: `${id}-head`, pitch: { step, alter, octave: 4 } }],
  };
}

function chord(id: string, pitches: Pitch[]): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: pitches.map((pitch, index) => ({ id: `${id}-head-${index}`, pitch })),
  };
}

const NATURAL = { D: 0, C: 0, B: 0, E: 0, F: 0, G: 0, A: 0 } as const;

describe("harp pedal calculator", () => {
  it("places a required change at the start of the actual measure", () => {
    const result = calculateHarpPedalSolutions(score([[note("c-natural", "C")], [note("c-sharp", "C", 1)]]), 0);
    const solution = result.solutions.find((item) => item.kind === "no-respelling");

    expect(solution?.settings).toHaveLength(2);
    expect(solution?.settings.map(({ measureIndex, fraction }) => [measureIndex, fraction])).toEqual([
      [0, [0, 1]],
      [1, [0, 1]],
    ]);
  });

  it("keeps tuplet onset positions as reduced score-time fractions", () => {
    const triplet: SequenceContent = {
      type: "tuplet",
      inner: { duration: { base: "quarter" }, multiple: 3 },
      outer: { duration: { base: "quarter" }, multiple: 2 },
      content: [note("c-natural", "C"), note("c-sharp", "C", 1)],
    };
    const result = calculateHarpPedalSolutions(score([[triplet]]), 0);
    const solution = result.solutions.find((item) => item.kind === "no-respelling");

    expect(solution?.settings.map(({ fraction }) => fraction)).toEqual([
      [0, 1],
      [1, 6],
    ]);
  });

  it("respects manual snapshots as fixed anchors", () => {
    const anchoredTuning = { D: 0, C: 1, B: 0, E: 0, F: 0, G: 0, A: 0 } as const;
    const result = calculateHarpPedalSolutions(
      score(
        [[note("c-natural", "C", 0, "eighth"), { type: "space", duration: [1, 8] }, note("c-sharp", "C", 1)]],
        [
          [
            {
              id: "manual",
              position: { fraction: [1, 4] },
              tuning: anchoredTuning,
              source: "manual",
            },
          ],
        ],
      ),
      0,
    );
    const solution = result.solutions.find((item) => item.kind === "no-respelling");

    expect(solution?.settings.map(({ fraction }) => fraction)).toEqual([[0, 1]]);
    expect(solution?.settings[0]?.tuning.C).toBe(0);
    expect(solution?.settingChanges).toBe(1);
  });

  it("does not change a pedal while an earlier note is still held", () => {
    const source = score([[note("held-c-natural", "C", 0, "whole")]]);
    source.parts[0]!.measures[0]!.sequences.push({
      staff: 2,
      content: [{ type: "space", duration: [1, 4] }, note("c-sharp", "C", 1)],
    });
    const result = calculateHarpPedalSolutions(source, 0);

    expect(result.solutions.some((item) => item.kind === "no-respelling")).toBe(false);
    expect(result.solutions.some((item) => item.kind === "suggest-respelling")).toBe(true);
  });

  it("ranks the fewest improving respellings separately from the lowest pedal cost", () => {
    const source = score([
      [note("c-natural", "C"), note("c-sharp", "C", 1), note("f-natural", "F"), note("f-sharp", "F", 1)],
    ]);
    const result = calculateHarpPedalSolutions(source, 0);

    expect(
      result.solutions.map((solution) => ({
        kind: solution.kind,
        changes: solution.settingChanges,
        movements: solution.pedalMovements,
        respelled: solution.spellingEdits.length,
      })),
    ).toEqual([
      { kind: "no-respelling", changes: 2, movements: 2, respelled: 0 },
      { kind: "suggest-respelling", changes: 1, movements: 1, respelled: 1 },
      { kind: "maximum-respell", changes: 0, movements: 0, respelled: 2 },
    ]);
    expect(calculateHarpPedalSolutions(source, 0)).toEqual(result);
  });

  it("finds a complete solution requiring multiple jointly changed source notes", () => {
    const source = score([
      [
        chord("conflicts", [
          { step: "C", octave: 4 },
          { step: "C", alter: 1, octave: 4 },
          { step: "D", octave: 4 },
          { step: "D", alter: 1, octave: 4 },
        ]),
      ],
    ]);
    const result = calculateHarpPedalSolutions(source, 0);

    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]).toMatchObject({
      kind: "suggest-respelling",
      settingChanges: 0,
      pedalMovements: 0,
    });
    expect(result.solutions[0]!.spellingEdits).toHaveLength(2);
    expect(result.solutions[0]!.spellingEdits.map((edit) => edit.noteIndex)).toEqual([0, 3]);
  });

  it("does not stop at a local minimum when two unison source notes must both be respelled", () => {
    const source = score([
      [
        chord("natural-unisons", [
          { step: "C", octave: 4 },
          { step: "C", octave: 4 },
        ]),
        chord("sharp-unisons", [
          { step: "C", alter: 1, octave: 4 },
          { step: "C", alter: 1, octave: 4 },
        ]),
      ],
    ]);
    const result = calculateHarpPedalSolutions(source, 0);

    expect(
      result.solutions.map((solution) => [solution.kind, solution.settingChanges, solution.spellingEdits.length]),
    ).toEqual([
      ["no-respelling", 1, 0],
      ["suggest-respelling", 0, 2],
    ]);
  });

  it("offers a lower-cost maximum respelling even when the original spelling is infeasible", () => {
    const source = score([
      [
        chord("conflict", [
          { step: "C", octave: 4 },
          { step: "C", alter: 1, octave: 4 },
          { step: "D", octave: 4 },
        ]),
        note("later-natural", "C"),
      ],
    ]);
    const result = calculateHarpPedalSolutions(source, 0);

    expect(
      result.solutions.map((solution) => [solution.kind, solution.settingChanges, solution.spellingEdits.length]),
    ).toEqual([
      ["suggest-respelling", 1, 1],
      ["maximum-respell", 0, 2],
    ]);
  });

  it("uses a pedal-only improvement as No respelling instead of offering an equal-cost enharmonic choice", () => {
    const source = score(
      [[note("c", "C")]],
      [
        [
          {
            id: "later-manual",
            position: { fraction: [1, 4] },
            tuning: { ...NATURAL, D: -1 },
          },
        ],
      ],
    );
    const result = calculateHarpPedalSolutions(source, 0);

    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]).toMatchObject({
      kind: "no-respelling",
      settingChanges: 0,
      pedalMovements: 0,
      spellingEdits: [],
    });
    expect(result.solutions[0]!.settings[0]!.tuning.D).toBe(-1);
  });

  it("respells an entire tie chain coherently and counts every changed source note", () => {
    const start = note("tie-start", "C");
    start.notes![0]!.ties = [{ target: "tie-target-head-0", targetType: "crossVoice" }];
    const target = chord("tie-target", [
      { step: "C", octave: 4 },
      { step: "C", alter: 1, octave: 4 },
      { step: "D", octave: 4 },
    ]);
    const source = score([[start]]);
    source.parts[0]!.measures[0]!.sequences.push({
      staff: 2,
      voice: "lower",
      content: [
        { type: "space", duration: [1, 4] },
        {
          type: "tuplet",
          inner: { duration: { base: "quarter" }, multiple: 3 },
          outer: { duration: { base: "quarter" }, multiple: 2 },
          content: [target],
        },
      ],
    });
    const before = structuredClone(source);
    const result = calculateHarpPedalSolutions(source, 0);

    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]!.spellingEdits).toEqual([
      { eventId: "tie-start", noteIndex: 0, pitch: { step: "B", alter: 1, octave: 3 } },
      { eventId: "tie-target", noteIndex: 0, pitch: { step: "B", alter: 1, octave: 3 } },
    ]);
    expect(source).toEqual(before);
    for (const edit of result.solutions[0]!.spellingEdits) {
      expect(harpPedalSpellingMidi({ ...edit.pitch, alter: edit.pitch.alter ?? 0 })).toBe(60);
    }
  });

  it("keeps alternative physical-string assignments until a later manual anchor resolves the tie", () => {
    const start = note("start", "C");
    start.notes![0]!.ties = [{ target: "end-head" }];
    const source = score(
      [[start, { type: "space", duration: [1, 4] }, note("end", "C")]],
      [
        [
          { id: "initial", position: { fraction: [0, 1] }, tuning: { ...NATURAL, B: 1 } },
          { id: "change", position: { fraction: [1, 4] }, tuning: { ...NATURAL, B: 1, C: 1 } },
        ],
      ],
    );
    const result = calculateHarpPedalSolutions(source, 0);

    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]!.spellingEdits).toHaveLength(2);
    expect(result.solutions[0]!.spellingEdits.every((edit) => edit.pitch.step === "B" && edit.pitch.alter === 1)).toBe(
      true,
    );
    expect(result.solutions[0]!.settings).toEqual([]);
  });

  it("carries a tie through intervening silence and rejects a conflicting manual anchor", () => {
    const start = note("start", "C");
    start.notes![0]!.ties = [{ target: "end-head" }];
    const source = score(
      [[start], [note("end", "C")]],
      [
        [
          {
            id: "conflicting-manual",
            position: { fraction: [1, 2] },
            tuning: { ...NATURAL, C: 1 },
          },
        ],
      ],
    );
    const result = calculateHarpPedalSolutions(source, 0);

    expect(result.solutions).toEqual([]);
    expect(result.error).toContain("held ties");
  });

  it("shares spelling across cross-jump ties without holding through unplayed written measures", () => {
    const end = note("jump-source", "C");
    end.notes![0]!.ties = [{ target: "jump-target-head", targetType: "crossJump" }];
    const source = score(
      [[note("jump-target", "C")], [end]],
      [
        [
          {
            id: "intervening",
            position: { fraction: [1, 2] },
            tuning: { ...NATURAL, C: 1 },
          },
        ],
      ],
    );
    const result = calculateHarpPedalSolutions(source, 0);

    expect(result.solutions.find((solution) => solution.kind === "no-respelling")).toBeTruthy();
  });

  it("keeps originally enharmonic tie endpoints on one physical string when respelling is applied", () => {
    const start = note("start", "C");
    start.notes![0]!.ties = [{ target: "end-head" }];
    const end = note("end", "B", 1);
    end.notes![0]!.pitch.octave = 3;
    const result = calculateHarpPedalSolutions(score([[start, end]]), 0);

    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]).toMatchObject({ kind: "suggest-respelling", settingChanges: 0 });
    expect(result.solutions[0]!.spellingEdits).toHaveLength(1);
  });

  it("does not respell a tie chain that includes a source note outside the harp segment", () => {
    const start = note("start", "C");
    start.notes![0]!.ties = [{ target: "flute-note-head" }];
    const source = score(
      [[start, { type: "space", duration: [1, 4] }, note("flute-note", "C")]],
      [
        [
          {
            id: "manual",
            position: { fraction: [0, 1] },
            tuning: { ...NATURAL, B: 1, C: 1 },
          },
        ],
      ],
    );
    source.parts[0]!._x = {
      viritura: {
        initialInstrument: "harp",
        instruments: { harp: { instrumentId: "pluck.harp" }, flute: { instrumentId: "wind.flutes.flute" } },
      },
    };
    source.parts[0]!.measures[0]!.instrumentChanges = [{ instrument: "flute", position: { fraction: [1, 2] } }];

    expect(calculateHarpPedalSolutions(source, 0)).toMatchObject({ solutions: [], error: expect.any(String) });
  });

  it("does not invent an extended notated hold for laissez-vibrer ties", () => {
    const start = note("start", "C");
    start.notes![0]!.ties = [{ lv: true }];
    const source = score(
      [[start, note("sharp", "C", 1)]],
      [
        [
          {
            id: "manual",
            position: { fraction: [1, 4] },
            tuning: { ...NATURAL, C: 1 },
          },
        ],
      ],
    );

    expect(calculateHarpPedalSolutions(source, 0).solutions.some((solution) => solution.kind === "no-respelling")).toBe(
      true,
    );
  });

  it("rejects dangling or pitch-changing ties instead of partially solving them", () => {
    const start = note("start", "C");
    start.notes![0]!.ties = [{ target: "missing" }];
    expect(calculateHarpPedalSolutions(score([[start]]), 0)).toMatchObject({
      solutions: [],
      error: expect.stringContaining("valid target"),
    });
    start.notes![0]!.ties = [{ target: "different-head" }];
    expect(calculateHarpPedalSolutions(score([[start, note("different", "D")]]), 0)).toMatchObject({
      solutions: [],
      error: expect.stringContaining("different sounding pitches"),
    });
  });

  it("finds octave-correct enharmonic replacements for double accidentals and rejects microtones", () => {
    const doubled = note("double", "B", 2);
    doubled.notes![0]!.pitch.octave = 3;
    const result = calculateHarpPedalSolutions(score([[doubled]]), 0);
    expect(result.solutions[0]!.spellingEdits).toEqual([
      { eventId: "double", noteIndex: 0, pitch: { step: "C", alter: 1, octave: 4 } },
    ]);
    expect(calculateHarpPedalSolutions(score([[note("microtone", "C", 0.5)]]), 0)).toMatchObject({
      solutions: [],
      error: expect.stringContaining("exact harp-string spelling"),
    });
  });

  it("matches exhaustive transition costs across every pedal configuration", () => {
    const origins: SearchLabel[] = [0, 1, 20, 42, 111, 333, 729, 1093, 1500, 2000, 2186].map((index, order) => ({
      tuningIndex: index,
      assignments: new Map(),
      settingChanges: order % 3,
      pedalMovements: (order * 7) % 11,
      respellingCount: 3,
      preference: order,
      editKey: String(order),
    }));
    const targets = PEDAL_TUNINGS.map((_, index) => index);
    const actual = bestPedalTransfers(origins, targets);
    for (const target of targets) {
      const costs = origins.map((origin) => {
        const moved = PEDAL_LETTERS.filter(
          (letter) => PEDAL_TUNINGS[origin.tuningIndex]![letter] !== PEDAL_TUNINGS[target]![letter],
        ).length;
        return {
          settingChanges: origin.settingChanges + (moved ? 1 : 0),
          pedalMovements: origin.pedalMovements + moved,
        };
      });
      costs.sort(
        (left, right) => left.settingChanges - right.settingChanges || left.pedalMovements - right.pedalMovements,
      );
      expect({
        settingChanges: actual.get(target)!.settingChanges,
        pedalMovements: actual.get(target)!.pedalMovements,
      }).toEqual(costs[0]);
    }
  });
});

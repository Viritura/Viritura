import { describe, expect, it } from "vitest";
import { parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import { resolveActiveInstrument, type PositionedClef, type Score } from "@viritura/core";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../score/ScoreBuilder";
import { createPlayer } from "../score/InstrumentCatalog";
import { changeInstrumentInScore } from "../score/changeInstrument";
import {
  barStartChange,
  deleteInstrumentChangeByElementId,
  removeBarInstrumentChange,
  resolveBarInstrumentTarget,
  setBarInstrument,
  setBarTransposition,
  synchronizeInitialInstrument,
} from "./index";

function scoreFor(instrumentId = "wind.flutes.flute"): Score {
  const score = parseMnx(
    JSON.parse(
      buildBlankScore({
        ...DEFAULT_NEW_SCORE_SETTINGS,
        players: [createPlayer(instrumentId)],
        measureCount: 4,
      }),
    ),
  );
  score.parts[0]!.measures[1]!.sequences[0]!.content = [
    {
      type: "event",
      duration: { base: "whole" },
      notes: [{ pitch: { step: "C", octave: 5 } }],
    },
  ];
  return score;
}

describe("bar instrument changes", () => {
  it("preserves independent label controls across instrument and transposition edits", () => {
    const target = { partIndex: 0, measureIndex: 1 };
    let score = setBarInstrument(
      scoreFor(),
      target,
      "wind.reed.oboe",
      { hidden: true },
      { text: "Prepare oboe" },
    ).score;
    score = setBarTransposition(
      score,
      target,
      { interval: { halfSteps: 2, staffDistance: 1 } },
      { text: "in B-flat" },
    ).score;
    expect(barStartChange(score.parts[0]!, 1)).toMatchObject({
      instruction: { text: "in B-flat" },
      reminder: { text: "Prepare oboe" },
    });
    score = setBarInstrument(score, target, "wind.reed.english-horn", undefined, { hidden: true }).score;
    expect(barStartChange(score.parts[0]!, 1)?.reminder).toEqual({ hidden: true });
    expect(validateRawScore(serializeMnx(score)).ok).toBe(true);
  });

  it("resolves a single selected bar or note, rejecting cross-part and multi-bar selections", () => {
    const score = scoreFor();
    const selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 1,
      endMeasure: 1,
    } as const;
    expect(resolveBarInstrumentTarget(score, selection)).toEqual({ partIndex: 0, measureIndex: 1 });
    expect(resolveBarInstrumentTarget(score, { ...selection, endMeasure: 2 })).toBeNull();
    expect(resolveBarInstrumentTarget(score, { ...selection, endPartIndex: 1 })).toBeNull();
    expect(resolveBarInstrumentTarget(score, { kind: "none" })).toBeNull();
    expect(
      resolveBarInstrumentTarget(score, { kind: "single", elementId: "p0/m1/s0/e0", elementType: "event" }),
    ).toEqual({ partIndex: 0, measureIndex: 1 });
  });

  it("switches from flute to piccolo without changing initial identity or sounding notes", () => {
    const score = scoreFor();
    const result = setBarInstrument(score, { partIndex: 0, measureIndex: 1 }, "wind.flutes.flute.piccolo");
    expect(result.error).toBeUndefined();
    const part = result.score.parts[0]!;
    expect(part._x?.viritura?.instrumentId).toBe("wind.flutes.flute");
    expect(part.transposition).toBeUndefined();
    expect(part.measures[1]!.sequences).toEqual(score.parts[0]!.measures[1]!.sequences);
    expect(resolveActiveInstrument(part, 0).instrument?.instrumentId).toBe("wind.flutes.flute");
    expect(resolveActiveInstrument(part, 1).transposition).toEqual({
      interval: { halfSteps: -12, staffDistance: -7 },
      prefersWrittenPitches: true,
    });
    expect(resolveActiveInstrument(part, 3).instrument?.instrumentId).toBe("wind.flutes.flute.piccolo");
    expect(validateRawScore(serializeMnx(result.score)).ok).toBe(true);
    expect(score.parts[0]!._x?.viritura?.instruments).toBeUndefined();
  });

  it("merges a transposition override with a same-bar instrument change", () => {
    const target = { partIndex: 0, measureIndex: 1 };
    const score = setBarInstrument(scoreFor(), target, "wind.reed.clarinet.bflat").score;
    const result = setBarTransposition(
      score,
      target,
      { interval: { halfSteps: 3, staffDistance: 2 } },
      { text: "in A" },
    );
    const part = result.score.parts[0]!;
    expect(part.measures[1]!.instrumentChanges).toHaveLength(1);
    expect(resolveActiveInstrument(part, 1)).toMatchObject({
      instrument: { instrumentId: "wind.reed.clarinet.bflat" },
      transposition: { interval: { halfSteps: 3, staffDistance: 2 } },
    });
    expect(barStartChange(part, 1)?.instruction).toEqual({ text: "in A" });
    expect(validateRawScore(serializeMnx(result.score)).ok).toBe(true);
  });

  it("does not insert clefs when switching between flute and piccolo or removing the change", () => {
    const target = { partIndex: 0, measureIndex: 1 };
    for (const [from, to] of [
      ["wind.flutes.flute", "wind.flutes.flute.piccolo"],
      ["wind.flutes.flute.piccolo", "wind.flutes.flute"],
    ] as const) {
      const changed = setBarInstrument(scoreFor(from), target, to);
      expect(changed.error).toBeUndefined();
      expect(changed.score.parts[0]!.measures[1]!.clefs).toBeUndefined();
      const returned = setBarInstrument(changed.score, { partIndex: 0, measureIndex: 2 }, from);
      expect(returned.score.parts[0]!.measures[2]!.clefs).toBeUndefined();
      const removed = removeBarInstrumentChange(changed.score, target);
      expect(removed.error).toBeUndefined();
      expect(removed.score.parts[0]!.measures[1]!.clefs).toBeUndefined();
      expect(validateRawScore(serializeMnx(changed.score)).ok).toBe(true);
    }
  });

  it("inserts different default clefs and removes obsolete clefs when replacing a change", () => {
    const target = { partIndex: 0, measureIndex: 1 };
    const changed = setBarInstrument(scoreFor(), target, "strings.cello").score;
    expect(changed.parts[0]!.measures[1]!.clefs).toEqual([{ clef: { sign: "F", staffPosition: 2 } }]);
    const returned = setBarInstrument(changed, { partIndex: 0, measureIndex: 2 }, "wind.flutes.flute");
    expect(returned.score.parts[0]!.measures[2]!.clefs).toEqual([{ clef: { sign: "G", staffPosition: -2 } }]);
    const replaced = setBarInstrument(changed, target, "wind.flutes.flute.piccolo");
    expect(replaced.score.parts[0]!.measures[1]!.clefs).toBeUndefined();
  });

  it("compares the last positioned clef on each staff and preserves later clefs", () => {
    const score = scoreFor("keyboard.piano");
    score.parts[0]!.measures[0]!.clefs = [
      { position: { fraction: [3, 4] }, clef: { sign: "G", staffPosition: -2 } },
      { position: { fraction: [1, 2] }, clef: { sign: "F", staffPosition: 2 } },
      { staff: 2, clef: { sign: "C", staffPosition: 0 } },
    ];
    const later: PositionedClef = {
      position: { fraction: [1, 2] },
      clef: { sign: "C", staffPosition: 0 },
    };
    score.parts[0]!.measures[1]!.clefs = [later];
    const changed = setBarInstrument(score, { partIndex: 0, measureIndex: 1 }, "pluck.harp");
    expect(changed.error).toBeUndefined();
    expect(changed.score.parts[0]!.measures[1]!.clefs).toEqual([
      { staff: 2, clef: { sign: "F", staffPosition: 2 } },
      later,
    ]);
  });

  it("rechecks the next instrument's clef after inserting or removing an earlier change", () => {
    const later = { partIndex: 0, measureIndex: 2 };
    const earlier = { partIndex: 0, measureIndex: 1 };
    const score = setBarInstrument(scoreFor(), later, "wind.flutes.flute.piccolo").score;
    expect(score.parts[0]!.measures[2]!.clefs).toBeUndefined();
    const changed = setBarInstrument(score, earlier, "strings.cello");
    expect(changed.error).toBeUndefined();
    expect(changed.score.parts[0]!.measures[2]!.clefs).toEqual([{ clef: { sign: "G", staffPosition: -2 } }]);
    const removed = removeBarInstrumentChange(changed.score, earlier);
    expect(removed.error).toBeUndefined();
    expect(removed.score.parts[0]!.measures[2]!.clefs).toBeUndefined();

    score.parts[0]!.measures[2]!.clefs = [{ clef: { sign: "C", staffPosition: 0 } }];
    const customized = setBarInstrument(score, earlier, "strings.cello");
    expect(customized.error).toBeUndefined();
    expect(customized.score.parts[0]!.measures[2]!.clefs).toEqual([{ clef: { sign: "C", staffPosition: 0 } }]);
  });

  it("supports transposition-only changes and an explicit return to concert pitch", () => {
    const score = scoreFor("brass.french-horn");
    const changed = setBarTransposition(
      score,
      { partIndex: 0, measureIndex: 1 },
      { interval: { halfSteps: 9, staffDistance: 5 } },
    ).score;
    expect(changed.parts[0]!._x?.viritura?.instruments).toBeUndefined();
    const reset = setBarTransposition(
      changed,
      { partIndex: 0, measureIndex: 3 },
      { interval: { halfSteps: 0, staffDistance: 0 } },
    ).score;
    expect(resolveActiveInstrument(reset.parts[0]!, 2).transposition?.interval.halfSteps).toBe(9);
    expect(resolveActiveInstrument(reset.parts[0]!, 3).transposition?.interval.halfSteps).toBe(0);
    expect(validateRawScore(serializeMnx(reset)).ok).toBe(true);
  });

  it("replaces only the bar-start change and preserves later positions", () => {
    const score = scoreFor();
    score.parts[0]!.measures[1]!.instrumentChanges = [
      { transposition: { interval: { halfSteps: 2, staffDistance: 1 } } },
      { position: { fraction: [1, 2] }, transposition: { interval: { halfSteps: 3, staffDistance: 2 } } },
    ];
    const result = setBarInstrument(score, { partIndex: 0, measureIndex: 1 }, "wind.reed.oboe");
    expect(result.score.parts[0]!.measures[1]!.instrumentChanges).toHaveLength(2);
    expect(barStartChange(result.score.parts[0]!, 1)?.transposition).toBeUndefined();
    expect(resolveActiveInstrument(result.score.parts[0]!, 1, [1, 2]).transposition?.interval.halfSteps).toBe(3);
  });

  it("removes a change and restores the prior clef without touching later clefs or changes", () => {
    const target = { partIndex: 0, measureIndex: 1 };
    const changed = setBarInstrument(scoreFor(), target, "strings.cello").score;
    changed.parts[0]!.measures[1]!.clefs!.push({
      position: { fraction: [1, 2] },
      clef: { sign: "C", staffPosition: 0 },
    });
    const result = removeBarInstrumentChange(changed, target);
    expect(result.error).toBeUndefined();
    expect(result.score.parts[0]!.measures[1]!.instrumentChanges).toBeUndefined();
    expect(result.score.parts[0]!.measures[1]!.clefs).toEqual([
      { position: { fraction: [1, 2] }, clef: { sign: "C", staffPosition: 0 } },
    ]);
  });

  it("deletes a selected change label but only hides a selected advance reminder", () => {
    const target = { partIndex: 0, measureIndex: 1 };
    const changed = setBarInstrument(scoreFor(), target, "wind.reed.oboe", undefined, { text: "To oboe" }).score;
    const hidden = deleteInstrumentChangeByElementId(changed, "p0/m1/expr-instreminder0");
    expect(barStartChange(hidden!.parts[0]!, 1)).toMatchObject({ reminder: { text: "To oboe", hidden: true } });
    expect(deleteInstrumentChangeByElementId(hidden!, "p0/m1/expr-instreminder0")).toBeNull();
    const removed = deleteInstrumentChangeByElementId(changed, "p0/m1/expr-instchange0");
    expect(removed!.parts[0]!.measures[1]!.instrumentChanges).toBeUndefined();
    expect(deleteInstrumentChangeByElementId(changed, "p0/m0/expr-instinitial")).toBeNull();
    expect(barStartChange(changed.parts[0]!, 1)?.reminder).toEqual({ text: "To oboe" });
  });

  it("blocks unsafe staff-count and percussion-map changes without modifying the score", () => {
    const score = scoreFor();
    for (const id of ["keyboard.piano", "drum.snare-drum"]) {
      const result = setBarInstrument(score, { partIndex: 0, measureIndex: 1 }, id);
      expect(result.error).toBeTruthy();
      expect(result.score).toBe(score);
    }
  });

  it("rejects non-integer transposition values and missing bars", () => {
    const score = scoreFor();
    expect(
      setBarTransposition(score, { partIndex: 0, measureIndex: 1 }, { interval: { halfSteps: 1.5, staffDistance: 1 } })
        .error,
    ).toBeTruthy();
    expect(setBarInstrument(score, { partIndex: 0, measureIndex: 10 }, "wind.reed.oboe").error).toBeTruthy();
  });
});

describe("Setup edits with instrument changes", () => {
  it("preserves later references when replacing the initial instrument", () => {
    let score = setBarInstrument(scoreFor(), { partIndex: 0, measureIndex: 1 }, "wind.flutes.flute.piccolo").score;
    const initialKey = score.parts[0]!._x!.viritura!.initialInstrument!;
    score.parts[0]!.measures[3]!.instrumentChanges = [{ instrument: initialKey }];
    score = changeInstrumentInScore(score, score.parts[0]!.id!, "wind.reed.oboe")!;
    const part = score.parts[0]!;
    expect(resolveActiveInstrument(part, 0).instrument?.instrumentId).toBe("wind.reed.oboe");
    expect(resolveActiveInstrument(part, 1).instrument?.instrumentId).toBe("wind.flutes.flute.piccolo");
    expect(resolveActiveInstrument(part, 3).instrument?.instrumentId).toBe("wind.flutes.flute");
    expect(validateRawScore(serializeMnx(score)).ok).toBe(true);
  });

  it("synchronizes initial transposition after a roster edit without changing later instruments", () => {
    const score = setBarInstrument(scoreFor(), { partIndex: 0, measureIndex: 1 }, "wind.reed.oboe").score;
    const oldPart = score.parts[0]!;
    const part = synchronizeInitialInstrument(oldPart, {
      ...oldPart,
      transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
    });
    expect(resolveActiveInstrument(part, 0).transposition?.interval.halfSteps).toBe(2);
    expect(resolveActiveInstrument(part, 1).transposition).toBeUndefined();
    expect(validateRawScore(serializeMnx({ ...score, parts: [part] })).ok).toBe(true);
  });
});

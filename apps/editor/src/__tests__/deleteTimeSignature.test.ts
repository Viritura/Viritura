import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { resolveAutomaticBeamGroups } from "../commands/autoBeaming";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { getActiveTimeSignature } from "../commands/cursorCommands";
import { deleteTimeSignaturesByElementIds } from "../commands/signatureCommands";
import { handleDelete } from "../keyboard/normalModeDelete";
import type { KeyboardHandlerContext } from "../keyboard/types";
import type { Selection } from "../store/selectionStore";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        { time: { count: 4, unit: 4 } },
        { time: { count: 2, unit: 2, display: "cut" }, key: { fifths: 2 } },
        {},
        { time: { count: 3, unit: 4 } },
      ],
    },
    parts: [
      {
        measures: Array.from({ length: 4 }, (_, measureIndex) => ({
          sequences: [
            {
              content: Array.from({ length: 16 }, (_, index) => ({
                type: "event",
                id: `m${measureIndex}-e${index}`,
                duration: { base: "16th" },
                notes: [{ pitch: { step: "C", octave: 4 } }],
              })),
            },
          ],
        })),
      },
    ],
  };
}

function keyboardHarness(score: Score, selection: Selection) {
  const unexpected = () => {
    throw new Error("Unexpected keyboard context access");
  };
  const updateScore = vi.fn<(score: Score) => void>();
  const clearSelection = vi.fn();
  const ctx: KeyboardHandlerContext = {
    getScore: () => score,
    getSelection: () => selection,
    getConfig: () => ({
      canvasRef: { current: null },
      currentZoom: 1,
      onNewScore: unexpected,
      onShowHelp: unexpected,
      onOpenFile: unexpected,
      onSave: unexpected,
      onSaveAs: unexpected,
      onCopy: unexpected,
      onCut: unexpected,
      onPaste: unexpected,
    }),
    updateScore,
    clearSelection,
    getNavIndex: unexpected,
    getNoteInput: unexpected,
    commitPatches: unexpected,
    selectElement: unexpected,
    selectRange: unexpected,
    extendSelection: unexpected,
    toggleNoteInput: unexpected,
    setDuration: unexpected,
    toggleRest: unexpected,
    toggleDot: unexpected,
    incrementDot: unexpected,
    setGraceType: unexpected,
    toggleGraceActive: unexpected,
    toggleSlur: unexpected,
    toggleTie: unexpected,
    setLastPitch: unexpected,
    setCursor: unexpected,
    setSlurStart: unexpected,
    clearSlurStart: unexpected,
    setVoice: unexpected,
    setAccidental: unexpected,
    toggleChordLock: unexpected,
    setChordLock: unexpected,
    setRhythmSource: unexpected,
    previewPitch: unexpected,
    undo: unexpected,
    redo: unexpected,
  };
  return { ctx, updateScore, clearSelection };
}

function deleteThroughBothPaths(score: Score, selection: Selection): Score[] {
  const original = structuredClone(score);
  const result = computeDeleteSelection(score, selection);
  expect(result.kind).toBe(selection.kind);
  if (result.kind !== "single" && result.kind !== "multi") throw new Error("Expected signature deletion");
  expect(result.nextSelection).toEqual({ kind: "clear" });
  const { ctx, updateScore, clearSelection } = keyboardHarness(score, selection);
  const event = new KeyboardEvent("keydown", { key: "Delete", cancelable: true });
  handleDelete(event, false, ctx);
  expect(event.defaultPrevented).toBe(true);
  expect(updateScore).toHaveBeenCalledTimes(1);
  expect(clearSelection).toHaveBeenCalledOnce();
  expect(score).toEqual(original);
  return [result.score, updateScore.mock.calls[0]![0]];
}

describe("deleting selected time signatures", () => {
  it.each(["m1/time", "p0/m1/time"])("reverts 2/2 to inherited 4/4 through %s", (elementId) => {
    const score = makeScore();
    for (const next of deleteThroughBothPaths(score, { kind: "single", elementId })) {
      const expected = structuredClone(score);
      delete expected.global.measures[1]!.time;
      expect(next).toEqual(expected);
      expect(getActiveTimeSignature(next, 1)).toEqual({ count: 4, unit: 4 });
      expect(getActiveTimeSignature(next, 2)).toEqual({ count: 4, unit: 4 });
      expect(getActiveTimeSignature(next, 3)).toEqual({ count: 3, unit: 4 });
    }
  });

  it("uses the nearest preceding meter across inherited measures", () => {
    const score = makeScore();
    for (const next of deleteThroughBothPaths(score, { kind: "single", elementId: "m3/time" })) {
      expect(getActiveTimeSignature(next, 3)).toEqual(score.global.measures[1]!.time);
    }
  });

  it("defaults to 4/4 when deleting the first explicit meter", () => {
    const score = makeScore();
    score.global.measures[0]!.time = { count: 6, unit: 8 };
    for (const next of deleteThroughBothPaths(score, { kind: "single", elementId: "m0/time" })) {
      expect(next.global.measures[0]!.time).toBeUndefined();
      expect(getActiveTimeSignature(next, 0)).toEqual({ count: 4, unit: 4 });
      expect(getActiveTimeSignature(next, 1)).toEqual(score.global.measures[1]!.time);
    }
  });

  it("removes multiple selected meters, coalescing staff copies", () => {
    const score = makeScore();
    const selection: Selection = { kind: "multi", elementIds: ["m1/time", "p0/m1/time", "m3/time"] };
    for (const next of deleteThroughBothPaths(score, selection)) {
      expect(next.global.measures.map((measure) => measure.time)).toEqual([
        { count: 4, unit: 4 },
        undefined,
        undefined,
        undefined,
      ]);
      expect(next.parts).toEqual(score.parts);
    }
  });

  it("deletes a mixed meter and note selection without touching other notes", () => {
    const score = makeScore();
    for (const next of deleteThroughBothPaths(score, {
      kind: "multi",
      elementIds: ["m1/time", "p0/m1/s0/m1-e0"],
    })) {
      expect(next.global.measures[1]!.time).toBeUndefined();
      const content = next.parts[0]!.measures[1]!.sequences[0]!.content;
      expect(content[0]).toMatchObject({ type: "event", rest: {} });
      expect(content.slice(1)).toEqual(score.parts[0]!.measures[1]!.sequences[0]!.content.slice(1));
    }
  });

  it("recomputes automatic grouping from the inherited meter", () => {
    const score = makeScore();
    const content = score.parts[0]!.measures[1]!.sequences[0]!.content;
    const groupSizes = (value: Score) =>
      resolveAutomaticBeamGroups(content, getActiveTimeSignature(value, 1), new Set()).map(
        (beam) => beam.events.length,
      );
    expect(groupSizes(score)).toEqual([8, 8]);
    for (const next of deleteThroughBothPaths(score, { kind: "single", elementId: "m1/time" })) {
      expect(groupSizes(next)).toEqual([4, 4, 4, 4]);
    }
  });

  it("preserves authored beams", () => {
    const score = makeScore();
    score.parts[0]!.measures[1]!.beams = [{ events: ["m1-e0", "m1-e1", "m1-e2"] }];
    for (const next of deleteThroughBothPaths(score, { kind: "single", elementId: "m1/time" })) {
      expect(next.parts).toEqual(score.parts);
    }
  });

  it.each(["m2/time", "m99/time", "m1/key", "m1/time/extra", "garbage/m1/time"])(
    "ignores inherited, missing, or malformed meter paths: %s",
    (elementId) => {
      const score = makeScore();
      if (elementId === "m1/key") delete score.global.measures[1]!.key;
      const original = structuredClone(score);
      expect(deleteTimeSignaturesByElementIds(score, [elementId])).toBeNull();
      for (const selection of [
        { kind: "single", elementId },
        { kind: "multi", elementIds: [elementId] },
      ] satisfies Selection[]) {
        expect(computeDeleteSelection(score, selection)).toEqual({ kind: "noop" });
        const { ctx, updateScore, clearSelection } = keyboardHarness(score, selection);
        handleDelete(new KeyboardEvent("keydown", { key: "Delete" }), false, ctx);
        expect(updateScore).not.toHaveBeenCalled();
        expect(clearSelection).not.toHaveBeenCalled();
      }
      expect(score).toEqual(original);
    },
  );
});

import { describe, expect, it, vi } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { handleDelete } from "../keyboard/normalModeDelete";
import type { KeyboardHandlerContext } from "../keyboard/types";
import type { Selection } from "../store/selectionStore";

function fixture(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", id: "a", duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                  { type: "event", id: "b", duration: { base: "half" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function first(score: Score): NoteEvent {
  const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0];
  if (event?.type !== "event") throw new Error("Expected an event");
  return event;
}

function keyboard(score: Score, selection: Selection) {
  let latest = score;
  const clearSelection = vi.fn();
  const selectElement = vi.fn();
  const updateScore = vi.fn((next: Score) => {
    latest = next;
  });
  const context = {
    getScore: () => latest,
    getSelection: () => selection,
    getConfig: () => ({ selectedScoreIndex: 0 }),
    updateScore,
    clearSelection,
    selectElement,
  } as unknown as KeyboardHandlerContext;
  handleDelete(new KeyboardEvent("keydown", { key: "Delete", cancelable: true }), false, context);
  return { score: latest, updateScore, clearSelection, selectElement };
}

describe("deletion compatibility contract", () => {
  it.each(["slideIn", "slideOut"] as const)("preserves #462 leaf isolation for %s", (key) => {
    const score = fixture();
    first(score).notes![0]!.markings = { slideIn: { type: "scoop" }, slideOut: { type: "doit" } };
    const original = structuredClone(score);
    for (const multi of [false, true]) {
      const id = `p0/m0/s0/a/n0/${key}`;
      const selection: Selection = multi ? { kind: "multi", elementIds: [id, id] } : { kind: "single", elementId: id };
      const menu = computeDeleteSelection(score, selection);
      expect(menu.kind).not.toBe("noop");
      if (menu.kind === "noop") throw new Error("Expected deletion");
      expect(keyboard(score, selection).score).toEqual(menu.score);
      expect(first(menu.score).notes).toHaveLength(1);
      expect(first(menu.score).notes![0]!.markings?.[key]).toBeUndefined();
    }
    expect(score).toEqual(original);
  });

  it("never deletes the parent of an unsupported leaf", () => {
    const score = fixture();
    const selection: Selection = { kind: "single", elementId: "p0/m0/s0/a/unknown-leaf" };
    expect(computeDeleteSelection(score, selection)).toEqual({ kind: "noop" });
    expect(keyboard(score, selection).updateScore).not.toHaveBeenCalled();
    expect(first(score).notes).toHaveLength(1);
  });

  it("wires fermata deletion in the shared computation without weakening parent safety", () => {
    const score = fixture();
    first(score).fermata = {};
    const selection: Selection = { kind: "single", elementId: "p0/m0/s0/a/ferm" };
    const result = computeDeleteSelection(score, selection);
    if (result.kind !== "single") throw new Error("Expected fermata deletion");
    expect(first(result.score).fermata).toBeUndefined();
    expect(first(result.score).notes).toHaveLength(1);
    expect(keyboard(score, selection).score).toEqual(result.score);
    expect(first(score).fermata).toEqual({});
    expect(first(score).notes).toHaveLength(1);
  });

  it("normalizes explicit rest-only sequences in both computation and keyboard", () => {
    const score = fixture();
    for (const event of score.parts[0]!.measures[0]!.sequences[0]!.content) {
      if (event.type !== "event") throw new Error("Expected event");
      delete event.notes;
      event.rest = {};
    }
    const selection: Selection = { kind: "single", elementId: "p0/m0/s0/a" };
    const result = computeDeleteSelection(score, selection);
    if (result.kind !== "single") throw new Error("Expected rest normalization");
    expect(result.score.parts[0]!.measures[0]!.sequences[0]!.fullMeasure).toBeDefined();
    expect(keyboard(score, selection).score.parts[0]!.measures[0]!.sequences[0]!.fullMeasure).toBeDefined();
  });

  it("already shares bar-content clearing without removing bars", () => {
    const score = fixture();
    const original = structuredClone(score);
    first(score).fermata = {};
    const selection: Selection = {
      kind: "measure",
      startMeasure: 0,
      endMeasure: 0,
      startPartIndex: 0,
      endPartIndex: 0,
    };
    const menu = computeDeleteSelection(score, selection);
    if (menu.kind !== "measure") throw new Error("Expected measure clearing");
    const keys = keyboard(score, selection);
    expect(keys.score).toEqual(menu.score);
    expect(keys.score.global.measures).toHaveLength(1);
    expect(keys.score.parts[0]!.measures[0]!.sequences[0]!.content).toEqual([]);
    expect(keys.clearSelection).not.toHaveBeenCalled();
    delete first(score).fermata;
    expect(score).toEqual(original);
  });
});

import { describe, expect, it, vi } from "vitest";
import { applyPatchesToScore, isRest, type NoteEvent, type Score } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import { addNoteAtClick } from "../components/ScoreCanvas/noteInputClickHandler";
import type { NoteInputClickInfo } from "../components/InputCursor";
import { handleDelete } from "../keyboard/normalModeDelete";
import { handleArrowUpDown, handleSlurKey } from "../keyboard/normalModeHandlers";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { addDynamic } from "../radialMenu/radialMenuActions";
import { addDynamicExpression } from "../radialMenu/radialMenuActions";
import { applyArticulationToSelection } from "../radialMenu/applyToSelection";
import type { NoteInputState } from "../store/noteInputStore";
import type { Selection } from "../store/selectionStore";

type EditingContext = "collapsed-condensed" | "expanded-condensed" | "expanded-source-1" | "expanded-source-2";

const CONTEXTS: readonly EditingContext[] = [
  "collapsed-condensed",
  "expanded-condensed",
  "expanded-source-1",
  "expanded-source-2",
];

function note(id: string, step: "C" | "D" | "E" | "F" | "G" | "A", octave = 4): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "half" },
    notes: [{ id: `${id}-n0`, pitch: { step, octave } }],
  };
}

function rest(id: string): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "whole" },
    rest: {},
  };
}

function makeScore(): Score {
  const part = (id: string, unison: readonly ["C" | "G", "D" | "A"]) => ({
    id,
    name: id === "flute-1" ? "Flute 1" : "Flute 2",
    measures: [
      {
        sequences: [
          {
            content: [note(`${id}-u0`, unison[0], 5), note(`${id}-u1`, unison[1], 5)],
          },
        ],
      },
      {
        sequences: [
          {
            content: [
              note(`${id}-a0`, id === "flute-1" ? "E" : "G", 4),
              note(`${id}-a1`, id === "flute-1" ? "F" : "A", 4),
            ],
          },
        ],
      },
      { sequences: [{ content: [rest(`${id}-rest`)] }] },
    ],
  });
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }, {}, {}],
    },
    parts: [part("flute-1", ["C", "D"]), part("flute-2", ["C", "D"])],
    layouts: [
      {
        id: "condensed",
        content: [
          {
            type: "staff",
            sources: [{ part: "flute-1" }, { part: "flute-2" }],
          },
        ],
      },
    ],
    scores: [{ name: "Condensed", layout: "condensed" }],
  };
}

function targetPart(context: EditingContext): 0 | 1 {
  return context === "expanded-source-2" ? 1 : 0;
}

function selectionFor(context: EditingContext, measureIndex: 0 | 1, eventIndex: 0 | 1 = 0): Selection {
  const partIndex = targetPart(context);
  const suffix = measureIndex === 0 ? `u${eventIndex}` : `a${eventIndex}`;
  const elementId = `p${partIndex}/m${measureIndex}/s0/flute-${partIndex + 1}-${suffix}/n0`;
  const expandedSource = context === "expanded-source-1" || context === "expanded-source-2";
  return {
    kind: "single",
    elementId,
    elementType: "note",
    ...(context === "collapsed-condensed"
      ? {}
      : {
          measureAnchor: {
            partIndex,
            staffIndex: expandedSource ? partIndex + 1 : 0,
            measureIndex,
            isExpansion: expandedSource,
          },
        }),
  };
}

function makeKeyboardContext(
  score: Score,
  selection: Selection,
): {
  context: KeyboardHandlerContext;
  current: () => Score;
} {
  let current = score;
  const context = {
    getScore: () => current,
    getSelection: () => selection,
    getConfig: () => ({ selectedScoreIndex: 0 }),
    updateScore: (next: Score) => {
      current = next;
    },
    commitPatches: (patches: Parameters<typeof applyPatchesToScore>[1]) => {
      current = applyPatchesToScore(current, patches);
    },
    clearSelection: vi.fn(),
    previewPitch: vi.fn(),
    getNavIndex: () => null,
  } as unknown as KeyboardHandlerContext;
  return { context, current: () => current };
}

function eventAt(score: Score, partIndex: number, measureIndex: number, eventIndex = 0): NoteEvent {
  return score.parts[partIndex]!.measures[measureIndex]!.sequences[0]!.content[eventIndex] as NoteEvent;
}

function expectedParts(context: EditingContext): readonly number[] {
  return context === "collapsed-condensed" || context === "expanded-condensed" ? [0, 1] : [targetPart(context)];
}

function noteInputDisplayList(context: EditingContext): DisplayList {
  const expanded = context !== "collapsed-condensed";
  const bounds = [{ index: 2, partIndex: 0, staffIndex: 0, systemIndex: 0, x: 200, y: 0, width: 100, height: 40 }];
  if (expanded) {
    bounds.push(
      {
        index: 2,
        partIndex: 0,
        staffIndex: 1,
        systemIndex: 0,
        x: 200,
        y: 100,
        width: 100,
        height: 40,
        isExpansion: true,
      },
      {
        index: 2,
        partIndex: 1,
        staffIndex: 2,
        systemIndex: 0,
        x: 200,
        y: 200,
        width: 100,
        height: 40,
        isExpansion: true,
      },
    );
  }
  return { measureBounds: bounds } as unknown as DisplayList;
}

function addNoteForContext(score: Score, context: EditingContext): Score {
  const sourcePart = targetPart(context);
  const expandedSource = context === "expanded-source-1" || context === "expanded-source-2";
  const staffIndex = expandedSource ? sourcePart + 1 : 0;
  const staffY = expandedSource ? (sourcePart + 1) * 100 : 0;
  let current = score;
  addNoteAtClick({
    info: {
      scoreX: 210,
      scoreY: staffY,
      staffPosition: 0,
      staff: { x: 200, xEnd: 300, y: staffY, spatium: 10, height: 40, index: staffIndex },
      shiftKey: false,
      altKey: false,
    } as NoteInputClickInfo,
    score,
    noteInputState: {
      active: true,
      currentVoice: 1,
      currentDuration: "whole",
      dotCount: 0,
      isRest: false,
      currentAccidental: null,
      tieActive: false,
      slurActive: false,
    } as unknown as NoteInputState,
    spatialIndex: {
      hitTest: () => `p${sourcePart}/m2/s0/flute-${sourcePart + 1}-rest`,
      findNearest: () => null,
    } as never,
    displayList: noteInputDisplayList(context),
    selectedScoreIndex: 0,
    updateScore: (next) => {
      current = next;
    },
    setCursor: vi.fn(),
    setLastPitch: vi.fn(),
    setAccidental: vi.fn(),
    setSlurStart: vi.fn(),
    clearSlurStart: vi.fn(),
    toggleSlur: vi.fn(),
    playbackActions: { previewNote: vi.fn() } as never,
  });
  return current;
}

const keyboardEvent = (key: string): KeyboardEvent => ({ key, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

describe.each(CONTEXTS)("condensed editing automation: %s", (context) => {
  it("adds a note to the intended canonical source events", () => {
    const result = addNoteForContext(makeScore(), context);
    for (let partIndex = 0; partIndex < 2; partIndex++) {
      expect(isRest(eventAt(result, partIndex, 2))).toBe(!expectedParts(context).includes(partIndex));
    }
  });

  it("removes only the selected amalgamated source note", () => {
    const { context: keyboard, current } = makeKeyboardContext(makeScore(), selectionFor(context, 1));
    handleDelete(keyboardEvent("Delete"), false, keyboard);
    for (let partIndex = 0; partIndex < 2; partIndex++) {
      const shouldRemove = partIndex === targetPart(context);
      expect(isRest(eventAt(current(), partIndex, 1))).toBe(shouldRemove);
    }
  });

  it("transposes only the selected amalgamated source note", () => {
    const score = makeScore();
    const before = score.parts.map((_, partIndex) => JSON.stringify(eventAt(score, partIndex, 1).notes![0]!.pitch));
    const { context: keyboard, current } = makeKeyboardContext(score, selectionFor(context, 1));
    handleArrowUpDown({ ...keyboardEvent("ArrowUp"), altKey: true, shiftKey: false } as KeyboardEvent, false, keyboard);
    const after = current().parts.map((_, partIndex) =>
      JSON.stringify(eventAt(current(), partIndex, 1).notes![0]!.pitch),
    );
    expect(after[targetPart(context)]).not.toBe(before[targetPart(context)]);
    expect(after[1 - targetPart(context)]).toBe(before[1 - targetPart(context)]);
  });

  it("applies a dynamic according to condensed/source visibility", () => {
    const result = addDynamic(makeScore(), selectionFor(context, 0), "p", 0)!;
    for (let partIndex = 0; partIndex < 2; partIndex++) {
      expect(result.parts[partIndex]!.measures[0]!.dynamics?.length ?? 0).toBe(
        expectedParts(context).includes(partIndex) ? 1 : 0,
      );
    }
  });

  it("applies a gradual dynamic according to condensed/source visibility", () => {
    const result = addDynamicExpression(
      makeScore(),
      selectionFor(context, 0),
      [{ type: "dynamic", value: "p" }, { type: "crescendo" }, { type: "dynamic", value: "f" }],
      0,
    )!;
    for (let partIndex = 0; partIndex < 2; partIndex++) {
      expect(result.parts[partIndex]!.measures[0]!.dynamics?.length ?? 0).toBe(
        expectedParts(context).includes(partIndex) ? 2 : 0,
      );
    }
  });

  it("applies a slur according to condensed/source visibility", () => {
    const { context: keyboard, current } = makeKeyboardContext(makeScore(), selectionFor(context, 0));
    handleSlurKey(keyboardEvent("s"), keyboard);
    for (let partIndex = 0; partIndex < 2; partIndex++) {
      expect(eventAt(current(), partIndex, 0).slurs?.length ?? 0).toBe(
        expectedParts(context).includes(partIndex) ? 1 : 0,
      );
    }
  });

  it("applies an articulation according to condensed/source visibility", () => {
    const result = applyArticulationToSelection(makeScore(), selectionFor(context, 0), "staccato", 0)!;
    for (let partIndex = 0; partIndex < 2; partIndex++) {
      if (expectedParts(context).includes(partIndex)) {
        expect(eventAt(result, partIndex, 0).markings?.staccato).toEqual({});
      } else {
        expect(eventAt(result, partIndex, 0).markings?.staccato).toBeUndefined();
      }
    }
  });
});

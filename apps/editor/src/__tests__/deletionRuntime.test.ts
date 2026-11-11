import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { MnxYjsBridge } from "@viritura/crdt";
import { executeDeletion } from "../commands/deletion";
import { KeyboardRegistry } from "../keyboard/KeyboardRegistry";
import { buildEditorBindings } from "../keyboard/editorBindings";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { createHistoryStore } from "../store/historyStore";
import type { Selection } from "../store/selectionStore";

const noop = () => {};
const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
});

function fixture(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0", time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "part",
        measures: [
          {
            sequences: [
              {
                content: ["a", "b"].map((id) => ({
                  type: "event" as const,
                  id,
                  duration: { base: "half" as const },
                  notes: [{ id: `${id}-note`, pitch: { step: "C" as const, octave: 4 as const } }],
                  fermata: {},
                })),
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
  if (event?.type !== "event") throw new Error("Expected event");
  return event;
}

function runtime(noteInput = false) {
  let score = fixture();
  let selection: Selection = { kind: "single", elementId: "p0/m0/s0/a/ferm" };
  const updateScore = vi.fn((next: Score) => {
    score = next;
  });
  const setCursor = vi.fn();
  const config = {
    canvasRef: { current: null },
    currentZoom: 1,
    selectedScoreIndex: 0,
    onNewScore: noop,
    onShowHelp: noop,
    onOpenFile: noop,
    onSave: noop,
    onSaveAs: noop,
    onCopy: noop,
    onCut: noop,
    onPaste: noop,
  };
  const ctx: KeyboardHandlerContext = {
    getScore: () => score,
    getSelection: () => selection,
    getConfig: () => config,
    getNavIndex: () => null,
    getNoteInput: () => ({
      active: noteInput,
      currentVoice: 1,
      currentDuration: "half",
      dotCount: 0,
      currentAccidental: null,
      isRest: false,
      currentGraceType: null,
      lastPitch: null,
      cursorPosition: { measureIndex: 0, beatPosition: 4, partIndex: 0, staffIndex: 0 },
      slurActive: false,
      slurStartEventId: null,
      chordLock: false,
      rhythmSource: null,
    }),
    updateScore,
    commitPatches: noop,
    selectRange: noop,
    extendSelection: noop,
    selectElement: (elementId) => {
      selection = { kind: "single", elementId };
    },
    clearSelection: () => {
      selection = { kind: "none" };
    },
    toggleNoteInput: noop,
    setDuration: noop,
    toggleRest: noop,
    toggleDot: noop,
    incrementDot: noop,
    setGraceType: noop,
    toggleGraceActive: noop,
    toggleSlur: noop,
    toggleTie: noop,
    setLastPitch: noop,
    setCursor,
    setSlurStart: noop,
    clearSlurStart: noop,
    setVoice: noop,
    setAccidental: noop,
    toggleChordLock: noop,
    setChordLock: noop,
    setRhythmSource: noop,
    previewPitch: noop,
    undo: noop,
    redo: noop,
  };
  const registry = new KeyboardRegistry();
  registry.setContextCallback(() => (noteInput ? "noteInput" : "normal"));
  registry.setIsInputCallback(() =>
    Boolean(
      document.activeElement?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"),
    ),
  );
  for (const binding of buildEditorBindings({
    canvasRef: config.canvasRef,
    getCurrentZoom: () => 1,
    ctx,
    appCallbacks: config,
    selectAll: noop,
    setVoice: noop,
    toggleNoteInput: noop,
    selectElement: ctx.selectElement,
    clearSelection: ctx.clearSelection,
    undo: noop,
    redo: noop,
    setAccidental: noop,
  }))
    registry.register(binding);
  teardowns.push(registry.install());
  return { ctx, score: () => score, selection: () => selection, updateScore, setCursor };
}

describe("registered deletion command execution", () => {
  it("preserves expanded-source selection provenance when selecting the replacement rest", () => {
    const score = fixture();
    const measureAnchor = { partIndex: 0, staffIndex: 1, measureIndex: 0, isExpansion: true };
    const selectElement = vi.fn();
    const context = {
      getScore: () => score,
      getSelection: (): Selection => ({ kind: "single", elementId: "p0/m0/s0/a", measureAnchor }),
      getScoreIndex: () => 0,
      updateScore: vi.fn(),
      selectElement,
      clearSelection: vi.fn(),
    };
    expect(executeDeletion(context)).toBe(true);
    expect(selectElement).toHaveBeenCalledOnce();
    expect(selectElement).toHaveBeenCalledWith(expect.stringMatching(/^p0\/m0\/s0\//), measureAnchor);
  });

  it.each(["Delete", "Backspace"])("routes actual %s binding through leaf deletion once", (key) => {
    const r = runtime();
    window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
    expect(r.updateScore).toHaveBeenCalledOnce();
    expect(first(r.score()).fermata).toBeUndefined();
    expect(first(r.score()).notes).toHaveLength(1);
    expect(r.selection().kind).toBe("none");
  });

  it.each(["input", "textarea", "select", "editable"])("does not delete score selection with %s focus", (kind) => {
    const r = runtime();
    const input = document.createElement(kind === "editable" ? "div" : kind);
    if (kind === "editable") {
      input.setAttribute("contenteditable", "true");
      input.tabIndex = 0;
    }
    document.body.append(input);
    input.focus();
    try {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
      expect(r.updateScore).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it("preserves exact modifier matching and already-consumed keys", () => {
    const r = runtime();
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", ...modifiers }));
    }
    const event = new KeyboardEvent("keydown", { key: "Delete", cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(r.updateScore).not.toHaveBeenCalled();
  });

  it.each(["Delete", "Backspace"])("keeps physical note-input %s as retraction, not selection deletion", (key) => {
    const r = runtime(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
    expect(r.updateScore).toHaveBeenCalledOnce();
    expect(first(r.score()).fermata).toEqual({});
    expect(
      r
        .score()
        .parts[0]!.measures[0]!.sequences[0]!.content.some((event) => event.type === "event" && event.id === "b"),
    ).toBe(false);
    expect(r.setCursor).toHaveBeenCalledOnce();
    expect(r.selection().kind).toBe("single");
  });

  it("commits one batched deletion to serialized history and CRDT, with exact undo/redo", () => {
    let score = parseMnx(serializeMnx(fixture()));
    const original = JSON.stringify(serializeMnx(score));
    const bridge = new MnxYjsBridge();
    bridge.setMnxJson(original);
    const updates = vi.fn();
    bridge.doc.on("update", updates);
    const history = createHistoryStore(original, {
      current: (json) => {
        score = parseMnx(JSON.parse(json));
        bridge.setMnxJson(json);
      },
    });
    const updateScore = vi.fn((next: Score) => {
      score = next;
      const json = JSON.stringify(serializeMnx(next));
      history.getState().pushState(json, "Delete selection");
      bridge.setMnxJson(json);
    });
    const context = {
      getScore: () => score,
      getSelection: (): Selection => ({
        kind: "multi",
        elementIds: ["p0/m0/s0/a/ferm", "p0/m0/s0/b/ferm", "p0/m0/s0/a/ferm"],
      }),
      getScoreIndex: () => 0,
      updateScore,
      selectElement: noop,
      clearSelection: noop,
    };
    try {
      expect(executeDeletion(context)).toBe(true);
      expect(updateScore).toHaveBeenCalledOnce();
      expect(updates).toHaveBeenCalledOnce();
      expect(history.getState().entries).toHaveLength(2);
      const deleted = JSON.stringify(serializeMnx(score));
      expect(parseMnx(JSON.parse(bridge.getMnxJson()))).toEqual(score);
      expect(executeDeletion(context)).toBe(false);
      expect(updateScore).toHaveBeenCalledOnce();
      expect(history.getState().undo()).toBe(original);
      expect(JSON.parse(bridge.getMnxJson())).toEqual(JSON.parse(original));
      expect(history.getState().redo()).toBe(deleted);
      expect(JSON.parse(bridge.getMnxJson())).toEqual(JSON.parse(deleted));
    } finally {
      bridge.doc.destroy();
    }
  });
});

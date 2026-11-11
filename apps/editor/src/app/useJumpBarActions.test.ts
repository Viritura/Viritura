import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { useJumpBarActions } from "./useJumpBarActions";
import { useEditorMiscActions } from "./useEditorMiscActions";
import { createDocumentStore } from "../store/documentStore";
import { resetSelectionStore, useSelectionActions } from "../store/selectionStore";
import { resetNoteInputStore, useNoteInputStore } from "../store/noteInputStore";

vi.mock("./useJumpBarDestinations", () => ({
  useJumpBarDestinations: () => ({ scoreEntries: [], settings: [] }),
}));

const noop = () => {};
beforeEach(() => {
  resetSelectionStore();
  resetNoteInputStore();
});
afterEach(() => {
  cleanup();
  resetNoteInputStore();
});

describe("jump-bar deletion adapter", () => {
  it("deletes the live score selection during note input without synthesizing keys or moving the cursor", () => {
    const store = createDocumentStore();
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "a",
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      fermata: {},
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const updateScore = vi.fn((next: Score) => store.setState({ workingScore: next }));
    const canvasRef = { current: null };
    const cursor = { measureIndex: 0, beatPosition: 4, partIndex: 0 };
    useNoteInputStore.setState({ active: true, cursorPosition: cursor });
    const hook = renderHook(() => {
      const actions = useSelectionActions();
      const { handleDeleteSelection } = useEditorMiscActions({
        store,
        selection: { kind: "none" },
        updateScore,
        selectElement: actions.selectElement,
        selectRange: noop,
        clearSelection: actions.clearSelection,
        canvasRef,
        currentZoom: 1,
      });
      const catalog = useJumpBarActions({
        onNewScore: noop,
        canvasRef,
        leftPanelRef: { current: null },
        rightPanelRef: { current: null },
        mousePositionRef: { current: { x: 0, y: 0 } },
        store,
        selection: { kind: "none" },
        selectedScoreIndex: 0,
        currentZoom: 1,
        undo: noop,
        redo: noop,
        selectRange: noop,
        handleOpenFile: noop,
        handleOpenProject: noop,
        handleSave: noop,
        handleSaveAs: noop,
        handleExportPdf: noop,
        handleExportSvg: noop,
        handleCopy: noop,
        handleCut: noop,
        handlePaste: noop,
        handlePasteMerge: noop,
        handleDeleteSelection,
        handleExplodeSelection: noop,
        handleReduceSelection: noop,
        handleSelectChordTopNote: noop,
        handleSelectChordBottomNote: noop,
        handleRepeat: noop,
        getSelectedMeasureIndex: () => null,
        setRadialMenu: noop,
        setTempoPopover: noop,
        setStaffTextPopover: noop,
        onEnterLyrics: noop,
        setChordSymbolPopover: noop,
        onOpenActivity: noop,
        onSwitchScore: noop,
      });
      return { catalog, actions };
    });
    const action = hook.result.current.catalog.find((entry) => entry.id === "edit.delete");
    if (!action) throw new Error("Missing deletion action");
    expect(action.enabled?.()).toBe(false);
    act(() => {
      store.setState({ score, workingScore: score });
      hook.result.current.actions.selectElement("p0/m0/s0/a/ferm");
    });
    expect(action.enabled?.()).toBe(true);
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    try {
      act(() => action.execute());
    } finally {
      window.removeEventListener("keydown", onKey);
    }
    expect(onKey).not.toHaveBeenCalled();
    expect(updateScore).toHaveBeenCalledOnce();
    const next = store.getState().workingScore!;
    expect(next.parts[0]!.measures[0]!.sequences[0]!.content[0]).not.toHaveProperty("fermata");
    expect(next.parts[0]!.measures[0]!.sequences[0]!.content[0]).toHaveProperty("notes");
    expect(useNoteInputStore.getState().active).toBe(true);
    expect(useNoteInputStore.getState().cursorPosition).toEqual(cursor);
    expect(action.enabled?.()).toBe(false);
    act(() => action.execute());
    expect(updateScore).toHaveBeenCalledOnce();
  });
});

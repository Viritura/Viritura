import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { useMenuBarWiring } from "./useMenuBarWiring";
import type { MenuBarConfigDeps } from "./useMenuBarConfig";
import { createDocumentStore } from "../store/documentStore";
import { resetSelectionStore, useSelectionActions } from "../store/selectionStore";

const { storeRef } = vi.hoisted(() => ({
  storeRef: { current: undefined as ReturnType<typeof createDocumentStore> | undefined },
}));
vi.mock("../store/DocumentContext", () => ({ useDocumentStoreApi: () => storeRef.current }));
vi.mock("../components/AppShell", () => ({
  useRegisterGlobalMenuCallbacks: vi.fn(),
  useRegisterGlobalMenuState: vi.fn(),
  useRegisterMenuCallbacks: vi.fn(),
  useRegisterMenuState: vi.fn(),
  useRegisterRecentEntries: vi.fn(),
}));

beforeEach(() => {
  resetSelectionStore();
  storeRef.current = createDocumentStore();
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: ["a", "b"].map((id) => ({ id, name: id, measures: [{ sequences: [] }] })),
  };
  storeRef.current.setState({ score });
});
afterEach(cleanup);

function menuDeps(onSwapStaffContents: () => void, canSwapStaffContents: boolean): MenuBarConfigDeps {
  const noop = () => {};
  return {
    hasDocument: true,
    canUndo: false,
    canRedo: false,
    selection: { kind: "none" },
    canTranspose: false,
    canDistribute: false,
    canSwapStaffContents,
    recentScores: [],
    handleOpenFile: noop,
    handleImportFile: noop,
    handleOpenProject: noop,
    handleSelectRecent: noop,
    handleSave: noop,
    handleSaveAs: noop,
    undo: noop,
    redo: noop,
    handleCopy: noop,
    handleCut: noop,
    handlePaste: noop,
    handlePasteMerge: noop,
    handleExplodeSelection: noop,
    handleReduceSelection: noop,
    handleSelectChordTopNote: noop,
    handleSelectChordBottomNote: noop,
    handleDeleteSelection: noop,
    handleDeleteSelectedBars: noop,
    handleSwapStaffContents: onSwapStaffContents,
    handleSelectAll: noop,
    handleZoomIn: noop,
    handleZoomOut: noop,
    handleResetZoom: noop,
    handleSetTimeSignature: noop,
    handleSetKeySignature: noop,
    handleSetRepeatStart: noop,
    handleSetBarline: noop,
    handleSetRepeatEnd: noop,
    handleSetClef: noop,
    handleSetEnding: noop,
    handleExportPdf: noop,
    handleExportSvg: noop,
    onOpenPublish: undefined,
  };
}

describe("live staff-swap context-menu state", () => {
  it.each([false, true])(
    "uses the current selection instead of stale rendered availability: %s",
    (renderedAvailability) => {
      const onSwapStaffContents = vi.fn();
      const deps = menuDeps(onSwapStaffContents, renderedAvailability);
      const { result } = renderHook(() => ({
        actions: useSelectionActions(),
        ...useMenuBarWiring({ ...deps, isActiveView: true, supportsWritePanels: true }),
      }));
      act(() => {
        result.current.actions.selectMeasure(0, 0, 0, 0);
        result.current.actions.extendMeasure(1, 1, 0, 0);
      });
      const swapItem = () =>
        result.current
          .buildSelectionMenuItems({ hasSelection: true })
          .find((item) => item.label === "Swap Staff Contents")!;
      expect(swapItem().disabled).toBe(false);
      swapItem().action?.();
      expect(onSwapStaffContents).toHaveBeenCalledOnce();
      act(() => result.current.actions.selectMeasure(0, 0, 0, 0));
      expect(swapItem().disabled).toBe(true);
      storeRef.current!.setState({ score: null });
      expect(swapItem().disabled).toBe(true);
    },
  );
});

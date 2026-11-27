import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { createDocumentStore } from "../store/documentStore";
import { resetSelectionStore, useSelectionStore } from "../store/selectionStore";
import type { MenuBarConfigDeps } from "./useMenuBarConfig";
import { useMenuBarWiring } from "./useMenuBarWiring";

const store = createDocumentStore();
const onSetHarpPedals = vi.fn();

vi.mock("../store/DocumentContext", () => ({ useDocumentStoreApi: () => store }));
vi.mock("../components/AppShell", () => ({
  useRegisterGlobalMenuCallbacks: () => {},
  useRegisterGlobalMenuState: () => {},
  useRegisterMenuCallbacks: () => {},
  useRegisterMenuState: () => {},
  useRegisterRecentEntries: () => {},
}));
vi.mock("./useMenuBarConfig", () => ({
  useMenuBarConfig: () => ({
    menuCallbacks: { onSetHarpPedals },
    menuState: { hasDocument: true, hasSelection: true, canSetHarpPedals: false },
    recentMenuEntries: [],
  }),
}));

afterEach(() => {
  cleanup();
  resetSelectionStore();
  vi.clearAllMocks();
});

const noop = () => {};
const deps: MenuBarConfigDeps = {
  hasDocument: true,
  canUndo: false,
  canRedo: false,
  selection: { kind: "none" },
  canTranspose: false,
  canDistribute: false,
  canSwapStaffContents: false,
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
  handleSwapStaffContents: noop,
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

function fixture(): Score {
  const part = (id: string, instrumentId: string) => ({
    id,
    name: id,
    _x: { viritura: { instrumentId } },
    measures: [
      {
        sequences: [
          {
            content: [
              {
                type: "event" as const,
                id: `${id}-note`,
                duration: { base: "whole" as const },
                notes: [{ pitch: { step: "C" as const, octave: 4 } }],
              },
            ],
          },
        ],
      },
    ],
  });
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [part("harp", "pluck.harp"), part("flute", "wind.flutes.flute")],
  };
}

describe("score context menu wiring", () => {
  it("uses the synchronously retargeted selection instead of stale rendered harp availability", () => {
    const score = fixture();
    store.setState({ score, workingScore: score });
    const { result } = renderHook(() => useMenuBarWiring({ ...deps, isActiveView: true, supportsWritePanels: true }));

    act(() =>
      useSelectionStore.setState({
        selection: { kind: "single", elementId: "p0/m0/s0/harp-note", elementType: "event" },
      }),
    );
    const harpItems = result.current.buildSelectionMenuItems({ hasSelection: true });
    const harpAction = harpItems.find((item) => item.label === "Set harp pedals");
    expect(harpAction?.disabled).toBe(false);
    harpAction?.action?.();
    expect(onSetHarpPedals).toHaveBeenCalledOnce();

    act(() =>
      useSelectionStore.setState({
        selection: { kind: "single", elementId: "p1/m0/s0/flute-note", elementType: "event" },
      }),
    );
    const fluteItems = result.current.buildSelectionMenuItems({ hasSelection: true });
    expect(fluteItems.find((item) => item.label === "Set harp pedals")?.disabled).toBe(true);
  });
});

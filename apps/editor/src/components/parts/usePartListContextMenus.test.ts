import type { MouseEvent } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ContextMenuState } from "@viritura/ui";
import { usePartListContextMenus, type UsePartListContextMenusArgs } from "./usePartListContextMenus";

afterEach(cleanup);

it("refreshes source policy and update callbacks while the layout stays unchanged", () => {
  const setContextMenu = vi.fn<(state: ContextMenuState | null) => void>();
  const onPartUpdate = vi.fn();
  const args: UsePartListContextMenusArgs = {
    selectedPaths: new Set(),
    buildSelectionMenuItems: () => [],
    setContextMenu,
    removeGroup: vi.fn(),
    updateGroupProp: vi.fn(),
    sourceParts: [{ id: "flute", name: "Flute", measures: [] }],
    onPartUpdate,
    setEditingGroup: vi.fn(),
    setEditingGroupLabel: vi.fn(),
    partIdToScoreIndex: new Map(),
    onSelectScore: vi.fn(),
    ungroupStaff: vi.fn(),
    selectedScoreIndex: 0,
    activeScoreIsConductor: false,
    layoutContent: [{ type: "staff", sources: [{ part: "flute" }] }],
    partDisplayMap: new Map(),
    setDoublingStaffPath: vi.fn(),
  };
  const event = {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    clientX: 10,
    clientY: 20,
  } as unknown as MouseEvent;
  const { result, rerender } = renderHook(usePartListContextMenus, { initialProps: args });
  result.current.openStaffContextMenu(event, "flute", [0], 0);
  const initial = setContextMenu.mock.lastCall?.[0]?.items.find((item) => item.label === "Chord Symbols");
  expect(initial?.children?.find((item) => item.label === "Automatic")?.disabled).toBe(true);

  const updatedCallback = vi.fn();
  rerender({
    ...args,
    sourceParts: [{ ...args.sourceParts[0]!, chordSymbolVisibility: "hide" }],
    onPartUpdate: updatedCallback,
  });
  result.current.openStaffContextMenu(event, "flute", [0], 0);
  const updated = setContextMenu.mock.lastCall?.[0]?.items.find((item) => item.label === "Chord Symbols");
  expect(updated?.children?.find((item) => item.label === "Hide")?.disabled).toBe(true);
  updated?.children?.find((item) => item.label === "Show")?.action?.();
  expect(updatedCallback).toHaveBeenCalledExactlyOnceWith("flute", { chordSymbolVisibility: "show" });
  expect(onPartUpdate).not.toHaveBeenCalled();
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
  expect(event.stopPropagation).toHaveBeenCalledTimes(2);
});

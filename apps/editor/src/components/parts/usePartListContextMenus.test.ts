import type { MouseEvent } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ContextMenuState } from "@viritura/ui";
import { usePartListContextMenus, type UsePartListContextMenusArgs } from "./usePartListContextMenus";
import { buildGroupContextMenuItems } from "./contextMenus";

afterEach(cleanup);

it("offers section-name visibility without renaming the group", () => {
  const updateGroupProp = vi.fn();
  const group = {
    type: "group" as const,
    label: "Woodwinds",
    content: [
      { type: "staff" as const, sources: [{ part: "fl" }] },
      { type: "staff" as const, sources: [{ part: "ob" }] },
    ],
  };
  const deps = {
    updateGroupProp,
    removeGroup: vi.fn(),
    setEditingGroup: vi.fn(),
    setEditingGroupLabel: vi.fn(),
  };
  const menu = buildGroupContextMenuItems(group, [0], deps).find((item) => item.label === "Group name")!;
  expect(menu.disabled).toBe(false);
  expect(menu.children?.[0]?.disabled).toBe(true);
  menu.children?.[1]?.action?.();
  expect(updateGroupProp).toHaveBeenCalledWith([0], "showGroupName", true);
  const shown = buildGroupContextMenuItems({ ...group, showGroupName: true }, [0], deps).find(
    (item) => item.label === "Group name",
  )!;
  shown.children?.[0]?.action?.();
  expect(updateGroupProp).toHaveBeenLastCalledWith([0], "showGroupName", false);
  const instrument = buildGroupContextMenuItems({ ...group, content: [group.content[0]!] }, [0], deps).find(
    (item) => item.label === "Group name",
  )!;
  expect(instrument.disabled).toBe(true);
  expect(group.label).toBe("Woodwinds");
});

it("refreshes source policy and update callbacks while the layout stays unchanged", () => {
  const setContextMenu = vi.fn<(state: ContextMenuState | null) => void>();
  const onPartUpdate = vi.fn();
  const args: UsePartListContextMenusArgs = {
    selectedPaths: new Set(),
    buildSelectionMenuItems: () => [],
    setContextMenu,
    removeGroup: vi.fn(),
    updateGroupProp: vi.fn(),
    sourceParts: [{ id: "wind.flutes.flute", name: "Flute", measures: [] }],
    onPartUpdate,
    setEditingGroup: vi.fn(),
    setEditingGroupLabel: vi.fn(),
    partIdToScoreIndex: new Map(),
    onSelectScore: vi.fn(),
    ungroupStaff: vi.fn(),
    selectedScoreIndex: 0,
    activeScoreIsConductor: false,
    layoutContent: [{ type: "staff", sources: [{ part: "wind.flutes.flute" }] }],
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
  result.current.openStaffContextMenu(event, "wind.flutes.flute", [0], 0);
  const initial = setContextMenu.mock.lastCall?.[0]?.items.find((item) => item.label === "Chord Symbols");
  expect(initial?.children?.find((item) => item.label === "Automatic")?.disabled).toBe(true);

  const updatedCallback = vi.fn();
  rerender({
    ...args,
    sourceParts: [{ ...args.sourceParts[0]!, chordSymbolVisibility: "hide" }],
    onPartUpdate: updatedCallback,
  });
  result.current.openStaffContextMenu(event, "wind.flutes.flute", [0], 0);
  const updated = setContextMenu.mock.lastCall?.[0]?.items.find((item) => item.label === "Chord Symbols");
  expect(updated?.children?.find((item) => item.label === "Hide")?.disabled).toBe(true);
  updated?.children?.find((item) => item.label === "Show")?.action?.();
  expect(updatedCallback).toHaveBeenCalledExactlyOnceWith("wind.flutes.flute", { chordSymbolVisibility: "show" });
  expect(onPartUpdate).not.toHaveBeenCalled();
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
  expect(event.stopPropagation).toHaveBeenCalledTimes(2);
});

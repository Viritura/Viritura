import { describe, it, expect, vi } from "vitest";
import { buildSelectionContextMenuItems } from "../components/selectionContextMenuItems";
import type { MenuBarCallbacks, MenuBarState } from "../components/menuBarItems";

const callbacks: MenuBarCallbacks = {
  onCut: () => {},
  onCopy: () => {},
  onPaste: () => {},
  onPasteMerge: () => {},
  onDelete: () => {},
  onSelectAll: () => {},
  onExplodeSelection: () => {},
  onReduceSelection: () => {},
  onSelectChordTopNote: () => {},
  onSelectChordBottomNote: () => {},
};

const labels = (items: readonly { label?: string; separator?: boolean }[]) =>
  items.filter((i) => !i.separator).map((i) => i.label);

const enabled = (items: readonly { label?: string; disabled?: boolean }[], label: string) =>
  !items.find((i) => i.label === label)?.disabled;

describe("buildSelectionContextMenuItems", () => {
  const state: MenuBarState = { hasDocument: true, hasSelection: false };

  it("offers the clipboard and chord distribution commands", () => {
    const items = buildSelectionContextMenuItems(callbacks, state, { hasSelection: true });
    expect(labels(items)).toEqual([
      "Cut",
      "Copy",
      "Paste",
      "Paste and Merge",
      "Delete",
      "Explode to Staves",
      "Reduce to Staff",
      "Select Top Note of Chords",
      "Select Bottom Note of Chords",
      "Select All",
    ]);
  });

  it("enables selection commands from the click target before the store re-renders", () => {
    // The right-click selects an element, but `state.hasSelection` still
    // reflects the pre-click render.
    const items = buildSelectionContextMenuItems(callbacks, state, { hasSelection: true });
    for (const label of ["Cut", "Copy", "Delete", "Explode to Staves", "Reduce to Staff"]) {
      expect(enabled(items, label), label).toBe(true);
    }
  });

  it("disables selection commands when the click missed every element", () => {
    const items = buildSelectionContextMenuItems(callbacks, state, { hasSelection: false });
    for (const label of ["Cut", "Copy", "Delete", "Explode to Staves", "Reduce to Staff"]) {
      expect(enabled(items, label), label).toBe(false);
    }
    // Commands that don't need a selection stay available.
    expect(enabled(items, "Paste")).toBe(true);
    expect(enabled(items, "Select All")).toBe(true);
  });

  it("keeps a live selection when the click lands on empty space", () => {
    const items = buildSelectionContextMenuItems(callbacks, { ...state, hasSelection: true }, { hasSelection: false });
    expect(enabled(items, "Copy")).toBe(true);
  });

  it("omits unavailable commands and the separators they would strand", () => {
    const items = buildSelectionContextMenuItems(
      { onPaste: callbacks.onPaste, onSelectAll: callbacks.onSelectAll },
      state,
      { hasSelection: false },
    );
    expect(labels(items)).toEqual(["Paste", "Select All"]);
    expect(items[0]?.separator).toBeFalsy();
    expect(items[items.length - 1]?.separator).toBeFalsy();
  });

  it("wires each item to its callback", () => {
    const onReduceSelection = vi.fn();
    const items = buildSelectionContextMenuItems({ ...callbacks, onReduceSelection }, state, { hasSelection: true });
    items.find((i) => i.label === "Reduce to Staff")?.action?.();
    expect(onReduceSelection).toHaveBeenCalledTimes(1);
  });
});

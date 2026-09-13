import { describe, expect, it, vi } from "vitest";
import type { LayoutStaff } from "@viritura/core";
import { buildStaffContextMenuItems } from "./contextMenus";
import { setStaffChordSymbolVisibility } from "./usePartListLayout";

describe("buildStaffContextMenuItems", () => {
  it("exposes the layout-staff chord-symbol visibility policy", () => {
    const staff: LayoutStaff = {
      type: "staff",
      sources: [{ part: "piano", staff: 1 }],
      chordSymbolVisibility: "hide",
    };
    const updateVisibility = vi.fn();
    const items = buildStaffContextMenuItems("piano", [0], 0, {
      partIdToScoreIndex: new Map(),
      onSelectScore: vi.fn(),
      ungroupStaff: vi.fn(),
      updateStaffChordSymbolVisibility: updateVisibility,
      selectedScoreIndex: 0,
      activeScoreIsConductor: false,
      layoutContent: [staff],
      partDisplayMap: new Map(),
      setDoublingStaffPath: vi.fn(),
    });
    const chordMenu = items.find((item) => item.label === "Chord Symbols");

    expect(chordMenu?.children?.find((item) => item.label === "Hide")?.disabled).toBe(true);
    chordMenu?.children?.find((item) => item.label === "Show")?.action?.();
    expect(updateVisibility).toHaveBeenCalledWith([0], "show");
  });

  it("stores explicit visibility and removes automatic defaults", () => {
    const staff: LayoutStaff = { type: "staff", sources: [{ part: "piano", staff: 1 }] };

    const shown = setStaffChordSymbolVisibility([staff], [0], "show");
    const automatic = setStaffChordSymbolVisibility(shown, [0], "auto");

    expect(shown[0]).toMatchObject({ chordSymbolVisibility: "show" });
    expect(automatic[0]).not.toHaveProperty("chordSymbolVisibility");
  });
});

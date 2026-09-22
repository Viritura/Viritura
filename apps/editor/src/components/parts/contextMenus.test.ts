import { describe, expect, it, vi } from "vitest";
import type { LayoutStaff, Part } from "@viritura/core";
import { buildStaffContextMenuItems, type StaffContextMenuDeps } from "./contextMenus";

function makeDeps(overrides: Partial<StaffContextMenuDeps> = {}): StaffContextMenuDeps {
  return {
    partIdToScoreIndex: new Map(),
    onSelectScore: vi.fn(),
    ungroupStaff: vi.fn(),
    sourceParts: [{ id: "piano", name: "Piano", measures: [] }],
    onPartUpdate: vi.fn(),
    selectedScoreIndex: 0,
    activeScoreIsConductor: false,
    layoutContent: [{ type: "staff", sources: [{ part: "piano", staff: 1 }] }],
    partDisplayMap: new Map(),
    setDoublingStaffPath: vi.fn(),
    ...overrides,
  };
}

function chordMenu(deps: StaffContextMenuDeps, partId = "piano", path = [0]) {
  return buildStaffContextMenuItems(partId, path, 0, deps).find((item) => item.label === "Chord Symbols");
}

describe("source Part chord-symbol visibility", () => {
  it.each([
    [undefined, "Automatic"],
    ["auto", "Automatic"],
    ["show", "Show"],
    ["hide", "Hide"],
  ] as const)("reads %s from the actual Part", (chordSymbolVisibility, label) => {
    const deps = makeDeps({
      sourceParts: [{ id: "piano", name: "Piano", measures: [], chordSymbolVisibility }],
    });
    const items = chordMenu(deps)?.children;
    expect(items?.map((item) => item.label)).toEqual(["Automatic", "Show", "Hide"]);
    expect(items?.filter((item) => item.disabled).map((item) => item.label)).toEqual([label]);
  });

  it.each([
    ["Automatic", "auto"],
    ["Show", "show"],
    ["Hide", "hide"],
  ])("sends only the %s source policy, never a layout path", (label, value) => {
    const deps = makeDeps();
    const before = structuredClone({ parts: deps.sourceParts, layouts: deps.layoutContent });
    chordMenu(deps)
      ?.children?.find((item) => item.label === label)
      ?.action?.();
    expect(deps.onPartUpdate).toHaveBeenCalledExactlyOnceWith("piano", { chordSymbolVisibility: value });
    expect({ parts: deps.sourceParts, layouts: deps.layoutContent }).toEqual(before);
  });

  it("ignores the row's guessed part ID and resolves nested layout sources", () => {
    const deps = makeDeps({
      layoutContent: [
        {
          type: "group",
          content: [{ type: "staff", sources: [{ part: "piano", staff: 2 }] }],
        },
      ],
    });
    chordMenu(deps, "unrelated", [0, 0])
      ?.children?.find((item) => item.label === "Hide")
      ?.action?.();
    expect(deps.onPartUpdate).toHaveBeenCalledExactlyOnceWith("piano", { chordSymbolVisibility: "hide" });
  });

  it("offers explicit, independently checked sources for a condensed/doubling staff", () => {
    const sourceParts: Part[] = [
      { id: "unrelated", name: "Unrelated", measures: [], chordSymbolVisibility: "show" },
      { id: "flute", name: "Flute", measures: [], chordSymbolVisibility: "hide" },
      { id: "piccolo", name: "Piccolo", measures: [], chordSymbolVisibility: "show" },
    ];
    const staff: LayoutStaff = {
      type: "staff",
      sources: [
        { part: "piccolo", staff: 1 },
        { part: "flute", staff: 1 },
        { part: "flute", staff: 2 },
      ],
    };
    const deps = makeDeps({ sourceParts, layoutContent: [staff] });
    const sources = chordMenu(deps, "unrelated")?.children;
    expect(sources?.map((item) => item.label)).toEqual(["Piccolo (piccolo)", "Flute (flute)"]);
    expect(sources?.[0]?.children?.find((item) => item.label === "Show")?.disabled).toBe(true);
    expect(sources?.[1]?.children?.find((item) => item.label === "Hide")?.disabled).toBe(true);
    sources?.[1]?.children?.find((item) => item.label === "Show")?.action?.();
    expect(deps.onPartUpdate).toHaveBeenCalledExactlyOnceWith("flute", { chordSymbolVisibility: "show" });
  });

  it("shows the same source policy on separate grand-staff rows", () => {
    const deps = makeDeps({
      sourceParts: [{ id: "piano", name: "Piano", measures: [], chordSymbolVisibility: "hide" }],
      layoutContent: [
        { type: "staff", sources: [{ part: "piano", staff: 1 }] },
        { type: "staff", sources: [{ part: "piano", staff: 2 }] },
      ],
    });
    for (const path of [[0], [1]]) {
      expect(chordMenu(deps, "piano", path)?.children?.find((item) => item.label === "Hide")?.disabled).toBe(true);
    }
  });

  it("deduplicates a single Part's staff/voice sources into one policy menu", () => {
    const deps = makeDeps({
      layoutContent: [
        {
          type: "staff",
          sources: [
            { part: "piano", staff: 1 },
            { part: "piano", staff: 2 },
          ],
        },
      ],
    });
    expect(chordMenu(deps)?.children?.map((item) => item.label)).toEqual(["Automatic", "Show", "Hide"]);
  });

  it("does not fall back to a roster index for missing source IDs", () => {
    const deps = makeDeps({
      layoutContent: [{ type: "staff", sources: [{ part: "missing" }, { part: "piano" }] }],
    });
    const sources = chordMenu(deps)?.children;
    expect(sources?.[0]).toMatchObject({ label: "missing (missing)", disabled: true });
    expect(sources?.[0]?.children).toBeUndefined();
    sources?.[1]?.children?.find((item) => item.label === "Hide")?.action?.();
    expect(deps.onPartUpdate).toHaveBeenCalledExactlyOnceWith("piano", { chordSymbolVisibility: "hide" });
  });

  it("disables unresolved, empty, and read-only staff controls", () => {
    expect(chordMenu(makeDeps({ sourceParts: [] }))?.disabled).toBe(true);
    expect(chordMenu(makeDeps({ layoutContent: [{ type: "staff", sources: [] }] }))?.disabled).toBe(true);
    const readOnly = chordMenu(makeDeps({ onPartUpdate: undefined }));
    expect(readOnly?.disabled).toBe(true);
    expect(readOnly?.children?.every((item) => item.disabled && !item.action)).toBe(true);
  });

  it("does not expose a policy for an invalid path or group node", () => {
    expect(chordMenu(makeDeps(), "piano", [9])).toBeUndefined();
    expect(chordMenu(makeDeps({ layoutContent: [{ type: "group", content: [] }] }))).toBeUndefined();
  });
});

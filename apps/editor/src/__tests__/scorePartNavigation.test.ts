import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { adjacentScoreIndex, togglePanels } from "../app/useAppKeyboardWiring";

describe("adjacentScoreIndex", () => {
  it("wraps from the last score or part to the first", () => {
    expect(adjacentScoreIndex(3, 4, 1)).toBe(0);
  });

  it("wraps from the first score or part to the last", () => {
    expect(adjacentScoreIndex(0, 4, -1)).toBe(3);
  });

  it("does not navigate when there is only one view", () => {
    expect(adjacentScoreIndex(0, 1, 1)).toBeNull();
  });
});

describe("togglePanels", () => {
  it("reopens the left panel without reopening a right properties panel", () => {
    const left = { collapse: vi.fn(), expand: vi.fn(), isCollapsed: () => true } as unknown as PanelImperativeHandle;
    const right = { collapse: vi.fn(), expand: vi.fn(), isCollapsed: () => true } as unknown as PanelImperativeHandle;

    togglePanels({ current: left }, { current: right });

    expect(left.expand).toHaveBeenCalledOnce();
    expect(right.expand).not.toHaveBeenCalled();
  });
});

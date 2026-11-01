// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useViewport } from "./useViewport";

const { reclamp } = vi.hoisted(() => ({
  reclamp: vi.fn<(args: { hasUserPositionedViewportRef: { current: boolean } }) => void>(),
}));
vi.mock("./useViewportEffects", () => ({
  useViewportReclamp: reclamp,
  useViewportWheel: vi.fn(),
  useViewportPinch: vi.fn(),
  useViewportMouseDrag: vi.fn(),
}));

beforeEach(() => reclamp.mockClear());

describe("programmatic viewport navigation", () => {
  it("retains an explicit scroll position across later layout changes until reset", () => {
    const { result } = renderHook(() => useViewport({ contentWidth: 2000, contentHeight: 3000, initialZoom: 1 }));
    const container = document.createElement("div");
    Object.defineProperties(container, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    result.current.containerRef.current = container;
    const positioned = () => reclamp.mock.calls.at(-1)?.[0].hasUserPositionedViewportRef.current;
    expect(positioned()).toBe(false);
    act(() => result.current.setScroll(100, 200));
    expect(positioned()).toBe(true);
    expect(result.current.viewport.scrollX).toBe(100);
    expect(result.current.viewport.scrollY).toBe(200);
    act(() => result.current.resetViewport());
    expect(positioned()).toBe(false);
  });
});

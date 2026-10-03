import { describe, expect, it, vi } from "vitest";
import type React from "react";
import type { Score } from "@viritura/core";
import type { CanvasHandlerCtx } from "../canvasHandlers";
import { handleCanvasClickImpl } from "../canvasHandlers";
import { topmostTextFrameAt } from "../textFrameHit";

const displayList = {
  width: 800,
  height: 600,
  commands: [],
  elementBboxes: [
    { elementId: "text-frame/back", bbox: { x: 0, y: 0, width: 100, height: 100 } },
    { elementId: "p0/m0/s0/note1", bbox: { x: 55, y: 55, width: 5, height: 5 } },
    { elementId: "text-frame/front", bbox: { x: 50, y: 50, width: 100, height: 100 } },
  ],
};

describe("topmostTextFrameAt", () => {
  it("returns the last-painted frame containing the point", () => {
    expect(topmostTextFrameAt(displayList, 57, 57)).toBe("text-frame/front");
    expect(topmostTextFrameAt(displayList, 10, 10)).toBe("text-frame/back");
    expect(topmostTextFrameAt(displayList, 400, 400)).toBeNull();
    expect(topmostTextFrameAt(null, 10, 10)).toBeNull();
  });
});

function context(interactionMode: "engrave" | "write") {
  const selectElement = vi.fn();
  const score: Score = { mnx: { version: 1 }, global: { measures: [{}] }, parts: [] };
  const ctx = {
    viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
    viewMode: "horizon",
    selectedIds: null,
    performanceOverlayEnabled: false,
    canvasRef: {
      current: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement,
    },
    // The spatial index prefers the smallest box, i.e. the note under the frame.
    spatialIndexRef: { current: { hitTest: () => "p0/m0/s0/note1", findNearest: () => null } },
    displayListRef: { current: displayList },
    displayListVersionRef: { current: 1 },
    perfTrackerRef: { current: { handleClick: () => false } },
    dragOccurredRef: { current: false },
    spannerDragRef: { current: null },
    interactionModeRef: { current: interactionMode },
    pageSetupRef: { current: { margins: { left: 0 } } },
    engraveAdornmentsRef: { current: undefined },
    selectedSlurIdRef: { current: null },
    docScoreRef: { current: score },
    selectElement,
    selectElements: vi.fn(),
    extendSelection: vi.fn(),
    toggleSelection: vi.fn(),
    clearSelection: vi.fn(),
    setSelectedSlurId: vi.fn(),
    previewChord: vi.fn(),
    onEngraveEmptyClickRef: { current: vi.fn() },
  } as unknown as CanvasHandlerCtx;
  return { ctx, selectElement };
}

const click = { clientX: 57, clientY: 57, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };

describe("canvas clicks on painted text frames", () => {
  it.each(["engrave", "write"] as const)("select the topmost frame over the notation beneath (%s)", (mode) => {
    const { ctx, selectElement } = context(mode);
    handleCanvasClickImpl(click as React.MouseEvent<HTMLCanvasElement>, ctx);
    expect(selectElement).toHaveBeenCalledWith("text-frame/front");
  });
});

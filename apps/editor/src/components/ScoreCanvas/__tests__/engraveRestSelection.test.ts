import { describe, expect, it, vi } from "vitest";
import type React from "react";
import type { Score } from "@viritura/core";
import type { CanvasHandlerCtx } from "../canvasHandlers";
import { handleCanvasClickImpl } from "../canvasHandlers";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", id: "note1", duration: { base: "quarter" }, notes: [] },
                  { type: "event", id: "rest1", duration: { base: "quarter" }, rest: {} },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function context(hitId: string) {
  const selectElement = vi.fn();
  const clearSelection = vi.fn();
  const ctx = {
    viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
    viewMode: "horizon",
    selectedIds: null,
    performanceOverlayEnabled: false,
    canvasRef: {
      current: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      } as HTMLCanvasElement,
    },
    spatialIndexRef: {
      current: {
        hitTest: () => hitId,
        findNearest: () => null,
      },
    },
    displayListRef: { current: null },
    displayListVersionRef: { current: 1 },
    perfTrackerRef: { current: { handleClick: () => false } },
    dragOccurredRef: { current: false },
    spannerDragRef: { current: null },
    interactionModeRef: { current: "engrave" },
    pageSetupRef: { current: { margins: { left: 0 } } },
    engraveAdornmentsRef: { current: undefined },
    selectedSlurIdRef: { current: null },
    docScoreRef: { current: score() },
    selectElement,
    extendSelection: vi.fn(),
    toggleSelection: vi.fn(),
    clearSelection,
    setSelectedSlurId: vi.fn(),
    onEngraveEmptyClickRef: { current: vi.fn() },
  } as unknown as CanvasHandlerCtx;
  return { ctx, selectElement, clearSelection };
}

const click = {
  clientX: 10,
  clientY: 10,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
} as React.MouseEvent<HTMLCanvasElement>;

describe("Engrave-mode rest selection", () => {
  it("selects a rest through the shared notation selection", () => {
    const { ctx, selectElement, clearSelection } = context("p0/m0/s0/rest1");

    handleCanvasClickImpl(click, ctx);

    expect(selectElement).toHaveBeenCalledWith("p0/m0/s0/rest1");
    expect(clearSelection).not.toHaveBeenCalled();
  });

  it("does not make note events generally selectable in Engrave mode", () => {
    const { ctx, selectElement, clearSelection } = context("p0/m0/s0/note1");

    handleCanvasClickImpl(click, ctx);

    expect(selectElement).not.toHaveBeenCalled();
    expect(clearSelection).toHaveBeenCalledOnce();
  });
});

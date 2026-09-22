import { describe, expect, it, vi } from "vitest";
import type React from "react";
import type { DisplayList } from "@viritura/renderer";

import {
  handleCanvasClickImpl,
  handleCanvasMouseDownImpl,
  handleCanvasMouseUpImpl,
  handleCanvasPointerCancelImpl,
  type CanvasHandlerCtx,
} from "../canvasHandlers";

function context() {
  const clearSelection = vi.fn();
  const selectMeasure = vi.fn();
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
        hitTest: () => null,
        findNearest: () => null,
      },
    },
    displayListRef: {
      current: {
        width: 800,
        height: 600,
        commands: [],
        measureBounds: [
          {
            index: 2,
            partIndex: 0,
            staffIndex: 0,
            x: 100,
            y: 100,
            width: 200,
            height: 48,
            prefixWidth: 0,
            totalBeats: 4,
            beatAnchors: [],
          },
        ],
      } as DisplayList,
    },
    displayListVersionRef: { current: 1 },
    perfTrackerRef: { current: { handleClick: () => false } },
    dragOccurredRef: { current: false },
    mouseDownPosRef: { current: null },
    panPointerIdRef: { current: null },
    dragLockRef: { current: false },
    spannerDragRef: { current: null },
    slurHandleDragRef: { current: null },
    textExpressionDragRef: { current: null },
    interactionModeRef: { current: "write" },
    selectedSlurIdRef: { current: null },
    docScoreRef: { current: null },
    clearSelection,
    selectMeasure,
  } as unknown as CanvasHandlerCtx;
  return { ctx, clearSelection, selectMeasure };
}

function pointerEvent(
  button: number,
  pointerId: number,
  target: Pick<HTMLCanvasElement, "setPointerCapture" | "hasPointerCapture" | "releasePointerCapture">,
) {
  return {
    button,
    pointerId,
    preventDefault: vi.fn(),
    currentTarget: target,
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

describe("ScoreCanvas pointer behavior", () => {
  it("captures and releases a middle-button pan pointer without starting selection", () => {
    const { ctx, selectMeasure } = context();
    const target = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    };
    const down = pointerEvent(1, 4, target);

    handleCanvasMouseDownImpl(down, ctx);

    expect(down.preventDefault).not.toHaveBeenCalled();
    expect(target.setPointerCapture).toHaveBeenCalledWith(4);
    expect(ctx.panPointerIdRef.current).toBe(4);
    expect(selectMeasure).not.toHaveBeenCalled();

    handleCanvasMouseUpImpl(pointerEvent(1, 4, target), ctx);

    expect(target.releasePointerCapture).toHaveBeenCalledWith(4);
    expect(ctx.panPointerIdRef.current).toBeNull();
  });

  it("cleans up a captured middle-button pan when the pointer is cancelled", () => {
    const { ctx } = context();
    const target = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    };

    handleCanvasMouseDownImpl(pointerEvent(1, 4, target), ctx);
    handleCanvasPointerCancelImpl(pointerEvent(1, 4, target), ctx);

    expect(target.releasePointerCapture).toHaveBeenCalledWith(4);
    expect(ctx.panPointerIdRef.current).toBeNull();
  });

  it("clears selection when blank padding outside a measure is clicked", () => {
    const { ctx, clearSelection, selectMeasure } = context();

    handleCanvasClickImpl(
      {
        clientX: 180,
        clientY: 80,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      } as React.MouseEvent<HTMLCanvasElement>,
      ctx,
    );

    expect(clearSelection).toHaveBeenCalledOnce();
    expect(selectMeasure).not.toHaveBeenCalled();
  });
});

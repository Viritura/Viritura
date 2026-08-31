import { describe, expect, it, vi } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import type { DisplayList, RenderCommand, SlurGeometry } from "@viritura/renderer";
import { handleCanvasClickImpl, handleCanvasMouseDownImpl, type CanvasHandlerCtx } from "../canvasHandlers";
import { snappedSlurAnchorDelta } from "../slurAnchorSnap";
import { suppressElementCommands } from "../dragPreviewSuppression";

function note(id: string, slurs?: NoteEvent["slurs"]): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [{ pitch: { step: "C", octave: 4 } }],
    ...(slurs ? { slurs } : {}),
  };
}

function score(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [{ content: [note("source", [{ target: "target" }]), note("target"), note("new-target")] }],
          },
        ],
      },
    ],
  };
}

const geometry: SlurGeometry = {
  elementId: "slur/source/target",
  p0x: 20,
  p0y: 20,
  p1x: 40,
  p1y: 0,
  p2x: 80,
  p2y: 0,
  p3x: 100,
  p3y: 20,
  thickness: 2,
  curveDir: -1,
  sp: 10,
};

const slurCommand: Extract<RenderCommand, { type: "DrawFilledBezier" }> = {
  type: "DrawFilledBezier",
  x1: 20,
  y1: 20,
  x2: 100,
  y2: 20,
  ocx1: 40,
  ocy1: -1,
  ocx2: 80,
  ocy2: -1,
  icx1: 40,
  icy1: 1,
  icx2: 80,
  icy2: 1,
  ix1: 20,
  iy1: 20.4,
  ix2: 100,
  iy2: 20.4,
  color: "#000000",
  line_style: 0,
};

function context() {
  const selectedSlurIdRef = { current: null as string | null };
  const selectElement = vi.fn();
  const commitSlurReanchor = vi.fn();
  const onEngraveSlurShapeEdit = vi.fn();
  const bboxes = new Map([
    ["p0/m0/s0/source", { x: 15, y: 15, width: 10, height: 10 }],
    ["p0/m0/s0/target", { x: 95, y: 15, width: 10, height: 10 }],
    ["p0/m0/s0/new-target", { x: 195, y: 75, width: 10, height: 10 }],
  ]);
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  } as HTMLCanvasElement;
  const displayList = {
    width: 800,
    height: 600,
    commands: [slurCommand],
    elementIds: ["slur/source/target"],
    slurGeometries: [geometry],
  } as unknown as DisplayList;
  const ctx = {
    viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
    viewMode: "horizon",
    selectedIds: new Set(["slur/source/target"]),
    performanceOverlayEnabled: false,
    canvasRef: { current: canvas },
    spatialIndexRef: {
      current: {
        hitTest: () => null,
        findNearest: () => null,
        getBBox: (id: string) => bboxes.get(id),
      },
    },
    displayListRef: { current: displayList },
    displayListVersionRef: { current: 1 },
    perfTrackerRef: { current: { handleClick: () => false } },
    dragOccurredRef: { current: false },
    mouseDownPosRef: { current: null },
    dragLockRef: { current: false },
    spannerDragRef: { current: null },
    slurHandleDragRef: { current: null },
    textExpressionDragRef: { current: null },
    interactionModeRef: { current: "write" },
    selectedSlurIdRef,
    docScoreRef: { current: score() },
    repaintRef: { current: vi.fn() },
    repaint: vi.fn(),
    setSelectedSlurId: (id: string | null) => {
      selectedSlurIdRef.current = id;
    },
    selectElement,
    commitSlurReanchor,
    onEngraveSlurShapeEditRef: { current: onEngraveSlurShapeEdit },
    setEngraveHoverCursor: vi.fn(),
    toggleNoteInput: vi.fn(),
  } as unknown as CanvasHandlerCtx;
  return { ctx, selectedSlurIdRef, selectElement, commitSlurReanchor, onEngraveSlurShapeEdit };
}

describe("Write-mode slur endpoint dragging", () => {
  it("suppresses only the engine-rendered slur while its preview is active", () => {
    const noteCommand = { ...slurCommand, x1: 300, x2: 380 };
    const displayList = {
      width: 800,
      height: 600,
      commands: [slurCommand, noteCommand],
      elementIds: ["slur/source/target", "p0/m0/s0/note"],
    } as DisplayList;

    const suppressed = suppressElementCommands(displayList, "slur/source/target");

    expect(suppressed.commands).toEqual([noteCommand]);
    expect(suppressed.elementIds).toEqual(["p0/m0/s0/note"]);
    expect(displayList.commands).toHaveLength(2);
  });

  it("previews the anchor-to-anchor delta rather than the raw pointer delta", () => {
    expect(
      snappedSlurAnchorDelta(
        [
          { x: 100, y: 20, eventId: "target", measureIndex: 0 },
          { x: 200, y: 80, eventId: "new-target", measureIndex: 0 },
        ],
        "target",
        194,
        76,
      ),
    ).toEqual({ dx: 100, dy: 60 });
  });

  it("selects a clicked slur and exposes its endpoint handles", () => {
    const { ctx, selectedSlurIdRef, selectElement } = context();
    handleCanvasClickImpl(
      {
        clientX: 60,
        clientY: 5,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      } as React.MouseEvent<HTMLCanvasElement>,
      ctx,
    );
    expect(selectedSlurIdRef.current).toBe("slur/source/target");
    expect(selectElement).toHaveBeenCalledWith("slur/source/target");
  });

  it("snaps an endpoint drag to the nearest note in two dimensions", () => {
    const { ctx, selectedSlurIdRef, commitSlurReanchor } = context();
    selectedSlurIdRef.current = "slur/source/target";

    handleCanvasMouseDownImpl(
      {
        button: 0,
        clientX: 100,
        clientY: 20,
        altKey: false,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent<HTMLCanvasElement>,
      ctx,
    );
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 80 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 200, clientY: 80 }));

    expect(commitSlurReanchor).toHaveBeenCalledWith("slur/source/target", "end", "new-target");
  });

  it("does not offer the source event as an end-handle snap target", () => {
    const { ctx, selectedSlurIdRef } = context();
    selectedSlurIdRef.current = "slur/source/target";

    handleCanvasMouseDownImpl(
      {
        button: 0,
        clientX: 100,
        clientY: 20,
        altKey: false,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent<HTMLCanvasElement>,
      ctx,
    );

    expect(ctx.slurHandleDragRef.current?.anchor?.points.map((point) => point.eventId)).toEqual([
      "target",
      "new-target",
    ]);
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 100, clientY: 20 }));
  });

  it("does not offer the target event as a start-handle snap target", () => {
    const { ctx, selectedSlurIdRef } = context();
    selectedSlurIdRef.current = "slur/source/target";

    handleCanvasMouseDownImpl(
      {
        button: 0,
        clientX: 20,
        clientY: 20,
        altKey: false,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent<HTMLCanvasElement>,
      ctx,
    );

    expect(ctx.slurHandleDragRef.current?.anchor?.points.map((point) => point.eventId)).toEqual([
      "source",
      "new-target",
    ]);
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 20, clientY: 20 }));
  });

  it("uses endpoint drags only to reshape the slur in Engrave mode", () => {
    const { ctx, selectedSlurIdRef, commitSlurReanchor, onEngraveSlurShapeEdit } = context();
    ctx.interactionModeRef.current = "engrave";
    selectedSlurIdRef.current = "slur/source/target";

    handleCanvasMouseDownImpl(
      {
        button: 0,
        clientX: 100,
        clientY: 20,
        altKey: false,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent<HTMLCanvasElement>,
      ctx,
    );
    expect(ctx.slurHandleDragRef.current?.anchor).toBeUndefined();

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 110, clientY: 26 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 110, clientY: 26 }));

    expect(commitSlurReanchor).not.toHaveBeenCalled();
    expect(onEngraveSlurShapeEdit).toHaveBeenCalledWith("slur/source/target", { p3: [1, 0.6] });
  });
});

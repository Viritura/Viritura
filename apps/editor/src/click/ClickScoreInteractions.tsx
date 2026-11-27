import { useEffect, type RefObject } from "react";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";

const DRAG_THRESHOLD = 6;

interface ClickScoreInteractionsProps {
  readonly canvasRef: RefObject<Pick<ScoreCanvasHandle, "getViewportElement" | "getViewport" | "setScroll"> | null>;
  readonly enabled: boolean;
}

export function ClickScoreInteractions({ canvasRef, enabled }: ClickScoreInteractionsProps) {
  useEffect(() => {
    const viewportElement = canvasRef.current?.getViewportElement();
    if (!viewportElement) return;
    const viewport: HTMLElement = viewportElement;
    const previousCursor = viewport.style.cursor;
    const previousTouchAction = viewport.style.touchAction;
    viewport.style.cursor = enabled ? "grab" : "default";
    viewport.style.touchAction = enabled ? "none" : previousTouchAction;
    let drag:
      | {
          pointerId: number;
          x: number;
          y: number;
          left: number;
          top: number;
          zoom: number;
          moved: boolean;
        }
      | undefined;
    let suppressClick = false;

    function finish(): void {
      const current = drag;
      drag = undefined;
      viewport.style.cursor = enabled ? "grab" : "default";
      if (current && viewport.hasPointerCapture(current.pointerId)) {
        viewport.releasePointerCapture(current.pointerId);
      }
    }

    function down(event: PointerEvent): void {
      if (event.pointerType === "touch" && !event.isPrimary && drag) {
        finish();
        suppressClick = true;
        return;
      }
      if (!enabled || !event.isPrimary || event.button !== 0 || drag) return;
      const current = canvasRef.current?.getViewport();
      if (!current) return;
      suppressClick = false;
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: current.scrollX,
        top: current.scrollY,
        zoom: current.zoom,
        moved: false,
      };
    }

    function move(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!drag.moved) viewport.setPointerCapture(event.pointerId);
      drag.moved = true;
      viewport.style.cursor = "grabbing";
      canvasRef.current?.setScroll(drag.left - dx / drag.zoom, drag.top - dy / drag.zoom);
      event.preventDefault();
    }

    function up(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = drag.moved || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= DRAG_THRESHOLD;
      finish();
      if (moved) {
        suppressClick = true;
        event.preventDefault();
      }
    }

    function cancel(event: PointerEvent): void {
      if (event.pointerId === drag?.pointerId) finish();
    }

    function lostCapture(event: PointerEvent): void {
      if (event.target === viewport) cancel(event);
    }

    function click(event: MouseEvent): void {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    if (enabled) {
      viewport.addEventListener("pointerdown", down);
      viewport.addEventListener("pointermove", move);
      viewport.addEventListener("pointerup", up);
      viewport.addEventListener("pointercancel", cancel);
      viewport.addEventListener("lostpointercapture", lostCapture);
      viewport.addEventListener("click", click, true);
    }
    return () => {
      finish();
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", cancel);
      viewport.removeEventListener("lostpointercapture", lostCapture);
      viewport.removeEventListener("click", click, true);
      viewport.style.cursor = previousCursor;
      viewport.style.touchAction = previousTouchAction;
    };
  }, [canvasRef, enabled]);

  return null;
}

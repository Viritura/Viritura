import { useEffect } from "react";
import { useScoreView } from "@viritura/score-viewer-react";

const DRAG_THRESHOLD = 6;

interface ClickScoreInteractionsProps {
  readonly enabled: boolean;
  readonly onSelectMeasure: (measureIndex: number) => void;
}

export function ClickScoreInteractions({ enabled, onSelectMeasure }: ClickScoreInteractionsProps) {
  const { viewer, engine, displayList, pagePositions, zoom } = useScoreView();

  useEffect(() => {
    if (!viewer) return;
    const { viewport, surface } = viewer;
    const previousCursor = viewport.style.cursor;
    const previousTouchAction = viewport.style.touchAction;
    viewport.style.setProperty("cursor", enabled ? "grab" : "default");
    viewport.style.setProperty("touch-action", "none");
    let drag:
      | {
          pointerId: number;
          x: number;
          y: number;
          left: number;
          top: number;
          moved: boolean;
        }
      | undefined;

    function finish(): void {
      const current = drag;
      drag = undefined;
      viewport.style.setProperty("cursor", enabled ? "grab" : "default");
      if (current && viewport.hasPointerCapture(current.pointerId)) {
        viewport.releasePointerCapture(current.pointerId);
      }
    }

    function down(event: PointerEvent): void {
      if (!enabled || !event.isPrimary || event.button !== 0 || drag) return;
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        moved: false,
      };
      viewport.setPointerCapture(event.pointerId);
    }

    function move(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      viewport.style.setProperty("cursor", "grabbing");
      viewport.scrollTo({ left: drag.left - dx, top: drag.top - dy });
      event.preventDefault();
    }

    function up(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = drag.moved || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= DRAG_THRESHOLD;
      finish();
      if (moved || !engine || !displayList) return;
      const rect = surface.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const page = pagePositions.find(
        (candidate) =>
          x >= candidate.x &&
          x <= candidate.x + candidate.width &&
          y >= candidate.y &&
          y <= candidate.y + candidate.height,
      );
      if (!page) return;
      const hit = engine.canvasToBeat(displayList, page.page, (x - page.x) / zoom, (y - page.y) / zoom);
      if (hit) onSelectMeasure(hit.measureIndex);
    }

    function cancel(event: PointerEvent): void {
      if (event.pointerId === drag?.pointerId) finish();
    }

    function lostCapture(event: PointerEvent): void {
      if (event.target === viewport) cancel(event);
    }

    if (enabled) {
      viewport.addEventListener("pointerdown", down);
      viewport.addEventListener("pointermove", move);
      viewport.addEventListener("pointerup", up);
      viewport.addEventListener("pointercancel", cancel);
      viewport.addEventListener("lostpointercapture", lostCapture);
    }
    return () => {
      finish();
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", cancel);
      viewport.removeEventListener("lostpointercapture", lostCapture);
      viewport.style.setProperty("cursor", previousCursor);
      viewport.style.setProperty("touch-action", previousTouchAction);
    };
  }, [viewer, engine, displayList, pagePositions, zoom, enabled, onSelectMeasure]);

  return null;
}

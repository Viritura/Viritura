import { useCallback, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { secondsForX } from "./timelineGeometry";
import type { TimelineHit, TimelineViewport } from "./timelineTypes";

export interface TimelinePointerInteractionOptions {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly viewport: TimelineViewport;
  readonly hits: readonly TimelineHit[];
  readonly onScrub?: (pictureSeconds: number) => void;
  readonly onPick?: (pictureSeconds: number, hitId: string | null) => void;
  readonly onAddMarker?: (pictureSeconds: number) => void;
  readonly onMoveMarker?: (id: string, pictureSeconds: number) => void;
  readonly onEditMarker?: (id: string) => void;
}

/** Pointer state machine for timeline scrubbing and hit-marker manipulation. */
export function useTimelinePointerInteraction(options: TimelinePointerInteractionOptions) {
  const draggingRef = useRef(false);
  const draggingHitIdRef = useRef<string | null>(null);
  const pointerDownXRef = useRef(0);
  const markerDragStartedRef = useRef(false);

  const pictureSecondsAt = useCallback(
    (clientX: number) => {
      const rect = options.canvasRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return secondsForX(clientX - rect.left, options.viewport);
    },
    [options.canvasRef, options.viewport],
  );

  const hitAt = useCallback(
    (pictureSeconds: number) => {
      const tolerance = 6 * options.viewport.secondsPerPixel;
      let nearest: TimelineHit | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const hit of options.hits) {
        const distance = Math.abs(hit.pictureSeconds - pictureSeconds);
        if (distance <= tolerance && distance < nearestDistance) {
          nearest = hit;
          nearestDistance = distance;
        }
      }
      return nearest;
    },
    [options.hits, options.viewport.secondsPerPixel],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      const seconds = pictureSecondsAt(event.clientX);
      const hit = hitAt(seconds);

      if (event.shiftKey) {
        options.onAddMarker?.(seconds);
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      options.onPick?.(seconds, hit?.id ?? null);
      draggingRef.current = true;
      draggingHitIdRef.current = hit?.id ?? null;
      pointerDownXRef.current = event.clientX;
      markerDragStartedRef.current = false;
      if (!hit) options.onScrub?.(seconds);
    },
    [hitAt, options, pictureSecondsAt],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!draggingRef.current) return;
      const seconds = pictureSecondsAt(event.clientX);
      const hitId = draggingHitIdRef.current;
      if (!hitId) {
        options.onScrub?.(seconds);
        return;
      }
      if (!markerDragStartedRef.current) {
        if (Math.abs(event.clientX - pointerDownXRef.current) < 4) return;
        markerDragStartedRef.current = true;
      }
      options.onMoveMarker?.(hitId, seconds);
    },
    [options, pictureSecondsAt],
  );

  const endPointerInteraction = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    draggingHitIdRef.current = null;
    markerDragStartedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onDoubleClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const hit = hitAt(pictureSecondsAt(event.clientX));
      if (hit) options.onEditMarker?.(hit.id);
    },
    [hitAt, options, pictureSecondsAt],
  );

  return { onPointerDown, onPointerMove, endPointerInteraction, onDoubleClick };
}

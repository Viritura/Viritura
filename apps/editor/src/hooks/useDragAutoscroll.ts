import { useCallback, useEffect, useRef } from "react";

interface DragAutoscrollOptions {
  /** Height (px) of the hot zone at the top/bottom edge that triggers scrolling. */
  edgeSize?: number;
  /** Maximum scroll speed (px/frame) reached at the very edge. */
  maxSpeed?: number;
}

export interface DragAutoscrollResult<T extends HTMLElement> {
  /** Callback ref to attach to the scrollable container. */
  ref: (node: T | null) => void;
}

/**
 * Auto-scroll a container while an HTML5 drag hovers near its top/bottom edge.
 *
 * The native drag-and-drop API does not scroll overflow containers on its own,
 * so a long list (e.g. the Layouts panel) can't be reordered past the visible
 * viewport. This hook attaches **native** `dragover`/`drop`/`dragleave`
 * listeners to the container — native listeners fire regardless of any React
 * child calling `e.stopPropagation()` on the synthetic event (the score-reorder
 * rows do), so it works for every draggable row inside the container.
 *
 * Speed ramps with proximity to the edge; the rAF loop keeps scrolling while
 * the cursor is held still in the hot zone (where `dragover` stops firing) and
 * halts at the scroll bounds.
 *
 * A callback ref is used (rather than a ref object + mount effect) so listeners
 * attach whenever the element actually mounts — important for containers that
 * render conditionally (e.g. after a score loads).
 */
export function useDragAutoscroll<T extends HTMLElement>(options: DragAutoscrollOptions = {}): DragAutoscrollResult<T> {
  const { edgeSize = 56, maxSpeed = 16 } = options;
  const elRef = useRef<T | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const rafRef = useRef(0);
  const speedRef = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    speedRef.current = 0;
  }, []);

  const tick = useCallback(() => {
    const el = elRef.current;
    const speed = speedRef.current;
    if (!el || speed === 0) {
      rafRef.current = 0;
      return;
    }
    const before = el.scrollTop;
    el.scrollTop = before + speed;
    // Reached a scroll bound — nothing moved, so stop spinning the loop.
    if (el.scrollTop === before) {
      speedRef.current = 0;
      rafRef.current = 0;
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const ref = useCallback(
    (node: T | null) => {
      // Detach from any previous element.
      detachRef.current?.();
      detachRef.current = null;
      stop();
      elRef.current = node;
      if (!node) return;

      const onDragOver = (e: DragEvent) => {
        const rect = node.getBoundingClientRect();
        const fromTop = e.clientY - rect.top;
        const fromBottom = rect.bottom - e.clientY;
        const canScrollUp = node.scrollTop > 0;
        const canScrollDown = node.scrollTop < node.scrollHeight - node.clientHeight;
        let speed = 0;
        if (fromTop >= 0 && fromTop < edgeSize && canScrollUp) {
          speed = -maxSpeed * (1 - fromTop / edgeSize);
        } else if (fromBottom >= 0 && fromBottom < edgeSize && canScrollDown) {
          speed = maxSpeed * (1 - fromBottom / edgeSize);
        }
        speedRef.current = speed;
        if (speed !== 0 && rafRef.current === 0) rafRef.current = requestAnimationFrame(tick);
        else if (speed === 0) stop();
      };

      const onDragLeave = (e: DragEvent) => {
        // dragleave also fires when moving onto a child; only stop when the
        // cursor truly exits the container.
        const related = e.relatedTarget as Node | null;
        if (!related || !node.contains(related)) stop();
      };

      node.addEventListener("dragover", onDragOver);
      node.addEventListener("drop", stop);
      node.addEventListener("dragleave", onDragLeave);
      // `dragend` fires on the drag source (a row), not the container.
      window.addEventListener("dragend", stop);
      detachRef.current = () => {
        node.removeEventListener("dragover", onDragOver);
        node.removeEventListener("drop", stop);
        node.removeEventListener("dragleave", onDragLeave);
        window.removeEventListener("dragend", stop);
      };
    },
    [edgeSize, maxSpeed, tick, stop],
  );

  useEffect(() => {
    return () => {
      detachRef.current?.();
      detachRef.current = null;
      stop();
    };
  }, [stop]);

  return { ref };
}

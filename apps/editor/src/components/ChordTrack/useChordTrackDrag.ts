import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { ChordDragPreview, ChordTrackProps, TimedChord, TrackPoint } from "./types";
import { trackPositionEqual } from "./useChordTrackEditing";

interface DragArgs {
  root: RefObject<HTMLDivElement | null>;
  viewportElement?: RefObject<HTMLDivElement | null>;
  points: TrackPoint[];
  finePoints: TrackPoint[];
  viewport: ChordTrackProps["viewport"];
  railY: number;
  height: number;
  minX: number;
  onMove: (source: TimedChord, target: TrackPoint) => void;
  onPanBy?: (deltaX: number) => void;
  enabled?: boolean;
}

interface PendingDrag {
  pointerId: number;
  source: TimedChord;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  started: boolean;
  altKey: boolean;
}

function nearestTrackPoint(points: readonly TrackPoint[], x: number): TrackPoint | null {
  let closest: TrackPoint | null = null;
  for (const point of points) {
    if (!closest || Math.abs(point.x - x) < Math.abs(closest.x - x)) closest = point;
  }
  return closest;
}

export function useChordTrackDrag(args: DragArgs) {
  const latest = useRef(args);
  const pending = useRef<PendingDrag | null>(null);
  const previewRef = useRef<ChordDragPreview | null>(null);
  const suppressClick = useRef(false);
  const cancelledPointer = useRef<number | null>(null);
  const [preview, setPreview] = useState<ChordDragPreview | null>(null);
  useEffect(() => {
    latest.current = args;
  }, [args]);

  useEffect(() => {
    let frame = 0;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    function publish() {
      const drag = pending.current;
      const current = latest.current;
      const rect = current.root.current?.getBoundingClientRect();
      if (!drag || !rect) return;
      const x = drag.clientX - rect.left;
      const y = drag.clientY - rect.top;
      const view = current.viewportElement?.current?.getBoundingClientRect() ?? rect;
      const target = nearestTrackPoint(
        drag.altKey ? current.finePoints : current.points,
        x / current.viewport.zoom + current.viewport.scrollX,
      );
      const insideView =
        drag.clientX >= view.left &&
        drag.clientX <= view.right &&
        drag.clientY >= view.top &&
        drag.clientY <= view.bottom;
      const valid =
        target !== null &&
        insideView &&
        x >= current.minX &&
        y >= current.railY - 12 &&
        y <= current.railY + current.height + 12;
      const previous = previewRef.current;
      if (
        previous &&
        previous.valid === valid &&
        previous.fineGrid === drag.altKey &&
        previous.target &&
        target &&
        trackPositionEqual(previous.target, target)
      )
        return;
      const next = { source: drag.source, target, valid, fineGrid: drag.altKey };
      previewRef.current = next;
      setPreview(next);
    }
    function autoPan() {
      const drag = pending.current;
      const current = latest.current;
      const rect = current.root.current?.getBoundingClientRect();
      if (!drag?.started || !rect) return;
      const view = current.viewportElement?.current?.getBoundingClientRect() ?? rect;
      const x = drag.clientX - view.left;
      const minX = Math.max(0, current.minX + rect.left - view.left);
      const delta = x < minX + 24 ? -12 : x > view.width - 24 ? 12 : 0;
      if (delta) current.onPanBy?.(delta);
      publish();
      frame = requestAnimationFrame(autoPan);
    }
    function finish(cancelled: boolean, waitForRelease = false) {
      const drag = pending.current;
      const dropped = previewRef.current;
      pending.current = null;
      previewRef.current = null;
      cancelAnimationFrame(frame);
      setPreview(null);
      if (!drag?.started) return;
      suppressClick.current = true;
      clearTimeout(clickTimer);
      if (waitForRelease) cancelledPointer.current = drag.pointerId;
      else
        clickTimer = setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      if (!cancelled && dropped?.valid && dropped.target) latest.current.onMove(drag.source, dropped.target);
    }
    function move(event: PointerEvent) {
      const drag = pending.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (latest.current.enabled === false) {
        finish(true);
        return;
      }
      if (event.buttons === 0) {
        finish(true);
        return;
      }
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      drag.altKey = event.altKey;
      if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6) {
        drag.started = true;
        frame = requestAnimationFrame(autoPan);
      }
      if (drag.started) {
        event.preventDefault();
        publish();
      }
    }
    function up(event: PointerEvent) {
      if (event.pointerId === cancelledPointer.current) {
        cancelledPointer.current = null;
        suppressClick.current = true;
        clickTimer = setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        return;
      }
      const drag = pending.current;
      if (event.pointerId !== drag?.pointerId) return;
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      drag.altKey = event.altKey;
      publish();
      finish(latest.current.enabled === false);
    }
    function cancel() {
      finish(true);
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Alt" && pending.current) {
        pending.current.altKey = true;
        if (pending.current.started) {
          event.preventDefault();
          publish();
        }
      }
      if (event.key === "Escape" && pending.current?.started) {
        event.preventDefault();
        event.stopPropagation();
        finish(true, true);
      }
    }
    function keyUp(event: KeyboardEvent) {
      if (event.key !== "Alt" || !pending.current) return;
      pending.current.altKey = event.altKey;
      if (pending.current.started) {
        event.preventDefault();
        publish();
      }
    }
    function visibility() {
      if (document.visibilityState === "hidden") cancel();
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", keyUp, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", keyUp, true);
      document.removeEventListener("visibilitychange", visibility);
      cancelAnimationFrame(frame);
      clearTimeout(clickTimer);
      pending.current = null;
    };
  }, []);

  function start(event: ReactPointerEvent<HTMLButtonElement>, source: TimedChord) {
    if (args.enabled === false || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    cancelledPointer.current = null;
    suppressClick.current = false;
    pending.current = {
      pointerId: event.pointerId,
      source,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      started: false,
      altKey: event.altKey,
    };
  }
  function consumeClick(): boolean {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }
  return { preview, start, consumeClick };
}

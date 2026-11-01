import { useEffect, type KeyboardEvent, type RefObject } from "react";
import type { TextPopoverNavigationCommand } from "@viritura/ui";
import type { ChordTrackProps, TrackPoint } from "./types";
import { trackPositionEqual, type useChordTrackEditing } from "./useChordTrackEditing";
import { LANE_HEIGHT } from "./trackGeometry";

interface NavigationArgs {
  root: RefObject<HTMLDivElement | null>;
  viewport: ChordTrackProps["viewport"];
  railY: number;
  laneZoom: number;
  points: TrackPoint[];
  beatPoints: TrackPoint[];
  editing: ReturnType<typeof useChordTrackEditing>;
  onRevealPoint: ChordTrackProps["onRevealPoint"];
}

export function useChordTrackNavigation({
  root,
  viewport,
  railY,
  laneZoom,
  points,
  beatPoints,
  editing,
  onRevealPoint,
}: NavigationArgs) {
  const { editor, setEditor, score } = editing;
  function targetButton(point: TrackPoint) {
    return root.current?.querySelector<HTMLButtonElement>(
      `[data-track-measure="${point.measureIndex}"][data-track-beat="${point.beat}"]`,
    );
  }
  function targetRect(point: TrackPoint) {
    const rect = targetButton(point)?.getBoundingClientRect();
    if (rect) return rect;
    const container = root.current?.getBoundingClientRect();
    return new DOMRect(
      (container?.left ?? 0) + (point.x - viewport.scrollX) * viewport.zoom,
      (container?.top ?? 0) + railY + LANE_HEIGHT * laneZoom,
      0,
      0,
    );
  }
  useEffect(() => {
    const point = editor?.point;
    if (!point) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const rect = targetRect(point);
      setEditor((current) =>
        current && trackPositionEqual(current.point, point)
          ? { ...current, position: { x: rect.x + rect.width / 2, y: rect.bottom + 8 } }
          : current,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [viewport, editor?.point, railY, laneZoom, root, setEditor]);

  function close() {
    const point = editor?.point;
    setEditor(null);
    if (point) queueMicrotask(() => targetButton(point)?.focus({ preventScroll: true }));
  }
  function navigate(value: string, command: TextPopoverNavigationCommand): boolean {
    if (!editor || !score || !editing.commit(value)) return false;
    const backwards = command === "previous" || command === "previousBeat" || command === "previousMeasure";
    const stepping = command === "nextBeat" || command === "previousBeat" ? beatPoints : points;
    const candidates = backwards ? [...stepping].reverse() : stepping;
    const next = candidates.find((point) => {
      const order = point.measureIndex - editor.point.measureIndex || point.beat - editor.point.beat;
      if (backwards ? order >= 0 : order <= 0) return false;
      if (command === "nextMeasure" || command === "previousMeasure")
        return point.measureIndex !== editor.point.measureIndex && point.beat === 0;
      return true;
    });
    if (!next) {
      close();
      return true;
    }
    const button = targetButton(next);
    if (!button) onRevealPoint(next);
    editing.open(next, targetRect(next));
    return true;
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, point: TrackPoint, existing: boolean) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === " " && existing) editing.select(point);
      else editing.open(point, event.currentTarget.getBoundingClientRect());
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      editing.remove(point);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      const index = points.findIndex((candidate) => trackPositionEqual(candidate, point));
      const next = points[index + (event.key === "ArrowLeft" ? -1 : 1)];
      if (next) {
        if (!targetButton(next)) onRevealPoint(next);
        queueMicrotask(() => targetButton(next)?.focus());
      }
    }
  }
  return { close, navigate, keyDown };
}

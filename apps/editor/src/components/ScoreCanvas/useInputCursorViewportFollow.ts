import { useEffect, useRef } from "react";
import type { Score } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import type { CursorPosition } from "../../store/noteInputStore";
import type { ViewportState } from "../../viewport";
import {
  computeInputCursorRecovery,
  resolveInputCursorViewportTarget,
  type ViewportSafeArea,
} from "./inputCursorViewport";

interface UseInputCursorViewportFollowArgs {
  active: boolean;
  cursor: CursorPosition | null;
  score: Score | null;
  displayList: DisplayList | null;
  displayListVersion: number;
  voice: number;
  viewMode: "page" | "spread" | "spread-h" | "horizon";
  viewport: ViewportState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  safeArea: ViewportSafeArea | undefined;
  setScroll: (x: number, y: number) => void;
}

function cursorKey(cursor: CursorPosition): string {
  return `${cursor.partIndex}:${cursor.measureIndex}:${cursor.beatPosition}:${cursor.staffIndex ?? 0}`;
}

export function useInputCursorViewportFollow({
  active,
  cursor,
  score,
  displayList,
  displayListVersion,
  voice,
  viewMode,
  viewport,
  containerRef,
  safeArea,
  setScroll,
}: UseInputCursorViewportFollowArgs): void {
  const previousCursorKeyRef = useRef<string | null>(null);
  const pendingCursorKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !cursor) {
      previousCursorKeyRef.current = null;
      pendingCursorKeyRef.current = null;
      return;
    }

    const key = cursorKey(cursor);
    if (previousCursorKeyRef.current === null) {
      previousCursorKeyRef.current = key;
      return;
    }
    if (previousCursorKeyRef.current !== key) {
      previousCursorKeyRef.current = key;
      pendingCursorKeyRef.current = key;
    }
    if (pendingCursorKeyRef.current !== key || !score || !displayList) return;

    const container = containerRef.current;
    if (!container) return;
    const target = resolveInputCursorViewportTarget(cursor, score, displayList, voice, viewMode);
    if (!target) return;

    pendingCursorKeyRef.current = null;
    const recovery = computeInputCursorRecovery(
      target,
      viewport,
      container.clientWidth,
      container.clientHeight,
      safeArea,
    );
    if (recovery) setScroll(recovery.x, recovery.y);
  }, [
    active,
    cursor,
    score,
    displayList,
    displayListVersion,
    voice,
    viewMode,
    viewport,
    containerRef,
    safeArea,
    setScroll,
  ]);
}

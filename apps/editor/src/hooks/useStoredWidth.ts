/**
 * useStoredWidth — localStorage-backed numeric state for resizable panel widths.
 *
 * Returns `[width, setWidth]` where `setWidth` clamps to `[min, max]` and
 * persists to `window.localStorage` under `key`. Shared across PublishView,
 * ViewLayout, and App.tsx so every activity uses identical panel-resize wiring.
 */
import { useCallback, useState } from "react";

export function useStoredWidth(key: string, defaultW: number, min: number, max: number): [number, (w: number) => void] {
  const [width, setWidthRaw] = useState<number>(() => {
    if (typeof window === "undefined") return defaultW;
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : defaultW;
  });
  const setWidth = useCallback(
    (w: number) => {
      const clamped = Math.max(min, Math.min(max, w));
      setWidthRaw(clamped);
      try {
        window.localStorage.setItem(key, String(clamped));
      } catch {
        /* ignore */
      }
    },
    [key, min, max],
  );
  return [width, setWidth];
}

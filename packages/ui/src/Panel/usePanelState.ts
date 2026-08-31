/**
 * usePanelState — width + collapsed state with localStorage persistence
 * for a single docked panel.
 *
 * Returns a stable object exposing `width`, `setWidth`, `collapsed`, and
 * `setCollapsed`. Both values are clamped/coerced on read so storage
 * corruption can't break the panel; writes are debounced to the same
 * tick they happen (no debounce needed in practice — localStorage writes
 * are fast and panel-resize is interactive, not high-frequency).
 *
 * For panels that don't need persistence, callers can manage width with
 * useState directly and pass it to <Panel>.
 */
import { useCallback, useState } from "react";

export interface PanelStateOptions {
  /** localStorage key root. Width persists at `key`, collapsed at `key:collapsed`. */
  storageKey: string;
  /** Default width when no value has been stored. */
  defaultWidth: number;
  /** Minimum allowed width. */
  min: number;
  /** Maximum allowed width. */
  max: number;
  /** Initial collapsed state when no value has been stored. Defaults to false. */
  defaultCollapsed?: boolean;
}

export interface PanelState {
  width: number;
  setWidth: (w: number) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
}

export function usePanelState({
  storageKey,
  defaultWidth,
  min,
  max,
  defaultCollapsed = false,
}: PanelStateOptions): PanelState {
  const widthKey = storageKey;
  const collapsedKey = `${storageKey}:collapsed`;

  const [width, setWidthRaw] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth;
    const stored = window.localStorage.getItem(widthKey);
    const n = stored ? Number(stored) : NaN;
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : defaultWidth;
  });

  const [collapsed, setCollapsedRaw] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    const raw = window.localStorage.getItem(collapsedKey);
    if (raw === null) return defaultCollapsed;
    return raw === "1";
  });

  const setWidth = useCallback(
    (w: number) => {
      const clamped = Math.max(min, Math.min(max, w));
      setWidthRaw(clamped);
      try {
        window.localStorage.setItem(widthKey, String(clamped));
      } catch {
        /* ignore quota / disabled storage */
      }
    },
    [min, max, widthKey],
  );

  const setCollapsed = useCallback(
    (c: boolean) => {
      setCollapsedRaw(c);
      try {
        window.localStorage.setItem(collapsedKey, c ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [collapsedKey],
  );

  return { width, setWidth, collapsed, setCollapsed };
}

import { useCallback, useEffect, useRef } from "react";
import { type PanelImperativeHandle } from "react-resizable-panels";
import { usePanelState } from "@viritura/ui";

/**
 * Editor-specific wrapper around `usePanelState`. Manages the width +
 * collapsed state of one floating side panel (persisting both to
 * localStorage via `usePanelState`) and bridges to the legacy
 * `PanelImperativeHandle` API still consumed by keyboard shortcuts
 * (Toggle Panels, jump bar). Pass `null`
 * for `ref` for panels that don't need imperative control (Source, AI).
 *
 * New callers that don't need the bridge should import `usePanelState`
 * from `@viritura/ui` directly.
 */
export function useFloatingPanel(
  storageKey: string,
  defaultW: number,
  min: number,
  max: number,
  ref: React.RefObject<PanelImperativeHandle | null> | null,
  defaultCollapsed: boolean = false,
): { width: number; setWidth: (w: number) => void; collapsed: boolean; setCollapsed: (c: boolean) => void } {
  const { width, setWidth, collapsed, setCollapsed } = usePanelState({
    storageKey,
    defaultWidth: defaultW,
    min,
    max,
    defaultCollapsed,
  });

  // Bridge to the PanelImperativeHandle API used by existing shortcuts. We
  // install the bridge synchronously so children can use it on the same render.
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const setCollapsedStable = useCallback((c: boolean) => setCollapsed(c), [setCollapsed]);
  if (ref && !ref.current) {
    ref.current = {
      collapse: () => setCollapsedStable(true),
      expand: () => setCollapsedStable(false),
      isCollapsed: () => collapsedRef.current,
    } as PanelImperativeHandle;
  }
  useEffect(() => {
    if (!ref) return;
    ref.current = {
      collapse: () => setCollapsedStable(true),
      expand: () => setCollapsedStable(false),
      isCollapsed: () => collapsedRef.current,
    } as PanelImperativeHandle;
    return () => {
      if (ref) ref.current = null;
    };
  }, [ref, setCollapsedStable]);

  return { width, setWidth, collapsed, setCollapsed };
}

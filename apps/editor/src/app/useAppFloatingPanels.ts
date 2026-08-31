import { useRef } from "react";
import { useFloatingPanel } from "./useFloatingPanel";
import type { PanelImperativeHandle } from "react-resizable-panels";

type FloatingPanelState = ReturnType<typeof useFloatingPanel>;

export interface AppFloatingPanels {
  leftPanelRef: React.RefObject<PanelImperativeHandle | null>;
  rightPanelRef: React.RefObject<PanelImperativeHandle | null>;
  leftFloat: FloatingPanelState;
  rightFloat: FloatingPanelState;
  sourceFloat: FloatingPanelState;
}

/**
 * Bundles the three `useFloatingPanel` width controllers + the two
 * resizable-panel imperative refs used by panel keyboard shortcuts into one
 * hook. Replaces ~6 statements in
 * AppInner with one destructure.
 */
export function useAppFloatingPanels(): AppFloatingPanels {
  const leftPanelRef = useRef<PanelImperativeHandle>(null);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);
  const leftFloat = useFloatingPanel("viritura.write.leftW", 300, 200, 500, leftPanelRef);
  // Right-side specialist panels (for example slur shape editing) default collapsed.
  const rightFloat = useFloatingPanel("viritura.write.rightW", 320, 220, 520, rightPanelRef, true);
  const sourceFloat = useFloatingPanel("viritura.write.sourceW", 400, 280, 700, null);
  return { leftPanelRef, rightPanelRef, leftFloat, rightFloat, sourceFloat };
}

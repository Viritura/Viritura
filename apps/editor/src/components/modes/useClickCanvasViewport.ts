import { useEffect, useRef, type RefObject } from "react";
import type { ScoreCanvasHandle } from "../ScoreCanvas";
import type { WorkspaceModeKind } from "../../app/workspaceMode";

export function useClickCanvasViewport(
  canvasRef: RefObject<ScoreCanvasHandle | null>,
  modeKind: WorkspaceModeKind | undefined,
): void {
  const previousModeKind = useRef(modeKind);
  const writeViewportBeforeClick = useRef<ReturnType<ScoreCanvasHandle["getViewport"]> | null>(null);

  useEffect(() => {
    const previous = previousModeKind.current;
    if (modeKind === "click" && previous !== "click") {
      writeViewportBeforeClick.current = canvasRef.current?.getViewport() ?? null;
      canvasRef.current?.setZoom(1);
      canvasRef.current?.setScroll(0, 0);
    } else if (previous === "click" && modeKind !== "click") {
      const viewport = writeViewportBeforeClick.current;
      if (viewport) {
        canvasRef.current?.setZoom(viewport.zoom);
        canvasRef.current?.setScroll(viewport.scrollX, viewport.scrollY);
      }
      writeViewportBeforeClick.current = null;
    }
    previousModeKind.current = modeKind;
  }, [canvasRef, modeKind]);
}

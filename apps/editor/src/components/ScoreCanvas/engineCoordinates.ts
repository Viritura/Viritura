import type React from "react";
import type { DisplayList } from "@viritura/renderer";
import type { WriteViewMode } from "@viritura/ui";

import { screenToLayout, visualToEngineCoords } from "./viewportGeometry";
import type { ViewportInfo } from "./types";

/** Convert screen coordinates to engine-space, or null outside a visible page. */
export function screenToEngine(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  viewport: ViewportInfo,
  displayList: DisplayList | null,
  viewMode: WriteViewMode,
): { scoreX: number; scoreY: number } | null {
  const rect = canvas.getBoundingClientRect();
  let { scoreX, scoreY } = screenToLayout(
    e.clientX,
    e.clientY,
    rect,
    viewport.zoom,
    viewport.scrollX,
    viewport.scrollY,
  );
  if (displayList) {
    const engine = visualToEngineCoords(scoreX, scoreY, displayList, viewMode);
    if (!engine) return null;
    scoreX = engine.engineX;
    scoreY = engine.engineY;
  }
  return { scoreX, scoreY };
}

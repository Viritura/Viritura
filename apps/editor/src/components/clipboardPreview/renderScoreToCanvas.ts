import type { Score } from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import { wasmComputeLayout, wasmComputeFullScoreLayout, paintDisplayList } from "@viritura/renderer";

/** Run wasm layout for a score and paint it into a fixed canvas-sized box. */
export function renderScoreToCanvas(canvas: HTMLCanvasElement, score: Score, width: number, height: number): void {
  const mnxJson = JSON.stringify(serializeMnx(score));
  const spatium = 8;
  const isMultiStaff = score.parts.length > 1;
  const displayList = isMultiStaff
    ? wasmComputeFullScoreLayout(mnxJson, spatium, 0)
    : wasmComputeLayout(mnxJson, 0, spatium, 0);

  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const dlWidth = displayList.width || 200;
  const dlHeight = displayList.height || 80;
  const zoomX = (width * dpr) / dlWidth;
  const zoomY = (height * dpr) / dlHeight;
  // Tighter fill factor since silent parts have been filtered out.
  const zoom = Math.min(zoomX, zoomY) * 0.97;

  const offsetX = (width * dpr - dlWidth * zoom) / 2;
  const offsetY = (height * dpr - dlHeight * zoom) / 2;
  ctx.setTransform(zoom, 0, 0, zoom, offsetX, offsetY);
  paintDisplayList(ctx, displayList);
}

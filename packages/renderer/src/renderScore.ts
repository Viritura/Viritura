/**
 * Convenience function to render a score onto a canvas element.
 */

import type { Score } from "@viritura/core";
import type { LayoutSettings } from "@viritura/core";
import { ScoreRenderer } from "./ScoreRenderer";

/**
 * One-shot render: create a renderer, set the score, and paint.
 * Returns the renderer for further interaction if needed.
 *
 * @deprecated Use the WASM engine with {@link paintDisplayList} instead.
 * This function delegates to the legacy {@link ScoreRenderer} which uses
 * placeholder Unicode characters rather than proper SMuFL glyph rendering.
 */
export function renderScore(
  canvas: HTMLCanvasElement,
  score: Score,
  settings?: Partial<LayoutSettings>,
): ScoreRenderer {
  const renderer = new ScoreRenderer(canvas, settings);
  renderer.setScore(score);
  return renderer;
}

/**
 * Painting the timeline at most once per frame.
 *
 * React can render the timeline several times for a single displayed frame:
 * the playhead ticks, the selection changes, a thumbnail arrives. Painting
 * synchronously in an effect meant one full repaint per render, and a repaint
 * here is not cheap — it clears the canvas, reduces the waveform across every
 * pixel column, and blits the filmstrip. Coalescing into a single animation
 * frame collapses that burst into the one paint the display can actually show.
 *
 * Two other costs are removed here rather than repeated per paint:
 *
 *   - Assigning `canvas.width` reallocates and clears the backing store, so it
 *     is done only when the size genuinely changes. It was previously assigned
 *     on every paint, which is the most expensive way to start a frame.
 *   - Reading the palette calls `getComputedStyle` and a dozen
 *     `getPropertyValue`s, forcing a style recalculation. Theme colours change
 *     when the theme changes, so they are cached until it does.
 */

import { useEffect, useRef, useState } from "react";
import { drawTimeline, paletteFrom, type TimelinePalette } from "./timelineRenderer";
import type { TimelineScene } from "./timelineTypes";

export function useTimelinePainter(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  hostRef: React.RefObject<HTMLElement | null>,
  scene: TimelineScene,
): void {
  const sceneRef = useRef(scene);
  const paletteRef = useRef<TimelinePalette | null>(null);
  const frameRef = useRef(0);
  // Bumped when the theme changes, purely so the paint effect below re-runs.
  // Invalidating the palette alone would leave the old colours on screen until
  // something unrelated happened to rebuild the scene — and with playback
  // stopped and the pointer still, that is never.
  const [themeEpoch, setThemeEpoch] = useState(0);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  // The theme is the only thing that invalidates the palette, and it lives in a
  // data attribute on <html>.
  useEffect(() => {
    const invalidate = () => {
      paletteRef.current = null;
      setThemeEpoch((n) => n + 1);
    };
    const observer = new MutationObserver(invalidate);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (frameRef.current !== 0) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const canvas = canvasRef.current;
      const host = hostRef.current;
      const current = sceneRef.current;
      if (!canvas || !host || current.widthPx === 0) return;

      const width = Math.round(current.widthPx * current.devicePixelRatio);
      const height = Math.round(current.heightPx * current.devicePixelRatio);
      // Only on a real size change: the assignment itself is destructive.
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      paletteRef.current ??= paletteFrom(host);
      drawTimeline(ctx, current, paletteRef.current);
    });
  }, [scene, themeEpoch, canvasRef, hostRef]);

  useEffect(
    () => () => {
      if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
    },
    [],
  );
}

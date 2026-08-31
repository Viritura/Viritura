/**
 * TimelineCanvas — the spotting surface.
 *
 * Owns the canvas element, the device-pixel-ratio dance, and pointer handling;
 * everything it draws comes from a resolved scene, and everything it computes
 * comes from `timelineGeometry`. Keeping it that thin is what lets the geometry
 * be unit-tested and the renderer be swapped without touching interaction.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampViewport,
  devicePixelRatio,
  fitViewport,
  normalizeSafeAreaLeft,
  shiftViewportSafeArea,
  zoomAt,
  zoomLimitsFor,
  type ZoomLimits,
} from "./timelineGeometry";
import { LANE_FRACTIONS } from "./timelineRenderer";
import { useTimelinePainter } from "./useTimelinePainter";
import { useTimelinePointerInteraction } from "./useTimelinePointerInteraction";
import type { TimelineBar, TimelineHit, TimelineScene, TimelineViewport, TimelineWaveform } from "./timelineTypes";
import { useFilmstrip } from "./useFilmstrip";
import styles from "./TimelineCanvas.module.css";

export interface TimelineCanvasProps {
  readonly bars: readonly TimelineBar[];
  readonly hits: readonly TimelineHit[];
  readonly durationSeconds: number;
  readonly playheadSeconds: number | null;
  readonly frameRate: number;
  /** Full-bleed content should remain readable to the right of this overlay. */
  readonly safeAreaLeft?: number;
  readonly selectedHitId?: string | null;
  readonly selectedSpan?: { readonly fromSeconds: number; readonly toSeconds: number } | null;
  readonly waveform?: TimelineWaveform | null;
  /** Object URL of the attached clip, for filmstrip extraction. */
  readonly mediaObjectUrl?: string | null;
  /** Scrub: the user moved the playhead to a picture time. */
  readonly onScrub?: (pictureSeconds: number) => void;
  /** Click: select the resolved hit, or clear hit selection. */
  readonly onPick?: (pictureSeconds: number, hitId: string | null) => void;
  /** Shift-click: add a marker without moving the playhead. */
  readonly onAddMarker?: (pictureSeconds: number) => void;
  /** Drag: move an existing marker without scrubbing the playhead. */
  readonly onMoveMarker?: (id: string, pictureSeconds: number) => void;
  /** Double-click an existing marker: edit its label. */
  readonly onEditMarker?: (id: string) => void;
}

export function TimelineCanvas(props: TimelineCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<TimelineViewport>({ startSeconds: 0, secondsPerPixel: 0.1 });

  // Track the host's size so the canvas backing store matches its CSS box.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const layoutRef = useRef<{ durationSeconds: number | null; safeAreaLeft: number }>({
    durationSeconds: null,
    safeAreaLeft: 0,
  });
  useEffect(() => {
    if (size.width === 0 || props.durationSeconds <= 0) return;
    const safeAreaLeft = normalizeSafeAreaLeft(props.safeAreaLeft ?? 0, size.width);
    const previous = layoutRef.current;
    layoutRef.current = { durationSeconds: props.durationSeconds, safeAreaLeft };

    // A new duration owns the whole transition: fit already uses the new edge,
    // so applying the previous panel delta as well would shift it twice.
    if (previous.durationSeconds !== props.durationSeconds) {
      setViewport(fitViewport(props.durationSeconds, size.width, safeAreaLeft));
      return;
    }
    if (safeAreaLeft === previous.safeAreaLeft) return;

    // Match Write mode on panel resize: preserve the picture time at the safe
    // edge without changing the composer's zoom.
    setViewport((current) =>
      clampViewport(
        shiftViewportSafeArea(current, previous.safeAreaLeft, safeAreaLeft),
        props.durationSeconds,
        size.width,
        safeAreaLeft,
      ),
    );
  }, [props.durationSeconds, props.safeAreaLeft, size.width]);

  const limits: ZoomLimits = useMemo(
    () => zoomLimitsFor(props.durationSeconds, size.width || 1, props.frameRate, props.safeAreaLeft ?? 0),
    [props.durationSeconds, props.safeAreaLeft, size.width, props.frameRate],
  );

  const thumbnails = useFilmstrip({
    objectUrl: props.mediaObjectUrl ?? null,
    viewport,
    widthPx: size.width,
    durationSeconds: props.durationSeconds,
    laneHeightPx: size.height * LANE_FRACTIONS.filmstrip,
    devicePixelRatio: devicePixelRatio(),
  });

  // Destructured rather than spread from `props`, which is a fresh object on
  // every render and would rebuild the scene — and so repaint — even when
  // nothing visible had changed.
  const { bars, hits, durationSeconds, playheadSeconds, frameRate, selectedHitId, selectedSpan, waveform } = props;

  const scene: TimelineScene = useMemo(
    () => ({
      viewport,
      widthPx: size.width,
      heightPx: size.height,
      devicePixelRatio: devicePixelRatio(),
      durationSeconds,
      bars,
      hits,
      playheadSeconds,
      frameRate,
      selectedHitId: selectedHitId ?? null,
      selectedSpan: selectedSpan ?? null,
      waveform: waveform ?? null,
      thumbnails,
    }),
    [
      viewport,
      size,
      durationSeconds,
      bars,
      hits,
      playheadSeconds,
      frameRate,
      selectedHitId,
      selectedSpan,
      waveform,
      thumbnails,
    ],
  );

  useTimelinePainter(canvasRef, hostRef, scene);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      event.preventDefault();
      const x = event.clientX - rect.left;
      if (event.ctrlKey || event.metaKey) {
        const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
        setViewport((current) =>
          clampViewport(zoomAt(current, x, factor, limits), props.durationSeconds, size.width, props.safeAreaLeft ?? 0),
        );
        return;
      }

      // Wheel and trackpad scrolling move along picture time. Prefer a native
      // horizontal delta; Shift+wheel and ordinary mouse wheels fall back to Y.
      const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
      setViewport((current) =>
        clampViewport(
          { ...current, startSeconds: current.startSeconds + delta * current.secondsPerPixel },
          props.durationSeconds,
          size.width,
          props.safeAreaLeft ?? 0,
        ),
      );
    },
    [limits, props.durationSeconds, props.safeAreaLeft, size.width],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const { onPointerDown, onPointerMove, endPointerInteraction, onDoubleClick } = useTimelinePointerInteraction({
    canvasRef,
    viewport,
    hits: props.hits,
    onScrub: props.onScrub,
    onPick: props.onPick,
    onAddMarker: props.onAddMarker,
    onMoveMarker: props.onMoveMarker,
    onEditMarker: props.onEditMarker,
  });

  return (
    <div ref={hostRef} className={styles.host}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointerInteraction}
        onPointerCancel={endPointerInteraction}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}

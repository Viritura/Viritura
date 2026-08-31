/**
 * PictureSurface — the picture as the composer watches it, with cues over it.
 *
 * The frame is mirrored onto a canvas rather than the `<video>` element being
 * moved into the pop-out. Moving it would be the obvious approach and it is
 * what the platform's own examples do, but the element here is bound to the
 * synchronizer and rendered by React; re-parenting it out from under both is
 * how you end up with a torn-down media session or a portal that recreates the
 * node and drops the object URL. Mirroring costs one `drawImage` per displayed
 * frame at pop-out size, and buys a surface we can composite streamers into
 * directly — which is the whole reason for having our own window.
 *
 * Frames are pulled with `requestVideoFrameCallback` where it exists, so the
 * mirror advances with the video's own frames rather than with the display's
 * refresh. On a 24 fps clip that is 24 draws a second instead of 60, and it
 * cannot show a frame that has not been presented.
 */

import { useEffect, useRef, type RefObject } from "react";
import { streamerState, streamerX, type StreamerOptions } from "./streamers";
import type { TimelineHit } from "./timelineTypes";
import styles from "./PictureSurface.module.css";

/**
 * `requestVideoFrameCallback` is not in every TS DOM lib and is not in every
 * browser, so it is described here as optional and feature-detected at use.
 */
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface PictureSurfaceProps {
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly hits: readonly TimelineHit[];
  /** Media time that corresponds to score time zero. */
  readonly pictureOffsetSeconds: number;
  readonly streamerOptions: StreamerOptions;
  /** Whether cues are drawn at all. */
  readonly showStreamers: boolean;
}

export function PictureSurface({
  videoRef,
  hits,
  pictureOffsetSeconds,
  streamerOptions,
  showStreamers,
}: PictureSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Everything the draw loop reads goes through a ref, so changing hits or
  // toggling cues never restarts the loop — restarting it drops a frame, and a
  // dropped frame in a pop-out is exactly what the composer is watching for.
  const latest = useRef({ hits, pictureOffsetSeconds, streamerOptions, showStreamers });
  useEffect(() => {
    latest.current = { hits, pictureOffsetSeconds, streamerOptions, showStreamers };
  }, [hits, pictureOffsetSeconds, streamerOptions, showStreamers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current as VideoWithFrameCallback | null;
    if (!canvas || !video) return;

    let disposed = false;
    let rafHandle = 0;
    let frameHandle = 0;

    const paint = (mediaTime: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawLetterboxed(ctx, video, width, height);

      const current = latest.current;
      if (!current.showStreamers) return;
      drawCues(ctx, width, height, mediaTime, current.hits, current.streamerOptions);
    };

    const step = () => {
      if (disposed) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        frameHandle = video.requestVideoFrameCallback((_now, metadata) => {
          paint(metadata.mediaTime);
          step();
        });
      } else {
        // No frame callback: fall back to the display's clock and read the
        // element's own time, which is coarser but always available.
        rafHandle = requestAnimationFrame(() => {
          paint(video.currentTime);
          step();
        });
      }
    };

    // Paint once immediately so a paused pop-out is not blank until the next
    // frame is presented.
    paint(video.currentTime);
    step();

    return () => {
      disposed = true;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      if (frameHandle && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameHandle);
      }
    };
  }, [videoRef]);

  return <canvas ref={canvasRef} className={styles.surface} />;
}

/** Fit the frame inside the surface without distorting it. */
function drawLetterboxed(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number): void {
  if (video.videoWidth === 0 || video.videoHeight === 0) return;
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  ctx.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

/**
 * Draw the cues.
 *
 * Streamers are drawn in white with a dark edge rather than a theme colour:
 * they have to read against an arbitrary frame of film, and a mid-tone accent
 * disappears over half the shots in any given reel.
 */
function drawCues(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mediaTime: number,
  hits: readonly TimelineHit[],
  options: StreamerOptions,
): void {
  const state = streamerState(mediaTime, hits, options);

  for (const streamer of state.streamers) {
    const x = streamerX(streamer.progress) * width;
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.restore();
  }

  if (state.punch) {
    const radius = Math.min(width, height) * 0.11;
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.stroke();
    ctx.restore();
  } else if (state.warning) {
    // Warnings are an outline, not a fill: they must be unmistakably *not* the
    // cue itself, or a conductor will play early.
    const radius = Math.min(width, height) * 0.08;
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.stroke();
    ctx.restore();
  }
}

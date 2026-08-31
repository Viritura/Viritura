/**
 * useFollowPlayhead — auto-scroll controller that keeps the playback cursor in
 * view, plus the "scroll away → detach → re-engage" interaction.
 *
 * Two scroll models, chosen automatically from the view mode:
 *   - **continuous** (horizon): the playhead is pinned near a screen fraction
 *     (the *anchor*) and the music flows underneath every painted frame.
 *   - **flip** (page / spread / spread-h): the view stays put until the
 *     playhead nears an edge, then jumps forward one screen so the cursor
 *     lands back near the start.
 *
 * Interaction model (the key UX):
 *   - While following, if the user scrolls/zooms and the playhead is *still in
 *     view*, we do NOT detach. Instead we re-capture where the playhead now
 *     sits relative to the viewport and keep following from there — i.e. the
 *     user drags the cursor to whatever relative position they prefer and it
 *     sticks.
 *   - Only when the user moves the playhead *out of the viewport* do we detach
 *     and surface the floating "Follow playhead" button to snap back.
 *
 * Vertical follow (for tall orchestral systems) is lazy in both models: it only
 * scrolls when the playhead's system band leaves the viewport, never per-frame.
 *
 * The controller is driven by `onPlayheadRect`, which the `PlayheadOverlay`
 * calls every painted frame with the cursor's content-space rect — so there is
 * no second rAF loop here. State that the floating re-engage button needs
 * (`detached`) is the only React state; everything else lives in refs to avoid
 * re-render churn during playback.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayheadRect, ViewMode } from "@viritura/playback";
import type { ViewportState } from "../viewport";

/** Default horizontal anchor (fraction of width) before the user customizes it. */
const DEFAULT_ANCHOR_FRAC = 0.35;
/** Default vertical anchor: band center sits at mid-viewport. */
const DEFAULT_V_ANCHOR_FRAC = 0.5;
/** Margin from the viewport edges (fraction) before a flip triggers. */
const FLIP_EDGE_FRAC = 0.08;
/** After a flip, where the playhead lands (fraction from the left). */
const FLIP_LEAD_FRAC = 0.15;
/** Minimum scroll change (content px) worth committing — avoids churn. */
const MIN_SCROLL_DELTA = 0.5;
/** Keep the re-anchor fraction off the very edges so the cursor stays usable. */
const ANCHOR_CLAMP_MIN = 0.05;
const ANCHOR_CLAMP_MAX = 0.95;
/** Generous bound on the vertical anchor; the targetY clamp enforces validity,
 *  so a tall system can be scrolled top-to-bottom (its frac exceeds [0,1]). */
const V_ANCHOR_CLAMP = 3;

type PlaybackStatus = "stopped" | "playing" | "paused" | "loading";

interface UseFollowPlayheadArgs {
  /** Master preference (from the transport toggle). */
  enabled: boolean;
  /** Current transport status. */
  status: PlaybackStatus;
  /** Active view mode (selects continuous vs. flip). */
  viewMode: ViewMode;
  /** Latest viewport state (scroll/zoom). Read imperatively per frame. */
  viewportRef: React.RefObject<ViewportState>;
  /** The scrollable container, for its CSS pixel size. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Clamped programmatic scroll setter from useViewport. */
  setScroll: (x: number, y: number) => void;
}

interface UseFollowPlayheadResult {
  /** True when the user scrolled away during playback and following is paused. */
  detached: boolean;
  /** Snap back to the playhead and resume following. */
  reengage: () => void;
  /** Feed the overlay's per-frame rect here. Stable identity. */
  onPlayheadRect: (rect: PlayheadRect | null) => void;
  /** Call when the user moves the viewport by hand. Stable identity. */
  onUserInteract: () => void;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Whether the playhead's cursor (x column + system band) overlaps the viewport. */
function isPlayheadVisible(rect: PlayheadRect, vp: ViewportState, viewW: number, viewH: number): boolean {
  const winW = viewW / vp.zoom;
  const winH = viewH / vp.zoom;
  const xVisible = rect.x >= vp.scrollX && rect.x <= vp.scrollX + winW;
  const yVisible = rect.yBottom >= vp.scrollY && rect.yTop <= vp.scrollY + winH;
  return xVisible && yVisible;
}

/** Compute the desired scroll to keep `rect` at the anchor / in view. */
function computeFollowScroll(
  rect: PlayheadRect,
  vp: ViewportState,
  viewW: number,
  viewH: number,
  continuous: boolean,
  anchorFrac: number,
  vAnchorFrac: number,
  bandChanged: boolean,
): { x: number; y: number } {
  // Visible content window (content units = pre-zoom score px).
  const winW = viewW / vp.zoom;
  const winH = viewH / vp.zoom;

  // ── Horizontal ──
  let targetX = vp.scrollX;
  if (continuous) {
    // Treadmill: pin the playhead at the (user-customizable) anchor fraction.
    targetX = rect.x - anchorFrac * winW;
  } else {
    // Flip: only jump when the playhead nears/exits the visible band.
    const leftEdge = vp.scrollX + FLIP_EDGE_FRAC * winW;
    const rightEdge = vp.scrollX + winW - FLIP_EDGE_FRAC * winW;
    if (rect.x < leftEdge || rect.x > rightEdge) {
      targetX = rect.x - FLIP_LEAD_FRAC * winW;
    }
  }

  // ── Vertical ──
  // The band's Y is static while the playhead stays within one system, so we
  // must NOT touch scrollY every frame — doing so fights the user's vertical
  // wheel (the horizontal treadmill makes applyFollow run each frame, which
  // would re-pin Y and cause jank). Only adjust vertically when the cursor
  // crosses into a *different* system (the band Y actually changes), or when
  // the current band has scrolled out of view.
  const bandTop = rect.yTop;
  const bandBot = rect.yBottom;
  const bandHeight = bandBot - bandTop;
  const bandCenter = (bandTop + bandBot) / 2;
  const visibleTop = vp.scrollY;
  const visibleBot = vp.scrollY + winH;
  const bandOutOfView = bandBot <= visibleTop || bandTop >= visibleBot;

  let targetY = vp.scrollY;
  if (bandChanged || bandOutOfView) {
    if (bandHeight >= winH) {
      // System taller than the viewport: place it at the user's vertical
      // offset, clamped so the viewport stays within the band (no margins).
      const desired = bandCenter - vAnchorFrac * winH;
      targetY = clamp(desired, bandTop, bandBot - winH);
    } else {
      // System fits: center it at the user's vertical anchor.
      targetY = bandCenter - vAnchorFrac * winH;
    }
  }

  return { x: targetX, y: targetY };
}

/** Whether two bands differ enough to count as a new system (Y moved). */
function bandYChanged(a: PlayheadRect | null, b: PlayheadRect): boolean {
  if (!a) return true;
  return Math.abs(a.yTop - b.yTop) > 1 || Math.abs(a.yBottom - b.yBottom) > 1;
}

export function useFollowPlayhead({
  enabled,
  status,
  viewMode,
  viewportRef,
  containerRef,
  setScroll,
}: UseFollowPlayheadArgs): UseFollowPlayheadResult {
  const [detached, setDetached] = useState(false);

  // Latest values for the stable callbacks (avoid re-creating them per render).
  const engagedRef = useRef(false);
  const lastRectRef = useRef<PlayheadRect | null>(null);
  const enabledRef = useRef(enabled);
  const statusRef = useRef(status);
  const viewModeRef = useRef(viewMode);
  const detachedRef = useRef(detached);
  // Horizontal anchor the user can customize by scrolling while in view.
  const anchorFracRef = useRef(DEFAULT_ANCHOR_FRAC);
  // Vertical anchor (band center as a fraction of viewport height). Lets the
  // user pick how the system sits vertically — essential for tall scores.
  const vAnchorFracRef = useRef(DEFAULT_V_ANCHOR_FRAC);
  // Set on each user gesture; consumed on the next painted frame to decide
  // between "re-anchor (still visible)" and "detach (scrolled off-screen)".
  const interactDirtyRef = useRef(false);
  // Viewport object visible when the gesture began. Native wheel events can
  // race the overlay's already-queued rAF: that frame still sees the old
  // viewport and must not consume the gesture, or horizontal follow captures
  // the old anchor and snaps Shift+wheel back on the following frame.
  const interactViewportRef = useRef<ViewportState | null>(null);
  // The band Y last used for a vertical scroll. Vertical follow only fires when
  // the cursor's band differs from this (i.e. a new system) or leaves view, so
  // within a system the user's vertical scroll is never overridden.
  const lastBandRef = useRef<PlayheadRect | null>(null);
  enabledRef.current = enabled;
  statusRef.current = status;
  viewModeRef.current = viewMode;
  detachedRef.current = detached;

  const applyFollow = useCallback(
    (rect: PlayheadRect) => {
      const vp = viewportRef.current;
      const el = containerRef.current;
      if (!vp || !el) return;
      const continuous = viewModeRef.current === "horizon";
      const bandChanged = bandYChanged(lastBandRef.current, rect);
      const { x, y } = computeFollowScroll(
        rect,
        vp,
        el.clientWidth,
        el.clientHeight,
        continuous,
        anchorFracRef.current,
        vAnchorFracRef.current,
        bandChanged,
      );
      lastBandRef.current = rect;
      if (Math.abs(x - vp.scrollX) > MIN_SCROLL_DELTA || Math.abs(y - vp.scrollY) > MIN_SCROLL_DELTA) {
        setScroll(x, y);
      }
    },
    [viewportRef, containerRef, setScroll],
  );

  const onPlayheadRect = useCallback(
    (rect: PlayheadRect | null) => {
      lastRectRef.current = rect;
      if (!rect || !engagedRef.current || !enabledRef.current) return;
      const vp = viewportRef.current;
      const el = containerRef.current;
      if (!vp || !el) return;

      // A gesture happened since the last frame: decide re-anchor vs. detach
      // before following, so we never fight the user's scroll/zoom.
      if (interactDirtyRef.current) {
        // Wait until React has exposed the viewport object produced by the
        // gesture. Every actual wheel/drag/pinch update creates a new object.
        // Returning also suppresses follow for the stale rAF frame.
        if (vp === interactViewportRef.current) return;
        interactDirtyRef.current = false;
        interactViewportRef.current = null;
        if (!isPlayheadVisible(rect, vp, el.clientWidth, el.clientHeight)) {
          // Scrolled off-screen → stop following and offer the snap-back button.
          engagedRef.current = false;
          setDetached(true);
          return;
        }
        // Still visible → adopt the user's chosen relative position as the new
        // anchor and respect it this frame (no snap-back). Both axes are
        // captured so horizontal *and* vertical scroll/zoom "stick".
        const winW = el.clientWidth / vp.zoom;
        const winH = el.clientHeight / vp.zoom;
        anchorFracRef.current = clamp((rect.x - vp.scrollX) / winW, ANCHOR_CLAMP_MIN, ANCHOR_CLAMP_MAX);
        const bandCenter = (rect.yTop + rect.yBottom) / 2;
        vAnchorFracRef.current = clamp((bandCenter - vp.scrollY) / winH, -V_ANCHOR_CLAMP, V_ANCHOR_CLAMP);
        // Adopt the band the user just positioned as the baseline, so we don't
        // immediately treat this same system as "changed" and snap it back.
        lastBandRef.current = rect;
        return;
      }

      applyFollow(rect);
    },
    [applyFollow, viewportRef, containerRef],
  );

  const onUserInteract = useCallback(() => {
    // While engaged with an active playhead, defer the decision to the next
    // painted frame (re-anchor if still visible, detach if not). Don't detach
    // here — a small scroll that keeps the playhead on-screen should re-anchor.
    if (engagedRef.current && (statusRef.current === "playing" || statusRef.current === "paused")) {
      interactViewportRef.current = viewportRef.current;
      interactDirtyRef.current = true;
    }
  }, [viewportRef]);

  const reengage = useCallback(() => {
    engagedRef.current = true;
    interactDirtyRef.current = false;
    interactViewportRef.current = null;
    // Force a vertical re-place on snap-back (band counts as "changed").
    lastBandRef.current = null;
    setDetached(false);
    if (lastRectRef.current) applyFollow(lastRectRef.current);
  }, [applyFollow]);

  // Engage automatically when playback starts (and the pref is on); clear the
  // detached affordance when playback stops or the pref is turned off. Reads
  // `detached` via a ref so the effect only re-runs on transport/pref changes.
  useEffect(() => {
    if (!enabled || status === "stopped") {
      engagedRef.current = false;
      interactDirtyRef.current = false;
      interactViewportRef.current = null;
      lastBandRef.current = null;
      if (detachedRef.current) setDetached(false);
      return;
    }
    if (status === "playing" && !detachedRef.current) {
      engagedRef.current = true;
    }
  }, [enabled, status]);

  return { detached, reengage, onPlayheadRect, onUserInteract };
}

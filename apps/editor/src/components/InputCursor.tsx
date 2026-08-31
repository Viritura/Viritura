import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import {
  detectStaves,
  findStaffAtPosition,
  snapToStaffPosition,
  getStaffPosition,
  type StaffInfo,
  type DisplayList,
  type SpatialIndex,
} from "@viritura/renderer";
import type { Score, NoteValueBase } from "@viritura/core";
import { useNoteInput, type DotCount } from "../store/noteInputStore";
import {
  OPTIMISTIC_NOTE_INPUT_EVENT,
  type OptimisticNoteInputDetail,
  type NoteInputClickInfo,
  ensureCanvasSize,
  applyOverlayTransform,
  paintInputOverlay,
  paintOptimisticOverlay,
} from "./inputCursorHelpers";
import { useGlyphWarmup } from "./useGlyphWarmup";

function cursorCanvasStyle(active: boolean): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    pointerEvents: active ? "auto" : "none",
    cursor: active ? "crosshair" : "default",
    zIndex: 10,
  };
}

export type { NoteInputClickInfo };

interface InputCursorProps {
  /** Current display list (for staff detection). */
  displayList: DisplayList | null;
  /** Viewport scroll X in score coordinates. */
  scrollX: number;
  /** Viewport scroll Y in score coordinates. */
  scrollY: number;
  /** Current zoom level. */
  zoom: number;
  /** Called when the user clicks in note input mode. */
  onClick?: (info: NoteInputClickInfo) => void;
  /** Spatial index for resolving cursor X from beat position. */
  spatialIndex: SpatialIndex | null;
  /** Current score for resolving cursor position to events. */
  score: Score | null;
  /** Called when the hovered beat position changes (for debug display). */
  onHoverBeat?: (info: { measureIndex: number; beat: number; scoreX: number } | null) => void;
}

/**
 * Overlay canvas for input cursor and ghost note preview.
 *
 * Renders on top of the score canvas. Only visible when note input mode is
 * active. Tracks mouse movement at 60fps via requestAnimationFrame and
 * draws a blue cursor line + semi-transparent ghost notehead snapped to
 * the nearest staff line/space.
 */
export function InputCursor({
  displayList,
  scrollX,
  scrollY,
  zoom,
  onClick,
  spatialIndex,
  score,
  onHoverBeat,
}: InputCursorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state: inputState, toggleNoteInput } = useNoteInput();
  const stavesRef = useRef<StaffInfo[]>([]);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const altKeyRef = useRef(false);
  const rafRef = useRef(0);

  // Mirror the viewport into a ref so paint/schedule callbacks can read the
  // latest scroll/zoom without listing them as deps. Panning changes these
  // ~60x/sec; closing over them would recreate scheduleRepaint every frame and
  // force the ResizeObserver + mouse/keyboard listener effects below to tear
  // down and rebind on every micro-move (the source of a passive-effect storm).
  // Updated in a layout effect below (refs must not be written during render).
  const viewportRef = useRef({ scrollX, scrollY, zoom });

  // Recompute staves when display list changes
  useEffect(() => {
    stavesRef.current = displayList ? detectStaves(displayList) : [];
  }, [displayList]);

  // Paint overlay
  const paintOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { scrollX: sx, scrollY: sy, zoom: z } = viewportRef.current;
    const dpr = window.devicePixelRatio || 1;
    ensureCanvasSize(canvas, dpr);
    applyOverlayTransform(ctx, canvas, dpr, z, sx, sy);
    if (!inputState.active) return;

    paintInputOverlay(ctx, {
      cursor: inputState.cursorPosition,
      mouse: mouseRef.current,
      altKey: altKeyRef.current,
      staves: stavesRef.current,
      spatialIndex,
      score,
      displayList,
      currentVoice: inputState.currentVoice,
      currentDuration: inputState.currentDuration as NoteValueBase,
      currentAccidental: inputState.currentAccidental,
      isRest: inputState.isRest,
      dotCount: inputState.dotCount as DotCount,
      zoom: z,
      scrollX: sx,
      scrollY: sy,
      onHoverBeat,
    });
  }, [inputState, spatialIndex, score, displayList, onHoverBeat]);

  // Keep the latest paint closure in a ref so scheduleRepaint can stay stable
  // (empty deps) — the subscription effects below depend on it and must not
  // churn on every viewport change.
  const paintOverlayRef = useRef(paintOverlay);

  // Refresh the mirrored refs before each paint frame. A layout effect runs
  // synchronously after commit and before requestAnimationFrame callbacks, so
  // the scheduled paint always reads the current scroll/zoom and paint closure.
  useLayoutEffect(() => {
    viewportRef.current = { scrollX, scrollY, zoom };
    paintOverlayRef.current = paintOverlay;
    paintOverlay();
  }, [scrollX, scrollY, zoom, paintOverlay]);

  // Schedule repaint on mouse move
  const scheduleRepaint = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => paintOverlayRef.current());
  }, []);

  const paintOptimisticNote = useCallback(
    (detail: OptimisticNoteInputDetail) => {
      const canvas = canvasRef.current;
      if (!canvas || (!inputState.active && !detail.optimisticOnly)) return;
      if (!spatialIndex || !score || stavesRef.current.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { scrollX: sx, scrollY: sy, zoom: z } = viewportRef.current;
      const dpr = window.devicePixelRatio || 1;
      ensureCanvasSize(canvas, dpr);
      applyOverlayTransform(ctx, canvas, dpr, z, sx, sy);

      const painted = paintOptimisticOverlay(ctx, {
        detail,
        staves: stavesRef.current,
        spatialIndex,
        score,
        displayList,
        currentVoice: inputState.currentVoice,
      });
      if (!painted) return;

      performance.mark("viritura:optimistic-paint-end");
      try {
        performance.measure(
          "viritura:optimistic-input-to-paint",
          "viritura:input-event",
          "viritura:optimistic-paint-end",
        );
        performance.measure("viritura:input-to-paint", "viritura:input-event", "viritura:optimistic-paint-end");
        (
          window as typeof window & { __VIRITURA_OPTIMISTIC_INPUT_PAINTED__?: boolean }
        ).__VIRITURA_OPTIMISTIC_INPUT_PAINTED__ = true;
      } catch {
        // No input-event mark was recorded for this edit.
      }
    },
    [displayList, inputState.active, inputState.currentVoice, score, spatialIndex],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      paintOptimisticNote((event as CustomEvent<OptimisticNoteInputDetail>).detail);
    };
    window.addEventListener(OPTIMISTIC_NOTE_INPUT_EVENT, handler);
    return () => window.removeEventListener(OPTIMISTIC_NOTE_INPUT_EVENT, handler);
  }, [paintOptimisticNote]);

  // Warm the Bravura glyph raster the moment note-input activates so the first
  // real keystroke stays inside its <16ms budget (cold cost is ~100ms on a
  // large score). Paint-path warm-up only; never touches engine layout.
  useGlyphWarmup(canvasRef, inputState.active);

  // Resize overlay canvas to match the sibling score canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const scoreCanvas = canvas.parentElement?.querySelector("canvas:not([data-testid])") as HTMLCanvasElement | null;
      if (!scoreCanvas) return;
      const dpr = window.devicePixelRatio || 1;
      const vw = scoreCanvas.clientWidth;
      const vh = scoreCanvas.clientHeight;
      canvas.width = vw * dpr;
      canvas.height = vh * dpr;
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      scheduleRepaint();
    };
    resize();
    const parent = canvas.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [displayList, zoom, scheduleRepaint]);

  // Track mouse movement over the overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      altKeyRef.current = e.altKey;
      scheduleRepaint();
    };
    const onMouseLeave = () => {
      mouseRef.current = null;
      scheduleRepaint();
    };
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", onMouseLeave);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altKeyRef.current = true;
        scheduleRepaint();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altKeyRef.current = false;
        scheduleRepaint();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      cancelAnimationFrame(rafRef.current);
    };
  }, [scheduleRepaint]);

  // Handle click: compute note position and emit callback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onClick) return;
    const handleClick = (e: MouseEvent) => {
      const { scrollX: sx, scrollY: sy, zoom: z } = viewportRef.current;
      const rect = canvas.getBoundingClientRect();
      const scoreX = (e.clientX - rect.left) / z + sx;
      const scoreY = (e.clientY - rect.top) / z + sy;
      const staff = findStaffAtPosition(stavesRef.current, scoreX, scoreY);
      if (!staff) return;
      const snappedY = snapToStaffPosition(scoreY, staff);
      const staffPos = getStaffPosition(snappedY, staff);
      onClick({ scoreX, scoreY: snappedY, staffPosition: staffPos, staff, shiftKey: e.shiftKey, altKey: e.altKey });
    };
    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [onClick]);

  // Handle mouse thumb button: toggle note input mode off
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        return;
      }
      if (e.button === 3) {
        e.preventDefault();
        toggleNoteInput();
      }
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    return () => canvas.removeEventListener("pointerdown", handlePointerDown);
  }, [toggleNoteInput]);

  return <canvas ref={canvasRef} style={cursorCanvasStyle(inputState.active)} />;
}

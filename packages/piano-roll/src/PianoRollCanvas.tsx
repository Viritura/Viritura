/**
 * PianoRollCanvas — WebGL2 renderer for the Synthesia-style waterfall.
 *
 * This file is a thin host: it owns the `<canvas>`, observes its size,
 * wires React props into the imperative `PianoRollGl` renderer, and
 * forwards wheel events to the viewport hook. All rendering work
 * happens in `webglRenderer/` (programs, buffers, draw calls).
 *
 * Why WebGL2: 10k+ notes in a single instanced draw call vs. 10k
 * `ctx.fill()` calls, plus matrix-uniform pan/zoom that doesn't churn
 * per-vertex CPU work. The score renderer stays Canvas 2D — only the
 * piano roll moves to WebGL2 in this iteration.
 *
 * Migration note: WebGPU is the obvious next step once cross-browser
 * support catches up. The renderer is structured as a small façade
 * over modular pipelines, so a port should be confined to
 * `webglRenderer/`.
 *
 * The `PianoKeyboard` strip below remains Canvas-2D/SVG — it's small,
 * mostly static, and trivially themeable that way.
 */

import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type WheelEvent } from "react";
import { usePianoRollActions, usePianoRollSelection, usePianoRollViewport } from "./usePianoRoll";
import type { PianoRollNote } from "./types";
import { PianoRollGl, resolveRollTheme, type NoteColorResolver } from "./webglRenderer";

const HOST_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  position: "relative",
  background: "var(--canvas-bg)",
  overflow: "hidden",
};

const CANVAS_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
};

const FALLBACK_COLOR: readonly [number, number, number, number] = [0.18, 0.49, 0.42, 1];

interface PianoRollCanvasProps {
  /** Time-ordered notes to render. */
  notes: readonly PianoRollNote[];
  /** Current playhead time in seconds. Drives the entire time→Y mapping. */
  playheadSeconds: number;
  /** Optional palette: partIndex → CSS colour. */
  partColors?: ReadonlyMap<number, string>;
}

export function PianoRollCanvas({ notes, playheadSeconds, partColors }: PianoRollCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PianoRollGl | null>(null);

  const viewport = usePianoRollViewport();
  const selection = usePianoRollSelection();
  const { setViewport } = usePianoRollActions();

  // Resolve part colours into RGBA tuples once per `partColors` change.
  // The renderer takes a `NoteColorResolver` callback so it can look up
  // by `partIndex` during instance packing.
  const resolveColor = useMemo<NoteColorResolver>(() => {
    const table = new Map<number, readonly [number, number, number, number]>();
    if (partColors) {
      for (const [idx, css] of partColors) {
        table.set(idx, cssColorToRgba(css) ?? FALLBACK_COLOR);
      }
    }
    return (partIndex: number) => table.get(partIndex) ?? FALLBACK_COLOR;
  }, [partColors]);

  // ── Renderer lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let renderer: PianoRollGl;
    try {
      renderer = new PianoRollGl(canvas);
    } catch (err) {
      // WebGL2 unavailable — surface a console error rather than
      // crashing the editor. (Production fallback to Canvas-2D is out
      // of scope for this migration.)
      console.error("[piano-roll] failed to initialise WebGL2:", err);
      return;
    }
    renderer.setTheme(resolveRollTheme(host));
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, []);

  // ── Size tracking ───────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const r = rendererRef.current;
      if (!r) return;
      r.resize(rect.width, rect.height, dpr);
      r.render();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // ── Push static props into the renderer ─────────────────────────────────
  // Theme / viewport / notes / selection are *not* per-frame; pushing
  // them on commit is correct. Playhead is handled separately by the
  // rAF integrator below.
  useEffect(() => {
    const host = hostRef.current;
    const r = rendererRef.current;
    if (!r || !host) return;
    r.setTheme(resolveRollTheme(host));
    r.setViewport(viewport);
    r.setNotes(notes, resolveColor);
    r.setSelection(selection);
    r.render();
  }, [notes, resolveColor, selection, viewport]);

  // ── Playhead: rAF-paced extrapolation from latest prop sample ──────────
  // The playhead value arrives from the audio engine on its own cadence
  // (typically ~60 Hz but not vsync-locked). Pushing the raw prop value
  // to the renderer means rAF frames see a value that hops in irregular
  // steps — visible as falling-note jitter even though the per-frame Y
  // math is smooth.
  //
  // Instead we keep a ref of the latest sample + its `performance.now()`
  // arrival time, run our own rAF loop, and on each frame render
  // `value + (now - sampleAtMs)` so the time → Y mapping advances by the
  // *true* wall-clock delta per vsync. When the prop hasn't ticked in
  // ≥ STALE_MS we assume transport is paused/stopped and stop
  // extrapolating so the rendered playhead doesn't drift past reality.
  const STALE_MS = 100;
  const playheadSampleRef = useRef<{ value: number; atMs: number } | null>(null);
  useEffect(() => {
    playheadSampleRef.current = {
      value: playheadSeconds,
      atMs: performance.now(),
    };
  }, [playheadSeconds]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const r = rendererRef.current;
      const sample = playheadSampleRef.current;
      if (r && sample) {
        const dtMs = performance.now() - sample.atMs;
        const extrapolated = dtMs < STALE_MS ? sample.value + dtMs / 1000 : sample.value;
        r.setPlayhead(extrapolated);
        r.render();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Wheel: zoom the time density ────────────────────────────────────────
  const handleWheel = useCallback(
    (e: WheelEvent<HTMLCanvasElement>) => {
      const factor = Math.exp(e.deltaY * 0.001);
      setViewport((prev) => ({
        ...prev,
        secondsAhead: Math.max(1, Math.min(20, prev.secondsAhead * factor)),
      }));
    },
    [setViewport],
  );

  return (
    <div ref={hostRef} style={HOST_STYLE}>
      <canvas ref={canvasRef} style={CANVAS_STYLE} onWheel={handleWheel} />
    </div>
  );
}

/**
 * Parse a CSS colour string into a linear-space RGBA tuple in 0..1.
 * The piano-roll palette only feeds `#rrggbb`, `rgb(...)` and
 * `rgba(...)` strings through `partColors`, so the parser is deliberately
 * narrow — anything outside that set returns null and the caller falls
 * back to the theme default.
 */
function cssColorToRgba(text: string): readonly [number, number, number, number] | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("#")) {
    if (trimmed.length === 7) {
      const r = parseInt(trimmed.slice(1, 3), 16);
      const g = parseInt(trimmed.slice(3, 5), 16);
      const b = parseInt(trimmed.slice(5, 7), 16);
      if ([r, g, b].some(Number.isNaN)) return null;
      return [r / 255, g / 255, b / 255, 1];
    }
    if (trimmed.length === 4) {
      const r = parseInt(trimmed[1]! + trimmed[1]!, 16);
      const g = parseInt(trimmed[2]! + trimmed[2]!, 16);
      const b = parseInt(trimmed[3]! + trimmed[3]!, 16);
      if ([r, g, b].some(Number.isNaN)) return null;
      return [r / 255, g / 255, b / 255, 1];
    }
    return null;
  }
  const m = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const nums = m[1]!
    .replace("/", ",")
    .split(",")
    .map((p) => Number.parseFloat(p.trim()))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 3) return null;
  const a = nums.length >= 4 ? nums[3]! : 1;
  return [nums[0]! / 255, nums[1]! / 255, nums[2]! / 255, a];
}

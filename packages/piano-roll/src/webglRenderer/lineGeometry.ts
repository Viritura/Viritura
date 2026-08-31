/**
 * Line-instance buffer packing (grid lines, octave anchors, playhead,
 * playhead glow). Each instance is a pixel-space axis-aligned rect with
 * a color and a softness parameter (0 = crisp AA, >0 = soft glow).
 *
 * Layout (36 bytes / 9 floats per instance):
 *
 *   offset  bytes  attribute   meaning
 *   ------  -----  ----------  --------------------------------------
 *        0     16  a_rect      (x, y, w, h) in CSS px — vec4
 *       16     16  a_color     (r, g, b, a) in 0..1   — vec4
 *       32      4  a_softness  soft-edge half-width   — float
 *
 * Sub-concept files (not sliced by kind) — this file owns BOTH the
 * pack function and the VAO bindings because the packing and the
 * shader-attribute layout must move together to stay consistent.
 */

import { timeToY, type KeyBounds } from "../pianoRollGrid";
import type { PianoRollViewport } from "../types";

export const LINE_INSTANCE_BYTES = 36;
export const LINE_INSTANCE_FLOATS = LINE_INSTANCE_BYTES / 4;

export interface LineInstance {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: readonly [number, number, number, number];
  /** 0 = crisp (fragment-AA); >0 = soft edge with this half-width in px. */
  readonly softness: number;
}

/** Pack a sequence of `LineInstance`s into one Float32Array. */
export function packLineInstances(lines: readonly LineInstance[]): Float32Array {
  const out = new Float32Array(lines.length * LINE_INSTANCE_FLOATS);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const base = i * LINE_INSTANCE_FLOATS;
    out[base + 0] = line.x;
    out[base + 1] = line.y;
    out[base + 2] = line.width;
    out[base + 3] = line.height;
    out[base + 4] = line.color[0];
    out[base + 5] = line.color[1];
    out[base + 6] = line.color[2];
    out[base + 7] = line.color[3];
    out[base + 8] = line.softness;
  }
  return out;
}

/** Wire the line-instance VAO bindings on the currently bound program. */
export function bindLineInstanceAttributes(gl: WebGL2RenderingContext): void {
  const stride = LINE_INSTANCE_BYTES;
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);

  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(2, 1);

  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);
  gl.vertexAttribDivisor(3, 1);
}

// ── Geometry builders ─────────────────────────────────────────────────────

export interface BuildDecorationLinesArgs {
  viewport: PianoRollViewport;
  widthPx: number;
  heightPx: number;
  keyLayout: ReadonlyMap<number, KeyBounds>;
  playheadSeconds: number;
  octaveColor: readonly [number, number, number, number];
  gridColor: readonly [number, number, number, number];
  playheadColor: readonly [number, number, number, number];
  playheadGlowColor: readonly [number, number, number, number];
}

/**
 * Build the static-per-frame decoration: vertical octave anchors,
 * horizontal one-second grid lines, playhead glow, playhead line.
 * Packed in back-to-front order so a single instanced draw is correct
 * without depth testing.
 */
export function buildDecorationLines(args: BuildDecorationLinesArgs): LineInstance[] {
  const { viewport, widthPx, heightPx, keyLayout, playheadSeconds } = args;
  const lines: LineInstance[] = [];

  // Vertical octave anchors at every C in the visible pitch range.
  for (let midi = viewport.minMidi; midi <= viewport.maxMidi; midi++) {
    if (((midi % 12) + 12) % 12 !== 0) continue;
    const bounds = keyLayout.get(midi);
    if (!bounds) continue;
    // Center the 1px anchor on the C key's left edge — matches the
    // Canvas-2D reference.
    lines.push({
      x: bounds.x - 0.5,
      y: 0,
      width: 1,
      height: heightPx,
      color: args.octaveColor,
      softness: 0,
    });
  }

  // Horizontal grid line every second of look-ahead.
  const startSec = Math.ceil(playheadSeconds);
  const endSec = Math.floor(playheadSeconds + viewport.secondsAhead);
  for (let s = startSec; s <= endSec; s++) {
    const y = timeToY(s, playheadSeconds, viewport, heightPx);
    lines.push({
      x: 0,
      y: y - 0.5,
      width: widthPx,
      height: 1,
      color: args.gridColor,
      softness: 0,
    });
  }

  // Playhead glow (soft 16px band) under the line itself.
  lines.push({
    x: 0,
    y: heightPx - 8,
    width: widthPx,
    height: 16,
    color: args.playheadGlowColor,
    softness: 8,
  });

  // Playhead line — 2px tall, sits flush at the bottom edge.
  lines.push({
    x: 0,
    y: heightPx - 2,
    width: widthPx,
    height: 2,
    color: args.playheadColor,
    softness: 0,
  });

  return lines;
}

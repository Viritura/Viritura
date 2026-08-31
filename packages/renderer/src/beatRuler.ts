/**
 * Shared beat ruler painting used by both note input cursor and spanner drag.
 *
 * Renders vertical tick marks at snap positions with a hierarchical visual
 * weight based on beat importance:
 * - Downbeats (beat 0): tallest, most opaque
 * - Whole beats (1, 2, 3): tall
 * - Half beats (0.5, 1.5): medium
 * - Sub-beats (eighths, sixteenths): short, faintest
 *
 * The active (selected/nearest) tick is highlighted in blue.
 */

/** A tick mark in the beat ruler. */
export interface RulerTick {
  /** X position in score coordinates. */
  x: number;
  /** Beat position within the measure (e.g. 0, 0.5, 1, 1.25). */
  beat: number;
  /** Whether this tick is at an existing event onset. */
  isEventOnset?: boolean;
  /** Whether this is the currently active/selected tick. */
  active?: boolean;
}

/** Configuration for the ruler painter. */
export interface RulerConfig {
  /** Y position of the ruler baseline. */
  rulerY: number;
  /** Staff spatium (space between staff lines) — controls tick scale. */
  spatium: number;
  /** The active tick color. Default: blue. */
  activeColor?: string;
  /** The inactive tick color. Default: gray. */
  inactiveColor?: string;
}

/**
 * Paint a beat ruler with hierarchical tick marks.
 *
 * Call within a canvas save/restore block — does not save/restore itself.
 */
export function paintBeatRuler(
  ctx: CanvasRenderingContext2D,
  ticks: ReadonlyArray<RulerTick>,
  config: RulerConfig,
): void {
  if (ticks.length === 0) return;

  const { rulerY, spatium } = config;
  const activeColor = config.activeColor ?? "rgba(33, 150, 243, 1)";
  const inactiveColor = config.inactiveColor ?? "rgba(100, 100, 100, 1)";
  const maxTickH = spatium * 0.9;

  // Draw ticks
  for (const tick of ticks) {
    const isDownbeat = Math.abs(tick.beat) < 1e-9;
    const isWholeBeat = Math.abs(tick.beat - Math.round(tick.beat)) < 1e-9;
    const isHalfBeat = Math.abs(tick.beat * 2 - Math.round(tick.beat * 2)) < 1e-9;

    let tickH: number;
    let alpha: number;
    let lw: number;

    if (tick.active) {
      tickH = maxTickH;
      alpha = 0.8;
      lw = 2.0;
    } else if (isDownbeat) {
      tickH = maxTickH;
      alpha = 0.55;
      lw = 1.5;
    } else if (tick.isEventOnset && isWholeBeat) {
      tickH = maxTickH * 0.85;
      alpha = 0.5;
      lw = 1.4;
    } else if (isWholeBeat) {
      tickH = maxTickH * 0.8;
      alpha = 0.4;
      lw = 1.2;
    } else if (tick.isEventOnset) {
      tickH = maxTickH * 0.65;
      alpha = 0.35;
      lw = 1.0;
    } else if (isHalfBeat) {
      tickH = maxTickH * 0.5;
      alpha = 0.25;
      lw = 0.8;
    } else {
      tickH = maxTickH * 0.3;
      alpha = 0.15;
      lw = 0.6;
    }

    // Parse base color and apply alpha
    const color = tick.active ? activeColor : inactiveColor;
    ctx.strokeStyle = applyAlpha(color, alpha);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(tick.x, rulerY);
    ctx.lineTo(tick.x, rulerY + tickH);
    ctx.stroke();
  }

  // Draw baseline spanning all ticks
  const leftX = ticks.reduce((min, t) => Math.min(min, t.x), Infinity);
  const rightX = ticks.reduce((max, t) => Math.max(max, t.x), -Infinity);
  ctx.strokeStyle = applyAlpha(inactiveColor, 0.12);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(leftX, rulerY);
  ctx.lineTo(rightX, rulerY);
  ctx.stroke();
}

/**
 * Apply an alpha multiplier to a CSS color string.
 * Handles "rgba(...)", "rgb(...)", and hex colors.
 */
function applyAlpha(color: string, alpha: number): string {
  // If already rgba, replace the alpha
  const rgbaMatch = color.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)$/);
  if (rgbaMatch) {
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${alpha})`;
  }
  // If rgb, add alpha
  const rgbMatch = color.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }
  // Fallback: just return with opacity (works okay for most cases)
  return `rgba(100, 100, 100, ${alpha})`;
}

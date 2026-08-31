/**
 * Theme palette resolved from CSS variables on the host element.
 *
 * Matches the contract the Canvas-2D painter used (`RollTheme`), so
 * existing CSS hooks (`--canvas-bg`, `--border-hairline`, `--accent-rgb`)
 * keep working unchanged.
 */

export interface RollTheme {
  /** Background fill, applied via `gl.clearColor`. */
  canvasBg: readonly [number, number, number, number];
  /** Hairline horizontal grid lines. */
  gridLine: readonly [number, number, number, number];
  /** Brighter line at each C anchor. */
  octaveLine: readonly [number, number, number, number];
  /** Solid playhead. */
  playhead: readonly [number, number, number, number];
  /** Soft playhead glow band. */
  playheadGlow: readonly [number, number, number, number];
  /** Selection outline (mixed into the note edge). */
  selection: readonly [number, number, number, number];
  /** Default per-note color when no part palette entry exists. */
  defaultNote: readonly [number, number, number, number];
}

const DEFAULT_ACCENT: readonly [number, number, number] = [33, 94, 78];

/** Read theme tokens from `host`'s computed style; falls back if missing. */
export function resolveRollTheme(host: HTMLElement): RollTheme {
  const cs = getComputedStyle(host);
  const accent = parseRgbTriplet(cs.getPropertyValue("--accent-rgb").trim()) ?? DEFAULT_ACCENT;
  const canvasBgStr = cs.getPropertyValue("--canvas-bg").trim();
  const gridStr = cs.getPropertyValue("--border-hairline").trim();
  return {
    canvasBg: parseAnyColor(canvasBgStr) ?? [0x16 / 255, 0x16 / 255, 0x1c / 255, 1],
    gridLine: parseAnyColor(gridStr) ?? [1, 1, 1, 0.06],
    octaveLine: rgbWithAlpha(accent, 0.12),
    playhead: rgbWithAlpha(accent, 1),
    playheadGlow: rgbWithAlpha(accent, 0.35),
    selection: rgbWithAlpha(accent, 0.85),
    defaultNote: rgbWithAlpha(accent, 1),
  };
}

/** Parse "r, g, b" triplet (CSS-var style for `--accent-rgb`). */
function parseRgbTriplet(text: string): readonly [number, number, number] | null {
  const parts = text.split(",").map((p) => Number.parseInt(p.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function rgbWithAlpha(
  rgb: readonly [number, number, number],
  alpha: number,
): readonly [number, number, number, number] {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, alpha];
}

/**
 * Parse a CSS color string into linear-space RGBA tuple in 0..1.
 * Handles `#rrggbb`, `rgb(r g b)`, `rgba(r g b / a)`, `rgb(r,g,b)`,
 * and `rgba(r,g,b,a)` — enough for the values our theme CSS uses.
 */
function parseAnyColor(text: string): readonly [number, number, number, number] | null {
  if (text.length === 0) return null;
  if (text === "transparent") return [0, 0, 0, 0];
  if (text.startsWith("#")) return parseHex(text);
  const m = text.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const inner = m[1]!.replace("/", ",");
  const nums = inner
    .split(",")
    .map((p) => Number.parseFloat(p.trim()))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 3) return null;
  const r = nums[0]! / 255;
  const g = nums[1]! / 255;
  const b = nums[2]! / 255;
  const a = nums.length >= 4 ? nums[3]! : 1;
  return [r, g, b, a];
}

function parseHex(text: string): readonly [number, number, number, number] | null {
  if (text.length === 4) {
    const r = parseInt(text[1]! + text[1]!, 16);
    const g = parseInt(text[2]! + text[2]!, 16);
    const b = parseInt(text[3]! + text[3]!, 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r / 255, g / 255, b / 255, 1];
  }
  if (text.length === 7) {
    const r = parseInt(text.slice(1, 3), 16);
    const g = parseInt(text.slice(3, 5), 16);
    const b = parseInt(text.slice(5, 7), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r / 255, g / 255, b / 255, 1];
  }
  return null;
}

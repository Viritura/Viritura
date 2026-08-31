/**
 * Helpers, constants, and the `RadialMenuItem` type for `RadialMenu`.
 * Lives in a sibling file so RadialMenu.tsx exports only components
 * (satisfies `react-refresh/only-export-components`).
 */

import type { ReactNode } from "react";

// ═══════════════════════════════════════════
// Paper material data URIs
// ═══════════════════════════════════════════
//
// These are LITERALLY the same SVG data URIs that --paper-bg uses in
// tokens.css. We embed them via <image> inside the SVG <pattern> so
// the wedges render pixel-identical noise to every other paper surface
// in the app. Recreating the filter chain inline (feTurbulence +
// feColorMatrix) caused visible drift between browsers and across
// rasterizers — using the same data URI eliminates that class of bug.
//
// If you change these, change the matching --paper-bg in tokens.css.

export const PAPER_NOISE_LIGHT =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch' seed='4'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>";

export const PAPER_NOISE_DARK =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch' seed='4'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.08 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>";

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface RadialMenuItem {
  /** Unique key for the item */
  id: string;
  /** Visual icon (emoji, SVG, or text glyph) */
  icon?: ReactNode;
  /** Short label shown under the icon */
  label: string;
  /** Angular weight — how much wider this wedge is relative to others (default 1) */
  weight?: number;
  /** Extra search aliases (matched by filter in addition to label) */
  searchKeys?: string[];
  /** When true, filter matches label and searchKeys case-sensitively (e.g., key signatures) */
  caseSensitiveSearch?: boolean;
  /** Optional keyboard shortcut hint text (e.g. "F1", "Y") */
  hint?: string;
  /** Selecting this item seeds the expression field instead of closing the menu. */
  expressionSeed?: string;
}

/**
 * Filter radial menu items by search query.
 * - startsWith matching (not includes)
 * - Whitespace stripped from both query and candidates
 * - Respects `caseSensitiveSearch` per item
 * - Exact matches take priority over prefix matches
 */
export function filterRadialMenuItems(items: RadialMenuItem[], searchQuery: string): RadialMenuItem[] {
  if (!searchQuery) return items;
  const strip = (s: string) => s.replace(/\s+/g, "");
  const q = strip(searchQuery);

  const matchItem = (item: RadialMenuItem) => {
    const cs = item.caseSensitiveSearch === true;
    const qCmp = cs ? q : q.toLowerCase();
    const norm = (s: string) => {
      const n = strip(s);
      return cs ? n : n.toLowerCase();
    };

    let exact = false;
    let prefix = false;
    if (norm(item.label) === qCmp) exact = true;
    else if (norm(item.label).startsWith(qCmp)) prefix = true;
    for (const k of item.searchKeys ?? []) {
      if (norm(k) === qCmp) exact = true;
      else if (norm(k).startsWith(qCmp)) prefix = true;
    }
    return { exact, prefix: exact || prefix };
  };

  const results = items.map((item) => ({ item, ...matchItem(item) })).filter((r) => r.prefix);
  const hasExact = results.some((r) => r.exact);
  return (hasExact ? results.filter((r) => r.exact) : results).map((r) => r.item);
}

// ═══════════════════════════════════════════
// Geometry
// ═══════════════════════════════════════════

/** Base radius (px) for the medium size — the only one actually used. */
const BASE_RADIUS = 130;

export function defaultRadius(count: number): number {
  // Scale up slightly for many items so labels don't overlap
  return Math.max(BASE_RADIUS, Math.min(BASE_RADIUS + count * 4, 220));
}

export function clampPosition(x: number, y: number, radius: number): { x: number; y: number } {
  const margin = radius + 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(margin, Math.min(vw - margin, x)),
    y: Math.max(margin, Math.min(vh - margin, y)),
  };
}

/** Build an SVG arc path for a pie wedge from angle a1 to a2. */
export function wedgePath(cx: number, cy: number, r: number, innerR: number, a1: number, a2: number): string {
  const span = a2 - a1;

  // Full-circle: SVG arcs can't span 2π (start==end), so split into two semicircles
  // Use M (not L) to jump to inner ring without drawing a radial line
  if (span >= 2 * Math.PI - 0.01) {
    return [
      `M ${cx + r} ${cy}`,
      `A ${r} ${r} 0 1 1 ${cx - r} ${cy}`,
      `A ${r} ${r} 0 1 1 ${cx + r} ${cy}`,
      `M ${cx + innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy}`,
      "Z",
    ].join(" ");
  }

  const largeArc = span > Math.PI ? 1 : 0;
  const x1o = cx + r * Math.cos(a1);
  const y1o = cy + r * Math.sin(a1);
  const x2o = cx + r * Math.cos(a2);
  const y2o = cy + r * Math.sin(a2);
  const x1i = cx + innerR * Math.cos(a2);
  const y1i = cy + innerR * Math.sin(a2);
  const x2i = cx + innerR * Math.cos(a1);
  const y2i = cy + innerR * Math.sin(a1);
  return [
    `M ${x1o} ${y1o}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${x2o} ${y2o}`,
    `L ${x1i} ${y1i}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2i} ${y2i}`,
    "Z",
  ].join(" ");
}

// ═══════════════════════════════════════════
// Platform detection
// ═══════════════════════════════════════════

export const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

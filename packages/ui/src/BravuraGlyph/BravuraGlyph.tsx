import { type CSSProperties, type ReactNode } from "react";
import { BRAVURA_FONT_SIZES } from "./bravuraFontSizes";
import { BRAVURA_GLYPH_BBOXES } from "./bravuraGlyphBBoxes";

// ── Glyph centering ────────────────────────────────────────────────────
//
// SMuFL music glyphs have wildly different bounding boxes. Two alignment
// modes:
//
//   "baseline" — apply a SINGLE offset derived from a reference notehead
//     glyph, so every glyph keeps its natural font baseline. Use for the
//     duration row where noteheads must line up across whole/half/quarter/
//     eighth even though stems make the bboxes very different sizes.
//
//   "center"   — apply a per-glyph offset that visually centres each
//     glyph's bbox in the button. Use for standalone glyphs (rests,
//     accidentals, clefs, ornaments) that should look mathematically
//     centred in their pill.
//
// Both modes are computed deterministically from Bravura's published
// `glyphBBoxes` metadata (em-relative ink extents) plus a hardcoded
// font-bbox half-extent ratio. We deliberately avoid canvas
// `measureText` — Chromium returns wildly wrong `actualBoundingBox*`
// values for SMuFL private-use codepoints, and `fontBoundingBox*`
// values are unstable depending on the canvas's render context (a
// detached canvas created inside React render can report `50/50` even
// when Bravura is otherwise loaded and applied). Sampling 16 / 19.2 /
// 24.8 px Bravura in Chromium yields `(fontAsc-fontDes)/2 ≈ 0.34` per
// em — baked in as `BRAVURA_BASELINE_OFFSET_PER_EM` below.

/** `(fontBoundingBoxAscent - fontBoundingBoxDescent) / 2` per em.
 *  How far Bravura's text baseline sits BELOW the line-box centre. */
const BRAVURA_BASELINE_OFFSET_PER_EM = 0.34;

const glyphOffsetCache = new Map<string, number>();

const REFERENCE_GLYPH = "\uE0A4"; // noteheadBlack — baseline anchor for the duration row
const REFERENCE_BBOX = BRAVURA_GLYPH_BBOXES[REFERENCE_GLYPH];

function parseFontSizePx(fontSize: string): number {
  const m = /^([\d.]+)(rem|px|em)?$/.exec(fontSize.trim());
  if (!m) return 16;
  const n = parseFloat(m[1]!);
  const unit = m[2] ?? "px";
  if (unit === "px") return n;
  // rem and em both fall back to 16 (the html root size) — toolbar/palette
  // buttons inherit the document root, which is the design default.
  return n * 16;
}

function getGlyphOffset(content: string, fontSize: string, align: "baseline" | "center"): number {
  const ref = align === "baseline" ? REFERENCE_GLYPH : content;
  const key = `${align}:${ref}@${fontSize}`;
  const cached = glyphOffsetCache.get(key);
  if (cached !== undefined) return cached;
  const bbox = align === "baseline" ? REFERENCE_BBOX : BRAVURA_GLYPH_BBOXES[ref];
  if (!bbox) {
    // Unknown glyph — leave it at the browser's default inline-block
    // placement. Add the codepoint to `bravuraGlyphBBoxes.ts` if you
    // need precise centering for it.
    glyphOffsetCache.set(key, 0);
    return 0;
  }
  const fsPx = parseFontSizePx(fontSize);
  // SMuFL `glyphBBoxes` values are in staff-spaces; 1 em = 4 staff-spaces.
  const actAsc = (bbox.ascent / 4) * fsPx;
  const actDes = (bbox.descent / 4) * fsPx;
  // (actAsc-actDes)/2 puts the glyph's bbox-centre AT the text baseline.
  // The baseline sits below the line-box centre by
  // BRAVURA_BASELINE_OFFSET_PER_EM * fsPx; subtract so the bbox lands at
  // the line-box centre — i.e. visually centred in the button.
  const offset = (actAsc - actDes) / 2 - BRAVURA_BASELINE_OFFSET_PER_EM * fsPx;
  glyphOffsetCache.set(key, offset);
  return offset;
}

export interface BravuraGlyphProps {
  /** SMuFL glyph string (typically a single codepoint from `String.fromCodePoint`). */
  children: string;
  /** Vertical alignment mode. See module-level docs. */
  align?: "center" | "baseline";
  /** Explicit font-size (CSS value). Falls back to BRAVURA_FONT_SIZES[size]. */
  fontSize?: string;
  /** Size key into BRAVURA_FONT_SIZES when no explicit fontSize is given. */
  size?: keyof typeof BRAVURA_FONT_SIZES;
}

/**
 * Renders a Bravura SMuFL glyph with deterministic vertical centering.
 *
 * The wrapping `<span>` carries the `transform: translateY(...)` so it
 * doesn't disturb baseline alignment of any non-glyph siblings inside the
 * same button row.
 *
 * Internal to the Button family — not re-exported from `@viritura/ui`.
 * If a caller needs a bare glyph outside a Button, promote this then.
 */
export function BravuraGlyph({ children, align = "center", fontSize, size = "md" }: BravuraGlyphProps): ReactNode {
  const fs = fontSize ?? BRAVURA_FONT_SIZES[size] ?? "1.2rem";
  const offset = getGlyphOffset(children, fs, align);
  const wrapStyle: CSSProperties = {
    display: "inline-block",
    ...(fontSize ? { fontSize } : {}),
    ...(offset ? { transform: `translateY(${offset}px)` } : {}),
  };
  return <span style={wrapStyle}>{children}</span>;
}

/**
 * SVG Painter — converts a DisplayList into standalone SVG strings.
 *
 * Delegates glyph/text → path conversion to the Rust/WASM engine via
 * `ttf-parser`, producing self-contained SVGs with no external font
 * dependencies. Coordinates come directly from the layout engine,
 * eliminating the y-flip issues that plagued the JS opentype.js approach.
 */

import type { DisplayList } from "./wasm";
import { isWasmReady, wasmExportSvg } from "./wasm";

// ─── Types ─────────────────────────────────────────────────────────

export interface SvgExportOptions {
  /** Page width in mm. */
  pageWidthMm: number;
  /** Page height in mm. */
  pageHeightMm: number;
  /** Spatium in mm (staff space). */
  spatiumMm: number;
  /** Spatium in pixels (as used by the layout engine). */
  spPixels: number;
  /** URL or ArrayBuffer for the Bravura OTF font. */
  bravuraFont: string | ArrayBuffer;
  /** URL or ArrayBuffer for the serif text font. */
  serifFont?: string | ArrayBuffer;
}

export interface SvgPage {
  /** Page number (1-based). */
  pageNumber: number;
  /** Complete SVG markup for this page. */
  svg: string;
  /** Width in mm. */
  widthMm: number;
  /** Height in mm. */
  heightMm: number;
}

// ─── Font loading ──────────────────────────────────────────────────

async function loadFontBytes(source: string | ArrayBuffer): Promise<Uint8Array> {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Failed to fetch font: ${response.status} ${source}`);
  return new Uint8Array(await response.arrayBuffer());
}

// ─── Main export functions ─────────────────────────────────────────

/**
 * Export a DisplayList to a single SVG string (all pages stacked vertically).
 */
export async function exportSvg(displayList: DisplayList, options: SvgExportOptions): Promise<string> {
  const pages = await exportSvgPages(displayList, options);
  if (pages.length === 1) return pages[0]!.svg;

  // Stack pages vertically with a small gap
  const gapMm = 5;
  let totalHeight = 0;
  const fragments: string[] = [];
  for (const page of pages) {
    fragments.push(`<g transform="translate(0, ${totalHeight.toFixed(2)})">`);
    const inner = page.svg.replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    fragments.push(inner);
    fragments.push("</g>");
    totalHeight += page.heightMm + gapMm;
  }

  const widthMm = pages[0]?.widthMm ?? options.pageWidthMm;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${totalHeight.toFixed(2)}mm" viewBox="0 0 ${widthMm} ${totalHeight.toFixed(2)}">`,
    ...fragments,
    "</svg>",
  ].join("\n");
}

/**
 * Export a DisplayList to per-page SVG strings via the WASM engine.
 */
export async function exportSvgPages(displayList: DisplayList, options: SvgExportOptions): Promise<SvgPage[]> {
  if (!isWasmReady()) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }

  const { pageWidthMm, pageHeightMm, spatiumMm, spPixels } = options;

  // Load fonts as raw byte arrays for WASM.
  const bravuraBytes = await loadFontBytes(options.bravuraFont);
  const textFontBytes = options.serifFont ? await loadFontBytes(options.serifFont) : new Uint8Array(0);

  // Serialize the DisplayList to JSON for WASM.
  const dlJson = JSON.stringify(displayList);

  const wasmPages = wasmExportSvg(dlJson, bravuraBytes, textFontBytes, spatiumMm, spPixels, pageWidthMm, pageHeightMm);

  return wasmPages.map((p) => ({
    pageNumber: p.pageNumber,
    svg: p.svg,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
  }));
}

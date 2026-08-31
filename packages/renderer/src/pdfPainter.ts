/**
 * PdfPainter — renders a DisplayList to a multi-page PDF document.
 *
 * Delegates glyph/text → path conversion to the Rust/WASM engine via
 * `export_svg`. The WASM SVG has correct coordinates for everything,
 * so we just parse the simple SVG elements and draw them via pdf-lib.
 *
 * Optionally embeds the MNX JSON source as a PDF file attachment,
 * allowing the score to be decoded from the PDF later.
 */

import { PDFDocument, rgb, AFRelationship, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { DisplayList } from "./wasm";
import { isWasmReady, wasmExportSvg } from "./wasm";

// ─── Types ─────────────────────────────────────────────────────────

export interface PdfExportOptions {
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
  /** URL or ArrayBuffer for the serif text font (used by WASM SVG export). */
  serifFont?: string | ArrayBuffer;
  /** URL or ArrayBuffer for the PDF text font (regular). */
  pdfTextFont: string | ArrayBuffer;
  /** URL or ArrayBuffer for the PDF text font (bold). */
  pdfTextFontBold: string | ArrayBuffer;
  /** URL or ArrayBuffer for the PDF text font (italic). */
  pdfTextFontItalic: string | ArrayBuffer;
  /** URL or ArrayBuffer for the PDF text font (bold italic). */
  pdfTextFontBoldItalic: string | ArrayBuffer;
  /** Optional MNX JSON string to embed as a file attachment in the PDF. */
  mnxJson?: string;
  /** Score title (used for PDF metadata). */
  title?: string;
}

// ─── Constants ─────────────────────────────────────────────────────

const MM_TO_PT = 72 / 25.4; // ≈ 2.8346

// ─── Font loading ──────────────────────────────────────────────────

async function loadFontBytes(source: string | ArrayBuffer): Promise<Uint8Array> {
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  const r = await fetch(source);
  if (!r.ok) throw new Error(`Failed to fetch font: ${r.status} ${source}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ─── Color parsing ─────────────────────────────────────────────────

function parseColor(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: (parseInt(h.substring(0, 2), 16) || 0) / 255,
    g: (parseInt(h.substring(2, 4), 16) || 0) / 255,
    b: (parseInt(h.substring(4, 6), 16) || 0) / 255,
  };
}

// ─── SVG path coordinate transformation ────────────────────────────

/**
 * Transform an SVG path `d` attribute from mm to PDF points.
 *
 * pdf-lib's drawSvgPath already applies scale(1,-1) to flip Y from SVG
 * y-down to PDF y-up, so we only convert units (mm → pt) without negating Y.
 * The caller anchors the path at (0, pageH) which provides the top-left origin.
 */
function transformPathMmToPt(d: string): string {
  const tokens = d.match(/[MLCQZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gi);
  if (!tokens) return d;

  const out: string[] = [];

  for (const tok of tokens) {
    if (/^[MLCQZ]$/i.test(tok)) {
      out.push(tok);
    } else {
      // Convert mm to pt (both X and Y — pdf-lib handles the Y flip)
      out.push((parseFloat(tok) * MM_TO_PT).toFixed(3));
    }
  }

  return out.join(" ");
}

// ─── SVG element parsing ───────────────────────────────────────────

/**
 * Extract all drawing elements from a single-page SVG string produced
 * by the WASM renderer.  The format is tightly controlled so we can
 * safely use regex.
 */

function attr(el: string, name: string): string {
  const m = el.match(new RegExp(`${name}="([^"]*)"`));
  return m?.[1] ?? "";
}

function numAttr(el: string, name: string): number {
  return parseFloat(attr(el, name)) || 0;
}

// ─── Main export function ──────────────────────────────────────────

export async function exportPdf(displayList: DisplayList, options: PdfExportOptions): Promise<Uint8Array> {
  if (!isWasmReady()) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }

  const { pageWidthMm, pageHeightMm, spatiumMm, spPixels } = options;
  const pageWidthPt = pageWidthMm * MM_TO_PT;
  const pageHeightPt = pageHeightMm * MM_TO_PT;

  // 1. Get SVG pages from WASM (correct coordinates, glyphs as paths)
  const bravuraBytes = await loadFontBytes(options.bravuraFont);
  const textBytes = options.serifFont ? await loadFontBytes(options.serifFont) : new Uint8Array(0);
  const dlJson = JSON.stringify(displayList);

  const svgPages = wasmExportSvg(dlJson, bravuraBytes, textBytes, spatiumMm, spPixels, pageWidthMm, pageHeightMm);

  // Debug: check SVG content
  if (svgPages.length > 0) {
    const svg = svgPages[0]!.svg;
    const pathCount = (svg.match(/<path /g) ?? []).length;
    const lineCount = (svg.match(/<line /g) ?? []).length;
    const ellipseCount = (svg.match(/<ellipse /g) ?? []).length;
    console.log(
      `[PDF Export] SVG page 1: ${svg.length} chars, ${pathCount} paths, ${lineCount} lines, ${ellipseCount} ellipses`,
    );
    console.log(`[PDF Export] Font sizes: bravura=${bravuraBytes.length} bytes, text=${textBytes.length} bytes`);
    console.log(`[PDF Export] DL JSON: ${dlJson.length} chars, commands=${displayList.commands.length}`);
    // Log first path element
    const pathMatch = svg.match(/<path [^>]*>/);
    if (pathMatch) {
      console.log(`[PDF Export] First path: ${pathMatch[0].substring(0, 200)}...`);
    } else {
      console.warn("[PDF Export] NO <path> elements found in SVG!");
    }
  }

  // 2. Create PDF document
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setProducer("Viritura Music Notation Editor");
  pdfDoc.setCreator("Viritura");
  if (options.title) pdfDoc.setTitle(options.title);
  pdfDoc.setCreationDate(new Date());

  // Embed Libertinus Serif fonts for PDF text (supports ♭♯♮ natively)
  const [textFontBytes, textBoldBytes, textItalicBytes, textBoldItalicBytes] = await Promise.all([
    loadFontBytes(options.pdfTextFont),
    loadFontBytes(options.pdfTextFontBold),
    loadFontBytes(options.pdfTextFontItalic),
    loadFontBytes(options.pdfTextFontBoldItalic),
  ]);
  const serifFont = await pdfDoc.embedFont(textFontBytes);
  const serifBoldFont = await pdfDoc.embedFont(textBoldBytes);
  const serifItalicFont = await pdfDoc.embedFont(textItalicBytes);
  const serifBoldItalicFont = await pdfDoc.embedFont(textBoldItalicBytes);
  const pdfFonts = { serifFont, serifBoldFont, serifItalicFont, serifBoldItalicFont };

  // 3. Convert each SVG page to a PDF page
  for (const svgPage of svgPages) {
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    renderSvgToPdf(page, svgPage.svg, pageHeightPt, pdfFonts);
  }

  // 4. Embed MNX JSON as file attachment
  if (options.mnxJson) {
    const mnxBytes = new TextEncoder().encode(options.mnxJson);
    await pdfDoc.attach(mnxBytes, "score.mnx", {
      mimeType: "application/json",
      description: "Viritura MNX score data — import back into Viritura to edit",
      creationDate: new Date(),
      modificationDate: new Date(),
      afRelationship: AFRelationship.Source,
    });
  }

  return pdfDoc.save();
}

// ─── SVG → PDF page rendering ──────────────────────────────────────

/** Convert mm (y-down) to PDF pt (y-up). */
function xPt(xMm: number): number {
  return xMm * MM_TO_PT;
}
function yPt(yMm: number, pageH: number): number {
  return pageH - yMm * MM_TO_PT;
}

interface PdfFonts {
  serifFont: import("pdf-lib").PDFFont;
  serifBoldFont: import("pdf-lib").PDFFont;
  serifItalicFont: import("pdf-lib").PDFFont;
  serifBoldItalicFont: import("pdf-lib").PDFFont;
}

function renderSvgToPdf(
  page: import("pdf-lib").PDFPage,
  svgContent: string,
  pageHeightPt: number,
  fonts: PdfFonts,
): void {
  // Match all top-level SVG elements (our output has no nesting beyond the root <svg>).
  const elementRegex = /<(line|rect|circle|ellipse|path|polygon|text)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  let match: RegExpExecArray | null;

  while ((match = elementRegex.exec(svgContent)) !== null) {
    const tag = match[1]!;
    const attrs = match[2]!;
    const textContent = match[3];
    const opacity = numAttr(attrs, "opacity") || 1.0;

    try {
      switch (tag) {
        case "line":
          drawSvgLine(page, attrs, pageHeightPt, opacity);
          break;
        case "rect":
          drawSvgRect(page, attrs, pageHeightPt, opacity);
          break;
        case "circle":
          drawSvgCircle(page, attrs, pageHeightPt, opacity);
          break;
        case "ellipse":
          drawSvgEllipse(page, attrs, pageHeightPt, opacity);
          break;
        case "path":
          drawSvgPath(page, attrs, pageHeightPt, opacity);
          break;
        case "polygon":
          drawSvgPolygon(page, attrs, pageHeightPt, opacity);
          break;
        case "text":
          drawSvgText(page, attrs, textContent ?? "", pageHeightPt, opacity, fonts);
          break;
      }
    } catch (e) {
      console.warn(`PDF: failed to draw <${tag}>:`, (e as Error).message);
    }
  }
}

// ─── Individual SVG element renderers ──────────────────────────────

function drawSvgLine(page: import("pdf-lib").PDFPage, attrs: string, pageH: number, opacity: number): void {
  const { r, g, b } = parseColor(attr(attrs, "stroke") || "#000000");
  page.drawLine({
    start: { x: xPt(numAttr(attrs, "x1")), y: yPt(numAttr(attrs, "y1"), pageH) },
    end: { x: xPt(numAttr(attrs, "x2")), y: yPt(numAttr(attrs, "y2"), pageH) },
    thickness: numAttr(attrs, "stroke-width") * MM_TO_PT,
    color: rgb(r, g, b),
    opacity,
  });
}

function drawSvgRect(page: import("pdf-lib").PDFPage, attrs: string, pageH: number, opacity: number): void {
  // Skip the background white rect
  const fill = attr(attrs, "fill");
  if (fill === "white" || !attr(attrs, "x")) return;

  const { r, g, b } = parseColor(fill || "#000000");
  const xMm = numAttr(attrs, "x");
  const yMm = numAttr(attrs, "y");
  const wMm = numAttr(attrs, "width");
  const hMm = numAttr(attrs, "height");

  page.drawRectangle({
    x: xPt(xMm),
    y: yPt(yMm + hMm, pageH), // PDF rect y is bottom-left
    width: wMm * MM_TO_PT,
    height: hMm * MM_TO_PT,
    color: rgb(r, g, b),
    opacity,
  });
}

function drawSvgCircle(page: import("pdf-lib").PDFPage, attrs: string, pageH: number, opacity: number): void {
  const { r, g, b } = parseColor(attr(attrs, "fill") || "#000000");
  page.drawCircle({
    x: xPt(numAttr(attrs, "cx")),
    y: yPt(numAttr(attrs, "cy"), pageH),
    size: numAttr(attrs, "r") * MM_TO_PT,
    color: rgb(r, g, b),
    opacity,
  });
}

function drawSvgEllipse(page: import("pdf-lib").PDFPage, attrs: string, pageH: number, opacity: number): void {
  const fill = attr(attrs, "fill");
  const stroke = attr(attrs, "stroke");
  const isFilled = fill !== "none";

  const { r, g, b } = parseColor((isFilled ? fill : stroke) || "#000000");

  page.drawEllipse({
    x: xPt(numAttr(attrs, "cx")),
    y: yPt(numAttr(attrs, "cy"), pageH),
    xScale: numAttr(attrs, "rx") * MM_TO_PT,
    yScale: numAttr(attrs, "ry") * MM_TO_PT,
    color: isFilled ? rgb(r, g, b) : undefined,
    borderColor: !isFilled ? rgb(r, g, b) : undefined,
    opacity,
  });
}

function drawSvgPath(page: import("pdf-lib").PDFPage, attrs: string, pageH: number, opacity: number): void {
  const d = attr(attrs, "d");
  if (!d) return;

  const fill = attr(attrs, "fill");
  const stroke = attr(attrs, "stroke");
  const strokeWidth = numAttr(attrs, "stroke-width");
  const dashArray = attr(attrs, "stroke-dasharray");

  // Transform path coordinates from mm/y-down to pt/y-up.
  const transformedPath = transformPathMmToPt(d);

  const drawOpts: Record<string, unknown> = {
    x: 0,
    y: pageH,
    opacity,
  };

  if (fill && fill !== "none") {
    const { r, g, b } = parseColor(fill);
    drawOpts.color = rgb(r, g, b);
  }
  if (stroke && stroke !== "none") {
    const { r, g, b } = parseColor(stroke);
    drawOpts.borderColor = rgb(r, g, b);
    drawOpts.borderWidth = strokeWidth * MM_TO_PT;
  }
  if (dashArray) {
    const parts = dashArray.split(/[\s,]+/).map(Number);
    drawOpts.borderDashArray = parts.map((v) => v * MM_TO_PT);
  }

  // Handle transform attribute (for rotated glyphs).
  const transformAttr = attr(attrs, "transform");
  if (transformAttr) {
    const translateMatch = transformAttr.match(/translate\(([-\d.]+)\s*,\s*([-\d.]+)\)/);
    const rotateMatch = transformAttr.match(/rotate\(([-\d.]+)\)/);

    if (translateMatch) {
      const tx = parseFloat(translateMatch[1]!);
      const ty = parseFloat(translateMatch[2]!);
      drawOpts.x = xPt(tx);
      drawOpts.y = yPt(ty, pageH);
    }
    if (rotateMatch) {
      // SVG rotation is clockwise; PDF is counter-clockwise.
      // The y-flip effectively mirrors, so the rotation direction stays the same.
      const angleDeg = parseFloat(rotateMatch[1]!);
      drawOpts.rotate = degrees(-angleDeg);
    }
  }

  page.drawSvgPath(transformedPath, drawOpts);
}

function drawSvgPolygon(page: import("pdf-lib").PDFPage, attrs: string, pageH: number, opacity: number): void {
  const pointsStr = attr(attrs, "points");
  if (!pointsStr) return;

  const { r, g, b } = parseColor(attr(attrs, "fill") || "#000000");

  // Convert polygon points to SVG path (mm → pt, no Y negate — pdf-lib does it)
  const pairs = pointsStr.trim().split(/\s+/);
  const pathParts: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [xStr, yStr] = pairs[i]!.split(",");
    const xMm = parseFloat(xStr!);
    const yMm = parseFloat(yStr!);
    pathParts.push(`${i === 0 ? "M" : "L"}${(xMm * MM_TO_PT).toFixed(3)} ${(yMm * MM_TO_PT).toFixed(3)}`);
  }
  pathParts.push("Z");

  page.drawSvgPath(pathParts.join(" "), {
    x: 0,
    y: pageH,
    color: rgb(r, g, b),
    opacity,
  });
}

function drawSvgText(
  page: import("pdf-lib").PDFPage,
  attrs: string,
  textContent: string,
  pageH: number,
  opacity: number,
  fonts: PdfFonts,
): void {
  if (!textContent) return;

  // Unescape XML entities
  const text = textContent
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

  const xMm = numAttr(attrs, "x");
  const yMm = numAttr(attrs, "y");
  const sizeMm = numAttr(attrs, "font-size");
  const { r, g, b } = parseColor(attr(attrs, "fill") || "#000000");

  // Select PDF font based on style/weight
  const fontStyle = attr(attrs, "font-style");
  const fontWeight = attr(attrs, "font-weight");
  const isBold = fontWeight === "bold";
  const isItalic = fontStyle === "italic";
  let pdfFont: import("pdf-lib").PDFFont;
  if (isBold && isItalic) pdfFont = fonts.serifBoldItalicFont;
  else if (isBold) pdfFont = fonts.serifBoldFont;
  else if (isItalic) pdfFont = fonts.serifItalicFont;
  else pdfFont = fonts.serifFont;

  const sizePt = sizeMm * MM_TO_PT;
  let pdfX = xPt(xMm);
  const pdfY = yPt(yMm, pageH);

  // Handle text-anchor (alignment)
  const anchor = attr(attrs, "text-anchor");
  if (anchor === "middle" || anchor === "end") {
    const textWidth = pdfFont.widthOfTextAtSize(text, sizePt);
    if (anchor === "middle") pdfX -= textWidth / 2;
    else pdfX -= textWidth;
  }

  page.drawText(text, {
    x: pdfX,
    y: pdfY,
    size: sizePt,
    font: pdfFont,
    color: rgb(r, g, b),
    opacity,
  });
}

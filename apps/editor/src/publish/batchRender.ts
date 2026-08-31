/**
 * Headless batch render + export helpers for Publish mode.
 *
 * These avoid going through the on-screen ScoreCanvas. They drive the
 * WASM layout engine directly with a per-score PageSetup, then hand
 * the resulting DisplayList to `exportPdf` (or analogous helpers).
 *
 * Used by:
 *   - PublishView: to export multiple selected scores in one batch
 *   - File menu / Ctrl+P: to print the active score (one-item batch)
 */

import type { Score, PageSetup } from "@viritura/core";
import { defaultPageSetupForScore, pageTurnConfigForLayout } from "@viritura/core";
import {
  exportPdf,
  type PdfExportOptions,
  getScoreInfo,
  wasmComputeMnxScoreLayout,
  wasmComputeFullScoreLayout,
  wasmComputeLayout,
} from "@viritura/renderer";
import type { DisplayList } from "@viritura/renderer";
import { serializeMnx } from "@viritura/format";
import { PDFDocument } from "pdf-lib";

// Must match ScoreCanvas.PX_PER_MM. The Rust layout engine works in
// abstract units; we map mm to pixels at this fixed factor before
// computing layout, then pass the same factor through to PDF export.
const PX_PER_MM = 12;

// ─── Page-setup resolution ─────────────────────────────────────────

/**
 * Resolve the effective PageSetup for a given score index, applying
 * the same layered defaults the canvas uses.
 */
export function resolvePageSetupForScore(score: Score, scoreIndex: number): PageSetup {
  const sd = score.scores?.[scoreIndex];
  const defaults = defaultPageSetupForScore(score.scores, scoreIndex, score.layouts, score.parts?.length);
  return {
    ...defaults,
    ...sd?.pageSetup,
    margins: { ...defaults.margins, ...sd?.pageSetup?.margins },
  };
}

/**
 * Get a human-readable name for a score by index. Falls back to
 * "Full score" for index 0 and "Score N" otherwise — matches what
 * the Parts panel shows.
 */
export function getScoreDisplayName(score: Score, scoreIndex: number): string {
  const sd = score.scores?.[scoreIndex];
  return sd?.name ?? (scoreIndex === 0 ? "Full score" : `Score ${scoreIndex + 1}`);
}

// ─── Headless layout ──────────────────────────────────────────────

/**
 * Compute a DisplayList for one score using the given PageSetup.
 * Mirrors the routing logic in `ScoreCanvas.computeDisplayList` for
 * the "no patches, no selection filter, no expanded condensing" path
 * — Publish mode always renders the full, unfiltered layout.
 */
function renderScoreDisplayList(mnxJson: string, scoreIndex: number, pageSetup: PageSetup): DisplayList {
  const sp = pageSetup.spatiumMm * PX_PER_MM;
  const pageWidthPx = Math.round(pageSetup.width * PX_PER_MM);

  const pageSetupJson = JSON.stringify({
    page_height: pageSetup.height / pageSetup.spatiumMm,
    page_margin_top: pageSetup.margins.top / pageSetup.spatiumMm,
    page_margin_bottom: pageSetup.margins.bottom / pageSetup.spatiumMm,
    page_margin_left: pageSetup.margins.left / pageSetup.spatiumMm,
    page_margin_right: pageSetup.margins.right / pageSetup.spatiumMm,
    ...(pageSetup.pageTurns ? { page_turns: pageTurnConfigForLayout(pageSetup.pageTurns) } : {}),
  });

  const info = getScoreInfo(mnxJson);
  if (info.scoreCount > 1) {
    return wasmComputeMnxScoreLayout(mnxJson, sp, pageWidthPx, scoreIndex, pageSetupJson);
  }
  if (info.partCount > 1) {
    return wasmComputeFullScoreLayout(mnxJson, sp, pageWidthPx, pageSetupJson);
  }
  return wasmComputeLayout(mnxJson, 0, sp, pageWidthPx, pageSetupJson);
}

// ─── PDF batch export ─────────────────────────────────────────────

/** Bytes + display name for one rendered score, ready to be saved. */
export interface RenderedScorePdf {
  scoreIndex: number;
  name: string;
  bytes: Uint8Array;
}

/** Shared font/asset paths needed to drive `exportPdf`. */
interface PdfFontAssets {
  bravuraFont: string;
  serifFont: string;
  pdfTextFont: string;
  pdfTextFontBold: string;
  pdfTextFontItalic: string;
  pdfTextFontBoldItalic: string;
}

/**
 * Build standard font asset URLs from `window.location.origin`. Mirrors
 * how `App.handleExportPdf` constructs them so behavior is identical
 * to the legacy single-score export.
 */
function defaultPdfFontAssets(): PdfFontAssets {
  const origin = window.location.origin;
  return {
    bravuraFont: `${origin}/fonts/Bravura.otf`,
    serifFont: `${origin}/fonts/LibertinusSerif-Regular.otf`,
    pdfTextFont: `${origin}/fonts/LibertinusSerif-Regular.otf`,
    pdfTextFontBold: `${origin}/fonts/LibertinusSerif-Bold.otf`,
    pdfTextFontItalic: `${origin}/fonts/LibertinusSerif-Italic.otf`,
    pdfTextFontBoldItalic: `${origin}/fonts/LibertinusSerif-BoldItalic.otf`,
  };
}

export interface BatchExportOptions {
  /** Score indices to render. Order is preserved in the output. */
  scoreIndices: readonly number[];
  /** Optional progress callback: (index, total, displayName). */
  onProgress?: (done: number, total: number, name: string) => void;
  /** If true, embed serialized MNX in each PDF as an attachment. */
  embedMnx?: boolean;
  /** Font asset URLs (defaults to `defaultPdfFontAssets()`). */
  fonts?: PdfFontAssets;
}

/**
 * Verify all required fonts are reachable. Throws a clear error listing
 * any missing fonts so the user sees a useful message instead of a
 * cryptic PDF-export failure deep inside pdf-lib.
 */
async function verifyPdfFonts(fonts: PdfFontAssets): Promise<void> {
  const urls = [
    fonts.bravuraFont,
    fonts.serifFont,
    fonts.pdfTextFont,
    fonts.pdfTextFontBold,
    fonts.pdfTextFontItalic,
    fonts.pdfTextFontBoldItalic,
  ];
  const unique = Array.from(new Set(urls));
  const missing: string[] = [];
  await Promise.all(
    unique.map(async (url) => {
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (!res.ok) missing.push(`${url} (HTTP ${res.status})`);
      } catch (err) {
        missing.push(`${url} (${err instanceof Error ? err.message : String(err)})`);
      }
    }),
  );
  if (missing.length > 0) {
    throw new Error(
      `PDF export blocked — missing font assets:\n  • ${missing.join("\n  • ")}\n\n` +
        `These files must be served from /fonts/ for export to work.`,
    );
  }
}

/**
 * Render each requested score and return its PDF bytes. Renders
 * sequentially — WASM is single-threaded and large scores can be
 * heavy, so progress events let the UI show a spinner.
 */
export async function exportScoresToPdf(score: Score, options: BatchExportOptions): Promise<RenderedScorePdf[]> {
  const fonts = options.fonts ?? defaultPdfFontAssets();
  await verifyPdfFonts(fonts);
  const mnxJson = JSON.stringify(serializeMnx(score));
  const embedded = options.embedMnx ? JSON.stringify(serializeMnx(score), null, 2) : undefined;

  const results: RenderedScorePdf[] = [];
  const total = options.scoreIndices.length;
  let done = 0;
  for (const scoreIndex of options.scoreIndices) {
    const name = getScoreDisplayName(score, scoreIndex);
    const ps = resolvePageSetupForScore(score, scoreIndex);
    const dl = renderScoreDisplayList(mnxJson, scoreIndex, ps);
    const sp = ps.spatiumMm * PX_PER_MM;
    const pdfOpts: PdfExportOptions = {
      pageWidthMm: ps.width,
      pageHeightMm: ps.height,
      spatiumMm: ps.spatiumMm,
      spPixels: sp,
      bravuraFont: fonts.bravuraFont,
      serifFont: fonts.serifFont,
      pdfTextFont: fonts.pdfTextFont,
      pdfTextFontBold: fonts.pdfTextFontBold,
      pdfTextFontItalic: fonts.pdfTextFontItalic,
      pdfTextFontBoldItalic: fonts.pdfTextFontBoldItalic,
      mnxJson: embedded,
      title: score.metadata?.title ? `${score.metadata.title} — ${name}` : name,
    };
    const bytes = await exportPdf(dl, pdfOpts);
    results.push({ scoreIndex, name, bytes });
    done += 1;
    options.onProgress?.(done, total, name);
  }
  return results;
}

// ─── Filename templating ──────────────────────────────────────────

/**
 * Substitute simple tokens in a filename pattern. Supported:
 *   %TITLE% — score document title (or "score" if missing)
 *   %PART%  — per-score display name (e.g. "Violin I", "Full Score")
 */
export function formatFilename(pattern: string, ctx: { title: string | undefined; part: string }): string {
  return pattern
    .replace(/%TITLE%/g, ctx.title ?? "score")
    .replace(/%PART%/g, ctx.part)
    .replace(/[<>:"/\\|?*]/g, "-");
}

// ─── Bundling ────────────────────────────────────────────────────

/**
 * Trigger a single browser download of the given bytes.
 */
export function triggerDownload(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── File System Access API (folder picker) ───────────────────────
//
// Lets the user choose an export folder once, then write all files
// into it without per-file download prompts. Chromium-based browsers
// support this; Firefox / Safari do not. Callers should feature-detect
// with `isDirectoryPickerSupported()` and fall back to `triggerDownload`.

interface FsWritable {
  write(data: Uint8Array | Blob): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  createWritable(): Promise<FsWritable>;
}
export interface FsDirectoryHandle {
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
}

interface WindowWithDirectoryPicker {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FsDirectoryHandle>;
}

/** True if the browser supports `window.showDirectoryPicker`. */
export function isDirectoryPickerSupported(): boolean {
  return (
    typeof window !== "undefined" && typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === "function"
  );
}

/**
 * Prompt the user for a writable export directory. Returns null if
 * the user cancels the picker. Throws if the API is unsupported —
 * callers should `isDirectoryPickerSupported()` first.
 */
export async function pickExportDirectory(): Promise<FsDirectoryHandle | null> {
  const fn = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!fn) throw new Error("Directory picker is not supported in this browser.");
  try {
    return await fn({ mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/**
 * Write a file into the picked directory, creating or overwriting it.
 */
export async function writeFileToDirectory(dir: FsDirectoryHandle, filename: string, bytes: Uint8Array): Promise<void> {
  const handle = await dir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

/**
 * Concatenate multiple PDFs into one and return the merged bytes. Uses
 * pdf-lib (already a transitive dep via the renderer's PDF exporter).
 */
export async function concatPdfs(pdfs: readonly RenderedScorePdf[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of pdfs) {
    const src = await PDFDocument.load(p.bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return out.save();
}

/**
 * Pack PDFs into a single ZIP. Uses jszip (already in the lockfile via
 * spessasynth's transitive deps — confirmed available).
 */
export async function zipPdfs(pdfs: readonly { name: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const p of pdfs) zip.file(p.name, p.bytes);
  const blob = await zip.generateAsync({ type: "uint8array" });
  return blob;
}

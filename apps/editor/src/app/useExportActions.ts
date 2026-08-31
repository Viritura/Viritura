import { useCallback, type RefObject } from "react";
import { DEFAULT_PAGE_SETUP } from "@viritura/core";
import { exportPdf, type PdfExportOptions, exportSvg, type SvgExportOptions } from "@viritura/renderer";
import { serializeMnx } from "@viritura/format";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { DocumentStore } from "../store/documentStore";

interface UseExportActionsOptions {
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  store: DocumentStore;
}

export function useExportActions({ canvasRef, store }: UseExportActionsOptions) {
  const handleExportPdf = useCallback(async () => {
    const dl = canvasRef.current?.getDisplayList();
    if (!dl) return;
    const ps = canvasRef.current?.getPageSetup() ?? DEFAULT_PAGE_SETUP;

    const sp = ps.spatiumMm * 12; // PX_PER_MM = 12
    const { score } = store.getState();
    let mnxJsonStr: string | undefined;
    if (score) {
      try {
        mnxJsonStr = JSON.stringify(serializeMnx(score), null, 2);
      } catch {
        /* non-critical */
      }
    }

    const options: PdfExportOptions = {
      pageWidthMm: ps.width,
      pageHeightMm: ps.height,
      spatiumMm: ps.spatiumMm,
      spPixels: sp,
      bravuraFont: `${window.location.origin}/fonts/Bravura.otf`,
      serifFont: `${window.location.origin}/fonts/LibertinusSerif-Regular.otf`,
      pdfTextFont: `${window.location.origin}/fonts/LibertinusSerif-Regular.otf`,
      pdfTextFontBold: `${window.location.origin}/fonts/LibertinusSerif-Bold.otf`,
      pdfTextFontItalic: `${window.location.origin}/fonts/LibertinusSerif-Italic.otf`,
      pdfTextFontBoldItalic: `${window.location.origin}/fonts/LibertinusSerif-BoldItalic.otf`,
      mnxJson: mnxJsonStr,
      title: score?.metadata?.title,
    };

    try {
      const pdfBytes = await exportPdf(dl, options);
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (score?.metadata?.title ?? "score") + ".pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("PDF export failed:", e);
    }
  }, [store, canvasRef]);

  const handleExportSvg = useCallback(async () => {
    const dl = canvasRef.current?.getDisplayList();
    if (!dl) return;
    const ps = canvasRef.current?.getPageSetup() ?? DEFAULT_PAGE_SETUP;

    const sp = ps.spatiumMm * 12; // PX_PER_MM = 12
    const options: SvgExportOptions = {
      pageWidthMm: ps.width,
      pageHeightMm: ps.height,
      spatiumMm: ps.spatiumMm,
      spPixels: sp,
      bravuraFont: `${window.location.origin}/fonts/Bravura.otf`,
      serifFont: `${window.location.origin}/fonts/LibertinusSerif-Regular.otf`,
    };

    try {
      const svgString = await exportSvg(dl, options);
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (store.getState().score?.metadata?.title ?? "score") + ".svg";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("SVG export failed:", e);
    }
  }, [store, canvasRef]);

  return { handleExportPdf, handleExportSvg };
}

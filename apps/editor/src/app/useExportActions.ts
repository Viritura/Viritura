import { useCallback, type RefObject } from "react";
import { exportPdf, type PdfExportOptions, exportSvg, type SvgExportOptions } from "@viritura/renderer";
import { serializeMnx } from "@viritura/format";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { DocumentStore } from "../store/documentStore";
import { useViewStateStore } from "../store/viewStateStore";
import { renderScoreDisplayList, resolvePageSetupForScore } from "../publish";

interface UseExportActionsOptions {
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  store: DocumentStore;
}

export function useExportActions({ store }: UseExportActionsOptions) {
  const handleExportPdf = useCallback(async () => {
    const state = store.getState();
    const score = state.workingScore ?? state.score;
    const { selectedScoreIndex } = useViewStateStore.getState();
    if (!score) return;

    try {
      const mnxJson = JSON.stringify(serializeMnx(score), null, 2);
      const ps = resolvePageSetupForScore(score, selectedScoreIndex);
      const dl = renderScoreDisplayList(mnxJson, selectedScoreIndex, ps);
      const options: PdfExportOptions = {
        pageWidthMm: ps.width,
        pageHeightMm: ps.height,
        spatiumMm: ps.spatiumMm,
        spPixels: ps.spatiumMm * 12, // PX_PER_MM = 12
        bravuraFont: `${window.location.origin}/fonts/Bravura.otf`,
        serifFont: `${window.location.origin}/fonts/LibertinusSerif-Regular.otf`,
        pdfTextFont: `${window.location.origin}/fonts/LibertinusSerif-Regular.otf`,
        pdfTextFontBold: `${window.location.origin}/fonts/LibertinusSerif-Bold.otf`,
        pdfTextFontItalic: `${window.location.origin}/fonts/LibertinusSerif-Italic.otf`,
        pdfTextFontBoldItalic: `${window.location.origin}/fonts/LibertinusSerif-BoldItalic.otf`,
        mnxJson,
        title: score.metadata?.title,
      };
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
  }, [store]);

  const handleExportSvg = useCallback(async () => {
    const state = store.getState();
    const score = state.workingScore ?? state.score;
    const { selectedScoreIndex } = useViewStateStore.getState();
    if (!score) return;

    try {
      const mnxJson = JSON.stringify(serializeMnx(score), null, 2);
      const ps = resolvePageSetupForScore(score, selectedScoreIndex);
      const dl = renderScoreDisplayList(mnxJson, selectedScoreIndex, ps);
      const options: SvgExportOptions = {
        pageWidthMm: ps.width,
        pageHeightMm: ps.height,
        spatiumMm: ps.spatiumMm,
        spPixels: ps.spatiumMm * 12, // PX_PER_MM = 12
        bravuraFont: `${window.location.origin}/fonts/Bravura.otf`,
        serifFont: `${window.location.origin}/fonts/LibertinusSerif-Regular.otf`,
      };
      const svgString = await exportSvg(dl, options);
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (score.metadata?.title ?? "score") + ".svg";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("SVG export failed:", e);
    }
  }, [store]);

  return { handleExportPdf, handleExportSvg };
}

/**
 * usePublishMode — composes Publish-mode logic so it can run inside the Write
 * tree against the *single shared* `ScoreCanvas`.
 *
 * Publish mode used to be a separate view (`PublishView`) that mounted its own
 * `DocumentProvider` + `ScoreCanvas`, which meant switching to Publish reset
 * the viewport and lost the selected part. The hybrid model keeps Write's
 * persistent canvas mounted and re-targets it into print-preview: this hook
 * produces the layout list, export state/handlers, and chrome data, all keyed
 * off the shared view-state store and the shared `canvasRef`. `AppWorkspace`
 * flips the canvas to `printPreview` and renders the publish chrome when the
 * bag is present.
 *
 * The hook is always called (rules of hooks); its export side effects are
 * inert in Write/Engrave mode because nothing triggers them there.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Score } from "@viritura/core";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import { getLifeSizeZoom, isCalibrated, onCalibrationChange } from "../zoomScale";
import { buildLayoutEntries, type LayoutEntry } from "../components/modes/publishView/layoutEntries";
import { runPublishExport, type BundleMode } from "../components/modes/publishView/runPublishExport";
import { isDirectoryPickerSupported, type FsDirectoryHandle } from "../publish/batchRender";
import { useStoredWidth } from "../hooks/useStoredWidth";
import { usePanelState } from "@viritura/ui";
import { openDialog } from "../store/dialogStore";

interface UsePublishModeArgs {
  score: Score | null;
  /** Currently selected score/layout index — drives which layout previews. */
  selectedScoreIndex: number;
  setSelectedScoreIndex: (i: number) => void;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  /** Whether Publish mode is currently active. */
  active: boolean;
}

interface ExportProgress {
  done: number;
  total: number;
  name: string;
}
interface ExportStatus {
  kind: "ok" | "err";
  text: string;
}

export interface PublishMode {
  // ── Document ────────────────────────────────────────────────
  score: Score | null;

  // ── Left panel (layouts) ────────────────────────────────────
  layouts: LayoutEntry[];
  selectedIndices: Set<number>;
  focusedIndex: number;
  exporting: boolean;
  onToggleIndex: (i: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onFocusIndex: (i: number) => void;
  leftWidth: number;
  setLeftWidth: (w: number) => void;
  leftCollapsed: boolean;
  setLeftCollapsed: (collapsed: boolean) => void;

  // ── Right panel (export) ────────────────────────────────────
  scoreLoaded: boolean;
  orderedSelectedCount: number;
  bundleMode: BundleMode;
  onBundleModeChange: (m: BundleMode) => void;
  folderSupported: boolean;
  exportFolder: FsDirectoryHandle | null;
  onPickFolder: () => void;
  onClearFolder: () => void;
  filenamePattern: string;
  onFilenamePatternChange: (s: string) => void;
  embedMnx: boolean;
  onEmbedMnxChange: (v: boolean) => void;
  progress: ExportProgress | null;
  statusMessage: ExportStatus | null;
  onExport: () => void;
  rightWidth: number;
  setRightWidth: (w: number) => void;

  // ── Status bar ──────────────────────────────────────────────
  handleActualSize: () => void;
}

export function usePublishMode({
  score,
  selectedScoreIndex,
  setSelectedScoreIndex,
  canvasRef,
  active,
}: UsePublishModeArgs): PublishMode {
  // Publish shows the workspace mesh-gradient through a transparent canvas
  // background. Toggle the global CSS var while Publish is active and restore
  // it on exit / unmount. Owned by the mode hook so AppWorkspace stays
  // mode-agnostic.
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const prev = root.style.getPropertyValue("--canvas-bg");
    root.style.setProperty("--canvas-bg", "transparent");
    return () => {
      if (prev) root.style.setProperty("--canvas-bg", prev);
      else root.style.removeProperty("--canvas-bg");
    };
  }, [active]);

  // ─── Layout list ──────────────────────────────────────────────
  const layouts = useMemo(() => buildLayoutEntries(score), [score]);

  // Export multi-selection is Publish-local; the *preview* layout is the
  // shared selectedScoreIndex. Seed the export set to "all" when the document
  // changes while Publish is active.
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const seedKey = `${layouts.length}:${score?.metadata?.title ?? ""}`;
  const lastSeedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    if (lastSeedRef.current === seedKey) return;
    lastSeedRef.current = seedKey;
    setSelectedIndices(new Set(layouts.map((l) => l.index)));
  }, [active, seedKey, layouts]);

  const toggleIndex = useCallback((i: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);
  const selectAll = useCallback(() => setSelectedIndices(new Set(layouts.map((l) => l.index))), [layouts]);
  const clearSelection = useCallback(() => setSelectedIndices(new Set()), []);
  const orderedSelected = useMemo(
    () => layouts.map((l) => l.index).filter((i) => selectedIndices.has(i)),
    [layouts, selectedIndices],
  );

  // ─── Calibration / actual-size ────────────────────────────────
  const [, setCalibBump] = useState(0);
  useEffect(() => onCalibrationChange(() => setCalibBump((n) => n + 1)), []);
  const handleActualSize = useCallback(() => {
    // "Actual size" maps to physical (life) size, which is only meaningful once
    // the display is calibrated. Until then, open the shared Calibration dialog
    // (rendered by Write's overlays) instead of zooming to a meaningless value.
    if (!isCalibrated()) {
      openDialog("calibration");
      return;
    }
    canvasRef.current?.setZoom(getLifeSizeZoom());
  }, [canvasRef]);

  // ─── Format / bundle / filename ───────────────────────────────
  const [bundleMode, setBundleMode] = useState<BundleMode>("separate");
  const [filenamePattern, setFilenamePattern] = useState<string>("%TITLE% — %PART%");
  const [embedMnx, setEmbedMnx] = useState<boolean>(false);

  // ─── Destination ──────────────────────────────────────────────
  const folderSupported = useMemo(() => isDirectoryPickerSupported(), []);
  const [exportFolder, setExportFolder] = useState<FsDirectoryHandle | null>(null);

  // ─── Export progress ──────────────────────────────────────────
  const [exporting, setExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState<ExportStatus | null>(null);

  const handlePickFolder = useCallback(async () => {
    try {
      const { pickExportDirectory } = await import("../publish/batchRender");
      const dir = await pickExportDirectory();
      if (dir) setExportFolder(dir);
    } catch (err) {
      console.error("Folder pick failed:", err);
      setStatusMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  }, []);
  const handleClearFolder = useCallback(() => setExportFolder(null), []);

  const handleExport = useCallback(async () => {
    if (!score || orderedSelected.length === 0) return;
    setExporting(true);
    setStatusMessage(null);
    setProgress({ done: 0, total: orderedSelected.length, name: "" });
    try {
      const result = await runPublishExport({
        score,
        scoreIndices: orderedSelected,
        bundleMode,
        filenamePattern,
        embedMnx,
        exportFolder,
        onProgress: (done, total, name) => setProgress({ done, total, name }),
      });
      setStatusMessage(result);
    } catch (err) {
      console.error("Publish export failed:", err);
      setStatusMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }, [score, orderedSelected, bundleMode, filenamePattern, embedMnx, exportFolder]);

  // ─── Layout widths persisted per-activity ─────────────────────
  const {
    width: leftWidth,
    setWidth: setLeftWidth,
    collapsed: leftCollapsed,
    setCollapsed: setLeftCollapsed,
  } = usePanelState({ storageKey: "viritura.publish.leftW", defaultWidth: 290, min: 240, max: 480 });
  const [rightWidth, setRightWidth] = useStoredWidth("viritura.publish.rightW", 360, 300, 600);

  const onExport = useCallback(() => void handleExport(), [handleExport]);
  const onPickFolder = useCallback(() => void handlePickFolder(), [handlePickFolder]);

  return {
    score,

    layouts,
    selectedIndices,
    focusedIndex: selectedScoreIndex,
    exporting,
    onToggleIndex: toggleIndex,
    onSelectAll: selectAll,
    onClearSelection: clearSelection,
    onFocusIndex: setSelectedScoreIndex,
    leftWidth,
    setLeftWidth,
    leftCollapsed,
    setLeftCollapsed,

    scoreLoaded: !!score,
    orderedSelectedCount: orderedSelected.length,
    bundleMode,
    onBundleModeChange: setBundleMode,
    folderSupported,
    exportFolder,
    onPickFolder,
    onClearFolder: handleClearFolder,
    filenamePattern,
    onFilenamePatternChange: setFilenamePattern,
    embedMnx,
    onEmbedMnxChange: setEmbedMnx,
    progress,
    statusMessage,
    onExport,
    rightWidth,
    setRightWidth,

    handleActualSize,
  };
}

/**
 * buildPublishMode — assembles the Publish-mode `WorkspaceMode` (chrome +
 * print-preview canvas props) from the `usePublishMode` data bag. Pure view
 * assembly; all state/effects (incl. the transparent-canvas background) live
 * in the hook.
 */
import type { ReactNode, RefObject } from "react";
import { PreviewStatusBar, type PreviewViewMode } from "@viritura/ui";
import { LeftLayoutsPanel } from "../components/modes/publishView/LeftLayoutsPanel";
import { RightExportPanel } from "../components/modes/publishView/RightExportPanel";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import { formatZoomPercent } from "../zoomScale";
import { MIN_ZOOM, MAX_ZOOM } from "../viewport";
import { openDialog } from "../store/dialogStore";
import type { PublishMode } from "./usePublishMode";
import type { WorkspaceMode } from "./workspaceMode";

export interface BuildPublishModeArgs {
  publish: PublishMode;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  currentZoom: number;
  /** Clamped (non-horizon) preview view mode. */
  previewViewMode: PreviewViewMode;
  setViewMode: (m: PreviewViewMode) => void;
}

export function buildPublishMode(args: BuildPublishModeArgs): WorkspaceMode {
  const { publish, canvasRef, currentZoom, previewViewMode, setViewMode } = args;

  const panels: ReactNode[] = [
    <LeftLayoutsPanel
      key="publish-left"
      side="left"
      layouts={publish.layouts}
      selectedIndices={publish.selectedIndices}
      focusedIndex={publish.focusedIndex}
      exporting={publish.exporting}
      width={publish.leftWidth}
      onResize={publish.setLeftWidth}
      onToggleIndex={publish.onToggleIndex}
      onSelectAll={publish.onSelectAll}
      onClearSelection={publish.onClearSelection}
      onFocusIndex={publish.onFocusIndex}
    />,
    <RightExportPanel
      key="publish-right"
      side="right"
      width={publish.rightWidth}
      onResize={publish.setRightWidth}
      exporting={publish.exporting}
      scoreLoaded={publish.scoreLoaded}
      orderedSelectedCount={publish.orderedSelectedCount}
      bundleMode={publish.bundleMode}
      onBundleModeChange={publish.onBundleModeChange}
      folderSupported={publish.folderSupported}
      exportFolder={publish.exportFolder}
      onPickFolder={publish.onPickFolder}
      onClearFolder={publish.onClearFolder}
      filenamePattern={publish.filenamePattern}
      onFilenamePatternChange={publish.onFilenamePatternChange}
      embedMnx={publish.embedMnx}
      onEmbedMnxChange={publish.onEmbedMnxChange}
      progress={publish.progress}
      statusMessage={publish.statusMessage}
      onExport={publish.onExport}
    />,
  ];

  return {
    kind: "publish",
    canvasProps: {
      printPreview: true,
      selectedPartIds: undefined,
    },
    panels,
    statusBar: (
      <PreviewStatusBar
        zoom={currentZoom}
        zoomLabel={formatZoomPercent(currentZoom)}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoomChange={(z) => canvasRef.current?.setZoom(z)}
        onResetZoom={publish.handleActualSize}
        onCalibrate={() => openDialog("calibration")}
        viewMode={previewViewMode}
        onViewModeChange={(m) => setViewMode(m)}
        testId="publish-preview-statusbar"
      />
    ),
  };
}

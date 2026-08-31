/**
 * AppWorkspace — the mode-agnostic workspace shell. Renders the single shared
 * canvas, the active mode's status bar + floating panels, and any mode-owned
 * siblings (dialogs, inspector auto-collapse). It never branches on which mode
 * is active: the `WorkspaceMode` it receives carries everything mode-specific
 * (see `app/workspaceMode.ts`). Adding a fourth mode requires no edits here.
 */
import type { ComponentProps, RefObject } from "react";
import { WorkspaceShell } from "@viritura/ui";
import type { WriteViewMode as ViewMode } from "@viritura/ui";
import { ScoreCanvas, type ScoreCanvasHandle } from "../components/ScoreCanvas";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import { useCalibrationRerender } from "../zoomScale";
import type { WorkspaceMode } from "./workspaceMode";

interface AppWorkspaceProps {
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  selectedScoreIndex: number;
  expandedCondensingStaves: Set<string>;
  /** View mode already clamped for the active mode (engrave/publish forbid horizon). */
  viewMode: ViewMode;
  handleViewportChange: ComponentProps<typeof ScoreCanvas>["onViewportChange"];
  handleLayoutsChange: (layouts: string[]) => void;
  handlePrintOverflowChange: ComponentProps<typeof ScoreCanvas>["onPrintOverflowChange"];
  statusVisible: boolean;
  /** The active workspace mode — supplies canvas props, panels, status bar, siblings. */
  mode: WorkspaceMode;
}

export function AppWorkspace(props: AppWorkspaceProps): React.ReactElement {
  const {
    canvasRef,
    selectedScoreIndex,
    expandedCondensingStaves,
    viewMode,
    handleViewportChange,
    handleLayoutsChange,
    handlePrintOverflowChange,
    statusVisible,
    mode,
  } = props;

  // Re-render when the user re-calibrates physical zoom, so the formatted
  // zoom percentage in the status bar refreshes.
  useCalibrationRerender();

  // Sibling-aware insets are computed inside WorkspaceShell — the canvas render
  // prop receives them via its argument so safeArea stays in sync as panels
  // open/close/resize without per-callsite math.
  return (
    <>
      <WorkspaceShell
        statusVisible={statusVisible}
        canvas={(insets) => (
          <WorkspaceCanvas
            insets={insets}
            canvasRef={canvasRef}
            selectedScoreIndex={selectedScoreIndex}
            expandedCondensingStaves={expandedCondensingStaves}
            viewMode={viewMode}
            onViewportChange={handleViewportChange}
            onLayoutsChange={handleLayoutsChange}
            onPrintOverflowChange={handlePrintOverflowChange}
            canvasProps={mode.canvasProps}
          />
        )}
        statusBar={mode.statusBar}
        showPanelHandle={mode.panels.length === 0 && mode.onTogglePanels !== undefined}
        onTogglePanels={mode.onTogglePanels}
      >
        {mode.panels}
      </WorkspaceShell>
      {mode.siblings}
    </>
  );
}

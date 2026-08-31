/**
 * buildEngraveMode — assembles the Engrave-mode `WorkspaceMode` (chrome +
 * canvas props) from the `useEngraveMode` data bag plus the shared chrome
 * dependencies. Pure view assembly; all state/effects live in the hook.
 */
import type { ReactNode, RefObject } from "react";
import { Button, Panel, PreviewStatusBar, type PreviewViewMode, type WriteViewMode as ViewMode } from "@viritura/ui";
import { TransportBar } from "@viritura/playback";
import { Eye, RotateCcw } from "lucide-react";
import { ScoreSwitcher } from "../scoreSwitcher";
import { SlurPropertiesPanel } from "../components/modes/engrave/SlurPropertiesPanel";
import { EngraveLeftPanel } from "../components/modes/engrave/EngraveLeftPanel";
import { toolbarStyle as engraveToolbarStyle } from "../components/modes/engrave/styles";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import { formatZoomPercent } from "../zoomScale";
import { MIN_ZOOM, MAX_ZOOM } from "../viewport";
import { openDialog } from "../store/dialogStore";
import type { EngraveMode } from "./useEngraveMode";
import type { WorkspaceMode } from "./workspaceMode";
import type { useFloatingPanel } from "./useFloatingPanel";

type FloatingPanel = ReturnType<typeof useFloatingPanel>;

export interface BuildEngraveModeArgs {
  engrave: EngraveMode;
  leftFloat: FloatingPanel;
  rightFloat: FloatingPanel;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  currentZoom: number;
  /** Clamped (non-horizon) preview view mode. */
  previewViewMode: PreviewViewMode;
  setViewMode: (m: ViewMode) => void;
  useWritten: boolean;
  handleConcertPitchToggle: (written: boolean) => void;
  /** Path keys of condensed staves currently expanded on the canvas. */
  expandedCondensingStaves: Set<string>;
  handleExpandCondensingStave: (pathKey: string) => void;
}

export function buildEngraveMode(args: BuildEngraveModeArgs): WorkspaceMode {
  const { engrave, rightFloat, canvasRef, currentZoom, previewViewMode, setViewMode } = args;

  // Selecting a score also drops any expanded-system state, which was tied to
  // the score being engraved when the left rail owned this control.
  const handleSelectScore = (index: number) => {
    engrave.setActiveScoreIndex(index);
    engrave.setExpandedSystem(null);
  };

  const panels: ReactNode[] = [];
  if (!args.leftFloat.collapsed) {
    panels.push(
      <Panel
        key="engrave-house-style"
        side="left"
        width={args.leftFloat.width}
        onResize={args.leftFloat.setWidth}
        min={280}
        max={480}
      >
        <EngraveLeftPanel
          score={engrave.score}
          activeScoreIndex={engrave.activeScoreIndex}
          onApplyPageSetup={engrave.pageSetup.handleApplyPageSetup}
          onResetPageSetup={engrave.pageSetup.handleResetPageSetup}
        />
      </Panel>,
    );
  }
  if (!engrave.slurPanelCollapsed) {
    panels.push(
      <Panel
        key="engrave-right"
        side="right"
        width={rightFloat.width}
        onResize={rightFloat.setWidth}
        min={220}
        max={400}
      >
        <SlurPropertiesPanel
          slurElementId={engrave.slurId}
          shape={engrave.slurShape}
          onChange={engrave.onSlurChange}
          onReset={engrave.onSlurReset}
          onDeselect={engrave.onSlurDeselect}
        />
      </Panel>,
    );
  }

  return {
    kind: "engrave",
    canvasProps: {
      interactionMode: "engrave",
      selectedPartIds: undefined,
      onToggleCondensedStaff: args.handleExpandCondensingStave,
      engraveAdornments: engrave.engraveAdornments,
      selectedEngraveMarkerId: engrave.selectedMarkerId,
      onEngraveBarlineClick: engrave.onBarlineClick,
      onEngraveMarkerClick: engrave.onMarkerClick,
      onEngraveEmptyClick: engrave.onEmptyClick,
      onEngraveStaffEyeClick: engrave.onStaffEyeClick,
      onEngraveSlurShapeEdit: engrave.onSlurShapeEdit,
      onEngraveSlurShapeReset: engrave.onSlurShapeReset,
      onEngraveSlurReanchor: engrave.onSlurReanchor,
      onEngraveSlurSelectionChange: engrave.onSlurSelectionChange,
      onEngraveTextExpressionOffsetEdit: engrave.onTextExpressionOffsetEdit,
    },
    panels,
    toolbar: (
      <>
        <div style={engraveToolbarStyle}>
          <ScoreSwitcher selectedScoreIndex={engrave.activeScoreIndex} onSelectScore={handleSelectScore} />
          <Button
            variant="ghost"
            size="sm"
            onClick={engrave.handleResetAll}
            tooltip="Revert to automatic pagination and clear all layout overrides"
          >
            <RotateCcw size={14} /> Reset to auto layout
          </Button>
          {engrave.hasAnyHidden && (
            <Button
              variant="ghost"
              size="sm"
              onClick={engrave.handleShowAllHidden}
              tooltip="Restore visibility of all hidden staves on every system"
            >
              <Eye size={14} /> Show all hidden staves
            </Button>
          )}
        </div>
        <TransportBar />
      </>
    ),
    statusBar: (
      <PreviewStatusBar
        zoom={currentZoom}
        zoomLabel={formatZoomPercent(currentZoom)}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoomChange={(z) => canvasRef.current?.setZoom(z)}
        onResetZoom={() => canvasRef.current?.resetViewport()}
        onCalibrate={() => openDialog("calibration")}
        viewMode={previewViewMode}
        onViewModeChange={(m) => setViewMode(m)}
        useWritten={args.useWritten}
        onConcertPitchToggle={args.handleConcertPitchToggle}
        testId="engrave-preview-statusbar"
      />
    ),
  };
}

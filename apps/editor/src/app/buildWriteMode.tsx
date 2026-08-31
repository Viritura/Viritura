/**
 * buildWriteMode — assembles the Write-mode `WorkspaceMode` (chrome + canvas
 * props). Write has no dedicated state hook (its state lives in AppInner), so
 * this builder takes the relevant slice of that state and produces the same
 * `WorkspaceMode` shape the Engrave/Publish builders do, making Write a peer
 * mode rather than "the absence of the others".
 *
 * Write's left panel is Palettes + History only. The roster, layout tree, and
 * score list moved to Setup mode, so none of those callbacks are threaded here
 * any more.
 */
import type { CSSProperties, ReactNode, RefObject } from "react";
import { Panel, WriteStatusBar, type WriteViewMode as ViewMode } from "@viritura/ui";
import { TransportBar } from "@viritura/playback";
import { Toolbar } from "../components/Toolbar";
import { ScoreSwitcher } from "../scoreSwitcher";
import { LeftPanel } from "../components/LeftPanel";
import { NotationInspector } from "../components/NotationInspector";
import { MnxSourcePanel } from "../components/MnxSourcePanel";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import { formatZoomPercent } from "../zoomScale";
import { MIN_ZOOM, MAX_ZOOM } from "../viewport";
import { closeDialog, openDialog } from "../store/dialogStore";
import type { WorkspaceMode } from "./workspaceMode";
import type { useFloatingPanel } from "./useFloatingPanel";
import type { useSelection } from "../store/selectionStore";

type FloatingPanel = ReturnType<typeof useFloatingPanel>;
type SelectionState = ReturnType<typeof useSelection>;

const TOOLBAR_CENTER_STYLE: CSSProperties = { flex: 1, display: "flex", justifyContent: "center" };

export interface BuildWriteModeArgs {
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  onTogglePanels: () => void;
  leftFloat: FloatingPanel;
  sourceFloat: FloatingPanel;
  selectedScoreIndex: number;
  handleSelectScore: (index: number) => void;
  /** Path keys of condensed staves currently expanded on the canvas. */
  expandedCondensingStaves: Set<string>;
  handleExpandCondensingStave: (pathKey: string) => void;
  selectedPartIds: string[];
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  currentZoom: number;
  useWritten: boolean;
  handleConcertPitchToggle: (written: boolean) => void;
  beatCountIssueCount: number;
  onRepairMeasures: () => void;
  onDismissBeatCountWarnings: () => void;

  inspectorFocus: NonNullable<React.ComponentProps<typeof NotationInspector>>["preferredSection"];
  selection: SelectionState;
  dialogs: { source?: boolean };
}

export function buildWriteMode(args: BuildWriteModeArgs): WorkspaceMode {
  const { leftFloat, sourceFloat, selection, inspectorFocus, dialogs } = args;

  const panels: ReactNode[] = [];
  if (!leftFloat.collapsed) {
    panels.push(
      <Panel key="write-left" side="left" width={leftFloat.width} onResize={leftFloat.setWidth} min={200} max={500}>
        <LeftPanel preferredInspectorSection={selection.kind === "single" ? inspectorFocus : null} />
      </Panel>,
    );
  }
  if (dialogs.source) {
    panels.push(
      <Panel
        key="write-source"
        side="right"
        width={sourceFloat.width}
        onResize={sourceFloat.setWidth}
        min={280}
        max={700}
      >
        <MnxSourcePanel onClose={() => closeDialog("source")} />
      </Panel>,
    );
  }
  return {
    kind: "write",
    onTogglePanels: args.onTogglePanels,
    canvasProps: {
      interactionMode: "write",
      selectedPartIds: args.selectedPartIds,
      onToggleCondensedStaff: args.handleExpandCondensingStave,
    },
    panels,
    toolbar: (
      <>
        <ScoreSwitcher selectedScoreIndex={args.selectedScoreIndex} onSelectScore={args.handleSelectScore} />
        <div style={TOOLBAR_CENTER_STYLE}>
          <Toolbar />
        </div>
        <TransportBar />
      </>
    ),
    statusBar: (
      <WriteStatusBar
        zoom={args.currentZoom}
        zoomLabel={formatZoomPercent(args.currentZoom)}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoomChange={(z) => args.canvasRef.current?.setZoom(z)}
        onResetZoom={() => args.canvasRef.current?.resetViewport()}
        onCalibrate={() => openDialog("calibration")}
        beatCountIssueCount={args.beatCountIssueCount}
        onRepairMeasures={args.onRepairMeasures}
        onDismissBeatCountWarnings={args.onDismissBeatCountWarnings}
        viewMode={args.viewMode}
        onViewModeChange={(m) => args.setViewMode(m)}
        useWritten={args.useWritten}
        onConcertPitchToggle={args.handleConcertPitchToggle}
      />
    ),
  };
}

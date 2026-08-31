/* eslint-disable react-refresh/only-export-components -- view-assembly helper: this module's only export is the `buildSetupMode` data-bag builder (not a Fast-Refresh component); the module-scope `SetupPanelAny` cast trips the rule but there is no component to hot-reload here. */
/**
 * buildSetupMode — assembles the Setup-mode `WorkspaceMode`.
 *
 * Setup is deliberately a *peer* of Write rather than a separate screen: it
 * reuses the same persistent `ScoreCanvas`, so every roster / layout /
 * signature edit made in its panel is reflected live in the engraved score
 * beside it. That live feedback is the reason the mode exists — it is what the
 * old modal New Score wizard could not do, because the wizard edited a
 * throwaway `Player[]` draft with no score to render.
 *
 * The mode contributes no toolbar: Setup has no note input, and the empty
 * toolbar slot is itself a useful signal that this is not a writing surface.
 */
import type { ComponentType, Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { Panel, WriteStatusBar, type WriteViewMode as ViewMode } from "@viritura/ui";
import { SetupPanel } from "../components/modes/setup/SetupPanel";
import { ScoreSwitcher } from "../scoreSwitcher";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import { formatZoomPercent } from "../zoomScale";
import { MIN_ZOOM, MAX_ZOOM } from "../viewport";
import { openDialog } from "../store/dialogStore";
import type { WorkspaceMode } from "./workspaceMode";
import type { useFloatingPanel } from "./useFloatingPanel";
import type { ScoreDefinition, LayoutDefinition } from "@viritura/core";

type FloatingPanel = ReturnType<typeof useFloatingPanel>;
type SetupPanelProps = React.ComponentProps<typeof SetupPanel>;
const SetupPanelAny = SetupPanel as ComponentType<SetupPanelProps>;

export interface BuildSetupModeArgs {
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  leftFloat: FloatingPanel;
  selectedScoreIndex: number;
  selectedPartIds: string[];
  setSelectedPartIds: Dispatch<SetStateAction<string[]>>;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  currentZoom: number;
  useWritten: boolean;
  handleConcertPitchToggle: (written: boolean) => void;
  resolvedScoreDefs: ScoreDefinition[];
  handleSelectScore: (index: number) => void;
  handleLayoutChange: (layouts: LayoutDefinition[]) => void;
  handleAddInstrument: SetupPanelProps["onAddInstrument"];
  handleAddEnsemble: SetupPanelProps["onAddEnsemble"];
  handleRemoveInstrument: SetupPanelProps["onRemoveInstrument"];
  handleAddInstrumentToScore: SetupPanelProps["onAddInstrumentToScore"];
  handleRemoveInstrumentFromScore: SetupPanelProps["onRemoveInstrumentFromScore"];
  handleCreateSectionScore: SetupPanelProps["onCreateSectionScore"];
  handleSetScoreMembership: SetupPanelProps["onSetScoreMembership"];
  handleReorderInstrument: SetupPanelProps["onReorderInstrument"];
  handleAddDoubling: SetupPanelProps["onAddDoubling"];
  handleRemoveDoubling: SetupPanelProps["onRemoveDoubling"];
  handlePartUpdate: SetupPanelProps["onPartUpdate"];
  handleAddScore: SetupPanelProps["onAddScore"];
  handleDeleteScore: SetupPanelProps["onDeleteScore"];
  handleRenameScore: SetupPanelProps["onRenameScore"];
  handleDuplicateScore: SetupPanelProps["onDuplicateScore"];
  handleResetLayout: SetupPanelProps["onResetLayout"];
  handleReorderScores: SetupPanelProps["onReorderScores"];
  /** Path keys of condensed staves currently expanded on the canvas. */
  expandedCondensingStaves: Set<string>;
  /** Always supplied — the optional prop on `SetupPanel` is for other hosts. */
  handleExpandCondensingStave: (pathKey: string) => void;
}

export function buildSetupMode(args: BuildSetupModeArgs): WorkspaceMode {
  const { leftFloat } = args;

  const panels: ReactNode[] = [];
  if (!leftFloat.collapsed) {
    panels.push(
      <Panel key="setup-left" side="left" width={leftFloat.width} onResize={leftFloat.setWidth} min={240} max={560}>
        <SetupPanelAny
          scoreDefinitions={args.resolvedScoreDefs}
          selectedScoreIndex={args.selectedScoreIndex}
          onSelectScore={args.handleSelectScore}
          onLayoutChange={args.handleLayoutChange}
          onSelectedPartsChange={args.setSelectedPartIds}
          onAddInstrument={args.handleAddInstrument}
          onAddEnsemble={args.handleAddEnsemble}
          onRemoveInstrument={args.handleRemoveInstrument}
          onAddInstrumentToScore={args.handleAddInstrumentToScore}
          onRemoveInstrumentFromScore={args.handleRemoveInstrumentFromScore}
          onCreateSectionScore={args.handleCreateSectionScore}
          onSetScoreMembership={args.handleSetScoreMembership}
          onReorderInstrument={args.handleReorderInstrument}
          onAddDoubling={args.handleAddDoubling}
          onRemoveDoubling={args.handleRemoveDoubling}
          onPartUpdate={args.handlePartUpdate}
          onAddScore={args.handleAddScore}
          onDeleteScore={args.handleDeleteScore}
          onRenameScore={args.handleRenameScore}
          onDuplicateScore={args.handleDuplicateScore}
          onResetLayout={args.handleResetLayout}
          onReorderScores={args.handleReorderScores}
          onExpandCondensingStave={args.handleExpandCondensingStave}
        />
      </Panel>,
    );
  }

  return {
    kind: "setup",
    canvasProps: {
      interactionMode: "write",
      // Selecting an instrument in the panel highlights its staves on the
      // canvas, so the roster and the engraving stay visually linked.
      selectedPartIds: args.selectedPartIds,
      onToggleCondensedStaff: args.handleExpandCondensingStave,
    },
    panels,
    // Setup has no note input, so its toolbar carries only the score
    // switcher — which doubles as the "you are previewing X" indicator.
    toolbar: (
      <>
        <ScoreSwitcher selectedScoreIndex={args.selectedScoreIndex} onSelectScore={args.handleSelectScore} />
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
        beatCountIssueCount={0}
        viewMode={args.viewMode}
        onViewModeChange={(m) => args.setViewMode(m)}
        useWritten={args.useWritten}
        onConcertPitchToggle={args.handleConcertPitchToggle}
      />
    ),
  };
}

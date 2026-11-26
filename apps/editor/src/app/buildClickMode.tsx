import type { RefObject } from "react";
import { LazyActivity, LazyClickView } from "./lazyActivities";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { ClickCanvasConfig } from "../store/clickCanvasStore";
import type { WorkspaceMode } from "./workspaceMode";

interface BuildClickModeArgs {
  readonly canvasRef: RefObject<ScoreCanvasHandle | null>;
  readonly config: ClickCanvasConfig;
  readonly mnx: string;
  readonly canvasZoom?: number;
  readonly onTogglePanels: () => void;
}

export function buildClickMode({
  canvasRef,
  config,
  mnx,
  canvasZoom,
  onTogglePanels,
}: BuildClickModeArgs): WorkspaceMode {
  return {
    kind: "click",
    leftPanelCollapsed: true,
    onExpandLeftPanel: onTogglePanels,
    onTogglePanels,
    canvasProps: {
      interactionMode: "click",
      selectedScoreIndex: config.selectedScoreIndex,
      selectedPartIds: config.selectedPartIds,
      sourcePartIndex: config.sourcePartIndex,
      onClickMeasure: config.onSelectMeasure,
      viewMode: config.viewMode,
      pageSetupOverride: config.pageSetup,
      fitToView: config.fitToView,
      fitRequest: config.fitRequest,
      useWrittenOverride: config.useWritten,
    },
    panels: [],
    statusBar: (
      <LazyActivity label="Click">
        <LazyClickView mnx={mnx} canvasRef={canvasRef} canvasZoom={canvasZoom} />
      </LazyActivity>
    ),
  };
}

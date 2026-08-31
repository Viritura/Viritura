/**
 * WorkspaceCanvas — the single shared `ScoreCanvas` for the Write / Engrave /
 * Publish workspace. Owns the *shared* base props (ref, scroll anchor, safe
 * area, selected score, view mode, viewport/layout callbacks); the active
 * `WorkspaceMode` contributes the rest via `canvasProps` (interaction mode,
 * print-preview, engrave adornments, part filter). The canvas instance is
 * owned by `canvasRef` upstream so it persists across mode switches.
 */
import type { ComponentProps, RefObject } from "react";
import { ErrorBoundary } from "@viritura/ui";
import type { WorkspaceInsets, WriteViewMode as ViewMode } from "@viritura/ui";
import { ScoreCanvas, type ScoreCanvasHandle, type ScoreCanvasProps } from "../components/ScoreCanvas";

interface WorkspaceCanvasProps {
  insets: WorkspaceInsets;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  selectedScoreIndex: number;
  expandedCondensingStaves: Set<string>;
  viewMode: ViewMode;
  onViewportChange: ComponentProps<typeof ScoreCanvas>["onViewportChange"];
  onLayoutsChange: (layouts: string[]) => void;
  onPrintOverflowChange: ComponentProps<typeof ScoreCanvas>["onPrintOverflowChange"];
  /** Mode-specific props merged over the shared base (see WorkspaceMode). */
  canvasProps: Partial<ScoreCanvasProps>;
}

export function WorkspaceCanvas({
  insets,
  canvasRef,
  selectedScoreIndex,
  expandedCondensingStaves,
  viewMode,
  onViewportChange,
  onLayoutsChange,
  onPrintOverflowChange,
  canvasProps,
}: WorkspaceCanvasProps): React.ReactElement {
  return (
    <ErrorBoundary reportUrl="https://github.com/peteryangio/viritura/issues/new">
      <ScoreCanvas
        ref={canvasRef}
        scrollAnchor={{ x: "start", y: "start" }}
        safeArea={{
          left: insets.left > 0 ? insets.left + 10 : 12,
          top: 12,
          right: insets.right > 0 ? insets.right + 10 : 12,
          bottom: insets.bottom > 0 ? insets.bottom + 10 : 12,
        }}
        selectedScoreIndex={selectedScoreIndex}
        expandedCondensingStaves={expandedCondensingStaves}
        onViewportChange={onViewportChange}
        onLayoutsChange={onLayoutsChange}
        onPrintOverflowChange={onPrintOverflowChange}
        viewMode={viewMode}
        {...canvasProps}
      />
    </ErrorBoundary>
  );
}

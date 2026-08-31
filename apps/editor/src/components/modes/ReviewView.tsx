import { useMemo, useState, useCallback, type CSSProperties } from "react";
import { CheckCircle2, XCircle, Eye, Filter } from "lucide-react";

const REVIEW_FLEX_SPACER_STYLE: CSSProperties = { flex: 1 };
import { useDiffEngine } from "../../hooks/useDiffEngine";
import { countChanges } from "../../diff/semanticDiff";
import { ToolbarPortal } from "../AppShell";
import { ViewLayout } from "../ViewLayout";
import { formatZoomPercent, getLifeSizeZoom } from "../../zoomScale";
import { MIN_ZOOM, MAX_ZOOM } from "../../viewport";
import { PanelActionButton, PreviewStatusBar } from "@viritura/ui";
import { toast } from "sonner";
import { CreateGitHubRepositoryDialog } from "../CreateGitHubRepositoryDialog";
import { MockButton } from "./review/HistoryRow";
import { HistorySidebar } from "./review/HistorySidebar";
import { DiffMainPane } from "./review/DiffMainPane";
import { useReviewSession } from "./review/useReviewSession";
import { toolbarStyle, dividerStyle } from "./review/styles";

interface ReviewViewProps {
  originalJson?: string;
  modifiedJson?: string;
}

/**
 * Review mode — deeply integrated diff viewer with sidebar, toolbar, code
 * editor, and dual canvas score preview.
 *
 * In project mode, the from/to selection is driven by the git log and the
 * Original/Modified panes show the score at those commits. In standalone
 * mode, the legacy `originalJson`/`modifiedJson` props are used and we show
 * an opt-in card to set up version history.
 */
export function ReviewView({ originalJson, modifiedJson }: ReviewViewProps) {
  const session = useReviewSession(modifiedJson, originalJson);
  // Presentation-only toggle: overrides scores[*].useWritten in both diff
  // canvases without mutating the underlying document.
  const [useWritten, setUseWritten] = useState(false);
  const handleConcertPitchToggle = useCallback((written: boolean) => setUseWritten(written), []);

  const engine = useDiffEngine({
    originalJson: session.effectiveOriginal,
    modifiedJson: session.effectiveModified,
    useWritten,
  });

  const changeCounts = useMemo(() => {
    if (!engine.diffTree) return { added: 0, removed: 0, modified: 0 };
    return countChanges(engine.diffTree);
  }, [engine.diffTree]);
  const totalChanges = changeCounts.added + changeCounts.removed + changeCounts.modified;

  const leftPanelContent = (
    <HistorySidebar
      isVersioned={session.isVersioned}
      githubRepository={session.githubRepository}
      status={session.status}
      fetching={session.fetching}
      handleFetchRemote={() => {
        void session.handleFetchRemote();
      }}
      log={session.log}
      multiSelect={session.multiSelect}
      isSelected={session.isSelected}
      sideOf={session.sideOf}
      handleRowClick={session.handleRowClick}
      handleSetupProject={() => {
        void session.handleSetupProject();
      }}
      setupCard={null}
      pushing={session.pushing}
      handlePushChanges={() => {
        void session.handlePushChanges();
      }}
      totalChanges={totalChanges}
      changeCounts={changeCounts}
      diffTree={engine.diffTree}
      handleNodeSelect={engine.handleNodeSelect as (...args: unknown[]) => void}
      focusedMeasure={engine.focusedMeasure}
      githubSetupCardProps={{
        show: session.needsGitHubRemote,
        githubViewer: session.githubViewer,
        githubAccount: session.githubAccount,
        canCreateGitHubRepository: session.canCreateGitHubRepository,
        githubInstallUrl: session.githubInstallUrl,
        setGitHubSetupOpen: session.setGitHubSetupOpen,
      }}
    />
  );

  const reviewStatusBar = (
    <PreviewStatusBar
      zoom={engine.viewport.zoom}
      zoomLabel={formatZoomPercent(engine.viewport.zoom)}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      onZoomChange={engine.setZoom}
      onResetZoom={() => engine.setZoom(getLifeSizeZoom())}
      useWritten={useWritten}
      onConcertPitchToggle={handleConcertPitchToggle}
    />
  );

  return (
    <>
      <ToolbarPortal>
        <div style={toolbarStyle}>
          <MockButton icon={<CheckCircle2 size={16} />} label="Accept Change" />
          <MockButton icon={<XCircle size={16} />} label="Reject Change" />
          <div style={dividerStyle} />
          <MockButton icon={<Eye size={16} />} label="Show Markup" active />
          <MockButton icon={<Filter size={16} />} label="Filter Changes" />
          <div style={REVIEW_FLEX_SPACER_STYLE} />
          <PanelActionButton onClick={() => engine.setDiffMode("snippets")} active={engine.diffMode === "snippets"}>
            Snippets{engine.leafCount > 0 ? ` (${engine.leafCount})` : ""}
          </PanelActionButton>
          <PanelActionButton onClick={() => engine.setDiffMode("full")} active={engine.diffMode === "full"}>
            Full File
          </PanelActionButton>
          {engine.diffMode === "full" && (
            <>
              <span style={dividerStyle} />
              <PanelActionButton onClick={() => engine.setViewMode("side")} active={engine.viewMode === "side"}>
                Side by Side
              </PanelActionButton>
              <PanelActionButton onClick={() => engine.setViewMode("inline")} active={engine.viewMode === "inline"}>
                Inline
              </PanelActionButton>
            </>
          )}
        </div>
      </ToolbarPortal>

      <ViewLayout
        layoutId="review-layout"
        leftPanel={{ content: leftPanelContent, defaultSize: 280, minSize: 200, maxSize: 400 }}
        statusBar={reviewStatusBar}
        dockedLeft
      >
        <DiffMainPane engine={engine} />
      </ViewLayout>

      <CreateGitHubRepositoryDialog
        open={session.githubSetupOpen}
        ownerLogin={session.githubViewer?.login ?? ""}
        installUrl={session.githubInstallUrl}
        installation={session.githubInstallation}
        defaultRepositoryName={session.status?.name ?? undefined}
        onClose={() => session.setGitHubSetupOpen(false)}
        onCreate={async (request) => {
          if (!session.adapter?.isVersioned()) {
            throw new Error("Open a local project before setting up GitHub.");
          }
          const repository = await session.githubAccount.createRepository(request);
          await session.adapter.setRemoteUrl("origin", repository.cloneUrl);
          await session.refresh();
          toast.success(`Connected origin to ${repository.fullName}`);
          return repository;
        }}
      />
    </>
  );
}

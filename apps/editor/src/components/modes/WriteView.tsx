import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ScoreCanvasHandle } from "../../components/ScoreCanvas";

import { useNoteInput, type CursorPosition } from "../../store/noteInputStore";
import { HistoryProvider } from "../../store/HistoryContext";

import { useDocumentStore, useDocumentStoreApi } from "../../store/DocumentContext";
import { parseMnx } from "@viritura/format";
import { useGitHubAccount } from "../../github/useGitHubAccount";
import { useVirituraAccount } from "../../auth";
import { useProjectStore } from "../../store/projectStore";
import { useDialogStore } from "../../store/dialogStore";
import { useOnboardingStore } from "../../store/onboardingStore";
import {
  useOverlayStore,
  setRadialMenu,
  setTempoPopover,
  setStaffTextPopover,
  setJumpBarOpen,
  setLyricMode,
  setLyricState,
} from "../../store/overlayStore";
import { useShallow } from "zustand/shallow";

import { useCursorOnNoteInputActivate } from "../../app/useCursorOnNoteInputActivate";
import { useScoreViewData } from "../../app/useScoreViewData";
import { useFileHandlers } from "../../app/useFileHandlers";
import { useMouseTracking } from "../../app/useMouseTracking";
import { useMnxChangeReporter } from "../../app/useMnxChangeReporter";
import { AppInnerView } from "../../app/AppInnerView";
import { useEngraveMode } from "../../app/useEngraveMode";
import { usePublishMode } from "../../app/usePublishMode";
import { buildWriteMode } from "../../app/buildWriteMode";
import { buildSetupMode } from "../../app/buildSetupMode";
import { buildEngraveMode } from "../../app/buildEngraveMode";
import { buildPublishMode } from "../../app/buildPublishMode";
import type { WorkspaceMode, WorkspaceModeKind } from "../../app/workspaceMode";
import type { WriteViewMode as ViewMode, PreviewViewMode } from "@viritura/ui";
import { useMenuBarWiring } from "../../app/useMenuBarWiring";
import { useInteractionHandlers } from "../../app/useInteractionHandlers";
import { useEditingHandlers } from "../../app/useEditingHandlers";
import { useScoreHandlers } from "../../app/useScoreHandlers";
import { useAppFloatingPanels } from "../../app/useAppFloatingPanels";
import { togglePanels } from "../../app/useAppKeyboardWiring";
import { useAppStoreSelectors } from "../../app/useAppStoreSelectors";
import { useAppLocalState } from "../../app/useAppLocalState";
import { isFolderProjectSupported } from "../../app/projectFolder";
import type { ActivityView } from "../../components/activityRegistry";
import { getTransposeSelectionInfo } from "../../components/TransposeDialog";
import { usePublishJumpBarCatalog } from "../../app/useJumpBarDestinations";

import { useNotePreview } from "../../hooks/useNotePreview";
import { useSelectionPruner } from "../../store/useSelectionPruner";

import { toast } from "sonner";

const ignoreActivityChange = (_view: ActivityView): void => {};

interface WriteViewProps {
  onMnxChange?: (mnxJson: string) => void;
  onFirstLoad?: (mnxJson: string) => void;
  onVisiblePartsChange?: (partIds: string[]) => void;
  isActiveView?: boolean;
  /** Which workspace mode the shared canvas + chrome should present. */
  mode?: WorkspaceModeKind;
  onOpenPublish?: () => void;
  /** Switch the app to Setup mode (used right after creating a score). */
  onOpenSetup?: () => void;
  /** Switch to a top-level activity from shared commands such as the Jump Bar. */
  onOpenActivity?: (view: ActivityView) => void;
}

export function WriteView({
  onMnxChange,
  onFirstLoad,
  onVisiblePartsChange,
  isActiveView = true,
  mode = "write",
  onOpenPublish,
  onOpenSetup,
  onOpenActivity,
}: WriteViewProps = {}) {
  return (
    <HistoryBridge
      onMnxChange={onMnxChange}
      onFirstLoad={onFirstLoad}
      onVisiblePartsChange={onVisiblePartsChange}
      isActiveView={isActiveView}
      mode={mode}
      onOpenPublish={onOpenPublish}
      onOpenSetup={onOpenSetup}
      onOpenActivity={onOpenActivity}
    />
  );
}

/**
 * Bridge component that sets up HistoryProvider with DocumentContext.
 * Needs to be inside DocumentProvider to access mnxJson for initial state.
 */
function HistoryBridge({
  onMnxChange,
  onFirstLoad,
  onVisiblePartsChange,
  isActiveView,
  mode,
  onOpenPublish,
  onOpenSetup,
  onOpenActivity,
}: {
  onMnxChange?: ((s: string) => void) | undefined;
  onFirstLoad?: ((s: string) => void) | undefined;
  onVisiblePartsChange?: ((partIds: string[]) => void) | undefined;
  isActiveView?: boolean;
  mode?: WorkspaceModeKind;
  onOpenPublish?: (() => void) | undefined;
  onOpenSetup?: (() => void) | undefined;
  onOpenActivity?: ((view: ActivityView) => void) | undefined;
}) {
  const store = useDocumentStoreApi();
  const loadScore = useDocumentStore((s) => s.loadScore);
  const { setCursor, clearCursor } = useNoteInput();
  // Read initial mnxJson once — no subscription needed since HistoryProvider
  // only uses it for the store's initial state (captured in a ref).
  const initialMnxRef = useRef(store.getState().mnxJson);

  const handleRestore = useCallback(
    (restoredJson: string, cursorPosition?: CursorPosition | null) => {
      try {
        const score = parseMnx(JSON.parse(restoredJson));
        // Pass the pre-serialized JSON to skip redundant serializeMnx()
        loadScore(score, undefined, restoredJson);
        // Restore cursor position from history entry
        if (cursorPosition === null) {
          clearCursor();
        } else if (cursorPosition !== undefined) {
          setCursor(cursorPosition);
        }
      } catch (err) {
        console.error("Failed to restore from history:", err);
        toast.error("Failed to restore from history");
      }
    },
    [loadScore, setCursor, clearCursor],
  );

  return (
    // eslint-disable-next-line react-hooks/refs -- intentional ref-bag pattern; refs hold stable identity, not render-time state
    <HistoryProvider initialMnxJson={initialMnxRef.current || undefined} onRestore={handleRestore}>
      <AppInner
        onMnxChange={onMnxChange}
        onFirstLoad={onFirstLoad}
        onVisiblePartsChange={onVisiblePartsChange}
        isActiveView={isActiveView ?? true}
        mode={mode ?? "write"}
        onOpenPublish={onOpenPublish}
        onOpenSetup={onOpenSetup}
        onOpenActivity={onOpenActivity}
      />
    </HistoryProvider>
  );
}

// eslint-disable-next-line max-lines-per-function -- Write-mode shell composing 12+ child surfaces (Toolbar, PalettePanel, ScoreCanvas, JumpBar, ScoreListPanel, StatusBar, ...) wired together by ~8 context providers and the App-level callbacks. The body is JSX layout + callback prop fan-out; sub-components are already extracted.
function AppInner({
  onMnxChange,
  onFirstLoad,
  onVisiblePartsChange,
  isActiveView,
  mode: modeKind,
  onOpenPublish,
  onOpenSetup,
  onOpenActivity,
}: {
  onMnxChange?: ((s: string) => void) | undefined;
  onFirstLoad?: ((s: string) => void) | undefined;
  onVisiblePartsChange?: ((partIds: string[]) => void) | undefined;
  isActiveView?: boolean;
  mode?: WorkspaceModeKind;
  onOpenPublish?: (() => void) | undefined;
  onOpenSetup?: (() => void) | undefined;
  onOpenActivity?: ((view: ActivityView) => void) | undefined;
}) {
  // Dialogs / popovers — central store keeps the closure flat and lets
  // keyboard shortcuts + sub-components open dialogs without prop-drilling.
  const dialogs = useDialogStore(useShallow((s) => s.open));
  // Onboarding / start-up surfaces — Start Center + "Add to project" banner.
  const { startCenterOpen, startCenterView, recentScores, suppressStartCenter, trackBannerFile, suppressTrackBanner } =
    useOnboardingStore(
      useShallow((s) => ({
        startCenterOpen: s.startCenterOpen,
        startCenterView: s.startCenterView,
        recentScores: s.recentScores,
        suppressStartCenter: s.suppressStartCenter,
        trackBannerFile: s.trackBannerFile,
        suppressTrackBanner: s.suppressTrackBanner,
      })),
    );
  // Start Center (launch dialog). Initial open is decided in a boot effect
  // below — we always start closed and open it after we've checked the
  // suppression flag and loaded the recents list.
  // Folder-open flow dialogs (score chooser + git confirm) live in their
  // own service — see store/modalFlowStore.ts + components/ModalFlowHost.tsx.
  // "Add to project" banner — surfaces after a single file is opened
  // standalone, offering to upgrade to a folder-based versioned project.
  // null = hidden; string = the file name to show in the banner copy.
  /** Score index whose page setup is being edited; null = use selectedScoreIndex (legacy File-menu route). */
  const {
    pageSetupTargetIndex,
    setPageSetupTargetIndex,
    openedFile,
    setOpenedFile,
    fileError,
    setFileError,
    isDragOver,
    setIsDragOver,
    fileHandle,
    setFileHandle,
    selectedScoreIndex,
    setSelectedScoreIndex,
    selectedPartIds,
    setSelectedPartIds,
    viewMode,
    setViewMode,
    expandedCondensingStaves,
    setExpandedCondensingStaves,
    currentZoom,
    setCurrentZoom,
    inspectorFocus,
  } = useAppLocalState();
  const dropRef = useRef<HTMLDivElement>(null);
  const githubAccount = useGitHubAccount();
  const account = useVirituraAccount();
  const githubInstallation = githubAccount.session?.installation ?? null;
  const githubInstallUrl = githubInstallation?.htmlUrl ?? githubAccount.app?.installUrl ?? null;
  const githubViewer = githubAccount.session?.connected === true ? githubAccount.session.viewer : null;
  const canCreateGitHubRepository = githubInstallation?.canCreateRepositories === true;
  const activeProjectStatus = useProjectStore((s) => s.status);
  const {
    store,
    loadScore,
    updateScore,
    commitPatches,
    repairMeasures,
    dismissBeatCountWarnings,
    dirty,
    fileName,
    beatCountIssues,
    selection,
    clearSelection,
    selectRange,
    selectElement,
    pushState,
    undo,
    redo,
    canUndo,
    canRedo,
    resetHistory,
    historyStore,
    noteInputState,
    setCursor,
    setCondensingRouting,
  } = useAppStoreSelectors();

  // Floating-panel widths + imperative refs (Write mode)
  const { leftPanelRef, rightPanelRef, leftFloat, rightFloat, sourceFloat } = useAppFloatingPanels();

  // Mouse tracking: status pill visibility + radial-menu anchor.
  const { statusVisible, mousePositionRef } = useMouseTracking();

  // Note preview: plays selected note's pitch on click
  useNotePreview();

  // Prune stale selection IDs after score changes
  useSelectionPruner();

  // Report MNX changes to parent + push history via store subscription.
  useMnxChangeReporter({ store, onMnxChange, onFirstLoad, pushState });

  // Floating overlays — radial menu, tempo/staff-text popovers, jump bar,
  // and lyric-input mode. Single store keeps all of these out of the
  // AppInner closure and gives non-React handlers a stable imperative API.
  const { radialMenu, tempoPopover, staffTextPopover, lyricMode, lyricState } = useOverlayStore(
    useShallow((s) => ({
      radialMenu: s.radialMenu,
      tempoPopover: s.tempoPopover,
      staffTextPopover: s.staffTextPopover,
      lyricMode: s.lyricMode,
      lyricState: s.lyricState,
    })),
  );
  // Viewport / Zoom canvas ref
  const canvasRef = useRef<ScoreCanvasHandle>(null);

  // ─── Engrave mode (hybrid) ────────────────────────────────────
  // The mode hooks are always called (rules of hooks); each is only `active`
  // when its mode is selected, and the result is woven into the shared canvas +
  // chrome by the matching `build*Mode` builder below. Because the canvas
  // instance is never unmounted across mode switches, scroll/zoom persist.
  const documentScore = useDocumentStore((s) => s.score);
  const isEngrave = modeKind === "engrave";
  const isPublish = modeKind === "publish";
  const isSetup = modeKind === "setup";
  const engraveBag = useEngraveMode({
    score: documentScore,
    selectedScoreIndex,
    setSelectedScoreIndex,
    updateScore,
    canvasRef,
    active: isEngrave,
  });

  // ─── Publish mode (hybrid) ────────────────────────────────────
  const publishBag = usePublishMode({
    score: documentScore,
    selectedScoreIndex,
    setSelectedScoreIndex,
    canvasRef,
    active: isPublish,
  });

  const handleViewportChange = useCallback((info: { zoom: number }) => setCurrentZoom(info.zoom), [setCurrentZoom]);

  // Path keys index into the *selected* score's layout tree, so an expansion
  // set from one score would silently point at unrelated staves in another.
  // Clearing on switch keeps the canvas honest.
  const handleSelectScore = useCallback(
    (index: number) => {
      setSelectedScoreIndex(index);
      setExpandedCondensingStaves(new Set());
    },
    [setSelectedScoreIndex, setExpandedCondensingStaves],
  );
  const { handleLayoutsChange, resolvedScoreDefs, visiblePartIds, useWritten, handleConcertPitchToggle } =
    useScoreViewData({ updateScore, selectedScoreIndex, selectedPartIds, onVisiblePartsChange });

  // Notify parent of visible parts for playback filtering — moved into useScoreViewData
  void visiblePartIds;

  // ─── Set cursor when entering note input mode ────
  useCursorOnNoteInputActivate({ store, noteInputState, selection, setCursor });

  // (History push is now handled by the store.subscribe above)

  // ─── Score handlers (creation + editing + list + export + layout) ──────
  const {
    handleChooseProjectLocation,
    handleCreateScore,
    handleApplyPageSetup,
    handleResetPageSetup,
    handleAddMeasures,
    handleTransposeDialog,
    handleExportPdf,
    handleExportSvg,
    handleLayoutChange,
    handleAddScore,
    handleDeleteScore,
    handleRenameScore,
    handleDuplicateScore,
    handleReorderScores,
    handleResetLayout,
    handleExpandCondensingStave,
    handlePartUpdate,
    handleAddInstrument,
    handleAddEnsemble,
    handleRemoveInstrument,
    handleAddInstrumentToScore,
    handleRemoveInstrumentFromScore,
    handleCreateSectionScore,
    handleSetScoreMembership,
    handleReorderInstrument,
    handleAddDoubling,
    handleRemoveDoubling,
  } = useScoreHandlers({
    store,
    loadScore,
    resetHistory,
    selection,
    selectedScoreIndex,
    setSelectedScoreIndex,
    setFileHandle,
    setExpandedCondensingStaves,
    pageSetupTargetIndex,
    updateScore,
    canCreateGitHubRepository,
    canvasRef,
    onOpenSetup,
  });

  // ─── File handlers (default loader + boot + folder + menu + save) ──────────
  const {
    loadDefaultScore: _loadDefaultScore,
    openFolderHandle,
    handleOpenProject,
    handleTrackWithGit,
    handleOpenFile,
    handleImportFile,
    handleDismissTrackBanner,
    handleSelectRecent,
    handleForgetRecent,
    handleSuppressStartCenterChange,
    handleSelectSample,
    handleStartCenterClose,
    handleStartCenterChooseProjectLocation,
    handleStartCenterNewScore,
    handleStartCenterOpenFile,
    handleStartCenterOpenProject,
    handleStartCenterImport,
    handleSave,
    handleSaveAs,
    handleDownload: _handleDownload,
  } = useFileHandlers({
    store,
    loadScore,
    resetHistory,
    openedFile,
    setSelectedScoreIndex,
    setFileHandle,
    setOpenedFile,
    setFileError,
    canCreateGitHubRepository,
    suppressTrackBanner,
    suppressStartCenter,
    fileHandle,
    onChooseProjectLocation: handleChooseProjectLocation,
    onNewScore: handleCreateScore,
  });

  const projectsSupported = useMemo(() => isFolderProjectSupported(), []);

  // ─── Editing handlers (clipboard + signatures + misc) ──────────
  const {
    handleCopy,
    handleCut,
    handlePaste,
    handleRepeat,
    handleSetTimeSignature,
    handleSetKeySignature,
    handleSetBarline,
    handleSetClef,
    handleSetRepeatStart,
    handleSetRepeatEnd,
    handleSetEnding,
    handleSelectAll,
    handleDeleteSelection,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    getSelectedMeasureIndex,
    getSelectedPartIndex,
  } = useEditingHandlers({
    store,
    historyStore,
    selection,
    updateScore,
    selectElement,
    selectRange,
    clearSelection,
    canvasRef,
    currentZoom,
  });

  // ─── Interaction handlers (keyboard + jumpbar + lyric + radial + dnd) ──────
  const {
    handleRadialMenuSelect,
    handleRadialMenuExpression,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    jumpBarActions,
    lyricNavIndex,
    lyricPosition,
    handleLyricCommit,
    handleLyricNavigate,
    handleLyricExit,
  } = useInteractionHandlers({
    canvasRef,
    leftPanelRef,
    rightPanelRef,
    mousePositionRef,
    store,
    selection,
    updateScore,
    commitPatches,
    currentZoom,
    selectedScoreIndex,
    onSwitchScore: handleSelectScore,
    noteInputState,
    getSelectedMeasureIndex,
    getSelectedPartIndex,
    selectRange,
    undo,
    redo,
    handleOpenFile,
    handleOpenProject,
    handleSave,
    handleSaveAs,
    handleExportPdf,
    handleExportSvg,
    handleCopy,
    handleCut,
    handlePaste,
    handleRepeat,
    handleAddMeasures,
    handleSetRepeatStart,
    handleSetRepeatEnd,
    handleSetEnding,
    handleSetBarline,
    handleSetClef,
    handleSetTimeSignature,
    handleSetKeySignature,
    setRadialMenu,
    setTempoPopover,
    setStaffTextPopover,
    setJumpBarOpen,
    setLyricMode,
    setLyricState,
    lyricMode,
    lyricState,
    radialMenu,
    openFolderHandle,
    setIsDragOver,
    setFileError,
    setOpenedFile,
    onOpenPublish,
    onOpenActivity: onOpenActivity ?? ignoreActivityChange,
    onNewScore: handleCreateScore,
  });
  usePublishJumpBarCatalog(jumpBarActions, store, canvasRef);

  // ─── MenuBar wiring (config + recents + callbacks + state) ──────
  const { hasDocument, canTranspose } = useDocumentStore(
    useShallow((s) => ({
      hasDocument: s.score !== null,
      canTranspose: getTransposeSelectionInfo(s.score, selection).noteCount > 0,
    })),
  );
  useMenuBarWiring({
    isActiveView,
    supportsWritePanels: modeKind === "write",
    hasDocument,
    canUndo,
    canRedo,
    selection,
    canTranspose,
    recentScores,
    handleOpenFile,
    handleImportFile,
    handleOpenProject,
    handleSelectRecent,
    handleSave,
    handleSaveAs,
    undo,
    redo,
    handleCopy,
    handleCut,
    handlePaste,
    handleDeleteSelection,
    handleSelectAll,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleSetTimeSignature,
    handleSetKeySignature,
    handleSetRepeatStart,
    handleSetBarline,
    handleSetRepeatEnd,
    handleSetClef,
    handleSetEnding,
    handleExportPdf,
    handleExportSvg,
    onOpenPublish,
  });

  const [printOverflowPages, setPrintOverflowPages] = useState<number[]>([]);

  // ─── Render ─────────────────────────────────────
  const scoreName = fileName || "Untitled";
  const titleSuffix = dirty ? " •" : "";
  useEffect(() => {
    document.title = `${scoreName}${titleSuffix} — Viritura`;
  }, [scoreName, titleSuffix]);

  // Prop bags for AppInnerView.
  const banners = {
    isDragOver,
    fileError,
    trackBannerFile,
    handleTrackWithGit,
    handleDismissTrackBanner,
    printOverflowPages,
  };

  // ─── Active workspace mode ────────────────────────────────────
  // Horizon (continuous scroll) is forbidden in engrave/publish print preview;
  // clamp to spread (horizontal) without changing the stored Write preference.
  // Returning from Engrave/Publish must restore Horizon rather than leaving an
  // imported score looking and behaving like the print-oriented preview.
  const noHorizon = isEngrave || isPublish;
  const effectiveViewMode: ViewMode = noHorizon && viewMode === "horizon" ? "spread-h" : viewMode;
  const previewViewMode: PreviewViewMode = effectiveViewMode === "horizon" ? "spread-h" : effectiveViewMode;

  /* eslint-disable react-hooks/refs -- the build*Mode helpers capture canvasRef/rightPanelRef into event-handler closures (onClick/onResize/imperative status-bar actions); they never read `.current` during render. */
  const mode: WorkspaceMode = isSetup
    ? buildSetupMode({
        canvasRef,
        leftFloat,
        selectedScoreIndex,
        selectedPartIds,
        setSelectedPartIds,
        viewMode,
        setViewMode,
        currentZoom,
        useWritten,
        handleConcertPitchToggle,
        resolvedScoreDefs,
        handleSelectScore,
        handleLayoutChange,
        handleAddInstrument,
        handleAddEnsemble,
        handleRemoveInstrument,
        handleAddInstrumentToScore,
        handleRemoveInstrumentFromScore,
        handleCreateSectionScore,
        handleSetScoreMembership,
        handleReorderInstrument,
        handleAddDoubling,
        handleRemoveDoubling,
        handlePartUpdate,
        handleAddScore,
        handleDeleteScore,
        handleRenameScore,
        handleDuplicateScore,
        handleResetLayout,
        handleReorderScores,
        handleExpandCondensingStave,
        expandedCondensingStaves,
      })
    : isEngrave
      ? buildEngraveMode({
          engrave: engraveBag,
          leftFloat,
          rightFloat,
          canvasRef,
          currentZoom,
          previewViewMode,
          setViewMode,
          useWritten,
          handleConcertPitchToggle,
          expandedCondensingStaves,
          handleExpandCondensingStave,
        })
      : isPublish
        ? buildPublishMode({
            publish: publishBag,
            canvasRef,
            currentZoom,
            previewViewMode,
            setViewMode,
          })
        : buildWriteMode({
            canvasRef,
            onTogglePanels: () => togglePanels(leftPanelRef, rightPanelRef),
            leftFloat,
            sourceFloat,
            selectedScoreIndex,
            selectedPartIds,
            handleSelectScore,
            expandedCondensingStaves,
            handleExpandCondensingStave,
            viewMode,
            setViewMode,
            currentZoom,
            useWritten,
            handleConcertPitchToggle,
            beatCountIssueCount: beatCountIssues.length,
            onRepairMeasures: repairMeasures,
            onDismissBeatCountWarnings: dismissBeatCountWarnings,
            inspectorFocus,
            selection,
            dialogs,
          });
  /* eslint-enable react-hooks/refs */

  const workspace = {
    canvasRef,
    selectedScoreIndex,
    expandedCondensingStaves,
    viewMode: effectiveViewMode,
    handleViewportChange,
    handleLayoutsChange,
    handlePrintOverflowChange: setPrintOverflowPages,
    statusVisible,
    mode,
  };
  const overlays = {
    store,
    selection,
    noteInputState,
    selectedScoreIndex,
    updateScore,
    selectedMeasureIndex: getSelectedMeasureIndex,
    mousePositionRef,
    dialogs,
    handleCreateScore,
    startCenterOpen,
    startCenterView,
    recentScores,
    githubAccount,
    account,
    projectsSupported,
    suppressStartCenter,
    handleSuppressStartCenterChange,
    handleStartCenterChooseProjectLocation,
    handleStartCenterNewScore,
    handleStartCenterOpenFile,
    handleStartCenterOpenProject,
    handleStartCenterImport,
    handleSelectRecent,
    handleForgetRecent,
    handleSelectSample,
    handleStartCenterClose,
    githubViewer,
    githubInstallUrl,
    githubInstallation,
    activeProjectStatus,
    pageSetupTargetIndex,
    setPageSetupTargetIndex,
    handleApplyPageSetup,
    handleResetPageSetup,
    handleTransposeDialog,
    setCondensingRouting,
    tempoPopover,
    staffTextPopover,
    lyricMode,
    lyricState,
    lyricNavIndex,
    lyricPosition,
    handleLyricCommit,
    handleLyricNavigate,
    handleLyricExit,
    radialMenu,
    handleRadialMenuSelect,
    handleRadialMenuExpression,
  };

  return (
    <AppInnerView
      isActiveView={isActiveView}
      mode={mode}
      dropRef={dropRef}
      handleDragOver={handleDragOver}
      handleDragLeave={handleDragLeave}
      handleDrop={handleDrop}
      banners={banners}
      workspace={workspace}
      overlays={overlays}
    />
  );
}

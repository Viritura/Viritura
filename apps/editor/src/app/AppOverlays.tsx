import { type ComponentProps, type RefObject } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";

import { StartCenter } from "../components/StartCenter";
import { SignInDialog } from "../auth";
import { ModalFlowHost } from "../components/ModalFlowHost";
import { CreateGitHubRepositoryDialog } from "../components/CreateGitHubRepositoryDialog";
import { PageSetupDialog } from "../components/PageSetupDialog";
import { CalibrationDialog } from "../components/CalibrationDialog";
import { HelpDialog } from "../components/HelpDialog";
import { getTransposeSelectionInfo, TransposeDialog } from "../components/TransposeDialog";
import { OrchestralStaffSplitDialog } from "../orchestralStaffSplit";
import { DrumKitDialogHost } from "../components/DrumKitDialog";
import { CondensingPopover, type CondensingMode } from "../components/CondensingPopover";
import { LyricInput } from "../components/LyricInput";
import { RadialMenu, TextPopover } from "@viritura/ui";

import { useDialogStore, closeDialog, openDialog } from "../store/dialogStore";
import {
  setRadialMenu,
  setTempoPopover,
  setStaffTextPopover,
  type TempoPopoverState,
  type StaffTextPopoverState,
  type RadialMenuState,
} from "../store/overlayStore";
import { useProjectStore } from "../store/projectStore";
import { setStartCenterOpen } from "../store/onboardingStore";
import type { StartCenterView } from "../store/onboardingStore";
import { openSettings } from "../components/SettingsDialog";
import { useGitHubAccount } from "../github/useGitHubAccount";
import type { VirituraAccountState } from "../auth";
import { defaultPageSetupForScore, type Score, type PageSetup } from "@viritura/core";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import type { NoteInputState } from "../store/noteInputStore";

import { applyTempoEdit, applyStaffTextEdit, applyCondensingOverride } from "./popoverHandlers";
import {
  getMenuItems,
  getMenuTitle,
  getMenuMaxItems,
  getMenuFirstPageMaxItems,
  getMenuStartAlign,
  getMenuRenderExpression,
  getMenuSearchPlaceholder,
} from "../radialMenu";
import type { LyricStateRef } from "./useLyricHandlers";
import type { GitHubInstallationStatus } from "../github/api";

/**
 * Effective page setup for the Page Setup dialog: the engine-resolved defaults
 * (which now enable page turns for parts) with any stored per-score override
 * layered on top, so the dialog reflects what actually gets laid out.
 */
function resolveDialogPageSetup(score: Score | null | undefined, idx: number): PageSetup {
  const defaults = defaultPageSetupForScore(score?.scores, idx, score?.layouts, score?.parts?.length);
  const stored = score?.scores?.[idx]?.pageSetup;
  return stored ? { ...defaults, ...stored, margins: { ...defaults.margins, ...stored.margins } } : defaults;
}

type StartCenterProps = ComponentProps<typeof StartCenter>;
type LyricInputProps = ComponentProps<typeof LyricInput>;
type RadialMenuProps = ComponentProps<typeof RadialMenu>;
type GitHubAccountState = ReturnType<typeof useGitHubAccount>;

function openSignInFromStartCenter(): void {
  setStartCenterOpen(false);
  openDialog("signIn");
}

function openAccountSettingsFromStartCenter(): void {
  setStartCenterOpen(false);
  openSettings("account", { returnToStartCenterOnClose: true });
}

function SignInOverlay({ open, account }: { open: boolean; account: VirituraAccountState }) {
  return (
    <SignInDialog
      open={open}
      account={account}
      onClose={() => {
        closeDialog("signIn");
        setStartCenterOpen(true);
      }}
    />
  );
}

function OrchestralStaffSplitOverlay({
  open,
  store,
  updateScore,
}: {
  open: boolean;
  store: DocumentStore;
  updateScore: (next: Score) => void;
}) {
  const score = useStore(store, (state) => state.score);
  return (
    <OrchestralStaffSplitDialog
      open={open}
      score={score}
      onClose={() => closeDialog("orchestralStaffSplit")}
      onUpdateScore={updateScore}
    />
  );
}

export interface AppOverlaysProps {
  // Document/state
  store: DocumentStore;
  selection: SelectionState;
  noteInputState: NoteInputState;
  selectedScoreIndex: number;
  updateScore: (next: Score) => void;
  selectedMeasureIndex: () => number | null;

  // Mouse position (for popovers anchored to cursor)
  mousePositionRef: RefObject<{ x: number; y: number }>;

  // Dialog state slice
  dialogs: ReturnType<typeof useDialogStore.getState>["open"];

  // Start Center
  startCenterOpen: boolean;
  startCenterView: StartCenterView;
  recentScores: StartCenterProps["recentScores"];
  githubAccount: GitHubAccountState;
  account: VirituraAccountState;
  projectsSupported: boolean;
  suppressStartCenter: boolean;
  handleSuppressStartCenterChange: StartCenterProps["onSuppressOnLaunchChange"];
  handleStartCenterChooseProjectLocation: StartCenterProps["onChooseProjectLocation"];
  handleStartCenterNewScore: StartCenterProps["onNewScore"];
  handleStartCenterOpenFile: StartCenterProps["onOpenFile"];
  handleStartCenterOpenProject: StartCenterProps["onOpenFolder"];
  handleStartCenterImport: NonNullable<StartCenterProps["onImport"]>;
  handleSelectRecent: StartCenterProps["onSelectRecent"];
  handleForgetRecent: StartCenterProps["onForgetRecent"];
  handleSelectSample: StartCenterProps["onSelectSample"];
  handleStartCenterClose: StartCenterProps["onClose"];

  // GitHub
  githubViewer: { login: string } | null;
  githubInstallUrl: string | null;
  githubInstallation: GitHubInstallationStatus | null;
  activeProjectStatus: { name?: string | null } | null;

  // Page Setup
  pageSetupTargetIndex: number | null;
  setPageSetupTargetIndex: (i: number | null) => void;
  handleApplyPageSetup: ComponentProps<typeof PageSetupDialog>["onApply"];
  handleResetPageSetup: ComponentProps<typeof PageSetupDialog>["onResetToDefault"];

  // Transpose
  handleTransposeDialog: ComponentProps<typeof TransposeDialog>["onApply"];

  // Condensing routing
  setCondensingRouting: (mode: CondensingMode) => void;

  // Popovers (overlay store state)
  tempoPopover: TempoPopoverState | null;
  staffTextPopover: StaffTextPopoverState | null;

  // Lyric
  lyricMode: boolean;
  lyricState: LyricStateRef | null;
  lyricNavIndex: LyricInputProps["navIndex"];
  lyricPosition: LyricInputProps["position"];
  handleLyricCommit: LyricInputProps["onCommitSyllable"];
  handleLyricNavigate: LyricInputProps["onNavigate"];
  handleLyricExit: LyricInputProps["onExit"];

  // Radial menu
  radialMenu: RadialMenuState | null;
  handleRadialMenuSelect: RadialMenuProps["onSelect"];
  handleRadialMenuExpression: RadialMenuProps["onSubmitExpression"];
}

export function AppOverlays(props: AppOverlaysProps) {
  const {
    store,
    selection,
    noteInputState,
    selectedScoreIndex,
    updateScore,
    selectedMeasureIndex,
    mousePositionRef,
    dialogs,
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
  } = props;

  return (
    <>
      <StartCenter
        key={startCenterView}
        open={startCenterOpen}
        initialView={startCenterView}
        recentScores={recentScores}
        githubAccount={githubAccount}
        account={account}
        projectsSupported={projectsSupported}
        suppressOnLaunch={suppressStartCenter}
        onSuppressOnLaunchChange={handleSuppressStartCenterChange}
        onChooseProjectLocation={handleStartCenterChooseProjectLocation}
        onSignIn={openSignInFromStartCenter}
        onOpenAccountSettings={openAccountSettingsFromStartCenter}
        onNewScore={handleStartCenterNewScore}
        onOpenFile={handleStartCenterOpenFile}
        onOpenFolder={handleStartCenterOpenProject}
        onImport={handleStartCenterImport}
        onSelectRecent={handleSelectRecent}
        onForgetRecent={handleForgetRecent}
        onSelectSample={handleSelectSample}
        onClose={handleStartCenterClose}
      />

      <SignInOverlay open={dialogs.signIn} account={account} />

      <CreateGitHubRepositoryDialog
        open={dialogs.projectGitHubSetup}
        ownerLogin={githubViewer?.login ?? ""}
        installUrl={githubInstallUrl}
        installation={githubInstallation}
        defaultRepositoryName={activeProjectStatus?.name ?? undefined}
        onClose={() => closeDialog("projectGitHubSetup")}
        onCreate={async (request) => {
          const adapter = useProjectStore.getState().adapter;
          if (!adapter?.isVersioned()) {
            throw new Error("Open a local project before setting up GitHub.");
          }
          const repository = await githubAccount.createRepository(request);
          await adapter.setRemoteUrl("origin", repository.cloneUrl);
          await useProjectStore.getState().refresh();
          toast.success(`Connected origin to ${repository.fullName}`);
          return repository;
        }}
      />

      <ModalFlowHost />

      <PageSetupDialog
        open={dialogs.pageSetup}
        onClose={() => {
          closeDialog("pageSetup");
          setPageSetupTargetIndex(null);
        }}
        onApply={handleApplyPageSetup}
        onResetToDefault={handleResetPageSetup}
        scopeName={(() => {
          const idx = pageSetupTargetIndex ?? selectedScoreIndex;
          const sd = store.getState().score?.scores?.[idx];
          return sd?.name ?? (idx === 0 ? "Full Score" : `Score ${idx + 1}`);
        })()}
        initialSetup={(() => {
          const idx = pageSetupTargetIndex ?? selectedScoreIndex;
          return resolveDialogPageSetup(store.getState().score, idx);
        })()}
      />

      <CalibrationDialog open={dialogs.calibration} onClose={() => closeDialog("calibration")} />

      <HelpDialog open={dialogs.help} onClose={() => closeDialog("help")} />

      <TransposeDialog
        open={dialogs.transpose}
        onClose={() => closeDialog("transpose")}
        onApply={handleTransposeDialog}
        selection={getTransposeSelectionInfo(store.getState().score, selection)}
      />

      <OrchestralStaffSplitOverlay open={dialogs.orchestralStaffSplit} store={store} updateScore={updateScore} />

      <DrumKitDialogHost open={dialogs.drumKit} onClose={() => closeDialog("drumKit")} />

      <CondensingPopover
        open={dialogs.condensingPopover}
        // eslint-disable-next-line react-hooks/refs
        position={mousePositionRef.current}
        sourceCount={2}
        currentMode={noteInputState.condensingRouting ?? undefined}
        onSelectMode={(mode: CondensingMode) => {
          setCondensingRouting(mode);
          closeDialog("condensingPopover");
          const { score } = store.getState();
          if (!score) return;
          const newScore = applyCondensingOverride({
            score,
            selection,
            noteInputState,
            selectedScoreIndex,
            measureIndex: selectedMeasureIndex() ?? 0,
            mode,
          });
          if (newScore !== score) updateScore(newScore);
        }}
        onClose={() => closeDialog("condensingPopover")}
      />

      <TextPopover
        open={tempoPopover !== null}
        onClose={() => setTempoPopover(null)}
        onSubmit={(value) => {
          const { score } = store.getState();
          if (!score || !tempoPopover) return;
          const newScore = applyTempoEdit(score, tempoPopover, value);
          if (newScore !== score) updateScore(newScore);
        }}
        position={tempoPopover?.position ?? { x: 0, y: 0 }}
        title="Tempo"
        placeholder="Allegro q=120"
        initialValue={tempoPopover?.initialValue ?? ""}
        allowEmpty
      />

      <TextPopover
        open={staffTextPopover !== null}
        onClose={() => setStaffTextPopover(null)}
        onSubmit={(value) => {
          const { score } = store.getState();
          if (!score || !staffTextPopover) return;
          const newScore = applyStaffTextEdit(score, staffTextPopover, value);
          if (newScore !== score) updateScore(newScore);
        }}
        position={staffTextPopover?.position ?? { x: 0, y: 0 }}
        title="Staff Text"
        placeholder="e.g. dolce, pizz., arco"
      />

      <LyricInput
        active={lyricMode}
        state={lyricState}
        navIndex={lyricNavIndex}
        position={lyricPosition}
        onCommitSyllable={handleLyricCommit}
        onNavigate={handleLyricNavigate}
        onExit={handleLyricExit}
      />

      <RadialMenu
        open={radialMenu !== null}
        onClose={() => setRadialMenu(null)}
        onSelect={handleRadialMenuSelect}
        items={radialMenu ? getMenuItems(radialMenu.category) : []}
        position={radialMenu?.position ?? { x: 0, y: 0 }}
        title={radialMenu ? getMenuTitle(radialMenu.category) : undefined}
        maxItemsPerPage={radialMenu ? getMenuMaxItems(radialMenu.category) : undefined}
        firstPageMaxItems={radialMenu ? getMenuFirstPageMaxItems(radialMenu.category) : undefined}
        startAlign={radialMenu ? getMenuStartAlign(radialMenu.category) : undefined}
        renderExpression={radialMenu ? getMenuRenderExpression(radialMenu.category) : undefined}
        searchPlaceholder={radialMenu ? getMenuSearchPlaceholder(radialMenu.category) : undefined}
        onSubmitExpression={handleRadialMenuExpression}
      />
    </>
  );
}

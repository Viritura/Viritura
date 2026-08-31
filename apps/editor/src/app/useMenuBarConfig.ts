import { useMemo } from "react";
import type { MenuBarCallbacks, MenuBarState } from "../components/MenuBar";
import type { SelectionState } from "../store/selectionStore";
import { openDialog, toggleDialog } from "../store/dialogStore";
import { openStartCenter, setStartCenterOpen } from "../store/onboardingStore";
import type { RecentScore } from "../store/recentScores";

const WEBSITE_BASE_URL =
  (import.meta.env.VITE_VIRITURA_WEBSITE_URL as string | undefined)?.replace(/\/+$/, "") ??
  (import.meta.env.DEV ? "http://localhost:5180" : "https://viritura.com");
const DOCS_URL = `${WEBSITE_BASE_URL}/docs`;

export interface MenuBarConfigDeps {
  hasDocument: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selection: SelectionState;
  canTranspose: boolean;
  recentScores: readonly RecentScore[];
  handleOpenFile: () => void | Promise<void>;
  handleImportFile: () => void | Promise<void>;
  handleOpenProject: () => void | Promise<void>;
  handleSelectRecent: (entry: RecentScore) => void | Promise<void>;
  handleSave: () => void | Promise<void>;
  handleSaveAs: () => void | Promise<void>;
  undo: () => void;
  redo: () => void;
  handleCopy: () => void | Promise<void>;
  handleCut: () => void | Promise<void>;
  handlePaste: () => void | Promise<void>;
  handleDeleteSelection: () => void;
  handleSelectAll: () => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetZoom: () => void;
  handleSetTimeSignature: NonNullable<MenuBarCallbacks["onSetTimeSignature"]>;
  handleSetKeySignature: NonNullable<MenuBarCallbacks["onSetKeySignature"]>;
  handleSetRepeatStart: NonNullable<MenuBarCallbacks["onSetRepeatStart"]>;
  handleSetBarline: NonNullable<MenuBarCallbacks["onSetBarline"]>;
  handleSetRepeatEnd: NonNullable<MenuBarCallbacks["onSetRepeatEnd"]>;
  handleSetClef: NonNullable<MenuBarCallbacks["onSetClef"]>;
  handleSetEnding: NonNullable<MenuBarCallbacks["onSetEnding"]>;
  handleExportPdf: () => void | Promise<void>;
  handleExportSvg: () => void | Promise<void>;
  onOpenPublish: (() => void) | undefined;
}

export interface MenuBarConfig {
  menuCallbacks: MenuBarCallbacks;
  menuState: MenuBarState;
  recentMenuEntries: { id: string; label: string; sublabel?: string }[];
}

/**
 * Build the merged MenuBar callbacks/state/recents config. The caller is
 * responsible for registering them via `useRegisterMenuCallbacks`/`State`/
 * `RecentEntries` (which need an `isActiveView` flag to scope per workspace).
 */
export function useMenuBarConfig(deps: MenuBarConfigDeps): MenuBarConfig {
  const {
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
  } = deps;

  const menuCallbacks: MenuBarCallbacks = useMemo(
    () => ({
      onNewScore: () => openStartCenter("newProject"),
      onOpenFile: () => {
        void handleOpenFile();
      },
      onOpenProject: () => {
        void handleOpenProject();
      },
      onImport: () => {
        void handleImportFile();
      },
      onShowStartCenter: () => setStartCenterOpen(true),
      onSelectRecentEntry: (id) => {
        const entry = recentScores.find((e) => e.id === id);
        if (entry) void handleSelectRecent(entry);
      },
      onSave: () => {
        void handleSave();
      },
      onSaveAs: () => {
        void handleSaveAs();
      },
      onUndo: () => undo(),
      onRedo: () => redo(),
      onCopy: () => {
        void handleCopy();
      },
      onCut: () => {
        void handleCut();
      },
      onPaste: () => {
        void handlePaste();
      },
      onDelete: handleDeleteSelection,
      onSelectAll: handleSelectAll,
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
      onResetZoom: handleResetZoom,
      onTranspose: () => openDialog("transpose"),
      onSplitOrchestralStaves: () => openDialog("orchestralStaffSplit"),
      onSetTimeSignature: handleSetTimeSignature,
      onSetKeySignature: handleSetKeySignature,
      onSetRepeatStart: handleSetRepeatStart,
      onSetBarline: handleSetBarline,
      onSetRepeatEnd: handleSetRepeatEnd,
      onSetClef: handleSetClef,
      onSetEnding: handleSetEnding,
      onShowHelp: () => openDialog("help"),
      onOpenDocs: () => {
        window.open(DOCS_URL, "_blank", "noopener,noreferrer");
      },
      onToggleSource: () => toggleDialog("source"),
      onPageSetup: () => openDialog("pageSetup"),
      onExportPdf: () => {
        void handleExportPdf();
      },
      onExportSvg: () => {
        void handleExportSvg();
      },
      onOpenPublish: () => {
        onOpenPublish?.();
      },
    }),
    [
      handleOpenFile,
      handleImportFile,
      handleOpenProject,
      handleSelectRecent,
      recentScores,
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
    ],
  );

  const menuState: MenuBarState = useMemo(
    () => ({
      hasDocument,
      canUndo,
      canRedo,
      hasSelection: selection.kind !== "none",
      canTranspose,
    }),
    [hasDocument, canUndo, canRedo, selection, canTranspose],
  );

  const recentMenuEntries = useMemo(() => {
    return [...recentScores]
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .map((entry) =>
        entry.vcs
          ? { id: entry.id, label: entry.vcs.rootName, sublabel: entry.vcs.scoreRelPath }
          : { id: entry.id, label: entry.scoreName },
      );
  }, [recentScores]);

  return { menuCallbacks, menuState, recentMenuEntries };
}

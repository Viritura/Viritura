import { useDefaultScoreLoader, type DefaultScoreLoader } from "./useDefaultScoreLoader";
import { useBootSequence } from "./useBootSequence";
import { useFolderOpen, type FolderOpenActions } from "./useFolderOpen";
import { useFileMenuActions, type FileMenuActions } from "./useFileMenuActions";
import { useFileSaveActions, type FileSaveActions } from "./useFileSaveActions";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import type { Score } from "@viritura/core";
import type { OpenFileResult } from "../commands/fileCommands";

type DocumentStoreApi = ReturnType<typeof useDocumentStoreApi>;
type LoadScore = (score: Score, fileName?: string, mnxJson?: string) => void;

interface UseFileHandlersParams {
  store: DocumentStoreApi;
  loadScore: LoadScore;
  resetHistory: (mnxJson: string) => void;
  openedFile: OpenFileResult | null;
  setSelectedScoreIndex: React.Dispatch<React.SetStateAction<number>>;
  setFileHandle: React.Dispatch<React.SetStateAction<FileSystemFileHandle | null>>;
  setOpenedFile: React.Dispatch<React.SetStateAction<OpenFileResult | null>>;
  setFileError: React.Dispatch<React.SetStateAction<string | null>>;
  canCreateGitHubRepository: boolean;
  suppressTrackBanner: boolean;
  suppressStartCenter: boolean;
  fileHandle: FileSystemFileHandle | null;
  /** Create a named project folder, initialize its score and history, then open Setup mode. */
  onChooseProjectLocation: () => Promise<FileSystemDirectoryHandle | null>;
  onNewScore: (projectName?: string, parentHandle?: FileSystemDirectoryHandle) => Promise<boolean>;
}

export interface FileHandlers extends DefaultScoreLoader, FolderOpenActions, FileMenuActions, FileSaveActions {}

/**
 * Bundles all file-related hooks (default score loader, boot sequence,
 * folder open, file menu, file save) into one orchestrator that returns
 * a flat bag of handlers. Keeps AppInner from having to thread each
 * hook's args + destructure separately.
 */
export function useFileHandlers(params: UseFileHandlersParams): FileHandlers {
  const {
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
    onChooseProjectLocation,
    onNewScore,
  } = params;

  const defaultLoader = useDefaultScoreLoader({
    store,
    loadScore,
    resetHistory,
    openedFile,
    setSelectedScoreIndex,
    setFileHandle,
  });

  useBootSequence({
    store,
    loadScore,
    resetHistory,
    setFileHandle,
    loadDefaultScore: defaultLoader.loadDefaultScore,
    suppressStartCenter,
  });

  const folder = useFolderOpen({
    store,
    loadScore,
    resetHistory,
    setSelectedScoreIndex,
    setFileHandle,
    setOpenedFile,
    setFileError,
    canCreateGitHubRepository,
  });

  const fileMenu = useFileMenuActions({
    store,
    loadScore,
    resetHistory,
    loadDefaultScore: defaultLoader.loadDefaultScore,
    loadSampleScore: defaultLoader.loadSampleScore,
    handleOpenProject: folder.handleOpenProject,
    setSelectedScoreIndex,
    setFileHandle,
    setOpenedFile,
    setFileError,
    suppressTrackBanner,
    onChooseProjectLocation,
    onNewScore,
  });

  const fileSave = useFileSaveActions({ store, fileHandle, setFileHandle });

  return { ...defaultLoader, ...folder, ...fileMenu, ...fileSave };
}

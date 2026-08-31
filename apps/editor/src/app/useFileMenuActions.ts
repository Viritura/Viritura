import { useCallback } from "react";
import { toast } from "sonner";
import { parseMnx } from "@viritura/format";
import { validateMnxJson } from "../commands/fileCommands";
import type { Score } from "@viritura/core";
import type { OpenFileResult } from "../commands/fileCommands";
import { importMusicFile, openMnxFile } from "../commands/fileCommands";
import {
  ensureScorePermission,
  forgetScore,
  listRecentScores,
  rememberScore,
  type RecentScore,
} from "../store/recentScores";
import {
  setRecentScores,
  setStartCenterOpen,
  setSuppressStartCenter,
  setSuppressTrackBanner,
  setTrackBannerFile,
} from "../store/onboardingStore";
import { useProjectStore, bootProjectFromHandle } from "../store/projectStore";
import type { DocumentStore } from "../store/documentStore";
import type { ScoreSample } from "../scoreSamples";
import { isFolderProjectSupported } from "./projectFolder";

export interface FileMenuDeps {
  store: DocumentStore;
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  resetHistory: (json: string) => void;
  loadDefaultScore: () => void;
  loadSampleScore: (sample: ScoreSample) => Promise<boolean>;
  handleOpenProject: () => Promise<void>;
  setSelectedScoreIndex: (i: number) => void;
  setFileHandle: (h: FileSystemFileHandle | null) => void;
  setOpenedFile: (f: OpenFileResult | null) => void;
  setFileError: (s: string | null) => void;
  suppressTrackBanner: boolean;
  /** Create a named project folder, initialize its score and history, then open Setup mode. */
  onChooseProjectLocation: () => Promise<FileSystemDirectoryHandle | null>;
  onNewScore: (projectName?: string, parentHandle?: FileSystemDirectoryHandle) => Promise<boolean>;
}

export interface FileMenuActions {
  handleOpenFile: () => Promise<void>;
  /** Import a MusicXML/MXL file, converting it to MNX and loading it. */
  handleImportFile: () => Promise<void>;
  handleDismissTrackBanner: (permanent: boolean) => void;
  handleSelectRecent: (entry: RecentScore) => Promise<void>;
  handleForgetRecent: (id: string) => Promise<void>;
  handleSuppressStartCenterChange: (value: boolean) => void;
  handleSelectSample: (sample: ScoreSample) => Promise<void>;
  handleStartCenterClose: () => void;
  handleStartCenterChooseProjectLocation: () => Promise<FileSystemDirectoryHandle | null>;
  handleStartCenterNewScore: (projectName: string, parentHandle: FileSystemDirectoryHandle) => Promise<boolean>;
  handleStartCenterOpenFile: () => Promise<void>;
  handleStartCenterOpenProject: () => Promise<void>;
  handleStartCenterImport: () => Promise<void>;
}

export function useFileMenuActions(deps: FileMenuDeps): FileMenuActions {
  const {
    store,
    loadScore,
    resetHistory,
    loadDefaultScore,
    loadSampleScore,
    handleOpenProject,
    setSelectedScoreIndex,
    setFileHandle,
    setOpenedFile,
    setFileError,
    suppressTrackBanner,
    onChooseProjectLocation,
    onNewScore,
  } = deps;

  const handleOpenFile = useCallback(async () => {
    setFileError(null);
    try {
      const result = await openMnxFile();
      if (!result) return;
      const validationError = validateMnxJson(result.mnxJson);
      if (validationError) {
        setFileError(`${result.filename}: ${validationError}`);
        toast.error(`Invalid MNX: ${validationError}`);
        return;
      }
      setOpenedFile(result);
      void useProjectStore.getState().setAdapter(null);
      if (result.fileHandle) {
        rememberScore({ scoreName: result.filename, fileHandle: result.fileHandle })
          .then((entry) => {
            setRecentScores((prev) => {
              const next = prev.filter((f) => f.id !== entry.id);
              next.unshift(entry);
              return next;
            });
          })
          .catch((err) => console.warn("Failed to remember recent score:", err));
      }
      const folderPickerAvailable = isFolderProjectSupported();
      if (!suppressTrackBanner && folderPickerAvailable && result.fileHandle) {
        setTrackBannerFile(result.filename);
      }
      toast.success(`Opened ${result.filename}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to open file";
      setFileError(msg);
      toast.error(msg);
    }
  }, [suppressTrackBanner, setFileError, setOpenedFile]);

  const handleImportFile = useCallback(async () => {
    setFileError(null);
    try {
      const result = await importMusicFile();
      if (!result) return;
      setOpenedFile(result);
      void useProjectStore.getState().setAdapter(null);
      toast.success(`Imported ${result.filename}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to import file";
      setFileError(msg);
      toast.error(`Import failed: ${msg}`);
    }
  }, [setFileError, setOpenedFile]);

  const handleDismissTrackBanner = useCallback((permanent: boolean) => {
    setTrackBannerFile(null);
    if (permanent) setSuppressTrackBanner(true);
  }, []);

  const handleSelectRecent = useCallback(
    async (entry: RecentScore) => {
      try {
        const granted = await ensureScorePermission(entry, "readwrite");
        if (!granted) {
          toast.error("Permission denied");
          return;
        }
        if (entry.vcs) {
          const adapter = await bootProjectFromHandle({
            rootHandle: entry.vcs.rootHandle,
            scorePath: entry.vcs.scoreRelPath,
          });
          const json = await adapter.readScore();
          const parsed = parseMnx(JSON.parse(json));
          setSelectedScoreIndex(0);
          loadScore(parsed, entry.vcs.rootName);
          resetHistory(store.getState().mnxJson || json);
          setFileHandle(null);
          setTrackBannerFile(null);
          setStartCenterOpen(false);
          toast.success(`Opened project ${entry.vcs.rootName}`);
        } else {
          const file = await entry.fileHandle.getFile();
          const text = await file.text();
          const validationError = validateMnxJson(text);
          if (validationError) {
            toast.error(`Invalid MNX: ${validationError}`);
            return;
          }
          setOpenedFile({ mnxJson: text, filename: file.name, fileHandle: entry.fileHandle });
          void useProjectStore.getState().setAdapter(null);
          if (!suppressTrackBanner) {
            setTrackBannerFile(file.name);
          }
          setStartCenterOpen(false);
          toast.success(`Opened ${file.name}`);
        }
        try {
          setRecentScores(await listRecentScores());
        } catch {
          /* ignore */
        }
      } catch (err) {
        console.error("Failed to reopen recent:", err);
        toast.error("Failed to open recent");
      }
    },
    [loadScore, resetHistory, store, suppressTrackBanner, setSelectedScoreIndex, setFileHandle, setOpenedFile],
  );

  const handleForgetRecent = useCallback(async (id: string) => {
    try {
      await forgetScore(id);
      setRecentScores((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error("Failed to forget recent:", err);
    }
  }, []);

  const handleSuppressStartCenterChange = useCallback((value: boolean) => {
    setSuppressStartCenter(value);
  }, []);

  const handleSelectSample = useCallback(
    async (sample: ScoreSample) => {
      if (!(await loadSampleScore(sample))) return;
      setOpenedFile(null);
      void useProjectStore.getState().setAdapter(null);
      setStartCenterOpen(false);
    },
    [loadSampleScore, setOpenedFile],
  );

  const handleStartCenterClose = useCallback(() => {
    setStartCenterOpen(false);
    if (!store.getState().score) {
      loadDefaultScore();
    }
  }, [loadDefaultScore, store]);

  const handleStartCenterNewScore = useCallback(
    async (projectName: string, parentHandle: FileSystemDirectoryHandle) => {
      const created = await onNewScore(projectName, parentHandle);
      if (created) setStartCenterOpen(false);
      return created;
    },
    [onNewScore],
  );

  const handleStartCenterChooseProjectLocation = useCallback(
    () => onChooseProjectLocation(),
    [onChooseProjectLocation],
  );

  const handleStartCenterOpenFile = useCallback(async () => {
    await handleOpenFile();
    if (store.getState().score) setStartCenterOpen(false);
  }, [handleOpenFile, store]);

  const handleStartCenterOpenProject = useCallback(async () => {
    await handleOpenProject();
    if (store.getState().score) setStartCenterOpen(false);
  }, [handleOpenProject, store]);

  const handleStartCenterImport = useCallback(async () => {
    await handleImportFile();
    if (store.getState().score) setStartCenterOpen(false);
  }, [handleImportFile, store]);

  return {
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
  };
}

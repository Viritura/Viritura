import { useCallback } from "react";
import { toast } from "sonner";
import { parseMnx } from "@viritura/format";
import { validateMnxJson } from "../commands/fileCommands";
import type { OpenFileResult } from "../commands/fileCommands";
import { setRecentScores, setTrackBannerFile } from "../store/onboardingStore";
import { listRecentScores, rememberScore } from "../store/recentScores";
import { scanForMnxFiles, type DiscoveredScore } from "../store/folderScan";
import { openScoreChooser, openFolderConfirm } from "../store/modalFlowStore";
import { openDialog } from "../store/dialogStore";
import { useProjectStore, bootProjectFromHandle } from "../store/projectStore";
import { directoryHasEntry } from "./fsHelpers";
import { FOLDER_PROJECT_UNAVAILABLE_MESSAGE, getDirectoryPicker } from "./projectFolder";
import type { Score } from "@viritura/core";
import type { DocumentStore } from "../store/documentStore";

export interface FolderOpenDeps {
  store: DocumentStore;
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  resetHistory: (json: string) => void;
  setSelectedScoreIndex: (i: number) => void;
  setFileHandle: (h: FileSystemFileHandle | null) => void;
  setOpenedFile: (f: OpenFileResult | null) => void;
  setFileError: (s: string | null) => void;
  canCreateGitHubRepository: boolean;
}

export interface FolderOpenActions {
  openFolderHandle: (handle: FileSystemDirectoryHandle, allowInitialize?: boolean) => Promise<void>;
  handleOpenProject: () => Promise<void>;
  handleTrackWithGit: () => Promise<void>;
}

async function inspectProjectFolder(
  handle: FileSystemDirectoryHandle,
  allowInitialize: boolean,
): Promise<{ hasGit: boolean; scores: DiscoveredScore[] } | null> {
  const hasGit = await directoryHasEntry(handle, ".git");
  if (!hasGit && !allowInitialize) {
    toast.error(
      `“${handle.name}” is not a Viritura project folder. Choose a folder containing .git, or use Open MNX Score for a standalone file.`,
      { duration: 7000 },
    );
    return null;
  }

  const scores = await scanForMnxFiles(handle);
  if (scores.length === 0) {
    toast.error(`No .mnx scores found in ${handle.name}.`);
    return null;
  }
  return { hasGit, scores };
}

export function useFolderOpen(deps: FolderOpenDeps): FolderOpenActions {
  const {
    store,
    loadScore,
    resetHistory,
    setSelectedScoreIndex,
    setFileHandle,
    setOpenedFile,
    setFileError,
    canCreateGitHubRepository,
  } = deps;

  const openFolderHandle = useCallback(
    async (handle: FileSystemDirectoryHandle, allowInitialize = false) => {
      const inspection = await inspectProjectFolder(handle, allowInitialize);
      if (!inspection) return;
      const { hasGit, scores } = inspection;

      let chosen: DiscoveredScore | null = null;
      if (scores.length === 1) {
        chosen = scores[0]!;
      } else {
        chosen = await openScoreChooser(handle.name, scores);
        if (!chosen) return;
      }

      let mode: "git" | "plain";
      if (hasGit) {
        mode = "git";
      } else {
        const choice = await openFolderConfirm(handle.name, scores.length);
        if (!choice) return;
        mode = choice === "init" ? "git" : "plain";
      }

      try {
        if (mode === "git") {
          const file = await chosen.handle.getFile();
          const json = await file.text();
          const validationError = validateMnxJson(json);
          if (validationError) {
            toast.error(`Invalid MNX: ${validationError}`);
            return;
          }
          const adapter = await bootProjectFromHandle({
            rootHandle: handle,
            scorePath: chosen.relativePath,
            ...(hasGit ? {} : { init: { initialJson: json, initialMessage: "Initial draft" } }),
          });
          const headJson = await adapter.readScore();
          const parsed = parseMnx(JSON.parse(headJson));
          setSelectedScoreIndex(0);
          loadScore(parsed, handle.name);
          resetHistory(store.getState().mnxJson || headJson);
          setFileHandle(null);
          setTrackBannerFile(null);
          toast.success(hasGit ? `Opened project ${handle.name}` : `Initialised version history for ${handle.name}`);
          if (!hasGit && canCreateGitHubRepository) {
            openDialog("projectGitHubSetup");
          }
          try {
            setRecentScores(await listRecentScores());
          } catch {
            /* ignore */
          }
        } else {
          const file = await chosen.handle.getFile();
          const json = await file.text();
          const validationError = validateMnxJson(json);
          if (validationError) {
            toast.error(`Invalid MNX: ${validationError}`);
            return;
          }
          setOpenedFile({ mnxJson: json, filename: file.name, fileHandle: chosen.handle });
          void useProjectStore.getState().setAdapter(null);
          rememberScore({ scoreName: file.name, fileHandle: chosen.handle })
            .then(async () => {
              try {
                setRecentScores(await listRecentScores());
              } catch {
                /* ignore */
              }
            })
            .catch(() => {
              /* ignore */
            });
          toast.success(`Opened ${file.name}`);
        }
      } catch (err) {
        console.error("Open folder failed:", err);
        toast.error("Failed to open folder");
      }
    },
    [loadScore, resetHistory, store, canCreateGitHubRepository, setSelectedScoreIndex, setFileHandle, setOpenedFile],
  );

  const handleOpenProject = useCallback(async () => {
    setFileError(null);
    const picker = getDirectoryPicker();
    if (!picker) {
      toast.info(FOLDER_PROJECT_UNAVAILABLE_MESSAGE, { duration: 9000 });
      return;
    }
    try {
      const handle = await picker({ mode: "readwrite" });
      await openFolderHandle(handle);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      console.error("Open folder failed:", err);
      toast.error("Failed to open folder");
    }
  }, [openFolderHandle, setFileError]);

  const handleTrackWithGit = useCallback(async () => {
    const picker = getDirectoryPicker();
    if (!picker) {
      toast.info(FOLDER_PROJECT_UNAVAILABLE_MESSAGE, { duration: 9000 });
      return;
    }
    try {
      const handle = await picker({ mode: "readwrite" });
      await openFolderHandle(handle, true);
      setTrackBannerFile(null);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      console.error("Track with Git failed:", err);
      toast.error("Failed to open folder");
    }
  }, [openFolderHandle]);

  return { openFolderHandle, handleOpenProject, handleTrackWithGit };
}

import { useCallback } from "react";
import { toast } from "sonner";
import { parseMnx } from "@viritura/format";
import { recoverImportedMnx, validateMnxJson } from "../commands/fileCommands";
import type { OpenFileResult } from "../commands/fileCommands";
import { setRecentScores, setTrackBannerFile } from "../store/onboardingStore";
import { listRecentScores, rememberScore } from "../store/recentScores";
import { pickDefaultScore, scanForMnxFiles, type DiscoveredScore } from "../store/folderScan";
import { openFolderConfirm } from "../store/modalFlowStore";
import { openDialog } from "../store/dialogStore";
import {
  useProjectStore,
  bootProjectFromHandle,
  resolveFileHandle,
  type ProjectScoreFile,
} from "../store/projectStore";
import { directoryHasEntry } from "./fsHelpers";
import { FOLDER_PROJECT_UNAVAILABLE_MESSAGE, getDirectoryPicker } from "./projectFolder";
import { isLiveSessionPinned } from "../projectFiles";
import { useLiveSessionStore } from "../live/liveSessionStore";
import type { Score } from "@viritura/core";
import type { DocumentStore } from "../store/documentStore";

export interface FolderOpenDeps {
  store: DocumentStore;
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  resetHistory: (json: string) => void;
  loadOpenedFile: (file: OpenFileResult) => boolean;
  setSelectedScoreIndex: (i: number) => void;
  setFileHandle: (h: FileSystemFileHandle | null) => void;
  setOpenedFile: (f: OpenFileResult | null) => void;
  setFileError: (s: string | null) => void;
  canSetUpGitHubRepository: boolean;
}

export interface FolderOpenActions {
  openFolderHandle: (handle: FileSystemDirectoryHandle) => Promise<void>;
  handleOpenProject: () => Promise<void>;
  handleTrackWithGit: () => Promise<void>;
  /**
   * Load another score from the open project folder, replacing the current
   * document. Callers resolve unsaved changes first. Resolves true on success.
   */
  openProjectScore: (relativePath: string) => Promise<boolean>;
}

interface ProjectScoreRequest {
  root: FileSystemDirectoryHandle;
  score: ProjectScoreFile;
  handle: FileSystemFileHandle;
  scores: readonly ProjectScoreFile[];
}

interface ValidProjectScore {
  json: string;
  name: string;
  score: Score;
}

async function inspectProjectFolder(
  handle: FileSystemDirectoryHandle,
): Promise<{ hasGit: boolean; scores: DiscoveredScore[] } | null> {
  const hasGit = await directoryHasEntry(handle, ".git");
  const scores = await scanForMnxFiles(handle);
  if (scores.length === 0) {
    toast.error(`No .mnx scores found in ${handle.name}.`);
    return null;
  }
  return { hasGit, scores };
}

async function readValidScore(handle: FileSystemFileHandle, recover: boolean): Promise<ValidProjectScore | null> {
  const file = await handle.getFile();
  const json = await file.text();
  const validationError = validateMnxJson(json);
  if (validationError) {
    toast.error(`Invalid MNX: ${validationError}`);
    return null;
  }
  try {
    const parsedJson = recover ? recoverImportedMnx(json).mnxJson : json;
    return { json, name: file.name, score: parseMnx(JSON.parse(parsedJson)) };
  } catch (error) {
    console.error("Invalid MNX:", error);
    toast.error(`Invalid MNX: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function chooseDefaultScore(
  root: FileSystemDirectoryHandle,
  scores: DiscoveredScore[],
): Promise<DiscoveredScore> {
  try {
    return pickDefaultScore(root.name, scores, await listRecentScores()) ?? scores[0]!;
  } catch (error) {
    console.warn("Could not read recent scores:", error);
    return scores[0]!;
  }
}

export function useFolderOpen(deps: FolderOpenDeps): FolderOpenActions {
  const {
    store,
    loadScore,
    resetHistory,
    loadOpenedFile,
    setSelectedScoreIndex,
    setFileHandle,
    setOpenedFile,
    setFileError,
    canSetUpGitHubRepository,
  } = deps;

  const loadVersionedScore = useCallback(
    async (
      { root, score, scores }: ProjectScoreRequest,
      file: ValidProjectScore,
      init?: { initialJson: string; initialMessage: string; preserveExistingScore: boolean },
      ensureCurrent?: () => void,
    ) => {
      let headJson = file.json;
      let parsed = file.score;
      await bootProjectFromHandle({
        rootHandle: root,
        scorePath: score.relativePath,
        scores,
        validateScore: (json) => {
          ensureCurrent?.();
          if (json !== headJson) {
            const validationError = validateMnxJson(json);
            if (validationError) throw new Error(`Invalid MNX: ${validationError}`);
            parsed = parseMnx(JSON.parse(json));
            headJson = json;
          }
        },
        onActivated: () => {
          setSelectedScoreIndex(0);
          loadScore(parsed, root.name);
          resetHistory(store.getState().mnxJson || headJson);
          setFileHandle(null);
          setOpenedFile(null);
          setTrackBannerFile(null);
        },
        ...(init ? { init } : {}),
      });
    },
    [loadScore, resetHistory, store, setSelectedScoreIndex, setFileHandle, setOpenedFile],
  );

  const loadPlainScore = useCallback(
    ({ root, score, handle, scores }: ProjectScoreRequest, file: ValidProjectScore): boolean => {
      const openedFile = { mnxJson: file.json, filename: file.name, fileHandle: handle };
      if (!loadOpenedFile(openedFile)) return false;
      void useProjectStore.getState().setAdapter(null);
      useProjectStore.getState().setProjectScores(root, scores, score.relativePath);
      setOpenedFile(openedFile);
      rememberScore({ scoreName: file.name, fileHandle: handle })
        .then(async () => {
          try {
            setRecentScores(await listRecentScores());
          } catch (error) {
            console.warn("Could not update recent scores:", error);
          }
        })
        .catch((error: unknown) => console.warn("Could not remember the opened score:", error));
      return true;
    },
    [loadOpenedFile, setOpenedFile],
  );

  const openFolderHandle = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      const inspection = await inspectProjectFolder(handle);
      if (!inspection) return;
      const { hasGit, scores } = inspection;

      let mode: "git" | "plain";
      if (hasGit) {
        mode = "git";
      } else {
        const choice = await openFolderConfirm(handle.name, scores.length);
        if (!choice) return;
        mode = choice === "init" ? "git" : "plain";
      }

      const chosen = await chooseDefaultScore(handle, scores);
      const request: ProjectScoreRequest = { root: handle, score: chosen, handle: chosen.handle, scores };
      try {
        const file = await readValidScore(chosen.handle, mode === "plain");
        if (!file) return;
        if (mode === "git") {
          await loadVersionedScore(
            request,
            file,
            hasGit
              ? undefined
              : { initialJson: file.json, initialMessage: "Initial draft", preserveExistingScore: true },
          );
          toast.success(hasGit ? `Opened project ${handle.name}` : `Initialised version history for ${handle.name}`);
          if (!hasGit && canSetUpGitHubRepository) {
            openDialog("projectGitHubSetup");
          }
        } else {
          if (!loadPlainScore(request, file)) return;
          toast.success(`Opened ${file.name}`);
        }
      } catch (err) {
        console.error("Open folder failed:", err);
        toast.error("Failed to open folder");
      }
    },
    [canSetUpGitHubRepository, loadVersionedScore, loadPlainScore],
  );

  const openProjectScore = useCallback(
    async (relativePath: string) => {
      const { projectFolder: root, projectScores: scores, activeScorePath, adapter } = useProjectStore.getState();
      const score = scores.find((entry) => entry.relativePath === relativePath);
      if (!root || !score) {
        toast.error("The project score is no longer available.");
        return false;
      }
      const { documentGeneration, scoreRevision } = store.getState();
      const ensureCurrent = () => {
        const project = useProjectStore.getState();
        const document = store.getState();
        if (isLiveSessionPinned(useLiveSessionStore.getState().status)) {
          throw new Error("End the live session before switching scores.");
        }
        if (
          document.documentGeneration !== documentGeneration ||
          document.scoreRevision !== scoreRevision ||
          project.projectFolder !== root ||
          project.activeScorePath !== activeScorePath ||
          project.adapter !== adapter
        ) {
          throw new Error("The open score changed while switching. Please try again.");
        }
      };
      try {
        const handle = await resolveFileHandle(root, relativePath);
        if (!handle) {
          toast.error(`${relativePath} is no longer in ${root.name}.`);
          return false;
        }
        const versioned = adapter?.isVersioned() ?? false;
        const file = await readValidScore(handle, !versioned);
        if (!file) return false;
        ensureCurrent();
        const request: ProjectScoreRequest = { root, score, handle, scores };
        if (versioned) {
          await loadVersionedScore(request, file, undefined, ensureCurrent);
        } else {
          if (!loadPlainScore(request, file)) return false;
        }
        toast.success(`Opened ${score.name}`);
        return true;
      } catch (err) {
        console.error("Open project score failed:", err);
        toast.error(`Failed to open ${score.name}`, {
          description: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    [loadVersionedScore, loadPlainScore, store],
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
      await openFolderHandle(handle);
      setTrackBannerFile(null);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      console.error("Track with Git failed:", err);
      toast.error("Failed to open folder");
    }
  }, [openFolderHandle]);

  return { openFolderHandle, handleOpenProject, handleTrackWithGit, openProjectScore };
}

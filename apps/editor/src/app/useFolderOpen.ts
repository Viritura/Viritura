import { useCallback } from "react";
import { toast } from "sonner";
import { parseMnx } from "@viritura/format";
import { validateMnxJson } from "../commands/fileCommands";
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

async function readValidScore(handle: FileSystemFileHandle): Promise<{ json: string; name: string } | null> {
  const file = await handle.getFile();
  const json = await file.text();
  const validationError = validateMnxJson(json);
  if (validationError) {
    toast.error(`Invalid MNX: ${validationError}`);
    return null;
  }
  return { json, name: file.name };
}

async function chooseDefaultScore(
  root: FileSystemDirectoryHandle,
  scores: DiscoveredScore[],
): Promise<DiscoveredScore> {
  try {
    return pickDefaultScore(root.name, scores, await listRecentScores()) ?? scores[0]!;
  } catch {
    return scores[0]!;
  }
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
    canSetUpGitHubRepository,
  } = deps;

  const loadVersionedScore = useCallback(
    async ({ root, score, scores }: ProjectScoreRequest, init?: { initialJson: string; initialMessage: string }) => {
      const adapter = await bootProjectFromHandle({
        rootHandle: root,
        scorePath: score.relativePath,
        scores,
        ...(init ? { init } : {}),
      });
      const headJson = await adapter.readScore();
      const parsed = parseMnx(JSON.parse(headJson));
      useProjectStore.getState().setProjectDiskBaseline(adapter, headJson);
      setSelectedScoreIndex(0);
      loadScore(parsed, root.name);
      resetHistory(store.getState().mnxJson || headJson);
      setFileHandle(null);
      setTrackBannerFile(null);
    },
    [loadScore, resetHistory, store, setSelectedScoreIndex, setFileHandle],
  );

  const loadPlainScore = useCallback(
    async ({ root, score, handle, scores }: ProjectScoreRequest, json: string, fileName: string) => {
      setOpenedFile({ mnxJson: json, filename: fileName, fileHandle: handle });
      await useProjectStore.getState().setAdapter(null);
      useProjectStore.getState().setProjectScores(root, scores, score.relativePath);
      rememberScore({ scoreName: fileName, fileHandle: handle })
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
    },
    [setOpenedFile],
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
        const file = await readValidScore(chosen.handle);
        if (!file) return;
        if (mode === "git") {
          await loadVersionedScore(
            request,
            hasGit ? undefined : { initialJson: file.json, initialMessage: "Initial draft" },
          );
          toast.success(hasGit ? `Opened project ${handle.name}` : `Initialised version history for ${handle.name}`);
          if (!hasGit && canSetUpGitHubRepository) {
            openDialog("projectGitHubSetup");
          }
        } else {
          await loadPlainScore(request, file.json, file.name);
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
      const { projectFolder: root, projectScores: scores, adapter } = useProjectStore.getState();
      const score = scores.find((entry) => entry.relativePath === relativePath);
      if (!root || !score) return false;
      try {
        const handle = await resolveFileHandle(root, relativePath);
        if (!handle) {
          toast.error(`${relativePath} is no longer in ${root.name}.`);
          return false;
        }
        const file = await readValidScore(handle);
        if (!file) return false;
        const request: ProjectScoreRequest = { root, score, handle, scores };
        if (adapter?.isVersioned()) {
          await loadVersionedScore(request);
        } else {
          await loadPlainScore(request, file.json, file.name);
        }
        toast.success(`Opened ${score.name}`);
        return true;
      } catch (err) {
        console.error("Open project score failed:", err);
        toast.error(`Failed to open ${score.name}`);
        return false;
      }
    },
    [loadVersionedScore, loadPlainScore],
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

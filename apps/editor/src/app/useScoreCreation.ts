import { useCallback } from "react";
import { toast } from "sonner";
import { parseMnx } from "@viritura/format";
import type { Score } from "@viritura/core";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../score/ScoreBuilder";
import { bootProjectFromHandle } from "../store/projectStore";
import { openDialog } from "../store/dialogStore";
import { openProjectNamePrompt } from "../store/modalFlowStore";
import type { DocumentStore } from "../store/documentStore";
import { createProjectDirectory, FOLDER_PROJECT_UNAVAILABLE_MESSAGE, getDirectoryPicker } from "./projectFolder";

export interface ScoreCreationDeps {
  store: DocumentStore;
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  resetHistory: (json: string) => void;
  setSelectedScoreIndex: (i: number) => void;
  setFileHandle: (h: FileSystemFileHandle | null) => void;
  canCreateGitHubRepository: boolean;
  /** Navigate to Setup mode once the new score exists. */
  onOpenSetup?: (() => void) | undefined;
}

export interface ScoreCreationActions {
  handleChooseProjectLocation: () => Promise<FileSystemDirectoryHandle | null>;
  handleCreateScore: (projectName?: string, parentHandle?: FileSystemDirectoryHandle) => Promise<boolean>;
}

export function useScoreCreation(deps: ScoreCreationDeps): ScoreCreationActions {
  const {
    store,
    loadScore,
    resetHistory,
    setSelectedScoreIndex,
    setFileHandle,
    canCreateGitHubRepository,
    onOpenSetup,
  } = deps;
  /**
   * Create a new score.
   *
   * A new score is always a project. The user names it, picks the parent
   * location, and Viritura creates a dedicated child folder containing the
   * MNX score and Git history. The user then lands
   * in Setup mode, where the ensemble, layouts, and opening signatures are all
   * edited against a live canvas. This replaces the former three-step modal,
   * whose instruments step duplicated Setup's roster editor against a
   * throwaway `Player[]` draft.
   */
  const handleChooseProjectLocation = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    const picker = getDirectoryPicker();
    if (!picker) {
      toast.info(FOLDER_PROJECT_UNAVAILABLE_MESSAGE, { duration: 9000 });
      return null;
    }
    try {
      return await picker({ mode: "readwrite" });
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return null;
      console.error("Project location selection failed:", err);
      toast.error("Failed to choose project location");
      return null;
    }
  }, []);

  const handleCreateScore = useCallback(
    async (requestedProjectName?: string, selectedParentHandle?: FileSystemDirectoryHandle): Promise<boolean> => {
      const finalize = (json: string, name: string): boolean => {
        let parsed;
        try {
          parsed = parseMnx(JSON.parse(json));
        } catch (err) {
          console.error("Failed to create score:", err);
          toast.error("Failed to create score");
          return false;
        }
        setSelectedScoreIndex(0);
        loadScore(parsed, name);
        resetHistory(store.getState().mnxJson || json);
        setFileHandle(null);
        // Setup is the only place a fresh, instrument-less score is usable.
        onOpenSetup?.();
        return true;
      };

      const projectName = requestedProjectName?.trim() || (await openProjectNamePrompt());
      if (!projectName) return false;

      const parentHandle = selectedParentHandle ?? (await handleChooseProjectLocation());
      if (!parentHandle) return false;
      let projectHandle: FileSystemDirectoryHandle | null = null;
      try {
        projectHandle = await createProjectDirectory(parentHandle, projectName);
        const json = buildBlankScore({ ...DEFAULT_NEW_SCORE_SETTINGS, title: projectName });

        await bootProjectFromHandle({
          rootHandle: projectHandle,
          scorePath: "score.mnx",
          init: { initialJson: json, initialMessage: "Initial draft" },
        });
        if (!finalize(json, projectName)) throw new Error("The new score could not be loaded.");
        toast.success(`Project created in ${parentHandle.name}/${projectHandle.name}`);
        if (canCreateGitHubRepository) openDialog("projectGitHubSetup");
        return true;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return false;
        if (parentHandle && projectHandle) {
          try {
            await parentHandle.removeEntry(projectHandle.name, { recursive: true });
          } catch (cleanupError) {
            console.error("Failed to remove incomplete project folder:", cleanupError);
          }
        }
        console.error("Project create failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to create project");
        return false;
      }
    },
    [
      loadScore,
      resetHistory,
      canCreateGitHubRepository,
      store,
      setSelectedScoreIndex,
      setFileHandle,
      onOpenSetup,
      handleChooseProjectLocation,
    ],
  );

  return { handleChooseProjectLocation, handleCreateScore };
}

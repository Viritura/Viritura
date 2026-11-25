import { toast } from "sonner";
import { hasUnsavedChanges, type DocumentStore } from "../store/documentStore";
import { useProjectStore } from "../store/projectStore";
import { openUnsavedChangesConfirm } from "../store/modalFlowStore";
import { useLiveSessionStore } from "../live/liveSessionStore";

export interface SwitchProjectScoreArgs {
  store: DocumentStore;
  relativePath: string;
  openProjectScore: (relativePath: string) => Promise<boolean>;
  save: () => Promise<void>;
}

/** A live session shares one document with collaborators, so it pins the open score. */
export function isLiveSessionPinned(status: string): boolean {
  return status === "starting" || status === "active";
}

function waitForCommitToSettle(): Promise<void> {
  if (!useProjectStore.getState().committing) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (state.committing) return;
      unsubscribe();
      resolve();
    });
  });
}

/**
 * Replace the open document with another score from the same project folder,
 * resolving unsaved changes first. Resolves true when the target score opened.
 */
export async function switchProjectScore({
  store,
  relativePath,
  openProjectScore,
  save,
}: SwitchProjectScoreArgs): Promise<boolean> {
  const { activeScorePath, projectScores, projectFolder, adapter } = useProjectStore.getState();
  const documentGeneration = store.getState().documentGeneration;
  if (relativePath === activeScorePath) return false;
  const isCurrent = () => {
    if (isLiveSessionPinned(useLiveSessionStore.getState().status)) {
      toast.info("End the live session before switching scores.");
      return false;
    }
    const project = useProjectStore.getState();
    if (
      store.getState().documentGeneration !== documentGeneration ||
      project.projectFolder !== projectFolder ||
      project.adapter !== adapter ||
      project.activeScorePath !== activeScorePath
    ) {
      toast.info("The open score changed. Choose a project file again.");
      return false;
    }
    return true;
  };
  if (!isCurrent()) return false;

  if (hasUnsavedChanges(store.getState())) {
    const currentName = projectScores.find((score) => score.relativePath === activeScorePath)?.name ?? "This score";
    const confirmedRevision = store.getState().scoreRevision;
    const choice = await openUnsavedChangesConfirm(currentName);
    if (!choice || !isCurrent()) return false;
    if (store.getState().scoreRevision !== confirmedRevision) {
      toast.info("The score changed while switching. Please try again.");
      return false;
    }
    if (choice === "save") {
      await save();
      if (!isCurrent() || hasUnsavedChanges(store.getState())) return false;
    }
  }

  const scoreRevision = store.getState().scoreRevision;
  // The previous score's background commit must finish before its adapter is replaced.
  await waitForCommitToSettle();
  if (!isCurrent()) return false;
  if (store.getState().scoreRevision !== scoreRevision) {
    toast.info("The score changed while switching. Please try again.");
    return false;
  }
  return openProjectScore(relativePath);
}

import { useEffect } from "react";
import { toast } from "sonner";
import { parseMnx } from "@viritura/format";
import type { Score } from "@viritura/core";
import { loadGistSetlist, readGistSetlistLocation, useGistSetlistStore } from "../gistShare";
import { readHandoffFromHash, clearHandoffFromUrl } from "@viritura/core";
import { consumeGitHubOAuthReturnIntent } from "../github/api";
import { listRecentScores } from "../store/recentScores";
import { setRecentScores, setStartCenterOpen } from "../store/onboardingStore";
import { bootStandalone } from "../store/projectStore";
import { parseLiveRoomIdFromUrl } from "../live/liveUrl";
import type { DocumentStore } from "../store/documentStore";
import { SHARED_SETLIST_READ_ONLY } from "../store/documentStore";
import { hasPendingTwoFactorChallenge } from "../auth/api";
import { FOLDER_PROJECT_UNAVAILABLE_MESSAGE, isFolderProjectSupported } from "./projectFolder";
import { isFileLaunchUrl } from "../pwa";

export interface BootSequenceDeps {
  store: DocumentStore;
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  resetHistory: (json: string) => void;
  setFileHandle: (h: FileSystemFileHandle | null) => void;
  loadDefaultScore: () => void;
  suppressStartCenter: boolean;
}

async function openSharedSetlist(
  { store, loadScore, resetHistory, setFileHandle }: BootSequenceDeps,
  isCancelled: () => boolean,
): Promise<void> {
  setStartCenterOpen(false);
  const { documentGeneration, scoreRevision } = store.getState();
  try {
    const location = readGistSetlistLocation(window.location);
    if (!location) throw new Error("The setlist link is missing its Gist ID.");
    const setlist = await loadGistSetlist(location);
    if (isCancelled()) return;
    if (
      store.getState().documentGeneration !== documentGeneration ||
      store.getState().scoreRevision !== scoreRevision
    ) {
      toast.info("The open score changed while loading the shared setlist.");
      return;
    }
    const firstFile = setlist.files[0];
    if (!firstFile) throw new Error("The shared Gist does not contain any MNX scores.");
    loadScore(structuredClone(firstFile.score), firstFile.fileName, firstFile.mnx);
    useGistSetlistStore.getState().open(setlist, store.getState().documentGeneration);
    resetHistory(store.getState().mnxJson);
    store.getState().setReadOnly(SHARED_SETLIST_READ_ONLY);
    setFileHandle(null);
  } catch (error) {
    if (isCancelled()) return;
    useGistSetlistStore.getState().clear();
    toast.error(error instanceof Error ? error.message : "The shared setlist could not be loaded.");
    if (!store.getState().score) setStartCenterOpen(true);
  }
}

/**
 * Boot sequence — decides whether to show the Start Center on first mount.
 *  • Live-session guest URL (`?live=...`) → skip Start Center and the default
 *    sample score entirely; LiveSessionProvider auto-joins the room and the
 *    bridge replicates the host's score into the empty local doc.
 *  • Converter handoff (`#h=...`) → bootstrap a standalone score and clear the URL.
 *  • OAuth return from activity → quietly load the default sample score.
 *  • "Don't show on launch" suppressed → load the default sample score.
 *  • Otherwise → populate recents and open the Start Center.
 */
export function useBootSequence(deps: BootSequenceDeps): void {
  const { store, loadScore, resetHistory, setFileHandle, loadDefaultScore, suppressStartCenter } = deps;
  useEffect(() => {
    if (store.getState().score) return;
    // Live-session guest path: a `?live=ROOMID` URL means the user clicked
    // an invite link. Don't open the Start Center and don't load the
    // default sample score — either would either occlude the host's
    // incoming state or get pushed back at the host as a stomp. The empty
    // local doc is the correct starting condition for LiveSessionProvider
    // to join the room and have the bridge pull the host's content down.
    if (parseLiveRoomIdFromUrl() !== null) return;
    if (isFileLaunchUrl()) {
      setStartCenterOpen(true);
      return;
    }

    let cancelled = false;
    (async () => {
      if (new URLSearchParams(window.location.search).get("open") === "gist-setlist") {
        await openSharedSetlist(deps, () => cancelled);
        return;
      }

      try {
        const handoff = readHandoffFromHash(window.location.hash);
        if (handoff) {
          clearHandoffFromUrl();
          const fileName = handoff.fileName || "Converted.mnx";
          const parsed = parseMnx(JSON.parse(handoff.json));
          if (cancelled) return;
          loadScore(parsed, fileName);
          resetHistory(store.getState().mnxJson || handoff.json);
          setFileHandle(null);
          await bootStandalone({ fileName, initialJson: handoff.json });
          if (cancelled) return;
          toast.success(
            `Loaded "${handoff.sourceName ?? fileName}" from converter — ` + "press Ctrl+S to choose a save location.",
            { duration: 6000 },
          );
          return;
        }
      } catch (err) {
        console.warn("Converter handoff failed:", err);
      }

      const oauthReturnIntent = consumeGitHubOAuthReturnIntent();
      if (hasPendingTwoFactorChallenge()) {
        loadDefaultScore();
        return;
      }
      if (oauthReturnIntent?.source === "activity") {
        loadDefaultScore();
        return;
      }

      try {
        const all = await listRecentScores();
        if (cancelled) return;
        setRecentScores(all);
      } catch (err) {
        console.warn("Failed to load recents for Start Center:", err);
      }
      if (cancelled) return;
      if (suppressStartCenter && oauthReturnIntent?.source !== "start-center") {
        loadDefaultScore();
        if (!isFolderProjectSupported()) {
          toast.info(FOLDER_PROJECT_UNAVAILABLE_MESSAGE, { duration: 9000 });
        }
      } else {
        setStartCenterOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}

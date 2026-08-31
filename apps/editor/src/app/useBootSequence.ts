import { useEffect } from "react";
import { toast } from "sonner";
import { parseMnx } from "@viritura/format";
import type { Score } from "@viritura/core";
import { readHandoffFromHash, clearHandoffFromUrl } from "@viritura/core";
import { consumeGitHubOAuthReturnIntent } from "../github/api";
import { listRecentScores } from "../store/recentScores";
import { setRecentScores, setStartCenterOpen } from "../store/onboardingStore";
import { bootStandalone } from "../store/projectStore";
import { parseLiveRoomIdFromUrl } from "../live/liveUrl";
import type { DocumentStore } from "../store/documentStore";
import { FOLDER_PROJECT_UNAVAILABLE_MESSAGE, isFolderProjectSupported } from "./projectFolder";

export interface BootSequenceDeps {
  store: DocumentStore;
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  resetHistory: (json: string) => void;
  setFileHandle: (h: FileSystemFileHandle | null) => void;
  loadDefaultScore: () => void;
  suppressStartCenter: boolean;
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

    let cancelled = false;
    (async () => {
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

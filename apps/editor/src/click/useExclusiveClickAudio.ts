import { useEffect, useEffectEvent } from "react";
import { subscribePlaybackStatus, usePlaybackActions } from "@viritura/playback";

/**
 * Keeps the editor's instrument audio released while the click activity is
 * open: once on entry, and again if anything (MCP, shortcuts, selection
 * playback) starts the editor transport. Returns the release action so a
 * Start can await it before the click engine runs.
 */
export function useExclusiveClickAudio(): () => Promise<void> {
  const { releaseAudio } = usePlaybackActions();
  const release = useEffectEvent(() => {
    void releaseAudio().catch((failure: unknown) => console.error("Could not release editor audio", failure));
  });
  useEffect(() => {
    release();
    return subscribePlaybackStatus((status) => {
      if (status !== "stopped") release();
    });
  }, []);
  return releaseAudio;
}

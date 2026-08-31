import { useEffect, useRef } from "react";
import { keyboardRegistry } from "../../keyboard/KeyboardRegistry";
import { computeSelectionStartTime } from "./selectionStartTime";
import type { SelectionState } from "../../store/selectionStore";
import type { Score } from "@viritura/core";
import type { PlaybackActions, PlaybackState } from "@viritura/playback";

interface PlayPauseArgs {
  playback: PlaybackState;
  playbackActions: PlaybackActions;
  selection: SelectionState;
  noteInputActiveRef: { current: boolean };
  docScoreRef: { current: Score | null };
}

/**
 * Register the global Space-key play/pause shortcut. The handler reads from
 * refs so re-renders that change `playback`/`selection` don't tear down/
 * re-create the registry entry on every keystroke.
 */
export function usePlayPauseShortcut(args: PlayPauseArgs): void {
  const { playback, playbackActions, selection, noteInputActiveRef, docScoreRef } = args;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const playbackActionsRef = useRef(playbackActions);
  playbackActionsRef.current = playbackActions;
  const selectionForPlaybackRef = useRef(selection);
  selectionForPlaybackRef.current = selection;

  useEffect(() => {
    const teardown = keyboardRegistry.register({
      id: "scoreCanvas.playPause",
      key: "Space",
      context: "global",
      // Space in note-input advances cursor — only fire here when not in note input.
      when: () => !noteInputActiveRef.current,
      handler: () => {
        const pb = playbackRef.current;
        const acts = playbackActionsRef.current;
        if (pb.status === "playing") {
          acts.pause();
          return;
        }
        // If a note/event is selected, start from that position
        const startTime = computeSelectionStartTime(selectionForPlaybackRef.current, docScoreRef.current, acts);
        acts.play(startTime);
      },
    });
    return teardown;
  }, []);
}

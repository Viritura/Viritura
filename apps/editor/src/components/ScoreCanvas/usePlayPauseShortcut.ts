import { useEffect, useRef } from "react";
import { keyboardRegistry } from "../../keyboard/KeyboardRegistry";
import type { PlaybackActions, PlaybackState } from "@viritura/playback";

interface PlayPauseArgs {
  playback: PlaybackState;
  playbackActions: PlaybackActions;
  noteInputActiveRef: { current: boolean };
}

export function shouldHandlePlayPauseShortcut(event: KeyboardEvent, noteInputActive: boolean): boolean {
  const target = event.target;
  const editingText =
    target instanceof HTMLElement && (target.matches("input, textarea, select, button") || target.isContentEditable);
  return !noteInputActive && !editingText;
}

/**
 * Register the global Space-key play/pause shortcut. The handler reads from
 * refs so re-renders that change playback don't tear down/
 * re-create the registry entry on every keystroke.
 */
export function usePlayPauseShortcut(args: PlayPauseArgs): void {
  const { playback, playbackActions, noteInputActiveRef } = args;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const playbackActionsRef = useRef(playbackActions);
  playbackActionsRef.current = playbackActions;

  useEffect(() => {
    const teardown = keyboardRegistry.register({
      id: "scoreCanvas.playPause",
      key: "Space",
      context: "global",
      // Space in note-input advances cursor — only fire here when not in note input.
      when: (event) => shouldHandlePlayPauseShortcut(event, noteInputActiveRef.current),
      handler: () => {
        const pb = playbackRef.current;
        const acts = playbackActionsRef.current;
        if (pb.status === "playing") {
          acts.pause();
          return;
        }
        void acts.play();
      },
    });
    return teardown;
  }, []);
}

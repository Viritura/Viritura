import { useEffect, useEffectEvent } from "react";
import { keyboardRegistry } from "../keyboard/KeyboardRegistry";
import { shouldHandlePlayPauseShortcut } from "../components/ScoreCanvas/usePlayPauseShortcut";

/**
 * Space toggles the click transport while the activity is open. The binding is
 * captured ahead of the editor's play/pause shortcut so Space can never start
 * instrument playback from the still-mounted (hidden) Write canvas.
 */
export function useClickSpaceShortcut(toggle: () => void): void {
  const onSpace = useEffectEvent(toggle);
  useEffect(
    () =>
      keyboardRegistry.register({
        id: "click.startStop",
        key: "Space",
        context: "global",
        priority: "high",
        when: (event) => shouldHandlePlayPauseShortcut(event, false),
        handler: () => onSpace(),
      }),
    [],
  );
}

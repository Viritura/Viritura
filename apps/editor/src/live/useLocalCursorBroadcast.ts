/**
 * useLocalCursorBroadcast — publishes the local user's cursor position and
 * note-input mode to the live session's awareness channel so other peers
 * can render a remote-cursor overlay.
 *
 * Awareness payload structure is owned by <c>@viritura/crdt</c>; this hook
 * is the bridge from the editor's local stores into that schema.
 */

import { useEffect } from "react";
import type { CollaboratorIdentity, VirituraAwarenessState } from "@viritura/crdt";
import { useNoteInput } from "../store/noteInputStore";
import { useLiveSessionStore } from "./liveSessionStore";

export function useLocalCursorBroadcast(identity: CollaboratorIdentity | null): void {
  const session = useLiveSessionStore((s) => s.session);
  const { state: noteInput } = useNoteInput();

  useEffect(() => {
    if (!session || !identity) return;
    const next: VirituraAwarenessState = {
      identity,
      mode: noteInput.active ? "note-input" : "normal",
      cursor: noteInput.cursorPosition
        ? {
            measureIndex: noteInput.cursorPosition.measureIndex,
            partIndex: noteInput.cursorPosition.partIndex,
            beatPosition: noteInput.cursorPosition.beatPosition,
            staffIndex: noteInput.cursorPosition.staffIndex,
          }
        : undefined,
    };
    session.setLocalAwareness(next);
  }, [session, identity, noteInput.active, noteInput.cursorPosition]);
}

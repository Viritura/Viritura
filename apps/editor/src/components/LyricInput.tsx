/**
 * LyricInput — inline text overlay for entering lyrics syllable-by-syllable.
 *
 * Follows the standard notation-editor lyric-entry workflow:
 *  - Space:       commit syllable (whole word), advance to next note
 *  - Hyphen (-):  commit syllable (start/middle of word), advance to next note
 *  - Underscore:  melisma — skip note, advance
 *  - Enter/Down:  next verse on same note
 *  - Up:          previous verse on same note
 *  - Escape:      exit lyric mode
 *  - Shift+Space: literal space inside syllable
 */

import { useEffect, useRef, useCallback, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { FormInput } from "@viritura/ui";
import type { LyricLineType } from "@viritura/core";
import { findNextInVoice, findPrevInVoice } from "../navigation/NavigationIndex";
import type { NavigationIndex } from "../navigation/NavigationIndex";
import { resolveEventLocation, getEventAtLocation } from "../score/ElementPath";
import { useDocumentStoreApi } from "../store/DocumentContext";

function lyricPortalStyle(x: number, y: number): CSSProperties {
  return {
    position: "fixed",
    left: x,
    top: y,
    transform: "translateX(-50%)",
    zIndex: 10000,
    pointerEvents: "auto",
  };
}
function lyricInputStyle(value: string): CSSProperties {
  return {
    minWidth: 40,
    width: Math.max(40, value.length * 9 + 16),
    fontSize: "var(--type-small-size)",
    fontFamily: "serif",
    fontStyle: "italic",
    textAlign: "center",
    padding: "1px 4px",
    border: "1px solid rgba(var(--accent-rgb, 95, 201, 173), 0.7)",
    borderRadius: 3,
    outline: "none",
    background: "rgba(255, 255, 255, 0.95)",
    boxShadow: "0 1px 4px rgba(0,0,0,0.15), 0 0 0 3px rgba(var(--accent-rgb, 95, 201, 173), 0.18)",
    color: "var(--text)",
  };
}
const LYRIC_VERSE_LABEL_STYLE: CSSProperties = {
  textAlign: "center",
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  marginTop: 2,
  userSelect: "none",
  whiteSpace: "nowrap",
};

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface LyricInputState {
  /** Element ID of the note/chord currently being edited */
  elementId: string;
  /** Current verse line ID (e.g. "1", "2") */
  lineId: string;
}

export interface LyricInputProps {
  /** Whether lyric input mode is active */
  active: boolean;
  /** Current state (active element + verse) */
  state: LyricInputState | null;
  /** Navigation index for moving between events */
  navIndex: NavigationIndex | null;
  /** Screen position for the input overlay */
  position: { x: number; y: number } | null;
  /** Called when a syllable is committed to the score */
  onCommitSyllable: (elementId: string, lineId: string, text: string, type: LyricLineType) => void;
  /** Called to navigate to a different element/verse */
  onNavigate: (nextState: LyricInputState) => void;
  /** Called to exit lyric mode */
  onExit: () => void;
}

// ═══════════════════════════════════════════
// Component
// ═══════════════════════════════════════════

interface LyricKeyHandlerDeps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  commitPendingSyllable: () => void;
  onExit: () => void;
  commitAndAdvance: (action: "space" | "hyphen") => void;
  handleMelisma: () => void;
  changeVerse: (direction: 1 | -1) => void;
  navigateHorizontal: (direction: "prev" | "next") => void;
}

/**
 * Dispatch a keydown to the appropriate lyric-input action.
 * Returns true if the event should be consumed (preventDefault + stopPropagation).
 */
function handleLyricKey(e: KeyboardEvent, deps: LyricKeyHandlerDeps): boolean {
  switch (e.key) {
    case "Escape":
      deps.commitPendingSyllable();
      deps.onExit();
      return true;
    case " ":
      if (e.shiftKey) return false; // literal space
      deps.commitAndAdvance("space");
      return true;
    case "-":
      deps.commitAndAdvance("hyphen");
      return true;
    case "_":
      deps.handleMelisma();
      return true;
    case "Enter":
    case "ArrowDown":
      deps.changeVerse(1);
      return true;
    case "ArrowUp":
      deps.changeVerse(-1);
      return true;
    case "ArrowLeft": {
      const input = deps.inputRef.current;
      if (!input || input.selectionStart !== 0 || input.selectionEnd !== 0) {
        return false;
      }
      deps.navigateHorizontal("prev");
      return true;
    }
    case "ArrowRight": {
      const input = deps.inputRef.current;
      if (!input || input.selectionStart !== input.value.length) return false;
      deps.navigateHorizontal("next");
      return true;
    }
    default:
      return false;
  }
}

export function LyricInput({
  active,
  state,
  navIndex,
  position,
  onCommitSyllable,
  onNavigate,
  onExit,
}: LyricInputProps) {
  const store = useDocumentStoreApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  // Track whether the current syllable continues a word (arrived via hyphen)
  const continuingWordRef = useRef(false);

  // Load existing lyric text when navigating to a new event/verse
  useEffect(() => {
    if (!active || !state) {
      continuingWordRef.current = false;
      return;
    }
    const { score } = store.getState();
    if (!score) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setValue("");
      return;
    }
    const loc = resolveEventLocation(state.elementId, score);
    if (!loc) {
      setValue("");
      return;
    }
    const ev = getEventAtLocation(score, loc);
    if (!ev || ev.type !== "event") {
      setValue("");
      return;
    }
    const existing = ev.lyrics?.lines?.[state.lineId]?.text ?? "";
    setValue(existing);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [active, state?.elementId, state?.lineId]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally omits `store` and the rest of `state`: we re-seed `value` only when the *target* lyric (active flag, element id, line id) changes. `store` is read via `getState()` once inside the effect; re-running on every score edit would clobber in-progress typing.

  // Determine the syllable type based on action and whether we're continuing a word
  const getSyllableType = useCallback((action: "space" | "hyphen"): LyricLineType => {
    if (action === "hyphen") {
      // Pressing hyphen: this syllable continues into the next
      return continuingWordRef.current ? "middle" : "start";
    }
    // Pressing space: this syllable ends a word
    return continuingWordRef.current ? "end" : "whole";
  }, []);

  // Commit current text and advance to next note
  const commitAndAdvance = useCallback(
    (action: "space" | "hyphen") => {
      if (!state || !navIndex) return;
      const text = value.trim();
      if (text) {
        const type = getSyllableType(action);
        onCommitSyllable(state.elementId, state.lineId, text, type);
      }
      // Set continuing state for next syllable
      continuingWordRef.current = action === "hyphen";
      // Find next event
      const nextId = findNextInVoice(navIndex, state.elementId);
      if (nextId) {
        onNavigate({ elementId: nextId, lineId: state.lineId });
      }
    },
    [state, navIndex, value, getSyllableType, onCommitSyllable, onNavigate],
  );

  // Handle melisma (underscore) — skip current note, advance
  const handleMelisma = useCallback(() => {
    if (!state || !navIndex) return;
    // If there's text, commit it first
    const text = value.trim();
    if (text) {
      const type = continuingWordRef.current ? "end" : "whole";
      onCommitSyllable(state.elementId, state.lineId, text, type);
      continuingWordRef.current = false;
    }
    // Advance without adding lyric
    const nextId = findNextInVoice(navIndex, state.elementId);
    if (nextId) {
      onNavigate({ elementId: nextId, lineId: state.lineId });
    }
  }, [state, navIndex, value, onCommitSyllable, onNavigate]);

  // Commit current input text as a terminal syllable (end/whole), then
  // reset the continuing-word flag. Used by Escape, arrows, and verse switching.
  const commitPendingSyllable = useCallback(() => {
    if (!state) return;
    const text = value.trim();
    if (!text) return;
    const type = continuingWordRef.current ? "end" : "whole";
    onCommitSyllable(state.elementId, state.lineId, text, type);
    continuingWordRef.current = false;
  }, [state, value, onCommitSyllable]);

  // Move horizontally in the voice (commit pending text first).
  const navigateHorizontal = useCallback(
    (direction: "prev" | "next") => {
      if (!state || !navIndex) return;
      commitPendingSyllable();
      const nextId =
        direction === "next" ? findNextInVoice(navIndex, state.elementId) : findPrevInVoice(navIndex, state.elementId);
      if (nextId) onNavigate({ elementId: nextId, lineId: state.lineId });
    },
    [state, navIndex, commitPendingSyllable, onNavigate],
  );

  // Move to next/previous verse on same note
  const changeVerse = useCallback(
    (direction: 1 | -1) => {
      if (!state) return;
      commitPendingSyllable();
      const currentNum = parseInt(state.lineId, 10) || 1;
      const nextNum = Math.max(1, currentNum + direction);
      onNavigate({ elementId: state.elementId, lineId: String(nextNum) });
    },
    [state, commitPendingSyllable, onNavigate],
  );

  // Keyboard handler — intercepts special keys before the input processes them
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement !== inputRef.current) return;
      const handled = handleLyricKey(e, {
        inputRef,
        commitPendingSyllable,
        onExit,
        commitAndAdvance,
        handleMelisma,
        changeVerse,
        navigateHorizontal,
      });
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [active, commitPendingSyllable, commitAndAdvance, handleMelisma, changeVerse, navigateHorizontal, onExit]);

  if (!active || !state || !position) return null;

  return createPortal(
    <div style={lyricPortalStyle(position.x, position.y)}>
      <FormInput
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        spellCheck
        style={lyricInputStyle(value)}
      />
      <div style={LYRIC_VERSE_LABEL_STYLE}>verse {state.lineId}</div>
    </div>,
    document.body,
  );
}

/**
 * Note input mode keyboard handlers.
 *
 * Handles: A-G note entry, duration keys (1-7), dot, rest, grace note,
 * arrow transposing, slur/tie toggle, backspace, and cursor movement
 * while in note input mode.
 *
 * Implementation is split across sibling modules:
 *   - `./noteInputShared` — clef/ottava resolution + optimistic-paint event
 *   - `./noteEntryHandler` — letter-key note entry (including chord/condensing paths)
 *   - `./noteInputArrows` — Up/Down arrow navigation + transposition helpers
 */

import { produce } from "../score/scoreClone";
import {
  computeEndOfContentCursor,
  moveCursorToPreviousEvent,
  moveCursorToNextMeasure,
  advanceCursorByNotatedDuration,
} from "../commands/cursorCommands";
import { backspaceInNoteInput, durationToBeats } from "../commands/noteCommands";
import { DURATION_KEY_MAP } from "../commands/noteInputCommands";
import type { KeyboardHandlerContext } from "./types";
import { resolveSeqIndex, stepAccidental } from "./noteInputShared";
import { arrowNavigateStaffPart, findTransposeTarget, applyArrowTranspose } from "./noteInputArrows";
import { handleNoteEntry } from "./noteEntryHandler";

/**
 * ArrowUp/Down in note input mode (Dorico-aligned, matches normal mode):
 * - Plain arrow: move cursor between parts/staves
 * - Alt+arrow: diatonic step transpose
 * - Alt+Shift+arrow: chromatic step transpose
 * - Ctrl/Cmd+Alt+arrow: octave transpose
 */
export function handleNoteInputArrowUpDown(e: KeyboardEvent, ctx: KeyboardHandlerContext): void {
  e.preventDefault();
  const currentScore = ctx.getScore();
  const ni = ctx.getNoteInput();
  const cursor = ni.cursorPosition;
  if (!currentScore || !cursor) return;

  if (arrowNavigateStaffPart(e, ctx, currentScore, cursor)) {
    // Plain arrow consumed for navigation (or no-op); no transpose.
    if (!e.altKey && !(e.ctrlKey || e.metaKey) && !e.shiftKey) return;
  }

  const voiceIdx = resolveSeqIndex(currentScore, ctx);
  const loc = findTransposeTarget(currentScore, ctx, cursor, voiceIdx);
  if (loc) applyArrowTranspose(e, ctx, currentScore, cursor, voiceIdx, loc);
}

const LETTER_TO_STEP: Record<string, string> = {
  a: "A",
  b: "B",
  c: "C",
  d: "D",
  e: "E",
  f: "F",
  g: "G",
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  E: "E",
  F: "F",
  G: "G",
};

type KeyHandler = (e: KeyboardEvent, ctx: KeyboardHandlerContext) => boolean;

function handleAccidentalStateKey(e: KeyboardEvent, ctx: KeyboardHandlerContext): boolean {
  const accidentalByKey = {
    "-": "flat",
    "=": "sharp",
    "\\": "natural",
    z: "double-flat",
    Z: "double-flat",
    x: "double-sharp",
    X: "double-sharp",
  } as const;
  const accidental = accidentalByKey[e.key as keyof typeof accidentalByKey];
  if (accidental && !e.shiftKey) {
    e.preventDefault();
    ctx.setAccidental(accidental);
    return true;
  }
  if (e.key !== "_" && e.key !== "+") return false;
  e.preventDefault();
  const stepped = stepAccidental(ctx.getNoteInput().currentAccidental, e.key === "+" ? 1 : -1);
  if (stepped !== null) ctx.setAccidental(stepped);
  return true;
}

/** Duration (1-9), 0=rest, period (dot), slash (grace), accidentals, S/T toggles,
 *  Shift+T (tuplet radial). Returns true if handled. */
function handleStateKey(e: KeyboardEvent, ctx: KeyboardHandlerContext): boolean {
  const dur = DURATION_KEY_MAP[e.key];
  if (dur) {
    e.preventDefault();
    ctx.setDuration(dur);
    return true;
  }
  if (e.key === "0") {
    e.preventDefault();
    ctx.toggleRest();
    return true;
  }
  if (e.key === ".") {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) ctx.incrementDot();
    else ctx.toggleDot();
    return true;
  }
  if (e.key === "/") {
    e.preventDefault();
    ctx.toggleGraceActive();
    return true;
  }
  if (handleAccidentalStateKey(e, ctx)) return true;
  if (e.key === "T" && e.shiftKey) {
    e.preventDefault();
    ctx.openRadialMenu?.("tuplet");
    return true;
  }
  if ((e.key === "s" || e.key === "S") && !e.shiftKey) {
    e.preventDefault();
    ctx.toggleSlur();
    return true;
  }
  if ((e.key === "t" || e.key === "T") && !e.shiftKey) {
    e.preventDefault();
    ctx.toggleTie();
    return true;
  }
  return false;
}

function handleBackspaceKey(e: KeyboardEvent, ctx: KeyboardHandlerContext): boolean {
  if (e.key !== "Backspace" && e.key !== "Delete") return false;
  e.preventDefault();
  const currentScore = ctx.getScore();
  if (!currentScore) return true;
  const newScore = produce(currentScore, (draft) => {
    const voice = resolveSeqIndex(currentScore, ctx);
    backspaceInNoteInput(draft, 0, voice);
  });
  if (newScore !== currentScore) {
    ctx.updateScore(newScore);
    const voice = resolveSeqIndex(currentScore, ctx);
    const newCursor = computeEndOfContentCursor(newScore, 0, voice);
    const ni = ctx.getNoteInput();
    ctx.setCursor({ ...newCursor, staffIndex: ni.cursorPosition?.staffIndex ?? 0 });
  }
  return true;
}

/** Space, Left/Right arrow, H/J cursor travel. */
function handleCursorTravel(e: KeyboardEvent, ctx: KeyboardHandlerContext): boolean {
  const ni = ctx.getNoteInput();
  const currentScore = ctx.getScore();
  const cursor = ni.cursorPosition;

  if (e.key === " ") {
    e.preventDefault();
    if (!currentScore || !cursor) return true;
    const stepBeats = durationToBeats({
      base: ni.currentDuration,
      ...(ni.dotCount > 0 ? { dots: ni.dotCount } : {}),
    });
    const voice = ni.currentVoice - 1;
    const newCursor = advanceCursorByNotatedDuration(currentScore, cursor, stepBeats, voice, 1);
    ctx.setCursor({ ...newCursor, staffIndex: cursor.staffIndex ?? 0 });
    return true;
  }

  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    if (!currentScore || !cursor) return true;
    const stepBeats = durationToBeats({
      base: ni.currentDuration,
      ...(ni.dotCount > 0 ? { dots: ni.dotCount } : {}),
    });
    const voice = ni.currentVoice - 1;
    const newCursor = advanceCursorByNotatedDuration(
      currentScore,
      cursor,
      stepBeats,
      voice,
      e.key === "ArrowLeft" ? -1 : 1,
    );
    ctx.setCursor({ ...newCursor, staffIndex: cursor.staffIndex ?? 0 });
    return true;
  }

  if ((e.key === "h" || e.key === "H" || e.key === "j" || e.key === "J") && !e.shiftKey) {
    e.preventDefault();
    if (!currentScore || !cursor) return true;
    const sequenceIndex = resolveSeqIndex(currentScore, ctx);
    const newCursor =
      e.key === "h" || e.key === "H"
        ? moveCursorToPreviousEvent(currentScore, cursor, sequenceIndex)
        : moveCursorToNextMeasure(currentScore, cursor);
    ctx.setCursor({ ...newCursor, staffIndex: cursor.staffIndex ?? 0 });
    return true;
  }
  return false;
}

function handleLetterEntry(e: KeyboardEvent, ctx: KeyboardHandlerContext): boolean {
  const step = LETTER_TO_STEP[e.key];
  if (!step) return false;
  e.preventDefault();
  const isChord = e.shiftKey || ctx.getNoteInput().chordLock;
  handleNoteEntry(step, isChord, ctx);
  return true;
}

const KEY_HANDLERS: KeyHandler[] = [handleStateKey, handleBackspaceKey, handleCursorTravel, handleLetterEntry];

/** Handle note input mode keypresses (non-arrow). */
export function handleNoteInputKey(e: KeyboardEvent, ctx: KeyboardHandlerContext): void {
  for (const handler of KEY_HANDLERS) {
    if (handler(e, ctx)) return;
  }
}

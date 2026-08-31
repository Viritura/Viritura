/**
 * Clipboard history store.
 *
 * Tracks the last `MAX_HISTORY` clipboard copies so the user can re-paste
 * from history. Previously lived in `ClipboardHistoryContext.tsx` as a
 * React Context + provider; converted to zustand to (a) eliminate provider
 * plumbing in `App.tsx`, (b) drop the react-refresh-only-components lint
 * violations, and (c) match the rest of the editor's store architecture.
 */

import { create } from "zustand";
import type { ClipboardFragment } from "../clipboard/ClipboardFragment";

const MAX_HISTORY = 20;

/**
 * Reference back to the score snapshot in HistoryContext that this clipboard
 * entry was copied from. Lets the preview render the actual surrounding
 * measures (with correct instrument names, clefs, transpositions, dynamics,
 * etc.) instead of reconstructing a synthetic score from the bare fragment.
 *
 * The snapshot is borrowed — when the underlying HistoryContext entry is
 * LRU-evicted, lookup will return undefined and the preview falls back to
 * the synthetic snippet rendering. Paste never depends on this.
 */
export interface ClipboardSourceRef {
  /** Stable id of the HistoryContext entry that was current at copy time. */
  historyId: number;
  /** Absolute part indices in the snapshot to include in the preview slice. */
  partIndices: number[];
  /** Inclusive measure index range in the snapshot. */
  startMeasure: number;
  endMeasure: number;
}

/** A single clipboard history entry. */
export interface ClipboardHistoryEntry {
  /** Unique ID for React keys */
  id: string;
  /** Timestamp when copied */
  timestamp: number;
  /** The clipboard fragment data */
  fragment: ClipboardFragment;
  /** Human-readable summary (e.g. "4 notes, 2 parts") */
  summary: string;
  /**
   * Optional reference to the historical snapshot this was copied from.
   * Used by the preview for context-aware rendering.
   */
  source?: ClipboardSourceRef;
}

interface ClipboardHistoryState {
  entries: readonly ClipboardHistoryEntry[];
  _addEntry: (fragment: ClipboardFragment, source?: ClipboardSourceRef) => void;
  _clearHistory: () => void;
}

let entryCounter = 0;

function summarizeFragment(fragment: ClipboardFragment): string {
  const noteCount = fragment.content.filter((ev) => ev.type === "event" && !ev.rest).length;
  const restCount = fragment.content.filter((ev) => ev.type === "event" && ev.rest).length;

  const trackCount = fragment.tracks?.length ?? 0;
  const parts: string[] = [];
  if (noteCount > 0) parts.push(`${noteCount} note${noteCount !== 1 ? "s" : ""}`);
  if (restCount > 0) parts.push(`${restCount} rest${restCount !== 1 ? "s" : ""}`);
  if (trackCount > 1) parts.push(`${trackCount} staves`);
  return parts.join(", ") || "empty";
}

export const useClipboardHistoryStore = create<ClipboardHistoryState>()((set) => ({
  entries: [],
  _addEntry: (fragment, source) => {
    entryCounter++;
    const entry: ClipboardHistoryEntry = {
      id: `clip-${Date.now()}-${entryCounter}`,
      timestamp: Date.now(),
      fragment: structuredClone(fragment),
      summary: summarizeFragment(fragment),
      ...(source ? { source: { ...source, partIndices: [...source.partIndices] } } : {}),
    };
    set((state) => ({ entries: [entry, ...state.entries].slice(0, MAX_HISTORY) }));
  },
  _clearHistory: () => set({ entries: [] }),
}));

/** Module-level setters so consumers don't need them in hook dep arrays. */
export const addClipboardEntry = (fragment: ClipboardFragment, source?: ClipboardSourceRef): void =>
  useClipboardHistoryStore.getState()._addEntry(fragment, source);

export const clearClipboardHistory = (): void => useClipboardHistoryStore.getState()._clearHistory();

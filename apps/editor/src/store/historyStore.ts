import { createContext, useContext } from "react";
import { createStore } from "zustand";
import { useStore } from "zustand";
import type { CursorPosition } from "./noteInputStore";
import { synthesizeCommitMessage } from "../git/commitMessage";

/** Maximum number of history entries to retain. */
const MAX_HISTORY = 100;

/**
 * Module-level monotonically increasing counter for stable HistoryEntry IDs.
 * Used so external systems (e.g. clipboard fragments) can pin a reference to
 * a specific historical snapshot that survives LRU eviction-driven index
 * reshuffling. IDs are never reused even across reset().
 */
let _historyEntryIdCounter = 0;
function nextHistoryEntryId(): number {
  return ++_historyEntryIdCounter;
}

/** A single snapshot in the undo/redo history. */
interface HistoryEntry {
  /**
   * Stable, monotonic ID. Survives LRU eviction (the entry itself goes away
   * when popped, but the ID is never reused). Use this to pin references
   * from outside the history (e.g. clipboard entry → source snapshot).
   */
  id: number;
  /** Wall-clock time when the edit was recorded. */
  timestamp: number;
  mnxJson: string;
  /**
   * Human-readable description of what changed (vs the previous entry).
   * Computed lazily — populated either eagerly for the most recent entry
   * (during pushState) or on-demand by the Clips tab.
   */
  description: string;
  /**
   * MNX of the entry immediately before this one. Used as the "before" side
   * when computing a description via semanticDiff. Undefined for the initial
   * entry (no diff possible). Strings are deduped — entry N's mnxJson IS
   * entry N+1's prevMnxJson, so we hold no extra memory.
   */
  prevMnxJson?: string;
  /** True once `description` has been replaced with a synthesized value. */
  descriptionResolved?: boolean;
  /** Cursor immediately before this entry's edit. */
  cursorBefore?: CursorPosition | null;
  /** Cursor immediately after this entry's edit. */
  cursorAfter?: CursorPosition | null;
}

/**
 * Skip semanticDiff for documents above this size — cost grows roughly with
 * the parsed JSON's element count and we don't want to block on big pastes.
 * The placeholder "Edit" text is shown instead; this is only for the Clips
 * tab description, never for correctness.
 */
const MAX_DIFF_INPUT_CHARS = 250_000;

/**
 * Synchronously compute a human-readable description for an entry by diffing
 * against its previous MNX. Mutates the entry (sets `description` and
 * `descriptionResolved`). No-op if already resolved or if no prevMnxJson.
 *
 * Bails out with the placeholder description for very large MNX strings to
 * keep the eager-resolution microtask cheap — large multi-measure pastes
 * would otherwise block the main thread for hundreds of milliseconds.
 */
function resolveEntryDescription(entry: HistoryEntry): void {
  if (entry.descriptionResolved) return;
  if (!entry.prevMnxJson) {
    entry.descriptionResolved = true;
    return;
  }
  if (entry.mnxJson.length > MAX_DIFF_INPUT_CHARS || entry.prevMnxJson.length > MAX_DIFF_INPUT_CHARS) {
    if (entry.description === "Edit") entry.description = "Large score edit";
    entry.descriptionResolved = true;
    return;
  }
  try {
    const synth = synthesizeCommitMessage(entry.prevMnxJson, entry.mnxJson);
    if (!synth.empty && synth.subject) {
      entry.description = synth.subject;
    }
  } catch {
    // Keep the placeholder description on failure.
  }
  entry.descriptionResolved = true;
}

interface HistoryState {
  /** All history entries (index 0 = oldest). */
  entries: HistoryEntry[];
  /** Points to the current (active) entry in the stack. -1 when empty. */
  currentIndex: number;
}

interface HistoryActions {
  pushState: (
    mnxJson: string,
    description: string,
    cursorBefore?: CursorPosition | null,
    cursorAfter?: CursorPosition | null,
  ) => void;
  undo: () => string | undefined;
  redo: () => string | undefined;
  /** Jump directly to a specific history index (Photoshop-style). */
  jumpTo: (index: number) => string | undefined;
  /** Resolve descriptions for all entries whose description is still pending. */
  preloadDescriptions: () => void;
  /** Force-resolve a single entry's description (used on render). */
  resolveDescription: (index: number) => void;
  reset: (mnxJson: string) => void;
}

interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | undefined;
  redoDescription: string | undefined;
  currentMnxJson: string | undefined;
  /** Stable id of the entry at currentIndex, or undefined when empty. */
  currentEntryId: number | undefined;
  historySize: number;
}

// --- Reducer (kept for unit tests) ---

/** @internal Exported for testing. */
export type HistoryAction =
  | { type: "push"; mnxJson: string; description: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; mnxJson: string };

/** @internal Exported for testing. */
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "push": {
      const trimmed = state.entries.slice(0, state.currentIndex + 1);
      trimmed.push({
        id: nextHistoryEntryId(),
        timestamp: Date.now(),
        mnxJson: action.mnxJson,
        description: action.description,
      });
      const overflow = trimmed.length - MAX_HISTORY;
      const entries = overflow > 0 ? trimmed.slice(overflow) : trimmed;
      const currentIndex = entries.length - 1;
      return { entries, currentIndex };
    }
    case "undo": {
      if (state.currentIndex <= 0) return state;
      return { ...state, currentIndex: state.currentIndex - 1 };
    }
    case "redo": {
      if (state.currentIndex >= state.entries.length - 1) return state;
      return { ...state, currentIndex: state.currentIndex + 1 };
    }
    case "reset": {
      return {
        entries: [
          { id: nextHistoryEntryId(), timestamp: Date.now(), mnxJson: action.mnxJson, description: "Initial state" },
        ],
        currentIndex: 0,
      };
    }
  }
}

// --- Zustand store ---

export interface HistoryStoreState extends HistoryInfo, HistoryActions {
  entries: HistoryEntry[];
  currentIndex: number;
}

function computeDerived(entries: HistoryEntry[], currentIndex: number): HistoryInfo {
  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < entries.length - 1;
  return {
    canUndo,
    canRedo,
    undoDescription: canUndo ? entries[currentIndex]?.description : undefined,
    redoDescription: canRedo ? entries[currentIndex + 1]?.description : undefined,
    currentMnxJson: entries[currentIndex]?.mnxJson,
    currentEntryId: entries[currentIndex]?.id,
    historySize: entries.length,
  };
}

export type HistoryStore = ReturnType<typeof createHistoryStore>;

export function createHistoryStore(
  initialMnxJson: string | undefined,
  onRestoreRef: { current: ((mnxJson: string, cursorPosition?: CursorPosition | null) => void) | undefined },
) {
  const initialEntries: HistoryEntry[] =
    initialMnxJson !== undefined
      ? [
          {
            id: nextHistoryEntryId(),
            timestamp: Date.now(),
            mnxJson: initialMnxJson,
            description: "Initial state",
            descriptionResolved: true,
          },
        ]
      : [];
  const initialIndex = initialEntries.length > 0 ? 0 : -1;

  return createStore<HistoryStoreState>((set, get) => ({
    entries: initialEntries,
    currentIndex: initialIndex,
    ...computeDerived(initialEntries, initialIndex),

    pushState: (
      mnxJson: string,
      description: string,
      cursorBefore?: CursorPosition | null,
      cursorAfter?: CursorPosition | null,
    ) => {
      const { entries, currentIndex } = get();
      const trimmed = entries.slice(0, currentIndex + 1);
      const prevEntry = trimmed[trimmed.length - 1];
      const newEntry: HistoryEntry = {
        id: nextHistoryEntryId(),
        timestamp: Date.now(),
        mnxJson,
        description,
        cursorBefore,
        cursorAfter,
        ...(prevEntry ? { prevMnxJson: prevEntry.mnxJson } : {}),
      };
      // Eagerly compute the description for the freshly-pushed entry in a
      // microtask, so menu labels like "Undo: Edit pitch C4 → D4" stay
      // accurate without blocking the dispatch.
      if (newEntry.prevMnxJson) {
        queueMicrotask(() => {
          if (newEntry.descriptionResolved) return;
          resolveEntryDescription(newEntry);
          // Bump entries reference so subscribers (selectors keyed on
          // `entries`) re-render. We mutated newEntry in place; this clones
          // the array but keeps entry object identities.
          const cur = get();
          if (cur.entries[cur.entries.length - 1] === newEntry) {
            const nextEntries = cur.entries.slice();
            set({ entries: nextEntries, ...computeDerived(nextEntries, cur.currentIndex) });
          }
        });
      } else {
        newEntry.descriptionResolved = true;
      }
      trimmed.push(newEntry);
      const overflow = trimmed.length - MAX_HISTORY;
      const newEntries = overflow > 0 ? trimmed.slice(overflow) : trimmed;
      const newIndex = newEntries.length - 1;
      set({ entries: newEntries, currentIndex: newIndex, ...computeDerived(newEntries, newIndex) });
    },

    undo: () => {
      const { entries, currentIndex } = get();
      if (currentIndex <= 0) return undefined;
      const restored = entries[currentIndex - 1];
      if (!restored) return undefined;
      const cursorToRestore = entries[currentIndex]?.cursorBefore ?? restored.cursorAfter;
      const newIndex = currentIndex - 1;
      set({ currentIndex: newIndex, ...computeDerived(entries, newIndex) });
      onRestoreRef.current?.(restored.mnxJson, cursorToRestore);
      return restored.mnxJson;
    },

    redo: () => {
      const { entries, currentIndex } = get();
      if (currentIndex >= entries.length - 1) return undefined;
      const restored = entries[currentIndex + 1];
      if (!restored) return undefined;
      const newIndex = currentIndex + 1;
      set({ currentIndex: newIndex, ...computeDerived(entries, newIndex) });
      onRestoreRef.current?.(restored.mnxJson, restored.cursorAfter ?? restored.cursorBefore);
      return restored.mnxJson;
    },

    jumpTo: (index: number) => {
      const { entries, currentIndex } = get();
      if (index < 0 || index >= entries.length) return undefined;
      if (index === currentIndex) return undefined;
      const restored = entries[index];
      if (!restored) return undefined;
      set({ currentIndex: index, ...computeDerived(entries, index) });
      onRestoreRef.current?.(restored.mnxJson, restored.cursorAfter ?? restored.cursorBefore);
      return restored.mnxJson;
    },

    preloadDescriptions: () => {
      const { entries, currentIndex } = get();
      let mutated = false;
      for (const entry of entries) {
        if (!entry.descriptionResolved) {
          resolveEntryDescription(entry);
          mutated = true;
        }
      }
      if (mutated) {
        // Bump entries reference so selectors re-render.
        const nextEntries = entries.slice();
        set({ entries: nextEntries, ...computeDerived(nextEntries, currentIndex) });
      }
    },

    resolveDescription: (index: number) => {
      const { entries, currentIndex } = get();
      const entry = entries[index];
      if (!entry || entry.descriptionResolved) return;
      resolveEntryDescription(entry);
      const nextEntries = entries.slice();
      set({ entries: nextEntries, ...computeDerived(nextEntries, currentIndex) });
    },

    reset: (mnxJson: string) => {
      const newEntries: HistoryEntry[] = [
        {
          id: nextHistoryEntryId(),
          timestamp: Date.now(),
          mnxJson,
          description: "Initial state",
          descriptionResolved: true,
        },
      ];
      set({ entries: newEntries, currentIndex: 0, ...computeDerived(newEntries, 0) });
    },
  }));
}

// --- Context (carries the Zustand store instance) ---

export const HistoryStoreContext = createContext<HistoryStore | null>(null);

// --- Hooks ---

/**
 * Access a specific slice of the history store via selector.
 * Components only re-render when the selected value changes.
 */
export function useHistoryStore<T>(selector: (state: HistoryStoreState) => T): T {
  const store = useContext(HistoryStoreContext);
  if (!store) {
    throw new Error("useHistoryStore must be used within a HistoryProvider");
  }
  return useStore(store, selector);
}

/**
 * Get the raw Zustand store so callers can read state non-reactively via
 * `store.getState()` (e.g. inside event handlers that should NOT re-render
 * on every history push).
 */
export function useHistoryStoreInstance(): HistoryStore {
  const store = useContext(HistoryStoreContext);
  if (!store) {
    throw new Error("useHistoryStoreInstance must be used within a HistoryProvider");
  }
  return store;
}

/**
 * Look up a history entry's mnxJson by its stable id. Returns undefined if
 * the entry has been LRU-evicted (or never existed). Subscribers re-render
 * only when the matching entry's mnxJson changes (or the entry's lookup
 * result transitions present ↔ absent).
 */
export function useHistoryEntryMnxJsonById(id: number | undefined): string | undefined {
  return useHistoryStore((s) => {
    if (id === undefined) return undefined;
    return s.entries.find((e) => e.id === id)?.mnxJson;
  });
}

export { MAX_HISTORY };
export type { HistoryEntry, HistoryState, HistoryInfo };

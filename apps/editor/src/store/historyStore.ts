import { createContext, useContext, useMemo } from "react";
import { createStore } from "zustand";
import { useStore } from "zustand";
import type { CursorPosition } from "./noteInputStore";
import { synthesizeCommitMessage } from "../git/commitMessage";
import { PieceText, applyTextEdit, diffText, revertTextEdit, type TextEdit } from "./historyTextEdit";

/**
 * Maximum number of history entries to retain. Only the current entry holds a
 * full MNX string; every other entry stores a reversible text edit relative
 * to its predecessor, so retained memory grows with the size of the edits
 * rather than with the size of the score.
 */
const MAX_HISTORY = 256;

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

/**
 * A single step in the undo/redo history. The MNX content is not stored on
 * the entry; read it through `getEntryMnxJson` / `getEntryMnxJsonById`.
 */
interface HistoryEntry {
  /**
   * Stable, monotonic ID. Survives LRU eviction (the entry itself goes away
   * when popped, but the ID is never reused). Use this to pin references
   * from outside the history (e.g. clipboard entry → source snapshot).
   */
  id: number;
  /** Wall-clock time when the edit was recorded. */
  timestamp: number;
  /**
   * Human-readable description of what changed (vs the previous entry).
   * Computed lazily — populated either eagerly for the most recent entry
   * (during pushState) or on-demand by the Clips tab.
   */
  description: string;
  /** True once `description` has been replaced with a synthesized value. */
  descriptionResolved?: boolean;
  /** Cursor immediately before this entry's edit. */
  cursorBefore?: CursorPosition | null;
  /** Cursor immediately after this entry's edit. */
  cursorAfter?: CursorPosition | null;
}

/** Private per-entry content storage. */
interface EntryContent {
  /** Length of this entry's MNX string (lets size guards skip reconstruction). */
  length: number;
  /** Reversible edit from the previous entry. Absent for the oldest entry. */
  edit?: TextEdit;
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
 * `descriptionResolved`). `readTexts` is only invoked when a diff will
 * actually run, so oversized documents are never reconstructed.
 */
function resolveEntryDescription(
  entry: HistoryEntry,
  beforeLength: number | undefined,
  afterLength: number,
  readTexts: () => { before: string; after: string } | undefined,
): void {
  if (entry.descriptionResolved) return;
  if (beforeLength === undefined) {
    entry.descriptionResolved = true;
    return;
  }
  if (afterLength > MAX_DIFF_INPUT_CHARS || beforeLength > MAX_DIFF_INPUT_CHARS) {
    if (entry.description === "Edit") entry.description = "Large score edit";
    entry.descriptionResolved = true;
    return;
  }
  try {
    const texts = readTexts();
    if (texts) {
      const synth = synthesizeCommitMessage(texts.before, texts.after);
      if (!synth.empty && synth.subject) {
        entry.description = synth.subject;
      }
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
  /** Reconstruct the MNX for the entry at `index`. */
  getEntryMnxJson: (index: number) => string | undefined;
  /** Reconstruct the MNX for the entry with stable `id`; undefined once evicted. */
  getEntryMnxJsonById: (id: number) => string | undefined;
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
  /** Full MNX of the current entry — the anchor every other entry is rebuilt from. */
  currentMnxJson: string | undefined;
  /** Stable id of the entry at currentIndex, or undefined when empty. */
  currentEntryId: number | undefined;
  historySize: number;
}

// --- Zustand store ---

export interface HistoryStoreState extends HistoryInfo, HistoryActions, HistoryState {}

function computeDerived(
  entries: HistoryEntry[],
  currentIndex: number,
  currentMnxJson: string | undefined,
): HistoryInfo {
  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < entries.length - 1;
  return {
    canUndo,
    canRedo,
    undoDescription: canUndo ? entries[currentIndex]?.description : undefined,
    redoDescription: canRedo ? entries[currentIndex + 1]?.description : undefined,
    currentMnxJson: entries.length > 0 ? currentMnxJson : undefined,
    currentEntryId: entries[currentIndex]?.id,
    historySize: entries.length,
  };
}

export type HistoryStore = ReturnType<typeof createHistoryStore>;

export function createHistoryStore(
  initialMnxJson: string | undefined,
  onRestoreRef: { current: ((mnxJson: string, cursorPosition?: CursorPosition | null) => void) | undefined },
) {
  const contents = new WeakMap<HistoryEntry, EntryContent>();

  const createInitialEntry = (mnxJson: string): HistoryEntry => {
    const entry: HistoryEntry = {
      id: nextHistoryEntryId(),
      timestamp: Date.now(),
      description: "Initial state",
      descriptionResolved: true,
    };
    contents.set(entry, { length: mnxJson.length });
    return entry;
  };

  const editOf = (entry: HistoryEntry | undefined): TextEdit => {
    const edit = entry ? contents.get(entry)?.edit : undefined;
    if (!edit) throw new Error("History entry is missing its text edit");
    return edit;
  };

  const initialEntries: HistoryEntry[] = initialMnxJson !== undefined ? [createInitialEntry(initialMnxJson)] : [];
  const initialIndex = initialEntries.length > 0 ? 0 : -1;

  return createStore<HistoryStoreState>((set, get) => {
    /**
     * Rebuild an entry's MNX by replaying edits outward from the current
     * entry. Cost is proportional to the distance from the current entry;
     * the document itself is copied once.
     */
    const materialize = (target: number): string | undefined => {
      const { entries, currentIndex, currentMnxJson } = get();
      if (currentMnxJson === undefined || target < 0 || target >= entries.length) return undefined;
      if (target === currentIndex) return currentMnxJson;
      const text = new PieceText(currentMnxJson);
      if (target < currentIndex) {
        for (let i = currentIndex; i > target; i--) text.revert(editOf(entries[i]));
      } else {
        for (let i = currentIndex + 1; i <= target; i++) text.apply(editOf(entries[i]));
      }
      return text.toString();
    };

    /** Move the current pointer and notify the editor with the restored document. */
    const restore = (index: number, cursor: CursorPosition | null | undefined): string | undefined => {
      const restored = materialize(index);
      if (restored === undefined) return undefined;
      const { entries } = get();
      set({ currentIndex: index, ...computeDerived(entries, index, restored) });
      onRestoreRef.current?.(restored, cursor);
      return restored;
    };

    const lengthOf = (entry: HistoryEntry | undefined): number | undefined =>
      entry ? contents.get(entry)?.length : undefined;

    /** Previous-entry length, or undefined when no diff is possible. */
    const beforeLengthOf = (entries: HistoryEntry[], index: number): number | undefined => {
      const entry = entries[index];
      if (!entry || index === 0 || !contents.get(entry)?.edit) return undefined;
      return lengthOf(entries[index - 1]);
    };

    return {
      entries: initialEntries,
      currentIndex: initialIndex,
      ...computeDerived(initialEntries, initialIndex, initialMnxJson),

      pushState: (
        mnxJson: string,
        description: string,
        cursorBefore?: CursorPosition | null,
        cursorAfter?: CursorPosition | null,
      ) => {
        const { entries, currentIndex, currentMnxJson: previousMnxJson } = get();
        const trimmed = entries.slice(0, currentIndex + 1);
        const newEntry: HistoryEntry = {
          id: nextHistoryEntryId(),
          timestamp: Date.now(),
          description,
          cursorBefore,
          cursorAfter,
        };
        if (trimmed.length > 0 && previousMnxJson !== undefined) {
          contents.set(newEntry, { length: mnxJson.length, edit: diffText(previousMnxJson, mnxJson) });
          // Eagerly compute the description for the freshly-pushed entry in a
          // microtask, so menu labels like "Undo: Edit pitch C4 → D4" stay
          // accurate without blocking the dispatch. Both texts are in hand
          // here, so no reconstruction is needed.
          queueMicrotask(() => {
            if (newEntry.descriptionResolved) return;
            resolveEntryDescription(newEntry, previousMnxJson.length, mnxJson.length, () => ({
              before: previousMnxJson,
              after: mnxJson,
            }));
            // Bump entries reference so subscribers (selectors keyed on
            // `entries`) re-render. We mutated newEntry in place; this clones
            // the array but keeps entry object identities.
            const cur = get();
            if (cur.entries[cur.entries.length - 1] === newEntry) {
              const nextEntries = cur.entries.slice();
              set({ entries: nextEntries, ...computeDerived(nextEntries, cur.currentIndex, cur.currentMnxJson) });
            }
          });
        } else {
          contents.set(newEntry, { length: mnxJson.length });
          newEntry.descriptionResolved = true;
        }
        trimmed.push(newEntry);
        const overflow = trimmed.length - MAX_HISTORY;
        const newEntries = overflow > 0 ? trimmed.slice(overflow) : trimmed;
        const oldest = newEntries[0];
        const oldestContent = oldest ? contents.get(oldest) : undefined;
        // The oldest entry is never reverted past, so its edit is dead weight.
        if (overflow > 0 && oldestContent) delete oldestContent.edit;
        const newIndex = newEntries.length - 1;
        set({ entries: newEntries, currentIndex: newIndex, ...computeDerived(newEntries, newIndex, mnxJson) });
      },

      undo: () => {
        const { entries, currentIndex } = get();
        if (currentIndex <= 0) return undefined;
        return restore(currentIndex - 1, entries[currentIndex]?.cursorBefore ?? entries[currentIndex - 1]?.cursorAfter);
      },

      redo: () => {
        const { entries, currentIndex } = get();
        if (currentIndex >= entries.length - 1) return undefined;
        const target = entries[currentIndex + 1];
        return restore(currentIndex + 1, target?.cursorAfter ?? target?.cursorBefore);
      },

      jumpTo: (index: number) => {
        const { entries, currentIndex } = get();
        if (index < 0 || index >= entries.length || index === currentIndex) return undefined;
        const target = entries[index];
        return restore(index, target?.cursorAfter ?? target?.cursorBefore);
      },

      getEntryMnxJson: (index: number) => materialize(index),

      getEntryMnxJsonById: (id: number) => {
        const index = get().entries.findIndex((entry) => entry.id === id);
        return index < 0 ? undefined : materialize(index);
      },

      preloadDescriptions: () => {
        const { entries, currentIndex, currentMnxJson } = get();
        let mutated = false;
        // Sweep oldest → newest, carrying the previous entry's text forward
        // so each step costs one edit instead of a full reconstruction.
        let carried: { index: number; text: string } | undefined;
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index];
          if (!entry || entry.descriptionResolved) continue;
          const afterLength = lengthOf(entry) ?? 0;
          resolveEntryDescription(entry, beforeLengthOf(entries, index), afterLength, () => {
            const edit = editOf(entry);
            let before: string | undefined;
            let after: string | undefined;
            if (carried?.index === index - 1) {
              before = carried.text;
              after = applyTextEdit(before, edit);
            } else {
              after = materialize(index);
              if (after !== undefined) before = revertTextEdit(after, edit);
            }
            if (after === undefined || before === undefined) return undefined;
            carried = { index, text: after };
            return { before, after };
          });
          mutated = true;
        }
        if (mutated) {
          // Bump entries reference so selectors re-render.
          const nextEntries = entries.slice();
          set({ entries: nextEntries, ...computeDerived(nextEntries, currentIndex, currentMnxJson) });
        }
      },

      resolveDescription: (index: number) => {
        const { entries, currentIndex, currentMnxJson } = get();
        const entry = entries[index];
        if (!entry || entry.descriptionResolved) return;
        resolveEntryDescription(entry, beforeLengthOf(entries, index), lengthOf(entry) ?? 0, () => {
          const after = materialize(index);
          return after === undefined ? undefined : { before: revertTextEdit(after, editOf(entry)), after };
        });
        const nextEntries = entries.slice();
        set({ entries: nextEntries, ...computeDerived(nextEntries, currentIndex, currentMnxJson) });
      },

      reset: (mnxJson: string) => {
        const newEntries: HistoryEntry[] = [createInitialEntry(mnxJson)];
        set({ entries: newEntries, currentIndex: 0, ...computeDerived(newEntries, 0, mnxJson) });
      },
    };
  });
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
 * the entry has been LRU-evicted (or never existed). An entry's content is
 * immutable for its id, so the reconstruction runs only when the id changes
 * or the entry transitions present ↔ absent.
 */
export function useHistoryEntryMnxJsonById(id: number | undefined): string | undefined {
  const store = useHistoryStoreInstance();
  const present = useHistoryStore((s) => id !== undefined && s.entries.some((e) => e.id === id));
  return useMemo(
    () => (present && id !== undefined ? store.getState().getEntryMnxJsonById(id) : undefined),
    [store, id, present],
  );
}

export { MAX_HISTORY };
export type { HistoryEntry, HistoryInfo };

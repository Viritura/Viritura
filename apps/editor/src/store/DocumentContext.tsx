/* eslint-disable react-refresh/only-export-components --
 * This file intentionally colocates the DocumentProvider component with
 * `useDocument*` hooks, the DocumentStoreContext object, and re-exported
 * types. That's the canonical React Context module shape — splitting it
 * would force ~20 consumer imports to fork without architectural benefit.
 * Fast Refresh for descendants of <DocumentProvider> requires a full
 * remount anyway when the document store schema changes. */
/**
 * DocumentContext — React integration for the Zustand document store.
 *
 * Provides backward-compatible hooks (useDocument, useDocumentActions) plus
 * the new useDocumentStore(selector) for fine-grained subscriptions that
 * prevent unnecessary re-renders.
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createDocumentStore, type DocumentStore, type DocumentStoreState } from "./documentStore";
import type { Score, ScorePatch } from "@viritura/core";
import type { MeasureBeatInfo } from "../commands/measureValidation";

// ═══════════════════════════════════════════
// Types (re-exported for backward compat)
// ═══════════════════════════════════════════

/** Read-only document state. */
export interface DocumentState {
  /** The parsed Score model (null when no score is loaded). */
  score: Score | null;
  /** MNX JSON string for WASM consumption (empty when no score). */
  mnxJson: string;
  /** True when the score has been modified since last save/load. */
  dirty: boolean;
  /** Display name of the currently loaded file. */
  fileName: string;
  /** Stable across edits; increments when a different document is loaded. */
  documentGeneration: number;
  /** Measures with incorrect beat counts (empty = all valid). */
  beatCountIssues: MeasureBeatInfo[];
}

/** Actions to mutate the document. */
export interface DocumentActions {
  /** Load a score from a URL (fetch → parse → store). */
  loadScoreFromUrl: (url: string) => Promise<void>;
  /** Load a pre-parsed Score model directly. */
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  /** Replace the current Score (marks dirty, auto-serializes MNX). */
  updateScore: (score: Score, affectedMeasures?: { start: number; end: number }) => void;
  /**
   * Fast-path edit dispatch. Apply `patches` via the Immer interpreter and
   * forward them to the live-mode bridge so it can use the schema-aware
   * `applyPatches` Y.Doc adapter instead of the schema-blind full-tree
   * walk. Falls back to the slow path automatically if the patches don't
   * resolve on the peer's side (see `MnxYjsBridge.applyPatches`).
   * No-op when `patches` is empty.
   */
  commitPatches: (patches: readonly ScorePatch[], affectedMeasures?: { start: number; end: number }) => void;
  /** Reset to an empty state. */
  newScore: () => void;
  /** Repair all measure beat count issues (user-initiated). */
  repairMeasures: () => void;
  /** Dismiss beat count warnings without repairing. */
  dismissBeatCountWarnings: () => void;
}

// ═══════════════════════════════════════════
// Context (carries the Zustand store instance)
// ═══════════════════════════════════════════

const DocumentStoreContext = createContext<DocumentStore | null>(null);

// ═══════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════

interface DocumentProviderProps {
  children: ReactNode;
}

export function DocumentProvider({ children }: DocumentProviderProps) {
  // Lazy-init the Zustand store exactly once per provider instance. React
  // guarantees the initializer is called only on the first render, and the
  // returned reference is stable across re-renders.
  const [store] = useState(createDocumentStore);

  return <DocumentStoreContext.Provider value={store}>{children}</DocumentStoreContext.Provider>;
}

// ═══════════════════════════════════════════
// Hooks
// ═══════════════════════════════════════════

/**
 * Access the document store with a selector for fine-grained subscriptions.
 * Components only re-render when the selected value changes (shallow equality).
 *
 * @example
 * // Only re-renders when mnxJson changes:
 * const mnxJson = useDocumentStore(s => s.mnxJson);
 *
 * // Only re-renders when dirty flag changes:
 * const dirty = useDocumentStore(s => s.dirty);
 *
 * // Get updateScore without subscribing to state at all:
 * const updateScore = useDocumentStore(s => s.updateScore);
 */
export function useDocumentStore<T>(selector: (state: DocumentStoreState) => T): T {
  const store = useContext(DocumentStoreContext);
  if (!store) {
    throw new Error("useDocumentStore must be used within a DocumentProvider");
  }
  return useStore(store, selector);
}

/**
 * Get the raw Zustand store for imperative access (getState/subscribe).
 * Use this when you need the current score in a callback without subscribing.
 */
export function useDocumentStoreApi(): DocumentStore {
  const store = useContext(DocumentStoreContext);
  if (!store) {
    throw new Error("useDocumentStoreApi must be used within a DocumentProvider");
  }
  return store;
}

// ── Backward-compatible hooks ──

/** Read-only access to the current document state (backward compat).
 *  NOTE: This subscribes to ALL state fields — prefer useDocumentStore(selector) for perf. */
export function useDocument(): DocumentState {
  const store = useContext(DocumentStoreContext);
  if (!store) {
    throw new Error("useDocument must be used within a DocumentProvider");
  }
  return useStore(
    store,
    useShallow((s: DocumentStoreState) => ({
      score: s.score,
      mnxJson: s.mnxJson,
      dirty: s.dirty,
      fileName: s.fileName,
      documentGeneration: s.documentGeneration,
      beatCountIssues: s.beatCountIssues,
    })),
  );
}

/** Access document mutation actions (backward compat).
 *  Actions are referentially stable — this hook never triggers re-renders. */
export function useDocumentActions(): DocumentActions {
  const store = useContext(DocumentStoreContext);
  if (!store) {
    throw new Error("useDocumentActions must be used within a DocumentProvider");
  }
  return useStore(
    store,
    useShallow((s: DocumentStoreState) => ({
      loadScoreFromUrl: s.loadScoreFromUrl,
      loadScore: s.loadScore,
      updateScore: s.updateScore,
      commitPatches: s.commitPatches,
      newScore: s.newScore,
      repairMeasures: s.repairMeasures,
      dismissBeatCountWarnings: s.dismissBeatCountWarnings,
    })),
  );
}

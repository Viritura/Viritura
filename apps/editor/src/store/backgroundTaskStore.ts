/**
 * Background-task store.
 *
 * Tracks long-running background work (MusicXML import, full-score layout off
 * the main thread, etc.) so the UI can surface a VS Code-style progress
 * notification while it runs. Tasks are registered with a human-readable label
 * and removed when the work finishes; a separate toaster component watches this
 * store and only shows a toast once a task has been active past a short delay,
 * so quick operations never flash a notification.
 */

import { create } from "zustand";

interface BackgroundTask {
  /** Stable id for the lifetime of the task. */
  id: string;
  /** Human-readable label shown in the progress toast. */
  label: string;
}
interface BackgroundTaskState {
  tasks: BackgroundTask[];
}

interface BackgroundTaskActions {
  /** Register a task and return its id. */
  beginTask: (label: string) => string;
  /** Update a task's label in place (e.g. to reflect progress). No-op if gone. */
  updateTask: (id: string, label: string) => void;
  /** Remove a previously-registered task. */
  endTask: (id: string) => void;
}

type BackgroundTaskStore = BackgroundTaskState & BackgroundTaskActions;

let seq = 0;

export const useBackgroundTaskStore = create<BackgroundTaskStore>((set) => ({
  tasks: [],
  beginTask: (label) => {
    seq += 1;
    const id = `bgtask-${seq}`;
    set((s) => ({ tasks: [...s.tasks, { id, label }] }));
    return id;
  },
  updateTask: (id, label) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, label } : t)) })),
  endTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
}));

/** Module-level helpers — stable references usable outside React. */
export const beginBackgroundTask = (label: string): string => useBackgroundTaskStore.getState().beginTask(label);
export const updateBackgroundTask = (id: string, label: string): void =>
  useBackgroundTaskStore.getState().updateTask(id, label);
export const endBackgroundTask = (id: string): void => useBackgroundTaskStore.getState().endTask(id);

/**
 * Run `fn` as a tracked background task. The task is registered before `fn`
 * starts and removed when it settles (success or failure), so the progress
 * toast is tied to the work's actual lifetime.
 */
export async function runBackgroundTask<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const id = beginBackgroundTask(label);
  try {
    return await fn();
  } finally {
    endBackgroundTask(id);
  }
}

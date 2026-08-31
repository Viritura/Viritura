import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useBackgroundTaskStore } from "../store/backgroundTaskStore";

/**
 * Delay before a background task surfaces a progress toast. Mirrors VS Code's
 * behaviour: trivial work that finishes quickly never flashes a notification;
 * only work that runs past this threshold shows the spinner.
 */
const TOAST_DELAY_MS = 500;

interface TrackedTask {
  /** Pending "show toast" timer, or null once it has fired. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Whether the loading toast is currently visible. */
  shown: boolean;
  /** Label currently rendered in the toast, so we only refresh on real changes. */
  label: string;
}

/**
 * Watches the background-task store and renders VS Code-style progress toasts
 * via sonner. A task only produces a toast if it stays active longer than
 * {@link TOAST_DELAY_MS}; the toast is dismissed as soon as the task finishes,
 * and its text is refreshed in place whenever the task's label changes (so a
 * task can report live progress, e.g. "Loading Opus (3/11)").
 * Renders nothing.
 */
export function BackgroundTaskToaster(): null {
  const tasks = useBackgroundTaskStore((s) => s.tasks);
  const trackedRef = useRef<Map<string, TrackedTask>>(new Map());

  useEffect(() => {
    const tracked = trackedRef.current;
    const active = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      const entry = tracked.get(task.id);
      if (!entry) {
        // Newly-registered task: schedule a delayed toast showing its label.
        const created: TrackedTask = { timer: null, shown: false, label: task.label };
        created.timer = setTimeout(() => {
          toast.loading(created.label, { id: task.id });
          created.timer = null;
          created.shown = true;
        }, TOAST_DELAY_MS);
        tracked.set(task.id, created);
      } else if (task.label !== entry.label) {
        // Label changed: keep the pending/visible toast in sync with progress.
        entry.label = task.label;
        if (entry.shown) toast.loading(task.label, { id: task.id });
      }
    }

    // Retire tasks that have finished: cancel pending timer and/or dismiss.
    for (const [id, entry] of tracked) {
      if (active.has(id)) continue;
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.shown) toast.dismiss(id);
      tracked.delete(id);
    }
  }, [tasks]);

  // Clean up any outstanding timers/toasts on unmount.
  useEffect(() => {
    const tracked = trackedRef.current;
    return () => {
      for (const [id, entry] of tracked) {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.shown) toast.dismiss(id);
      }
      tracked.clear();
    };
  }, []);

  return null;
}

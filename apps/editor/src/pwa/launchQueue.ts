import { toast } from "sonner";

interface FileLaunchParams {
  files: FileSystemFileHandle[];
}

interface FileLaunchWindow extends Window {
  launchQueue?: { setConsumer: (consumer: (params: FileLaunchParams) => void) => void };
}

type LaunchConsumer = (files: FileSystemFileHandle[]) => Promise<void>;

const pending: FileSystemFileHandle[][] = [];
let consumer: LaunchConsumer | undefined;
let registered = false;
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (consumer && pending.length > 0) {
      const files = pending.shift();
      if (!files) break;
      try {
        await consumer(files);
      } catch (error) {
        console.error("OS file launch failed:", error);
        toast.error("Could not open the document from Windows");
      }
    }
  } finally {
    draining = false;
  }
}

export function subscribeFileLaunch(handler: LaunchConsumer): () => void {
  const queue = (window as FileLaunchWindow).launchQueue;
  if (!queue) return () => {};
  consumer = handler;
  if (!registered) {
    queue.setConsumer(({ files }) => {
      pending.push(files);
      queueMicrotask(() => void drain());
    });
    registered = true;
  }
  // Keep launches queued across StrictMode's effect teardown/re-mount.
  queueMicrotask(() => void drain());
  return () => {
    if (consumer === handler) consumer = undefined;
  };
}

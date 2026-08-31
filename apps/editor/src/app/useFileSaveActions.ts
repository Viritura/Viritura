import { useCallback } from "react";
import { fileSaveAs, fileDownload } from "../commands/fileCommands";
import { useProjectStore } from "../store/projectStore";
import { toast } from "sonner";
import type { useDocumentStoreApi } from "../store/DocumentContext";

interface UseFileSaveActionsArgs {
  store: ReturnType<typeof useDocumentStoreApi>;
  fileHandle: FileSystemFileHandle | null;
  setFileHandle: (handle: FileSystemFileHandle | null) => void;
}

export interface FileSaveActions {
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleDownload: () => void;
}

export function useFileSaveActions({ store, fileHandle, setFileHandle }: UseFileSaveActionsArgs): FileSaveActions {
  const handleSave = useCallback(async () => {
    const { mnxJson: json, fileName: name } = store.getState();
    if (!json) return;
    const projectAdapter = useProjectStore.getState().adapter;
    if (projectAdapter && projectAdapter.isVersioned()) {
      try {
        await projectAdapter.writeScore(json);
        toast.success("Saved");
        // Background commit — don't block UI.
        void useProjectStore
          .getState()
          .commitCurrent(json, { auto: false })
          .catch((err) => console.error("Background commit failed:", err));
      } catch (err) {
        console.error("Save failed:", err);
        toast.error("Save failed");
      }
      return;
    }
    try {
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(json);
        await writable.close();
        toast.success("Score saved");
      } else {
        const handle = await fileSaveAs(json, name || "score.mnx");
        if (handle) {
          setFileHandle(handle);
          toast.success("Score saved");
        }
      }
    } catch (err) {
      console.error("Save failed:", err);
      toast.error("Save failed");
    }
  }, [store, fileHandle, setFileHandle]);

  const handleSaveAs = useCallback(async () => {
    const { mnxJson: json, fileName: name } = store.getState();
    if (!json) return;
    try {
      const handle = await fileSaveAs(json, name || "score.mnx");
      if (handle) {
        setFileHandle(handle);
        toast.success("Score saved as new file");
      }
    } catch (err) {
      console.error("Save As failed:", err);
      toast.error("Save As failed");
    }
  }, [store, setFileHandle]);

  const handleDownload = useCallback(() => {
    const { mnxJson: json, fileName: name } = store.getState();
    if (!json) return;
    fileDownload(json, name || "score.mnx");
  }, [store]);

  return { handleSave, handleSaveAs, handleDownload };
}

import { useCallback, useEffect, useRef } from "react";
import { parseMnx } from "@viritura/format";
import { fileSaveAs, fileDownload } from "../commands/fileCommands";
import type { OpenFileResult } from "../commands/fileCommands";
import { useProjectStore } from "../store/projectStore";
import { openExternalChangeConfirm } from "../store/modalFlowStore";
import { toast } from "sonner";
import type { useDocumentStoreApi } from "../store/DocumentContext";

interface UseFileSaveActionsArgs {
  store: ReturnType<typeof useDocumentStoreApi>;
  fileHandle: FileSystemFileHandle | null;
  setFileHandle: (handle: FileSystemFileHandle | null) => void;
  openedFile: OpenFileResult | null;
  resetHistory: (mnxJson: string) => void;
}

export interface FileSaveActions {
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleDownload: () => void;
}

export function useFileSaveActions({
  store,
  fileHandle,
  setFileHandle,
  openedFile,
  resetHistory,
}: UseFileSaveActionsArgs): FileSaveActions {
  const diskBaselineRef = useRef<string | null>(openedFile?.mnxJson ?? null);

  useEffect(() => {
    diskBaselineRef.current = openedFile?.mnxJson ?? null;
  }, [openedFile]);

  const handleSave = useCallback(async () => {
    const { mnxJson: json, fileName: name } = store.getState();
    if (!json) return;
    const projectAdapter = useProjectStore.getState().adapter;
    let diskJson: string | null = null;
    try {
      if (projectAdapter?.isVersioned()) {
        diskJson = await projectAdapter.readScore();
      } else if (fileHandle) {
        diskJson = await (await fileHandle.getFile()).text();
      }
    } catch (err) {
      console.error("External change check failed:", err);
      toast.error("Could not check the file for external changes");
      return;
    }

    const baseline = diskBaselineRef.current;
    if (diskJson !== null && baseline !== null && diskJson !== baseline) {
      const choice = await openExternalChangeConfirm(name || "score.mnx");
      if (choice === null) return;
      if (choice === "reload") {
        try {
          const parsed = parseMnx(JSON.parse(diskJson));
          store.getState().loadScore(parsed, name, diskJson);
          resetHistory(store.getState().mnxJson || diskJson);
          diskBaselineRef.current = diskJson;
          toast.success("Reloaded external changes");
        } catch (err) {
          console.error("External file reload failed:", err);
          toast.error("The external file is not valid MNX");
        }
        return;
      }
    }
    if (projectAdapter && projectAdapter.isVersioned()) {
      try {
        await projectAdapter.writeScore(json);
        diskBaselineRef.current = json;
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
        diskBaselineRef.current = json;
        toast.success("Score saved");
      } else {
        const handle = await fileSaveAs(json, name || "score.mnx");
        if (handle) {
          setFileHandle(handle);
          diskBaselineRef.current = json;
          toast.success("Score saved");
        }
      }
    } catch (err) {
      console.error("Save failed:", err);
      toast.error("Save failed");
    }
  }, [store, fileHandle, setFileHandle, resetHistory]);

  const handleSaveAs = useCallback(async () => {
    const { mnxJson: json, fileName: name } = store.getState();
    if (!json) return;
    try {
      const handle = await fileSaveAs(json, name || "score.mnx");
      if (handle) {
        setFileHandle(handle);
        diskBaselineRef.current = json;
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

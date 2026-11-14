import { useCallback, useEffect, useRef } from "react";
import { parseMnx, serializeMnx } from "@viritura/format";
import { fileSaveAs, fileDownload, isFileSystemAccessSupported } from "../commands/fileCommands";
import type { OpenFileResult } from "../commands/fileCommands";
import { useProjectStore } from "../store/projectStore";
import { openExternalChangeConfirm } from "../store/modalFlowStore";
import { toast } from "sonner";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import type { ProjectAdapter } from "../git";

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

function getSaveSnapshot(store: UseFileSaveActionsArgs["store"]) {
  const { mnxJson, workingScore, score, fileName, documentGeneration } = store.getState();
  return {
    json: workingScore && workingScore !== score ? JSON.stringify(serializeMnx(workingScore)) : mnxJson,
    fileName,
    documentGeneration,
  };
}

async function saveVersionedProject(adapter: ProjectAdapter, json: string, recordSaved: () => void): Promise<void> {
  try {
    await adapter.writeScore(json);
    useProjectStore.getState().setProjectDiskBaseline(adapter, json);
    recordSaved();
    toast.success("Saved");
    void useProjectStore
      .getState()
      .commitCurrent(json, { auto: false })
      .catch((err) => {
        console.error("Background commit failed:", err);
        toast.error("Saved, but version history could not be updated");
      });
  } catch (err) {
    console.error("Save failed:", err);
    toast.error("Save failed");
  }
}

async function confirmExternalChange(
  store: UseFileSaveActionsArgs["store"],
  name: string,
  diskJson: string | null,
  baseline: string | null,
  projectAdapter: ProjectAdapter | null,
  resetHistory: (json: string) => void,
  recordBaseline: (json: string) => void,
): Promise<boolean> {
  if (projectAdapter?.isVersioned() && baseline === null) {
    toast.error("Could not verify the project file's original contents");
    return false;
  }
  if (diskJson === null || baseline === null || diskJson === baseline) return true;
  const choice = await openExternalChangeConfirm(name || "score.mnx");
  if (choice !== "reload") return choice !== null;
  try {
    const parsed = parseMnx(JSON.parse(diskJson));
    store.getState().loadScore(parsed, name, diskJson);
    resetHistory(store.getState().mnxJson || diskJson);
    recordBaseline(diskJson);
    if (projectAdapter?.isVersioned()) useProjectStore.getState().setProjectDiskBaseline(projectAdapter, diskJson);
    toast.success("Reloaded external changes");
  } catch (err) {
    console.error("External file reload failed:", err);
    toast.error("The external file is not valid MNX");
  }
  return false;
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

  const recordSavedSnapshot = useCallback(
    (json: string, documentGeneration: number) => {
      store.getState().markSaved(json, documentGeneration);
      diskBaselineRef.current = json;
    },
    [store],
  );

  const handleSave = useCallback(async () => {
    const { json, fileName: name, documentGeneration } = getSaveSnapshot(store);
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

    const baseline = projectAdapter?.isVersioned()
      ? useProjectStore.getState().projectDiskBaseline
      : diskBaselineRef.current;
    if (
      !(await confirmExternalChange(store, name, diskJson, baseline, projectAdapter, resetHistory, (value) => {
        diskBaselineRef.current = value;
      }))
    )
      return;
    if (projectAdapter && projectAdapter.isVersioned()) {
      await saveVersionedProject(projectAdapter, json, () => recordSavedSnapshot(json, documentGeneration));
      return;
    }
    try {
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(json);
        await writable.close();
        recordSavedSnapshot(json, documentGeneration);
        toast.success("Score saved");
      } else {
        const downloadFallback = !isFileSystemAccessSupported();
        const handle = await fileSaveAs(json, name || "score.mnx");
        if (handle || downloadFallback) store.getState().markSaved(json, documentGeneration);
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
  }, [store, fileHandle, setFileHandle, resetHistory, recordSavedSnapshot]);

  const handleSaveAs = useCallback(async () => {
    const { json, fileName: name, documentGeneration } = getSaveSnapshot(store);
    if (!json) return;
    try {
      const downloadFallback = !isFileSystemAccessSupported();
      const handle = await fileSaveAs(json, name || "score.mnx");
      if (handle || downloadFallback) store.getState().markSaved(json, documentGeneration);
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
    const { json, fileName: name, documentGeneration } = getSaveSnapshot(store);
    if (!json) return;
    fileDownload(json, name || "score.mnx");
    store.getState().markSaved(json, documentGeneration);
  }, [store]);

  return { handleSave, handleSaveAs, handleDownload };
}

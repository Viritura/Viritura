import { useCallback } from "react";
import type React from "react";
import { readDroppedMnxFile, validateMnxJson } from "../commands/fileCommands";
import type { OpenFileResult } from "../commands/fileCommands";

interface UseDragAndDropArgs {
  openFolderHandle: (handle: FileSystemDirectoryHandle) => Promise<void>;
  setIsDragOver: (over: boolean) => void;
  setFileError: (err: string | null) => void;
  setOpenedFile: (file: OpenFileResult | null) => void;
}

export interface DragAndDropHandlers {
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
}

export function useDragAndDrop({
  openFolderHandle,
  setIsDragOver,
  setFileError,
  setOpenedFile,
}: UseDragAndDropArgs): DragAndDropHandlers {
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      // Only show drop overlay for external file drops, not internal panel reorders
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    },
    [setIsDragOver],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    },
    [setIsDragOver],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      setFileError(null);

      // Try DataTransferItem first so we can detect a dropped folder.
      const items = Array.from(e.dataTransfer.items);
      for (const item of items) {
        if (item.kind !== "file") continue;
        const getHandle = (
          item as DataTransferItem & {
            getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
          }
        ).getAsFileSystemHandle;
        if (!getHandle) break;
        try {
          const handle = await getHandle.call(item);
          if (handle && handle.kind === "directory") {
            await openFolderHandle(handle as FileSystemDirectoryHandle);
            return;
          }
        } catch {
          // fall through to file-based path
        }
        break;
      }

      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!file.name.endsWith(".mnx") && !file.name.endsWith(".json")) {
        setFileError("Please drop an .mnx or .json file, or a project folder");
        return;
      }
      try {
        const result = await readDroppedMnxFile(file);
        const validationError = validateMnxJson(result.mnxJson);
        if (validationError) {
          setFileError(`${result.filename}: ${validationError}`);
          return;
        }
        setOpenedFile(result);
      } catch (err: unknown) {
        setFileError(err instanceof Error ? err.message : "Failed to read dropped file");
      }
    },
    [openFolderHandle, setIsDragOver, setFileError, setOpenedFile],
  );

  return { handleDragOver, handleDragLeave, handleDrop };
}

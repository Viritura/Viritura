import { useEffect } from "react";
import { toast } from "sonner";
import { readDroppedMnxFile, type OpenFileResult } from "../commands/fileCommands";
import type { DocumentStore } from "../store/documentStore";
import { setStartCenterOpen } from "../store/onboardingStore";
import { parseLiveRoomIdFromUrl } from "../live/liveUrl";
import { isDesktopHost } from "../instrumentProfiles";
import { subscribeFileLaunch } from "./launchQueue";

export function isFileLaunchUrl(): boolean {
  return new URLSearchParams(window.location.search).get("open-file") === "1" && "launchQueue" in window;
}

interface FileLaunchDeps {
  store: DocumentStore;
  handleOpenFileResult: (result: OpenFileResult) => Promise<boolean>;
  setFileError: (error: string | null) => void;
}

export function useFileLaunch({ store, handleOpenFileResult, setFileError }: FileLaunchDeps): void {
  useEffect(() => {
    if (isDesktopHost()) return;
    return subscribeFileLaunch(async (files) => {
      if (files.length === 0) {
        if (isFileLaunchUrl()) setStartCenterOpen(true);
        return;
      }
      try {
        if (files.length !== 1) throw new Error("Please open one MNX document at a time.");
        const handle = files[0]!;
        if (!handle.name.toLowerCase().endsWith(".mnx")) throw new Error("Please open an .mnx document.");
        if (parseLiveRoomIdFromUrl() !== null) {
          throw new Error("Open the document in a separate Viritura window, outside the live session.");
        }
        const result = { ...(await readDroppedMnxFile(await handle.getFile())), fileHandle: handle };
        const { mnxJson, savedMnxJson, workingScore, score } = store.getState();
        if (
          (mnxJson !== savedMnxJson || workingScore !== score) &&
          !window.confirm("Opening this document will discard unsaved changes. Continue?")
        ) {
          return;
        }
        if (!(await handleOpenFileResult(result)) && !store.getState().score) setStartCenterOpen(true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("Failed to read OS-launched document:", error);
        setFileError(detail);
        toast.error(detail);
        if (!store.getState().score) setStartCenterOpen(true);
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("open-file");
        window.history.replaceState({}, "", url);
      }
    });
  }, [store, handleOpenFileResult, setFileError]);
}

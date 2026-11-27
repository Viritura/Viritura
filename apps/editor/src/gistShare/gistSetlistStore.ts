import { create } from "zustand";
import type { LoadedGistSetlist } from "./source";

interface GistSetlistState {
  readonly setlist: LoadedGistSetlist | null;
  readonly activeFileName: string | null;
  readonly documentGeneration: number | null;
  open: (setlist: LoadedGistSetlist, documentGeneration: number) => void;
  selectFile: (fileName: string, documentGeneration: number) => void;
  clear: () => void;
}

export const useGistSetlistStore = create<GistSetlistState>((set) => ({
  setlist: null,
  activeFileName: null,
  documentGeneration: null,
  open: (setlist, documentGeneration) =>
    set({ setlist, activeFileName: setlist.files[0]?.fileName ?? null, documentGeneration }),
  selectFile: (activeFileName, documentGeneration) => set({ activeFileName, documentGeneration }),
  clear: () => set({ setlist: null, activeFileName: null, documentGeneration: null }),
}));

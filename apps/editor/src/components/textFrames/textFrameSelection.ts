import { create } from "zustand";

interface TextFrameSelectionState {
  /** ID of the frame being edited, shared by the Engrave panel and Horizon lists. */
  selectedFrameId: string | null;
  setSelectedFrameId: (id: string | null) => void;
}

export const useTextFrameSelectionStore = create<TextFrameSelectionState>((set) => ({
  selectedFrameId: null,
  setSelectedFrameId: (selectedFrameId) => set({ selectedFrameId }),
}));

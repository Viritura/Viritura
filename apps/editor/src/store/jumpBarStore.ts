import { create } from "zustand";
import type { JumpBarAction } from "../components/JumpBar";

export type JumpBarQueryResolver = (query: string) => JumpBarAction | null;

interface JumpBarCatalogState {
  actions: JumpBarAction[];
  resolveQueryAction?: JumpBarQueryResolver;
  setCatalog: (actions: JumpBarAction[], resolveQueryAction: JumpBarQueryResolver) => void;
}

/** Persistent Jump Bar catalog consumed by the app-shell host across activities. */
export const useJumpBarCatalogStore = create<JumpBarCatalogState>((set) => ({
  actions: [],
  resolveQueryAction: undefined,
  setCatalog: (actions, resolveQueryAction) => set({ actions, resolveQueryAction }),
}));

export function setJumpBarCatalog(actions: JumpBarAction[], resolveQueryAction: JumpBarQueryResolver): void {
  useJumpBarCatalogStore.getState().setCatalog(actions, resolveQueryAction);
}

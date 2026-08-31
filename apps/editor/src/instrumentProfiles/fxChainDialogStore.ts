/**
 * Open/close state for the FX-chain page (a full-screen dialog). Kept in its own
 * tiny store so any surface — the mixer's reverb group, the master strip — can
 * open the page for a given channel without prop-drilling, and the page itself
 * lives once at the app root.
 */

import { create } from "zustand";
import type { FxChannelId } from "./fxChainStore";

interface FxChainDialogStore {
  /** The channel whose chain the page is showing, or `null` when closed. */
  channel: FxChannelId | null;
  openFxChain: (channel: FxChannelId) => void;
  closeFxChain: () => void;
}

export const useFxChainDialogStore = create<FxChainDialogStore>((set) => ({
  channel: null,
  openFxChain: (channel) => set({ channel }),
  closeFxChain: () => set({ channel: null }),
}));

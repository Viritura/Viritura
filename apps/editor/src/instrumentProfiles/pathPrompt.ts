/**
 * Promise-bridged text prompt for the host bridge.
 *
 * The browser build has no native file dialog, and browsers deliberately
 * withhold filesystem paths from `<input type="file">`, so asking the user to
 * type a path is the only mechanism available there. That used to be a
 * `window.prompt`, which blocks the main thread and ignores the design system.
 *
 * The bridge is a plain async module, not a component, so it can't render a
 * dialog itself. This store lets it `await` one: the request is published here,
 * {@link PathPromptHost} renders it through the `PromptDialog` primitive, and
 * the stored resolver settles the promise when the user confirms or cancels.
 */

import { create } from "zustand";

interface PathPromptRequest {
  title: string;
  description: string;
  placeholder: string;
  resolve: (value: string | null) => void;
}

interface PathPromptState {
  request: PathPromptRequest | null;
  _open: (request: PathPromptRequest) => void;
  _settle: (value: string | null) => void;
}

export const usePathPromptStore = create<PathPromptState>((set, get) => ({
  request: null,
  _open: (request) => {
    // A second request while one is open would strand the first promise, so
    // resolve the incumbent as cancelled before replacing it.
    get().request?.resolve(null);
    set({ request });
  },
  _settle: (value) => {
    const { request } = get();
    if (!request) return;
    set({ request: null });
    request.resolve(value);
  },
}));

/** Ask the user to type a path. Resolves `null` when cancelled. */
export function requestPathInput(options: {
  title: string;
  description: string;
  placeholder: string;
}): Promise<string | null> {
  // No DOM (SSR, tests, the isomorphic converter): nothing can render the
  // dialog, so report a cancellation rather than hanging on a promise that
  // will never settle.
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    usePathPromptStore.getState()._open({ ...options, resolve });
  });
}

/** Settle the open request — used by the host component. */
export const settlePathPrompt = (value: string | null): void => usePathPromptStore.getState()._settle(value);

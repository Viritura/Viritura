/**
 * Theme store.
 *
 * Holds the current color theme (`light` / `dark` / `midnight`) and
 * persists it to `localStorage` under `viritura-theme`. Replaces the prior
 * `ThemeContext` + `ThemeProvider`; consumers now subscribe directly via
 * the `useThemeStore` selector hook. A small one-shot bootstrap (run from
 * `main.tsx`) applies the `data-theme` attribute on `<html>` and wires the
 * persistence side effect.
 */

import { create } from "zustand";

export type Theme = "light" | "dark" | "midnight";

const STORAGE_KEY = "viritura-theme";

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "midnight") return stored;
  } catch {
    // localStorage may be unavailable (SSR, sandboxed iframes, etc.).
  }
  return "light";
}

function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore quota / availability errors.
  }
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

interface ThemeState {
  theme: Theme;
  _setTheme: (t: Theme) => void;
  _toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: readInitialTheme(),
  _setTheme: (t) => {
    persistTheme(t);
    set({ theme: t });
  },
  _toggleTheme: () => {
    const current = get().theme;
    const next: Theme = current === "light" ? "dark" : current === "dark" ? "midnight" : "light";
    persistTheme(next);
    set({ theme: next });
  },
}));

/** Module-level setters — usable outside React, no dep-array bookkeeping. */
export const setTheme = (t: Theme): void => useThemeStore.getState()._setTheme(t);

/**
 * One-shot side effect: applies the persisted theme to the `<html>` element
 * on app boot. Call from `main.tsx` before mounting. Returns void.
 */
export function bootstrapTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", useThemeStore.getState().theme);
}

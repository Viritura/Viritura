import { create } from "zustand";

export type ClickFlashMode = "beat" | "measure" | "off";

const STORAGE_KEY = "viritura.click.flash";

function isClickFlashMode(value: string): value is ClickFlashMode {
  return value === "beat" || value === "measure" || value === "off";
}

function loadFlashMode(): ClickFlashMode {
  try {
    if (typeof localStorage === "undefined") return "beat";
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return "beat";
    if (isClickFlashMode(stored)) return stored;
    console.warn(`[Click] Ignoring unknown saved flash mode: ${stored}`);
  } catch (error) {
    console.warn("[Click] Could not read the saved flash preference:", error);
  }
  return "beat";
}

interface ClickSettings {
  flashMode: ClickFlashMode;
  setFlashMode(mode: ClickFlashMode): void;
}

export const useClickSettingsStore = create<ClickSettings>()((set) => ({
  flashMode: loadFlashMode(),
  setFlashMode: (flashMode) => {
    if (!isClickFlashMode(flashMode)) throw new RangeError(`Unknown click flash mode: ${String(flashMode)}`);
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, flashMode);
    } catch (error) {
      console.warn("[Click] Could not save the flash preference:", error);
    }
    set({ flashMode });
  },
}));

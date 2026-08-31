import { create } from "zustand";

const STORAGE_KEY = "viritura.importSettings";

interface PersistedImportSettings {
  includeVendorExtensions?: boolean;
  discardStemDirections?: boolean;
  hideMetronomeWhenTempoText?: boolean;
}

export interface ImportSettingsState {
  /** Preserve `_x.viritura` vendor extensions on import (tempo text, pedals,
   *  rehearsal marks, etc.). Viritura supports these natively. */
  includeVendorExtensions: boolean;
  /** Drop explicit per-note stem directions so the engine computes stem
   *  orientation from voice and pitch. Useful when a source file writes an
   *  explicit stem on every note (e.g. divisi flattened onto one staff). */
  discardStemDirections: boolean;
  /** Hide the numeric metronome mark when a tempo also carries written tempo
   *  text (e.g. "Molto moderato"). Keeps bpm for playback but engraves the
   *  text alone — the convention for older, text-only repertoire. */
  hideMetronomeWhenTempoText: boolean;
  setIncludeVendorExtensions: (enabled: boolean) => void;
  setDiscardStemDirections: (enabled: boolean) => void;
  setHideMetronomeWhenTempoText: (enabled: boolean) => void;
}

function loadPersistedSettings(): PersistedImportSettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as PersistedImportSettings;
  } catch {
    return {};
  }
}

function savePersistedSettings(
  state: Pick<ImportSettingsState, "includeVendorExtensions" | "discardStemDirections" | "hideMetronomeWhenTempoText">,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; the controls should still work for this session.
  }
}

const persisted = loadPersistedSettings();

const initialSettings = {
  // Default to preserving vendor extensions (historical import behavior).
  includeVendorExtensions: persisted.includeVendorExtensions !== false,
  discardStemDirections: persisted.discardStemDirections === true,
  hideMetronomeWhenTempoText: persisted.hideMetronomeWhenTempoText === true,
};

export const useImportSettingsStore = create<ImportSettingsState>()((set, get) => ({
  ...initialSettings,
  setIncludeVendorExtensions: (includeVendorExtensions) => {
    set({ includeVendorExtensions });
    savePersistedSettings(get());
  },
  setDiscardStemDirections: (discardStemDirections) => {
    set({ discardStemDirections });
    savePersistedSettings(get());
  },
  setHideMetronomeWhenTempoText: (hideMetronomeWhenTempoText) => {
    set({ hideMetronomeWhenTempoText });
    savePersistedSettings(get());
  },
}));

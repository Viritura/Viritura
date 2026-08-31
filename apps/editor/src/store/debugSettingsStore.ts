import { create } from "zustand";
import {
  disablePerfOverlay,
  disableTileCache,
  enablePerfOverlay,
  enableTileCache,
  isPerfEnabled,
  isTileCacheDisabled,
} from "@viritura/renderer";

const STORAGE_KEY = "viritura.debugSettings";

interface PersistedDebugSettings {
  performanceOverlay?: boolean;
  hitboxOverlay?: boolean;
  tileCacheDisabled?: boolean;
}

export interface DebugSettingsState {
  performanceOverlay: boolean;
  hitboxOverlay: boolean;
  tileCacheDisabled: boolean;
  setPerformanceOverlay: (enabled: boolean) => void;
  setHitboxOverlay: (enabled: boolean) => void;
  setTileCacheDisabled: (disabled: boolean) => void;
}

function getSearchFlag(name: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
}

function loadPersistedSettings(): PersistedDebugSettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as PersistedDebugSettings;
  } catch {
    return {};
  }
}

function savePersistedSettings(
  state: Pick<DebugSettingsState, "performanceOverlay" | "hitboxOverlay" | "tileCacheDisabled">,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; the controls should still work for this session.
  }
}

function applyPerformanceOverlay(enabled: boolean): void {
  if (enabled) enablePerfOverlay();
  else disablePerfOverlay();
}

function applyTileCacheDisabled(disabled: boolean): void {
  if (disabled) disableTileCache();
  else enableTileCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("viritura:tile-cache-toggle"));
  }
}

const persisted = loadPersistedSettings();

const initialSettings = {
  performanceOverlay: getSearchFlag("perf") || isPerfEnabled() || persisted.performanceOverlay === true,
  hitboxOverlay: getSearchFlag("hitbox") || persisted.hitboxOverlay === true,
  tileCacheDisabled: isTileCacheDisabled() || persisted.tileCacheDisabled === true,
};

applyPerformanceOverlay(initialSettings.performanceOverlay);
if (initialSettings.tileCacheDisabled) {
  applyTileCacheDisabled(true);
}

export const useDebugSettingsStore = create<DebugSettingsState>()((set, get) => ({
  ...initialSettings,
  setPerformanceOverlay: (performanceOverlay) => {
    applyPerformanceOverlay(performanceOverlay);
    set({ performanceOverlay });
    savePersistedSettings(get());
  },
  setHitboxOverlay: (hitboxOverlay) => {
    set({ hitboxOverlay });
    savePersistedSettings(get());
  },
  setTileCacheDisabled: (tileCacheDisabled) => {
    applyTileCacheDisabled(tileCacheDisabled);
    set({ tileCacheDisabled });
    savePersistedSettings(get());
  },
}));

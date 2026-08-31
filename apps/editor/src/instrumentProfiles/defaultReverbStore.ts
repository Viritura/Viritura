/**
 * Default reverb setting — the effect used to seed a fresh reverb FX chain.
 *
 * Configured once in Settings, this is the plugin `fxChainStore.ensureReverbSeeded`
 * drops into the reverb chain when it is empty, so playback has a sensible reverb
 * without the user hand-building the chain. Users who want something else simply
 * edit the reverb chain directly on the FX page. localStorage-backed; read
 * outside React via `readDefaultReverb`, inside React via the hook.
 */

import { create } from "zustand";

const STORAGE_KEY = "viritura:default-reverb";

export interface DefaultReverbConfig {
  /** Absolute path to the default reverb VST, or `null` when none is chosen. */
  pluginPath: string | null;
  /** Display name for the chosen plugin (its file name), for the UI. */
  pluginName: string | null;
}

const DEFAULT_CONFIG: DefaultReverbConfig = { pluginPath: null, pluginName: null };

function load(): DefaultReverbConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CONFIG };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<DefaultReverbConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function save(config: DefaultReverbConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Best-effort: a quota/availability error must not break settings.
  }
}

interface DefaultReverbStore extends DefaultReverbConfig {
  setDefaultReverb: (pluginPath: string | null, pluginName: string | null) => void;
}

export const useDefaultReverbStore = create<DefaultReverbStore>((set) => ({
  ...load(),
  setDefaultReverb: (pluginPath, pluginName) => {
    set({ pluginPath, pluginName });
    save({ pluginPath, pluginName });
  },
}));

/** Read the default reverb config outside React. */
export function readDefaultReverb(): DefaultReverbConfig {
  const { pluginPath, pluginName } = useDefaultReverbStore.getState();
  return { pluginPath, pluginName };
}

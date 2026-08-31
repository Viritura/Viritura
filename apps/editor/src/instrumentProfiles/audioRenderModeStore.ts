/**
 * Audio render mode — the desktop-only choice between the browser audio path
 * and the native mixer path.
 *
 * - `"web"` (default): every part plays in the browser via SF2 (spessasynth)
 *   with the ConvolverNode reverb. The native VST host is unused. This is the
 *   only mode available on the web build.
 * - `"native"`: ALL parts play through the native mixer (`playback_host`) — VST
 *   configured parts through their VST, every other part through a native
 *   `rustysynth` SoundFont strip — sharing one clock and one VST reverb bus. The
 *   browser engine still runs to drive the playhead and metronome, but produces
 *   no audio.
 *
 * The two modes are mutually exclusive by design: this removes the dual-reverb
 * confusion and the VST/SF2 desync. Read outside React via `readAudioRenderMode`
 * (the desktop transport + PlaybackContext consult it) and inside React via the
 * exported hook.
 */

import { create } from "zustand";

const STORAGE_KEY = "viritura:audio-render-mode";

export type AudioRenderMode = "web" | "native";

const DEFAULT_MODE: AudioRenderMode = "web";

function load(): AudioRenderMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "native" ? "native" : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function save(mode: AudioRenderMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Best-effort: a quota/availability error must not break playback config.
  }
}

interface AudioRenderModeState {
  mode: AudioRenderMode;
  setMode: (mode: AudioRenderMode) => void;
}

export const useAudioRenderModeStore = create<AudioRenderModeState>((set) => ({
  mode: load(),
  setMode: (mode) => {
    set({ mode });
    save(mode);
  },
}));

/** Read the current mode outside React (used by the desktop transport). */
export function readAudioRenderMode(): AudioRenderMode {
  return useAudioRenderModeStore.getState().mode;
}

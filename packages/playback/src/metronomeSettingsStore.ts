import { DEFAULT_CLICK_SOUND, isClickSound, type ClickSound } from "@viritura/audio";
import { create } from "zustand";

const STORAGE_KEY = "viritura.metronome.sound";

function loadSound(): ClickSound {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_CLICK_SOUND;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_CLICK_SOUND;
    if (isClickSound(stored)) return stored;
    console.warn(`[Metronome] Ignoring unknown saved sound: ${stored}`);
  } catch (error) {
    console.warn("[Metronome] Could not read the saved sound preference:", error);
  }
  return DEFAULT_CLICK_SOUND;
}

function persistSound(sound: ClickSound): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, sound);
  } catch (error) {
    console.warn("[Metronome] Could not save the sound preference:", error);
  }
}

interface MetronomeSettings {
  sound: ClickSound;
  setSound(sound: ClickSound): void;
}

const useMetronomeSettingsStore = create<MetronomeSettings>()((set) => ({
  sound: loadSound(),
  setSound: (sound) => {
    if (!isClickSound(sound)) throw new RangeError(`Unknown metronome sound: ${String(sound)}`);
    persistSound(sound);
    set({ sound });
  },
}));

export function getMetronomeSound(): ClickSound {
  return useMetronomeSettingsStore.getState().sound;
}

export function subscribeMetronomeSound(listener: (sound: ClickSound) => void): () => void {
  return useMetronomeSettingsStore.subscribe((state, previous) => {
    if (state.sound !== previous.sound) listener(state.sound);
  });
}

export function useMetronomeSound(): ClickSound {
  return useMetronomeSettingsStore((state) => state.sound);
}

export function useMetronomeSoundActions(): { setSound: (sound: ClickSound) => void } {
  const setSound = useMetronomeSettingsStore((state) => state.setSound);
  return { setSound };
}

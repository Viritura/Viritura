/**
 * FX chains — ordered VST insert lists for the desktop mixer's shared channels.
 *
 * The native mixer (Rust `playback_host`) processes each channel's audio through
 * a *series* of effect plugins in order. Two channels expose an FX chain in v1:
 *
 * - **reverb** — an aux send/return: every VST-routed part sends a global `send`
 *   amount into this chain, whose processed output is folded back into the
 *   master at `wet`. The first plugin is conventionally the reverb itself, but
 *   the chain can hold any number of effects (e.g. reverb → EQ).
 * - **master** — a straight insert chain on the summed master bus (e.g. a bus
 *   compressor / limiter), processed just before the master gain.
 *
 * This store owns the *composition* of those chains (which plugins, in what
 * order) plus the reverb's send/wet. Each entry's captured editor patch lives on
 * disk (see `fxChainState`); only a monotonic `stateVersion` is held here so a
 * capture invalidates the transport's reload key. Read outside React via
 * `readFxChains` (the desktop transport reads it when preparing a play) and
 * inside React via the exported hook.
 */

import { create } from "zustand";
import { isDesktopHost } from "./profileHostBridge";
import { readDefaultReverb } from "./defaultReverbStore";

const STORAGE_KEY = "viritura:fx-chains";

/** The mixer channels that expose an FX chain in v1. */
export type FxChannelId = "reverb" | "master";

/** One plugin slot in a channel's chain. `id` is a stable local handle used for
 *  its on-disk state file and for reorder/remove; it never crosses to the host. */
export interface FxPluginEntry {
  readonly id: string;
  /** Absolute path to the effect VST. */
  pluginPath: string;
  /** Display name (the plugin's file name), for the UI. */
  pluginName: string;
  /**
   * Monotonic counter bumped whenever the user captures new state from this
   * plugin's editor. `0` means no saved patch. The transport folds it into the
   * chain's reload key so a capture forces a reload; the bytes live on disk.
   */
  stateVersion: number;
}

/** Persisted FX-chain config. `send`/`wet` are linear gains in `[0, 1]`. */
export interface FxChainsConfig {
  reverb: {
    plugins: FxPluginEntry[];
    /** Global amount of each instrument's signal sent into the reverb chain. */
    send: number;
    /** Level of the reverb chain's processed return folded into the master. */
    wet: number;
  };
  master: {
    plugins: FxPluginEntry[];
  };
}

const DEFAULT_CONFIG: FxChainsConfig = {
  reverb: { plugins: [], send: 0.25, wet: 0.3 },
  master: { plugins: [] },
};

function newId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `fx-${Date.now().toString(36)}-${rand}`;
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function load(): FxChainsConfig {
  if (typeof window === "undefined") return clone(DEFAULT_CONFIG);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw) as Partial<FxChainsConfig>;
    return {
      reverb: {
        plugins: normalizePlugins(parsed.reverb?.plugins),
        send: numberOr(parsed.reverb?.send, DEFAULT_CONFIG.reverb.send),
        wet: numberOr(parsed.reverb?.wet, DEFAULT_CONFIG.reverb.wet),
      },
      master: { plugins: normalizePlugins(parsed.master?.plugins) },
    };
  } catch {
    return clone(DEFAULT_CONFIG);
  }
}

function normalizePlugins(list: unknown): FxPluginEntry[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): FxPluginEntry[] => {
    const entry = raw as Partial<FxPluginEntry>;
    if (typeof entry.pluginPath !== "string" || entry.pluginPath.length === 0) return [];
    return [
      {
        id: typeof entry.id === "string" && entry.id.length > 0 ? entry.id : newId(),
        pluginPath: entry.pluginPath,
        pluginName: typeof entry.pluginName === "string" ? entry.pluginName : fileNameOf(entry.pluginPath),
        stateVersion: typeof entry.stateVersion === "number" ? entry.stateVersion : 0,
      },
    ];
  });
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clone(config: FxChainsConfig): FxChainsConfig {
  return {
    reverb: { plugins: config.reverb.plugins.map((p) => ({ ...p })), send: config.reverb.send, wet: config.reverb.wet },
    master: { plugins: config.master.plugins.map((p) => ({ ...p })) },
  };
}

function save(config: FxChainsConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Best-effort: a quota/availability error must not break playback config.
  }
}

/**
 * Push the reverb send/wet to the native host so a slider drag is audible while
 * playing (the host no-ops when nothing is loaded, applying the stored values on
 * the next play instead). Fire-and-forget and desktop-only; Tauri is imported
 * lazily so the web bundle never loads it.
 */
function pushReverbLevels(send: number, wet: number): void {
  if (!isDesktopHost()) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("vst_playback_set_reverb_levels", { send, wet }))
    .catch(() => {
      // The host may not be running yet; the next play applies the stored values.
    });
}

interface FxChainStore {
  config: FxChainsConfig;
  /** Append a plugin to a channel's chain and return the new entry's id. */
  addPlugin: (channel: FxChannelId, pluginPath: string, pluginName: string) => string;
  removePlugin: (channel: FxChannelId, id: string) => void;
  /** Move an entry within its chain (`-1` = earlier, `+1` = later); clamped. */
  movePlugin: (channel: FxChannelId, id: string, direction: -1 | 1) => void;
  /** Record that fresh editor state was captured for an entry (bumps its version). */
  markStateCaptured: (channel: FxChannelId, id: string) => void;
  setSend: (send: number) => void;
  setWet: (wet: number) => void;
  /**
   * If the reverb chain is empty and a default reverb is configured, seed the
   * chain with it. Idempotent; call before a play or when opening the FX page so
   * the configured default is heard even if the chain was never touched.
   */
  ensureReverbSeeded: () => void;
}

export const useFxChainStore = create<FxChainStore>((set, get) => ({
  config: load(),
  addPlugin: (channel, pluginPath, pluginName) => {
    const id = newId();
    set((state) => {
      const next = clone(state.config);
      next[channel].plugins.push({ id, pluginPath, pluginName, stateVersion: 0 });
      save(next);
      return { config: next };
    });
    return id;
  },
  removePlugin: (channel, id) => {
    set((state) => {
      const next = clone(state.config);
      next[channel].plugins = next[channel].plugins.filter((p) => p.id !== id);
      save(next);
      return { config: next };
    });
  },
  movePlugin: (channel, id, direction) => {
    set((state) => {
      const next = clone(state.config);
      const list = next[channel].plugins;
      const from = list.findIndex((p) => p.id === id);
      if (from < 0) return {};
      const to = from + direction;
      if (to < 0 || to >= list.length) return {};
      const [entry] = list.splice(from, 1);
      list.splice(to, 0, entry!);
      save(next);
      return { config: next };
    });
  },
  markStateCaptured: (channel, id) => {
    set((state) => {
      const next = clone(state.config);
      const entry = next[channel].plugins.find((p) => p.id === id);
      if (!entry) return {};
      entry.stateVersion += 1;
      save(next);
      return { config: next };
    });
  },
  setSend: (send) => {
    set((state) => {
      const next = clone(state.config);
      next.reverb.send = send;
      save(next);
      return { config: next };
    });
    const { send: s, wet } = get().config.reverb;
    pushReverbLevels(s, wet);
  },
  setWet: (wet) => {
    set((state) => {
      const next = clone(state.config);
      next.reverb.wet = wet;
      save(next);
      return { config: next };
    });
    const { send, wet: w } = get().config.reverb;
    pushReverbLevels(send, w);
  },
  ensureReverbSeeded: () => {
    if (get().config.reverb.plugins.length > 0) return;
    const preset = readDefaultReverb();
    if (!preset.pluginPath) return;
    get().addPlugin("reverb", preset.pluginPath, preset.pluginName ?? fileNameOf(preset.pluginPath));
  },
}));

/** Read the current FX-chain config outside React (used by the desktop transport). */
export function readFxChains(): FxChainsConfig {
  return clone(useFxChainStore.getState().config);
}

import { create } from "zustand";
import { selectHostBridge } from "./profileHostBridge";

const STORAGE_KEY = "viritura.scanFolders";

/**
 * Bumped whenever the platform default folders change so previously-seeded
 * defaults are re-derived. On upgrade we drop the *old* default lua paths
 * (see `LEGACY_LUA_DEFAULTS`) and merge the current defaults back in, without
 * touching folders the user added by hand.
 */
const SEED_VERSION = 2;

/**
 * Substrings identifying lua folders that were seeded as defaults by an earlier
 * build. Matched case-insensitively with both path separators normalized, so a
 * seed-version bump can prune them without disturbing user-added folders.
 */
const LEGACY_LUA_DEFAULTS = ["lua-examples", "/lua/articulations"];

function isLegacyLuaDefault(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return LEGACY_LUA_DEFAULTS.some((needle) => normalized.includes(needle));
}

interface PersistedScanFolders {
  pluginFolders?: string[];
  luaFolders?: string[];
  /** Whether the platform defaults have already been merged in once. */
  seeded?: boolean;
  /** The `SEED_VERSION` under which the defaults were last merged. */
  seedVersion?: number;
}

export interface ScanFoldersState {
  /** Folders searched for installed VST3 plugins. */
  pluginFolders: string[];
  /** Folders searched for Lua articulation scripts. */
  luaFolders: string[];
  /** True once the native platform defaults have been merged in (one-shot). */
  seeded: boolean;
  /** The `SEED_VERSION` under which defaults were last merged. */
  seedVersion: number;
  addPluginFolder: (path: string) => void;
  removePluginFolder: (path: string) => void;
  addLuaFolder: (path: string) => void;
  removeLuaFolder: (path: string) => void;
  /**
   * Merge the native platform defaults into the folder lists once, so a fresh
   * install already searches the standard VST3 location and the bundled Lua
   * examples. Idempotent: a no-op after the first successful seed.
   */
  ensureSeeded: () => Promise<void>;
}

function loadPersisted(): PersistedScanFolders {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as PersistedScanFolders;
  } catch {
    return {};
  }
}

function savePersisted(state: Pick<ScanFoldersState, "pluginFolders" | "luaFolders" | "seeded" | "seedVersion">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pluginFolders: state.pluginFolders,
        luaFolders: state.luaFolders,
        seeded: state.seeded,
        seedVersion: state.seedVersion,
      }),
    );
  } catch {
    // Ignore storage failures; the lists still work for this session.
  }
}

/** Append `path` to `list` if not already present (paths are treated verbatim). */
function withFolder(list: string[], path: string): string[] {
  const trimmed = path.trim();
  if (trimmed.length === 0 || list.includes(trimmed)) return list;
  return [...list, trimmed];
}

const persisted = loadPersisted();

export const useScanFoldersStore = create<ScanFoldersState>()((set, get) => ({
  pluginFolders: persisted.pluginFolders ?? [],
  luaFolders: persisted.luaFolders ?? [],
  seeded: persisted.seeded === true,
  seedVersion: persisted.seedVersion ?? 0,

  addPluginFolder: (path) => {
    set({ pluginFolders: withFolder(get().pluginFolders, path) });
    savePersisted(get());
  },
  removePluginFolder: (path) => {
    set({ pluginFolders: get().pluginFolders.filter((entry) => entry !== path) });
    savePersisted(get());
  },
  addLuaFolder: (path) => {
    set({ luaFolders: withFolder(get().luaFolders, path) });
    savePersisted(get());
  },
  removeLuaFolder: (path) => {
    set({ luaFolders: get().luaFolders.filter((entry) => entry !== path) });
    savePersisted(get());
  },

  ensureSeeded: async () => {
    if (get().seeded && get().seedVersion >= SEED_VERSION) return;
    const defaults = await selectHostBridge().defaultScanFolders();
    // On a seed-version upgrade, drop the lua paths a previous build seeded as
    // defaults (they've since moved) before merging the current defaults. User
    // folders are preserved because only known legacy defaults are pruned.
    const prunedLua = get().luaFolders.filter((path) => !isLegacyLuaDefault(path));
    const pluginFolders = defaults.pluginFolders.reduce(withFolder, get().pluginFolders);
    const luaFolders = defaults.luaFolders.reduce(withFolder, prunedLua);
    set({ pluginFolders, luaFolders, seeded: true, seedVersion: SEED_VERSION });
    savePersisted(get());
  },
}));

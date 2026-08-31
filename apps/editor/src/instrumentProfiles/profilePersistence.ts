import {
  createInstrumentProfileStore,
  type FileSystemPort,
  type InstrumentProfileStore,
} from "@viritura/instrument-profiles";
import { isDesktopHost } from "./profileHostBridge";

const KEY_PREFIX = "viritura:instrument-profiles:";
const ROOT_DIR = "instrument-profiles";
/** Set once the localStorage → filesystem migration has run on desktop. */
const MIGRATION_FLAG = `${KEY_PREFIX}migrated-to-fs`;

function key(path: string): string {
  return `${KEY_PREFIX}${path}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * A {@link FileSystemPort} backed by `localStorage`. It stands in for the desktop
 * preferences directory in the web/dev build so the same tested codec and atomic
 * (temp+rename) store logic runs unchanged. Phase 3 swaps this for a Tauri fs
 * adapter without touching the store.
 */
function createLocalStorageFileSystem(): FileSystemPort {
  return {
    async readText(path) {
      return localStorage.getItem(key(path));
    },
    async writeText(path, contents) {
      localStorage.setItem(key(path), contents);
    },
    async readBinary(path) {
      const stored = localStorage.getItem(key(path));
      return stored === null ? null : base64ToBytes(stored);
    },
    async writeBinary(path, bytes) {
      localStorage.setItem(key(path), bytesToBase64(bytes));
    },
    async exists(path) {
      return localStorage.getItem(key(path)) !== null;
    },
    async rename(from, to) {
      const value = localStorage.getItem(key(from));
      if (value === null) throw new Error(`rename: missing ${from}`);
      localStorage.setItem(key(to), value);
      localStorage.removeItem(key(from));
    },
    async mkdirp() {
      // localStorage has no directories.
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A {@link FileSystemPort} backed by the Tauri desktop filesystem (real files
 * under the app data directory). This replaces the localStorage adapter on
 * desktop so 1 MB+ opaque plugin state blobs no longer hit the browser's ~5 MB
 * per-origin quota. Tauri is imported lazily so the web bundle never loads it.
 */
function createTauriFileSystem(): FileSystemPort {
  async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(command, args);
  }
  return {
    async readText(path) {
      return invoke<string | null>("profile_fs_read_text", { path });
    },
    async writeText(path, contents) {
      await invoke("profile_fs_write_text", { path, contents });
    },
    async readBinary(path) {
      const bytes = await invoke<number[] | null>("profile_fs_read_binary", { path });
      return bytes === null ? null : Uint8Array.from(bytes);
    },
    async writeBinary(path, bytes) {
      await invoke("profile_fs_write_binary", { path, bytes: Array.from(bytes) });
    },
    async exists(path) {
      return invoke<boolean>("profile_fs_exists", { path });
    },
    async rename(from, to) {
      await invoke("profile_fs_rename", { from, to });
    },
    async mkdirp(dir) {
      await invoke("profile_fs_mkdirp", { dir });
    },
  };
}

/**
 * One-shot migration of any instrument-profile data left in `localStorage` (from
 * before desktop moved to real files) into `fs`, then clearing it to reclaim the
 * quota. Idempotent: the entries are only removed once every write has
 * succeeded, so a mid-way failure simply retries on the next launch. `.tmp`
 * entries are stale atomic-write scratch and are skipped.
 */
async function migrateLocalStorageToFilesystem(fs: FileSystemPort): Promise<void> {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(MIGRATION_FLAG)) return;

  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (storageKey && storageKey.startsWith(KEY_PREFIX) && storageKey !== MIGRATION_FLAG) {
      keys.push(storageKey);
    }
  }

  for (const storageKey of keys) {
    const path = storageKey.slice(KEY_PREFIX.length);
    if (path.endsWith(".tmp")) continue;
    const value = localStorage.getItem(storageKey);
    if (value === null) continue;
    if (path.endsWith(".bin")) {
      await fs.writeBinary(path, base64ToBytes(value));
    } else {
      await fs.writeText(path, value);
    }
  }

  // Reclaim the quota before writing the flag: on a full store even the tiny
  // flag write can throw, so free the migrated entries first.
  for (const storageKey of keys) localStorage.removeItem(storageKey);
  localStorage.setItem(MIGRATION_FLAG, "1");
}

/**
 * Wrap `fs` so its first operation awaits a one-shot localStorage migration.
 * Every method delegates to the raw port only after the migration settles, so
 * reads never observe a half-migrated tree.
 */
function withMigration(fs: FileSystemPort): FileSystemPort {
  const ready = migrateLocalStorageToFilesystem(fs).catch((error) => {
    console.warn("Instrument-profile migration to filesystem failed:", error);
  });
  const after = <T>(run: () => Promise<T>): Promise<T> => ready.then(run);
  return {
    readText: (path) => after(() => fs.readText(path)),
    writeText: (path, contents) => after(() => fs.writeText(path, contents)),
    readBinary: (path) => after(() => fs.readBinary(path)),
    writeBinary: (path, bytes) => after(() => fs.writeBinary(path, bytes)),
    exists: (path) => after(() => fs.exists(path)),
    rename: (from, to) => after(() => fs.rename(from, to)),
    mkdirp: (dir) => after(() => fs.mkdirp(dir)),
  };
}

/** The web/dev persistence store for VST instrument profiles. */
export function createEditorProfileStore(): InstrumentProfileStore {
  // Desktop persists to real files (no size cap); the browser keeps its
  // localStorage fallback so the same store logic runs in the web/dev build.
  const fs = isDesktopHost() ? withMigration(createTauriFileSystem()) : createLocalStorageFileSystem();
  return createInstrumentProfileStore({
    rootDir: ROOT_DIR,
    fs,
    hashBytes: sha256Hex,
  });
}

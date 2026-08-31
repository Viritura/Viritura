import type { PluginIdentity, SlotBinding, VstInstrumentProfile } from "../types";
import { canRestoreState } from "../slot";
import type { FileSystemPort, HashBytes } from "./ports";
import { parseRegistry, serializeRegistry, type ParsedRegistry } from "./registryCodec";

export interface InstrumentProfileStoreConfig {
  /** Directory holding `registry.json` and `state/`, e.g.
   * `<app-data>/instrument-profiles`. */
  readonly rootDir: string;
  readonly fs: FileSystemPort;
  readonly hashBytes: HashBytes;
}

/** A restore attempt's outcome, so callers never load incompatible bytes. */
export type StateRestore =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: "missing" | "identity-mismatch" };

/**
 * The machine-local persistence surface for VST instrument profiles: an
 * atomically-written `registry.json` plus an immutable, content-addressed store
 * of opaque plugin state. Desktop-only in practice; the web build uses
 * {@link createUnavailableProfileStore} instead.
 */
export interface InstrumentProfileStore {
  /** Load and validate the profile set. Missing file → empty set, no error. */
  load(): Promise<ParsedRegistry>;
  /** Atomically persist the profile set to `registry.json`. */
  save(profiles: readonly VstInstrumentProfile[]): Promise<void>;
  /**
   * Store opaque plugin state, returning its content-addressed `stateRef`. The
   * write is skipped when a blob with that hash already exists, so a known-good
   * capture is never overwritten in place.
   */
  putState(bytes: Uint8Array): Promise<string>;
  /**
   * Load opaque state for a slot binding, refusing the bytes when the loaded
   * plugin's identity does not match the one that produced the state.
   */
  restoreState(binding: SlotBinding, loaded: PluginIdentity): Promise<StateRestore>;
}

function joinPath(dir: string, ...parts: string[]): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  return [trimmed, ...parts].join(sep);
}

export function createInstrumentProfileStore(config: InstrumentProfileStoreConfig): InstrumentProfileStore {
  const { rootDir, fs, hashBytes } = config;
  const registryPath = joinPath(rootDir, "registry.json");
  const stateDir = joinPath(rootDir, "state");
  const statePath = (ref: string): string => joinPath(stateDir, `${ref}.bin`);

  async function writeTextAtomic(path: string, contents: string): Promise<void> {
    const tmp = `${path}.tmp`;
    await fs.writeText(tmp, contents);
    await fs.rename(tmp, path);
  }

  return {
    async load(): Promise<ParsedRegistry> {
      const text = await fs.readText(registryPath);
      if (text === null) return { profiles: [], issues: [] };
      return parseRegistry(text);
    },

    async save(profiles: readonly VstInstrumentProfile[]): Promise<void> {
      await fs.mkdirp(rootDir);
      await writeTextAtomic(registryPath, serializeRegistry(profiles));
    },

    async putState(bytes: Uint8Array): Promise<string> {
      const ref = await hashBytes(bytes);
      const path = statePath(ref);
      // Content-addressed and immutable: an identical hash means identical bytes,
      // so an existing blob is already correct and must not be rewritten.
      if (!(await fs.exists(path))) {
        await fs.mkdirp(stateDir);
        const tmp = `${path}.tmp`;
        await fs.writeBinary(tmp, bytes);
        await fs.rename(tmp, path);
      }
      return ref;
    },

    async restoreState(binding: SlotBinding, loaded: PluginIdentity): Promise<StateRestore> {
      if (!binding.stateRef) return { ok: false, reason: "missing" };
      if (!canRestoreState(binding, loaded)) return { ok: false, reason: "identity-mismatch" };
      const bytes = await fs.readBinary(statePath(binding.stateRef));
      if (bytes === null) return { ok: false, reason: "missing" };
      return { ok: true, bytes };
    },
  };
}

/**
 * The web build has no local host and no picker: it can neither persist profiles
 * nor read opaque state. This store reports an empty set and refuses writes,
 * making the "VST is desktop-only, fall back to VirituraSounds" contract explicit
 * rather than silently no-op.
 */
export function createUnavailableProfileStore(): InstrumentProfileStore {
  const refuse = (): never => {
    throw new Error("Instrument profiles are unavailable on the web build.");
  };
  return {
    async load(): Promise<ParsedRegistry> {
      return { profiles: [], issues: [] };
    },
    async save(): Promise<void> {
      refuse();
    },
    async putState(): Promise<string> {
      return refuse();
    },
    async restoreState(): Promise<StateRestore> {
      return { ok: false, reason: "missing" };
    },
  };
}

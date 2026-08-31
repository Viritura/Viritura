/**
 * The minimal local-filesystem surface the store needs. Desktop provides a Tauri
 * implementation; tests provide an in-memory one. Keeping the store isomorphic
 * (no direct Tauri import) is what makes atomic-write and content-addressing
 * behavior unit-testable.
 */
export interface FileSystemPort {
  /** Read a UTF-8 file, or `null` if it does not exist. */
  readText(path: string): Promise<string | null>;
  writeText(path: string, contents: string): Promise<void>;
  /** Read a binary file, or `null` if it does not exist. */
  readBinary(path: string): Promise<Uint8Array | null>;
  writeBinary(path: string, bytes: Uint8Array): Promise<void>;
  /** Whether a path exists (file or directory). */
  exists(path: string): Promise<boolean>;
  /** Atomically replace `to` with `from` (same-volume rename). */
  rename(from: string, to: string): Promise<void>;
  /** Ensure a directory (and parents) exist. */
  mkdirp(dir: string): Promise<void>;
}

/** Computes the hex SHA-256 of some bytes, used to content-address state blobs. */
export type HashBytes = (bytes: Uint8Array) => Promise<string>;

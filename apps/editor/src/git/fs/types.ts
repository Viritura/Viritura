/**
 * Filesystem adapter for isomorphic-git.
 *
 * isomorphic-git accepts an `fs` object exposing a tiny subset of node's `fs`
 * module. This interface is the shape we implement in our adapters
 * (OPFS, File System Access API, in-memory).
 *
 * We only implement the subset isomorphic-git actually uses; if it ever calls
 * something we haven't implemented, we throw `UnsupportedFsCall` so the issue
 * is loud rather than silent.
 */

export interface IsoGitStat {
  type: "file" | "dir" | "symlink";
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/**
 * Methods isomorphic-git invokes on the fs object. We expose them at the
 * top level (rather than under `fs.promises`) so isomorphic-git's
 * `isPromiseFs` heuristic detects us as a promise-style filesystem.
 */
export interface IsoGitFs {
  readFile(filepath: string, opts?: { encoding?: "utf8" }): Promise<Uint8Array | string>;
  writeFile(filepath: string, data: Uint8Array | string, opts?: { encoding?: "utf8"; mode?: number }): Promise<void>;
  unlink(filepath: string): Promise<void>;
  readdir(filepath: string): Promise<string[]>;
  mkdir(filepath: string, opts?: { recursive?: boolean; mode?: number }): Promise<void>;
  rmdir(filepath: string): Promise<void>;
  stat(filepath: string): Promise<IsoGitStat>;
  lstat(filepath: string): Promise<IsoGitStat>;
  readlink?(filepath: string): Promise<string>;
  symlink?(target: string, filepath: string): Promise<void>;
  chmod?(filepath: string, mode: number): Promise<void>;
}

export class FsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "FsError";
  }
}

export const ENOENT = (path: string): FsError => new FsError("ENOENT", `no such file or directory: ${path}`);
export const EEXIST = (path: string): FsError => new FsError("EEXIST", `file already exists: ${path}`);
export const ENOTDIR = (path: string): FsError => new FsError("ENOTDIR", `not a directory: ${path}`);
export const EISDIR = (path: string): FsError => new FsError("EISDIR", `is a directory: ${path}`);

export function makeStat(opts: { type: "file" | "dir" | "symlink"; size?: number; mtimeMs?: number }): IsoGitStat {
  const now = Date.now();
  const mtime = opts.mtimeMs ?? now;
  return {
    type: opts.type,
    mode: opts.type === "dir" ? 0o040755 : 0o100644,
    size: opts.size ?? 0,
    ino: 0,
    mtimeMs: mtime,
    ctimeMs: mtime,
    uid: 0,
    gid: 0,
    dev: 0,
    isFile: () => opts.type === "file",
    isDirectory: () => opts.type === "dir",
    isSymbolicLink: () => opts.type === "symlink",
  };
}

/**
 * Normalise a path to a leading-slash absolute form with no trailing slash
 * and no ".." traversal. Empty and "." segments are stripped.
 */
export function normalizePath(p: string): string {
  if (!p || p === "/") return "/";
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return "/" + parts.join("/");
}

export function splitPath(p: string): { dir: string; base: string } {
  const norm = normalizePath(p);
  if (norm === "/") return { dir: "/", base: "" };
  const i = norm.lastIndexOf("/");
  return { dir: i === 0 ? "/" : norm.slice(0, i), base: norm.slice(i + 1) };
}

export function toBytes(data: Uint8Array | string): Uint8Array<ArrayBuffer> {
  if (typeof data === "string") {
    const encoded = new TextEncoder().encode(data);
    // Re-wrap with a fresh ArrayBuffer to satisfy FileSystemWritableFileStream.
    const copy = new Uint8Array(encoded.byteLength);
    copy.set(encoded);
    return copy;
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

export function decode(data: Uint8Array, encoding?: "utf8"): Uint8Array | string {
  if (encoding === "utf8") return new TextDecoder().decode(data);
  return data;
}

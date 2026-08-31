/**
 * In-memory filesystem adapter for isomorphic-git.
 *
 * Used for tests and as the simplest reference implementation. Stores files
 * as byte buffers in a Map keyed by normalised path.
 *
 * Methods are exposed at the top level (rather than under `.promises`) so
 * isomorphic-git's `isPromiseFs` detection works correctly.
 */

import {
  EEXIST,
  ENOENT,
  ENOTDIR,
  EISDIR,
  type IsoGitFs,
  type IsoGitStat,
  makeStat,
  normalizePath,
  splitPath,
  toBytes,
  decode,
} from "./types";

interface Entry {
  type: "file" | "dir";
  data: Uint8Array;
  mtimeMs: number;
}

export class InMemoryFs implements IsoGitFs {
  private map = new Map<string, Entry>();

  constructor() {
    this.map.set("/", { type: "dir", data: new Uint8Array(), mtimeMs: Date.now() });
  }

  async readFile(filepath: string, opts?: { encoding?: "utf8" }) {
    const norm = normalizePath(filepath);
    const e = this.map.get(norm);
    if (!e) throw ENOENT(norm);
    if (e.type !== "file") throw EISDIR(norm);
    return decode(e.data, opts?.encoding);
  }

  async writeFile(filepath: string, data: Uint8Array | string): Promise<void> {
    const norm = normalizePath(filepath);
    const { dir } = splitPath(norm);
    const dirEntry = this.map.get(dir);
    if (!dirEntry) throw ENOENT(dir);
    if (dirEntry.type !== "dir") throw ENOTDIR(dir);
    const existing = this.map.get(norm);
    if (existing && existing.type === "dir") throw EISDIR(norm);
    this.map.set(norm, { type: "file", data: toBytes(data), mtimeMs: Date.now() });
  }

  async unlink(filepath: string): Promise<void> {
    const norm = normalizePath(filepath);
    const e = this.map.get(norm);
    if (!e) throw ENOENT(norm);
    if (e.type !== "file") throw EISDIR(norm);
    this.map.delete(norm);
  }

  async readdir(filepath: string): Promise<string[]> {
    const norm = normalizePath(filepath);
    const e = this.map.get(norm);
    if (!e) throw ENOENT(norm);
    if (e.type !== "dir") throw ENOTDIR(norm);
    const prefix = norm === "/" ? "/" : norm + "/";
    const out = new Set<string>();
    for (const key of this.map.keys()) {
      if (key === norm) continue;
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      out.add(slash === -1 ? rest : rest.slice(0, slash));
    }
    return [...out].sort();
  }

  async mkdir(filepath: string, opts?: { recursive?: boolean }): Promise<void> {
    const norm = normalizePath(filepath);
    if (norm === "/") return;
    const existing = this.map.get(norm);
    if (existing) {
      if (existing.type === "dir") {
        if (opts?.recursive) return;
        throw EEXIST(norm);
      }
      throw EEXIST(norm);
    }
    const { dir } = splitPath(norm);
    const dirEntry = this.map.get(dir);
    if (!dirEntry) {
      if (opts?.recursive) {
        await this.mkdir(dir, opts);
      } else {
        throw ENOENT(dir);
      }
    } else if (dirEntry.type !== "dir") {
      throw ENOTDIR(dir);
    }
    this.map.set(norm, { type: "dir", data: new Uint8Array(), mtimeMs: Date.now() });
  }

  async rmdir(filepath: string): Promise<void> {
    const norm = normalizePath(filepath);
    const e = this.map.get(norm);
    if (!e) throw ENOENT(norm);
    if (e.type !== "dir") throw ENOTDIR(norm);
    const children = await this.readdir(norm);
    if (children.length > 0) {
      throw new Error(`ENOTEMPTY: directory not empty: ${norm}`);
    }
    this.map.delete(norm);
  }

  async stat(filepath: string): Promise<IsoGitStat> {
    const norm = normalizePath(filepath);
    const e = this.map.get(norm);
    if (!e) throw ENOENT(norm);
    return makeStat({
      type: e.type,
      size: e.type === "file" ? e.data.byteLength : 0,
      mtimeMs: e.mtimeMs,
    });
  }

  async lstat(filepath: string): Promise<IsoGitStat> {
    return this.stat(filepath);
  }

  async readlink(filepath: string): Promise<string> {
    throw ENOENT(filepath);
  }

  async symlink(): Promise<void> {
    throw new Error("symlink is not supported");
  }

  /** Test helper: snapshot of all paths. */
  snapshot(): string[] {
    return [...this.map.keys()].sort();
  }
}

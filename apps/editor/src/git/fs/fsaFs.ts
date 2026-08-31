/**
 * File System Access API adapter for isomorphic-git.
 *
 * Backed by a user-provided FileSystemDirectoryHandle (the project root).
 * Chromium-only. Files are written to a real folder the user picked, so
 * .git/ and the .mnx file are visible in their OS file manager.
 */

import {
  ENOENT,
  EISDIR,
  ENOTDIR,
  type IsoGitFs,
  type IsoGitStat,
  makeStat,
  normalizePath,
  toBytes,
  decode,
} from "./types";

export class FsaFs implements IsoGitFs {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private parts(filepath: string): string[] {
    return normalizePath(filepath).split("/").filter(Boolean);
  }

  private async resolveDir(segs: string[], opts: { create?: boolean } = {}): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    for (const seg of segs) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create: opts.create });
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotFoundError") {
          throw ENOENT("/" + segs.join("/"));
        }
        throw err;
      }
    }
    return dir;
  }

  async readFile(filepath: string, opts?: { encoding?: "utf8" }) {
    const segs = this.parts(filepath);
    if (segs.length === 0) throw EISDIR(filepath);
    const last = segs[segs.length - 1]!;
    const dir = await this.resolveDir(segs.slice(0, -1));
    let handle: FileSystemFileHandle;
    try {
      handle = await dir.getFileHandle(last);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") throw ENOENT(filepath);
      if (err instanceof DOMException && err.name === "TypeMismatchError") throw EISDIR(filepath);
      throw err;
    }
    const file = await handle.getFile();
    const buf = new Uint8Array(await file.arrayBuffer());
    return decode(buf, opts?.encoding);
  }

  async writeFile(filepath: string, data: Uint8Array | string): Promise<void> {
    const segs = this.parts(filepath);
    if (segs.length === 0) throw EISDIR(filepath);
    const last = segs[segs.length - 1]!;
    let dir = this.root;
    for (const seg of segs.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(seg, { create: true });
    }
    const handle = await dir.getFileHandle(last, { create: true });
    const writable = await handle.createWritable();
    await writable.write(toBytes(data));
    await writable.close();
  }

  async unlink(filepath: string): Promise<void> {
    const segs = this.parts(filepath);
    if (segs.length === 0) throw EISDIR(filepath);
    const last = segs[segs.length - 1]!;
    const dir = await this.resolveDir(segs.slice(0, -1));
    try {
      await dir.removeEntry(last);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") throw ENOENT(filepath);
      throw err;
    }
  }

  async readdir(filepath: string): Promise<string[]> {
    const segs = this.parts(filepath);
    const dir = await this.resolveDir(segs);
    const out: string[] = [];
    for await (const name of dir.keys()) out.push(name);
    out.sort();
    return out;
  }

  async mkdir(filepath: string, opts?: { recursive?: boolean }): Promise<void> {
    const segs = this.parts(filepath);
    if (segs.length === 0) return;
    if (opts?.recursive) {
      await this.resolveDir(segs, { create: true });
      return;
    }
    const parent = await this.resolveDir(segs.slice(0, -1));
    await parent.getDirectoryHandle(segs[segs.length - 1]!, { create: true });
  }

  async rmdir(filepath: string): Promise<void> {
    const segs = this.parts(filepath);
    if (segs.length === 0) throw new Error("cannot rmdir root");
    const parent = await this.resolveDir(segs.slice(0, -1));
    await parent.removeEntry(segs[segs.length - 1]!, { recursive: false });
  }

  async stat(filepath: string): Promise<IsoGitStat> {
    const segs = this.parts(filepath);
    if (segs.length === 0) return makeStat({ type: "dir" });
    const last = segs[segs.length - 1]!;
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await this.resolveDir(segs.slice(0, -1));
    } catch {
      throw ENOENT(filepath);
    }
    try {
      const fh = await parent.getFileHandle(last);
      const f = await fh.getFile();
      return makeStat({ type: "file", size: f.size, mtimeMs: f.lastModified });
    } catch {
      /* try dir */
    }
    try {
      await parent.getDirectoryHandle(last);
      return makeStat({ type: "dir" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") throw ENOENT(filepath);
      if (err instanceof DOMException && err.name === "TypeMismatchError") throw ENOTDIR(filepath);
      throw err;
    }
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
}

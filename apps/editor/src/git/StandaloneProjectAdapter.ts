/**
 * StandaloneProjectAdapter — wraps a single in-memory MNX file with no
 * version history. Save operations write through to the optional file
 * handle (if any) but versioning methods throw or no-op.
 */

import {
  StandaloneNotSupportedError,
  type CommitInfo,
  type ProjectAdapter,
  type ProjectStatus,
} from "./ProjectAdapter";

export interface StandaloneAdapterOptions {
  fileName: string;
  initialJson: string;
  /** Optional FileSystemFileHandle to persist writes against. */
  fileHandle?: FileSystemFileHandle | null;
  /** Called whenever writeScore is invoked, so external state can stay in sync. */
  onWrite?: (json: string) => void;
}

export class StandaloneProjectAdapter implements ProjectAdapter {
  readonly mode = "standalone" as const;
  name: string;
  private json: string;
  private fileHandle: FileSystemFileHandle | null;
  private onWrite?: (json: string) => void;

  constructor(opts: StandaloneAdapterOptions) {
    this.name = opts.fileName;
    this.json = opts.initialJson;
    this.fileHandle = opts.fileHandle ?? null;
    this.onWrite = opts.onWrite;
  }

  async readScore(): Promise<string> {
    return this.json;
  }

  async writeScore(json: string): Promise<void> {
    this.json = json;
    this.onWrite?.(json);
    if (this.fileHandle) {
      const writable = await this.fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
    }
  }

  async status(): Promise<ProjectStatus> {
    return {
      mode: "standalone",
      name: this.name,
      dirty: false,
      branch: null,
      remoteUrl: null,
      aheadCount: null,
      behindCount: null,
      commitCount: 0,
    };
  }

  isVersioned(): boolean {
    return false;
  }

  async commit(): Promise<string | null> {
    throw new StandaloneNotSupportedError("commit");
  }

  async log(): Promise<CommitInfo[]> {
    return [];
  }

  async readScoreAtCommit(): Promise<string> {
    throw new StandaloneNotSupportedError("readScoreAtCommit");
  }

  async setRemoteUrl(): Promise<void> {
    throw new StandaloneNotSupportedError("setRemoteUrl");
  }

  async push(): Promise<void> {
    throw new StandaloneNotSupportedError("push");
  }

  async fetch(): Promise<void> {
    throw new StandaloneNotSupportedError("fetch");
  }

  /** Update the file handle (e.g. after a Save As). */
  setFileHandle(handle: FileSystemFileHandle | null): void {
    this.fileHandle = handle;
  }

  setName(name: string): void {
    this.name = name;
  }
}

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { withFileLock } from "./fileLock.ts";

export interface WorktreeLease {
  Project: string;
  Slug: string;
  Worktree: string;
  ExpiresAt: string;
  StoppedAt: string | null;
}

export type CleanupAction = "none" | "stop" | "remove";

export function getCleanupAction(lease: WorktreeLease, now: Date, removalGraceMilliseconds: number): CleanupAction {
  if (!lease.Project.startsWith("viritura-") || Date.parse(lease.ExpiresAt) > now.getTime()) return "none";
  if (!lease.StoppedAt) return "stop";
  return Date.parse(lease.StoppedAt) + removalGraceMilliseconds <= now.getTime() ? "remove" : "none";
}

export function readLease(path: string): WorktreeLease {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as WorktreeLease;
}

export function writeLease(path: string, lease: WorktreeLease): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(lease, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function withLeaseLock<T>(lockDirectory: string, project: string, action: () => Promise<T>): Promise<T> {
  return withFileLock(`${lockDirectory}/lease-${project}.lock`, 120_000, action);
}

export function removeLease(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

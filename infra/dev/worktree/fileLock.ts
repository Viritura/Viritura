import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface LockOwner {
  readonly pid: number;
  readonly createdAt: string;
}

function processIsRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function lockIsStale(path: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
    return typeof owner.pid !== "number" || !processIsRunning(owner.pid);
  } catch {
    return true;
  }
}

function recoverStaleLock(path: string): void {
  const quarantinePath = `${path}.stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(path, quarantinePath);
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
    throw error;
  }
  try {
    unlinkSync(quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function withFileLock<T>(path: string, timeoutMilliseconds: number, action: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + timeoutMilliseconds;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(path, "wx");
      try {
        writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      } catch (error) {
        closeSync(descriptor);
        descriptor = undefined;
        try {
          unlinkSync(path);
        } catch {
          // Preserve the original write failure.
        }
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (lockIsStale(path)) {
        recoverStaleLock(path);
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for lock '${path}'.`, { cause: error });
      await delay(250);
    }
  }

  try {
    return await action();
  } finally {
    closeSync(descriptor);
    try {
      unlinkSync(path);
    } catch {
      // The lock has already been cleaned up.
    }
  }
}

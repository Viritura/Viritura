/**
 * Folder scanning helpers for project folders.
 *
 * The File System Access API gives us only the picked directory handle —
 * we can iterate its entries but cannot walk upward. These helpers do a
 * shallow recursive scan (default 2 levels deep) for `.mnx` files so we can
 * support both monorepo layouts (many scores in one folder) and nested
 * arrangements (e.g. `scores/symphony.mnx`).
 *
 * We deliberately keep the scan shallow + capped so a user who picks their
 * home directory by mistake doesn't hang the UI. If the limit is reached we
 * surface what we found and let the user pick.
 */

/** A single `.mnx` file discovered inside a project folder. */
export interface DiscoveredScore {
  /** POSIX-style path relative to the picked root (e.g. `scores/op-12.mnx`). */
  relativePath: string;
  /** Display name = file name (final path component). */
  name: string;
  /** Handle to the file itself. */
  handle: FileSystemFileHandle;
}

export interface ScanOptions {
  /** Max directory depth to recurse (root = 0). Default 2. */
  maxDepth?: number;
  /** Stop scanning after this many matches. Default 50. */
  maxResults?: number;
  /** Directory names to skip (case-sensitive). Defaults to common noise. */
  ignore?: ReadonlySet<string>;
}

const DEFAULT_IGNORE: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".vscode",
  ".idea",
  "dist",
  "build",
  ".cache",
  ".DS_Store",
]);

/**
 * Scan a directory for `.mnx` files (depth-limited). Returns paths sorted
 * lexicographically so results are stable across runs.
 */
export async function scanForMnxFiles(
  root: FileSystemDirectoryHandle,
  options: ScanOptions = {},
): Promise<DiscoveredScore[]> {
  const maxDepth = options.maxDepth ?? 2;
  const maxResults = options.maxResults ?? 50;
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const results: DiscoveredScore[] = [];

  async function visit(dir: FileSystemDirectoryHandle, pathParts: string[], depth: number): Promise<void> {
    if (results.length >= maxResults) return;
    let entries: AsyncIterable<[string, FileSystemHandle]>;
    try {
      // FSA spec: `entries()` yields [name, handle] tuples.
      entries = dir.entries() as AsyncIterable<[string, FileSystemHandle]>;
    } catch {
      return;
    }
    // Collect first so we can sort children for stable output.
    const items: Array<[string, FileSystemHandle]> = [];
    try {
      for await (const item of entries) items.push(item);
    } catch {
      return;
    }
    items.sort((a, b) => a[0].localeCompare(b[0]));

    for (const [name, handle] of items) {
      if (results.length >= maxResults) return;
      if (ignore.has(name)) continue;
      if (handle.kind === "file" && name.toLowerCase().endsWith(".mnx")) {
        const fileHandle = handle as FileSystemFileHandle;
        results.push({
          relativePath: [...pathParts, name].join("/"),
          name,
          handle: fileHandle,
        });
      } else if (handle.kind === "directory" && depth < maxDepth) {
        await visit(handle as FileSystemDirectoryHandle, [...pathParts, name], depth + 1);
      }
    }
  }

  await visit(root, [], 0);
  return results;
}

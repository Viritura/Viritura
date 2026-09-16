import { formatBytes } from "./numberFormat.js";

export function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function buildFileIndex(files) {
  const byPath = new Map();
  const byLowerPath = new Map();
  const sfzPaths = [];
  let wavCount = 0;
  let wavBytes = 0;

  for (const file of files) {
    const relativePath = normalizeRelativePath(file.relativePath ?? file.webkitRelativePath ?? file.name);
    if (!relativePath) {
      continue;
    }
    const entry = { file, path: relativePath, lowerPath: relativePath.toLowerCase() };
    byPath.set(relativePath, entry);
    byLowerPath.set(entry.lowerPath, entry);
    if (relativePath.toLowerCase().endsWith(".sfz")) {
      sfzPaths.push(relativePath);
    }
    if (relativePath.toLowerCase().endsWith(".wav")) {
      wavCount += 1;
      wavBytes += file.size;
    }
  }

  sfzPaths.sort((left, right) => left.localeCompare(right));
  return {
    byLowerPath,
    byPath,
    files: [...byPath.values()],
    sfzPaths,
    summary: `${sfzPaths.length} SFZ files, ${wavCount} WAV files (${formatBytes(wavBytes)})`,
    wavBytes,
    wavCount,
  };
}

export async function readDirectoryHandle(directoryHandle) {
  const files = [];
  await collectDirectoryFiles(directoryHandle, "", files);
  return files;
}

async function collectDirectoryFiles(directoryHandle, prefix, files) {
  for await (const [name, handle] of directoryHandle.entries()) {
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await collectDirectoryFiles(handle, relativePath, files);
      continue;
    }
    if (handle.kind === "file") {
      const file = await handle.getFile();
      files.push(wrapFileWithRelativePath(file, relativePath));
    }
  }
}

function wrapFileWithRelativePath(file, relativePath) {
  return {
    get name() {
      return file.name;
    },
    get size() {
      return file.size;
    },
    arrayBuffer: () => file.arrayBuffer(),
    relativePath,
    text: () => file.text(),
    type: file.type,
  };
}

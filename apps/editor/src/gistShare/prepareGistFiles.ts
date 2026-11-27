import { parseMnx } from "@viritura/format";
import { scanForMnxFiles } from "../store/folderScan";
import { COMPRESSED_MNX_SUFFIX, compressMnx } from "./compressedMnx";
import {
  formatMiB,
  MAX_GIST_FILES,
  MAX_GIST_MNX_TOTAL_BYTES,
  MAX_GIST_STORED_FILE_BYTES,
  MAX_GIST_STORED_TOTAL_BYTES,
} from "./shareLimits";

interface PrepareGistFilesOptions {
  readonly projectFolder: FileSystemDirectoryHandle | null;
  readonly activeScorePath: string | null;
  readonly fileName: string;
  readonly currentMnx: string;
}

export async function prepareGistFiles({
  projectFolder,
  activeScorePath,
  fileName,
  currentMnx,
}: PrepareGistFilesOptions): Promise<Readonly<Record<string, string>>> {
  if (!currentMnx) throw new Error("Open an MNX score before creating a share link.");

  const projectFiles = projectFolder
    ? await scanForMnxFiles(projectFolder, {
        maxDepth: Infinity,
        maxResults: MAX_GIST_FILES + 1,
        ignore: new Set<string>(),
        failOnError: true,
      })
    : [];
  if (projectFolder && projectFiles.length === 0) {
    throw new Error("No MNX files were found in this project folder.");
  }
  if (projectFiles.length > MAX_GIST_FILES) {
    throw new Error(`A shared setlist can contain at most ${MAX_GIST_FILES} MNX files.`);
  }
  if (projectFolder && (!activeScorePath || !projectFiles.some((file) => file.relativePath === activeScorePath))) {
    throw new Error("The open score was not found in the project folder. Reopen it before sharing.");
  }

  const files: Record<string, string> = {};
  let totalBytes = 0;
  let storedBytes = 0;
  const sources = projectFolder ? projectFiles : [{ relativePath: fileName, name: fileName, handle: null }];

  for (const [index, source] of sources.entries()) {
    let mnx: string;
    if (!projectFolder || source.relativePath === activeScorePath) {
      mnx = currentMnx;
    } else {
      const handle = source.handle;
      if (!handle) throw new Error(`Could not read ${source.name} from the open project folder.`);
      mnx = await (await handle.getFile()).text();
    }

    const bytes = new TextEncoder().encode(mnx).byteLength;
    totalBytes += bytes;
    if (totalBytes > MAX_GIST_MNX_TOTAL_BYTES) {
      throw new Error(`The setlist exceeds the ${formatMiB(MAX_GIST_MNX_TOTAL_BYTES)} total share limit.`);
    }
    validateMnx(mnx, source.name);

    const gistName = projectFiles.length > 0 ? numberedMnxName(source.name, index) : singleMnxName(source.name);
    let storedName = gistName;
    let stored = mnx;
    let storedFileBytes = bytes;
    if (bytes > MAX_GIST_STORED_FILE_BYTES) {
      storedName = `${gistName}${COMPRESSED_MNX_SUFFIX}`;
      stored = await compressMnx(mnx);
      storedFileBytes = stored.length;
      if (storedFileBytes > MAX_GIST_STORED_FILE_BYTES) {
        throw new Error(`${source.name} is too large to share, even after compression.`);
      }
    }
    storedBytes += storedFileBytes;
    if (storedBytes > MAX_GIST_STORED_TOTAL_BYTES) {
      throw new Error(`The setlist exceeds the ${formatMiB(MAX_GIST_STORED_TOTAL_BYTES)} stored share limit.`);
    }
    files[storedName] = stored;
  }

  return files;
}

function validateMnx(value: string, fileName: string): void {
  try {
    parseMnx(JSON.parse(value));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`${fileName} is not valid MNX: ${detail}`);
  }
}

function numberedMnxName(value: string, index: number): string {
  const prefix = `${String(index + 1).padStart(2, "0")} - `;
  return `${prefix}${safeMnxName(value, 255 - prefix.length)}`;
}

function singleMnxName(value: string): string {
  return safeMnxName(value, 255);
}

function safeMnxName(value: string, maxLength: number): string {
  const leafName = value.split(/[\\/]/).at(-1)?.trim() || "score.mnx";
  const cleaned = [...leafName]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? "_" : character;
    })
    .join("");
  const name = /\.mnx$/i.test(cleaned) ? cleaned : `${cleaned}.mnx`;
  if (name.length <= maxLength) return name;
  const extension = ".mnx";
  return `${name.slice(0, maxLength - extension.length)}${extension}`;
}

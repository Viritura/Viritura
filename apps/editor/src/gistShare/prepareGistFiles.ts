import { parseMnx } from "@viritura/format";
import { scanForMnxFiles } from "../store/folderScan";

const MAX_GIST_FILES = 50;
const MAX_GIST_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_GIST_FILE_BYTES = 16 * 1024 * 1024;

export interface PrepareGistFilesOptions {
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

    validateMnx(mnx, source.name);
    const bytes = new TextEncoder().encode(mnx).byteLength;
    if (bytes > MAX_GIST_FILE_BYTES) {
      throw new Error(`${source.name} exceeds the 16 MiB per-file share limit.`);
    }
    totalBytes += bytes;
    if (totalBytes > MAX_GIST_TOTAL_BYTES) {
      throw new Error("The setlist exceeds the 16 MiB total share limit.");
    }

    const gistName = projectFiles.length > 0 ? numberedMnxName(source.name, index) : singleMnxName(source.name);
    files[gistName] = mnx;
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

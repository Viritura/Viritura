/**
 * File commands — open, save, and export .mnx files using the local filesystem.
 *
 * Open: Uses the File System Access API (showOpenFilePicker) where available,
 * with a fallback to <input type="file"> for other browsers.
 *
 * Save: Uses File System Access API (showSaveFilePicker) where available,
 * with a fallback to blob URL download. Includes IndexedDB auto-save for
 * crash recovery.
 */

import { convertMusicXmlToMnx, convertMxlToMnx, type PercussionImportReview } from "@viritura/musicxml";
import { runBackgroundTask } from "../store/backgroundTaskStore";
import { useImportSettingsStore } from "../store/importSettingsStore";

/** Result of opening a file. */
export interface OpenFileResult {
  /** Raw MNX JSON string. */
  mnxJson: string;
  /** Original filename (e.g. "score.mnx"). */
  filename: string;
  /** File handle for subsequent save operations (only with File System Access API). */
  fileHandle: FileSystemFileHandle | null;
  /** Part indices whose imported percussion maps were inferred heuristically. */
  percussionReviewPartIndices?: number[];
  /** Human-readable reasons corresponding to the reviewed parts. */
  percussionReviewReasons?: string[];
}

/** Options accepted by the File System Access API picker. */
interface FilePickerOptions {
  types: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
  multiple: boolean;
}

/** Extended Window with showOpenFilePicker (Chrome/Edge). */
interface FileSystemWindow {
  showOpenFilePicker?: (options: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
}

/**
 * Open an MNX file using the File System Access API (Chrome/Edge).
 * Returns null if the user cancels the picker.
 */
async function openWithFileSystemAccess(): Promise<OpenFileResult | null> {
  const fsWindow = window as unknown as FileSystemWindow;
  if (!fsWindow.showOpenFilePicker) {
    return null;
  }

  try {
    const [handle] = await fsWindow.showOpenFilePicker({
      types: [
        {
          description: "MNX Music Notation Files",
          accept: { "application/json": [".mnx", ".json"] },
        },
      ],
      multiple: false,
    });
    if (!handle) return null;

    const file = await handle.getFile();
    const text = await file.text();
    return { mnxJson: text, filename: file.name, fileHandle: handle };
  } catch (err: unknown) {
    // User cancelled the picker
    if (err instanceof DOMException && err.name === "AbortError") {
      return null;
    }
    throw err;
  }
}

/**
 * Open an MNX file using a hidden <input type="file"> element (fallback).
 * Returns null if the user cancels.
 */
function openWithInputFallback(): Promise<OpenFileResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mnx,.json,application/json";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const text = await file.text();
      resolve({ mnxJson: text, filename: file.name, fileHandle: null });
    });

    // Handle cancel — 'cancel' event fires when user closes dialog without selecting
    input.addEventListener("cancel", () => {
      resolve(null);
    });

    input.click();
  });
}

/**
 * Open an MNX file from the local filesystem.
 * Uses File System Access API where available, falls back to input[type=file].
 * Returns null if the user cancels.
 */
export async function openMnxFile(): Promise<OpenFileResult | null> {
  const fsWindow = window as unknown as FileSystemWindow;
  if (fsWindow.showOpenFilePicker) {
    return openWithFileSystemAccess();
  }
  return openWithInputFallback();
}

/**
 * Read an MNX file from a dropped File object (drag-and-drop).
 */
export async function readDroppedMnxFile(file: File): Promise<OpenFileResult> {
  const text = await file.text();
  return { mnxJson: text, filename: file.name, fileHandle: null };
}

// ═══════════════════════════════════════════
// Import (MusicXML / MXL → MNX)
// ═══════════════════════════════════════════

/** Extensions accepted by the music-import picker. */
const MUSICXML_EXTENSIONS = [".mxl", ".musicxml", ".xml"] as const;

/**
 * Convert an imported MusicXML/MXL `File` into an {@link OpenFileResult} that
 * holds the resulting MNX JSON. `.mxl` (zipped MusicXML) is read as binary and
 * unzipped by the converter; plain `.musicxml`/`.xml` is read as text. The
 * returned filename swaps the source extension for `.mnx` and carries no file
 * handle (an import has no MNX file on disk to save back to).
 */
export async function convertImportedMusicFile(file: File): Promise<OpenFileResult> {
  return runBackgroundTask(`Importing ${file.name}…`, async () => {
    const lower = file.name.toLowerCase();
    // Import behavior is driven by the persisted import settings (Settings →
    // Import). Vendor extensions default on so Viritura-only details (tempo
    // text, hairpins, pedals, rehearsal marks, etc.) survive the round-trip.
    const { includeVendorExtensions, discardStemDirections, hideMetronomeWhenTempoText } =
      useImportSettingsStore.getState();
    const percussionReviews: PercussionImportReview[] = [];
    const opts = {
      includeVendorExtensions,
      discardStemDirections,
      hideMetronomeWhenTempoText,
      percussionReviews,
    } as const;
    const doc = lower.endsWith(".mxl")
      ? await convertMxlToMnx(await file.arrayBuffer(), opts)
      : convertMusicXmlToMnx(await file.text(), opts);
    const baseName = file.name.replace(/\.(mxl|musicxml|xml)$/i, "");
    const reviewById = new Map(percussionReviews.map((review) => [review.partId, review]));
    const reviewedParts = doc.parts
      .map((part, index) => ({ index, review: reviewById.get(part.id) }))
      .filter((entry): entry is { index: number; review: PercussionImportReview } => entry.review !== undefined);
    return {
      mnxJson: JSON.stringify(doc),
      filename: `${baseName}.mnx`,
      fileHandle: null,
      ...(reviewedParts.length > 0
        ? {
            percussionReviewPartIndices: reviewedParts.map((entry) => entry.index),
            percussionReviewReasons: reviewedParts.map((entry) => `${entry.review.partName}: ${entry.review.reason}`),
          }
        : {}),
    };
  });
}

/** Import via the File System Access API (Chrome/Edge). */
async function importWithFileSystemAccess(): Promise<OpenFileResult | null> {
  const fsWindow = window as unknown as FileSystemWindow;
  if (!fsWindow.showOpenFilePicker) return null;
  try {
    const [handle] = await fsWindow.showOpenFilePicker({
      types: [
        {
          description: "MusicXML Files",
          accept: { "application/xml": [...MUSICXML_EXTENSIONS] },
        },
      ],
      multiple: false,
    });
    if (!handle) return null;
    const file = await handle.getFile();
    return await convertImportedMusicFile(file);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/** Import via a hidden <input type="file"> element (fallback). */
function importWithInputFallback(): Promise<OpenFileResult | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = MUSICXML_EXTENSIONS.join(",");
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      convertImportedMusicFile(file).then(resolve).catch(reject);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/**
 * Import a MusicXML (`.musicxml`/`.xml`) or compressed MusicXML (`.mxl`) file
 * and convert it to MNX. Returns an {@link OpenFileResult} holding the MNX JSON,
 * or null if the user cancels. Throws if conversion fails.
 */
export async function importMusicFile(): Promise<OpenFileResult | null> {
  const fsWindow = window as unknown as FileSystemWindow;
  if (fsWindow.showOpenFilePicker) {
    return importWithFileSystemAccess();
  }
  return importWithInputFallback();
}

/**
 * Validate that a string is valid MNX JSON.
 * Returns an error message if invalid, or null if valid.
 */
export function validateMnxJson(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return "File does not contain a valid JSON object";
    }
    const obj = parsed as Record<string, unknown>;
    // MNX files must have a "global" property with measures
    if (!obj["global"] || typeof obj["global"] !== "object") {
      return "Not a valid MNX file: missing 'global' property";
    }
    // MNX files must have "parts" array
    if (!Array.isArray(obj["parts"])) {
      return "Not a valid MNX file: missing 'parts' array";
    }
    return null;
  } catch {
    return "File does not contain valid JSON";
  }
}

// ═══════════════════════════════════════════
// Save / Export
// ═══════════════════════════════════════════

// File System Access API types (for save picker)
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

const MNX_FILE_TYPES = [{ description: "MNX Score Files", accept: { "application/json": [".mnx"] } }];

/** Check if the File System Access API is available (for saving). */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

/** Write MNX JSON string to a FileSystemFileHandle. */
async function writeToHandle(handle: FileSystemFileHandle, mnxJson: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(mnxJson);
  await writable.close();
}

/**
 * Save MNX JSON to an existing file handle, or trigger Save As if no handle.
 * Returns the file handle used (new or existing), or null if cancelled/fallback.
 */
export async function fileSave(
  mnxJson: string,
  handle: FileSystemFileHandle | null,
): Promise<FileSystemFileHandle | null> {
  if (handle) {
    await writeToHandle(handle, mnxJson);
    return handle;
  }
  return fileSaveAs(mnxJson);
}

/**
 * Open a save picker and write MNX JSON to the chosen file.
 * Falls back to blob download if File System Access API is unavailable.
 * Returns the handle, or null if cancelled or fell back to download.
 */
export async function fileSaveAs(mnxJson: string, suggestedName = "score.mnx"): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) {
    fileDownload(mnxJson, suggestedName);
    return null;
  }

  try {
    const handle = await window.showSaveFilePicker!({
      suggestedName,
      types: MNX_FILE_TYPES,
    });
    await writeToHandle(handle, mnxJson);
    return handle;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return null;
    }
    throw err;
  }
}

/** Fallback: download MNX JSON as a file via a temporary blob URL. */
export function fileDownload(mnxJson: string, filename: string): void {
  const blob = new Blob([mnxJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

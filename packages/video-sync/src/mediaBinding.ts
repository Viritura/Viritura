/**
 * Media binding — turning a user-picked file into a playable source plus a
 * portable identity the score can remember.
 *
 * The split matters. A score must be shareable and must survive being opened on
 * another machine, so what it persists is an *identity* (display name + content
 * hash), never a path or a blob. The actual bytes are a device-local binding
 * that the user re-establishes with a relink when it is missing. This is the
 * same separation a DAW makes between a session file and its media folder, and
 * it is why `_x.viritura.videoSync` can round-trip through any MNX reader
 * without dragging a 130 MB file along.
 */

import type { VideoMediaIdentity } from "./types";

/** A device-local binding between a score's media identity and real bytes. */
export interface MediaBinding {
  identity: VideoMediaIdentity;
  /** Object URL for the `<video>` element. Revoke via {@link releaseMediaBinding}. */
  objectUrl: string;
  /**
   * The media bytes themselves.
   *
   * Held so features that need to read the clip -- decoding its audio for the
   * waveform, for instance -- can do so without fetching the object URL back.
   * That fetch works, but it makes a redundant copy of tens of megabytes and
   * puts a request for a local blob through the same code path as a real
   * network call.
   */
  blob: Blob;
}

/**
 * Bytes hashed from each sampled region of a file.
 *
 * Hashing a whole picture file would mean reading hundreds of megabytes on
 * every attach just to produce an identifier. Sampling the head, middle and
 * tail plus the exact byte length is enough to catch the case that actually
 * matters — the user relinking a *different* cut — while staying instant.
 */
const HASH_SAMPLE_BYTES = 512 * 1024;

/** Subset of `File` used here, so tests can pass a plain object. */
export interface HashableFile {
  name: string;
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute a sampled content hash: `sha256:<hex>` over head/middle/tail regions
 * with the file length mixed in.
 *
 * Returns `null` when Web Crypto is unavailable (non-secure context), letting
 * the caller attach media without an identity rather than refusing to work.
 */
export async function computeMediaContentHash(file: HashableFile): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;

  const regions: [number, number][] = [];
  if (file.size <= HASH_SAMPLE_BYTES * 3) {
    regions.push([0, file.size]);
  } else {
    const middle = Math.floor(file.size / 2 - HASH_SAMPLE_BYTES / 2);
    regions.push([0, HASH_SAMPLE_BYTES]);
    regions.push([middle, middle + HASH_SAMPLE_BYTES]);
    regions.push([file.size - HASH_SAMPLE_BYTES, file.size]);
  }

  const chunks: Uint8Array[] = [];
  for (const [start, end] of regions) {
    const buffer = await file.slice(start, end).arrayBuffer();
    chunks.push(new Uint8Array(buffer));
  }
  // Mix in the exact length so two files sharing sampled regions but differing
  // in size (a re-export, a trimmed cut) never collide.
  const lengthTag = new TextEncoder().encode(`|len:${file.size}`);
  chunks.push(lengthTag);

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    combined.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  const digest = await subtle.digest("SHA-256", combined as unknown as ArrayBuffer);
  return `sha256:${toHex(digest)}`;
}

/** Whether a freshly picked file matches the identity a score remembers. */
export function matchesIdentity(identity: VideoMediaIdentity | undefined, candidateHash: string | null): boolean {
  if (!identity?.contentHash || !candidateHash) return false;
  return identity.contentHash === candidateHash;
}

/** Release an object URL created for a binding. */
export function releaseMediaBinding(binding: MediaBinding | null): void {
  if (!binding) return;
  if (binding.objectUrl.startsWith("blob:") && typeof URL !== "undefined" && "revokeObjectURL" in URL) {
    URL.revokeObjectURL(binding.objectUrl);
  }
}

/** Progress of a streaming download, `0`..`1`, or `null` when the length is unknown. */
export type DownloadProgress = (fraction: number | null) => void;

/**
 * Download a remote clip into a local blob.
 *
 * A demo clip *could* be handed to the element as a plain URL, but fetching it
 * first is better on two counts that matter here:
 *
 *  1. **Cross-origin isolation.** The editor sets COEP `require-corp` for
 *     SharedArrayBuffer. `fetch` is explicit about CORS, so a blocked or
 *     mis-configured host fails with a real error we can show, instead of the
 *     element reporting a generic "cannot play that format".
 *  2. **Seeking.** Scoring to picture seeks constantly. Serving those seeks from
 *     a local blob is immediate, where a remote file re-issues a range request
 *     and stalls on every scrub.
 *
 * The trade is one up-front download, whose size the picker already advertises.
 */
export async function fetchMediaBlob(url: string, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { mode: "cors", credentials: "omit", signal });
  if (!response.ok) {
    throw new Error(`The clip could not be downloaded (HTTP ${response.status}).`);
  }

  const declared = Number(response.headers.get("content-length"));
  const total = Number.isFinite(declared) && declared > 0 ? declared : null;

  if (!response.body || !onProgress) {
    return await response.blob();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(total === null ? null : Math.min(1, received / total));
  }
  return new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") ?? "video/mp4" });
}

/** Containers Viritura intentionally supports for reference-picture playback. */
export const VIDEO_FILE_ACCEPT = ".mp4,.m4v,.mov,.webm,video/mp4,video/quicktime,video/webm";

/** Whether a file name uses one of the supported reference-picture containers. */
export function looksLikeVideoFile(fileName: string): boolean {
  return /\.(mp4|m4v|mov|webm)$/i.test(fileName);
}

import { parseMnx } from "@viritura/format";
import type { Score } from "@viritura/core";

const MAX_GIST_MNX_BYTES = 16 * 1024 * 1024;
const MAX_GIST_METADATA_BYTES = 2 * 1024 * 1024;
const GIST_ID_PATTERN = /^[0-9a-f]{20,64}$/i;
const GIST_REVISION_PATTERN = /^[0-9a-f]{40}$/i;

export interface GistReference {
  readonly id: string;
}

export interface GistShareLocation {
  readonly gistId: string;
  readonly revision?: string;
}

export interface LoadedGistMnx {
  readonly gistId: string;
  readonly revision: string;
  readonly fileName: string;
  readonly mnx: string;
  readonly score: Score;
  readonly gistUrl: string;
}

interface GistFilePayload {
  readonly filename: string;
  readonly content: string | null;
  readonly truncated: boolean;
  readonly rawUrl: string;
}

interface GistPayload {
  readonly id: string;
  readonly htmlUrl: string;
  readonly revision: string;
  readonly files: readonly GistFilePayload[];
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function parseGistUrl(value: string): GistReference {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid GitHub Gist URL.");
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "gist.github.com") {
    throw new Error("Enter a URL from gist.github.com.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const gistId = segments.at(-1);
  if (segments.length < 1 || segments.length > 2 || !gistId || !GIST_ID_PATTERN.test(gistId)) {
    throw new Error("Enter the main URL for a GitHub Gist.");
  }

  return { id: gistId.toLowerCase() };
}

export function buildGistShareUrl(origin: string, gistId: string, revision?: string): string {
  assertGistId(gistId);
  if (revision) assertRevision(revision);

  const url = new URL("/s/gist", origin);
  if (revision) url.searchParams.set("revision", revision.toLowerCase());
  url.hash = new URLSearchParams({ id: gistId.toLowerCase() }).toString();
  return url.toString();
}

export function readGistShareLocation(location: Pick<Location, "hash" | "search">): GistShareLocation {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const gistId = fragment.get("id") ?? "";
  const revision = new URLSearchParams(location.search).get("revision") ?? undefined;
  assertGistId(gistId);
  if (revision) assertRevision(revision);
  return { gistId: gistId.toLowerCase(), ...(revision ? { revision: revision.toLowerCase() } : {}) };
}

export async function loadGistMnx(location: GistShareLocation, fetchImpl: FetchLike = fetch): Promise<LoadedGistMnx> {
  assertGistId(location.gistId);
  if (location.revision) assertRevision(location.revision);

  const revisionPath = location.revision ? `/${location.revision}` : "";
  const response = await fetchImpl(`https://api.github.com/gists/${location.gistId}${revisionPath}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throwGistResponseError(response);

  const payloadText = await readBoundedText(response, MAX_GIST_METADATA_BYTES, "Gist metadata");
  const payload = parseGistPayload(payloadText);
  const mnxFiles = payload.files.filter((file) => file.filename.toLowerCase().endsWith(".mnx"));
  if (mnxFiles.length !== 1) {
    throw new Error(
      mnxFiles.length === 0
        ? "This Gist does not contain an .mnx file."
        : "This Gist must contain exactly one .mnx file.",
    );
  }

  const file = mnxFiles[0]!;
  const mnx =
    file.truncated || file.content === null
      ? await loadRawGistFile(file.rawUrl, fetchImpl)
      : ensureTextSize(file.content, MAX_GIST_MNX_BYTES, "MNX file");

  let score: Score;
  try {
    score = parseMnx(JSON.parse(mnx));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`The Gist does not contain valid MNX: ${detail}`);
  }

  return {
    gistId: payload.id,
    revision: payload.revision,
    fileName: file.filename,
    mnx,
    score,
    gistUrl: payload.htmlUrl,
  };
}

function assertGistId(value: string): void {
  if (!GIST_ID_PATTERN.test(value)) {
    throw new Error("The share link contains an invalid Gist ID.");
  }
}

function assertRevision(value: string): void {
  if (!GIST_REVISION_PATTERN.test(value)) {
    throw new Error("The share link contains an invalid Gist revision.");
  }
}

function throwGistResponseError(response: Response): never {
  if (response.status === 404) {
    throw new Error("The Gist was not found or is no longer available.");
  }
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error("GitHub's anonymous request limit has been reached. Try again later.");
  }
  throw new Error(`GitHub could not load the Gist (${response.status}).`);
}

async function loadRawGistFile(rawUrl: string, fetchImpl: FetchLike): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("GitHub returned an invalid raw file URL.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "gist.githubusercontent.com") {
    throw new Error("GitHub returned an unexpected raw file host.");
  }

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`GitHub could not load the MNX file (${response.status}).`);
  }
  return readBoundedText(response, MAX_GIST_MNX_BYTES, "MNX file");
}

async function readBoundedText(response: Response, maxBytes: number, label: string): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`${label} exceeds the ${formatMiB(maxBytes)} limit.`);
  }

  if (!response.body) {
    return ensureTextSize(await response.text(), maxBytes, label);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteCount = 0;
  let result = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteCount += chunk.value.byteLength;
      if (byteCount > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds the ${formatMiB(maxBytes)} limit.`);
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`${label} is not valid UTF-8.`);
    }
    throw error;
  }
}

function ensureTextSize(value: string, maxBytes: number, label: string): string {
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Error(`${label} exceeds the ${formatMiB(maxBytes)} limit.`);
  }
  return value;
}

function formatMiB(bytes: number): string {
  return `${bytes / (1024 * 1024)} MiB`;
}

function parseGistPayload(value: string): GistPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new Error("GitHub returned malformed Gist metadata.");
  }
  if (!isRecord(payload)) throw new Error("GitHub returned malformed Gist metadata.");

  const id = payload.id;
  const htmlUrl = payload.html_url;
  const history = payload.history;
  const files = payload.files;
  if (
    typeof id !== "string" ||
    !GIST_ID_PATTERN.test(id) ||
    typeof htmlUrl !== "string" ||
    !Array.isArray(history) ||
    !isRecord(history[0]) ||
    typeof history[0].version !== "string" ||
    !GIST_REVISION_PATTERN.test(history[0].version) ||
    !isRecord(files)
  ) {
    throw new Error("GitHub returned incomplete Gist metadata.");
  }

  const parsedFiles = Object.values(files).map(parseGistFile);
  return {
    id: id.toLowerCase(),
    htmlUrl,
    revision: history[0].version.toLowerCase(),
    files: parsedFiles,
  };
}

function parseGistFile(value: unknown): GistFilePayload {
  if (
    !isRecord(value) ||
    typeof value.filename !== "string" ||
    (typeof value.content !== "string" && value.content !== null) ||
    typeof value.truncated !== "boolean" ||
    typeof value.raw_url !== "string"
  ) {
    throw new Error("GitHub returned incomplete Gist file metadata.");
  }
  return {
    filename: value.filename,
    content: value.content,
    truncated: value.truncated,
    rawUrl: value.raw_url,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

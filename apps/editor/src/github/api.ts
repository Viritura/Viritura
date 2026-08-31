import { getVirituraApiBaseUrl } from "../config";

import { getCsrfToken } from "../auth/api";

/**
 * Exported so `useReviewSession`'s inferred return type can name it
 * across the package barrel boundary (TS4058).
 * @public
 */
export interface GitHubViewer {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export interface GitHubSessionResponse {
  readonly connected: boolean;
  readonly viewer: GitHubViewer | null;
  readonly accessTokenExpiresAtUtc: string | null;
  readonly installation: GitHubInstallationStatus | null;
}

export interface GitHubInstallationStatus {
  readonly installed: boolean;
  readonly canCreateRepositories: boolean;
  readonly installationId: number | null;
  readonly accountLogin: string | null;
  readonly accountType: string | null;
  readonly repositorySelection: string | null;
  readonly htmlUrl: string | null;
  readonly administrationWrite: boolean;
  readonly suspended: boolean;
}

export interface GitHubAppResponse {
  readonly configured: boolean;
  readonly appSlug: string | null;
  readonly clientId: string | null;
  readonly installUrl: string | null;
}

export interface CreateGitHubRepositoryRequest {
  readonly name: string;
  readonly description?: string;
  readonly private: boolean;
  readonly autoInit: boolean;
}

export interface CreatedGitHubRepository {
  readonly id: number;
  readonly name: string;
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly cloneUrl: string;
  readonly private: boolean;
  readonly defaultBranch: string;
}

class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

const GITHUB_OAUTH_RETURN_INTENT_KEY = "viritura.github.oauthReturn";

export type GitHubLoginSource = "activity" | "start-center";

export interface GitHubOAuthReturnIntent {
  readonly source: GitHubLoginSource;
}

export { getVirituraApiBaseUrl } from "../config";

export function getGitHubGitProxyUrl(apiBaseUrl = getVirituraApiBaseUrl()): string {
  return `${apiBaseUrl}/github/git`;
}

export function getGitHubLoginUrl(apiBaseUrl = getVirituraApiBaseUrl()): string {
  const returnTo =
    typeof window === "undefined"
      ? "/"
      : `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `${apiBaseUrl}/github/auth/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function beginGitHubLogin(apiBaseUrl = getVirituraApiBaseUrl(), source: GitHubLoginSource = "activity"): void {
  markGitHubOAuthReturnIntent(source);
  window.location.assign(getGitHubLoginUrl(apiBaseUrl));
}

export function markGitHubOAuthReturnIntent(source: GitHubLoginSource): void {
  try {
    sessionStorage.setItem(GITHUB_OAUTH_RETURN_INTENT_KEY, JSON.stringify({ source }));
  } catch {
    // Ignore storage failures; auth still works, but the boot UI may use its default launch behavior.
  }
}

export function consumeGitHubOAuthReturnIntent(): GitHubOAuthReturnIntent | null {
  try {
    const value = sessionStorage.getItem(GITHUB_OAUTH_RETURN_INTENT_KEY);
    if (value) {
      sessionStorage.removeItem(GITHUB_OAUTH_RETURN_INTENT_KEY);
    }

    if (!value) return null;
    if (value === "1") return { source: "activity" };

    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return { source: "activity" };
    const source = parsed.source;
    return { source: source === "start-center" ? "start-center" : "activity" };
  } catch {
    return null;
  }
}

export async function getGitHubSession(apiBaseUrl = getVirituraApiBaseUrl()): Promise<GitHubSessionResponse> {
  return await dedupedGetGitHubSession(apiBaseUrl);
}

/**
 * Reset the in-memory dedup cache for {@link getGitHubSession}. Call
 * after any mutation (link / unlink / sign-out) that could change the
 * GitHub connection state.
 */
function invalidateGitHubSessionCache(): void {
  ghSessionCache = null;
  ghSessionInFlight = null;
}

// Concurrent-mount dedup — see the matching note above `dedupedGetMe`
// in auth/api.ts. Same pattern, same justification: multiple hook
// callers + StrictMode used to fan out into ~10 simultaneous
// /github/session requests and contribute to the 429 cascade.
const GH_SESSION_CACHE_FRESH_MS = 1_000;
let ghSessionCache: { url: string; value: GitHubSessionResponse; at: number } | null = null;
let ghSessionInFlight: { url: string; promise: Promise<GitHubSessionResponse> } | null = null;

async function dedupedGetGitHubSession(apiBaseUrl: string): Promise<GitHubSessionResponse> {
  const url = `${apiBaseUrl}/github/session`;
  const now = Date.now();
  if (ghSessionCache && ghSessionCache.url === url && now - ghSessionCache.at < GH_SESSION_CACHE_FRESH_MS) {
    return ghSessionCache.value;
  }
  if (ghSessionInFlight && ghSessionInFlight.url === url) {
    return await ghSessionInFlight.promise;
  }
  const promise = fetchGitHubSession(url)
    .then((value) => {
      ghSessionCache = { url, value, at: Date.now() };
      return value;
    })
    .finally(() => {
      if (ghSessionInFlight && ghSessionInFlight.url === url) ghSessionInFlight = null;
    });
  ghSessionInFlight = { url, promise };
  return await promise;
}

async function fetchGitHubSession(url: string): Promise<GitHubSessionResponse> {
  try {
    return await apiFetch<GitHubSessionResponse>(url, { method: "GET" });
  } catch (error) {
    // /github/session now requires Viritura auth. Anonymous callers are simply "not connected".
    if (error instanceof GitHubApiError && error.status === 401) {
      return { connected: false, viewer: null, accessTokenExpiresAtUtc: null, installation: null };
    }
    throw error;
  }
}

export async function getGitHubAppMetadata(apiBaseUrl = getVirituraApiBaseUrl()): Promise<GitHubAppResponse> {
  return await apiFetch<GitHubAppResponse>(`${apiBaseUrl}/github/app`, { method: "GET" });
}

export async function unlinkGitHub(
  payload: { currentPassword?: string } = {},
  apiBaseUrl = getVirituraApiBaseUrl(),
): Promise<void> {
  const csrf = await getCsrfToken(apiBaseUrl, { force: true });
  try {
    await apiFetch<void>(`${apiBaseUrl}/github/auth/unlink`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [csrf.headerName]: csrf.token,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // If the Viritura session is already gone, the unlink endpoint returns 401. Treat as success.
    if (error instanceof GitHubApiError && error.status === 401) {
      invalidateGitHubSessionCache();
      return;
    }
    throw error;
  }
  invalidateGitHubSessionCache();
}

export async function createGitHubRepository(
  request: CreateGitHubRepositoryRequest,
  apiBaseUrl = getVirituraApiBaseUrl(),
): Promise<CreatedGitHubRepository> {
  const csrf = await getCsrfToken(apiBaseUrl, { force: true });
  const payload = await apiFetch<Record<string, unknown>>(`${apiBaseUrl}/github/repositories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [csrf.headerName]: csrf.token,
    },
    body: JSON.stringify({
      name: request.name,
      description: request.description?.trim() || undefined,
      private: request.private,
      autoInit: request.autoInit,
    }),
  });
  return readRepository(payload);
}

async function apiFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await readJsonObject(response);
  if (!response.ok) {
    throw new GitHubApiError(
      getPayloadMessage(payload) ?? `Viritura API returned ${response.status}.`,
      response.status,
    );
  }

  return payload as T;
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPayloadMessage(payload: Record<string, unknown>): string | null {
  const message = payload.message ?? payload.error;
  return typeof message === "string" && message.trim() ? message : null;
}

function readRepository(payload: Record<string, unknown>): CreatedGitHubRepository {
  return {
    id: getNumber(payload, "id"),
    name: getString(payload, "name"),
    fullName: getString(payload, "fullName"),
    htmlUrl: getString(payload, "htmlUrl"),
    cloneUrl: getString(payload, "cloneUrl"),
    private: getBoolean(payload, "private"),
    defaultBranch: getString(payload, "defaultBranch"),
  };
}

function getString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new GitHubApiError(`GitHub response did not include ${key}.`);
  }
  return value;
}

function getNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number") {
    throw new GitHubApiError(`GitHub response did not include ${key}.`);
  }
  return value;
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean {
  const value = payload[key];
  if (typeof value !== "boolean") {
    throw new GitHubApiError(`GitHub response did not include ${key}.`);
  }
  return value;
}

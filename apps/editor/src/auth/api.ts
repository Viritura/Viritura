import { getVirituraApiBaseUrl } from "../github/api";

export interface VirituraExternalLogin {
  readonly provider: string;
  readonly providerKey: string;
  readonly displayName: string | null;
}

export interface VirituraUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly hasPassword: boolean;
  readonly externalLogins: readonly VirituraExternalLogin[];
}

export interface MeResponse {
  readonly authenticated: boolean;
  readonly user: VirituraUser | null;
}

export interface CsrfResponse {
  readonly token: string;
  readonly headerName: string;
}

export type RecentAuthAction =
  | "SetPassword"
  | "ChangeEmail"
  | "DeleteAccount"
  | "UnlinkLogin"
  | "LinkLogin"
  | "ManageTwoFactor";

const TWO_FACTOR_REQUIRED_PARAM = "two_factor_required";

export function hasPendingTwoFactorChallenge(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(TWO_FACTOR_REQUIRED_PARAM) === "1";
}

export function clearPendingTwoFactorChallenge(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(TWO_FACTOR_REQUIRED_PARAM)) return;
  url.searchParams.delete(TWO_FACTOR_REQUIRED_PARAM);
  window.history.replaceState({}, "", url.toString());
}

export type EmailRegistrationMode = "Open" | "AllowList" | "Disabled";

export interface AuthCapabilities {
  readonly gitHubLoginEnabled: boolean;
  readonly googleLoginEnabled: boolean;
  readonly emailRegistrationMode: EmailRegistrationMode;
}

export interface RegisterPayload {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export interface LoginPayload {
  readonly email: string;
  readonly password: string;
  readonly rememberMe?: boolean;
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors?: Readonly<Record<string, readonly string[]>>,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

interface ValidationProblemDetails {
  readonly title?: string;
  readonly detail?: string;
  readonly errors?: Record<string, readonly string[]>;
}

let cachedCsrf: { token: string; headerName: string } | null = null;

export function getVirituraAuthBaseUrl(): string {
  return getVirituraApiBaseUrl();
}

export async function getMe(apiBaseUrl = getVirituraAuthBaseUrl()): Promise<MeResponse> {
  return await dedupedGetMe(apiBaseUrl);
}

export async function getAuthCapabilities(apiBaseUrl = getVirituraAuthBaseUrl()): Promise<AuthCapabilities> {
  return await jsonFetch<AuthCapabilities>(`${apiBaseUrl}/auth/capabilities`, { method: "GET" });
}

/**
 * Reset the in-memory dedup cache for {@link getMe}. Call after any
 * mutation (sign-in / sign-out / link / unlink) that could change
 * the authenticated identity, so the next {@link getMe} call hits the
 * server instead of returning a stale cached result.
 */
export function invalidateMeCache(): void {
  meCache = null;
  meInFlight = null;
}

// Concurrent-mount dedup. Multiple components (`AccountButton`,
// `WriteView`, `LiveSessionProvider`, `StartCenter`, `useReviewSession`)
// each instantiate `useVirituraAccount` independently and refresh on
// mount, which — doubled by React StrictMode — used to fan out into
// ~10 concurrent /auth/me hits and trip the API rate-limiter into 429s
// for guests. We coalesce concurrent calls onto one in-flight Promise
// and serve a 1-second-fresh cached result to subsequent callers; that
// cuts the boot wave to a single request without affecting
// focus/visibility refreshes (which fire seconds later).
const ME_CACHE_FRESH_MS = 1_000;
let meCache: { url: string; value: MeResponse; at: number } | null = null;
let meInFlight: { url: string; promise: Promise<MeResponse> } | null = null;

async function dedupedGetMe(apiBaseUrl: string): Promise<MeResponse> {
  const url = `${apiBaseUrl}/auth/me`;
  const now = Date.now();
  if (meCache && meCache.url === url && now - meCache.at < ME_CACHE_FRESH_MS) {
    return meCache.value;
  }
  if (meInFlight && meInFlight.url === url) {
    return await meInFlight.promise;
  }
  const promise = jsonFetch<MeResponse>(url, { method: "GET" })
    .then((value) => {
      meCache = { url, value, at: Date.now() };
      return value;
    })
    .finally(() => {
      if (meInFlight && meInFlight.url === url) meInFlight = null;
    });
  meInFlight = { url, promise };
  return await promise;
}

export async function getCsrfToken(
  apiBaseUrl = getVirituraAuthBaseUrl(),
  options?: { readonly force?: boolean },
): Promise<{ token: string; headerName: string }> {
  if (!options?.force && cachedCsrf) {
    return cachedCsrf;
  }
  const response = await jsonFetch<CsrfResponse>(`${apiBaseUrl}/auth/csrf`, { method: "GET" });
  cachedCsrf = { token: response.token, headerName: response.headerName };
  return cachedCsrf;
}

export async function getRecentAuthStatus(
  action: RecentAuthAction,
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<boolean> {
  const result = await jsonFetch<{ readonly satisfied: boolean }>(
    `${apiBaseUrl}/auth/recent/status?action=${encodeURIComponent(action)}`,
    { method: "GET" },
  );
  return result.satisfied;
}

export async function establishRecentAuthWithPassword(
  payload: { readonly action: RecentAuthAction; readonly password: string; readonly code?: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<void> {
  const csrf = await getCsrfToken(apiBaseUrl);
  try {
    await jsonFetch<void>(`${apiBaseUrl}/auth/recent/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [csrf.headerName]: csrf.token },
      body: JSON.stringify(payload),
    });
  } finally {
    cachedCsrf = null;
  }
}

export function getRecentAuthProviderUrl(
  provider: "Google" | "GitHub",
  action: RecentAuthAction,
  apiBaseUrl = getVirituraAuthBaseUrl(),
): string {
  const returnTo =
    typeof window === "undefined"
      ? "/"
      : `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `${apiBaseUrl}/auth/recent/provider/${provider}/start?action=${encodeURIComponent(action)}&returnTo=${encodeURIComponent(returnTo)}`;
}

export async function registerVirituraAccount(
  payload: RegisterPayload,
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<VirituraUser> {
  const result = await jsonFetch<VirituraUser>(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      displayName: payload.displayName,
    }),
  });
  invalidateMeCache();
  return result;
}

export async function loginVirituraAccount(
  payload: LoginPayload,
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<LoginResult> {
  const response = await jsonFetch<LoginResponseDto>(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      rememberMe: payload.rememberMe ?? true,
    }),
  });
  if (response.requiresTwoFactor) {
    return { status: "requiresTwoFactor" };
  }
  if (!response.user) {
    // Server promised user when requiresTwoFactor=false; treat as a hard failure.
    throw new AuthApiError("Unexpected login response.", 500);
  }
  invalidateMeCache();
  return { status: "signedIn", user: response.user };
}

interface LoginResponseDto {
  readonly requiresTwoFactor: boolean;
  readonly user: VirituraUser | null;
}

/**
 * Result of the password-step login. When the account has 2FA enabled the server completes the
 * password check but does NOT set the full auth cookie; the client must then call
 * <c>loginVirituraTwoFactor</c> or <c>loginVirituraRecovery</c> to finish.
 */
export type LoginResult =
  | { readonly status: "signedIn"; readonly user: VirituraUser }
  | { readonly status: "requiresTwoFactor" };

/**
 * Completes a 2FA-gated sign-in with a TOTP code. The 2FA-partial cookie set by
 * <c>loginVirituraAccount</c> is what authenticates this call; the cookie is exchanged for the
 * full auth cookie on success.
 */
export async function loginVirituraTwoFactor(
  payload: { code: string; rememberClient?: boolean },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<VirituraUser> {
  const user = await jsonFetch<VirituraUser>(`${apiBaseUrl}/auth/login/2fa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: payload.code, rememberClient: payload.rememberClient ?? false }),
  });
  invalidateMeCache();
  return user;
}

/** Completes a 2FA-gated sign-in with a single-use recovery code. */
export async function loginVirituraRecovery(
  payload: { code: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<VirituraUser> {
  const user = await jsonFetch<VirituraUser>(`${apiBaseUrl}/auth/login/recovery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: payload.code }),
  });
  invalidateMeCache();
  return user;
}

/**
 * Requests a "disable 2FA" recovery email for a user who has finished the password step
 * (i.e. holds the 2FA-partial cookie) but no longer has their authenticator or recovery
 * codes. The server always returns 204 — no leak of whether the cookie is valid, whether
 * the account has a confirmed mailbox, or whether the address is deliverable. The user
 * still has to click the link in the email to actually disable 2FA.
 */
export async function requestVirituraTwoFactorRecovery(apiBaseUrl = getVirituraAuthBaseUrl()): Promise<void> {
  await jsonFetch<void>(`${apiBaseUrl}/auth/login/2fa-recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Resends the email-verification link. The endpoint always returns 204 (the
 * server prevents account enumeration), so a caller can show a generic
 * "if that account exists, a new link is on the way" message.
 */
export async function resendVirituraVerification(email: string, apiBaseUrl = getVirituraAuthBaseUrl()): Promise<void> {
  await jsonFetch<void>(`${apiBaseUrl}/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export async function logoutVirituraAccount(apiBaseUrl = getVirituraAuthBaseUrl()): Promise<void> {
  const csrf = await getCsrfToken(apiBaseUrl);
  try {
    await jsonFetch<void>(`${apiBaseUrl}/auth/logout`, {
      method: "POST",
      headers: { [csrf.headerName]: csrf.token },
    });
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 401) {
      // Already signed out — treat as success.
      return;
    }
    throw error;
  } finally {
    // Antiforgery cookie rotates after a successful POST; bust the cache so the next call refetches.
    cachedCsrf = null;
    invalidateMeCache();
  }
}

/**
 * Signs the user out of *every* device by rolling the server-side security stamp. Other
 * sessions are invalidated the next time `SecurityStampValidator` rechecks them (default:
 * every 30 minutes). The current session is also signed out. Pair with a password change
 * when responding to a credential compromise.
 */
export async function logoutVirituraEverywhere(apiBaseUrl = getVirituraAuthBaseUrl()): Promise<void> {
  const csrf = await getCsrfToken(apiBaseUrl);
  try {
    await jsonFetch<void>(`${apiBaseUrl}/auth/logout-everywhere`, {
      method: "POST",
      headers: { [csrf.headerName]: csrf.token },
    });
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 401) {
      return;
    }
    throw error;
  } finally {
    cachedCsrf = null;
    invalidateMeCache();
  }
}

/**
 * Replaces the password on a signed-in account. Requires the current password
 * as a re-auth gate. Returns 204 on success; throws `AuthApiError` with
 * `fieldErrors.currentPassword` set when the current password is wrong, and
 * with `fieldErrors.newPassword` for policy violations on the new password.
 */
export async function changeVirituraPassword(
  payload: { currentPassword: string; newPassword: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<void> {
  await postAccount(`${apiBaseUrl}/account/password`, payload, apiBaseUrl);
}

/**
 * Sets an initial password for an OAuth-only account that has no password yet.
 * Server rejects with 409 if a password is already set.
 */
export async function setVirituraPassword(
  payload: { newPassword: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<void> {
  await postAccount(`${apiBaseUrl}/account/password/set`, payload, apiBaseUrl);
}

/**
 * Removes the password from an account that has at least one linked external
 * provider. Refuses (409) if the password is the only sign-in method. Requires
 * the current password as a re-auth gate.
 */
export async function removeVirituraPassword(
  payload: { currentPassword: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<void> {
  await postAccount(`${apiBaseUrl}/account/password/remove`, payload, apiBaseUrl);
}

/**
 * Removes a linked external provider (e.g. Google) from the signed-in account.
 * Refuses (409) when it would leave the user with no way to sign in. Requires the
 * current password as a re-auth gate when one is set; OAuth-only accounts skip the gate.
 */
export async function unlinkVirituraExternalLogin(
  payload: { provider: string; providerKey: string; currentPassword?: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<void> {
  await postAccount(`${apiBaseUrl}/account/unlink`, payload, apiBaseUrl);
}

/**
 * Permanently deletes the signed-in account. Requires the current password when one is set;
 * for OAuth-only accounts the live cookie + antiforgery token are the gate. The server clears
 * the auth cookie before deleting the user row, so the caller should drop its local
 * authenticated state on success.
 */
export async function deleteVirituraAccount(
  payload: { currentPassword?: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<void> {
  await postAccount(`${apiBaseUrl}/account/delete`, payload, apiBaseUrl);
}

/**
 * Kicks off the email-change two-step. The server emails a confirmation link to the NEW
 * address; clicking it lands on the website's confirm-email-change page which posts the token
 * back to <c>/auth/confirm-email-change</c> and finalizes the swap. Always returns 204 — the
 * server intentionally doesn't disclose whether the new address is already in use.
 */
export async function requestVirituraEmailChange(
  payload: { newEmail: string; currentPassword?: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<void> {
  await postAccount(`${apiBaseUrl}/account/email`, payload, apiBaseUrl);
}

/**
 * Updates the signed-in user's profile. Currently only display name is mutable.
 * Pass `null` or whitespace to clear it (server normalizes to null).
 */
export async function updateVirituraProfile(
  payload: { displayName?: string | null },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<void> {
  await postAccount(`${apiBaseUrl}/account/profile`, payload, apiBaseUrl);
}

async function postAccount(url: string, body: unknown, apiBaseUrl: string): Promise<void> {
  const csrf = await getCsrfToken(apiBaseUrl);
  try {
    await jsonFetch<void>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [csrf.headerName]: csrf.token },
      body: JSON.stringify(body),
    });
  } finally {
    // Antiforgery cookie rotates on POST; bust cache so the next request refetches.
    cachedCsrf = null;
  }
}

// ---- Two-factor authentication ---------------------------------------------------

export interface TwoFactorStatus {
  readonly enabled: boolean;
  readonly remainingRecoveryCodes: number;
}

export interface TwoFactorSetup {
  readonly secret: string;
  readonly otpAuthUri: string;
}

export interface TwoFactorRecoveryCodes {
  readonly recoveryCodes: readonly string[];
}

export async function getTwoFactorStatus(apiBaseUrl = getVirituraAuthBaseUrl()): Promise<TwoFactorStatus> {
  return await jsonFetch<TwoFactorStatus>(`${apiBaseUrl}/2fa/status`, { method: "GET" });
}

/** Generates (or regenerates) the authenticator shared secret. Doesn't enable 2FA yet. */
export async function setupTwoFactor(apiBaseUrl = getVirituraAuthBaseUrl()): Promise<TwoFactorSetup> {
  return await postAccountJson<TwoFactorSetup>(`${apiBaseUrl}/2fa/setup`, {}, apiBaseUrl);
}

/** Commits the pending pairing with a current TOTP code, returns one batch of recovery codes. */
export async function enableTwoFactor(
  payload: { code: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<TwoFactorRecoveryCodes> {
  return await postAccountJson<TwoFactorRecoveryCodes>(`${apiBaseUrl}/2fa/enable`, payload, apiBaseUrl);
}

export async function disableTwoFactor(
  payload: { code: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<void> {
  await postAccount(`${apiBaseUrl}/2fa/disable`, payload, apiBaseUrl);
}

export async function regenerateRecoveryCodes(
  payload: { code: string },
  apiBaseUrl = getVirituraAuthBaseUrl(),
): Promise<TwoFactorRecoveryCodes> {
  return await postAccountJson<TwoFactorRecoveryCodes>(`${apiBaseUrl}/2fa/recovery/regenerate`, payload, apiBaseUrl);
}

async function postAccountJson<T>(url: string, body: unknown, apiBaseUrl: string): Promise<T> {
  const csrf = await getCsrfToken(apiBaseUrl);
  try {
    return await jsonFetch<T>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [csrf.headerName]: csrf.token },
      body: JSON.stringify(body),
    });
  } finally {
    cachedCsrf = null;
  }
}

async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
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

  const payload = await readJson(response);
  if (!response.ok) {
    throw toAuthError(response.status, payload);
  }
  return payload as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toAuthError(status: number, payload: unknown): AuthApiError {
  if (isValidationProblem(payload)) {
    const fields = payload.errors ?? {};
    const firstMessage =
      Object.values(fields)
        .flat()
        .find((m): m is string => typeof m === "string" && m.length > 0) ?? payload.title;
    return new AuthApiError(firstMessage ?? `Request failed (${status}).`, status, fields);
  }
  if (isRecord(payload) && typeof payload.error === "string") {
    return new AuthApiError(payload.error, status);
  }
  return new AuthApiError(`Request failed (${status}).`, status);
}

function isValidationProblem(value: unknown): value is ValidationProblemDetails {
  return isRecord(value) && (isRecord(value.errors) || typeof value.title === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

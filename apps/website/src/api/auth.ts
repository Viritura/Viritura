/**
 * Thin wrapper around the auth endpoints we call from the marketing site.
 * Mirrors apps/editor/src/auth/api.ts but stays self-contained — the
 * website doesn't pull in the editor as a dependency.
 *
 * All calls send and receive cookies (credentials: 'include') so a successful
 * verification redirects into the editor with the user already signed in.
 */

const IS_DEV = import.meta.env.DEV;

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_VIRITURA_API_BASE_URL as string | undefined;
  if (configured?.trim()) return configured.replace(/\/+$/, "");
  return IS_DEV ? "https://localhost:5001" : "https://api.viritura.com";
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

interface ValidationProblem {
  readonly title?: string;
  readonly errors?: Record<string, string[]>;
}

type EmailRegistrationMode = "Open" | "AllowList" | "Disabled";

export interface AuthCapabilities {
  readonly googleLoginEnabled: boolean;
  readonly emailRegistrationMode: EmailRegistrationMode;
}

export async function getAuthCapabilities(): Promise<AuthCapabilities> {
  const response = await fetch(`${getApiBaseUrl()}/auth/capabilities`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new AuthApiError(`Request failed (${response.status})`, response.status);
  return (await response.json()) as AuthCapabilities;
}

async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  if (response.ok || response.status === 202) {
    if (response.status === 204) return undefined as TResponse;
    return (await response.json()) as TResponse;
  }

  // ValidationProblemDetails surface field errors; flatten the first message into .message.
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/problem+json") || contentType.includes("application/json")) {
    try {
      const problem = (await response.json()) as ValidationProblem;
      const firstError = Object.values(problem.errors ?? {})[0]?.[0];
      throw new AuthApiError(
        firstError ?? problem.title ?? `Request failed (${response.status})`,
        response.status,
        problem.errors,
      );
    } catch (parseError) {
      if (parseError instanceof AuthApiError) throw parseError;
      /* fall through */
    }
  }
  throw new AuthApiError(`Request failed (${response.status})`, response.status);
}

export interface RegisterRequest {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}

export interface RegisterPendingVerificationResponse {
  readonly email: string;
  readonly requiresVerification: boolean;
  /**
   * True when the submitted email is already attached to an OAuth-only account. The server
   * never accepts the submitted password in this case (it would be an account-takeover
   * vector); instead it emails a password-reset-style link the user can click to set the
   * password and finish linking. The check-email screen varies its copy on this flag.
   */
  readonly linkExistingAccount?: boolean;
}

export interface AuthUserResponse {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly hasPassword: boolean;
  readonly externalLogins: ReadonlyArray<{ provider: string; providerKey: string; displayName: string | null }>;
}

export function registerAccount(
  body: RegisterRequest,
): Promise<RegisterPendingVerificationResponse | AuthUserResponse> {
  return postJson<RegisterPendingVerificationResponse | AuthUserResponse>("/auth/register", body);
}

export function verifyEmail(uid: string, token: string): Promise<AuthUserResponse> {
  return postJson<AuthUserResponse>("/auth/verify", { uid, token });
}

export function resendVerification(email: string): Promise<void> {
  return postJson<void>("/auth/resend-verification", { email });
}

export function forgotPassword(email: string): Promise<void> {
  return postJson<void>("/auth/forgot-password", { email });
}

export function resetPassword(uid: string, token: string, newPassword: string): Promise<AuthUserResponse> {
  return postJson<AuthUserResponse>("/auth/reset-password", { uid, token, newPassword });
}

/**
 * Consumes a 2FA recovery token (received via email after clicking "lost your authenticator"
 * in the editor's 2FA prompt). On success the server clears the authenticator key, sets
 * <c>TwoFactorEnabled=false</c>, rolls the security stamp, and drops the full auth cookie —
 * the user lands signed in with no second factor required.
 */
export function disableTwoFactorByRecoveryToken(uid: string, token: string): Promise<AuthUserResponse> {
  return postJson<AuthUserResponse>("/auth/2fa/disable-by-recovery-token", { uid, token });
}

/**
 * Consumes the change-email token emailed by <c>POST /account/email</c>. On success the
 * account email + username swap to <c>newEmail</c>, the security stamp rolls, and the full
 * auth cookie is dropped so the landing page can redirect into the editor signed in.
 */
export function confirmEmailChange(uid: string, newEmail: string, token: string): Promise<AuthUserResponse> {
  return postJson<AuthUserResponse>("/auth/confirm-email-change", { uid, newEmail, token });
}

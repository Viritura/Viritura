/* eslint-disable react-refresh/only-export-components --
 * Canonical React Context module shape: the AccountProvider component
 * is colocated with the contexts it populates, the public
 * `useVirituraAccount` / `useGitHubAccount` hooks that read from those
 * contexts, and the re-exported types. Splitting would force ~10
 * consumer imports to fork without architectural benefit. */
/**
 * AccountContext — single-mount provider for both auth surfaces.
 *
 * Replaces the per-component `useVirituraAccount` / `useGitHubAccount`
 * hooks that each ran their own state machine. Previously, 4+ callers
 * (`AccountButton`, `WriteView`, `LiveSessionProvider`, `StartCenter`,
 * `useReviewSession`) instantiated each hook independently and refreshed
 * on mount; React 19 StrictMode doubled that, producing ~10 concurrent
 * /auth/me + /github/session hits per boot and tripping the API rate
 * limiter into 429s for guests joining via a live URL.
 *
 * With this provider the underlying state machines mount exactly once
 * per app instance. Consumers' hook calls become pure context reads with
 * no additional fetches and no per-call focus/visibility listeners.
 *
 * The in-memory dedup caches in `auth/api.ts` and `github/api.ts` are
 * kept as a defensive belt for any non-provider callers and to coalesce
 * StrictMode's dev-only effect double-fire on the provider itself.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  AuthApiError,
  getMe,
  loginVirituraAccount,
  loginVirituraRecovery,
  loginVirituraTwoFactor,
  logoutVirituraAccount,
  logoutVirituraEverywhere,
  registerVirituraAccount,
  type LoginPayload,
  type LoginResult,
  type MeResponse,
  type RegisterPayload,
  type VirituraUser,
} from "./api";
import {
  beginGitHubLogin,
  createGitHubRepository,
  getGitHubAppMetadata,
  getGitHubSession,
  getVirituraApiBaseUrl,
  unlinkGitHub,
  type CreateGitHubRepositoryRequest,
  type CreatedGitHubRepository,
  type GitHubAppResponse,
  type GitHubLoginSource,
  type GitHubSessionResponse,
} from "../github/api";

// ── Public types (re-exported by the shim hook modules) ──────────────────

type VirituraAccountStatus = "loading" | "ready" | "error";

export interface VirituraAccountState {
  readonly status: VirituraAccountStatus;
  readonly user: VirituraUser | null;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  /**
   * Submits the password step. Returns a discriminated result: when the account has 2FA enabled
   * the cookie session is not yet authenticated — the caller must follow up with
   * <c>signInTwoFactor</c> or <c>signInRecovery</c>.
   */
  readonly signIn: (payload: LoginPayload) => Promise<LoginResult>;
  readonly signInTwoFactor: (payload: { code: string; rememberClient?: boolean }) => Promise<VirituraUser>;
  readonly signInRecovery: (payload: { code: string }) => Promise<VirituraUser>;
  readonly register: (payload: RegisterPayload) => Promise<VirituraUser>;
  readonly signOut: () => Promise<void>;
  /**
   * Signs out of *every* device by rolling the server-side security stamp. Other sessions are
   * invalidated the next time SecurityStampValidator rechecks them (default: every 30 minutes).
   */
  readonly signOutEverywhere: () => Promise<void>;
}

type GitHubAccountStatus = "loading" | "ready" | "error";

export interface GitHubAccountState {
  readonly status: GitHubAccountStatus;
  readonly app: GitHubAppResponse | null;
  readonly session: GitHubSessionResponse | null;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly signIn: (source?: GitHubLoginSource) => void;
  readonly unlink: (options?: { currentPassword?: string }) => Promise<void>;
  readonly createRepository: (request: CreateGitHubRepositoryRequest) => Promise<CreatedGitHubRepository>;
}

// ── Contexts ────────────────────────────────────────────────────────────

const VirituraAccountContext = createContext<VirituraAccountState | null>(null);
const GitHubAccountContext = createContext<GitHubAccountState | null>(null);

// ── Internal state machines (mounted exactly once inside AccountProvider) ─

function useVirituraAccountStateMachine(): VirituraAccountState {
  const [status, setStatus] = useState<VirituraAccountStatus>("loading");
  const [user, setUser] = useState<VirituraUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const applyMe = useCallback((me: MeResponse): void => {
    setUser(me.authenticated ? me.user : null);
    setStatus("ready");
    setError(null);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setError(null);
    try {
      applyMe(await getMe());
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Account status is unavailable.");
    }
  }, [applyMe]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical fetch-on-mount: refresh() sets status to "loading" (already the initial value, so no cascading render on first mount) then transitions to ready/error after the network roundtrip. This IS the "subscribe and call setState in a callback" pattern the rule docs describe.
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = (): void => {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const signIn = useCallback(async (payload: LoginPayload): Promise<LoginResult> => {
    const result = await loginVirituraAccount(payload);
    if (result.status === "signedIn") {
      setUser(result.user);
      setStatus("ready");
      setError(null);
    }
    return result;
  }, []);

  const finishSecondFactor = useCallback((nextUser: VirituraUser): VirituraUser => {
    setUser(nextUser);
    setStatus("ready");
    setError(null);
    return nextUser;
  }, []);

  const signInTwoFactor = useCallback(
    async (payload: { code: string; rememberClient?: boolean }): Promise<VirituraUser> =>
      finishSecondFactor(await loginVirituraTwoFactor(payload)),
    [finishSecondFactor],
  );

  const signInRecovery = useCallback(
    async (payload: { code: string }): Promise<VirituraUser> =>
      finishSecondFactor(await loginVirituraRecovery(payload)),
    [finishSecondFactor],
  );

  const register = useCallback(async (payload: RegisterPayload): Promise<VirituraUser> => {
    const result = await registerVirituraAccount(payload);
    setUser(result);
    setStatus("ready");
    setError(null);
    return result;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await logoutVirituraAccount();
    } catch (err) {
      if (!(err instanceof AuthApiError && err.status === 401)) {
        throw err;
      }
    }
    setUser(null);
    setStatus("ready");
  }, []);

  const signOutEverywhere = useCallback(async (): Promise<void> => {
    try {
      await logoutVirituraEverywhere();
    } catch (err) {
      if (!(err instanceof AuthApiError && err.status === 401)) {
        throw err;
      }
    }
    setUser(null);
    setStatus("ready");
  }, []);

  return useMemo(
    () => ({
      status,
      user,
      error,
      refresh,
      signIn,
      signInTwoFactor,
      signInRecovery,
      register,
      signOut,
      signOutEverywhere,
    }),
    [status, user, error, refresh, signIn, signInTwoFactor, signInRecovery, register, signOut, signOutEverywhere],
  );
}

const DISCONNECTED_GITHUB_SESSION: GitHubSessionResponse = {
  connected: false,
  viewer: null,
  accessTokenExpiresAtUtc: null,
  installation: null,
};

function useGitHubAccountStateMachine(authenticated: boolean | null): GitHubAccountState {
  const apiBaseUrl = useMemo(() => getVirituraApiBaseUrl(), []);
  const [status, setStatus] = useState<GitHubAccountStatus>("loading");
  const [app, setApp] = useState<GitHubAppResponse | null>(null);
  const [session, setSession] = useState<GitHubSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const nextApp = await getGitHubAppMetadata(apiBaseUrl);
      setApp(nextApp);
      // `/github/session` is intentionally protected. Do not create a noisy,
      // expected 401 while the user is signed out or before `/auth/me` has
      // established their state.
      if (authenticated === null) return;
      const nextSession = authenticated ? await getGitHubSession(apiBaseUrl) : DISCONNECTED_GITHUB_SESSION;
      setSession(nextSession);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "GitHub account status is unavailable.");
    }
  }, [apiBaseUrl, authenticated]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical fetch-on-mount: refresh() sets status to "loading" (already the initial value, so no cascading render on first mount) then transitions to ready/error after the network roundtrip.
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const unlink = useCallback(
    async (options: { currentPassword?: string } = {}) => {
      await unlinkGitHub(options, apiBaseUrl);
      await refresh();
    },
    [apiBaseUrl, refresh],
  );

  const createRepository = useCallback(
    async (request: CreateGitHubRepositoryRequest) => {
      return await createGitHubRepository(request, apiBaseUrl);
    },
    [apiBaseUrl],
  );

  const signIn = useCallback(
    (source: GitHubLoginSource = "activity") => beginGitHubLogin(apiBaseUrl, source),
    [apiBaseUrl],
  );

  return useMemo(
    () => ({
      status,
      app,
      session,
      error,
      refresh,
      signIn,
      unlink,
      createRepository,
    }),
    [status, app, session, error, refresh, signIn, unlink, createRepository],
  );
}

// ── Provider ────────────────────────────────────────────────────────────

export interface AccountProviderProps {
  readonly children: ReactNode;
}

/**
 * Mount once at the app root, above any consumer of
 * {@link useVirituraAccount} or {@link useGitHubAccount}. Owns the
 * single Viritura `/auth/me` polling loop and the single GitHub
 * `/github/session` + `/github/app` polling loop; downstream hooks
 * become pure context reads.
 */
export function AccountProvider({ children }: AccountProviderProps) {
  const viritura = useVirituraAccountStateMachine();
  const github = useGitHubAccountStateMachine(viritura.status === "loading" ? null : viritura.user !== null);
  return (
    <VirituraAccountContext.Provider value={viritura}>
      <GitHubAccountContext.Provider value={github}>{children}</GitHubAccountContext.Provider>
    </VirituraAccountContext.Provider>
  );
}

// ── Public hooks ────────────────────────────────────────────────────────

export function useVirituraAccount(): VirituraAccountState {
  const value = useContext(VirituraAccountContext);
  if (!value) {
    throw new Error("useVirituraAccount must be used inside <AccountProvider>. Mount AccountProvider at the app root.");
  }
  return value;
}

export function useGitHubAccount(): GitHubAccountState {
  const value = useContext(GitHubAccountContext);
  if (!value) {
    throw new Error("useGitHubAccount must be used inside <AccountProvider>. Mount AccountProvider at the app root.");
  }
  return value;
}

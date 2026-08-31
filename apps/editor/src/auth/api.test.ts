import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `auth/api` module caches the CSRF token in a module-level singleton (`cachedCsrf`). To get
// a clean slate per test, we reset modules in `beforeEach` and re-import. We also mock fetch on
// `globalThis`. All API functions take an explicit `apiBaseUrl` so we never hit `import.meta.env`.

type FetchMock = ReturnType<typeof vi.fn>;

interface MockResponseInit {
  readonly status?: number;
  readonly body?: unknown;
  readonly contentType?: string;
}

function mockResponse(init: MockResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers: Record<string, string> = {};
  let bodyText: string;
  if (init.body === undefined) {
    bodyText = "";
  } else if (typeof init.body === "string") {
    bodyText = init.body;
    headers["Content-Type"] = init.contentType ?? "text/plain";
  } else {
    bodyText = JSON.stringify(init.body);
    headers["Content-Type"] = init.contentType ?? "application/json";
  }
  return new Response(bodyText, { status, headers });
}

const API = "https://api.test";

async function loadApi() {
  vi.resetModules();
  return await import("./api");
}

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCsrfToken", () => {
  it("fetches once and caches the token across subsequent calls", async () => {
    const { getCsrfToken } = await loadApi();
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { token: "tok-1", headerName: "X-CSRF" } }));

    const first = await getCsrfToken(API);
    const second = await getCsrfToken(API);

    expect(first).toEqual({ token: "tok-1", headerName: "X-CSRF" });
    expect(second).toEqual({ token: "tok-1", headerName: "X-CSRF" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/auth/csrf`);
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("force: true bypasses the cache", async () => {
    const { getCsrfToken } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "tok-1", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ body: { token: "tok-2", headerName: "X-CSRF" } }));

    await getCsrfToken(API);
    const refreshed = await getCsrfToken(API, { force: true });

    expect(refreshed.token).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a successful logout busts the cache", async () => {
    const { getCsrfToken, logoutVirituraAccount } = await loadApi();
    fetchMock
      // First csrf
      .mockResolvedValueOnce(mockResponse({ body: { token: "tok-1", headerName: "X-CSRF" } }))
      // Logout
      .mockResolvedValueOnce(mockResponse({ status: 204 }))
      // Next csrf after cache bust
      .mockResolvedValueOnce(mockResponse({ body: { token: "tok-2", headerName: "X-CSRF" } }));

    await getCsrfToken(API);
    await logoutVirituraAccount(API);
    const refreshed = await getCsrfToken(API);

    expect(refreshed.token).toBe("tok-2");
  });
});

describe("getMe", () => {
  it("returns the parsed envelope", async () => {
    const { getMe } = await loadApi();
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { authenticated: false, user: null } }));

    const me = await getMe(API);

    expect(me).toEqual({ authenticated: false, user: null });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/auth/me`);
  });
});

describe("getAuthCapabilities", () => {
  it("returns the server-authoritative provider and registration state", async () => {
    const { getAuthCapabilities } = await loadApi();
    const capabilities = { googleLoginEnabled: false, emailRegistrationMode: "AllowList" };
    fetchMock.mockResolvedValueOnce(mockResponse({ body: capabilities }));

    await expect(getAuthCapabilities(API)).resolves.toEqual(capabilities);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/auth/capabilities`);
  });
});

describe("registerVirituraAccount", () => {
  it("posts the payload as JSON and returns the user", async () => {
    const { registerVirituraAccount } = await loadApi();
    const user = {
      id: "u1",
      email: "a@b.test",
      displayName: "A",
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ body: user }));

    const result = await registerVirituraAccount({ email: "a@b.test", password: "Hunter22!!", displayName: "A" }, API);

    expect(result).toEqual(user);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: "a@b.test",
      password: "Hunter22!!",
      displayName: "A",
    });
  });
});

describe("loginVirituraAccount", () => {
  it("returns 'signedIn' with the user when the server returns one", async () => {
    const { loginVirituraAccount } = await loadApi();
    const user = {
      id: "u1",
      email: "a@b.test",
      displayName: null,
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { requiresTwoFactor: false, user } }));

    const result = await loginVirituraAccount({ email: "a@b.test", password: "pw" }, API);

    expect(result).toEqual({ status: "signedIn", user });
  });

  it("returns 'requiresTwoFactor' when the server says so", async () => {
    const { loginVirituraAccount } = await loadApi();
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { requiresTwoFactor: true, user: null } }));

    const result = await loginVirituraAccount({ email: "a@b.test", password: "pw" }, API);

    expect(result).toEqual({ status: "requiresTwoFactor" });
  });

  it("defaults rememberMe to true when caller doesn't specify", async () => {
    const { loginVirituraAccount } = await loadApi();
    const user = {
      id: "u1",
      email: "a@b.test",
      displayName: null,
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { requiresTwoFactor: false, user } }));

    await loginVirituraAccount({ email: "a@b.test", password: "pw" }, API);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).rememberMe).toBe(true);
  });

  it("throws when server returns requiresTwoFactor=false without a user", async () => {
    const { loginVirituraAccount, AuthApiError } = await loadApi();
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { requiresTwoFactor: false, user: null } }));

    await expect(loginVirituraAccount({ email: "a@b.test", password: "pw" }, API)).rejects.toBeInstanceOf(AuthApiError);
  });
});

describe("loginVirituraTwoFactor", () => {
  it("posts the code with rememberClient defaulting to false", async () => {
    const { loginVirituraTwoFactor } = await loadApi();
    const user = {
      id: "u1",
      email: "a@b.test",
      displayName: null,
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ body: user }));

    await loginVirituraTwoFactor({ code: "123456" }, API);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/auth/login/2fa`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ code: "123456", rememberClient: false });
  });

  it("forwards rememberClient=true when provided", async () => {
    const { loginVirituraTwoFactor } = await loadApi();
    const user = {
      id: "u1",
      email: "a@b.test",
      displayName: null,
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ body: user }));

    await loginVirituraTwoFactor({ code: "123456", rememberClient: true }, API);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).rememberClient).toBe(true);
  });
});

describe("logoutVirituraAccount", () => {
  it("sends the CSRF token in the configured header", async () => {
    const { logoutVirituraAccount } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "tok-x", headerName: "X-VIRITURA-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 204 }));

    await logoutVirituraAccount(API);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${API}/auth/logout`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-VIRITURA-CSRF"]).toBe("tok-x");
  });

  it("treats a 401 as success (already signed out)", async () => {
    const { logoutVirituraAccount } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "tok-x", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 401, body: { error: "unauthenticated" } }));

    await expect(logoutVirituraAccount(API)).resolves.toBeUndefined();
  });

  it("re-throws non-401 errors", async () => {
    const { logoutVirituraAccount, AuthApiError } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "tok-x", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 500, body: { error: "boom" } }));

    await expect(logoutVirituraAccount(API)).rejects.toBeInstanceOf(AuthApiError);
  });
});

describe("logoutVirituraEverywhere", () => {
  it("posts to /auth/logout-everywhere with the CSRF header", async () => {
    const { logoutVirituraEverywhere } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "t", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 204 }));

    await logoutVirituraEverywhere(API);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${API}/auth/logout-everywhere`);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ "X-CSRF": "t" });
  });

  it("treats a 401 as success", async () => {
    const { logoutVirituraEverywhere } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "t", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 401 }));

    await expect(logoutVirituraEverywhere(API)).resolves.toBeUndefined();
  });
});

describe("resendVirituraVerification", () => {
  it("returns void on 204 with no parsing of the body", async () => {
    const { resendVirituraVerification } = await loadApi();
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));

    await expect(resendVirituraVerification("a@b.test", API)).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: "a@b.test" });
  });
});

describe("requestVirituraTwoFactorRecovery", () => {
  it("posts an empty JSON body to /auth/login/2fa-recover", async () => {
    const { requestVirituraTwoFactorRecovery } = await loadApi();
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));

    await requestVirituraTwoFactorRecovery(API);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/auth/login/2fa-recover`);
    expect((init as RequestInit).method).toBe("POST");
  });
});

describe("account mutations (CSRF + payload)", () => {
  it("changeVirituraPassword posts to /account/password with CSRF", async () => {
    const { changeVirituraPassword } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "t", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 204 }));

    await changeVirituraPassword({ currentPassword: "old", newPassword: "newPassw0rd!" }, API);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${API}/account/password`);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ "X-CSRF": "t", "Content-Type": "application/json" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      currentPassword: "old",
      newPassword: "newPassw0rd!",
    });
  });

  it("unlinkVirituraExternalLogin forwards currentPassword when provided", async () => {
    const { unlinkVirituraExternalLogin } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "t", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 204 }));

    await unlinkVirituraExternalLogin({ provider: "Google", providerKey: "abc", currentPassword: "pw" }, API);

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toEqual({ provider: "Google", providerKey: "abc", currentPassword: "pw" });
  });

  it("updateVirituraProfile posts the displayName field", async () => {
    const { updateVirituraProfile } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "t", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 204 }));

    await updateVirituraProfile({ displayName: "Alice" }, API);

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toEqual({ displayName: "Alice" });
  });

  it("deleteVirituraAccount works without a password (OAuth-only path)", async () => {
    const { deleteVirituraAccount } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "t", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 204 }));

    await deleteVirituraAccount({}, API);

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toEqual({});
  });

  it("requestVirituraEmailChange posts new email + optional password", async () => {
    const { requestVirituraEmailChange } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "t", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ status: 204 }));

    await requestVirituraEmailChange({ newEmail: "new@test.test", currentPassword: "pw" }, API);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${API}/account/email`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      newEmail: "new@test.test",
      currentPassword: "pw",
    });
  });
});

describe("two-factor management", () => {
  it("setupTwoFactor returns the secret + uri", async () => {
    const { setupTwoFactor } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "t", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ body: { secret: "SECRET", otpAuthUri: "otpauth://..." } }));

    const setup = await setupTwoFactor(API);

    expect(setup).toEqual({ secret: "SECRET", otpAuthUri: "otpauth://..." });
  });

  it("enableTwoFactor returns the recovery codes", async () => {
    const { enableTwoFactor } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { token: "t", headerName: "X-CSRF" } }))
      .mockResolvedValueOnce(mockResponse({ body: { recoveryCodes: ["a-b", "c-d"] } }));

    const result = await enableTwoFactor({ code: "123456" }, API);

    expect(result.recoveryCodes).toEqual(["a-b", "c-d"]);
  });
});

describe("error mapping", () => {
  it("translates a ValidationProblemDetails response into AuthApiError with fieldErrors", async () => {
    const { registerVirituraAccount, AuthApiError } = await loadApi();
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        contentType: "application/problem+json",
        body: {
          title: "One or more validation errors occurred.",
          errors: { email: ["Email is already taken."] },
        },
      }),
    );

    const err = await registerVirituraAccount({ email: "a@b.test", password: "pw", displayName: "A" }, API).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(AuthApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Email is already taken.");
    expect(err.fieldErrors).toEqual({ email: ["Email is already taken."] });
  });

  it("falls back to the problem title when no field errors are present", async () => {
    const { registerVirituraAccount } = await loadApi();
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        body: { title: "Validation failed.", errors: {} },
      }),
    );

    const err = (await registerVirituraAccount({ email: "a@b.test", password: "pw", displayName: "A" }, API).catch(
      (e) => e,
    )) as Error;

    expect(err.message).toBe("Validation failed.");
  });

  it("uses the {error: '...'} shape when the server returns a flat error", async () => {
    const { loginVirituraAccount, AuthApiError } = await loadApi();
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 401, body: { error: "Invalid email or password." } }));

    const err = (await loginVirituraAccount({ email: "a@b.test", password: "wrong" }, API).catch(
      (e) => e,
    )) as InstanceType<typeof AuthApiError>;

    expect(err).toBeInstanceOf(AuthApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("Invalid email or password.");
  });

  it("falls back to a generic 'Request failed (N)' when payload has no recognized shape", async () => {
    const { loginVirituraAccount, AuthApiError } = await loadApi();
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 500, body: "" }));

    const err = (await loginVirituraAccount({ email: "a@b.test", password: "pw" }, API).catch(
      (e) => e,
    )) as InstanceType<typeof AuthApiError>;

    expect(err).toBeInstanceOf(AuthApiError);
    expect(err.status).toBe(500);
    expect(err.message).toBe("Request failed (500).");
  });
});

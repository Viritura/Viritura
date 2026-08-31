import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The website's auth API resolves its base URL via `import.meta.env.VITE_VIRITURA_API_BASE_URL`.
// We don't pin a value here — each test asserts only the *path* portion of the URL the wrapper
// hit, ignoring whatever default base the module computed for the test environment.

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

function lastCall(): { url: string; init: RequestInit } {
  const calls = fetchMock.mock.calls;
  const [url, init] = calls[calls.length - 1];
  return { url: String(url), init: init as RequestInit };
}

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getApiBaseUrl", () => {
  it("strips trailing slashes and returns a non-empty string", async () => {
    const { getApiBaseUrl } = await import("./auth");
    const url = getApiBaseUrl();
    expect(url).toBeTypeOf("string");
    expect(url.length).toBeGreaterThan(0);
    expect(url.endsWith("/")).toBe(false);
  });
});

describe("getAuthCapabilities", () => {
  it("gets public provider and registration availability", async () => {
    const { getAuthCapabilities } = await import("./auth");
    const capabilities = { googleLoginEnabled: false, emailRegistrationMode: "AllowList" };
    fetchMock.mockResolvedValueOnce(mockResponse({ body: capabilities }));

    await expect(getAuthCapabilities()).resolves.toEqual(capabilities);
    const { url, init } = lastCall();
    expect(url.endsWith("/auth/capabilities")).toBe(true);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
  });
});

describe("registerAccount", () => {
  it("posts the body to /auth/register with credentials included", async () => {
    const { registerAccount } = await import("./auth");
    const pending = { email: "a@b.test", requiresVerification: true };
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 202, body: pending }));

    const result = await registerAccount({ email: "a@b.test", password: "Hunter22!!", displayName: "A" });

    expect(result).toEqual(pending);
    const { url, init } = lastCall();
    expect(url.endsWith("/auth/register")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@b.test",
      password: "Hunter22!!",
      displayName: "A",
    });
  });

  it("treats 200 (already-signed-in response) as a success", async () => {
    const { registerAccount } = await import("./auth");
    const user = {
      id: "u1",
      email: "a@b.test",
      displayName: null,
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: user }));

    const result = await registerAccount({ email: "a@b.test", password: "pw" });

    expect(result).toEqual(user);
  });
});

describe("verifyEmail", () => {
  it("posts uid + token and returns the AuthUserResponse", async () => {
    const { verifyEmail } = await import("./auth");
    const user = {
      id: "u1",
      email: "a@b.test",
      displayName: null,
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: user }));

    const result = await verifyEmail("uid-1", "tok-1");

    expect(result).toEqual(user);
    const { url, init } = lastCall();
    expect(url.endsWith("/auth/verify")).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ uid: "uid-1", token: "tok-1" });
  });
});

describe("resendVerification", () => {
  it("returns void on 204", async () => {
    const { resendVerification } = await import("./auth");
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));

    await expect(resendVerification("a@b.test")).resolves.toBeUndefined();
    const { url, init } = lastCall();
    expect(url.endsWith("/auth/resend-verification")).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.test" });
  });
});

describe("forgotPassword", () => {
  it("posts to /auth/forgot-password and returns void", async () => {
    const { forgotPassword } = await import("./auth");
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));

    await expect(forgotPassword("a@b.test")).resolves.toBeUndefined();
    const { url } = lastCall();
    expect(url.endsWith("/auth/forgot-password")).toBe(true);
  });
});

describe("resetPassword", () => {
  it("posts the new password with uid + token", async () => {
    const { resetPassword } = await import("./auth");
    const user = {
      id: "u1",
      email: "a@b.test",
      displayName: null,
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: user }));

    const result = await resetPassword("uid-1", "tok-1", "NewPassw0rd!");

    expect(result).toEqual(user);
    const { url, init } = lastCall();
    expect(url.endsWith("/auth/reset-password")).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      uid: "uid-1",
      token: "tok-1",
      newPassword: "NewPassw0rd!",
    });
  });
});

describe("confirmEmailChange", () => {
  it("posts uid + newEmail + token to /auth/confirm-email-change", async () => {
    const { confirmEmailChange } = await import("./auth");
    const user = {
      id: "u1",
      email: "new@b.test",
      displayName: null,
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: user }));

    const result = await confirmEmailChange("uid-1", "new@b.test", "tok-1");

    expect(result.email).toBe("new@b.test");
    const { url, init } = lastCall();
    expect(url.endsWith("/auth/confirm-email-change")).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      uid: "uid-1",
      newEmail: "new@b.test",
      token: "tok-1",
    });
  });
});

describe("disableTwoFactorByRecoveryToken", () => {
  it("posts uid + token to /auth/2fa/disable-by-recovery-token", async () => {
    const { disableTwoFactorByRecoveryToken } = await import("./auth");
    const user = {
      id: "u1",
      email: "a@b.test",
      displayName: null,
      avatarUrl: null,
      hasPassword: true,
      externalLogins: [],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: user }));

    const result = await disableTwoFactorByRecoveryToken("uid-1", "tok-1");

    expect(result).toEqual(user);
    const { url, init } = lastCall();
    expect(url.endsWith("/auth/2fa/disable-by-recovery-token")).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ uid: "uid-1", token: "tok-1" });
  });
});

describe("error mapping", () => {
  it("translates a ValidationProblemDetails response into AuthApiError with fieldErrors", async () => {
    const { resetPassword, AuthApiError } = await import("./auth");
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        contentType: "application/problem+json",
        body: {
          title: "One or more validation errors occurred.",
          errors: { newPassword: ["Password is too short."] },
        },
      }),
    );

    const err = (await resetPassword("uid", "tok", "short").catch((e) => e)) as InstanceType<typeof AuthApiError>;

    expect(err).toBeInstanceOf(AuthApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Password is too short.");
    expect(err.fieldErrors).toEqual({ newPassword: ["Password is too short."] });
  });

  it("falls back to the problem title when errors is empty", async () => {
    const { verifyEmail } = await import("./auth");
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        body: { title: "Verification failed.", errors: {} },
      }),
    );

    const err = (await verifyEmail("uid", "tok").catch((e) => e)) as Error;

    expect(err.message).toBe("Verification failed.");
  });

  it("returns a generic 'Request failed (N)' when payload is not parseable", async () => {
    const { verifyEmail, AuthApiError } = await import("./auth");
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 500, body: "not-json", contentType: "text/plain" }));

    const err = (await verifyEmail("uid", "tok").catch((e) => e)) as InstanceType<typeof AuthApiError>;

    expect(err).toBeInstanceOf(AuthApiError);
    expect(err.status).toBe(500);
    expect(err.message).toBe("Request failed (500)");
  });
});

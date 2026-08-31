import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { AccountProvider, useGitHubAccount, useVirituraAccount } from "./AccountContext";

// vitest.setup.ts enables RTL's `reactStrictMode`, so every render below mounts
// with the mount→cleanup→mount effect double-invoke. These tests exist because
// that double-invoke previously fanned out into ~10 concurrent /auth/me and
// /github/session requests and tripped the API rate limiter into 429s.

const USER = {
  id: "user-1",
  email: "composer@viritura.test",
  displayName: "Composer",
  avatarUrl: null,
  hasPassword: true,
  externalLogins: [],
};

const GITHUB_APP = { configured: true, appSlug: "viritura", clientId: "cid", installUrl: null };
const GITHUB_SESSION = { connected: false, viewer: null, accessTokenExpiresAtUtc: null, installation: null };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;
let authenticated: boolean;

// The dedup caches in auth/api.ts and github/api.ts key off `Date.now()` with a
// 1s freshness window. A controlled clock lets each test start cache-cold and
// stay frozen mid-test so the window can't lapse under a slow CI run.
let clock = 1_700_000_000_000;

function requestCount(path: string): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(path)).length;
}

function Probe() {
  const auth = useVirituraAccount();
  const github = useGitHubAccount();
  return <div data-testid="probe">{`${auth.status}|${auth.user?.email ?? "none"}|${github.status}`}</div>;
}

function renderProvider() {
  return render(
    <AccountProvider>
      <Probe />
    </AccountProvider>,
  );
}

function probeText(): string {
  return screen.getByTestId("probe").textContent ?? "";
}

beforeEach(() => {
  authenticated = false;
  clock += 10_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);

  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return Promise.resolve(json({ authenticated, user: authenticated ? USER : null }));
    if (url.endsWith("/github/app")) return Promise.resolve(json(GITHUB_APP));
    if (url.endsWith("/github/session")) return Promise.resolve(json(GITHUB_SESSION));
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AccountProvider under StrictMode", () => {
  it("issues a single /auth/me request across the mount double-invoke", async () => {
    renderProvider();

    await waitFor(() => expect(probeText()).toContain("ready|none"));
    expect(requestCount("/auth/me")).toBe(1);
  });

  it("issues a single /github/session request for a signed-in user", async () => {
    authenticated = true;
    renderProvider();

    await waitFor(() => expect(probeText()).toBe(`ready|${USER.email}|ready`));
    expect(requestCount("/auth/me")).toBe(1);
    expect(requestCount("/github/session")).toBe(1);
  });

  it("removes every focus and visibility listener on unmount", async () => {
    const windowAdd = vi.spyOn(window, "addEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const documentAdd = vi.spyOn(document, "addEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");

    const view = renderProvider();
    await waitFor(() => expect(probeText()).toContain("ready"));
    view.unmount();

    const count = (spy: ReturnType<typeof vi.spyOn>, type: string): number =>
      spy.mock.calls.filter(([event]) => event === type).length;
    expect(count(windowAdd, "focus")).toBeGreaterThan(0);
    expect(count(windowRemove, "focus")).toBe(count(windowAdd, "focus"));
    expect(count(documentRemove, "visibilitychange")).toBe(count(documentAdd, "visibilitychange"));
  });

  it("re-resolves account state after a full unmount and remount", async () => {
    const view = renderProvider();
    await waitFor(() => expect(probeText()).toContain("ready|none"));
    view.unmount();

    authenticated = true;
    clock += 10_000;
    renderProvider();

    await waitFor(() => expect(probeText()).toContain(`ready|${USER.email}`));
    expect(requestCount("/auth/me")).toBe(2);
  });
});

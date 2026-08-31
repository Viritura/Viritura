import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeGitHubOAuthReturnIntent,
  createGitHubRepository,
  getGitHubGitProxyUrl,
  getGitHubLoginUrl,
  getGitHubSession,
  markGitHubOAuthReturnIntent,
} from "../github/api";

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  fetchMock.mockReset();
});

describe("GitHub API client", () => {
  it("builds an auth URL with the current browser location as returnTo", () => {
    window.history.pushState(null, "", "/score?panel=github#measure-4");

    const url = getGitHubLoginUrl("https://localhost:5001");

    expect(url).toContain("https://localhost:5001/github/auth/start?returnTo=");
    expect(decodeURIComponent(url.split("returnTo=")[1] ?? "")).toBe(
      "http://localhost:3000/score?panel=github#measure-4",
    );
  });

  it("loads session state with credentials", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ connected: false, viewer: null, accessTokenExpiresAtUtc: null, installation: null }),
    );

    const session = await getGitHubSession("https://localhost:5001");

    expect(session.connected).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://localhost:5001/github/session",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("builds the git smart HTTP proxy URL", () => {
    expect(getGitHubGitProxyUrl("https://localhost:5001")).toBe("https://localhost:5001/github/git");
  });

  it("tracks one boot after returning from GitHub OAuth", () => {
    expect(consumeGitHubOAuthReturnIntent()).toBeNull();

    markGitHubOAuthReturnIntent("start-center");

    expect(consumeGitHubOAuthReturnIntent()).toEqual({ source: "start-center" });
    expect(consumeGitHubOAuthReturnIntent()).toBeNull();
  });

  it("creates a GitHub repository without exposing a brokered token", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "csrf-123", headerName: "X-XSRF-TOKEN" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 42,
          name: "viritura-score",
          fullName: "peter/viritura-score",
          htmlUrl: "https://github.com/peter/viritura-score",
          cloneUrl: "https://github.com/peter/viritura-score.git",
          private: true,
          defaultBranch: "main",
        }),
      );

    const repository = await createGitHubRepository(
      {
        name: "viritura-score",
        description: "Score project",
        private: true,
        autoInit: true,
      },
      "https://localhost:5001",
    );

    expect(repository.fullName).toBe("peter/viritura-score");
    expect(repository.cloneUrl).toBe("https://github.com/peter/viritura-score.git");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://localhost:5001/auth/csrf",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://localhost:5001/github/repositories",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        headers: expect.objectContaining({ "X-XSRF-TOKEN": "csrf-123" }),
        body: JSON.stringify({
          name: "viritura-score",
          description: "Score project",
          private: true,
          autoInit: true,
        }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("token-123");
  });

  it("explains GitHub App installation permission failures", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "csrf-123", headerName: "X-XSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ error: "The GitHub installation cannot create repositories." }, 403));

    await expect(
      createGitHubRepository(
        {
          name: "viritura-score",
          private: true,
          autoInit: true,
        },
        "https://localhost:5001",
      ),
    ).rejects.toThrow("The GitHub installation cannot create repositories");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { createCredentialedGitHttpClient } from "../gitHttpClient";

describe("credentialed Git HTTP client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds the antiforgery token to smart HTTP POST requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createCredentialedGitHttpClient(async () => ({
      token: "csrf-123",
      headerName: "X-XSRF-TOKEN",
    }));

    await client.request({
      url: "https://api.example.test/github/git/github.com/peter/quartet.git/git-upload-pack",
      method: "POST",
      headers: { "Content-Type": "application/x-git-upload-pack-request" },
      body: oneChunk(new Uint8Array([1, 2, 3])),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/github/git/github.com/peter/quartet.git/git-upload-pack",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/x-git-upload-pack-request",
          "X-XSRF-TOKEN": "csrf-123",
        }),
      }),
    );
  });

  it("does not request an antiforgery token for ref discovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const csrfTokenProvider = vi.fn();
    const client = createCredentialedGitHttpClient(csrfTokenProvider);

    await client.request({
      url: "https://api.example.test/github/git/github.com/peter/quartet.git/info/refs?service=git-upload-pack",
      method: "GET",
      headers: {},
    });

    expect(csrfTokenProvider).not.toHaveBeenCalled();
  });
});

async function* oneChunk(chunk: Uint8Array): AsyncIterableIterator<Uint8Array> {
  yield chunk;
}

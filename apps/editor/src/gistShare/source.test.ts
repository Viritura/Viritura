import { describe, expect, it, vi } from "vitest";
import { buildGistShareUrl, loadGistMnx, parseGistUrl, readGistShareLocation } from ".";

const GIST_ID = "0123456789abcdef0123456789abcdef";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const VALID_MNX = JSON.stringify({
  mnx: {
    version: 1,
  },
  global: {
    measures: [],
  },
  parts: [],
});

function gistResponse(files: Record<string, object>, options: { revision?: string } = {}): Response {
  return new Response(
    JSON.stringify({
      id: GIST_ID,
      html_url: `https://gist.github.com/example/${GIST_ID}`,
      history: [{ version: options.revision ?? REVISION }],
      files,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function mnxFile(content: string | null = VALID_MNX, truncated = false): object {
  return {
    filename: "score.mnx",
    content,
    truncated,
    raw_url: `https://gist.githubusercontent.com/example/${GIST_ID}/raw/${REVISION}/score.mnx`,
  };
}

describe("Gist sharing source", () => {
  it("accepts only main gist.github.com URLs", () => {
    expect(parseGistUrl(`https://gist.github.com/example/${GIST_ID}`)).toEqual({ id: GIST_ID });
    expect(() => parseGistUrl(`https://example.com/example/${GIST_ID}`)).toThrow("gist.github.com");
    expect(() => parseGistUrl(`https://gist.github.com/example/${GIST_ID}/raw`)).toThrow("main URL");
  });

  it("builds latest links by default and adds a revision query parameter when pinned", () => {
    expect(buildGistShareUrl("https://app.viritura.com", GIST_ID)).toBe(
      `https://app.viritura.com/s/gist#id=${GIST_ID}`,
    );
    const pinned = buildGistShareUrl("https://app.viritura.com", GIST_ID, REVISION);
    expect(pinned).toBe(`https://app.viritura.com/s/gist?revision=${REVISION}#id=${GIST_ID}`);
    const location = new URL(pinned);
    expect(readGistShareLocation({ hash: location.hash, search: location.search })).toEqual({
      gistId: GIST_ID,
      revision: REVISION,
    });
  });

  it("loads and parses the only MNX file", async () => {
    const fetchImpl = vi.fn(async () => gistResponse({ "score.mnx": mnxFile() }));
    const result = await loadGistMnx({ gistId: GIST_ID }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.github.com/gists/${GIST_ID}`,
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/vnd.github+json" }) }),
    );
    expect(result.fileName).toBe("score.mnx");
    expect(result.revision).toBe(REVISION);
    expect(result.score.parts).toEqual([]);
  });

  it("requires exactly one MNX file", async () => {
    const none = vi.fn(async () => gistResponse({ "notes.txt": { ...mnxFile(), filename: "notes.txt" } }));
    await expect(loadGistMnx({ gistId: GIST_ID }, none)).rejects.toThrow("does not contain an .mnx file");

    const two = vi.fn(async () =>
      gistResponse({
        "one.mnx": { ...mnxFile(), filename: "one.mnx" },
        "two.mnx": { ...mnxFile(), filename: "two.mnx" },
      }),
    );
    await expect(loadGistMnx({ gistId: GIST_ID }, two)).rejects.toThrow("exactly one");
  });

  it("loads truncated content from GitHub's validated raw URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(gistResponse({ "score.mnx": mnxFile(null, true) }))
      .mockResolvedValueOnce(new Response(VALID_MNX, { status: 200 }));

    const result = await loadGistMnx({ gistId: GIST_ID, revision: REVISION }, fetchImpl);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `https://api.github.com/gists/${GIST_ID}/${REVISION}`,
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL(`https://gist.githubusercontent.com/example/${GIST_ID}/raw/${REVISION}/score.mnx`),
    );
    expect(result.mnx).toBe(VALID_MNX);
  });

  it("reports GitHub anonymous rate limiting explicitly", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    await expect(loadGistMnx({ gistId: GIST_ID }, fetchImpl)).rejects.toThrow("anonymous request limit");
  });
});

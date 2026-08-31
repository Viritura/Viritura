/**
 * Media download tests.
 *
 * A demo clip is fetched whole before it plays, which is what keeps seeking
 * instant and — more importantly — what keeps the request in CORS mode under the
 * editor's `COEP: require-corp`. These cover the parts of that path a user would
 * otherwise experience as a picture that silently never appears.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMediaBlob, looksLikeVideoFile, VIDEO_FILE_ACCEPT } from "../mediaBinding";

function streamResponse(chunks: Uint8Array[], contentLength: number | null) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers(contentLength === null ? {} : { "content-length": String(contentLength) }),
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length ? { done: false, value: chunks[index++]! } : { done: true, value: undefined },
      }),
    },
    blob: async () => new Blob(chunks as BlobPart[]),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMediaBlob", () => {
  it("requests in CORS mode without credentials", async () => {
    const fetchMock = vi.fn(async () => streamResponse([new Uint8Array([1])], 1));
    vi.stubGlobal("fetch", fetchMock);

    await fetchMediaBlob("https://example.test/clip.webm");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/clip.webm",
      expect.objectContaining({ mode: "cors", credentials: "omit" }),
    );
  });

  it("reports progress as a fraction of the declared length", async () => {
    const chunks = [new Uint8Array(4), new Uint8Array(4), new Uint8Array(2)];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse(chunks, 10)),
    );

    const seen: (number | null)[] = [];
    const blob = await fetchMediaBlob("https://example.test/clip.webm", (fraction) => seen.push(fraction));

    expect(seen).toEqual([0.4, 0.8, 1]);
    expect(blob.size).toBe(10);
  });

  it("reports unknown progress when the host declares no length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([new Uint8Array(3)], null)),
    );

    const seen: (number | null)[] = [];
    await fetchMediaBlob("https://example.test/clip.webm", (fraction) => seen.push(fraction));

    expect(seen).toEqual([null]);
  });

  it("throws with the status so a blocked or missing clip is actionable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, headers: new Headers(), body: null })),
    );

    await expect(fetchMediaBlob("https://example.test/gone.webm")).rejects.toThrow("404");
  });

  it("propagates an abort so a superseding attach is not overwritten", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    );

    await expect(fetchMediaBlob("https://example.test/clip.webm")).rejects.toThrow("Aborted");
  });
});

describe("supported picture containers", () => {
  it.each(["reference.mp4", "reference.M4V", "picture-lock.mov", "browser-proxy.webm"])("accepts %s", (name) => {
    expect(looksLikeVideoFile(name)).toBe(true);
  });

  it.each(["camera-original.mts", "broadcast-master.mxf", "legacy.avi", "download.mkv", "legacy.ogv"])(
    "rejects %s with conversion guidance",
    (name) => {
      expect(looksLikeVideoFile(name)).toBe(false);
    },
  );

  it("advertises only the supported containers to the file picker", () => {
    expect(VIDEO_FILE_ACCEPT).toContain(".mov");
    expect(VIDEO_FILE_ACCEPT).toContain(".mp4");
    expect(VIDEO_FILE_ACCEPT).toContain(".m4v");
    expect(VIDEO_FILE_ACCEPT).toContain(".webm");
    expect(VIDEO_FILE_ACCEPT).not.toContain("video/*");
  });
});

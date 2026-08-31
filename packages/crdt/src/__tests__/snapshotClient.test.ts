/**
 * Snapshot client + LiveSession snapshot-sidecar tests.
 *
 * createHttpSnapshotClient is covered by lightweight fetch-mock tests
 * (network shape only — the round-trip integration is covered in
 * server/Viritura.Api.Tests/SnapshotEndpointTests.cs).
 *
 * createLiveSession's snapshot wiring is covered with an in-memory
 * SnapshotClient stub so the test runs without DOM / fetch.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { createLiveSession } from "../LiveSession";
import { MnxYjsBridge } from "../MnxYjsBridge";
import { createHttpSnapshotClient, type SnapshotClient } from "../snapshotClient";

describe("createHttpSnapshotClient", () => {
  const url = "https://api.example.test/live/room/abcdefghij234567/snapshot";
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns null when the server responds with 404", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" })) as typeof fetch;
    const client = createHttpSnapshotClient(url);
    await expect(client.fetch()).resolves.toBeNull();
  });

  it("returns the response bytes on 200", async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    globalThis.fetch = vi.fn(async () => new Response(payload, { status: 200 })) as typeof fetch;
    const client = createHttpSnapshotClient(url);
    const result = await client.fetch();
    expect(result).not.toBeNull();
    expect(Array.from(result!)).toEqual([1, 2, 3, 4, 5]);
  });

  it("throws on non-2xx, non-404 responses", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 500, statusText: "Server Error" }),
    ) as typeof fetch;
    const client = createHttpSnapshotClient(url);
    await expect(client.fetch()).rejects.toThrow(/500/);
  });

  it("uploads bytes via PUT with octet-stream content type", async () => {
    let captured: { method?: string; contentType?: string | null; body?: ArrayBuffer } | null = null;
    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      captured = {
        method: init?.method,
        contentType: headers.get("content-type"),
        body: init?.body as ArrayBuffer,
      };
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const client = createHttpSnapshotClient(url);
    await client.upload(new Uint8Array([9, 8, 7]));

    expect(captured).not.toBeNull();
    expect(captured!.method).toBe("PUT");
    expect(captured!.contentType).toBe("application/octet-stream");
  });

  it("throws on upload failure", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 413 })) as typeof fetch;
    const client = createHttpSnapshotClient(url);
    await expect(client.upload(new Uint8Array([1]))).rejects.toThrow(/413/);
  });
});

describe("createLiveSession snapshot wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeStubClient(
    initialBytes: Uint8Array | null,
  ): SnapshotClient & { uploads: Uint8Array[]; fetchCalls: number } {
    const uploads: Uint8Array[] = [];
    let fetchCalls = 0;
    const client = {
      uploads,
      get fetchCalls() {
        return fetchCalls;
      },
      async fetch() {
        fetchCalls++;
        return initialBytes;
      },
      async upload(bytes: Uint8Array) {
        uploads.push(bytes);
      },
    };
    return client as SnapshotClient & { uploads: Uint8Array[]; fetchCalls: number };
  }

  it("applies a fetched snapshot to the Y.Doc before snapshotReady resolves", async () => {
    // Build a producer doc through the bridge so the snapshot bytes use
    // the same structural shape the consumer side expects.
    const producerBridge = new MnxYjsBridge();
    producerBridge.setMnxJson('{"hello":"world"}');
    const snapshotBytes = Y.encodeStateAsUpdate(producerBridge.doc);

    const stub = makeStubClient(snapshotBytes);
    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
      snapshot: stub,
    });

    // snapshotReady resolves after fetch + applyUpdate.
    await session.snapshotReady;
    expect(session.bridge.getMnxJson()).toBe('{"hello":"world"}');
    expect(stub.fetchCalls).toBe(1);
    session.destroy();
  });

  it("does nothing when the snapshot endpoint returns null", async () => {
    const stub = makeStubClient(null);
    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
      snapshot: stub,
    });
    await session.snapshotReady;
    expect(session.bridge.getMnxJson()).toBe("");
    session.destroy();
  });

  it("uploads a debounced snapshot when the bridge mutates", async () => {
    const stub = makeStubClient(null);
    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
      snapshot: stub,
    });
    await session.snapshotReady;

    session.bridge.setMnxJson('{"a":1}');
    // No upload yet — debounce hasn't fired.
    expect(stub.uploads.length).toBe(0);

    session.bridge.setMnxJson('{"a":2}');
    // Still no upload — the second write resets the debounce timer.
    expect(stub.uploads.length).toBe(0);

    await vi.advanceTimersByTimeAsync(2_000);
    // Flush any microtasks the async upload kicked off.
    await Promise.resolve();
    expect(stub.uploads.length).toBe(1);

    // The uploaded bytes should reconstruct the latest doc state.
    const replica = new MnxYjsBridge();
    Y.applyUpdate(replica.doc, stub.uploads[0]!);
    expect(JSON.parse(replica.getMnxJson())).toEqual({ a: 2 });
    session.destroy();
  });

  it("does not upload an echo of the snapshot it just applied", async () => {
    const producerBridge = new MnxYjsBridge();
    producerBridge.setMnxJson('{"hello":"world"}');
    const snapshotBytes = Y.encodeStateAsUpdate(producerBridge.doc);

    const stub = makeStubClient(snapshotBytes);
    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
      snapshot: stub,
    });
    await session.snapshotReady;

    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    // The snapshot-origin transaction must NOT have queued an upload.
    expect(stub.uploads.length).toBe(0);
    session.destroy();
  });

  it("snapshotReady resolves immediately when no snapshot client is configured", async () => {
    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
    });
    await session.snapshotReady; // shouldn't hang
    session.destroy();
  });

  it("destroy() cancels a pending upload before it fires", async () => {
    const stub = makeStubClient(null);
    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
      snapshot: stub,
    });
    await session.snapshotReady;

    session.bridge.setMnxJson('{"a":1}');
    expect(stub.uploads.length).toBe(0); // debounced

    session.destroy();
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();

    // The pending upload must not have fired after destroy.
    expect(stub.uploads.length).toBe(0);
  });

  it("ignores a snapshot that arrives after destroy()", async () => {
    // Build a snapshot client whose fetch we control manually so we can
    // interleave destroy() with the in-flight HTTP response.
    let resolveFetch: ((bytes: Uint8Array | null) => void) | null = null;
    const stub: SnapshotClient = {
      fetch: () =>
        new Promise<Uint8Array | null>((resolve) => {
          resolveFetch = resolve;
        }),
      upload: async () => {
        /* noop */
      },
    };

    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
      snapshot: stub,
    });

    // Sanity: bridge is empty pre-fetch.
    expect(session.bridge.getMnxJson()).toBe("");

    // Tear the session down while the fetch is in flight.
    session.destroy();

    // Now resolve the fetch with a non-trivial payload.
    const producerBridge = new MnxYjsBridge();
    producerBridge.setMnxJson('{"shouldnt":"apply"}');
    const bytes = Y.encodeStateAsUpdate(producerBridge.doc);
    resolveFetch!(bytes);
    await session.snapshotReady;

    // The destroyed doc must NOT have been mutated. Reading bridge after
    // destroy is allowed (the Y containers are still in memory) but it
    // should remain empty because the destroyed guard prevented the apply.
    expect(session.bridge.getMnxJson()).toBe("");
  });

  it("continues uploading even after the initial snapshot fetch failed", async () => {
    const stub: SnapshotClient & { uploads: Uint8Array[] } = {
      uploads: [],
      fetch: async () => {
        throw new Error("network down");
      },
      upload: async (bytes: Uint8Array) => {
        stub.uploads.push(bytes);
      },
    };

    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
      snapshot: stub,
    });

    // snapshotReady still resolves cleanly — fetch failure is swallowed.
    await session.snapshotReady;

    session.bridge.setMnxJson('{"recovered":true}');
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();

    expect(stub.uploads.length).toBe(1);
    const replica = new MnxYjsBridge();
    Y.applyUpdate(replica.doc, stub.uploads[0]!);
    expect(JSON.parse(replica.getMnxJson())).toEqual({ recovered: true });
    session.destroy();
  });

  it("an upload-side failure does not poison the next debounced upload", async () => {
    let failNext = true;
    const stub: SnapshotClient & { uploads: Uint8Array[] } = {
      uploads: [],
      fetch: async () => null,
      upload: async (bytes: Uint8Array) => {
        if (failNext) {
          failNext = false;
          throw new Error("transient 502");
        }
        stub.uploads.push(bytes);
      },
    };

    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
      snapshot: stub,
    });
    await session.snapshotReady;

    session.bridge.setMnxJson('{"v":1}');
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    expect(stub.uploads.length).toBe(0); // first attempt threw

    session.bridge.setMnxJson('{"v":2}');
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    expect(stub.uploads.length).toBe(1); // second attempt landed
    session.destroy();
  });

  it("a burst of writes collapses into one upload", async () => {
    const stub = makeStubClient(null);
    const session = createLiveSession({
      initialAwareness: { identity: { userId: "u1", displayName: "u1" }, mode: "normal" },
      snapshot: stub,
    });
    await session.snapshotReady;

    for (let i = 0; i < 10; i++) {
      session.bridge.setMnxJson(`{"i":${i}}`);
      // Advance just under the debounce window each time — the timer
      // should keep getting reset.
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(stub.uploads.length).toBe(0);

    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    expect(stub.uploads.length).toBe(1);

    const replica = new MnxYjsBridge();
    Y.applyUpdate(replica.doc, stub.uploads[0]!);
    expect(JSON.parse(replica.getMnxJson())).toEqual({ i: 9 });
    session.destroy();
  });
});

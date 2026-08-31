import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LOCAL_WRITE_ORIGIN, MnxYjsBridge } from "../MnxYjsBridge";

const sampleScore = () =>
  JSON.stringify({
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [{ measures: [{}] }],
  });

describe("MnxYjsBridge", () => {
  it("returns an empty string for a fresh doc", () => {
    const bridge = new MnxYjsBridge();
    expect(bridge.getMnxJson()).toBe("");
  });

  it("round-trips MNX JSON through structural sync", () => {
    const bridge = new MnxYjsBridge();
    const mnx = sampleScore();
    bridge.setMnxJson(mnx);
    expect(JSON.parse(bridge.getMnxJson())).toEqual(JSON.parse(mnx));
  });

  it("no-ops when setting identical contents", () => {
    const bridge = new MnxYjsBridge();
    const mnx = sampleScore();
    bridge.setMnxJson(mnx);

    let updateCount = 0;
    bridge.doc.on("update", () => updateCount++);
    bridge.setMnxJson(mnx);
    expect(updateCount).toBe(0);
  });

  it("does not fire onRemoteUpdate for local writes", () => {
    const bridge = new MnxYjsBridge();
    const received: string[] = [];
    bridge.onRemoteUpdate((mnx) => received.push(mnx));
    bridge.setMnxJson(JSON.stringify({ a: 1 }));
    bridge.setMnxJson(JSON.stringify({ a: 2 }));
    expect(received).toEqual([]);
  });

  it("fires onRemoteUpdate when a separate doc applies an update", () => {
    // Simulate the network: doc A writes, the update binary is shipped to
    // doc B, which applies it. Doc B's subscriber should see the new MNX.
    const a = new MnxYjsBridge();
    const b = new MnxYjsBridge();

    a.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_WRITE_ORIGIN) {
        // Apply on B with a non-local origin so its subscriber treats it as remote.
        Y.applyUpdate(b.doc, update, "from-network");
      }
    });

    const received: string[] = [];
    b.onRemoteUpdate((mnx) => received.push(mnx));

    const payload = JSON.stringify({ measures: 4 });
    a.setMnxJson(payload);

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]!)).toEqual({ measures: 4 });
    expect(JSON.parse(b.getMnxJson())).toEqual({ measures: 4 });
  });

  it("replaces existing contents on a subsequent setMnxJson", () => {
    const bridge = new MnxYjsBridge();
    bridge.setMnxJson(JSON.stringify({ a: 1, b: 2 }));
    bridge.setMnxJson(JSON.stringify({ c: 3 }));
    expect(JSON.parse(bridge.getMnxJson())).toEqual({ c: 3 });
  });

  it("emits compact deltas for small edits (no seed-chunk artifacts)", () => {
    // Validates the win from the Y.Text → structural-sync migration: a
    // one-field change on a populated doc must produce a tiny update
    // message, not anything resembling a re-seed of the whole doc.
    const bridge = new MnxYjsBridge();
    const seed = JSON.stringify({
      mnx: { version: 1 },
      parts: Array.from({ length: 20 }, () => ({
        measures: Array.from({ length: 50 }, () => ({ sequences: [] })),
      })),
    });
    bridge.setMnxJson(seed);
    const seededStateBytes = Y.encodeStateAsUpdate(bridge.doc).length;

    let editDeltaBytes = 0;
    bridge.doc.on("update", (u: Uint8Array) => {
      editDeltaBytes = u.length;
    });

    const edited = JSON.parse(seed) as { mnx: { version: number } };
    edited.mnx.version = 2;
    bridge.setMnxJson(JSON.stringify(edited));

    expect(editDeltaBytes).toBeGreaterThan(0);
    // The edit delta should be < 1% of the full state. (Reality is far
    // smaller — typically tens of bytes — but 1% gives plenty of slack
    // against Yjs framing changes.)
    expect(editDeltaBytes).toBeLessThan(seededStateBytes / 100);
  });

  it("supports concurrent edits to disjoint fields without single-writer interleaving", () => {
    // The Y.Text bridge produced JSON garbage when two peers wrote the
    // same Y.Text concurrently because the CRDT interleaved their
    // characters. Structural Y.Map projection eliminates that hazard:
    // edits to different fields touch different Y.Map slots and merge
    // cleanly.
    const a = new MnxYjsBridge();
    const b = new MnxYjsBridge();
    const initial = JSON.stringify({ tempo: 120, title: "" });
    a.setMnxJson(initial);
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    // A edits tempo, B edits title — concurrently, no exchange yet.
    a.setMnxJson(JSON.stringify({ tempo: 144, title: "" }));
    b.setMnxJson(JSON.stringify({ tempo: 120, title: "Allegro" }));

    // Exchange updates in both directions.
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));

    // Both peers converge to the same state, with each field carrying
    // the most-recent value (Y.Map last-write-wins per key).
    const aFinal = JSON.parse(a.getMnxJson()) as Record<string, unknown>;
    const bFinal = JSON.parse(b.getMnxJson()) as Record<string, unknown>;
    expect(aFinal).toEqual(bFinal);
    expect(aFinal.tempo).toBe(144);
    expect(aFinal.title).toBe("Allegro");
  });
});

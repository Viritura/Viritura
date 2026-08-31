import { describe, it, expect } from "vitest";
import { LayoutCoalescer } from "../layoutCoalescer";

/**
 * The coalescer must (a) never enqueue more than one pending layout, (b) fire
 * the latest pending request once the in-flight one resolves, (c) union the
 * changed-measure sets across dropped edits, and (d) rebuild the patch from the
 * *current* serializer cache at fire time so a dropped edit's content is never
 * lost.
 */

interface FireRecord {
  json: string;
  global: number[];
  part: Array<[number, number[]]>;
  full: boolean; // patchInfo undefined → full layout
  fallback?: string;
  timeSignatureSettings: boolean;
}

/** A controllable dispatch: each call returns a promise we resolve manually. */
function makeHarness() {
  const fired: FireRecord[] = [];
  let resolveCurrent: (() => void) | null = null;

  // buildPatch echoes the union it was asked for so tests can assert it.
  const buildPatch = (global: number[], part: Map<number, number[]>, timeSignatureSettings: boolean): string =>
    JSON.stringify({ global, part: [...part], timeSignatureSettings });

  const dispatch = (json: string, patchInfo: unknown): Promise<void> => {
    const pi = patchInfo as
      | {
          changedGlobalMeasures: number[];
          changedPartMeasures: Map<number, number[]>;
          fallbackJson?: () => string;
          timeSignatureSettingsChange?: boolean;
        }
      | undefined;
    fired.push({
      json,
      global: pi ? pi.changedGlobalMeasures : [],
      part: pi ? [...pi.changedPartMeasures] : [],
      full: pi === undefined,
      fallback: pi?.fallbackJson?.(),
      timeSignatureSettings: pi?.timeSignatureSettingsChange ?? false,
    });
    return new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
  };

  const coalescer = new LayoutCoalescer(buildPatch, dispatch);

  // Resolve the in-flight layout and let the drain microtask run.
  const settle = async (): Promise<void> => {
    const r = resolveCurrent;
    resolveCurrent = null;
    r?.();
    // flush the .finally() + drain() microtasks
    await Promise.resolve();
    await Promise.resolve();
  };

  return { coalescer, fired, settle, isInFlight: () => resolveCurrent !== null };
}

describe("LayoutCoalescer", () => {
  it("fires immediately when idle", () => {
    const h = makeHarness();
    h.coalescer.submit({
      json: "a",
      changedGlobalMeasures: [1],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    expect(h.fired).toHaveLength(1);
    expect(h.fired[0]!.json).toBe("a");
    expect(h.fired[0]!.global).toEqual([1]);
  });

  it("coalesces a burst onto one pending request (latest JSON wins, measures unioned)", async () => {
    const h = makeHarness();
    // A fires; B, C, D arrive while A is in flight.
    h.coalescer.submit({
      json: "A",
      changedGlobalMeasures: [1],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "B",
      changedGlobalMeasures: [2],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "C",
      changedGlobalMeasures: [1],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "D",
      changedGlobalMeasures: [5],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });

    // Only A dispatched so far (B/C/D folded into pending).
    expect(h.fired).toHaveLength(1);
    expect(h.fired[0]!.json).toBe("A");

    // A resolves → the single pending fires with latest JSON + unioned measures.
    await h.settle();
    expect(h.fired).toHaveLength(2);
    expect(h.fired[1]!.json).toBe("D");
    expect(h.fired[1]!.global.sort()).toEqual([1, 2, 5]); // union of B,C,D
  });

  it("keeps the latest pending edit's lazy fallback", async () => {
    const h = makeHarness();
    h.coalescer.submit({
      json: "A",
      fallbackJson: () => "full-A",
      changedGlobalMeasures: [1],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "B",
      fallbackJson: () => "full-B",
      changedGlobalMeasures: [2],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "C",
      fallbackJson: () => "full-C",
      changedGlobalMeasures: [3],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });

    await h.settle();
    expect(h.fired[1]!.fallback).toBe("full-C");
  });

  it("unions part measures across dropped edits", async () => {
    const h = makeHarness();
    // A fires immediately (idle) with part0/m3 — it completes on the engine, so
    // it is NOT part of the pending union. B and C fold into one pending request.
    h.coalescer.submit({
      json: "A",
      changedGlobalMeasures: [],
      changedPartMeasures: new Map([[0, [3]]]),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "B",
      changedGlobalMeasures: [],
      changedPartMeasures: new Map([[0, [4]]]),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "C",
      changedGlobalMeasures: [],
      changedPartMeasures: new Map([[1, [3]]]),
      structuralChange: false,
    });
    await h.settle();
    expect(h.fired[1]!.json).toBe("C");
    const part = new Map(h.fired[1]!.part);
    expect([...(part.get(0) ?? [])]).toEqual([4]); // B only (A's m3 already dispatched)
    expect([...(part.get(1) ?? [])]).toEqual([3]); // C
  });

  it("settles a burst in 2 dispatches, not N", async () => {
    const h = makeHarness();
    for (let i = 0; i < 6; i++) {
      h.coalescer.submit({
        json: `e${i}`,
        changedGlobalMeasures: [i],
        changedPartMeasures: new Map(),
        structuralChange: false,
      });
    }
    expect(h.fired).toHaveLength(1); // only the first fired; 5 folded into pending
    await h.settle();
    expect(h.fired).toHaveLength(2); // the coalesced pending
    expect(h.fired[1]!.json).toBe("e5");
    await h.settle();
    expect(h.fired).toHaveLength(2); // nothing left pending — no extra dispatch
  });

  it("a coalesced structural change forces a full layout", async () => {
    const h = makeHarness();
    h.coalescer.submit({
      json: "A",
      changedGlobalMeasures: [1],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });

    h.coalescer.submit({
      json: "B",
      changedGlobalMeasures: [2],
      changedPartMeasures: new Map(),
      structuralChange: true,
    });
    await h.settle();
    expect(h.fired[1]!.json).toBe("B");
    expect(h.fired[1]!.full).toBe(true); // structural → undefined patchInfo → full layout
  });

  it("dispatches a time-signature-only edit through the patch path", () => {
    const h = makeHarness();
    h.coalescer.submit({
      json: "",
      changedGlobalMeasures: [],
      changedPartMeasures: new Map(),
      structuralChange: false,
      timeSignatureSettingsChange: true,
    });

    expect(h.fired).toHaveLength(1);
    expect(h.fired[0]!.full).toBe(false);
    expect(h.fired[0]!.timeSignatureSettings).toBe(true);
  });

  it("keeps measure edits when coalescing a time-signature change", async () => {
    const h = makeHarness();
    h.coalescer.submit({
      json: "A",
      changedGlobalMeasures: [],
      changedPartMeasures: new Map([[0, [1]]]),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "B",
      changedGlobalMeasures: [],
      changedPartMeasures: new Map([[0, [2]]]),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "C",
      changedGlobalMeasures: [],
      changedPartMeasures: new Map(),
      structuralChange: false,
      timeSignatureSettingsChange: true,
    });

    await h.settle();
    expect(h.fired[1]!.part).toEqual([[0, [2]]]);
    expect(h.fired[1]!.timeSignatureSettings).toBe(true);
    expect(h.fired[1]!.full).toBe(false);
  });

  it("always flushes the trailing edit (no dropped tail)", async () => {
    const h = makeHarness();
    h.coalescer.submit({
      json: "A",
      changedGlobalMeasures: [1],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "LAST",
      changedGlobalMeasures: [9],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    await h.settle();
    // The final edit always produces an authoritative layout.
    expect(h.fired.at(-1)!.json).toBe("LAST");
    expect(h.fired.at(-1)!.global).toContain(9);
  });

  it("resolves each submission after the dispatch that includes it", async () => {
    const h = makeHarness();
    let firstDone = false;
    let pendingDone = false;
    void h.coalescer
      .submit({
        json: "A",
        changedGlobalMeasures: [1],
        changedPartMeasures: new Map(),
        structuralChange: false,
      })
      .then(() => (firstDone = true));
    void h.coalescer
      .submit({
        json: "B",
        changedGlobalMeasures: [2],
        changedPartMeasures: new Map(),
        structuralChange: false,
      })
      .then(() => (pendingDone = true));

    await h.settle();
    expect(firstDone).toBe(true);
    expect(pendingDone).toBe(false);
    await h.settle();
    expect(pendingDone).toBe(true);
  });

  it("reset drops in-flight + pending", async () => {
    const h = makeHarness();
    h.coalescer.submit({
      json: "A",
      changedGlobalMeasures: [1],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    h.coalescer.submit({
      json: "B",
      changedGlobalMeasures: [2],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    h.coalescer.reset();
    await h.settle(); // resolving the old A must not drain the dropped pending
    expect(h.fired).toHaveLength(1);
    // After reset, a new submit fires immediately (idle).
    h.coalescer.submit({
      json: "NEW",
      changedGlobalMeasures: [7],
      changedPartMeasures: new Map(),
      structuralChange: false,
    });
    expect(h.fired).toHaveLength(2);
    expect(h.fired[1]!.json).toBe("NEW");
  });

  it("an old completion after reset cannot mark the new generation idle", async () => {
    const fired: string[] = [];
    const resolvers = new Map<string, () => void>();
    const coalescer = new LayoutCoalescer(
      () => "{}",
      (json) => {
        fired.push(json);
        return new Promise<void>((resolve) => resolvers.set(json, resolve));
      },
    );
    const submit = (json: string): void => {
      void coalescer.submit({
        json,
        changedGlobalMeasures: [1],
        changedPartMeasures: new Map(),
        structuralChange: false,
      });
    };

    submit("OLD");
    coalescer.reset();
    submit("NEW");
    expect(fired).toEqual(["OLD", "NEW"]);

    // OLD's uncancellable RPC resolves after NEW has started. It must not set
    // `inFlight = false`; a subsequent edit must remain pending behind NEW.
    resolvers.get("OLD")?.();
    await Promise.resolve();
    await Promise.resolve();
    submit("LATEST");
    expect(fired).toEqual(["OLD", "NEW"]);

    resolvers.get("NEW")?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(fired).toEqual(["OLD", "NEW", "LATEST"]);
  });
});

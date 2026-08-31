/**
 * Extractor tests.
 *
 * The pure tile geometry is covered in `filmstrip.test.ts`. This file drives the
 * class itself against a fake decoder, because the bugs that actually bite here
 * live in the async bookkeeping — what is queued, what is in flight, and what a
 * superseding request abandons — and none of that is reachable from the pure
 * functions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilmstripExtractor } from "../filmstrip";

/** Anamorphic scope, so the aspect is distinguishable from the 16:9 default. */
const CLIP_WIDTH = 2048;
const CLIP_HEIGHT = 858;

/** A <video> that resolves metadata and seeks on the next tick. */
function fakeVideo() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const fire = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener({});
  };
  let currentTime = 0;
  return {
    videoWidth: CLIP_WIDTH,
    videoHeight: CLIP_HEIGHT,
    muted: false,
    preload: "",
    src: "",
    get currentTime() {
      return currentTime;
    },
    set currentTime(value: number) {
      currentTime = value;
      queueMicrotask(() => fire("seeked"));
    },
    setAttribute: () => {},
    removeAttribute: () => {},
    load: () => queueMicrotask(() => fire("loadedmetadata")),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
}

function fakeCanvas() {
  return { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }) };
}

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => (tag === "video" ? fakeVideo() : fakeCanvas()),
  });
  vi.stubGlobal("createImageBitmap", async (source: { width: number; height: number }) => ({
    width: source.width,
    height: source.height,
    close: () => {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FilmstripExtractor", () => {
  it("decodes the times it is asked for", async () => {
    const extractor = new FilmstripExtractor("blob:clip", () => {}, 44);
    extractor.request([1, 2]);
    await vi.waitFor(() => {
      expect(extractor.frame(1)).toBeDefined();
      expect(extractor.frame(2)).toBeDefined();
    });
    extractor.dispose();
  });

  it("keeps decoding times the superseding request still wants", async () => {
    // The overlap case, and the one the design actually optimises for: decode
    // times are snapped to a quantum precisely so that adjacent zoom steps
    // re-ask for the same ones, and a request lands on every wheel tick. If the
    // still-wanted times are released from `pending` but not re-queued, they end
    // up neither pending nor queued and the visible tiles never fill.
    const extractor = new FilmstripExtractor("blob:clip", () => {}, 44);
    extractor.request([1, 2, 3, 4, 5]);
    // Overlaps the queue: 2..5 are still wanted, 6 is new.
    extractor.request([2, 3, 4, 5, 6]);
    await vi.waitFor(() => {
      for (const seconds of [2, 3, 4, 5, 6]) expect(extractor.frame(seconds)).toBeDefined();
    });
    extractor.dispose();
  });

  it("can still decode a time that an earlier request abandoned", async () => {
    // The regression: a superseding request replaces the queue, and the times
    // it drops must leave `pending` too. `pending` exists to stop a frame being
    // asked for twice, so a leaked entry is a frame that can never be asked for
    // again — and because zooming re-asks for the same quantised times by
    // design, that showed up as permanent holes in the strip.
    const extractor = new FilmstripExtractor("blob:clip", () => {}, 44);
    extractor.request([1, 2, 3, 4, 5]);
    // Synchronously supersede: only the first time is in flight, so 2..5 are
    // abandoned from the queue.
    extractor.request([10, 11]);
    await vi.waitFor(() => expect(extractor.frame(10)).toBeDefined());

    extractor.request([2, 3]);
    await vi.waitFor(() => {
      expect(extractor.frame(2)).toBeDefined();
      expect(extractor.frame(3)).toBeDefined();
    });
    extractor.dispose();
  });

  it("reports the clip's own aspect ratio, not the assumed one", async () => {
    const extractor = new FilmstripExtractor("blob:clip", () => {}, 44);
    extractor.prime();
    await vi.waitFor(() => expect(extractor.aspectRatio()).toBeCloseTo(CLIP_WIDTH / CLIP_HEIGHT, 6));
    extractor.dispose();
  });

  it("notifies when the aspect ratio lands, so the grid can be re-laid", async () => {
    const onChanged = vi.fn();
    const extractor = new FilmstripExtractor("blob:clip", onChanged, 44);
    extractor.prime();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    extractor.dispose();
  });

  it("stops decoding once disposed", async () => {
    const onChanged = vi.fn();
    const extractor = new FilmstripExtractor("blob:clip", onChanged, 44);
    extractor.request([1, 2, 3]);
    extractor.dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(extractor.frame(1)).toBeUndefined();
  });

  it("keeps decoded frames usable after disposal of an unrelated extractor", async () => {
    // Frames are handed to the renderer, which paints them on a later animation
    // frame; one extractor tearing down must not neuter another's bitmaps.
    const a = new FilmstripExtractor("blob:a", () => {}, 44);
    const b = new FilmstripExtractor("blob:b", () => {}, 44);
    a.request([1]);
    await vi.waitFor(() => expect(a.frame(1)).toBeDefined());
    const image = a.frame(1)!.image as { width: number };
    b.dispose();
    expect(image.width).toBeGreaterThan(0);
    a.dispose();
  });
});

/**
 * Timeline geometry and resolution tests.
 *
 * Geometry is where an off-by-one shows up as a hit drawn on the wrong frame, so
 * the round-trips and anchoring behaviour are worth pinning explicitly.
 */

import { describe, expect, it } from "vitest";
import {
  chooseTickInterval,
  clampViewport,
  fitViewport,
  isVisible,
  normalizeSafeAreaLeft,
  secondsForX,
  shiftViewportSafeArea,
  ticksFor,
  xForSeconds,
  zoomAt,
  zoomLimitsFor,
} from "../timelineGeometry";
import { hitNear, markerIntervalAt, markerIntervals, resolveBars, resolveHits, spanAt } from "../resolveTimeline";
import type { TimelineViewport } from "../timelineTypes";

const VIEW: TimelineViewport = { startSeconds: 10, secondsPerPixel: 0.05 };

describe("timeline geometry", () => {
  it("round-trips seconds through pixels", () => {
    for (const seconds of [0, 10, 42.5, 150.12]) {
      expect(secondsForX(xForSeconds(seconds, VIEW), VIEW)).toBeCloseTo(seconds, 9);
    }
  });

  it("puts the window start at the left edge", () => {
    expect(xForSeconds(10, VIEW)).toBe(0);
  });

  it("fits a whole clip into the available width", () => {
    const viewport = fitViewport(150, 1000);
    expect(viewport.startSeconds).toBe(0);
    expect(xForSeconds(150, viewport)).toBeCloseTo(1000, 6);
  });

  it("fits the clip into the unobscured safe area on a full-bleed canvas", () => {
    const viewport = fitViewport(150, 1000, 320);
    expect(xForSeconds(0, viewport)).toBeCloseTo(320, 6);
    expect(xForSeconds(150, viewport)).toBeCloseTo(1000, 6);
  });

  it("uses the safe width as the most zoomed-out limit", () => {
    const limits = zoomLimitsFor(150, 1000, 24, 320);
    expect(limits.maxSecondsPerPixel).toBeCloseTo(150 / 680, 9);
  });

  it("keeps the same picture time at the safe edge when the panel resizes", () => {
    const viewport = fitViewport(150, 1000, 320);
    const before = secondsForX(320, viewport);
    const resized = shiftViewportSafeArea(viewport, 320, 420);
    expect(secondsForX(420, resized)).toBeCloseTo(before, 9);
    expect(resized.secondsPerPixel).toBe(viewport.secondsPerPixel);
  });

  it("uses normalized safe edges when the panel is wider than the canvas", () => {
    const width = 300;
    const previous = normalizeSafeAreaLeft(330, width);
    const next = normalizeSafeAreaLeft(260, width);
    expect(previous).toBe(299);

    const viewport = fitViewport(10, width, previous);
    const before = secondsForX(previous, viewport);
    const resized = shiftViewportSafeArea(viewport, previous, next);
    expect(secondsForX(next, resized)).toBeCloseTo(before, 9);
  });

  it("keeps the frame under the cursor fixed while zooming", () => {
    const anchorX = 300;
    const before = secondsForX(anchorX, VIEW);
    const limits = zoomLimitsFor(150, 1000, 24);
    const zoomed = zoomAt(VIEW, anchorX, 0.5, limits);
    expect(secondsForX(anchorX, zoomed)).toBeCloseTo(before, 9);
  });

  it("will not zoom past a quarter of a frame per pixel", () => {
    const limits = zoomLimitsFor(150, 1000, 24);
    let viewport = VIEW;
    for (let i = 0; i < 40; i++) viewport = zoomAt(viewport, 500, 0.5, limits);
    expect(viewport.secondsPerPixel).toBeGreaterThanOrEqual(limits.minSecondsPerPixel - 1e-12);
  });

  it("keeps the window near the clip", () => {
    const far = clampViewport({ startSeconds: 9999, secondsPerPixel: 0.05 }, 150, 1000);
    expect(far.startSeconds).toBeLessThan(150);
    const negative = clampViewport({ startSeconds: -9999, secondsPerPixel: 0.05 }, 150, 1000);
    expect(negative.startSeconds).toBeGreaterThan(-100);
  });

  it("keeps media time zero near the safe edge while clamping", () => {
    const viewport = fitViewport(150, 1000, 320);
    const farLeft = clampViewport({ ...viewport, startSeconds: -9999 }, 150, 1000, 320);
    const safeEdgeTime = secondsForX(320, farLeft);
    expect(safeEdgeTime).toBeGreaterThanOrEqual(-15);
    expect(safeEdgeTime).toBeLessThanOrEqual(0);
  });

  it("knows what is on screen", () => {
    expect(isVisible(10, VIEW, 500)).toBe(true);
    expect(isVisible(0, VIEW, 500)).toBe(false);
  });

  it("chooses tick intervals a person would read on a clock", () => {
    // Zoomed out: minutes. Zoomed in: sub-second.
    expect(chooseTickInterval(0.5)).toBeGreaterThanOrEqual(30);
    expect(chooseTickInterval(0.001)).toBeLessThanOrEqual(0.2);
  });

  it("aligns ticks to whole multiples", () => {
    const ticks = ticksFor({ startSeconds: 7.3, secondsPerPixel: 0.05 }, 400, 5);
    for (const tick of ticks) expect(tick % 5).toBeCloseTo(0, 9);
  });

  it("does not spin when asked for an absurd number of ticks", () => {
    const ticks = ticksFor({ startSeconds: 0, secondsPerPixel: 100 }, 4000, 0.04);
    expect(ticks.length).toBeLessThanOrEqual(2000);
  });
});

const TEMPO = { measureStartTimes: [0, 2, 4, 7], durationSeconds: 10 };

function scoreWith(measures: unknown[]): never {
  return { global: { measures } } as never;
}

describe("resolveBars", () => {
  it("places bars in picture time using the offset", () => {
    const bars = resolveBars(scoreWith([{}, {}, {}, {}]), TEMPO, 5);
    expect(bars[0]?.startSeconds).toBe(5);
    expect(bars[1]?.startSeconds).toBe(7);
    expect(bars[3]?.endSeconds).toBe(15);
  });

  it("reports meter and tempo only where they change", () => {
    const bars = resolveBars(
      scoreWith([
        { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
        {},
        { time: { count: 3, unit: 4 } },
        { tempos: [{ bpm: 90, value: { base: "quarter" } }] },
      ]),
      TEMPO,
      0,
    );
    expect(bars[0]?.meter).toEqual({ count: 4, unit: 4 });
    expect(bars[0]?.bpm).toBe(120);
    expect(bars[1]?.meter).toBeUndefined();
    expect(bars[2]?.meter).toEqual({ count: 3, unit: 4 });
    expect(bars[2]?.bpm).toBeUndefined();
    expect(bars[3]?.bpm).toBe(90);
  });

  it("ignores a restated meter", () => {
    const bars = resolveBars(
      scoreWith([{ time: { count: 4, unit: 4 } }, { time: { count: 4, unit: 4 } }]),
      { measureStartTimes: [0, 2], durationSeconds: 4 },
      0,
    );
    expect(bars[1]?.meter).toBeUndefined();
  });

  it("ignores a tempo that starts mid-bar", () => {
    const bars = resolveBars(
      scoreWith([{ tempos: [{ bpm: 100, value: { base: "quarter" }, location: { fraction: [1, 2] } }] }]),
      { measureStartTimes: [0], durationSeconds: 2 },
      0,
    );
    expect(bars[0]?.bpm).toBeUndefined();
  });
});

describe("resolveHits", () => {
  it("sorts by picture time and defaults locked", () => {
    const hits = resolveHits([
      { id: "b", pictureSeconds: 20 },
      { id: "a", pictureSeconds: 5, locked: false },
    ]);
    expect(hits.map((h) => h.id)).toEqual(["a", "b"]);
    expect(hits[0]?.locked).toBe(false);
    expect(hits[1]?.locked).toBe(true);
  });
});

describe("spanAt", () => {
  const hits = resolveHits([
    { id: "a", pictureSeconds: 10 },
    { id: "b", pictureSeconds: 30 },
    { id: "loose", pictureSeconds: 40, locked: false },
  ]);

  it("bounds a span by the surrounding locked hits", () => {
    expect(spanAt(20, hits, 100)).toMatchObject({ fromSeconds: 10, toSeconds: 30, fromHitId: "a", toHitId: "b" });
  });

  it("uses the clip start and end as outer bounds", () => {
    expect(spanAt(5, hits, 100)).toMatchObject({ fromSeconds: 0, toSeconds: 10 });
    expect(spanAt(60, hits, 100)).toMatchObject({ fromSeconds: 30, toSeconds: 100 });
  });

  it("ignores unlocked hits, which the solver may also ignore", () => {
    expect(spanAt(45, hits, 100)?.toSeconds).toBe(100);
  });

  it("has nothing to solve without a locked hit", () => {
    expect(spanAt(10, resolveHits([{ id: "x", pictureSeconds: 5, locked: false }]), 100)).toBeNull();
  });
});

describe("markerIntervals", () => {
  const hits = resolveHits([
    { id: "first", pictureSeconds: 10, label: "Door" },
    { id: "loose", pictureSeconds: 20, locked: false },
    { id: "third", pictureSeconds: 30, label: "Cut" },
    { id: "fourth", pictureSeconds: 50 },
  ]);

  it("builds intervals between consecutive locked markers", () => {
    expect(markerIntervals(hits)).toEqual([
      {
        fromSeconds: 10,
        toSeconds: 30,
        fromMarkerId: "first",
        toMarkerId: "third",
        fromMarkerNumber: 1,
        toMarkerNumber: 3,
        fromLabel: "Door",
        toLabel: "Cut",
      },
      {
        fromSeconds: 30,
        toSeconds: 50,
        fromMarkerId: "third",
        toMarkerId: "fourth",
        fromMarkerNumber: 3,
        toMarkerNumber: 4,
        fromLabel: "Cut",
      },
    ]);
  });

  it("finds only times enclosed by marker pairs", () => {
    const intervals = markerIntervals(hits);
    expect(markerIntervalAt(15, intervals)?.fromMarkerId).toBe("first");
    expect(markerIntervalAt(30, intervals)?.fromMarkerId).toBe("third");
    expect(markerIntervalAt(5, intervals)).toBeNull();
    expect(markerIntervalAt(50, intervals)).toBeNull();
  });
});

describe("hitNear", () => {
  const hits = resolveHits([
    { id: "a", pictureSeconds: 10 },
    { id: "b", pictureSeconds: 10.4 },
  ]);

  it("finds the closest within tolerance", () => {
    expect(hitNear(10.35, hits, 0.2)?.id).toBe("b");
  });

  it("returns nothing when out of reach", () => {
    expect(hitNear(50, hits, 0.2)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { decodeQuantum, filmstripSlots } from "../filmstrip";

/** A 16:9 tile in a 44 px lane. */
const TILE = 78;

describe("filmstripSlots", () => {
  it("lays tiles edge to edge, with no gaps and no overlap", () => {
    // The property that makes this a filmstrip rather than a row of markers:
    // consecutive tiles are exactly one tile-width apart.
    const secondsPerPixel = 0.05;
    const slots = filmstripSlots(0, 40, secondsPerPixel, 150, TILE);
    expect(slots.length).toBeGreaterThan(5);
    for (let i = 1; i < slots.length; i += 1) {
      const gapPx = (slots[i]!.slotSeconds - slots[i - 1]!.slotSeconds) / secondsPerPixel;
      expect(gapPx).toBeCloseTo(TILE, 6);
    }
  });

  it("omits frames as the composer zooms out rather than squeezing them", () => {
    // Same viewport width, ten times zoomed out: the same number of tiles, each
    // covering ten times as much picture.
    const near = filmstripSlots(0, 40, 0.05, 3000, TILE);
    const far = filmstripSlots(0, 400, 0.5, 3000, TILE);
    expect(far.length).toBe(near.length);
    const nearStep = near[1]!.slotSeconds - near[0]!.slotSeconds;
    const farStep = far[1]!.slotSeconds - far[0]!.slotSeconds;
    expect(farStep / nearStep).toBeCloseTo(10, 6);
  });

  it("anchors the grid to picture zero, so panning slides tiles rather than renumbering them", () => {
    const a = filmstripSlots(10, 30, 0.05, 150, TILE);
    const b = filmstripSlots(12, 32, 0.05, 150, TILE);
    const shared = a.filter((slot) => b.some((other) => other.slotSeconds === slot.slotSeconds));
    expect(shared.length).toBeGreaterThan(3);
  });

  it("never asks for a negative time", () => {
    // The viewport can start before zero when the score has a count-in.
    expect(filmstripSlots(-20, 10, 0.05, 150, TILE).every((s) => s.slotSeconds >= 0)).toBe(true);
  });

  it("stops at the end of the clip", () => {
    const slots = filmstripSlots(0, 500, 0.5, 120, TILE);
    expect(slots.at(-1)!.slotSeconds).toBeLessThanOrEqual(120);
  });

  it("is empty when the viewport is entirely past the clip", () => {
    expect(filmstripSlots(200, 240, 0.05, 150, TILE)).toHaveLength(0);
  });

  it("refuses degenerate geometry rather than looping forever", () => {
    expect(filmstripSlots(0, 10, 0, 150, TILE)).toHaveLength(0);
    expect(filmstripSlots(0, 10, 0.05, 150, 0)).toHaveLength(0);
    expect(filmstripSlots(0, 10, 0.05, 0, TILE)).toHaveLength(0);
  });
});

describe("decode times", () => {
  it("snaps to a quantum, so zooming keeps hitting frames already in hand", () => {
    const a = filmstripSlots(0, 40, 0.05, 150, TILE);
    // A small zoom change moves the grid, but the decoded frames largely repeat.
    const b = filmstripSlots(0, 40, 0.055, 150, TILE);
    const shared = a.filter((slot) => b.some((other) => other.decodeSeconds === slot.decodeSeconds));
    expect(shared.length).toBeGreaterThan(2);
  });

  it("keeps neighbouring tiles on different frames", () => {
    // A quantum coarser than the tile would collapse adjacent tiles onto the
    // same frame, and the strip would show visible runs of duplicates.
    for (const secondsPerPixel of [0.01, 0.05, 0.2, 1, 5]) {
      const slots = filmstripSlots(0, 100000, secondsPerPixel, 100000, TILE);
      const times = slots.slice(0, 20).map((s) => s.decodeSeconds);
      expect(new Set(times).size).toBe(times.length);
    }
  });

  it("stays within half a quantum of the tile it fills", () => {
    const secondsPerPixel = 0.2;
    const quantum = decodeQuantum(TILE * secondsPerPixel);
    for (const slot of filmstripSlots(0, 300, secondsPerPixel, 600, TILE)) {
      expect(Math.abs(slot.decodeSeconds - slot.slotSeconds)).toBeLessThanOrEqual(quantum / 2 + 1e-6);
    }
  });

  it("never asks for a time outside the clip", () => {
    for (const slot of filmstripSlots(0, 200, 0.5, 120, TILE)) {
      expect(slot.decodeSeconds).toBeGreaterThanOrEqual(0);
      expect(slot.decodeSeconds).toBeLessThanOrEqual(120);
    }
  });
});

describe("decodeQuantum", () => {
  it("is the largest rung that still fits inside a tile", () => {
    expect(decodeQuantum(0.6)).toBe(0.5);
    expect(decodeQuantum(3)).toBe(2);
    expect(decodeQuantum(70)).toBe(60);
  });

  it("falls back to the finest rung below the ladder", () => {
    // Zoomed in past a quarter second per tile there is nothing to gain: the
    // composer is looking at individual frames anyway.
    expect(decodeQuantum(0.01)).toBe(0.25);
  });
});

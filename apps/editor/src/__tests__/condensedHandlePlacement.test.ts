/**
 * Horizontal placement of the in-canvas condensed-staff handles.
 *
 * Two regressions drove this logic, both worth keeping pinned: the handle used
 * to sit at a fixed viewport x, which put it *on top of the clef* when the
 * score happened to start near the left edge, and left it stranded in empty
 * canvas when the score started further right.
 */
import { describe, expect, it } from "vitest";
import { condensedHandleX, condensedHandleY, HANDLE_SIZE } from "../condensedStaves/condensedHandlePlacement";

/** Typical horizon-view geometry: panel-inset viewport, zoomed-out orchestra. */
const BASE = {
  staffLeftScore: 1000,
  spatium: 8,
  scrollX: 0,
  zoom: 0.5,
  horizon: true,
  safeAreaLeft: 324,
};

describe("condensedHandleX", () => {
  it("sits just left of the staff, never over the clef", () => {
    const x = condensedHandleX(BASE);
    const staffLeftScreen = (BASE.staffLeftScore - BASE.scrollX) * BASE.zoom;

    expect(x + HANDLE_SIZE).toBeLessThan(staffLeftScreen);
  });

  it("tracks the score horizontally instead of pinning to the viewport", () => {
    const near = condensedHandleX({ ...BASE, staffLeftScore: 1000 });
    const far = condensedHandleX({ ...BASE, staffLeftScore: 2000 });

    // A staff 1000 score-units further right puts its handle 500 px further
    // right at 0.5 zoom — the bug was that both landed on the same x.
    expect(far - near).toBeCloseTo(500, 5);
  });

  it("never hides behind the floating left panel", () => {
    // Staff starts left of the panel edge but not far enough to trigger sticky.
    const x = condensedHandleX({ ...BASE, staffLeftScore: 0, scrollX: -600, horizon: false });
    expect(x).toBeGreaterThanOrEqual(BASE.safeAreaLeft);
  });

  it("parks past the sticky clef column once the staff's own clef scrolls off", () => {
    // Scrolled well beyond the staff start: the renderer is now painting a
    // substitute clef at the left edge, so the handle must clear it.
    const x = condensedHandleX({ ...BASE, scrollX: 5000 });
    const stickyColumnRight = BASE.safeAreaLeft + BASE.spatium * 3.5 * BASE.zoom;

    expect(x).toBeGreaterThanOrEqual(stickyColumnRight);
  });

  it("stays put while scrolling once sticky, rather than drifting off-screen", () => {
    const a = condensedHandleX({ ...BASE, scrollX: 5000 });
    const b = condensedHandleX({ ...BASE, scrollX: 50000 });

    expect(a).toBeCloseTo(b, 5);
  });

  it("does not go sticky before the renderer does", () => {
    // Exactly at the staff's left edge is below the renderer's 2-spatia
    // threshold, so the handle should still be tracking the staff.
    const visibleLeftScore = BASE.staffLeftScore;
    const scrollX = visibleLeftScore - BASE.safeAreaLeft / BASE.zoom;
    const x = condensedHandleX({ ...BASE, scrollX });

    const staffLeftScreen = (BASE.staffLeftScore - scrollX) * BASE.zoom;
    expect(x).toBeCloseTo(Math.max(staffLeftScreen - HANDLE_SIZE - 6, BASE.safeAreaLeft + 6), 5);
  });

  it("has no sticky regime outside horizon view", () => {
    // Paged views never paint a sticky column, so a scrolled-away staff simply
    // clamps to the viewport edge.
    const x = condensedHandleX({ ...BASE, scrollX: 5000, horizon: false });
    expect(x).toBeCloseTo(BASE.safeAreaLeft + 6, 5);
  });

  it("scales the sticky offset with zoom, matching the painted column", () => {
    const halfZoom = condensedHandleX({ ...BASE, scrollX: 5000, zoom: 0.5 });
    const fullZoom = condensedHandleX({ ...BASE, scrollX: 5000, zoom: 1 });

    expect(fullZoom - BASE.safeAreaLeft).toBeCloseTo((halfZoom - BASE.safeAreaLeft - 6) * 2 + 6, 5);
  });
});

/** Two staves 100 score-units apart: staff bottom 200, next staff top 300. */
const Y_BASE = {
  staffBottomScore: 200,
  nextStaffTopScore: 300,
  spatium: 8,
  scrollY: 0,
  zoom: 0.5,
};

describe("condensedHandleY", () => {
  it("centres the handle in the gap below its staff, not on the staff", () => {
    const y = condensedHandleY(Y_BASE);
    const gapCentreScreen = ((200 + 300) / 2) * Y_BASE.zoom;

    expect(y + HANDLE_SIZE / 2).toBeCloseTo(gapCentreScreen, 5);
  });

  it("clears the staff it belongs to, so it can't cover the instrument name", () => {
    // Instrument names are centred on the staff; the handle must sit entirely
    // below the staff's bottom edge for the two never to collide.
    const y = condensedHandleY(Y_BASE);
    const staffBottomScreen = Y_BASE.staffBottomScore * Y_BASE.zoom;

    expect(y).toBeGreaterThan(staffBottomScreen);
  });

  it("clears the next staff down as well", () => {
    const y = condensedHandleY(Y_BASE);
    const nextStaffTopScreen = Y_BASE.nextStaffTopScore * Y_BASE.zoom;

    expect(y + HANDLE_SIZE).toBeLessThan(nextStaffTopScreen);
  });

  it("drops below the staff when it is the last one in the system", () => {
    const y = condensedHandleY({ ...Y_BASE, nextStaffTopScore: null });
    const staffBottomScreen = Y_BASE.staffBottomScore * Y_BASE.zoom;

    expect(y).toBeGreaterThan(staffBottomScreen);
  });

  it("follows vertical scroll", () => {
    const a = condensedHandleY(Y_BASE);
    const b = condensedHandleY({ ...Y_BASE, scrollY: 100 });

    expect(a - b).toBeCloseTo(100 * Y_BASE.zoom, 5);
  });
});

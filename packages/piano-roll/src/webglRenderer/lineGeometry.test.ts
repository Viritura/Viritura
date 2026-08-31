/**
 * Tests for the line-geometry helpers — packing + decoration build.
 */

import { describe, expect, it } from "vitest";
import { buildDecorationLines, packLineInstances, LINE_INSTANCE_FLOATS } from "./lineGeometry";
import { buildKeyLayout } from "../pianoRollGrid";

const VIEWPORT = { secondsAhead: 4, minMidi: 21, maxMidi: 108 } as const;

describe("packLineInstances", () => {
  it("emits 9 floats per line in the documented order", () => {
    const packed = packLineInstances([
      { x: 1, y: 2, width: 3, height: 4, color: [0.5, 0.6, 0.7, 0.8], softness: 1.25 },
    ]);
    expect(packed.length).toBe(LINE_INSTANCE_FLOATS);
    const expected = [1, 2, 3, 4, 0.5, 0.6, 0.7, 0.8, 1.25];
    for (let i = 0; i < expected.length; i++) {
      expect(packed[i]).toBeCloseTo(expected[i]!, 5);
    }
  });
});

describe("buildDecorationLines", () => {
  const layout = buildKeyLayout(VIEWPORT, 1040);
  const colors = {
    octaveColor: [0, 0, 0, 1] as const,
    gridColor: [0, 0, 0, 1] as const,
    playheadColor: [0, 0, 0, 1] as const,
    playheadGlowColor: [0, 0, 0, 0.35] as const,
  };

  it("emits one octave anchor per visible C, plus per-second grid lines, plus glow + playhead", () => {
    const lines = buildDecorationLines({
      viewport: VIEWPORT,
      widthPx: 1040,
      heightPx: 400,
      keyLayout: layout,
      playheadSeconds: 0,
      ...colors,
    });
    // Visible Cs in 21..108: C1(24), C2, C3, C4, C5, C6, C7, C8 = 8 Cs.
    // secondsAhead = 4 with playhead = 0 → grid lines at t = 0, 1, 2, 3, 4 = 5 lines.
    // + 1 glow + 1 playhead = 15 lines total.
    expect(lines.length).toBe(8 + 5 + 1 + 1);
  });

  it("places the playhead at the bottom of the canvas", () => {
    const lines = buildDecorationLines({
      viewport: VIEWPORT,
      widthPx: 1040,
      heightPx: 400,
      keyLayout: layout,
      playheadSeconds: 0,
      ...colors,
    });
    const playhead = lines.at(-1)!;
    expect(playhead.y).toBe(398); // heightPx - 2
    expect(playhead.height).toBe(2);
    expect(playhead.width).toBe(1040);
    expect(playhead.softness).toBe(0);
  });

  it("emits a soft glow band above the playhead", () => {
    const lines = buildDecorationLines({
      viewport: VIEWPORT,
      widthPx: 1040,
      heightPx: 400,
      keyLayout: layout,
      playheadSeconds: 0,
      ...colors,
    });
    const glow = lines.at(-2)!;
    expect(glow.softness).toBeGreaterThan(0);
    expect(glow.height).toBe(16);
  });
});

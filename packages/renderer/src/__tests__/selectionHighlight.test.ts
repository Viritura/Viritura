import { describe, it, expect, vi } from "vitest";
import { paintSelectionOverlay } from "../selectionOverlay";
import { commandsForElement, curveCommandsFor } from "../selectionHighlight";
import { SpatialIndex, hitTestSpannerHandle } from "../hitTest";
import type { DisplayList, RenderCommand } from "../wasm";

const SLUR_ID = "slur/p0/m1/s0/ev-1";
const TIE_ID = "tie/n1/n2";
const EVENT_ID = "p0/m0/s0/ev-1";

function makeSlurCommand(x1: number, x2: number): RenderCommand {
  return {
    type: "DrawFilledBezier",
    x1,
    y1: 100,
    ocx1: x1 + 20,
    ocy1: 130,
    ocx2: x2 - 20,
    ocy2: 130,
    x2,
    y2: 100,
    ix1: x1,
    iy1: 100,
    icx1: x1 + 20,
    icy1: 126,
    icx2: x2 - 20,
    icy2: 126,
    ix2: x2,
    iy2: 100,
    color: "#000000",
    line_style: 0,
  } as RenderCommand;
}

function makeGlyph(x: number, y: number): RenderCommand {
  return { type: "DrawGlyph", x, y, codepoint: 0xe0a4, size: 24, font: "Bravura", color: "#000000", rotation: 0 };
}

function makeStem(x: number, y: number): RenderCommand {
  return { type: "DrawLine", x1: x, y1: y, x2: x, y2: y - 30, width: 1.2, color: "#000000" };
}

function makeText(text: string, x: number, y: number): RenderCommand {
  return {
    type: "DrawText",
    text,
    x,
    y,
    size: 12,
    font: "serif italic",
    color: "#000000",
    align: "left",
    baseline: "alphabetic",
  };
}

function makeDisplayList(): DisplayList {
  return {
    commands: [makeSlurCommand(50, 400)],
    elementIds: [SLUR_ID],
    width: 500,
    height: 300,
  };
}

/** Display list with an event that owns a stem directly and noteheads via child ids. */
function makeEventDisplayList(): DisplayList {
  return {
    commands: [makeStem(100, 200), makeGlyph(100, 200), makeGlyph(100, 190)],
    elementIds: [EVENT_ID, `${EVENT_ID}/n0`, `${EVENT_ID}/n1`],
    width: 500,
    height: 300,
  };
}

/** Canvas 2D stub recording only the calls the overlay assertions care about. */
function makeCtx(): CanvasRenderingContext2D & {
  strokeRect: ReturnType<typeof vi.fn>;
  bezierCurveTo: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  strokeText: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
} {
  const noop = vi.fn();
  return {
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 60 })),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
  } as unknown as ReturnType<typeof makeCtx>;
}

describe("commandsForElement", () => {
  it("indexes commands by element id", () => {
    const dl = makeDisplayList();
    expect(commandsForElement(dl, SLUR_ID)).toHaveLength(1);
    expect(commandsForElement(dl, "slur/nope")).toBeUndefined();
  });

  it("groups cross-system segments sharing one id", () => {
    const dl: DisplayList = {
      commands: [makeSlurCommand(50, 400), makeSlurCommand(50, 200)],
      elementIds: [SLUR_ID, SLUR_ID],
      width: 500,
      height: 300,
    };
    expect(curveCommandsFor(dl, SLUR_ID)).toHaveLength(2);
  });

  it("includes descendant ids so an event picks up its noteheads", () => {
    const dl = makeEventDisplayList();
    expect(commandsForElement(dl, EVENT_ID)).toHaveLength(3);
    // A notehead selected on its own stays a single glyph.
    expect(commandsForElement(dl, `${EVENT_ID}/n0`)).toHaveLength(1);
  });

  it("reports no curve commands for a non-curve element", () => {
    expect(curveCommandsFor(makeEventDisplayList(), EVENT_ID)).toBeUndefined();
  });
});

describe("paintSelectionOverlay — ink highlight", () => {
  const slurIndex = new SpatialIndex([{ id: SLUR_ID, x: 50, y: 100, width: 350, height: 30 }]);

  it("traces the curve outline instead of the hit box when a display list is supplied", () => {
    const ctx = makeCtx();
    paintSelectionOverlay(ctx, slurIndex, new Set([SLUR_ID]), makeDisplayList());

    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(ctx.bezierCurveTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("uses an explicit staff-local voice index for grand-staff selections", () => {
    const id = "p0/m0/s1/lower-staff-note";
    const index = new SpatialIndex([{ id, x: 20, y: 20, width: 10, height: 10 }]);
    const ctx = makeCtx();

    paintSelectionOverlay(ctx, index, new Set([id]), undefined, undefined, 0);

    expect(ctx.fillStyle).toBe("#4285F440");
  });

  it("highlights a tie without presenting drag handles", () => {
    const ctx = makeCtx();
    const dl = makeDisplayList();
    dl.elementIds = [TIE_ID];
    const tieIndex = new SpatialIndex([{ id: TIE_ID, x: 50, y: 100, width: 350, height: 30 }]);

    paintSelectionOverlay(ctx, tieIndex, new Set([TIE_ID]), dl);

    expect(ctx.bezierCurveTo).toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it("re-inks a notehead glyph rather than boxing it", () => {
    const ctx = makeCtx();
    const noteId = `${EVENT_ID}/n0`;
    const index = new SpatialIndex([{ id: noteId, x: 96, y: 194, width: 12, height: 10 }]);
    paintSelectionOverlay(ctx, index, new Set([noteId]), makeEventDisplayList());

    expect(ctx.strokeText).toHaveBeenCalledTimes(1); // halo pass
    expect(ctx.fillText).toHaveBeenCalledTimes(1); // ink pass
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("lights an event's stem and all of its noteheads", () => {
    const ctx = makeCtx();
    const index = new SpatialIndex([{ id: EVENT_ID, x: 96, y: 170, width: 12, height: 40 }]);
    paintSelectionOverlay(ctx, index, new Set([EVENT_ID]), makeEventDisplayList());

    expect(ctx.strokeText).toHaveBeenCalledTimes(2); // both noteheads haloed
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it("falls back to the hit-box rectangle without a display list", () => {
    const ctx = makeCtx();
    paintSelectionOverlay(ctx, slurIndex, new Set([SLUR_ID]));

    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it("falls back to the hit-box rectangle when the id has no commands", () => {
    const ctx = makeCtx();
    const pedalId = "p0/m1/s0/pedal-0";
    const pedalIndex = new SpatialIndex([{ id: pedalId, x: 10, y: 20, width: 100, height: 10 }]);
    paintSelectionOverlay(ctx, pedalIndex, new Set([pedalId]), makeDisplayList());

    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it("highlights only the clicked staff when a condensed score duplicates an id", () => {
    const ctx = makeCtx();
    const dl: DisplayList = {
      commands: [makeGlyph(100, 200), makeGlyph(100, 600)],
      elementIds: [EVENT_ID, EVENT_ID],
      width: 500,
      height: 800,
    };
    const index = new SpatialIndex([
      { id: EVENT_ID, x: 96, y: 194, width: 12, height: 10 },
      { id: EVENT_ID, x: 96, y: 594, width: 12, height: 10 },
    ]);
    index.lastHitY = 600;
    paintSelectionOverlay(ctx, index, new Set([EVENT_ID]), dl, 1);

    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith(expect.any(String), 100, 600);
  });

  it("highlights a global key signature on every staff from any one selected copy", () => {
    const ctx = makeCtx();
    const upperId = "p0/m1/key";
    const lowerId = "p1/m1/key";
    const dl: DisplayList = {
      commands: [makeGlyph(100, 200), makeGlyph(112, 218), makeGlyph(100, 600), makeGlyph(112, 618)],
      elementIds: [upperId, upperId, lowerId, lowerId],
      width: 500,
      height: 800,
    };
    const index = new SpatialIndex([
      { id: upperId, x: 96, y: 190, width: 32, height: 48 },
      { id: lowerId, x: 96, y: 590, width: 32, height: 48 },
    ]);
    index.lastHitY = 200;

    paintSelectionOverlay(ctx, index, new Set([upperId]), dl, 1);

    expect(ctx.strokeText).toHaveBeenCalledTimes(4);
    expect(ctx.fillText).toHaveBeenCalledTimes(4);
    expect(ctx.fillText).toHaveBeenCalledWith(expect.any(String), 100, 600);
  });

  it("lights a barline's full run, connectors between staves included", () => {
    // A barline is one stroke from the top staff to the bottom: staff, gap,
    // staff. Scoping the highlight to the clicked staff would break it into
    // stripes, so the barline's boxes merge into the whole run.
    const ctx = makeCtx();
    const barlineId = "m1/barline";
    const line = (y1: number, y2: number): RenderCommand => ({
      type: "DrawLine",
      x1: 300,
      y1,
      x2: 300,
      y2,
      width: 1.5,
      color: "#000000",
    });
    const dl: DisplayList = {
      commands: [line(100, 148), line(148, 232), line(232, 280)],
      elementIds: [barlineId, barlineId, barlineId],
      width: 500,
      height: 400,
    };
    const index = new SpatialIndex([
      { id: barlineId, x: 297, y: 100, width: 6, height: 48 },
      { id: barlineId, x: 297, y: 148, width: 6, height: 84 },
      { id: barlineId, x: 297, y: 232, width: 6, height: 48 },
    ]);
    index.lastHitY = 120; // clicked on the top staff

    paintSelectionOverlay(ctx, index, new Set([barlineId]), dl, 1);

    // Three haloed + three re-inked strokes: nothing dropped for sitting in a gap.
    const drawnTo = (ctx.lineTo as unknown as { mock: { calls: number[][] } }).mock.calls.map((c) => c[1]);
    expect(drawnTo).toEqual([148, 232, 280, 148, 232, 280]);
  });
});

describe("paintSelectionOverlay — display-list reuse", () => {
  // The layout pipeline reuses one DisplayList object across incremental
  // edits, mutating its arrays in place (PatchReconstructor). A cache keyed on
  // object identity alone therefore goes stale, and the highlight keeps
  // re-inking commands the edit removed.
  const index = new SpatialIndex([{ id: EVENT_ID, x: 96, y: 170, width: 12, height: 40 }]);

  function mutatedInPlace(): DisplayList {
    const dl = makeEventDisplayList();
    paintSelectionOverlay(makeCtx(), index, new Set([EVENT_ID]), dl, 1);
    // Same object, one notehead removed — as if the user deleted something.
    dl.commands.length = 2;
    dl.elementIds!.length = 2;
    return dl;
  }

  it("rebuilds the index when the version advances", () => {
    const dl = mutatedInPlace();
    const ctx = makeCtx();
    paintSelectionOverlay(ctx, index, new Set([EVENT_ID]), dl, 2);

    expect(ctx.fillText).toHaveBeenCalledTimes(1); // only the surviving notehead
  });

  it("rebuilds every call when no version is supplied", () => {
    const dl = mutatedInPlace();
    const ctx = makeCtx();
    paintSelectionOverlay(ctx, index, new Set([EVENT_ID]), dl);

    expect(ctx.fillText).toHaveBeenCalledTimes(1);
  });

  it("reuses the index while the version holds steady", () => {
    const dl = makeEventDisplayList();
    const first = makeCtx();
    paintSelectionOverlay(first, index, new Set([EVENT_ID]), dl, 7);
    expect(first.fillText).toHaveBeenCalledTimes(2);

    const second = makeCtx();
    paintSelectionOverlay(second, index, new Set([EVENT_ID]), dl, 7);
    expect(second.fillText).toHaveBeenCalledTimes(2);
  });
});

describe("paintSelectionOverlay — text elements", () => {
  const TEXT_ID = "p0/m0/expr-0";

  function makeTextDisplayList(): DisplayList {
    return {
      commands: [makeText("dolce", 200, 300)],
      elementIds: [TEXT_ID],
      width: 500,
      height: 400,
    };
  }

  const index = new SpatialIndex([{ id: TEXT_ID, x: 200, y: 290, width: 60, height: 14 }]);

  it("shades a box instead of outlining the letterforms", () => {
    const ctx = makeCtx();
    paintSelectionOverlay(ctx, index, new Set([TEXT_ID]), makeTextDisplayList());

    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("measures the box from the run rather than the hit region", () => {
    const ctx = makeCtx();
    paintSelectionOverlay(ctx, index, new Set([TEXT_ID]), makeTextDisplayList());

    // Fallback metrics: width 60, ascent 0.8em, descent 0.25em on a 12px run,
    // padded by 3 on each side.
    expect(ctx.fillRect).toHaveBeenCalledWith(197, 287.4, 66, expect.closeTo(18.6, 5));
  });

  it("shades a metronome mark's glyph and text as one box", () => {
    const ctx = makeCtx();
    const markId = "p0/m0/tempo-0";
    const dl: DisplayList = {
      commands: [makeGlyph(100, 300), makeText("= 120", 130, 300)],
      elementIds: [markId, markId],
      width: 500,
      height: 400,
    };
    const markIndex = new SpatialIndex([{ id: markId, x: 100, y: 285, width: 95, height: 20 }]);
    paintSelectionOverlay(ctx, markIndex, new Set([markId]), dl);

    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    const call = (ctx.fillRect as unknown as { mock: { calls: number[][] } }).mock.calls[0]!;
    const x = call[0]!;
    const w = call[2]!;
    expect(x).toBeLessThan(100); // starts at the glyph
    expect(x + w).toBeGreaterThan(190); // reaches past the text
  });
});

describe("paintSelectionOverlay — dynamics", () => {
  const DYN_ID = "p0/m0/dyn0";
  const HAIRPIN_ID = "p0/m0/hairpin0";

  it("shades a box around dynamics letters rather than outlining them", () => {
    const ctx = makeCtx();
    const dl: DisplayList = {
      commands: [makeGlyph(200, 300), makeGlyph(214, 300)],
      elementIds: [DYN_ID, DYN_ID],
      width: 500,
      height: 400,
    };
    const index = new SpatialIndex([{ id: DYN_ID, x: 200, y: 288, width: 30, height: 18 }]);
    paintSelectionOverlay(ctx, index, new Set([DYN_ID]), dl);

    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("keeps the shape-conformal halo on hairpins", () => {
    const ctx = makeCtx();
    const dl: DisplayList = {
      commands: [
        { type: "DrawLine", x1: 200, y1: 300, x2: 260, y2: 292, width: 1.2, color: "#000000" },
        { type: "DrawLine", x1: 200, y1: 300, x2: 260, y2: 308, width: 1.2, color: "#000000" },
      ],
      elementIds: [HAIRPIN_ID, HAIRPIN_ID],
      width: 500,
      height: 400,
    };
    const index = new SpatialIndex([{ id: HAIRPIN_ID, x: 200, y: 290, width: 60, height: 20 }]);
    paintSelectionOverlay(ctx, index, new Set([HAIRPIN_ID]), dl);

    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });
});

describe("hitTestSpannerHandle — curve anchors", () => {
  const index = new SpatialIndex([{ id: SLUR_ID, x: 50, y: 100, width: 350, height: 30 }]);

  it("grabs the curve tip rather than the hit-box corner", () => {
    const dl = makeDisplayList();
    // Curve tips sit at y = 100; the hit box's mid-height is y = 115.
    expect(hitTestSpannerHandle(index, new Set([SLUR_ID]), 50, 100, dl)?.handle).toBe("start");
    expect(hitTestSpannerHandle(index, new Set([SLUR_ID]), 400, 100, dl)?.handle).toBe("end");
    expect(hitTestSpannerHandle(index, new Set([SLUR_ID]), 50, 115, dl)).toBeNull();
  });

  it("falls back to hit-box corners without a display list", () => {
    expect(hitTestSpannerHandle(index, new Set([SLUR_ID]), 50, 115)?.handle).toBe("start");
  });

  it("never exposes drag handles for ties", () => {
    const dl = makeDisplayList();
    dl.elementIds = [TIE_ID];
    const tieIndex = new SpatialIndex([{ id: TIE_ID, x: 50, y: 100, width: 350, height: 30 }]);

    expect(hitTestSpannerHandle(tieIndex, new Set([TIE_ID]), 50, 100, dl)).toBeNull();
    expect(hitTestSpannerHandle(tieIndex, new Set([TIE_ID]), 50, 115)).toBeNull();
  });
});

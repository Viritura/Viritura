import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasureGeometry, PlayheadGeometry, SystemGeometry } from "@viritura/score-viewer-react";
import { readerAdvance } from "./readerAdvance";
import { ClickReaderAdvance } from "./ClickReaderAdvance";

const measures: MeasureGeometry[] = [10, 11, 12, 13, 14].flatMap((index) =>
  [0, 1].map((staffIndex) => ({
    index,
    page: 2,
    systemIndex: 2,
    staffIndex,
    partId: `p${staffIndex}`,
    x: 10,
    y: 120,
    width: 20,
    height: 10,
    contentX: 12,
    totalBeats: 4,
  })),
);
const systems: SystemGeometry[] = [
  { index: 1, page: 2, x: 10, y: 20, width: 80, height: 40 },
  { index: 2, page: 2, x: 10, y: 120, width: 80, height: 40 },
];
const heights = [200, 200, 200, 200, 200];
const position: PlayheadGeometry = { page: 2, systemIndex: 2, x: 50, y: 120, height: 40 };
const paint = vi.hoisted(() => vi.fn());
const context = { fillStyle: "", fillRect: vi.fn(), scale: vi.fn() };
const view = {
  engine: {
    measures: () => measures,
    systems: () => systems,
    measure: () => ({ pages: heights.map((height, index) => ({ index, width: 100, height, offsetY: index * 200 })) }),
    playhead: () => position,
    paint,
  },
  displayList: {},
  viewMode: "spread",
  zoom: 2,
  pagePositions: heights.map((height, page) => ({
    page,
    x: (page % 2) * 220,
    y: Math.floor(page / 2) * 420,
    width: 200,
    height: height * 2,
  })),
};
vi.mock("@viritura/score-viewer-react", () => ({ useScoreView: () => view }));
beforeEach(() => {
  paint.mockClear();
  view.viewMode = "spread";
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as CanvasRenderingContext2D);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("reader advance", () => {
  it.each(["spread", "spread-horizontal"] as const)(
    "turns only the verso early in %s, counting unique bars and rounding down",
    (mode) => {
      expect(readerAdvance(mode, position, 11, measures, systems, heights)).toBeUndefined();
      expect(readerAdvance(mode, position, 12, measures, systems, heights)).toEqual({
        sourcePage: 3,
        targetPage: 1,
        fraction: 1,
      });
      expect(readerAdvance(mode, position, 14, measures, systems, heights)).toEqual({
        sourcePage: 3,
        targetPage: 1,
        fraction: 1,
      });
      expect(readerAdvance(mode, { ...position, page: 0 }, 12, measures, systems, heights)).toBeUndefined();
      expect(readerAdvance(mode, { ...position, page: 3 }, 12, measures, systems, heights)).toBeUndefined();
      expect(readerAdvance(mode, { ...position, page: 4 }, 12, measures, systems, heights)).toBeUndefined();
    },
  );

  it("previews the next top half only on the last system and skips tall active systems", () => {
    expect(readerAdvance("page", { ...position, systemIndex: 1 }, 12, measures, systems, heights)).toBeUndefined();
    expect(readerAdvance("page", position, 12, measures, systems, heights)).toEqual({
      sourcePage: 3,
      targetPage: 2,
      fraction: 0.5,
    });
    expect(readerAdvance("page", position, 12, measures, [{ ...systems[1]!, y: 80 }], heights)).toBeUndefined();
    expect(readerAdvance("horizon", position, 12, measures, systems, heights)).toBeUndefined();
  });

  it("paints once per preview, resets on backwards navigation and Stop, and clips page previews", () => {
    const rendered = render(<ClickReaderAdvance active position={{ measureIndex: 12, beat: 0 }} />);
    const preview = screen.getByLabelText("Advance preview of page 4");
    expect(preview.style.left).toBe("220px");
    expect(preview.style.height).toBe("400px");
    const initialPaints = paint.mock.calls.length;
    expect(initialPaints).toBeGreaterThan(0);
    rendered.rerender(<ClickReaderAdvance active position={{ measureIndex: 13, beat: 2 }} />);
    expect(paint).toHaveBeenCalledTimes(initialPaints);
    rendered.rerender(<ClickReaderAdvance active position={{ measureIndex: 11, beat: 0 }} />);
    expect(screen.queryByLabelText("Advance preview of page 4")).toBeNull();
    view.viewMode = "page";
    rendered.rerender(<ClickReaderAdvance active position={{ measureIndex: 12, beat: 0 }} />);
    expect(screen.getByLabelText("Advance preview of page 4").style.height).toBe("200px");
    expect(paint).toHaveBeenLastCalledWith(expect.anything(), view.displayList, {
      page: 3,
      region: { x: 0, y: 0, width: 100, height: 100 },
    });
    rendered.rerender(<ClickReaderAdvance active={false} position={{ measureIndex: 12, beat: 0 }} />);
    expect(screen.queryByLabelText("Advance preview of page 4")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { readerAdvance, type ReaderMeasure, type ReaderSystem } from "../components/ScoreCanvas";

const measures: ReaderMeasure[] = [10, 11, 12, 13, 14].flatMap((index) =>
  [0, 1].map(() => ({ index, page: 2, systemIndex: 2 })),
);
const systems: ReaderSystem[] = [
  { index: 1, page: 2, y: 20, height: 40 },
  { index: 2, page: 2, y: 120, height: 40 },
];
const heights = [200, 200, 200, 200, 200];
const position = { page: 2, systemIndex: 2 };

describe("reader advance", () => {
  it.each(["spread", "spread-h"] as const)(
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
    expect(
      readerAdvance(
        "page",
        position,
        12,
        [{ index: 12, page: 2, systemIndex: 2 }],
        [{ ...systems[1]!, y: 80 }],
        heights,
      ),
    ).toBeUndefined();
    expect(readerAdvance("horizon", position, 12, measures, systems, heights)).toBeUndefined();
  });
});

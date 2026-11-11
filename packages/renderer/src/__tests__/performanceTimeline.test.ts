import { afterEach, describe, expect, it } from "vitest";
import { markPerformance, measurePerformance } from "../performanceTimeline";

afterEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});

describe("bounded performance timeline", () => {
  it("keeps only the latest mark and measurement for each metric", () => {
    for (let index = 0; index < 100; index++) {
      markPerformance("viritura:test-start");
      markPerformance("viritura:test-end");
      measurePerformance("viritura:test-measure", "viritura:test-start", "viritura:test-end");
    }

    expect(performance.getEntriesByName("viritura:test-start", "mark")).toHaveLength(1);
    expect(performance.getEntriesByName("viritura:test-end", "mark")).toHaveLength(1);
    expect(performance.getEntriesByName("viritura:test-measure", "measure")).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import type { DisplayList } from "@viritura/renderer";
import { render, screen } from "@testing-library/react";
import { printOverflowPages } from "../components/ScoreCanvas/parentEffects";
import { AppBanners } from "../app/AppBanners";
import { formatPageRanges } from "../app/printOverflow";

function displayList(staffBottoms: number[]): DisplayList {
  return {
    commands: [],
    width: 100,
    height: 200,
    pages: [
      { pageNumber: 0, systemIndices: [0], yOffset: 0, height: 100 },
      { pageNumber: 1, systemIndices: [1], yOffset: 100, height: 100 },
    ],
    measureBounds: staffBottoms.map((bottom, index) => ({
      index,
      partIndex: index,
      staffIndex: index,
      x: 0,
      width: 20,
      y: bottom - 4,
      height: 4,
      prefixWidth: 0,
      totalBeats: 4,
      beatAnchors: [],
    })),
  };
}

describe("printOverflowPages", () => {
  it("reports pages whose staff lines cross the printable bottom margin", () => {
    expect(printOverflowPages(displayList([91, 195]), 10)).toEqual([1, 2]);
  });

  it("ignores staff lines inside the printable area and hidden bounds", () => {
    const dl = displayList([90, 190]);
    dl.measureBounds![1]!.isHidden = true;
    expect(printOverflowPages(dl, 10)).toEqual([]);
  });

  it("includes engine-measured ink overflow beyond the staff lines", () => {
    const dl = displayList([90, 190]);
    dl.pageOverflows = [{ pageNumber: 1, topOverflowSp: 0, bottomOverflowSp: 0.43 }];
    expect(printOverflowPages(dl, 10)).toEqual([2]);
  });
});

describe("print overflow banner", () => {
  it("names overflowing pages and recommends print-safe remedies", () => {
    render(
      <AppBanners
        isDragOver={false}
        fileError={null}
        trackBannerFile={null}
        handleTrackWithGit={() => {}}
        handleDismissTrackBanner={() => {}}
        printOverflowPages={[2, 4]}
      />,
    );

    expect(screen.getByText(/Pages 2, 4 exceed the printable margins/)).toBeTruthy();
    expect(screen.getByText(/Reduce the staff size/)).toBeTruthy();
  });

  it("compacts consecutive page numbers into readable ranges", () => {
    expect(formatPageRanges([1, 2, 3, 5, 7, 8])).toBe("1–3, 5, 7–8");
  });
});

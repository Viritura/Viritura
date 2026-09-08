import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppBanners } from "./AppBanners";

describe("AppBanners file errors", () => {
  it("keeps technical details collapsed until the user expands them", () => {
    render(
      <AppBanners
        isDragOver={false}
        fileError={'Could not open "score.mnx".\nSchema validation failed\n\nStack trace:\nat parseMnx'}
        trackBannerFile={null}
        handleTrackWithGit={() => {}}
        handleDismissTrackBanner={() => {}}
        printOverflowPages={[]}
      />,
    );

    const disclosure = screen.getByText("Show technical details").closest("details");
    expect(disclosure?.open).toBe(false);
    expect(screen.getByText('⚠️ Could not open "score.mnx".')).toBeTruthy();

    fireEvent.click(screen.getByText("Show technical details"));

    expect(disclosure?.open).toBe(true);
    expect(screen.getByText(/Stack trace:\s+at parseMnx/)).toBeTruthy();
  });
});

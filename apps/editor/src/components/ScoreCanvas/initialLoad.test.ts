import { describe, expect, it, vi } from "vitest";
import { getGlobalPerfTracker, type DisplayList, type ScoreInfo } from "@viritura/renderer";
import { runInitialLoad } from "./initialLoad";

const info: ScoreInfo = {
  partCount: 1,
  partNames: ["Piano"],
  partIds: ["piano"],
  measureCount: 1,
  layoutCount: 1,
  scoreCount: 1,
  scoreNames: [],
};
const displayList: DisplayList = { commands: [], width: 400, height: 200 };

function loadArgs(isStale: () => boolean): Parameters<typeof runInitialLoad>[0] {
  return {
    mnxJson: "{}",
    getScoreInfo: vi.fn(async () => info),
    computeDisplayList: vi.fn(async () => displayList),
    viewMode: "horizon",
    containerWidth: 800,
    debugEnabled: false,
    selectedScoreIndex: 0,
    cachedScoreInfoRef: { current: null },
    displayListRef: { current: null },
    spatialIndexRef: { current: null },
    docScoreRef: { current: null },
    perfTracker: getGlobalPerfTracker(),
    lastScoreDefinitionRelayoutKeyRef: { current: "" },
    lastViewRelayoutJsonRef: { current: "" },
    lastContainerWidthRelayoutRef: { current: null },
    lastDebugRelayoutKeyRef: { current: "" },
    setScoreInfo: vi.fn(),
    setScoreDefinitions: vi.fn(),
    setContentSize: vi.fn(),
    clearSelection: vi.fn(),
    isStale,
  };
}

describe("initial layout publication after undo or document changes", () => {
  it("does not start layout after the source has already been superseded", async () => {
    const args = loadArgs(() => true);
    await runInitialLoad(args);
    expect(args.computeDisplayList).not.toHaveBeenCalled();
    expect(args.displayListRef.current).toBeNull();
  });

  it("does not publish a layout that finishes after a newer source takes over", async () => {
    let stale = false;
    const args = loadArgs(() => stale);
    args.computeDisplayList = vi.fn(async () => {
      stale = true;
      return displayList;
    });
    await runInitialLoad(args);
    expect(args.displayListRef.current).toBeNull();
    expect(args.setContentSize).not.toHaveBeenCalled();
    expect(args.clearSelection).not.toHaveBeenCalled();
  });

  it("publishes current layouts normally", async () => {
    const args = loadArgs(() => false);
    await runInitialLoad(args);
    expect(args.displayListRef.current).toBe(displayList);
    expect(args.clearSelection).toHaveBeenCalledOnce();
  });
});

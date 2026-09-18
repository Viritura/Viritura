import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayheadOverlay, PlaybackState } from "@viritura/playback";
import type { DisplayList, ScoreInfo } from "@viritura/renderer";
import { ScoreCanvas } from "../components/ScoreCanvas";
import type { LayoutBackend } from "../components/ScoreCanvas/layoutBackend";
import type { initWasmAndFont } from "../components/ScoreCanvas/initWasmAndFont";

const mocks = vi.hoisted(() => ({
  playback: {
    status: "playing" as PlaybackState["status"],
    playheadPosition: { measureIndex: 0, beat: 1 },
  },
  overlay: vi.fn<(props: ComponentProps<typeof PlayheadOverlay>) => void>(),
  computeDisplayList: vi.fn<() => Promise<DisplayList>>(),
  initialize: vi.fn<typeof initWasmAndFont>(),
  setZoom: vi.fn(),
  setScroll: vi.fn(),
  resetViewport: vi.fn(),
  viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
  selection: { kind: "none" },
  selectionActions: { clearSelection: vi.fn() },
  document: { mnxJson: '{"mnx":{"version":1},"parts":[]}', score: null, dirty: false },
  documentActions: { updateScore: vi.fn() },
  documentStore: { subscribe: vi.fn(() => vi.fn()), getState: () => ({ workingScore: null, score: null }) },
  playbackActions: {},
  follow: {
    detached: true,
    onUserInteract: vi.fn(),
    onPlayheadRect: vi.fn(),
    reengage: vi.fn(),
  },
}));

vi.mock("@viritura/playback", () => ({
  usePlaybackState: () => mocks.playback,
  usePlaybackActions: () => mocks.playbackActions,
  useFollowEnabled: () => true,
  PlayheadOverlay: (props: ComponentProps<typeof PlayheadOverlay>) => {
    mocks.overlay(props);
    return null;
  },
}));
vi.mock("../hooks/useViewport", async () => {
  const { useRef } = await import("react");
  return {
    useViewport: () => ({
      viewport: mocks.viewport,
      containerRef: useRef<HTMLDivElement>(null),
      dragLockRef: useRef(false),
      isDragging: false,
      setZoom: mocks.setZoom,
      setScroll: mocks.setScroll,
      resetViewport: mocks.resetViewport,
    }),
  };
});
vi.mock("../hooks/useFollowPlayhead", () => ({ useFollowPlayhead: () => mocks.follow }));
vi.mock("../store/DocumentContext", () => ({
  useDocument: () => mocks.document,
  useDocumentActions: () => mocks.documentActions,
  useDocumentStoreApi: () => mocks.documentStore,
}));
vi.mock("../store/selectionStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../store/selectionStore")>()),
  useSelection: () => mocks.selection,
  useSelectionActions: () => mocks.selectionActions,
}));
vi.mock("../store/noteInputStore", () => ({
  useNoteInput: () => ({ state: { active: false } }),
}));
vi.mock("../components/InputCursor", () => ({ InputCursor: () => null }));
vi.mock("../components/ScoreCanvas/usePlayPauseShortcut", () => ({ usePlayPauseShortcut: vi.fn() }));
vi.mock("../components/ScoreCanvas/initWasmAndFont", () => ({
  initWasmAndFont: mocks.initialize,
}));
vi.mock("../components/ScoreCanvas/computeDisplayList", () => ({
  computeDisplayListImpl: mocks.computeDisplayList,
  prewarmPatchChain: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../components/ScoreCanvas/paintScoreFrame", () => ({ paintScoreFrame: vi.fn() }));
vi.mock("../components/ScoreCanvas/relayoutEffects", () => ({
  useFastLayoutCallback: vi.fn(),
  useScoreViewRelayout: vi.fn(),
  runSecondaryRelayout: vi.fn(),
}));

const SCORE_INFO: ScoreInfo = {
  partCount: 1,
  partNames: ["Piano"],
  measureCount: 12,
  layoutCount: 1,
  scoreCount: 1,
  scoreNames: ["Full score"],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function displayList(pageCount: number): DisplayList {
  return {
    commands: [],
    width: 800,
    height: 1000 * pageCount,
    pages: Array.from({ length: pageCount }, (_, pageNumber) => ({
      pageNumber,
      yOffset: pageNumber * 1000,
      width: 800,
      height: 1000,
    })),
  };
}

function latestOverlay() {
  const props = mocks.overlay.mock.calls.at(-1)?.[0];
  expect(props).toBeDefined();
  return props!;
}

function expectUnchangedViewport() {
  expect(mocks.setZoom).not.toHaveBeenCalled();
  expect(mocks.setScroll).not.toHaveBeenCalled();
  expect(mocks.resetViewport).not.toHaveBeenCalled();
  expect(latestOverlay()).toMatchObject({ zoom: 1, scrollX: 0, scrollY: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.playback.status = "playing";
  mocks.playback.playheadPosition = { measureIndex: 0, beat: 1 };
  mocks.document.mnxJson = '{"mnx":{"version":1},"parts":[]}';
  mocks.computeDisplayList.mockReset();
  const backend: LayoutBackend = {
    isReady: () => true,
    isWorker: true,
    hasRetainedScore: () => false,
    cacheStats: () => [0, 0],
    layoutMetrics: vi.fn(),
    getScoreInfo: vi.fn().mockResolvedValue(SCORE_INFO),
    computeMnxScoreLayout: vi.fn(),
    computeLayout: vi.fn(),
    computeFullScoreLayout: vi.fn(),
    relayoutRetainedScore: vi.fn(),
    applyPatchAndLayout: vi.fn(),
    fullLayout: vi.fn(),
    invalidateCache: vi.fn(),
    setEmitLayoutDebug: vi.fn(),
    dispose: vi.fn(),
  };
  mocks.initialize.mockImplementation(({ backendRef, setWasmReady }) => {
    backendRef.current = backend;
    setWasmReady(true);
    return () => {
      backendRef.current = null;
    };
  });
  // Keep animation/idle work out of the regression: no frame or viewport event
  // should be needed to publish a completed initial layout.
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn(() => 1),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScoreCanvas playback lifecycle", () => {
  it("publishes the new layout and latest playing position after returning to the canvas without zoom", async () => {
    const firstLayout = displayList(2);
    const returningLayout = displayList(4);
    const pendingLayout = deferred<DisplayList>();
    mocks.computeDisplayList.mockResolvedValueOnce(firstLayout).mockReturnValueOnce(pendingLayout.promise);
    const first = render(<ScoreCanvas viewMode="page" />);
    await waitFor(() => expect(latestOverlay().displayList).toBe(firstLayout));
    expect(latestOverlay().playheadPosition).toBe(mocks.playback.playheadPosition);
    first.unmount();

    mocks.playback.playheadPosition = { measureIndex: 6, beat: 2 };
    const returned = render(<ScoreCanvas viewMode="page" />);
    await waitFor(() => expect(mocks.computeDisplayList).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Loading score...")).toBeTruthy();
    expect(latestOverlay().displayList).toBeNull();
    expect(latestOverlay().playheadPosition).toBeNull();

    mocks.playback.playheadPosition = { measureIndex: 7, beat: 3 };
    returned.rerender(<ScoreCanvas viewMode="page" />);
    expect(latestOverlay().playheadPosition).toBeNull();
    await act(async () => pendingLayout.resolve(returningLayout));

    expect(screen.queryByText("Loading score...")).toBeNull();
    expect(latestOverlay().displayList).toBe(returningLayout);
    expect(latestOverlay().playheadPosition).toBe(mocks.playback.playheadPosition);
    expectUnchangedViewport();
  });

  it.each(["paused", "stopped", "loading"] as const)(
    "passes null to the overlay and hides follow when %s retains a position",
    async (status) => {
      const layout = displayList(2);
      mocks.computeDisplayList.mockResolvedValue(layout);
      const mounted = render(<ScoreCanvas viewMode="page" />);
      await waitFor(() => expect(latestOverlay().displayList).toBe(layout));
      expect(latestOverlay().playheadPosition).toBe(mocks.playback.playheadPosition);
      expect(screen.queryByRole("button", { name: /follow/i })).not.toBeNull();

      mocks.playback.status = status;
      mounted.rerender(<ScoreCanvas viewMode="page" />);

      expect(mocks.playback.playheadPosition).not.toBeNull();
      expect(latestOverlay().playheadPosition).toBeNull();
      expect(screen.queryByRole("button", { name: /follow/i })).toBeNull();
      expectUnchangedViewport();
    },
  );

  it("reports loaded page counts on initial mount and remount without viewport events", async () => {
    const onPageCountChange = vi.fn();
    const onViewportChange = vi.fn();
    for (const pageCount of [3, 5]) {
      const pendingLayout = deferred<DisplayList>();
      mocks.computeDisplayList.mockReturnValueOnce(pendingLayout.promise);
      onPageCountChange.mockClear();
      const mounted = render(
        <ScoreCanvas viewMode="page" onPageCountChange={onPageCountChange} onViewportChange={onViewportChange} />,
      );
      await waitFor(() => expect(screen.getByText("Loading score...")).toBeTruthy());
      expect(onPageCountChange).toHaveBeenLastCalledWith(0);
      onViewportChange.mockClear();

      await act(async () => pendingLayout.resolve(displayList(pageCount)));

      expect(onPageCountChange).toHaveBeenLastCalledWith(pageCount);
      expect(onViewportChange).not.toHaveBeenCalled();
      expectUnchangedViewport();
      mounted.unmount();
    }
  });

  it("suppresses the retained position while WASM is not ready", () => {
    mocks.initialize.mockImplementation(() => () => undefined);
    render(<ScoreCanvas viewMode="page" />);
    expect(latestOverlay().playheadPosition).toBeNull();
    expect(mocks.computeDisplayList).not.toHaveBeenCalled();
  });

  it("suppresses the retained position when asynchronous initial layout fails", async () => {
    const pendingLayout = deferred<DisplayList>();
    mocks.computeDisplayList.mockReturnValue(pendingLayout.promise);
    render(<ScoreCanvas viewMode="page" />);
    await waitFor(() => expect(mocks.computeDisplayList).toHaveBeenCalled());
    await act(async () => pendingLayout.reject(new Error("Layout unavailable")));

    expect(screen.getByText("Error loading score: Layout unavailable")).toBeTruthy();
    expect(screen.queryByText("Loading score...")).toBeNull();
    expect(latestOverlay().playheadPosition).toBeNull();
  });
});

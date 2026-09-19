import { act, cleanup, render, renderHook } from "@testing-library/react";
import { wrap } from "comlink";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_PAGE_SETUP, type Score } from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import {
  decodeBinaryDisplayList,
  decodeFrame,
  EMPTY_LAYOUT_METRICS,
  PatchReconstructor,
  PerfTracker,
  SpatialIndex,
  type DisplayList,
  type PatchInfo,
} from "@viritura/renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { splitOrchestralParts } from "../../orchestralStaffSplit";
import { useDocumentStoreApi } from "../../store/DocumentContext";
import { resetSelectionStore, useSelectionActions, useSelectionStore } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import { computeDisplayListImpl, tryRelayoutScoreView } from "../ScoreCanvas/computeDisplayList";
import { runFastLayoutAndPaint } from "../ScoreCanvas/fastLayout";
import { pointerToMeasure } from "../ScoreCanvas/hitTesting";
import { createLayoutBackend, type LayoutBackend } from "../ScoreCanvas/layoutBackend";
import {
  getRenderedStaffSources as getMeasureSources,
  useRenderedStaffSources,
} from "../ScoreCanvas/renderedStaffSources";
import { SelectionPlaybackBridge } from "./SelectionPlaybackBridge";

const playback = vi.hoisted(() => ({
  state: { status: "stopped" },
  actions: {
    setSelectionPartIds: vi.fn(),
    measureBeatToSeconds: vi.fn((measure: number) => measure * 2),
    seek: vi.fn(),
  },
}));
vi.mock("comlink", () => ({ wrap: vi.fn() }));
vi.mock("@viritura/playback", () => ({
  getPlaybackSnapshot: () => playback,
  usePlaybackActions: () => playback.actions,
}));
vi.mock("../../store/DocumentContext", async () => {
  const { createStore } = await import("zustand");
  const store = createStore<{ score: Score | null }>(() => ({ score: null }));
  return { useDocumentStoreApi: () => store };
});

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }, {}, {}] },
  parts: [
    { id: "flute", name: "Flute", measures: [{ sequences: [] }, { sequences: [] }, { sequences: [] }] },
    { id: "piano", name: "Piano", staves: 2, measures: [{ sequences: [] }, { sequences: [] }, { sequences: [] }] },
    { id: "cello", name: "Cello", measures: [{ sequences: [] }, { sequences: [] }, { sequences: [] }] },
  ],
  scores: [
    { name: "Condensed", layout: "condensed" },
    { name: "Reordered", layout: "reordered" },
  ],
  layouts: [
    {
      id: "condensed",
      content: [
        { type: "group", content: [{ type: "staff", sources: [{ part: "cello" }, { part: "flute" }] }] },
        { type: "staff", sources: [{ part: "piano", staff: 1 }] },
        { type: "staff", sources: [{ part: "piano", staff: 2 }] },
      ],
    },
    {
      id: "reordered",
      content: [
        { type: "staff", sources: [{ part: "piano", staff: 2 }] },
        { type: "staff", sources: [{ part: "flute" }] },
        { type: "staff", sources: [{ part: "cello" }] },
      ],
    },
  ],
};

interface WasmGlue {
  LayoutEngine: new () => WasmLayoutEngine;
  initSync(options: { module: WebAssembly.Module }): void;
  compute_mnx_score_layout_binary(
    json: string,
    spatium: number,
    pageWidth: number,
    scoreIndex: number,
    pageSetup?: string,
  ): Float32Array;
}

interface WasmLayoutEngine {
  has_retained_score(): boolean;
  compute_full_score_layout_cached_binary(
    json: string,
    sp: number,
    width: number,
    setup?: string,
    index?: number,
  ): Float32Array;
  relayout_retained_score_cached_binary(sp: number, width: number, setup?: string, index?: number): Float32Array;
  apply_patch_and_layout_patch_frame_binary(
    json: string,
    sp: number,
    width: number,
    setup?: string,
    index?: number,
  ): Float32Array;
  free(): void;
}

let wasm: WasmGlue;
beforeAll(async () => {
  const wasmDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    ...Array<string>(5).fill(".."),
    "engine",
    "viritura-wasm",
    "pkg-browser",
  );
  wasm = (await import(/* @vite-ignore */ pathToFileURL(resolve(wasmDir, "viritura_wasm.js")).href)) as WasmGlue;
  wasm.initSync({ module: new WebAssembly.Module(readFileSync(resolve(wasmDir, "viritura_wasm_bg.wasm"))) });
});

// Exercise actual WASM topology and binary transport through canvas projection,
// committed getter, pointer hit-testing, selection actions and the bridge.
function createEngine(retained?: WasmLayoutEngine): LayoutBackend {
  const reconstructor = new PatchReconstructor();
  return {
    isWorker: true,
    isReady: () => true,
    hasRetainedScore: () => retained?.has_retained_score() ?? false,
    cacheStats: () => [0, 0],
    layoutMetrics: () => ({ ...EMPTY_LAYOUT_METRICS }),
    getScoreInfo: vi.fn(),
    computeMnxScoreLayout: async (json, sp, width, index, setup) =>
      decodeBinaryDisplayList(wasm.compute_mnx_score_layout_binary(json, sp, width, index, setup)),
    computeLayout: vi.fn(),
    computeFullScoreLayout: async (json, sp, width, setup, index) =>
      decodeBinaryDisplayList(
        retained
          ? retained.compute_full_score_layout_cached_binary(json, sp, width, setup, index)
          : wasm.compute_mnx_score_layout_binary(json, sp, width, index ?? 0, setup),
      ),
    relayoutRetainedScore: async (sp, width, setup, index) =>
      retained
        ? decodeBinaryDisplayList(retained.relayout_retained_score_cached_binary(sp, width, setup, index))
        : null,
    applyPatchAndLayout: async (json, sp, width, setup, index) => {
      if (!retained) throw new Error("No retained engine");
      return reconstructor.apply(
        decodeFrame(retained.apply_patch_and_layout_patch_frame_binary(json, sp, width, setup, index)),
      );
    },
    fullLayout: vi.fn(),
    invalidateCache: vi.fn(),
    setEmitLayoutDebug: vi.fn(),
    dispose: vi.fn(),
  };
}

async function createWorkerEngine(retained: WasmLayoutEngine): Promise<LayoutBackend> {
  // Only replace the worker/RPC boundary; use production backend, decoding and
  // deferred Horizon reconstruction with real WASM binary frames.
  vi.stubGlobal(
    "Worker",
    class {
      terminate() {}
    },
  );
  vi.mocked(wrap).mockReturnValue({
    init: async () => true,
    engineCacheStats: async () => [0, 0],
    engineLayoutMetrics: async () => ({ ...EMPTY_LAYOUT_METRICS }),
    engineComputeFullScoreLayoutBinary: async (
      ...args: Parameters<WasmLayoutEngine["compute_full_score_layout_cached_binary"]>
    ) => retained.compute_full_score_layout_cached_binary(...args),
    engineApplyPatchAndLayoutPatchFrameBinary: async (
      ...args: Parameters<WasmLayoutEngine["apply_patch_and_layout_patch_frame_binary"]>
    ) => retained.apply_patch_and_layout_patch_frame_binary(...args),
  });
  return createLayoutBackend(false);
}

async function project(
  source: Score,
  scoreIdx: number,
  selectedPartIds?: string[],
  expanded?: Set<string>,
  options: { engine?: LayoutBackend; patchInfo?: PatchInfo; viewMode?: "horizon" | "page" } = {},
) {
  return computeDisplayListImpl({
    mnxJson: JSON.stringify(serializeMnx(source)),
    info: {
      partCount: source.parts.length,
      partNames: [],
      measureCount: 3,
      layoutCount: 2,
      scoreCount: 2,
      scoreNames: [],
    },
    scoreIdx,
    partIndex: 0,
    viewMode: options.viewMode ?? "horizon",
    patchInfo: options.patchInfo,
    selectedPartIds,
    expandedCondensingStaves: expanded,
    score: source,
    engine: options.engine ?? createEngine(),
    perfTracker: new PerfTracker(),
    setLayoutPerfDebug: vi.fn(),
    pageSetupRef: { current: DEFAULT_PAGE_SETUP },
    showHiddenRests: false,
  });
}

function getRenderedStaffSources(displayList: DisplayList | null) {
  const measures = getMeasureSources(displayList);
  if (!measures) return undefined;
  const staves: Set<string>[] = [];
  for (const { staffIndex, partIds } of measures) {
    const sources = (staves[staffIndex] ??= new Set());
    for (const id of partIds) sources.add(id);
  }
  return Array.from(staves, (sources) => [...(sources ?? [])]);
}

function selectSpan(
  displayList: DisplayList,
  first: number,
  last = first,
  firstMeasure?: number,
  lastMeasure?: number,
) {
  const { result } = renderHook(() => useSelectionActions());
  const firstBound = displayList.measureBounds!.find(
    (bound) => bound.staffIndex === first && (firstMeasure === undefined || bound.index === firstMeasure),
  )!;
  const lastBound = displayList
    .measureBounds!.filter(
      (bound) => bound.staffIndex === last && (lastMeasure === undefined || bound.index === lastMeasure),
    )
    .at(-1)!;
  const start = pointerToMeasure(
    firstBound.x + firstBound.width / 2,
    firstBound.y + firstBound.height / 2,
    displayList.measureBounds,
  )!;
  const end = pointerToMeasure(
    lastBound.x + lastBound.width / 2,
    lastBound.y + lastBound.height / 2,
    displayList.measureBounds,
  )!;
  act(() => {
    result.current.selectMeasure(start.partIndex, start.staffIndex, start.measureIndex, start.localStaffIndex);
    result.current.extendMeasure(end.partIndex, end.staffIndex, end.measureIndex, end.localStaffIndex);
  });
}

function mountCanvas(displayList: DisplayList | null) {
  const ref = { current: displayList };
  const hook = renderHook(({ version }) => useRenderedStaffSources(ref, version, false), {
    initialProps: { version: 0 },
  });
  return { ref, ...hook };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectionStore();
  useViewStateStore.setState({ selectedScoreIndex: 0, selectedPartIds: [] });
  renderHook(() => useDocumentStoreApi()).result.current.setState({ score });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("committed staff projection playback selection", () => {
  it.each([false, true])(
    "commits deferred Horizon sources with the frame and index (automatic meter split=%s)",
    async (splitMeter) => {
      const source = structuredClone(score);
      const measureCount = 96;
      source.global.measures = Array.from({ length: measureCount }, (_, index) => ({
        id: `m${index}`,
        ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
      }));
      for (const part of source.parts) {
        part.measures = Array.from({ length: measureCount }, () => ({ sequences: [] }));
      }
      if (splitMeter) {
        source.parts[2]!.measures[0]!.staffMeters = [
          { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
        ];
      }
      const documentStore = renderHook(() => useDocumentStoreApi()).result.current;
      documentStore.setState({ score: source });
      const retained = new wasm.LayoutEngine();
      const engine = await createWorkerEngine(retained);
      try {
        expect(engine.isWorker).toBe(true);
        const initialSource = structuredClone(source);
        delete initialSource.parts[2]!.measures[0]!.staffMeters;
        await project(initialSource, 0, undefined, undefined, { engine });
        const patchInfo: PatchInfo = {
          changedGlobalMeasures: [],
          changedPartMeasures: new Map(),
          structuralChange: false,
          prebuiltPatchJson: "{}",
        };
        const initial = await project(initialSource, 0, undefined, undefined, { engine, patchInfo });
        if (splitMeter) {
          patchInfo.changedPartMeasures.set(2, [0]);
          patchInfo.prebuiltPatchJson = JSON.stringify({
            partMeasures: { 2: { 0: serializeMnx(source).parts[2]!.measures[0] } },
          });
        }
        const initialBounds = structuredClone(initial.measureBounds);
        const initialSources = getMeasureSources(initial);
        const canvas = mountCanvas(initial);
        const spatialIndexRef = { current: SpatialIndex.fromDisplayList(initial) };
        const previousIndex = spatialIndexRef.current;
        const versionRef = { current: 0 };
        const capturedScoreRef = { current: source };
        render(<SelectionPlaybackBridge />);
        const publish = vi.fn(() => {
          expect(spatialIndexRef.current).not.toBe(previousIndex);
          expect(spatialIndexRef.current.all).toEqual(SpatialIndex.fromDisplayList(canvas.ref.current!).all);
          expect(getMeasureSources(canvas.ref.current)).toHaveLength(canvas.ref.current!.measureBounds!.length);
          canvas.result.current();
        });
        const paint = vi.fn(() => {
          expect(useSelectionStore.getState().renderedStaffSources).toBe(getMeasureSources(canvas.ref.current));
        });
        let pending: DisplayList | undefined;
        await act(async () => {
          await runFastLayoutAndPaint({
            json: "",
            patchInfo,
            computeDisplayList: async () => {
              pending = await project(source, 0, undefined, undefined, { engine, patchInfo });
              expect(pending).not.toBe(initial);
              expect(pending.finalizeRetainedFrame).toBeTypeOf("function");
              expect(pending.measureBounds).toBeUndefined();
              expect(canvas.ref.current).toBe(initial);
              expect(spatialIndexRef.current).toBe(previousIndex);
              expect(useSelectionStore.getState().renderedStaffSourcesGetter?.()).toBe(initialSources);
              // The result must retain request identities, not reinterpret source
              // indices against the document visible when the worker completes.
              documentStore.setState({
                score: { ...source, parts: [source.parts[2]!, source.parts[1]!, source.parts[0]!] },
              });
              return pending;
            },
            displayListRef: canvas.ref,
            displayListVersionRef: versionRef,
            spatialIndexRef,
            docScoreRef: capturedScoreRef,
            paintNowRef: { current: paint },
            perfTracker: new PerfTracker(),
            onDisplayListCommit: publish,
          });
        });
        const committed = canvas.ref.current!;
        expect(committed).toBe(pending);
        expect(committed.finalizeRetainedFrame).toBeUndefined();
        expect(committed.retainedRenderLayers!.length).toBeGreaterThan(3);
        expect(initial.measureBounds).toEqual(initialBounds);
        expect(getMeasureSources(initial)).toBe(initialSources);
        expect(versionRef.current).toBe(1);
        expect(publish).toHaveBeenCalledOnce();
        expect(paint).toHaveBeenCalledOnce();
        selectSpan(committed, 0, 0, measureCount - 1, measureCount - 1);
        expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(
          splitMeter ? ["cello"] : ["cello", "flute"],
        );
        selectSpan(committed, 1, 1, 0, measureCount - 1);
        expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(splitMeter ? ["flute"] : ["piano"]);
        expect(getMeasureSources(committed)).toEqual(
          committed.measureBounds!.map((bound) => ({
            staffIndex: bound.staffIndex,
            measureIndex: bound.index,
            partIds: (bound.sourcePartIndices ?? [bound.partIndex]).map((index) => source.parts[index]!.id),
          })),
        );
      } finally {
        engine.dispose();
        retained.free();
      }
    },
  );

  it("limits source identities to selected measures when explicit systems reorder their staves", async () => {
    const reordered: Score = {
      ...score,
      global: { measures: [{ id: "m0", time: { count: 4, unit: 4 } }, { id: "m1" }, { id: "m2" }] },
      layouts: [
        {
          id: "before",
          content: [
            { type: "staff", sources: [{ part: "flute" }] },
            { type: "staff", sources: [{ part: "cello" }] },
          ],
        },
        {
          id: "after",
          content: [
            { type: "staff", sources: [{ part: "cello" }] },
            { type: "staff", sources: [{ part: "flute" }] },
          ],
        },
      ],
      scores: [
        {
          pages: [
            {
              systems: [
                { measure: "m0", layout: "before" },
                { measure: "m1", layout: "after" },
              ],
            },
          ],
        },
      ],
    };
    renderHook(() => useDocumentStoreApi()).result.current.setState({ score: reordered });
    const displayList = await project(reordered, 0);
    mountCanvas(displayList);
    render(<SelectionPlaybackBridge />);
    selectSpan(displayList, 0, 0, 0, 0);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute"]);
    selectSpan(displayList, 0, 0, 1, 2);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["cello"]);
    selectSpan(displayList, 0, 0, 2, 0);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "cello"]);
  });

  it("selects the effective condensed sources after an explicit mid-system layout change", async () => {
    const changing: Score = {
      ...score,
      global: { measures: [{ id: "m0", time: { count: 4, unit: 4 } }, { id: "m1" }, { id: "m2" }] },
      layouts: [
        { id: "before", content: [{ type: "staff", sources: [{ part: "flute" }, { part: "cello" }] }] },
        { id: "after", content: [{ type: "staff", sources: [{ part: "flute" }, { part: "piano", staff: 2 }] }] },
      ],
      scores: [
        {
          pages: [
            {
              systems: [
                {
                  measure: "m0",
                  layout: "before",
                  layoutChanges: [{ layout: "after", location: { measure: "m1", position: { fraction: [0, 1] } } }],
                },
              ],
            },
          ],
        },
      ],
    };
    renderHook(() => useDocumentStoreApi()).result.current.setState({ score: changing });
    const displayList = await project(changing, 0);
    expect(getMeasureSources(displayList)).toEqual([
      { staffIndex: 0, measureIndex: 0, partIds: ["flute", "cello"] },
      { staffIndex: 0, measureIndex: 1, partIds: ["flute", "piano"] },
      { staffIndex: 0, measureIndex: 2, partIds: ["flute", "piano"] },
    ]);
    mountCanvas(displayList);
    render(<SelectionPlaybackBridge />);
    selectSpan(displayList, 0, 0, 0, 0);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "cello"]);
    selectSpan(displayList, 0, 0, 1, 2);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "piano"]);
    selectSpan(displayList, 0);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "piano", "cello"]);
  });

  it.each([{ parts: undefined }, { parts: ["flute", "cello"] }])(
    "selects automatic meter splits from actual WASM (filter=$parts)",
    async ({ parts }) => {
      const polymeter = structuredClone(score);
      polymeter.parts[2]!.measures[0]!.staffMeters = [
        { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
      ];
      renderHook(() => useDocumentStoreApi()).result.current.setState({ score: polymeter });
      const displayList = await project(polymeter, 0, parts);
      expect(getRenderedStaffSources(displayList)?.slice(0, 2)).toEqual([["cello"], ["flute"]]);
      mountCanvas(displayList);
      render(<SelectionPlaybackBridge />);
      selectSpan(displayList, 0);
      expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["cello"]);
      selectSpan(displayList, 1);
      expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute"]);
      selectSpan(displayList, 1, 0);
      expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "cello"]);
    },
  );

  it.each([false, true])("selects exact expanded sources and whole instruments (reverse=%s)", async (reverse) => {
    const displayList = await project(score, 0, undefined, new Set(["0-0"]));
    expect(getRenderedStaffSources(displayList)).toEqual([
      ["cello", "flute"],
      ["cello"],
      ["flute"],
      ["piano"],
      ["piano"],
    ]);
    mountCanvas(displayList);
    render(<SelectionPlaybackBridge />);
    selectSpan(displayList, 1);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["cello"]);
    selectSpan(displayList, 2);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute"]);
    selectSpan(displayList, 0);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "cello"]);
    selectSpan(displayList, 4);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano"]);
    selectSpan(displayList, reverse ? 4 : 2, reverse ? 2 : 4);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "piano"]);
    selectSpan(displayList, reverse ? 4 : 0, reverse ? 0 : 4);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "piano", "cello"]);
    expect(playback.actions.seek).toHaveBeenLastCalledWith(0);
  });

  it("maps automatic splits before injected expansion staves, without shifting the following instruments", async () => {
    const polymeter = structuredClone(score);
    polymeter.parts[2]!.measures[0]!.staffMeters = [
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
    ];
    const displayList = await project(polymeter, 0, undefined, new Set(["0-0"]));
    expect(getRenderedStaffSources(displayList)).toEqual([
      ["cello"],
      ["flute"],
      ["cello"],
      ["flute"],
      ["piano"],
      ["piano"],
    ]);
    renderHook(() => useDocumentStoreApi()).result.current.setState({ score: polymeter });
    mountCanvas(displayList);
    render(<SelectionPlaybackBridge />);
    selectSpan(displayList, 2);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["cello"]);
    selectSpan(displayList, 3);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute"]);
    selectSpan(displayList, 5);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano"]);
  });

  it.each(["horizon", "page"] as const)(
    "preserves resolved sources through cached, retained and patch commits (%s)",
    async (viewMode) => {
      const retained = new wasm.LayoutEngine();
      const engine = createEngine(retained);
      try {
        const initial = await project(score, 0, undefined, undefined, { engine, viewMode });
        expect(getRenderedStaffSources(initial)).toEqual([["cello", "flute"], ["piano"], ["piano"]]);
        const canvas = mountCanvas(initial);
        render(<SelectionPlaybackBridge />);
        selectSpan(initial, 0);
        expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "cello"]);

        const relayout = await tryRelayoutScoreView({
          scoreIdx: 1,
          viewMode,
          score,
          engine,
          selectedPartIds: undefined,
          expandedCondensingStaves: undefined,
          pageSetupRef: { current: DEFAULT_PAGE_SETUP },
        });
        expect(getRenderedStaffSources(relayout)).toEqual([["piano"], ["flute"], ["cello"]]);
        canvas.ref.current = relayout;
        act(() => canvas.result.current());
        selectSpan(relayout!, 0);
        expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano"]);

        // Cold then warm patch frames exercise fresh and retained-system transport.
        for (let i = 0; i < 2; i++) {
          const patched = await project(score, 0, undefined, undefined, {
            engine,
            viewMode,
            patchInfo: {
              changedGlobalMeasures: [],
              changedPartMeasures: new Map(),
              structuralChange: false,
              prebuiltPatchJson: "{}",
              fallbackJson: () => JSON.stringify(serializeMnx(score)),
            },
          });
          expect(getRenderedStaffSources(patched)).toEqual([["cello", "flute"], ["piano"], ["piano"]]);
          canvas.ref.current = patched;
          act(() => canvas.result.current());
          selectSpan(patched, 0);
          expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "cello"]);
        }
      } finally {
        retained.free();
      }
    },
  );

  it("uses the actual multi-part projection before expansion, including reordered part views", async () => {
    const displayList = await project(score, 1, ["cello", "piano"], new Set(["0-0"]));
    expect(getRenderedStaffSources(displayList)).toEqual([["piano"], ["cello"]]);
    mountCanvas(displayList);
    render(<SelectionPlaybackBridge />);
    selectSpan(displayList, 1);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["cello"]);
    selectSpan(displayList, 1, 0);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano", "cello"]);
  });

  it("retains all sources on a filtered condensed staff, even for a single selected part", async () => {
    const displayList = await project(score, 0, ["cello"]);
    expect(getRenderedStaffSources(displayList)).toEqual([["cello", "flute"]]);
    mountCanvas(displayList);
    render(<SelectionPlaybackBridge />);
    selectSpan(displayList, 0);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute", "cello"]);
  });

  it("retains selection across canvas/bridge remount and publishes new committed topology without seeking", async () => {
    const expanded = await project(score, 0, undefined, new Set(["0-0"]));
    const canvas = mountCanvas(expanded);
    const bridge = render(<SelectionPlaybackBridge />);
    selectSpan(expanded, 1);
    const selection = useSelectionStore.getState().selection;
    playback.actions.seek.mockClear();
    canvas.unmount();
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["cello"]);
    bridge.unmount();
    render(<SelectionPlaybackBridge />);
    const returningCanvas = mountCanvas(null);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["cello"]);
    const filtered = await project(score, 1, ["piano", "flute"]);
    // A computed but uncommitted result cannot change selection playback.
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["cello"]);
    returningCanvas.ref.current = filtered;
    returningCanvas.rerender({ version: 1 });
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute"]);
    expect(useSelectionStore.getState().selection).toBe(selection);
    expect(playback.actions.seek).not.toHaveBeenCalled();
  });

  it("publishes fast-path commits without a React layout-version render", async () => {
    const expanded = await project(score, 0, undefined, new Set(["0-0"]));
    const canvas = mountCanvas(expanded);
    render(<SelectionPlaybackBridge />);
    selectSpan(expanded, 1);
    playback.actions.seek.mockClear();
    canvas.ref.current = await project(score, 1, ["piano", "flute"]);
    act(() => canvas.result.current());
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute"]);
    expect(playback.actions.seek).not.toHaveBeenCalled();
  });

  it("drops the projection override when an ordinary layout commits, without changing selection or seeking", async () => {
    const expanded = await project(score, 0, undefined, new Set(["0-0"]));
    const canvas = mountCanvas(expanded);
    render(<SelectionPlaybackBridge />);
    selectSpan(expanded, 1);
    const selection = useSelectionStore.getState().selection;
    playback.actions.seek.mockClear();
    canvas.ref.current = { commands: [], width: 300, height: 300 };
    canvas.rerender({ version: 1 });
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano"]);
    expect(useSelectionStore.getState().selection).toBe(selection);
    expect(playback.actions.seek).not.toHaveBeenCalled();
  });

  it("does not let preview canvases or superseded canvas cleanup replace the active mapping", async () => {
    const expanded = await project(score, 0, undefined, new Set(["0-0"]));
    const oldCanvas = mountCanvas(expanded);
    const currentCanvas = mountCanvas(await project(score, 1, ["piano", "flute"]));
    render(<SelectionPlaybackBridge />);
    selectSpan(currentCanvas.ref.current!, 1);
    playback.actions.seek.mockClear();
    renderHook(() => useRenderedStaffSources({ current: expanded }, 0, true));
    oldCanvas.unmount();
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["flute"]);
    expect(useSelectionStore.getState().renderedStaffSourcesGetter?.()).toEqual(
      getMeasureSources(currentCanvas.ref.current),
    );
    expect(playback.actions.seek).not.toHaveBeenCalled();
  });

  it("reads the current canvas getter before the next publication rather than retaining a collapsed projection", async () => {
    const expanded = await project(score, 0, undefined, new Set(["0-0"]));
    const canvas = mountCanvas(expanded);
    render(<SelectionPlaybackBridge />);
    selectSpan(expanded, 1);
    const ordinary = { ...expanded };
    canvas.ref.current = ordinary;
    selectSpan(ordinary, 1);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["piano"]);
  });

  it("uses instrument IDs created by orchestralStaffSplit for expanded condensed staves", async () => {
    const targets = [
      ["P2", "Oboi", 1],
      ["P3", "Clarinetti in Bb", 2],
      ["P4", "Fagotti", 2],
      ["P5", "Corni in F", 1],
      ["P6", "Trombe in Bb", 1],
      ["P7", "Tromboni", 2],
    ] as const;
    const split = splitOrchestralParts({
      mnx: { version: 1 },
      global: { measures: [{ id: "m1" }] },
      parts: targets.map(([id, name, staves]) => ({ id, name, staves, measures: [{ sequences: [] }] })),
      scores: [{ name: "Full Score", layout: "full" }],
      layouts: [
        {
          id: "full",
          content: [
            {
              type: "group",
              content: targets.flatMap(([part, , staves]) =>
                Array.from({ length: staves }, (_, staff) => ({
                  type: "staff" as const,
                  sources: [{ part, staff: staff + 1 }],
                })),
              ),
            },
          ],
        },
      ],
    });
    const index = split.scores!.findIndex((definition) => definition.name === "Condensed Score");
    const layout = split.layouts!.find((item) => item.id === split.scores![index]!.layout)!;
    const group = layout.content[0]!;
    if (group.type !== "group") throw new Error("Expected orchestral group");
    const path = group.content.findIndex((node) => node.type === "staff" && node.sources[0]?.part === "P2-1");
    expect(path).toBeGreaterThanOrEqual(0);
    const displayList = await project(split, index, undefined, new Set([`0-${path}`]));
    const sources = getRenderedStaffSources(displayList)!;
    expect(sources.slice(0, 3)).toEqual([["P2-1", "P2-2"], ["P2-1"], ["P2-2"]]);
    renderHook(() => useDocumentStoreApi()).result.current.setState({ score: split });
    useViewStateStore.setState({ selectedScoreIndex: index });
    mountCanvas(displayList);
    render(<SelectionPlaybackBridge />);
    selectSpan(displayList, 2);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["P2-2"]);
    selectSpan(displayList, 0);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(["P2-1", "P2-2"]);
    selectSpan(displayList, sources.length - 1, 0);
    expect(playback.actions.setSelectionPartIds).toHaveBeenLastCalledWith(split.parts.map((part) => part.id));
  });
});

// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Score, SequenceContent } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import {
  decodeBinaryDisplayList,
  decodeFrame,
  getGlobalPerfTracker,
  PatchReconstructor,
  type DisplayList,
  type PatchInfo,
} from "@viritura/renderer";
import { runFastLayoutAndPaint } from "../components/ScoreCanvas/fastLayout";
import { addNoteAtClick } from "../components/ScoreCanvas/noteInputClickHandler";
import { buildEnrichedSpatialIndex } from "../store/enrichSpatialIndex";
import { createDocumentStore, type DocumentStore } from "../store/documentStore";
import { initialNoteInputState } from "../store/noteInputStore";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const wasmPath = resolve(root, "engine/viritura-wasm/pkg-browser/viritura_wasm_bg.wasm");
const gluePath = resolve(root, "engine/viritura-wasm/pkg-browser/viritura_wasm.js");
const fixturePath = resolve(root, "packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx");
const perfSkipped = process.env.VIRITURA_SKIP_PERF === "1";
const available = existsSync(wasmPath) && existsSync(gluePath) && !perfSkipped;
const BUDGET_MULTIPLIER = Number(process.env.PERF_BUDGET_MULTIPLIER ?? (process.env.CI ? "2" : "1"));
const SP = 8;
const HORIZON_WIDTH = 0;
const SCORE_INDEX = 1;
const SERIAL_EDITS = 48;
const BURST_COUNT = 4;
const BURST_SIZE = 8;

interface Engine {
  compute_full_score_layout_cached_binary(
    json: string,
    sp: number,
    width: number,
    setup: undefined,
    index: number,
  ): Float32Array;
  apply_patch_and_layout_patch_frame_binary(
    json: string,
    sp: number,
    width: number,
    setup: undefined,
    index: number,
  ): Float32Array;
  free(): void;
}

interface Glue {
  initSync(opts: { module: WebAssembly.Module }): void;
  LayoutEngine: new () => Engine;
}

interface PathStats {
  p50: number;
  p95: number;
  max: number;
}

interface ClickMetric {
  commandMs: number;
  layoutMs: number;
  totalMs: number;
}

interface EventLocation {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
}

let glue: Glue | null = null;

beforeAll(async () => {
  if (!available) return;
  const imported = (await import(/* @vite-ignore */ pathToFileURL(gluePath).href)) as Glue;
  imported.initSync({ module: new WebAssembly.Module(readFileSync(wasmPath)) });
  glue = imported;
});

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
  return sorted[idx]!;
}

function statsOf(samples: number[]): PathStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function formatStats(stats: PathStats): string {
  return `p50=${stats.p50.toFixed(1)} p95=${stats.p95.toFixed(1)} max=${stats.max.toFixed(1)}ms`;
}

function collectPitchedEventLocations(score: Score): Map<string, EventLocation> {
  const out = new Map<string, EventLocation>();
  const visit = (items: readonly SequenceContent[], location: EventLocation): void => {
    for (const item of items) {
      if (item.type === "event") {
        if (item.notes && item.notes.length > 0 && item.id) out.set(item.id, location);
      } else if ("content" in item) {
        visit(item.content, location);
      }
    }
  };

  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const part = score.parts[partIndex];
    if (!part) continue;
    for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex++) {
      const measure = part.measures[measureIndex];
      if (!measure) continue;
      for (let sequenceIndex = 0; sequenceIndex < measure.sequences.length; sequenceIndex++) {
        const sequence = measure.sequences[sequenceIndex];
        if (sequence) visit(sequence.content, { partIndex, measureIndex, sequenceIndex });
      }
    }
  }
  return out;
}

function newPitchedEventIds(before: Score, after: Score): string[] {
  const beforeIds = collectPitchedEventLocations(before);
  const afterIds = collectPitchedEventLocations(after);
  return [...afterIds.keys()].filter((id) => !beforeIds.has(id));
}

function changedMeasureReferences(before: Score, after: Score): number {
  return after.parts.reduce((total, part, partIndex) => {
    const previousPart = before.parts[partIndex];
    if (!previousPart) return total + part.measures.length;
    return (
      total + part.measures.filter((measure, measureIndex) => measure !== previousPart.measures[measureIndex]).length
    );
  }, 0);
}

function targetBounds(
  displayList: DisplayList,
  measureIndex: number,
): NonNullable<DisplayList["measureBounds"]>[number] {
  const bounds = displayList.measureBounds?.find((b) => b.index === measureIndex && b.partIndex === 0);
  expect(bounds, `measure ${measureIndex} has a clickable first-part bound`).toBeDefined();
  return bounds!;
}

async function waitForPublishedScore(store: DocumentStore, expected: Score): Promise<void> {
  if (store.getState().score === expected) return;
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error("Timed out waiting for note-input layout publication"));
    }, 15_000);
    const stop = store.subscribe((state) => {
      if (state.score !== expected) return;
      clearTimeout(timer);
      stop();
      resolvePromise();
    });
  });
}

const suite = available ? describe : describe.skip;
const skipReason = !existsSync(wasmPath) || !existsSync(gluePath) ? "WASM artifacts not built" : "VIRITURA_SKIP_PERF=1";

suite(`Beethoven real-WASM click-entry lifecycle${available ? "" : ` — SKIPPED: ${skipReason}`}`, () => {
  it("keeps serial clicks bounded and burst clicks coalesced without dropping edits", async () => {
    if (!glue) throw new Error("WASM glue not initialised");

    const store = createDocumentStore();
    const perf = getGlobalPerfTracker();
    perf.fastLayoutCallback = null;
    const sourceScore = parseMnx(JSON.parse(readFileSync(fixturePath, "utf8")));
    store.getState().loadScore(sourceScore);
    const immutableLoadedInput = JSON.stringify(sourceScore);
    expect(store.getState().score!.global.measures).toHaveLength(502);
    expect(store.getState().score!.parts).toHaveLength(18);

    const engine = new glue.LayoutEngine();
    const reconstructor = new PatchReconstructor();
    const initial = decodeBinaryDisplayList(
      engine.compute_full_score_layout_cached_binary(
        store.getState().mnxJson,
        SP,
        HORIZON_WIDTH,
        undefined,
        SCORE_INDEX,
      ),
    );
    const displayListRef = { current: initial as DisplayList | null };
    const spatialIndexRef = { current: buildEnrichedSpatialIndex(initial, store.getState().workingScore) };
    const docScoreRef = { current: store.getState().workingScore };
    const displayListVersionRef = { current: 0 };
    const paintNowRef = { current: () => {} };
    const insertedIds: string[] = [];
    const commandSamples: number[] = [];
    const layoutSamples: number[] = [];
    const totalSamples: number[] = [];
    const burstDurations: number[] = [];
    let calls = 0;
    let fullCalls = 0;
    let maxPatchMeasures = 0;
    let maxChangedReferences = 0;
    let workerQueue: Promise<void> = Promise.resolve();
    let latestLayoutMs = 0;

    const unsubscribe = store.subscribe((state) => {
      docScoreRef.current = state.workingScore;
    });
    const compute = async (json: string, patch?: PatchInfo): Promise<DisplayList> => {
      calls++;
      const start = performance.now();
      let displayList: DisplayList;
      if (patch?.prebuiltPatchJson) {
        const changedPatchMeasures = [...patch.changedPartMeasures.values()].reduce(
          (sum, measures) => sum + measures.length,
          0,
        );
        maxPatchMeasures = Math.max(maxPatchMeasures, changedPatchMeasures);
        displayList = reconstructor.apply(
          decodeFrame(
            engine.apply_patch_and_layout_patch_frame_binary(
              patch.prebuiltPatchJson,
              SP,
              HORIZON_WIDTH,
              undefined,
              SCORE_INDEX,
            ),
          ),
          true,
        );
      } else {
        fullCalls++;
        reconstructor.reset();
        displayList = decodeBinaryDisplayList(
          engine.compute_full_score_layout_cached_binary(json, SP, HORIZON_WIDTH, undefined, SCORE_INDEX),
        );
      }
      latestLayoutMs = performance.now() - start;
      layoutSamples.push(latestLayoutMs);
      return displayList;
    };

    perf.fastLayoutCallback = (json, patchInfo) => {
      const capturedScore = docScoreRef.current;
      const run = workerQueue.then(async () => {
        await Promise.resolve();
        await runFastLayoutAndPaint({
          json,
          patchInfo,
          computeDisplayList: compute,
          displayListRef,
          spatialIndexRef,
          docScoreRef: { current: capturedScore },
          shouldCommit: () => docScoreRef.current === capturedScore,
          displayListVersionRef,
          paintNowRef,
          perfTracker: perf,
        });
      });
      workerQueue = run.catch(() => {});
      return run;
    };

    const clickMeasure = async (measureIndex: number, recordTiming: boolean): Promise<ClickMetric> => {
      const displayList = displayListRef.current;
      expect(displayList, "display list is available for click hit-testing").not.toBeNull();
      const bounds = targetBounds(displayList!, measureIndex);
      const before = store.getState().workingScore!;
      performance.mark("viritura:input-event");
      const start = performance.now();
      addNoteAtClick({
        score: before,
        info: {
          scoreX: bounds.x + bounds.prefixWidth + 1,
          scoreY: bounds.y + 8,
          staffPosition: 1,
          staff: {
            x: bounds.x,
            xEnd: bounds.x + bounds.width,
            y: bounds.y,
            spatium: SP,
            height: 32,
            index: bounds.staffIndex,
          },
          shiftKey: false,
          altKey: false,
        },
        noteInputState: { ...initialNoteInputState, active: true, currentVoice: 2, currentDuration: "eighth" },
        spatialIndex: spatialIndexRef.current,
        displayList,
        selectedScoreIndex: SCORE_INDEX,
        updateScore: store.getState().updateScore,
        setCursor: vi.fn(),
        setLastPitch: vi.fn(),
        setAccidental: vi.fn(),
        setSlurStart: vi.fn(),
        clearSlurStart: vi.fn(),
        toggleSlur: vi.fn(),
        playbackActions: { previewNote: vi.fn() } as never,
      });
      const commandMs = performance.now() - start;
      const next = store.getState().workingScore!;
      expect(next, `measure ${measureIndex} click changes the working score`).not.toBe(before);
      const newIds = newPitchedEventIds(before, next);
      expect(newIds.length, `measure ${measureIndex} click inserts pitched content`).toBeGreaterThan(0);
      const newLocations = collectPitchedEventLocations(next);
      for (const id of newIds) {
        const location = newLocations.get(id);
        expect(location, `inserted event ${id} remains addressable`).toMatchObject({
          partIndex: 0,
          measureIndex,
          sequenceIndex: 1,
        });
      }
      insertedIds.push(...newIds);
      maxChangedReferences = Math.max(maxChangedReferences, changedMeasureReferences(before, next));
      await waitForPublishedScore(store, next);
      const totalMs = performance.now() - start;
      if (recordTiming) {
        commandSamples.push(commandMs);
        totalSamples.push(totalMs);
      }
      return { commandMs, layoutMs: latestLayoutMs, totalMs };
    };

    try {
      const warmup = await clickMeasure(8, false);
      for (let i = 1; i < SERIAL_EDITS; i++) {
        await clickMeasure(8 + i, true);
      }
      const serialCalls = calls;
      const serialMaxPatchMeasures = maxPatchMeasures;
      const warmedLayoutSamples = layoutSamples.slice(1);

      for (let burst = 0; burst < BURST_COUNT; burst++) {
        const firstMeasure = 100 + burst * BURST_SIZE;
        const callsBefore = calls;
        const start = performance.now();
        let expectedScore = store.getState().workingScore!;
        for (let offset = 0; offset < BURST_SIZE; offset++) {
          const measureIndex = firstMeasure + offset;
          const before = store.getState().workingScore!;
          const bounds = targetBounds(displayListRef.current!, measureIndex);
          addNoteAtClick({
            score: before,
            info: {
              scoreX: bounds.x + bounds.prefixWidth + 1,
              scoreY: bounds.y + 8,
              staffPosition: 1,
              staff: {
                x: bounds.x,
                xEnd: bounds.x + bounds.width,
                y: bounds.y,
                spatium: SP,
                height: 32,
                index: bounds.staffIndex,
              },
              shiftKey: false,
              altKey: false,
            },
            noteInputState: { ...initialNoteInputState, active: true, currentVoice: 2, currentDuration: "eighth" },
            spatialIndex: spatialIndexRef.current,
            displayList: displayListRef.current,
            selectedScoreIndex: SCORE_INDEX,
            updateScore: store.getState().updateScore,
            setCursor: vi.fn(),
            setLastPitch: vi.fn(),
            setAccidental: vi.fn(),
            setSlurStart: vi.fn(),
            clearSlurStart: vi.fn(),
            toggleSlur: vi.fn(),
            playbackActions: { previewNote: vi.fn() } as never,
          });
          expectedScore = store.getState().workingScore!;
          expect(expectedScore, `burst ${burst} click ${offset} is not a no-op`).not.toBe(before);
          const newIds = newPitchedEventIds(before, expectedScore);
          expect(newIds.length, `burst ${burst} click ${offset} inserts content`).toBeGreaterThan(0);
          const newLocations = collectPitchedEventLocations(expectedScore);
          for (const id of newIds) {
            expect(newLocations.get(id), `burst inserted event ${id} remains addressable`).toMatchObject({
              partIndex: 0,
              measureIndex,
              sequenceIndex: 1,
            });
          }
          insertedIds.push(...newIds);
          maxChangedReferences = Math.max(maxChangedReferences, changedMeasureReferences(before, expectedScore));
        }
        await waitForPublishedScore(store, expectedScore);
        const burstCalls = calls - callsBefore;
        burstDurations.push(performance.now() - start);
        expect(burstCalls, `burst ${burst} layout calls`).toBeLessThanOrEqual(2);
      }

      const warmedCommands = statsOf(commandSamples);
      const warmedLayouts = statsOf(warmedLayoutSamples);
      const warmedTotals = statsOf(totalSamples);
      const burstStats = statsOf(burstDurations);
      const finalScore = store.getState().score!;
      const finalLocations = collectPitchedEventLocations(finalScore);
      const missingIds = insertedIds.filter((id) => !finalLocations.has(id));
      if (missingIds.length > 0) {
        console.error(`[Beethoven click] missing inserted event ids: ${missingIds.slice(0, 8).join(", ")}`);
      }
      expect(missingIds).toHaveLength(0);
      const indexedIds = new Set(spatialIndexRef.current.all.map((entry) => entry.id));
      for (const id of insertedIds) {
        const location = finalLocations.get(id)!;
        expect(
          indexedIds.has(`p${location.partIndex}/m${location.measureIndex}/s${location.sequenceIndex}/${id}`),
          `inserted event ${id} remains hittable after later reflows`,
        ).toBe(true);
      }
      expect(new Set(insertedIds).size).toBe(insertedIds.length);
      expect(JSON.stringify(sourceScore)).toBe(immutableLoadedInput);
      parseMnx(JSON.parse(store.getState().mnxJson));

      console.log(
        `[Beethoven click] warmup command=${warmup.commandMs.toFixed(1)} layout=${warmup.layoutMs.toFixed(
          1,
        )} total=${warmup.totalMs.toFixed(1)}ms; serial warmed=${commandSamples.length}+1warmup/48 ` +
          `calls=${serialCalls} full=${fullCalls} serialChangedPatchMeasures=${serialMaxPatchMeasures} ` +
          `maxCoalescedPatchMeasures=${maxPatchMeasures} ` +
          `changedReferences=${maxChangedReferences}; command ${formatStats(warmedCommands)}; ` +
          `layout ${formatStats(warmedLayouts)}; total ${formatStats(warmedTotals)}; ` +
          `burst32 ${formatStats(burstStats)}`,
      );

      expect(fullCalls).toBe(0);
      expect(serialMaxPatchMeasures).toBe(1);
      expect(maxPatchMeasures).toBeLessThanOrEqual(BURST_SIZE);
      expect(maxChangedReferences).toBe(1);
      expect(insertedIds.length).toBeGreaterThanOrEqual(SERIAL_EDITS + BURST_COUNT * BURST_SIZE);
      expect(warmedCommands.p95).toBeLessThan(40 * BUDGET_MULTIPLIER);
      expect(warmedCommands.max).toBeLessThan(100 * BUDGET_MULTIPLIER);
      expect(warmedLayouts.p95).toBeLessThan(180 * BUDGET_MULTIPLIER);
      expect(warmedLayouts.max).toBeLessThan(1_500 * BUDGET_MULTIPLIER);
      expect(warmedTotals.p95).toBeLessThan(220 * BUDGET_MULTIPLIER);
      expect(warmedTotals.max).toBeLessThan(1_500 * BUDGET_MULTIPLIER);
    } finally {
      perf.fastLayoutCallback = null;
      unsubscribe();
      engine.free();
    }
  }, 180_000);
});

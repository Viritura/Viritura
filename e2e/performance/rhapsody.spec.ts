import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

interface LayoutMetrics {
  resolvedCells: number;
  resolvedFullCells: number;
  widthCells: number;
  widthFullCells: number;
  freshSystems: number;
  reusedSystems: number;
  staffContentReuses: number;
  staffContentReuseRuns: number;
  staffAuxReuses: number;
  systemMeasureReuses: number;
  spannerBoundsFull: number;
  spannerBounds: number;
  mmrPlanReused: boolean;
  horizonStaffExtentsReused: number;
  horizonTieMapsReused: number;
  frameBytes: number;
  patchFrame: boolean;
}

interface EditSample {
  key: string;
  trusted: boolean;
  inputToPaintMs: number;
  editToPaintMs: number;
  wasmLayoutMs: number;
  serializeMs: number;
  canvasPaintMs: number;
  workerRpcMs: number;
  patchReconstructMs: number;
  baseScorePaintMs: number;
  stickyDeriveMs: number;
  stickyPaintMs: number;
  postScorePaintMs: number;
  engineOverlaysMs: number;
  stickyTotalMs: number;
  commandProcessingMs: number;
  paintDispatchMs: number;
  canvasSizeMs: number;
  paintSetupMs: number;
  paintCallbackDispatchMs: number;
  paintArgsMs: number;
  optimisticPaintMs: number | null;
  metrics: LayoutMetrics | null;
}

const MEASURE_NAMES = [
  "viritura:edit-to-paint",
  "viritura:wasm-layout",
  "viritura:serialize",
  "viritura:canvas-paint",
  "viritura:worker-rpc",
  "viritura:patch-reconstruct",
  "viritura:base-score-paint",
  "viritura:sticky-derive",
  "viritura:sticky-paint",
  "viritura:post-score-paint",
  "viritura:engine-overlays",
  "viritura:sticky-total",
  "viritura:command-processing",
  "viritura:paint-dispatch",
  "viritura:canvas-size",
  "viritura:paint-setup",
  "viritura:paint-callback-dispatch",
  "viritura:paint-args",
  "viritura:optimistic-input-to-paint",
] as const;

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
}

function summarize(samples: EditSample[], key: keyof EditSample): Record<string, number> {
  const values = samples
    .map((sample) => sample[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    count: values.length,
    min: Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

async function resetEditMeasurements(page: Page): Promise<void> {
  await page.evaluate((measureNames) => {
    for (const name of measureNames) performance.clearMeasures(name);
    (
      window as typeof window & { __VIRITURA_PROOF_INPUT__?: { time: number; trusted: boolean } }
    ).__VIRITURA_PROOF_INPUT__ = undefined;
  }, MEASURE_NAMES);
}

async function readEditSample(page: Page, key: string): Promise<EditSample> {
  await page.waitForFunction(() => performance.getEntriesByName("viritura:edit-to-paint", "measure").length > 0);
  return page.evaluate(
    ({ key, measureNames }) => {
      const latest = (name: string): PerformanceEntry | null =>
        performance.getEntriesByName(name, "measure").at(-1) ?? null;
      const input = (
        window as typeof window & {
          __VIRITURA_PROOF_INPUT__?: { time: number; trusted: boolean };
          __VIRITURA_LAYOUT_METRICS__?: LayoutMetrics;
        }
      ).__VIRITURA_PROOF_INPUT__;
      const edit = latest("viritura:edit-to-paint");
      if (!input || !edit) throw new Error("Edit did not produce trusted input and authoritative-paint timing");
      const editEnd = edit.startTime + edit.duration;
      const withinEdit = (name: string): PerformanceEntry | null =>
        performance
          .getEntriesByName(name, "measure")
          .filter(
            (entry) => entry.startTime >= edit.startTime - 0.01 && entry.startTime + entry.duration <= editEnd + 0.01,
          )
          .at(-1) ?? null;
      const durations = Object.fromEntries(
        measureNames.map((name) => [
          name,
          name === "viritura:optimistic-input-to-paint" || name === "viritura:command-processing"
            ? (latest(name)?.duration ?? Number.NaN)
            : (withinEdit(name)?.duration ?? Number.NaN),
        ]),
      );
      return {
        key,
        trusted: input.trusted,
        inputToPaintMs: edit.startTime + edit.duration - input.time,
        editToPaintMs: durations["viritura:edit-to-paint"],
        wasmLayoutMs: durations["viritura:wasm-layout"],
        serializeMs: durations["viritura:serialize"],
        canvasPaintMs: durations["viritura:canvas-paint"],
        workerRpcMs: durations["viritura:worker-rpc"],
        patchReconstructMs: durations["viritura:patch-reconstruct"],
        baseScorePaintMs: durations["viritura:base-score-paint"],
        stickyDeriveMs: durations["viritura:sticky-derive"],
        stickyPaintMs: durations["viritura:sticky-paint"],
        postScorePaintMs: durations["viritura:post-score-paint"],
        engineOverlaysMs: durations["viritura:engine-overlays"],
        stickyTotalMs: durations["viritura:sticky-total"],
        commandProcessingMs: durations["viritura:command-processing"],
        paintDispatchMs: durations["viritura:paint-dispatch"],
        canvasSizeMs: durations["viritura:canvas-size"],
        paintSetupMs: durations["viritura:paint-setup"],
        paintCallbackDispatchMs: durations["viritura:paint-callback-dispatch"],
        paintArgsMs: durations["viritura:paint-args"],
        optimisticPaintMs: Number.isFinite(durations["viritura:optimistic-input-to-paint"])
          ? durations["viritura:optimistic-input-to-paint"]
          : null,
        metrics:
          (window as typeof window & { __VIRITURA_LAYOUT_METRICS__?: LayoutMetrics }).__VIRITURA_LAYOUT_METRICS__ ??
          null,
      };
    },
    { key, measureNames: MEASURE_NAMES },
  );
}

async function clearLayoutMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & { __VIRITURA_LAYOUT_METRICS__?: LayoutMetrics }).__VIRITURA_LAYOUT_METRICS__ = undefined;
  });
}

async function performEdit(page: Page, key: string): Promise<EditSample> {
  await resetEditMeasurements(page);
  await clearLayoutMetrics(page);
  await page.locator('canvas[tabindex="0"]').focus();
  await page.keyboard.press(key);
  return readEditSample(page, key);
}

async function performRadialEdit(page: Page, shortcut: string, itemLabel: string): Promise<EditSample> {
  await page.locator('canvas[tabindex="0"]').focus();
  await page.keyboard.press(shortcut);
  const filter = page.getByPlaceholder(/Filter/);
  await expect(filter).toBeVisible();
  await filter.fill(itemLabel);
  await resetEditMeasurements(page);
  await clearLayoutMetrics(page);
  await page.keyboard.press("Enter");
  return readEditSample(page, `${shortcut}:${itemLabel}`);
}

async function attachResults(testInfo: TestInfo, name: string, samples: EditSample[]): Promise<void> {
  const summary = {
    scenario: name,
    environment: "headed production Chrome",
    iterations: samples.length,
    inputToPaintMs: summarize(samples, "inputToPaintMs"),
    editToPaintMs: summarize(samples, "editToPaintMs"),
    wasmLayoutMs: summarize(samples, "wasmLayoutMs"),
    serializeMs: summarize(samples, "serializeMs"),
    canvasPaintMs: summarize(samples, "canvasPaintMs"),
    workerRpcMs: summarize(samples, "workerRpcMs"),
    patchReconstructMs: summarize(samples, "patchReconstructMs"),
    baseScorePaintMs: summarize(samples, "baseScorePaintMs"),
    stickyDeriveMs: summarize(samples, "stickyDeriveMs"),
    stickyPaintMs: summarize(samples, "stickyPaintMs"),
    postScorePaintMs: summarize(samples, "postScorePaintMs"),
    engineOverlaysMs: summarize(samples, "engineOverlaysMs"),
    stickyTotalMs: summarize(samples, "stickyTotalMs"),
    commandProcessingMs: summarize(samples, "commandProcessingMs"),
    paintDispatchMs: summarize(samples, "paintDispatchMs"),
    canvasSizeMs: summarize(samples, "canvasSizeMs"),
    paintSetupMs: summarize(samples, "paintSetupMs"),
    paintCallbackDispatchMs: summarize(samples, "paintCallbackDispatchMs"),
    paintArgsMs: summarize(samples, "paintArgsMs"),
    optimisticPaintMs: summarize(samples, "optimisticPaintMs"),
    samples,
  };
  await testInfo.attach(`${name}.json`, {
    body: Buffer.from(`${JSON.stringify(summary, null, 2)}\n`),
    contentType: "application/json",
  });
  console.log(
    `[headed-perf] ${name}: authoritative=${JSON.stringify(summary.inputToPaintMs)} command=${JSON.stringify(summary.commandProcessingMs)} prepare=${JSON.stringify(summary.serializeMs)} worker=${JSON.stringify(summary.workerRpcMs)} reconstruct=${JSON.stringify(summary.patchReconstructMs)} basePaint=${JSON.stringify(summary.baseScorePaintMs)} postPaint=${JSON.stringify(summary.postScorePaintMs)} canvas=${JSON.stringify(summary.canvasPaintMs)} optimistic=${JSON.stringify(summary.optimisticPaintMs)} metrics=${JSON.stringify(samples.at(-1)?.metrics ?? null)}`,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("viritura.startCenter.suppress", "1");
    window.addEventListener(
      "keydown",
      (event) => {
        (
          window as typeof window & { __VIRITURA_PROOF_INPUT__?: { time: number; trusted: boolean } }
        ).__VIRITURA_PROOF_INPUT__ = { time: performance.now(), trusted: event.isTrusted };
      },
      true,
    );
    window.addEventListener(
      "pointerdown",
      (event) => {
        (
          window as typeof window & { __VIRITURA_PROOF_INPUT__?: { time: number; trusted: boolean } }
        ).__VIRITURA_PROOF_INPUT__ = { time: performance.now(), trusted: event.isTrusted };
      },
      true,
    );
  });
  await page.goto("/?perf=1", { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  await page.waitForFunction(
    () => document.title.startsWith("Rhapsody in Blue") && !document.body.innerText.includes("Laying out score"),
    undefined,
    { timeout: 120_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  const canvas = page.locator('canvas[tabindex="0"]');
  await canvas.click({ position: { x: 520, y: 420 } });
  await expect(page.getByText(/Selected: event/)).toBeVisible();
});

test("Rhapsody trusted pitch edits use bounded incremental work", async ({ page }, testInfo) => {
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await performEdit(page, iteration % 2 === 0 ? "Control+ArrowUp" : "Control+ArrowDown");
  }
  const samples: EditSample[] = [];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    samples.push(await performEdit(page, iteration % 2 === 0 ? "Control+ArrowUp" : "Control+ArrowDown"));
  }
  expect(samples.every((sample) => sample.trusted)).toBe(true);
  expect(samples.every((sample) => sample.metrics?.patchFrame)).toBe(true);
  expect(samples.every((sample) => (sample.metrics?.resolvedCells ?? Infinity) <= 2)).toBe(true);
  expect(samples.every((sample) => (sample.metrics?.widthCells ?? Infinity) <= 2)).toBe(true);
  expect(samples.every((sample) => (sample.metrics?.freshSystems ?? Infinity) <= 1)).toBe(true);
  expect(samples.every((sample) => (sample.metrics?.staffContentReuses ?? 0) >= 30)).toBe(true);
  expect(
    samples.every((sample) => {
      const runs = sample.metrics?.staffContentReuseRuns ?? Infinity;
      return runs > 0 && runs <= 3;
    }),
  ).toBe(true);
  expect(samples.every((sample) => (sample.metrics?.staffAuxReuses ?? 0) > 0)).toBe(true);
  expect(samples.every((sample) => (sample.metrics?.systemMeasureReuses ?? 0) >= 30)).toBe(true);
  expect(
    samples.every((sample) => (sample.metrics?.spannerBounds ?? Infinity) < (sample.metrics?.spannerBoundsFull ?? 0)),
  ).toBe(true);
  expect(samples.every((sample) => sample.metrics?.mmrPlanReused)).toBe(true);
  expect(samples.every((sample) => (sample.metrics?.horizonStaffExtentsReused ?? 0) >= 30)).toBe(true);
  expect(samples.every((sample) => (sample.metrics?.horizonTieMapsReused ?? 0) >= 30)).toBe(true);
  await attachResults(testInfo, "rhapsody-pitch", samples);
  expect(
    percentile(
      samples.map((sample) => sample.inputToPaintMs),
      0.5,
    ),
  ).toBeLessThanOrEqual(16.6);
  expect(
    percentile(
      samples.map((sample) => sample.inputToPaintMs),
      0.95,
    ),
  ).toBeLessThanOrEqual(33);
  expect(
    percentile(
      samples.map((sample) => sample.optimisticPaintMs ?? Infinity),
      0.95,
    ),
  ).toBeLessThan(16.6);
  await page.locator('canvas[tabindex="0"]').screenshot({ path: testInfo.outputPath("rhapsody-pitch.png") });
});

test("Rhapsody trusted accidental edits use patch IR", async ({ page }, testInfo) => {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await performEdit(page, iteration % 2 === 0 ? "=" : "0");
  }
  const samples: EditSample[] = [];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    samples.push(await performEdit(page, iteration % 2 === 0 ? "=" : "0"));
  }
  expect(samples.every((sample) => sample.trusted)).toBe(true);
  expect(
    percentile(
      samples.map((sample) => sample.inputToPaintMs),
      0.5,
    ),
  ).toBeLessThan(50);
  expect(
    percentile(
      samples.map((sample) => sample.serializeMs),
      0.95,
    ),
  ).toBeLessThan(10);
  expect(
    percentile(
      samples.map((sample) => sample.optimisticPaintMs ?? Infinity),
      0.95,
    ),
  ).toBeLessThan(16.6);
  await attachResults(testInfo, "rhapsody-accidental", samples);
});

test("Rhapsody trusted articulation edits remain local", async ({ page }, testInfo) => {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await performRadialEdit(page, "Shift+A", iteration % 2 === 0 ? "Staccato" : "Tenuto");
  }
  const samples: EditSample[] = [];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    samples.push(await performRadialEdit(page, "Shift+A", iteration % 2 === 0 ? "Staccato" : "Tenuto"));
  }
  expect(samples.every((sample) => sample.trusted)).toBe(true);
  expect(samples.every((sample) => sample.metrics?.patchFrame)).toBe(true);
  expect(samples.every((sample) => (sample.metrics?.resolvedCells ?? Infinity) <= 2)).toBe(true);
  await attachResults(testInfo, "rhapsody-articulation", samples);
  expect(
    percentile(
      samples.map((sample) => sample.inputToPaintMs),
      0.5,
    ),
  ).toBeLessThanOrEqual(33);
});

test("Rhapsody trusted note insertion uses bounded reconciliation", async ({ page }, testInfo) => {
  const canvas = page.locator('canvas[tabindex="0"]');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Score canvas has no bounds");
  await page.keyboard.press("Escape");
  await canvas.click({ position: { x: 520, y: 420 } });
  await expect(page.getByText(/Selected: event/)).toBeVisible();
  await canvas.focus();
  await page.keyboard.press("N");
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await performEdit(page, "A");
  }
  const samples: EditSample[] = [];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    samples.push(await performEdit(page, "A"));
  }
  expect(samples.every((sample) => sample.trusted)).toBe(true);
  await attachResults(testInfo, "rhapsody-insertion", samples);
  expect(
    percentile(
      samples.map((sample) => sample.inputToPaintMs),
      0.5,
    ),
  ).toBeLessThan(50);
});

test("Rhapsody trusted slur edits remain responsive", async ({ page }, testInfo) => {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await performEdit(page, "S");
  }
  const samples: EditSample[] = [];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    samples.push(await performEdit(page, "S"));
  }
  expect(samples.every((sample) => sample.trusted)).toBe(true);
  expect(samples.every((sample) => sample.metrics?.patchFrame)).toBe(true);
  await attachResults(testInfo, "rhapsody-slur", samples);
  expect(
    percentile(
      samples.map((sample) => sample.inputToPaintMs),
      0.5,
    ),
  ).toBeLessThan(300);
});

test("Rhapsody trusted global meter edits settle asynchronously", async ({ page }, testInfo) => {
  for (let iteration = 0; iteration < 2; iteration += 1) {
    await performRadialEdit(page, "Shift+M", iteration % 2 === 0 ? "12/8" : "9/8");
  }
  const samples: EditSample[] = [];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    samples.push(await performRadialEdit(page, "Shift+M", iteration % 2 === 0 ? "12/8" : "9/8"));
  }
  expect(samples.every((sample) => sample.trusted)).toBe(true);
  expect(samples.every((sample) => Number.isFinite(sample.inputToPaintMs))).toBe(true);
  await attachResults(testInfo, "rhapsody-global-meter", samples);
});

test("representative Rhapsody edit emits a Chrome DevTools trace", async ({ page, context }, testInfo) => {
  const cdp = await context.newCDPSession(page);
  const completed = new Promise<{ stream: string }>((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,blink.user_timing,v8,renderer.scheduler,loading",
    transferMode: "ReturnAsStream",
  });
  const sample = await performEdit(page, "Control+ArrowUp");
  await cdp.send("Tracing.end");
  const { stream } = await completed;
  const chunks: Buffer[] = [];
  for (;;) {
    const chunk = await cdp.send("IO.read", { handle: stream, size: 1_048_576 });
    chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, "base64") : Buffer.from(chunk.data));
    if (chunk.eof) break;
  }
  await cdp.send("IO.close", { handle: stream });
  const tracePath = testInfo.outputPath("representative-edit-trace.json");
  await writeFile(tracePath, Buffer.concat(chunks));
  expect(sample.trusted).toBe(true);
  expect(Buffer.concat(chunks).byteLength).toBeGreaterThan(10_000);
});

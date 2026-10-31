/**
 * A third-party app using the packed tarballs exactly as documented: engine
 * assets copied to `/score-engine/` and passed as `assetBaseUrl`. Reports
 * one result per layer on `window.__scorePackages` for the verifier.
 */

import { loadEngine, type Engine } from "@viritura/score-engine";
import { mountScore } from "@viritura/score-viewer";
import { ScoreViewer } from "@viritura/score-viewer-react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

type Check = "engine" | "worker" | "viewer" | "react" | "mnx46";
type Results = Partial<Record<Check, string>> & { done?: boolean };

declare global {
  interface Window {
    __scorePackages: Results;
  }
}

const results: Results = {};
window.__scorePackages = results;
const assetBaseUrl = new URL("/score-engine/", location.href).href;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

function inkPixels(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) count++;
  return count;
}

async function checkEngine(engine: Engine, mnx: string): Promise<void> {
  const canvas = element<HTMLCanvasElement>("engine");
  const displayList = engine.layout(mnx, { pageWidth: 800 });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  engine.paint(ctx, displayList, { page: 0 });
  const ink = inkPixels(canvas);
  if (ink === 0) throw new Error("engine.paint drew no ink");
  results.engine = `ok: ${displayList.pageCount} page(s), ${ink} ink pixels`;

  const worker = engine.createLayoutWorker();
  try {
    const fromWorker = await worker.layout(mnx, { pageWidth: 800 });
    if (fromWorker.pageCount !== displayList.pageCount) throw new Error("worker layout disagrees with main thread");
    results.worker = "ok";
  } finally {
    worker.dispose();
  }
}

function checkViewer(mnx: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mountScore(element("viewer"), mnx, {
      assetBaseUrl,
      onReady: ({ displayList }) => {
        results.viewer = `ok: ${displayList.pageCount} page(s)`;
        resolve();
      },
      onError: reject,
    });
  });
}

function checkReact(mnx: string): Promise<void> {
  return new Promise((resolve, reject) => {
    createRoot(element("react")).render(
      createElement(ScoreViewer, {
        mnx,
        assetBaseUrl,
        onReady: ({ displayList }) => {
          results.react = `ok: ${displayList.pageCount} page(s)`;
          resolve();
        },
        onError: reject,
      }),
    );
  });
}

async function run(check: Check, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    results[check] = `failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function checkNavigationTimeline(engine: Engine): void {
  const note = { duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] };
  const part = {
    id: "voice",
    measures: Array.from({ length: 3 }, () => ({ sequences: [{ content: [note] }] })),
  };
  const timeline = engine.timeline({
    mnx: { version: 1 },
    global: {
      measures: [
        { time: { count: 4, unit: 4 }, fine: { location: { fraction: [1, 1] } } },
        { tempos: [{ bpm: 60, value: { base: "quarter" } }] },
        { jump: { type: "dcAlFine", location: { fraction: [1, 1] } } },
      ],
    },
    parts: [part],
  });
  if (timeline.totalBeats !== 16 || Math.abs(timeline.totalSeconds - 12) > 1e-6) {
    throw new Error("Packed navigation playback does not restore the implicit initial tempo");
  }
  const internalTempos = engine.timeline({
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [
            { bpm: 120, value: { base: "quarter" } },
            { bpm: 60, value: { base: "quarter" }, location: { fraction: [1, 2] } },
          ],
          fine: { location: { fraction: [1, 1] } },
        },
        { jump: { type: "dcAlFine", location: { fraction: [1, 1] } } },
      ],
    },
    parts: [{ ...part, measures: part.measures.slice(0, 2) }],
  });
  for (const timeSeconds of [1, 8]) {
    if (
      !internalTempos.tempoMap.some((tempo) => tempo.bpm === 60 && Math.abs(tempo.timeSeconds - timeSeconds) < 1e-6)
    ) {
      throw new Error(`Packed timeline loses the intra-measure tempo change at ${timeSeconds}s`);
    }
  }
}

async function main(): Promise<void> {
  const mnx = await (await fetch("/score.mnx")).text();
  const integration = await (await fetch("/mnx46.mnx")).text();
  await run("engine", async () => {
    const engine = await loadEngine({ assetBaseUrl });
    await checkEngine(engine, mnx);
    await checkEngine(engine, integration);
  });
  await run("viewer", () => checkViewer(integration));
  await run("react", () => checkReact(integration));
  await run("mnx46", async () => {
    const engine = await loadEngine({ assetBaseUrl });
    checkNavigationTimeline(engine);
    const svg = await engine.toSvg(engine.layout(integration, { pageWidth: 800 }));
    if (!svg.includes("<svg") || !svg.includes("<path")) throw new Error("Integrated v46 SVG export has no ink");
    results.mnx46 = "ok: native features, navigation tempo restoration, tempo automation and SVG export";
  });
  results.done = true;
}

void main();

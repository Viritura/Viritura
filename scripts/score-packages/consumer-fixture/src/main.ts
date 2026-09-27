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

type Check = "engine" | "worker" | "viewer" | "react";
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

async function main(): Promise<void> {
  const mnx = await (await fetch("/score.mnx")).text();
  await run("engine", async () => checkEngine(await loadEngine({ assetBaseUrl }), mnx));
  await run("viewer", () => checkViewer(mnx));
  await run("react", () => checkReact(mnx));
  results.done = true;
}

void main();

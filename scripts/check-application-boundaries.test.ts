import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { findApplicationBoundaryViolations } from "./check-application-boundaries";

test("rejects deployable Vite, Tauri, and VS Code extension manifests beneath packages", () => {
  const root = mkdtempSync(resolve(tmpdir(), "viritura-boundaries-"));
  try {
    const viteRoot = resolve(root, "packages/vite-app");
    mkdirSync(viteRoot, { recursive: true });
    writeFileSync(resolve(viteRoot, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
    writeFileSync(resolve(viteRoot, "index.html"), "");

    const tauriRoot = resolve(root, "packages/native/src-tauri");
    mkdirSync(tauriRoot, { recursive: true });
    writeFileSync(resolve(tauriRoot, "tauri.conf.json"), "{}");

    const extensionRoot = resolve(root, "packages/extension");
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(resolve(extensionRoot, "package.json"), JSON.stringify({ engines: { vscode: "^1.120.0" } }));

    assert.equal(findApplicationBoundaryViolations(root).length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows the explicitly documented reusable UI Storybook", () => {
  const root = mkdtempSync(resolve(tmpdir(), "viritura-boundaries-"));
  try {
    const uiRoot = resolve(root, "packages/ui");
    mkdirSync(uiRoot, { recursive: true });
    writeFileSync(resolve(uiRoot, "package.json"), JSON.stringify({ scripts: { storybook: "storybook dev" } }));
    assert.deepEqual(findApplicationBoundaryViolations(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

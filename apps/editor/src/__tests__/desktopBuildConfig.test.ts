// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plugin, UserConfigFnObject } from "vite";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  rmSync: vi.fn(),
}));
vi.mock("../../buildAssets.ts", () => ({
  syncSharedAssets: vi.fn(),
  syncSounds: vi.fn(),
  syncMusxImporter: vi.fn(),
  syncMnxSchema: vi.fn(),
  syncMnxFixtures: vi.fn(),
}));

const root = resolve(__dirname, "../../../..");

function readJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(resolve(root, ...segments), "utf8")) as T;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.resetModules();
});

describe("desktop frontend build orchestration", () => {
  it("uses the same non-recursive preparation for root and self-contained Tauri builds", () => {
    const rootPackage = readJson<{ scripts: Record<string, string> }>("package.json");
    const desktop = readJson<{ scripts: Record<string, string> }>("apps", "desktop", "package.json");
    const tauri = readJson<{ build: { beforeBuildCommand: string; frontendDist: string } }>(
      "apps",
      "desktop",
      "src-tauri",
      "tauri.conf.json",
    );
    const prebuilt = readJson<{ build: { beforeBuildCommand: string } }>(
      "apps",
      "desktop",
      "src-tauri",
      "tauri.prebuilt.conf.json",
    );

    expect(rootPackage.scripts["build:desktop"]).toBe(
      "pnpm build:desktop:frontend && pnpm --filter @viritura/desktop build:prebuilt",
    );
    expect(rootPackage.scripts["build:desktop:frontend"]).toBe("tsx scripts/build-desktop-frontend.ts");
    expect(desktop.scripts.build).toBe("tauri build");
    expect(tauri.build.beforeBuildCommand).toBe("pnpm -w run build:desktop:frontend");
    expect(tauri.build.frontendDist).toBe("../../editor/dist");
    expect(desktop.scripts["build:prebuilt"]).toBe("tauri build --config src-tauri/tauri.prebuilt.conf.json");
    expect(prebuilt.build.beforeBuildCommand).toBe("");
    expect(rootPackage.scripts.build).toBe("turbo run build --filter=!@viritura/desktop");
  });

  it.each([undefined, "false", "true"])("externalizes before Turbo hashes the child env (%s)", async (value) => {
    vi.stubEnv("npm_execpath", "pnpm.cjs");
    vi.stubEnv("VIRITURA_EXTERNAL_SOUNDFONT", value);
    vi.stubEnv("VITE_VIRITURA_API_BASE_URL", undefined);
    vi.stubEnv("VITE_VIRITURA_ASSET_BASE_URL", undefined);
    await import("../../../../scripts/build-desktop-frontend.ts");

    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0].slice(0, 2)).toEqual([process.execPath, ["pnpm.cjs", "build:wasm"]]);
    expect(calls[1].slice(0, 2)).toEqual([
      process.execPath,
      ["pnpm.cjs", "turbo", "run", "build", "--filter=@viritura/editor"],
    ]);
    for (const call of calls) {
      expect(call[2]).toEqual({
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, VIRITURA_EXTERNAL_SOUNDFONT: "true" },
      });
    }
    expect(process.env.VIRITURA_EXTERNAL_SOUNDFONT).toBe(value);
    expect(rmSync).toHaveBeenCalledExactlyOnceWith(
      resolve(root, "apps", "editor", "dist", "sounds", "Shan-SGM-Pro-15.sf2"),
      { force: true },
    );
    expect(vi.mocked(rmSync).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(execFileSync).mock.invocationCallOrder[1]!,
    );
    const turbo = readJson<{ tasks: Record<string, { env: string[] }> }>("turbo.json");
    expect(turbo.tasks["@viritura/editor#build"].env).toContain("VIRITURA_EXTERNAL_SOUNDFONT");
  });

  it("stops before building the editor when WASM preparation fails", async () => {
    vi.stubEnv("npm_execpath", "pnpm.cjs");
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error("WASM failed");
    });
    await expect(import("../../../../scripts/build-desktop-frontend.ts")).rejects.toThrow("WASM failed");
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it("keeps hosted environment overrides out of desktop CI", () => {
    const workflow = readFileSync(resolve(root, ".github", "workflows", "desktop-preview.yml"), "utf8");
    expect(workflow).not.toMatch(/VITE_VIRITURA_(?:API|ASSET)_BASE_URL|VIRITURA_EXTERNAL_SOUNDFONT/);
    expect(workflow).toContain("pnpm build:desktop");
    const tauri = readJson<{ bundle: { resources: Record<string, string> } }>(
      "apps",
      "desktop",
      "src-tauri",
      "tauri.conf.json",
    );
    expect(Object.values(tauri.bundle.resources).filter((name) => name.endsWith(".sf2"))).toEqual([
      "sounds/Shan-SGM-Pro-15.sf2",
    ]);
  });
});

describe("editor soundfont output", () => {
  it.each([
    [undefined, false],
    ["false", false],
    ["true", true],
  ])("only removes the duplicate SF2 when externalization is enabled (%s)", async (value, removed) => {
    vi.stubEnv("VIRITURA_EXTERNAL_SOUNDFONT", value);
    const { default: defineConfig } = await import("../../vite.config.ts");
    const config = (defineConfig as UserConfigFnObject)({ command: "build", mode: "production" });
    const plugin = (config.plugins as Plugin[]).find((entry) => entry.name === "viritura-externalize-large-soundfont");
    expect(plugin).toBeDefined();
    (plugin?.closeBundle as () => void)();

    if (removed) {
      expect(rmSync).toHaveBeenCalledExactlyOnceWith(
        resolve(root, "apps", "editor", "dist", "sounds", "Shan-SGM-Pro-15.sf2"),
        { force: true },
      );
    } else {
      expect(rmSync).not.toHaveBeenCalled();
    }
  });
});

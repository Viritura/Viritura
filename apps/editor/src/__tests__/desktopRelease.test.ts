// @vitest-environment node
import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../../../..");
const workflow = readFileSync(path.join(root, ".github", "workflows", "desktop-release.yml"), "utf8");
const publishJob = workflow.split(/^ {2}publish:\s*$/m)[1]?.split(/^ {2}\w+:\s*$/m)[0] ?? "";
const literal = publishJob.match(/^( *)script: \|\r?\n/m);
if (!literal) throw new Error("Missing trusted publish github-script literal");
const indent = literal[1].length + 2;
const body = publishJob.slice(literal.index! + literal[0].length).split(/\r?\n/);
const end = body.findIndex((line) => line.trim() && !line.startsWith(" ".repeat(indent)));
const source = body
  .slice(0, end === -1 ? undefined : end)
  .map((line) => line.slice(indent))
  .join("\n");
if (!source.trim()) throw new Error("Empty trusted publish github-script literal");
const script = new Script(`(async () => {\n${source}\n})()`, { filename: "desktop-release.github-script.js" });
const exe = "Viritura-windows-x64.exe";
const msi = "Viritura-windows-x64.msi";
const names = [exe, msi];
const sha = "a".repeat(40);

interface Asset {
  id: number;
  name: string;
  state: string;
  size: number;
  digest?: string | null;
}

interface LocalFile {
  data: Buffer;
  size: number;
  regular: boolean;
  symlink: boolean;
}

interface Release {
  id: number;
  tag_name: string;
  draft: boolean;
  immutable: boolean;
  html_url: string;
}

interface RepoParams {
  owner: string;
  repo: string;
  request: { timeout: number };
}

interface ReleaseParams extends RepoParams {
  release_id: number;
}

interface UploadParams {
  name: string;
  filename: string;
}

interface ProcessOutcome {
  failure?: "spawn" | "process" | "timeout" | "exit" | "stream";
  chunks?: Buffer[];
}

interface UploadOutcome extends ProcessOutcome {
  error?: unknown;
  appeared?: Partial<Asset> | "matching" | "starter";
  response?: unknown;
  status?: number;
  headers?: string[];
}

const request = { timeout: 15000 };
const secret = "test-token-not-for-logs";
const processSecret = `Bearer ${secret} ghp_hidden_secret`;

function installer(name: string): LocalFile {
  const data = Buffer.alloc(512);
  if (name === exe) {
    data.write("MZ");
    data.writeUInt32LE(128, 60);
    data.writeUInt32LE(0x00004550, 128);
  } else {
    Buffer.from("d0cf11e0a1b11ae1", "hex").copy(data);
  }
  return { data, size: data.length, regular: true, symlink: false };
}

function httpError(status: unknown): Error & { status: unknown } {
  return Object.assign(new Error(`HTTP ${String(status)}`), { status });
}

function harness(initial: Asset[] = []) {
  const files = new Map(names.map((name) => [name, installer(name)]));
  const state = {
    assets: [...initial],
    entries: [...names],
    release: {
      id: 42,
      tag_name: "v1.2.3",
      draft: false,
      immutable: false,
      html_url: "https://example.invalid/release",
    } as Release,
    commit: sha,
    nextId: 100,
    outcomes: new Map<string, UploadOutcome[]>(),
    downloads: new Map<number, ProcessOutcome[]>(),
    operations: [] as string[],
    onOperation: (_operation: string) => {},
    listView: (assets: Asset[]) => assets,
  };
  const context = {
    repo: { owner: "owner", repo: "viritura" },
    sha,
    eventName: "release",
    payload: {
      action: "published",
      release: { id: 42, tag_name: "v1.2.3" } as { id: unknown; tag_name: unknown } | undefined,
    },
  };
  function operation(name: string) {
    state.operations.push(name);
    state.onOperation(name);
  }
  function matching(name: string, id = state.nextId++): Asset {
    const file = files.get(name)!;
    return {
      id,
      name,
      state: "uploaded",
      size: file.data.length,
      digest: `sha256:${crypto.createHash("sha256").update(file.data).digest("hex")}`,
    };
  }
  const fs = {
    readdir: vi.fn(async (directory: string) => {
      expect(directory).toBe(path.join(root, "desktop-installers"));
      return state.entries;
    }),
    lstat: vi.fn(async (filename: string) => {
      const file = files.get(path.basename(filename))!;
      return { size: file.size, isFile: () => file.regular, isSymbolicLink: () => file.symlink };
    }),
    readFile: vi.fn(async (filename: string) => files.get(path.basename(filename))!.data),
  };
  const repos = {
    getRelease: vi.fn(async (params: ReleaseParams) => {
      expect(params).toEqual({ ...context.repo, release_id: 42, request });
      operation("release");
      return { data: { ...state.release } };
    }),
    getCommit: vi.fn(async (params: RepoParams & { ref: string }) => {
      expect(params).toEqual({ ...context.repo, ref: "refs/tags/v1.2.3", request });
      operation("commit");
      return { data: { sha: state.commit } };
    }),
    listReleaseAssets: vi.fn(() => {
      throw new Error("Assets must use pagination");
    }),
    getReleaseAsset: vi.fn(async (params: RepoParams & { asset_id: number }) => {
      expect(params).toEqual({ ...context.repo, asset_id: params.asset_id, request });
      operation(`get:${params.asset_id}`);
      const asset = state.assets.find((entry) => entry.id === params.asset_id);
      if (!asset) throw httpError(404);
      return { data: { ...asset } };
    }),
    deleteReleaseAsset: vi.fn(async (params: RepoParams & { asset_id: number }) => {
      expect(params).toEqual({ ...context.repo, asset_id: params.asset_id, request });
      operation(`delete:${params.asset_id}`);
      state.assets = state.assets.filter((asset) => asset.id !== params.asset_id);
      return { status: 204 };
    }),
  };
  // Records the file request from gh argv, not an Octokit upload or HTTP transport.
  const uploadRequests = vi.fn((params: UploadParams) => {
    operation(`upload:${params.name}`);
    const outcome = state.outcomes.get(params.name)?.shift() ?? {};
    let asset: Asset | undefined;
    if ((!outcome.error && !outcome.failure) || outcome.appeared) {
      asset = matching(params.name);
      if (outcome?.appeared === "starter") Object.assign(asset, { state: "starter", size: 0, digest: null });
      else if (typeof outcome?.appeared === "object") Object.assign(asset, outcome.appeared);
      state.assets.push(asset);
    }
    return { outcome, asset };
  });
  const paginate = vi.fn(async (method: unknown, params: ReleaseParams & { per_page: number }) => {
    expect(method).toBe(repos.listReleaseAssets);
    expect(params).toEqual({ ...context.repo, release_id: 42, per_page: 100, request });
    operation("list");
    return state.listView(state.assets).map((asset) => ({ ...asset }));
  });
  const timer = vi.fn((callback: () => void, delay: number) => {
    operation(`sleep:${delay}`);
    queueMicrotask(callback);
  });
  let nextTimer = 0;
  const deadlines = new Map<number, () => void>();
  const processTimer = vi.fn((callback: () => void, delay: number) => {
    expect([60000, 90000]).toContain(delay);
    const id = ++nextTimer;
    deadlines.set(id, callback);
    return id;
  });
  const clearTimer = vi.fn((id: number) => deadlines.delete(id));
  const children: (EventEmitter & { stdout: PassThrough; kill: ReturnType<typeof vi.fn> })[] = [];
  const spawn = vi.fn((command: string, args: string[], options: unknown) => {
    expect(command).toBe("gh");
    expect(options).toEqual({
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        GITHUB_WORKSPACE: root,
        GH_TOKEN: secret,
        GITHUB_TOKEN: "second-secret",
        GH_HOST: "github.com",
        GH_DEBUG: "",
        GH_PROMPT_DISABLED: "1",
      },
    });
    const isUpload = args[2] === "POST";
    let outcome: ProcessOutcome;
    let chunks: Buffer[];
    let exitCode = 0;
    if (isUpload) {
      const name = args[5].slice("name=".length);
      const filename = path.join(root, "desktop-installers", name);
      expect(args).toEqual([
        "api",
        "--method",
        "POST",
        "https://uploads.github.com/repos/owner/viritura/releases/42/assets",
        "--raw-field",
        `name=${name}`,
        "--input",
        filename,
        "--header",
        "Content-Type:application/octet-stream",
        "--include",
      ]);
      const upload = uploadRequests({ name, filename });
      outcome = upload.outcome;
      const error = upload.outcome.error as { status?: unknown; message?: string } | undefined;
      const status = upload.outcome.status ?? (error ? error.status : 201);
      exitCode = error ? 1 : 0;
      const response = upload.outcome.response ?? (error ? { message: error.message } : upload.asset);
      const headers = upload.outcome.headers ?? ["Content-Type: application/json"];
      const text = Number.isInteger(status)
        ? `HTTP/2.0 ${String(status)} Response\r\n${headers.join("\r\n")}\r\n\r\n${JSON.stringify(response)}`
        : "";
      const bytes = Buffer.from(text);
      chunks = outcome.chunks ?? [bytes.subarray(0, 17), bytes.subarray(17, 83), bytes.subarray(83)];
    } else {
      const id = Number(args[3].split("/").at(-1));
      const asset = state.assets.find((entry) => entry.id === id)!;
      expect(args).toEqual([
        "api",
        "--method",
        "GET",
        `repos/owner/viritura/releases/assets/${id}`,
        "--header",
        "Accept:application/octet-stream",
      ]);
      operation(`download:${id}`);
      outcome = state.downloads.get(id)?.shift() ?? {};
      const bytes = files.get(asset.name)!.data;
      chunks = outcome.chunks ?? [bytes.subarray(0, 3), bytes.subarray(3, 127), bytes.subarray(127)];
    }
    if (outcome.failure === "spawn") throw new Error(processSecret);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit("close", null));
        return true;
      }),
    });
    children.push(child);
    queueMicrotask(() => {
      if (outcome.failure === "timeout") {
        expect(deadlines.size).toBe(1);
        [...deadlines.values()][0]();
      } else if (outcome.failure === "process") {
        child.emit("error", new Error(processSecret));
        child.emit("close", 1);
      } else {
        child.stdout.once("end", () => child.emit("close", outcome.failure === "exit" ? 1 : exitCode));
        const emitChunk = (index: number) => {
          if (index === chunks.length) {
            if (outcome.failure === "stream") child.stdout.emit("error", new Error(processSecret));
            else child.stdout.end();
            return;
          }
          child.stdout.write(chunks[index]);
          queueMicrotask(() => emitChunk(index + 1));
        };
        emitChunk(0);
      }
    });
    return child;
  });
  const core = { notice: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const requireMock = vi.fn((name: string): unknown => {
    switch (name) {
      case "node:fs/promises":
        return fs;
      case "node:path":
        return path;
      case "node:crypto":
        return crypto;
      case "node:child_process":
        return { spawn };
      default:
        throw new Error(`Unexpected require: ${name}`);
    }
  });
  const run = () =>
    script.runInNewContext({
      require: requireMock,
      context,
      github: { rest: { repos }, paginate },
      core,
      process: {
        env: {
          GITHUB_WORKSPACE: root,
          GH_TOKEN: secret,
          GITHUB_TOKEN: "second-secret",
          GH_HOST: "untrusted.invalid",
          GH_DEBUG: "api",
        },
      },
      Buffer,
      setTimeout: (callback: () => void, delay: number) =>
        delay >= 60000 ? processTimer(callback, delay) : timer(callback, delay),
      clearTimeout: clearTimer,
    }) as Promise<unknown>;
  return {
    state,
    context,
    files,
    fs,
    repos,
    uploadRequests,
    paginate,
    timer,
    processTimer,
    clearTimer,
    deadlines,
    children,
    spawn,
    core,
    run,
    matching,
  };
}

type Harness = ReturnType<typeof harness>;

function expectUntouched(h: Harness) {
  expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  expect(h.uploadRequests).not.toHaveBeenCalled();
  expect(h.core.notice).not.toHaveBeenCalled();
}

function attempts(h: Harness, name: string) {
  return h.uploadRequests.mock.calls.filter(([params]) => params.name === name).length;
}

function stale(name: string, id = 1): Asset {
  return { id, name, state: "uploaded", size: 100, digest: `sha256:${"b".repeat(64)}` };
}

describe("desktop release trusted write job", () => {
  it("disables implicit retries and never checks out or executes build code", () => {
    expect(publishJob).toMatch(/contents: write/);
    expect(publishJob).toMatch(/^\s+retries: 0\s*$/m);
    expect(publishJob).not.toMatch(/actions\/checkout|^\s+run:|pnpm |cargo |npm /m);
    expect(publishJob).toContain("needs.build.outputs.artifact-id");
    expect(publishJob).toContain("actions/github-script@");
    expect(source).not.toContain("${{");
  });
});

describe("desktop release asset publication", () => {
  it("recovers the observed nonzero MSI starter after an ambiguous 5xx without touching the EXE", async () => {
    const h = harness();
    const correct = h.matching(exe, 571215004);
    h.state.assets = [correct];
    h.state.outcomes.set(msi, [
      {
        error: httpError(502),
        headers: ["X-GitHub-Request-Id: ORIGINAL:123", "Content-Length: 89"],
        appeared: { id: 571215087, name: msi, state: "starter", size: 120774656, digest: null },
      },
    ]);
    await h.run();
    expect(attempts(h, exe)).toBe(0);
    expect(attempts(h, msi)).toBe(2);
    expect(h.repos.deleteReleaseAsset).toHaveBeenCalledExactlyOnceWith({
      owner: "owner",
      repo: "viritura",
      asset_id: 571215087,
      request,
    });
    expect(h.state.assets).toContainEqual(correct);
    expect(h.core.warning).toHaveBeenCalledExactlyOnceWith(
      `Upload ${msi}: status=502; transport=exit; x-github-request-id=ORIGINAL:123; content-length=89; message=HTTP 502`,
    );
    const observation = `Observed release asset (list): ${JSON.stringify({
      id: 571215087,
      name: msi,
      state: "starter",
      size: 120774656,
      digest: null,
    })}`;
    const observedAt = h.core.info.mock.calls.findIndex(([message]) => message === observation);
    expect(observedAt).toBeGreaterThanOrEqual(0);
    expect(h.core.warning.mock.invocationCallOrder[0]).toBeLessThan(h.core.info.mock.invocationCallOrder[observedAt]);
    expect(h.core.info.mock.invocationCallOrder[observedAt]).toBeLessThan(
      h.repos.deleteReleaseAsset.mock.invocationCallOrder[0],
    );
  });

  it("uploads validated PE/MSI filenames through gh and verifies SHA-256 metadata", async () => {
    const unrelated = stale("notes.txt", 9);
    const h = harness([unrelated]);
    await h.run();
    expect(h.uploadRequests).toHaveBeenCalledTimes(2);
    for (const [params] of h.uploadRequests.mock.calls) {
      expect(params.filename).toBe(path.join(root, "desktop-installers", params.name));
      expect(h.state.assets.find((asset) => asset.name === params.name)).toEqual(
        expect.objectContaining(
          h.matching(params.name, h.state.assets.find((asset) => asset.name === params.name)!.id),
        ),
      );
    }
    expect(h.state.assets).toContainEqual(unrelated);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.paginate.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.core.notice).toHaveBeenCalledOnce();
    expect(h.processTimer.mock.calls.map(([, delay]) => delay)).toEqual([90000, 90000]);
    expect(h.deadlines.size).toBe(0);
    expect(h.children.every((child) => child.kill.mock.calls.length === 0)).toBe(true);
  });

  it("preserves both already correct installers without mutation", async () => {
    const h = harness();
    const assets = names.map((name) => h.matching(name));
    h.state.assets = [...assets];
    await h.run();
    expect(h.uploadRequests).not.toHaveBeenCalled();
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.state.assets).toEqual(assets);
    expect(h.paginate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it.each([false, true])("preserves the correct EXE when MSI fails (retry=%s)", async (retry) => {
    const h = harness();
    const correct = h.matching(exe);
    h.state.assets = [correct];
    h.state.outcomes.set(
      msi,
      retry ? [{ error: httpError(502), appeared: "starter" }, { error: httpError(403) }] : [{ error: httpError(403) }],
    );
    await expect(h.run()).rejects.toThrow();
    expect(attempts(h, exe)).toBe(0);
    expect(attempts(h, msi)).toBe(retry ? 2 : 1);
    expect(h.state.assets).toContainEqual(correct);
    expect(h.repos.deleteReleaseAsset.mock.calls.every(([params]) => params.asset_id !== correct.id)).toBe(true);
    expect(h.core.notice).not.toHaveBeenCalled();
  });

  it("preserves stale uploaded assets and unrelated assets without trying an upload", async () => {
    const h = harness([stale(exe, 1), stale(msi, 2), stale("notes.txt", 3)]);
    h.state.outcomes.set(exe, [{ error: httpError(403) }]);
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
    expect(h.state.assets).toEqual([stale(exe, 1), stale(msi, 2), stale("notes.txt", 3)]);
  });

  it("preflights the MSI before uploading a missing EXE and preserves wrong uploaded data", async () => {
    const h = harness([stale(msi, 2)]);
    await expect(h.run()).rejects.toThrow("Unexpected release asset data");
    expectUntouched(h);
    expect(h.state.assets).toEqual([stale(msi, 2)]);
  });

  it("gives each installer its own three-attempt budget", async () => {
    const h = harness();
    for (const name of names) h.state.outcomes.set(name, [{ error: httpError(500) }, { error: httpError(599) }]);
    await h.run();
    expect(attempts(h, exe)).toBe(3);
    expect(attempts(h, msi)).toBe(3);
    const perInstaller = [1000, 2000, 4000, 1000, 1000, 2000, 4000, 2000];
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([...perInstaller, ...perInstaller]);
  });

  it("exhausts three 5xx attempts with 1s/2s backoff and leaves the last starter untouched", async () => {
    const h = harness();
    h.state.outcomes.set(
      exe,
      Array.from({ length: 3 }, () => ({ error: httpError(503), appeared: "starter" as const })),
    );
    await expect(h.run()).rejects.toThrow();
    expect(attempts(h, exe)).toBe(3);
    expect(attempts(h, msi)).toBe(0);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([
      1000, 2000, 4000, 1000, 1000, 2000, 4000, 1000, 2000, 4000, 2000, 1000, 2000, 4000, 1000, 2000, 4000,
    ]);
    expect(h.repos.deleteReleaseAsset).toHaveBeenCalledTimes(2);
    expect(h.state.assets).toEqual([expect.objectContaining({ state: "starter", size: 0, digest: null })]);
    const lastUpload = h.state.operations.lastIndexOf(`upload:${exe}`);
    expect(h.state.operations.slice(lastUpload + 1)).toEqual([
      "release",
      "commit",
      "list",
      "sleep:1000",
      "release",
      "commit",
      "list",
      "sleep:2000",
      "release",
      "commit",
      "list",
      "sleep:4000",
      "release",
      "commit",
      "list",
    ]);
    expect(h.core.notice).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 409, 410, 429, 499, 600, 304])(
    "does not retry status %s, even if an upload appeared completed",
    async (status) => {
      const h = harness();
      h.state.outcomes.set(exe, [{ error: httpError(status), appeared: "matching" }]);
      await expect(h.run()).rejects.toThrow();
      expect(attempts(h, exe)).toBe(1);
      expect(h.timer).not.toHaveBeenCalled();
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
      expect(h.core.notice).not.toHaveBeenCalled();
    },
  );

  it("reconciles network errors without an HTTP status before retrying", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: new Error("ECONNRESET") }]);
    await h.run();
    expect(attempts(h, exe)).toBe(2);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 4000, 1000]);
    expect(h.core.warning).toHaveBeenCalledWith(expect.stringContaining("status=unknown; transport=exit"));
  });

  it.each([1, 2, 3])("accepts an ambiguous 5xx completed on attempt %s", async (attempt) => {
    const h = harness();
    h.state.outcomes.set(
      exe,
      Array.from({ length: attempt }, (_, index) => ({
        error: httpError(502),
        appeared: index === attempt - 1 ? "matching" : "starter",
      })),
    );
    await h.run();
    expect(attempts(h, exe)).toBe(attempt);
    expect(attempts(h, msi)).toBe(1);
    const pollsAndBackoff = [1000, 2000, 4000, 1000, 1000, 2000, 4000, 1000, 2000, 4000, 2000, 1000, 2000, 4000];
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual(pollsAndBackoff.slice(0, 7 * (attempt - 1)));
    expect(h.repos.deleteReleaseAsset).toHaveBeenCalledTimes(attempt - 1);
  });

  it("re-reads a settled starter by ID immediately before an actual delete and retry", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(500), appeared: "starter" }]);
    await h.run();
    expect(h.state.operations.filter((op) => /^(upload|delete):/.test(op))).toEqual([
      `upload:${exe}`,
      "delete:100",
      `upload:${exe}`,
      `upload:${msi}`,
    ]);
    const deletion = h.state.operations.indexOf("delete:100");
    expect(h.state.operations.slice(deletion - 4, deletion)).toEqual(["list", "release", "commit", "get:100"]);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 4000, 1000, 1000, 2000, 4000]);
  });

  it.each([null, undefined])("allows an initial empty starter with digest %s", async (digest) => {
    const h = harness([{ id: 1, name: exe, state: "starter", size: 0, digest }]);
    await h.run();
    expect(h.repos.deleteReleaseAsset).toHaveBeenCalledExactlyOnceWith({
      owner: "owner",
      repo: "viritura",
      asset_id: 1,
      request,
    });
  });
});

const invalidMetadata: [string, Partial<Asset>][] = [
  ["oversized starter", { state: "starter", size: 2 ** 31, digest: null }],
  ["starter digest", { state: "starter", size: 0, digest: `sha256:${"b".repeat(64)}` }],
  ["empty-string starter digest", { state: "starter", size: 0, digest: "" }],
  ["empty state", { state: "" }],
  ["zero uploaded size", { size: 0 }],
  ["negative uploaded size", { size: -1 }],
  ["fractional uploaded size", { size: 1.5 }],
  ["unsafe uploaded size", { size: Number.MAX_SAFE_INTEGER + 1 }],
  ["zero asset ID", { id: 0 }],
  ["unsafe asset ID", { id: Number.MAX_SAFE_INTEGER + 1 }],
  ["uppercase uploaded digest", { digest: `sha256:${"B".repeat(64)}` }],
  ["malformed uploaded digest", { digest: "sha256:abcd" }],
  ["wrong digest algorithm", { digest: `sha512:${"b".repeat(64)}` }],
];

describe("desktop release asset observations", () => {
  it("logs explicit missing markers and only expected named asset tuples", async () => {
    const h = harness([
      { ...stale("private@example.invalid"), uploader: { email: "private@example.invalid" } } as Asset,
    ]);
    await h.run();
    expect(h.core.info.mock.calls.slice(0, 2)).toEqual(
      names.map((name) => [`Observed release asset (list): ${JSON.stringify({ name, missing: true })}`]),
    );
    for (const name of names) {
      const asset = h.state.assets.find((entry) => entry.name === name)!;
      expect(h.core.info).toHaveBeenCalledWith(`Observed release asset (list): ${JSON.stringify(asset)}`);
      expect(h.core.info).toHaveBeenCalledWith(`Observed release asset (get-by-id): ${JSON.stringify(asset)}`);
    }
    expect(JSON.stringify(h.core.info.mock.calls)).not.toMatch(/private|uploader|email|test-token|second-secret/);
  });

  it("records duplicate tuples deterministically before rejecting selection", async () => {
    const first = { ...stale(exe, 1), state: "starter", size: 120774656, digest: null };
    const second = { ...stale(exe, 2), state: "pending", digest: undefined };
    const expected = [
      `Observed release asset (list): ${JSON.stringify(first)}`,
      `Observed release asset (list): ${JSON.stringify({ ...second, digest: "missing" })}`,
      `Observed release asset (list): ${JSON.stringify({ name: msi, missing: true })}`,
    ];
    for (const assets of [
      [second, first],
      [first, second],
    ]) {
      const h = harness(assets);
      await expect(h.run()).rejects.toThrow("Multiple release assets");
      expect(h.core.info.mock.calls.map(([message]) => message)).toEqual(expected);
      expectUntouched(h);
    }
  });

  it.each([
    ["mismatched size", { size: 120774656 }],
    ["mismatched digest", { digest: `sha256:${"b".repeat(64)}` }],
    ["invalid digest", { digest: secret }],
  ] as [string, Partial<Asset>][])(
    "logs both post-failure asset tuples after original diagnostics even with %s",
    async (_label, change) => {
      const h = harness();
      const correct = h.matching(msi, 2);
      h.state.assets = [correct];
      h.state.outcomes.set(exe, [
        { error: httpError(502), headers: ["X-GitHub-Request-Id: ORIGINAL:123"], appeared: change },
      ]);
      await expect(h.run()).rejects.toThrow();
      const warningAt = h.core.warning.mock.invocationCallOrder[0];
      expect(h.core.warning).toHaveBeenCalledExactlyOnceWith(
        `Upload ${exe}: status=502; transport=exit; x-github-request-id=ORIGINAL:123; message=HTTP 502`,
      );
      const failed = { ...h.matching(exe, 100), ...change };
      expect(
        h.core.info.mock.calls
          .filter((_call, index) => h.core.info.mock.invocationCallOrder[index] > warningAt)
          .map(([message]) => message),
      ).toEqual([
        `Observed release asset (list): ${JSON.stringify({
          ...failed,
          digest: failed.digest === secret ? "invalid" : failed.digest,
        })}`,
        `Observed release asset (list): ${JSON.stringify(correct)}`,
      ]);
      expect(attempts(h, exe)).toBe(1);
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["unknown state", "pending", "pending"],
    ["token state", "second-secret", "[redacted]"],
    ["prefixed token state", "ghp_hidden_secret", "[redacted]"],
    ["control characters", "open\n\u001b::error::injected", "invalid"],
    ["long state", "x".repeat(300), "invalid"],
    ["email state", "private@example.invalid", "invalid"],
  ])("bounds and sanitizes %s without serializing raw metadata", async (_label, state, observedState) => {
    const h = harness([
      {
        ...stale(exe),
        id: NaN,
        state,
        size: Infinity,
        digest: `${secret}\n::error::injected`,
        uploader: { email: "private@example.invalid", token: secret },
        headers: { authorization: processSecret },
      } as Asset,
    ]);
    await expect(h.run()).rejects.toThrow("Invalid release asset metadata");
    expect(h.core.info.mock.calls).toEqual([
      [
        `Observed release asset (list): ${JSON.stringify({
          id: "invalid",
          name: exe,
          state: observedState,
          size: "invalid",
          digest: "invalid",
        })}`,
      ],
      [`Observed release asset (list): ${JSON.stringify({ name: msi, missing: true })}`],
    ]);
    expectUntouched(h);
  });

  it("does not log a digest with a trailing control character as validated", async () => {
    const h = harness([{ ...stale(exe), digest: `sha256:${"b".repeat(64)}\n` }]);
    await expect(h.run()).rejects.toThrow();
    expect(h.core.info.mock.calls[0][0]).toBe(
      `Observed release asset (list): ${JSON.stringify({ ...stale(exe), digest: "invalid" })}`,
    );
    expectUntouched(h);
  });

  it.each(["missing", "invalid"] as const)("observes %s GET-by-ID results before verification fails", async (kind) => {
    const h = harness();
    if (kind === "missing") h.repos.getReleaseAsset.mockRejectedValue(httpError(404));
    else h.repos.getReleaseAsset.mockResolvedValue({ data: { ...h.matching(exe, 100), digest: secret } });
    await expect(h.run()).rejects.toThrow(kind === "missing" ? "did not settle" : "Invalid release asset metadata");
    expect(h.core.info).toHaveBeenCalledWith(
      `Observed release asset (get-by-id): ${JSON.stringify(
        kind === "missing" ? { name: exe, missing: true } : { ...h.matching(exe, 100), digest: "invalid" },
      )}`,
    );
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });
});

describe("desktop release gh upload transport", () => {
  it.each(["spawn", "process", "timeout", "exit", "stream"] as const)(
    "handles %s without printing process errors or leaking timers",
    async (failure) => {
      const h = harness();
      h.state.outcomes.set(
        exe,
        Array.from({ length: 3 }, () => ({
          failure,
          chunks: [],
        })),
      );
      await expect(h.run()).rejects.toThrow();
      expect(attempts(h, exe)).toBe(failure === "spawn" ? 1 : 3);
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
      expect(h.core.notice).not.toHaveBeenCalled();
      expect(h.core.warning).toHaveBeenCalledWith(expect.stringContaining(`transport=${failure}`));
      expect(JSON.stringify(h.core.warning.mock.calls)).not.toMatch(/test-token|hidden_secret|second-secret/);
      expect(h.deadlines.size).toBe(0);
      expect(h.processTimer.mock.calls.every(([, delay]) => delay === 90000)).toBe(true);
      for (const child of h.children) {
        expect(child.kill).toHaveBeenCalledTimes(failure === "timeout" || failure === "stream" ? 1 : 0);
      }
    },
  );

  it.each([{ chunks: [] }, { chunks: [Buffer.from("HTTP/2.0 20")] }])(
    "reconciles an interrupted stdout upload before retrying ($chunks)",
    async ({ chunks }) => {
      const h = harness();
      h.state.outcomes.set(exe, [{ failure: "stream", chunks }]);
      await h.run();
      expect(attempts(h, exe)).toBe(2);
      const start = h.state.operations.indexOf(`upload:${exe}`);
      const retry = h.state.operations.indexOf(`upload:${exe}`, start + 1);
      expect(h.state.operations.slice(start + 1, retry).filter((op) => op === "list")).toHaveLength(5);
      expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 4000, 1000]);
      expect(h.core.warning).toHaveBeenCalledExactlyOnceWith(`Upload ${exe}: status=unknown; transport=stream`);
      expect(h.children[0].kill).toHaveBeenCalledOnce();
      expect(h.deadlines.size).toBe(0);
      expect(h.clearTimer).toHaveBeenCalledTimes(h.processTimer.mock.calls.length);
    },
  );

  it("reconciles a completed upload after a partial stdout read failure without another POST", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ failure: "stream", chunks: [Buffer.from("HTTP/2.0 20")], appeared: "matching" }]);
    await h.run();
    expect(attempts(h, exe)).toBe(1);
    expect(h.timer).not.toHaveBeenCalled();
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.children[0].kill).toHaveBeenCalledOnce();
    expect(h.deadlines.size).toBe(0);
  });

  it("preserves the acknowledged 201 identity read before a stdout error", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ failure: "stream", appeared: "matching" }]);
    h.state.listView = (assets) => (attempts(h, msi) ? assets : assets.filter((a) => a.name !== exe));
    await h.run();
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.getReleaseAsset).toHaveBeenCalledWith({ owner: "owner", repo: "viritura", asset_id: 100, request });
    expect(h.core.warning).toHaveBeenCalledExactlyOnceWith(`Upload ${exe}: status=201; transport=stream`);
    expect(h.children[0].kill).toHaveBeenCalledOnce();
    expect(h.deadlines.size).toBe(0);
  });

  it("absorbs repeated late stdout errors after timeout without resolving or killing again", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ failure: "timeout", appeared: "matching" }]);
    await h.run();
    const clears = h.clearTimer.mock.calls.length;
    for (let i = 0; i < 2; i++) {
      expect(() => h.children[0].stdout.emit("error", new Error(processSecret))).not.toThrow();
    }
    h.children[0].stdout.write(Buffer.alloc(65537));
    h.children[0].emit("close", 0);
    expect(h.children[0].kill).toHaveBeenCalledOnce();
    expect(h.clearTimer).toHaveBeenCalledTimes(clears);
    expect(h.core.warning).toHaveBeenCalledExactlyOnceWith(`Upload ${exe}: status=unknown; transport=timeout`);
    expect(attempts(h, exe)).toBe(1);
    expect(h.core.notice).toHaveBeenCalledOnce();
    expect(h.deadlines.size).toBe(0);
  });

  it.each([
    ["over limit", [Buffer.alloc(65536, "x"), Buffer.from("x")], "byte limit"],
    [
      "truncated 201",
      [Buffer.from("HTTP/2.0 201 Created\r\nContent-Type: application/json\r\n\r\n{")],
      "Invalid release asset metadata",
    ],
    ["non-HTTP output", [Buffer.from("not an HTTP response")], "status=unknown"],
    ["truncated headers", [Buffer.from("HTTP/2.0 201 Created\r\n")], "status=unknown"],
  ] as [string, Buffer[], string][])("fails safely for %s upload output", async (_label, chunks, diagnostic) => {
    const h = harness();
    h.state.outcomes.set(exe, [{ chunks }]);
    await expect(h.run()).rejects.toThrow(diagnostic);
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.core.notice).not.toHaveBeenCalled();
    expect(h.deadlines.size).toBe(0);
    expect(h.children[0].kill).toHaveBeenCalledTimes(diagnostic === "byte limit" ? 1 : 0);
    expect(h.state.assets[0]).toEqual(h.matching(exe, 100));
  });

  it("accepts exactly 65536 bytes of upload response, parsed across asynchronous stdout chunks", async () => {
    const h = harness();
    const response = `HTTP/1.1 201 Created\nContent-Type: application/json\n\n${JSON.stringify(h.matching(exe, 100))}`;
    const bytes = Buffer.from(response.padEnd(65536, " "));
    h.state.outcomes.set(exe, [{ chunks: [bytes.subarray(0, 1), bytes.subarray(1, 65535), bytes.subarray(65535)] }]);
    await h.run();
    expect(h.children[0].kill).not.toHaveBeenCalled();
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.getReleaseAsset).toHaveBeenCalledWith({ owner: "owner", repo: "viritura", asset_id: 100, request });
  });

  it.each([422, 500, 502, 599, undefined])(
    "reconciles status %s that completed without another POST",
    async (status) => {
      const h = harness();
      h.state.outcomes.set(exe, [{ error: httpError(status), appeared: "matching" }]);
      await h.run();
      expect(attempts(h, exe)).toBe(1);
      expect(h.timer).not.toHaveBeenCalled();
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    },
  );

  it("settles a 422 conflict for four polls before retrying the missing asset", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(422) }]);
    await h.run();
    expect(attempts(h, exe)).toBe(2);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 4000, 1000]);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });

  it("allowlists HTTP diagnostics and redacts tokens, authorization and control characters", async () => {
    const h = harness();
    const message = `${secret} second-secret Bearer bearer-value Basic basic-value ghp_token github_pat_token\n\u001b ${"x".repeat(300)}`;
    h.state.outcomes.set(exe, [
      {
        error: httpError(403),
        response: { message, secret: "not-allowlisted-body" },
        headers: [
          "X-GitHub-Request-Id: ABCD:1234",
          "Retry-After: 2",
          "Content-Length: 123",
          `Authorization: Bearer ${secret}`,
          "Location: https://private.invalid/signed?token=secret",
          "Set-Cookie: not-allowlisted-cookie",
        ],
      },
    ]);
    await expect(h.run()).rejects.toThrow(
      /status=403; transport=exit; x-github-request-id=ABCD:1234; retry-after=2; content-length=123/,
    );
    const warning = h.core.warning.mock.calls[0][0] as string;
    expect(warning).toContain("[redacted]");
    expect(warning).not.toMatch(
      /test-token|second-secret|bearer-value|basic-value|ghp_token|github_pat_token|private.invalid|not-allowlisted/,
    );
    expect([...warning].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)).toBe(true);
    expect(warning.split("message=")[1]).toHaveLength(240);
  });

  it("omits invalid diagnostic headers and non-string messages", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [
      {
        error: httpError(403),
        response: { message: { token: secret } },
        headers: ["X-GitHub-Request-Id: unsafe value", "Retry-After: tomorrow", "Content-Length: 99999999999999999"],
      },
    ]);
    await expect(h.run()).rejects.toThrow();
    expect(h.core.warning).toHaveBeenCalledExactlyOnceWith(`Upload ${exe}: status=403; transport=exit; message=`);
  });
});

describe("desktop release acknowledged identity and settling", () => {
  it.each([502, 422, undefined])(
    "accepts status %s completing on the fourth poll of the final upload attempt",
    async (status) => {
      const h = harness();
      h.state.outcomes.set(exe, [
        { error: httpError(status) },
        { error: httpError(status) },
        { error: httpError(status), appeared: { state: "open", digest: null } },
      ]);
      h.state.onOperation = (op) => {
        if (op === "sleep:4000" && attempts(h, exe) === 3) {
          h.state.assets = [{ ...h.matching(exe, 100), digest: null }];
        }
      };
      await h.run();
      expect(attempts(h, exe)).toBe(3);
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
      const start = h.state.operations.lastIndexOf(`upload:${exe}`);
      const finish = h.state.operations.indexOf("download:100");
      expect(h.state.operations.slice(start + 1, finish)).toEqual([
        "release",
        "commit",
        "list",
        "sleep:1000",
        "release",
        "commit",
        "list",
        "sleep:2000",
        "release",
        "commit",
        "list",
        "sleep:4000",
        "release",
        "commit",
        "list",
      ]);
      expect(h.core.notice).toHaveBeenCalledOnce();
    },
  );

  it.each(["pending", "open"])("preserves an ambiguous %s asset after bounded settling", async (state) => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(502), appeared: { state, digest: null } }]);
    await expect(h.run()).rejects.toThrow("Release asset did not settle");
    expect(attempts(h, exe)).toBe(1);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 4000]);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.state.assets[0].state).toBe(state);
  });

  it.each([null, undefined])(
    "verifies an acknowledged success ID with digest %s via streaming download",
    async (digest) => {
      const h = harness();
      h.state.outcomes.set(exe, [{ appeared: { digest } }]);
      await h.run();
      expect(attempts(h, exe)).toBe(1);
      expect(h.state.operations.filter((op) => op === "download:100")).toHaveLength(1);
      expect(h.repos.getReleaseAsset).toHaveBeenCalledWith({
        owner: "owner",
        repo: "viritura",
        asset_id: 100,
        request,
      });
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    },
  );

  it("uses the acknowledged ID when absent from listing and waits for final membership", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ appeared: { digest: null } }]);
    let hidden = 0;
    h.state.listView = (assets) =>
      attempts(h, exe) && hidden++ < 4 ? assets.filter((asset) => asset.name !== exe) : assets;
    await h.run();
    expect(attempts(h, exe)).toBe(1);
    expect(h.state.operations).toContain("get:100");
    expect(h.state.operations.filter((op) => op === "download:100")).toHaveLength(1);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000]);
    expect(h.core.notice).toHaveBeenCalledOnce();
  });

  it("never reuploads an acknowledged ID that remains absent from the final listing", async () => {
    const h = harness();
    h.state.listView = (assets) => assets.filter((asset) => asset.name !== exe);
    await expect(h.run()).rejects.toThrow("Release asset verification failed");
    expect(attempts(h, exe)).toBe(1);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 4000]);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.state.assets).toHaveLength(2);
    expect(h.core.notice).not.toHaveBeenCalled();
  });

  it.each(["listing", "GET", "final listing"])("rejects returned response ID mismatch in %s", async (where) => {
    const h = harness();
    if (where === "listing") h.state.outcomes.set(exe, [{ response: h.matching(exe, 999) }]);
    if (where === "GET") h.repos.getReleaseAsset.mockResolvedValueOnce({ data: h.matching(exe, 999) });
    if (where === "final listing") {
      h.state.onOperation = (op) => {
        if (op === "list" && attempts(h, msi)) h.state.assets.find((asset) => asset.name === exe)!.id = 999;
      };
    }
    await expect(h.run()).rejects.toThrow("Release asset identity changed");
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.core.notice).not.toHaveBeenCalled();
  });

  it.each(["missing", "starter", "open"])("preserves acknowledged %s after four GET-by-ID polls", async (state) => {
    const h = harness();
    h.state.outcomes.set(exe, [{ appeared: { state: state === "missing" ? "uploaded" : state, digest: null } }]);
    if (state === "missing") h.repos.getReleaseAsset.mockRejectedValue(httpError(404));
    await expect(h.run()).rejects.toThrow("Release asset did not settle");
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.getReleaseAsset).toHaveBeenCalledTimes(4);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 4000]);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });

  it("accepts an acknowledged starter that finishes while polling by ID", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ appeared: { state: "starter", digest: null } }]);
    h.state.onOperation = (op) => {
      if (op === "sleep:2000") h.state.assets = [h.matching(exe, 100)];
    };
    await h.run();
    expect(attempts(h, exe)).toBe(1);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000]);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });

  it.each(["matching", "wrong", "open", "missing"] as const)(
    "rechecks a starter by ID immediately before deletion when it becomes %s",
    async (replacement) => {
      const h = harness([{ id: 1, name: exe, state: "starter", size: 120774656, digest: null }]);
      h.state.onOperation = (op) => {
        if (op !== "get:1") return;
        switch (replacement) {
          case "matching":
            h.state.assets = [h.matching(exe, 1)];
            break;
          case "wrong":
            h.state.assets = [stale(exe, 1)];
            break;
          case "open":
            h.state.assets[0].state = "open";
            break;
          case "missing":
            h.state.assets = [];
            break;
        }
      };
      if (replacement === "wrong" || replacement === "open") {
        await expect(h.run()).rejects.toThrow();
        expect(h.uploadRequests).not.toHaveBeenCalled();
        expect(h.core.notice).not.toHaveBeenCalled();
      } else {
        await h.run();
        expect(attempts(h, exe)).toBe(replacement === "matching" ? 0 : 1);
      }
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
      expect(h.state.operations).toContain("get:1");
    },
  );

  it.each(["pending", "open", "future-state"])("waits for unknown state %s, then safely fails", async (state) => {
    const h = harness([{ ...stale(exe), state, digest: null }]);
    await expect(h.run()).rejects.toThrow("Release asset did not settle");
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 4000]);
    expectUntouched(h);
  });

  it.each(["pending", "open"])("accepts %s settling to matching uploaded bytes", async (state) => {
    const h = harness([{ ...stale(exe), state, digest: null }]);
    h.state.onOperation = (op) => {
      if (op === "sleep:4000") h.state.assets = [h.matching(exe, 1)];
    };
    await h.run();
    expect(attempts(h, exe)).toBe(0);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 4000]);
  });

  it.each([429, 502, undefined, 403])(
    "preserves original upload diagnostics when list fails with %s",
    async (status) => {
      const h = harness();
      h.state.outcomes.set(exe, [{ error: httpError(503), headers: ["X-GitHub-Request-Id: ORIGINAL:123"] }]);
      let failedReads = 0;
      h.state.onOperation = (op) => {
        if (op === "list" && attempts(h, exe)) {
          failedReads++;
          throw httpError(status);
        }
      };
      await expect(h.run()).rejects.toThrow("Release asset metadata could not be read safely");
      expect(failedReads).toBe(status === 403 ? 1 : 3);
      expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual(status === 403 ? [] : [500, 1000]);
      expect(h.core.warning).toHaveBeenCalledExactlyOnceWith(
        `Upload ${exe}: status=503; transport=exit; x-github-request-id=ORIGINAL:123; message=HTTP 503`,
      );
      expect(attempts(h, exe)).toBe(1);
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    },
  );

  it("recovers transient list failures without losing the original upload diagnostic", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(502), appeared: "matching" }]);
    let failures = 0;
    h.state.onOperation = (op) => {
      if (op === "list" && attempts(h, exe) && failures++ < 2) throw httpError(503);
    };
    await h.run();
    expect(attempts(h, exe)).toBe(1);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([500, 1000]);
    expect(h.core.warning).toHaveBeenCalledExactlyOnceWith(
      `Upload ${exe}: status=502; transport=exit; message=HTTP 502`,
    );
  });

  it("retries transient GET-by-ID failures with bounded metadata request timeouts", async () => {
    const h = harness();
    h.repos.getReleaseAsset.mockRejectedValueOnce(httpError(503)).mockRejectedValueOnce(new Error(processSecret));
    await h.run();
    expect(attempts(h, exe)).toBe(1);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([500, 1000]);
    expect(h.core.warning).not.toHaveBeenCalled();
  });

  it.each(["missing", "different ID"])("does not delete a starter whose cleanup listing has %s", async (change) => {
    const h = harness([{ id: 1, name: exe, state: "starter", size: 1, digest: null }]);
    h.state.onOperation = (op) => {
      if (op !== "list" || h.paginate.mock.calls.length !== 6) return;
      if (change === "missing") h.state.assets = [];
      else h.state.assets[0].id = 2;
    };
    await expect(h.run()).rejects.toThrow(
      change === "missing" ? "Release asset disappeared before cleanup" : "Release asset identity changed",
    );
    expectUntouched(h);
    expect(h.repos.getReleaseAsset).not.toHaveBeenCalled();
  });
});

describe("desktop release streamed digest fallback", () => {
  it.each([null, undefined])("downloads and caches matching uploaded bytes with digest %s", async (digest) => {
    const h = harness();
    h.state.assets = names.map((name, i) => ({ ...h.matching(name, i + 1), digest }));
    await h.run();
    expect(h.uploadRequests).not.toHaveBeenCalled();
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.state.operations.filter((op) => op.startsWith("download:"))).toEqual(["download:1", "download:2"]);
    expect(h.processTimer.mock.calls.map(([, delay]) => delay)).toEqual([60000, 60000]);
    expect(h.deadlines.size).toBe(0);
    expect(h.fs.readFile).toHaveBeenCalledTimes(2);
    expect(h.spawn.mock.calls.every(([, args]) => !args.includes("--include") && !args.includes("--input"))).toBe(true);
  });

  it.each(["same-size wrong bytes", "truncated", "empty", "oversized"] as const)(
    "preserves uploaded assets when download returns %s",
    async (corruption) => {
      const h = harness();
      h.state.assets = [{ ...h.matching(exe, 1), digest: null }];
      const bytes = h.files.get(exe)!.data;
      const chunks = {
        "same-size wrong bytes": [Buffer.alloc(bytes.length, "x")],
        truncated: [bytes.subarray(0, bytes.length - 1)],
        empty: [],
        oversized: [bytes, Buffer.from("x"), Buffer.from("ignored after kill")],
      }[corruption];
      h.state.downloads.set(1, [{ chunks }]);
      await expect(h.run()).rejects.toThrow(
        corruption === "oversized" ? "byte limit" : "Unexpected release asset data",
      );
      expectUntouched(h);
      expect(h.state.assets).toHaveLength(1);
      expect(h.children[0].kill).toHaveBeenCalledTimes(corruption === "oversized" ? 1 : 0);
      expect(h.deadlines.size).toBe(0);
    },
  );

  it.each(["spawn", "process", "timeout", "exit", "stream"] as const)(
    "fails safely on download %s",
    async (failure) => {
      const h = harness();
      h.state.assets = [{ ...h.matching(exe, 1), digest: null }];
      h.state.downloads.set(1, [{ failure }]);
      await expect(h.run()).rejects.toThrow(`Release asset download verification failed: ${exe}; ${failure}`);
      expectUntouched(h);
      expect(h.spawn).toHaveBeenCalledOnce();
      expect(h.deadlines.size).toBe(0);
      expect(h.core.warning).not.toHaveBeenCalled();
      for (const child of h.children) {
        expect(child.kill).toHaveBeenCalledTimes(failure === "timeout" || failure === "stream" ? 1 : 0);
      }
    },
  );

  it.each([0, 127, 512])("never verifies a failed download stream after %s matching bytes", async (length) => {
    const h = harness();
    h.state.assets = [{ ...h.matching(exe, 1), digest: null }];
    h.state.downloads.set(1, [{ failure: "stream", chunks: [h.files.get(exe)!.data.subarray(0, length)] }]);
    await expect(h.run()).rejects.toThrow(`Release asset download verification failed: ${exe}; stream`);
    expectUntouched(h);
    expect(h.state.operations.filter((op) => op.startsWith("download:"))).toEqual(["download:1"]);
    expect(h.core.info.mock.calls.some(([message]) => String(message).startsWith("Keeping verified"))).toBe(false);
    expect(h.children[0].kill).toHaveBeenCalledOnce();
    expect(h.clearTimer).toHaveBeenCalledOnce();
    expect(h.deadlines.size).toBe(0);
    expect(() => h.children[0].stdout.emit("error", new Error(processSecret))).not.toThrow();
    expect(h.children[0].kill).toHaveBeenCalledOnce();
  });

  it("does not reuse a verified download across asset IDs and uses at most two downloads per name", async () => {
    const h = harness();
    h.state.assets = [{ ...h.matching(exe, 1), digest: null }, h.matching(msi, 3)];
    h.state.onOperation = (op) => {
      if (op === "list" && h.paginate.mock.calls.length === 2) h.state.assets[0].id = 2;
    };
    await h.run();
    expect(h.state.operations.filter((op) => op.startsWith("download:"))).toEqual(["download:1", "download:2"]);
    expect(h.spawn).toHaveBeenCalledTimes(2);
    expect(h.uploadRequests).not.toHaveBeenCalled();
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });

  it.each(["size", "digest", "name"] as const)("does not let cached bytes mask a changed %s", async (field) => {
    const h = harness();
    h.state.assets = [{ ...h.matching(exe, 1), digest: null }, h.matching(msi, 2)];
    h.state.onOperation = (op) => {
      if (op !== "list" || h.paginate.mock.calls.length !== 2) return;
      const asset = h.state.assets[0];
      if (field === "size") asset.size++;
      if (field === "digest") asset.digest = stale(exe).digest;
      if (field === "name") asset.name = msi;
    };
    await expect(h.run()).rejects.toThrow();
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.core.notice).not.toHaveBeenCalled();
    expect(h.state.operations.filter((op) => op.startsWith("download:"))).toEqual(["download:1"]);
  });

  it("preserves an ambiguous completed upload whose nullable digest downloads wrong bytes", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(502), appeared: { digest: null } }]);
    h.state.downloads.set(100, [{ chunks: [Buffer.alloc(512)] }]);
    await expect(h.run()).rejects.toThrow("Unexpected release asset data");
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.state.assets).toHaveLength(1);
    expect(h.core.warning).toHaveBeenCalledWith(expect.stringContaining("status=502"));
  });
});

describe("desktop release remote asset safety", () => {
  it.each([
    ...[-1, 1.5, NaN, "1", null, undefined].map((id) => ["id", id] as const),
    ...[NaN, Infinity, 2 ** 31, "512", null, undefined].map((size) => ["size", size] as const),
    ...[42, {}, "", `sha256:${"a".repeat(65)}`].map((digest) => ["digest", digest] as const),
    ...[null, undefined, 42].map((state) => ["state", state] as const),
  ])("rejects malformed %s=%s without trusting or deleting it", async (field, value) => {
    const h = harness();
    const asset = { ...h.matching(exe, 1), [field]: value } as Asset;
    h.state.assets = [asset];
    await expect(h.run()).rejects.toThrow("Invalid release asset metadata");
    expectUntouched(h);
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.state.assets).toEqual([asset]);
  });

  it.each([
    ["invalid ID", { id: 0 }],
    ["wrong name", { name: msi }],
    ["invalid size", { size: -1 }],
    ["invalid digest", { digest: "sha256:invalid" }],
  ] as [string, Partial<Asset>][])("never retries an acknowledged upload with %s", async (_label, changes) => {
    const h = harness();
    h.state.outcomes.set(exe, [{ response: { ...h.matching(exe, 100), ...changes } }]);
    await expect(h.run()).rejects.toThrow("Invalid release asset metadata");
    expect(attempts(h, exe)).toBe(1);
    expect(h.timer).not.toHaveBeenCalled();
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.state.assets).toHaveLength(1);
  });

  it.each(invalidMetadata)("rejects initial %s without deleting it", async (_label, metadata) => {
    const asset = { ...stale(exe), ...metadata };
    const h = harness([asset]);
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
    expect(h.state.assets).toEqual([asset]);
  });

  it.each([...invalidMetadata, ["different uploaded asset", {}] as [string, Partial<Asset>]])(
    "rejects %s after ambiguous failure without deleting it or backing off",
    async (_label, metadata) => {
      const h = harness();
      h.state.outcomes.set(exe, [{ error: httpError(503), appeared: { ...stale(exe, 100), ...metadata } }]);
      await expect(h.run()).rejects.toThrow();
      expect(attempts(h, exe)).toBe(1);
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
      expect(h.timer).not.toHaveBeenCalled();
      expect(h.state.assets).toHaveLength(1);
      expect(h.core.notice).not.toHaveBeenCalled();
    },
  );

  it.each([...invalidMetadata, ["different uploaded asset", {}] as [string, Partial<Asset>]])(
    "re-lists after backoff and refuses to delete %s that replaced a starter",
    async (_label, metadata) => {
      const h = harness();
      const replacement = { ...stale(exe, 100), ...metadata };
      h.state.outcomes.set(exe, [{ error: httpError(503), appeared: "starter" }]);
      h.state.onOperation = (op) => {
        if (op === "sleep:1000") h.state.assets = [replacement];
      };
      await expect(h.run()).rejects.toThrow();
      expect(attempts(h, exe)).toBe(1);
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
      expect(h.state.assets).toEqual([replacement]);
    },
  );

  it("accepts a matching upload that finishes during backoff without deletion or retry upload", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(503), appeared: "starter" }]);
    h.state.onOperation = (op) => {
      if (op === "sleep:1000") h.state.assets = [h.matching(exe)];
    };
    await h.run();
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });

  it.each(["absent", "starter", "id", "size", "digest"])(
    "rejects a different completed asset after initial %s metadata was validated",
    async (change) => {
      const h = harness();
      const initial =
        change === "starter" ? { ...stale(exe), state: "starter", size: 0, digest: null } : h.matching(exe, 1);
      h.state.assets = change === "absent" ? [] : [initial];
      h.state.onOperation = (op) => {
        if (op !== "list" || h.paginate.mock.calls.length !== 2) return;
        const replacement = stale(exe);
        if (change === "id") replacement.id++;
        if (change === "size") replacement.size++;
        if (change === "digest") replacement.digest = `sha256:${"c".repeat(64)}`;
        h.state.assets = [replacement];
      };
      await expect(h.run()).rejects.toThrow("Unexpected release asset data");
      expectUntouched(h);
    },
  );

  it("does not delete an MSI that appeared while the EXE uploaded", async () => {
    const h = harness();
    const unexpected = stale(msi);
    h.state.onOperation = (op) => {
      if (op === `upload:${exe}`) h.state.assets.push(unexpected);
    };
    await expect(h.run()).rejects.toThrow("Unexpected release asset data");
    expect(attempts(h, exe)).toBe(1);
    expect(attempts(h, msi)).toBe(0);
    expect(h.state.assets).toContainEqual(unexpected);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });

  it("preserves a matching installer that appears after preflight", async () => {
    const h = harness();
    h.state.onOperation = (op) => {
      if (op === "list" && h.paginate.mock.calls.length === 2) h.state.assets = [h.matching(exe)];
    };
    await h.run();
    expect(attempts(h, exe)).toBe(0);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });

  it.each([exe, msi])("rejects duplicate initial named assets (%s)", async (name) => {
    const h = harness();
    h.state.assets = [h.matching(name, 1), h.matching(name, 2)];
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
  });

  it("rejects duplicate assets after an ambiguous upload", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(500), appeared: "matching" }]);
    h.state.onOperation = (op) => {
      if (op === "list" && attempts(h, exe)) h.state.assets.push(h.matching(exe));
    };
    await expect(h.run()).rejects.toThrow();
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.timer).not.toHaveBeenCalled();
  });

  it.each(["missing", "duplicate", "digest", "size", "state"])(
    "requires the final paginated listing to verify both installers (%s)",
    async (corruption) => {
      const h = harness();
      h.state.onOperation = (op) => {
        if (op !== "list" || !attempts(h, msi)) return;
        const asset = h.state.assets.find((entry) => entry.name === exe)!;
        switch (corruption) {
          case "missing":
            h.state.assets = h.state.assets.filter((entry) => entry.name !== exe);
            break;
          case "duplicate":
            h.state.assets.push(h.matching(exe));
            break;
          case "digest":
            asset.digest = stale(exe).digest;
            break;
          case "size":
            asset.size++;
            break;
          case "state":
            asset.state = "starter";
            break;
        }
      };
      await expect(h.run()).rejects.toThrow();
      expect(attempts(h, msi)).toBe(1);
      expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
      expect(h.core.notice).not.toHaveBeenCalled();
    },
  );
});

const invariantChanges: [string, (h: Harness) => void][] = [
  [
    "release ID",
    (h) => {
      h.state.release.id++;
    },
  ],
  [
    "release tag",
    (h) => {
      h.state.release.tag_name = "v9";
    },
  ],
  [
    "draft release",
    (h) => {
      h.state.release.draft = true;
    },
  ],
  [
    "immutable release",
    (h) => {
      h.state.release.immutable = true;
    },
  ],
  [
    "tag commit",
    (h) => {
      h.state.commit = "b".repeat(40);
    },
  ],
];

describe("desktop release invariant guards", () => {
  it.each([
    [
      "wrong event",
      (h: Harness) => {
        h.context.eventName = "push";
      },
    ],
    [
      "wrong action",
      (h: Harness) => {
        h.context.payload.action = "edited";
      },
    ],
    [
      "absent release",
      (h: Harness) => {
        h.context.payload.release = undefined;
      },
    ],
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "42", null, undefined].map((id): [string, (h: Harness) => void] => [
      `invalid ID ${String(id)}`,
      (h) => {
        h.context.payload.release!.id = id;
      },
    ]),
    ...["", 42, null, undefined].map((tag): [string, (h: Harness) => void] => [
      `invalid tag ${String(tag)}`,
      (h) => {
        h.context.payload.release!.tag_name = tag;
      },
    ]),
  ])("rejects original event with %s", async (_label, change) => {
    const h = harness();
    change(h);
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
    expect(h.repos.getRelease).not.toHaveBeenCalled();
  });

  it.each(invariantChanges)("checks initial %s before mutations", async (_label, change) => {
    const h = harness([stale(exe)]);
    change(h);
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
  });

  it.each(invariantChanges)("rechecks %s immediately before deleting a starter", async (_label, change) => {
    const h = harness([{ ...stale(exe), state: "starter", size: 0, digest: null }]);
    h.state.onOperation = (op) => {
      if (op === "list" && h.paginate.mock.calls.length === 6) change(h);
    };
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
  });

  it.each(invariantChanges)("rechecks %s before uploading after a delete", async (_label, change) => {
    const h = harness([{ ...stale(exe), state: "starter", size: 0, digest: null }]);
    h.state.onOperation = (op) => {
      if (op === "delete:1") change(h);
    };
    await expect(h.run()).rejects.toThrow();
    expect(h.repos.deleteReleaseAsset).toHaveBeenCalledOnce();
    expect(h.uploadRequests).not.toHaveBeenCalled();
  });

  it.each(invariantChanges)("rechecks %s before uploading an absent asset", async (_label, change) => {
    const h = harness();
    h.state.onOperation = (op) => {
      if (op === "list") change(h);
    };
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
  });

  it.each(invariantChanges)("rechecks %s immediately after an ambiguous 5xx", async (_label, change) => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(503), appeared: "matching" }]);
    h.state.onOperation = (op) => {
      if (op === `upload:${exe}`) change(h);
    };
    await expect(h.run()).rejects.toThrow();
    expect(attempts(h, exe)).toBe(1);
    expect(attempts(h, msi)).toBe(0);
    expect(h.timer).not.toHaveBeenCalled();
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });

  it.each(invariantChanges)("rechecks %s before retry cleanup and upload after backoff", async (_label, change) => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(503), appeared: "starter" }]);
    h.state.onOperation = (op) => {
      if (op === "sleep:1000") change(h);
    };
    await expect(h.run()).rejects.toThrow();
    expect(attempts(h, exe)).toBe(1);
    expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(h.state.assets[0].state).toBe("starter");
  });

  it.each(invariantChanges)("checks final %s even when both uploads succeeded", async (_label, change) => {
    const h = harness();
    h.state.onOperation = (op) => {
      if (op === "list" && attempts(h, msi)) change(h);
    };
    await expect(h.run()).rejects.toThrow();
    expect(attempts(h, exe)).toBe(1);
    expect(attempts(h, msi)).toBe(1);
    expect(h.core.notice).not.toHaveBeenCalled();
  });
});

describe("desktop release local installer validation", () => {
  it.each([[], [exe], [exe, exe], [exe, msi, "extra.txt"], [exe, "other.msi"]])(
    "requires exactly the two intended filenames (%j)",
    async (...entries) => {
      const h = harness();
      h.state.entries = entries;
      await expect(h.run()).rejects.toThrow();
      expectUntouched(h);
      expect(h.repos.getRelease).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "symlink",
      (file: LocalFile) => {
        file.regular = false;
        file.symlink = true;
      },
    ],
    [
      "directory",
      (file: LocalFile) => {
        file.regular = false;
      },
    ],
    [
      "empty",
      (file: LocalFile) => {
        file.size = 0;
        file.data = Buffer.alloc(0);
      },
    ],
    [
      "2 GiB",
      (file: LocalFile) => {
        file.size = 2 ** 31;
      },
    ],
    [
      "larger than 2 GiB",
      (file: LocalFile) => {
        file.size = 2 ** 31 + 1;
      },
    ],
    [
      "size changed",
      (file: LocalFile) => {
        file.size++;
      },
    ],
  ])("rejects a local %s installer before remote mutation", async (_label, change) => {
    const h = harness();
    change(h.files.get(msi)!);
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
    expect(h.repos.getRelease).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing MZ",
      exe,
      (data: Buffer) => {
        data[0] = 0;
      },
    ],
    [
      "missing PE",
      exe,
      (data: Buffer) => {
        data.writeUInt32LE(0, 128);
      },
    ],
    [
      "PE offset before DOS header",
      exe,
      (data: Buffer) => {
        data.writeUInt32LE(4, 60);
      },
    ],
    [
      "PE offset outside file",
      exe,
      (data: Buffer) => {
        data.writeUInt32LE(0xffffffff, 60);
      },
    ],
    [
      "truncated PE signature",
      exe,
      (data: Buffer) => {
        data.writeUInt32LE(510, 60);
      },
    ],
    [
      "invalid MSI magic",
      msi,
      (data: Buffer) => {
        data[0] = 0;
      },
    ],
  ] as [string, string, (data: Buffer) => void][])("rejects %s", async (_label, name, corrupt) => {
    const h = harness();
    corrupt(h.files.get(name)!.data);
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
  });

  it.each([
    [exe, 63],
    [msi, 511],
  ] as [string, number][])("rejects a truncated %s header", async (name, length) => {
    const h = harness();
    const file = h.files.get(name)!;
    file.data = file.data.subarray(0, length);
    file.size = length;
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
  });
});

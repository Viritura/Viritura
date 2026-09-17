// @vitest-environment node
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
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
}

interface ReleaseParams extends RepoParams {
  release_id: number;
}

interface UploadParams extends ReleaseParams {
  name: string;
  data: Buffer;
  headers: Record<string, string | number>;
}

interface UploadOutcome {
  error?: unknown;
  appeared?: Partial<Asset> | "matching" | "starter";
}

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
    operations: [] as string[],
    onOperation: (_operation: string) => {},
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
      expect(params).toEqual({ ...context.repo, release_id: 42 });
      operation("release");
      return { data: { ...state.release } };
    }),
    getCommit: vi.fn(async (params: RepoParams & { ref: string }) => {
      expect(params).toEqual({ ...context.repo, ref: "refs/tags/v1.2.3" });
      operation("commit");
      return { data: { sha: state.commit } };
    }),
    listReleaseAssets: vi.fn(() => {
      throw new Error("Assets must use pagination");
    }),
    deleteReleaseAsset: vi.fn(async (params: RepoParams & { asset_id: number }) => {
      expect(params).toEqual({ ...context.repo, asset_id: params.asset_id });
      operation(`delete:${params.asset_id}`);
      state.assets = state.assets.filter((asset) => asset.id !== params.asset_id);
      return { status: 204 };
    }),
    uploadReleaseAsset: vi.fn(async (params: UploadParams) => {
      expect(params).toMatchObject({ ...context.repo, release_id: 42 });
      operation(`upload:${params.name}`);
      const outcome = state.outcomes.get(params.name)?.shift();
      if (!outcome?.error || outcome.appeared) {
        const asset = matching(params.name);
        if (outcome?.appeared === "starter") Object.assign(asset, { state: "starter", size: 0, digest: null });
        else if (typeof outcome?.appeared === "object") Object.assign(asset, outcome.appeared);
        state.assets.push(asset);
      }
      if (outcome?.error) throw outcome.error;
      return { data: state.assets.at(-1) };
    }),
  };
  const paginate = vi.fn(async (method: unknown, params: ReleaseParams & { per_page: number }) => {
    expect(method).toBe(repos.listReleaseAssets);
    expect(params).toEqual({ ...context.repo, release_id: 42, per_page: 100 });
    operation("list");
    return state.assets.map((asset) => ({ ...asset }));
  });
  const timer = vi.fn((callback: () => void, delay: number) => {
    operation(`sleep:${delay}`);
    callback();
    return 1;
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
      process: { env: { GITHUB_WORKSPACE: root } },
      Buffer,
      setTimeout: timer,
    }) as Promise<unknown>;
  return { state, context, files, fs, repos, paginate, timer, core, run, matching };
}

type Harness = ReturnType<typeof harness>;

function expectUntouched(h: Harness) {
  expect(h.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  expect(h.repos.uploadReleaseAsset).not.toHaveBeenCalled();
  expect(h.core.notice).not.toHaveBeenCalled();
}

function attempts(h: Harness, name: string) {
  return h.repos.uploadReleaseAsset.mock.calls.filter(([params]) => params.name === name).length;
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
  it("uploads real PE/MSI bytes with exact length, content type, and SHA-256 verification", async () => {
    const unrelated = stale("notes.txt", 9);
    const h = harness([unrelated]);
    await h.run();
    expect(h.repos.uploadReleaseAsset).toHaveBeenCalledTimes(2);
    for (const [params] of h.repos.uploadReleaseAsset.mock.calls) {
      expect(params.data).toBe(h.files.get(params.name)!.data);
      expect(params.headers).toEqual({
        "content-type": "application/octet-stream",
        "content-length": params.data.length,
      });
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
  });

  it("preserves both already correct installers without mutation", async () => {
    const h = harness();
    const assets = names.map((name) => h.matching(name));
    h.state.assets = [...assets];
    await h.run();
    expect(h.repos.uploadReleaseAsset).not.toHaveBeenCalled();
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

  it("replaces stale assets per name just before upload, never globally", async () => {
    const h = harness([stale(exe, 1), stale(msi, 2), stale("notes.txt", 3)]);
    h.state.outcomes.set(exe, [{ error: httpError(403) }]);
    await expect(h.run()).rejects.toThrow();
    expect(h.repos.deleteReleaseAsset.mock.calls.map(([params]) => params.asset_id)).toEqual([1]);
    expect(h.state.assets).toEqual([stale(msi, 2), stale("notes.txt", 3)]);
  });

  it("replaces both stale uploaded assets successfully", async () => {
    const h = harness([stale(exe, 1), stale(msi, 2)]);
    await h.run();
    expect(h.state.operations.filter((op) => /^(delete|upload):/.test(op))).toEqual([
      "delete:1",
      `upload:${exe}`,
      "delete:2",
      `upload:${msi}`,
    ]);
  });

  it("gives each installer its own three-attempt budget", async () => {
    const h = harness();
    for (const name of names) h.state.outcomes.set(name, [{ error: httpError(500) }, { error: httpError(599) }]);
    await h.run();
    expect(attempts(h, exe)).toBe(3);
    expect(attempts(h, msi)).toBe(3);
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000, 1000, 2000]);
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
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000]);
    expect(h.repos.deleteReleaseAsset).toHaveBeenCalledTimes(2);
    expect(h.state.assets).toEqual([expect.objectContaining({ state: "starter", size: 0, digest: null })]);
    const lastUpload = h.state.operations.lastIndexOf(`upload:${exe}`);
    expect(h.state.operations.slice(lastUpload + 1)).toEqual(["release", "commit", "list"]);
    expect(h.core.notice).not.toHaveBeenCalled();
  });

  it.each([400, 403, 404, 409, 422, 429, 499, 600, "503", undefined])(
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

  it("does not retry network errors without an HTTP status", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: new Error("ECONNRESET") }]);
    await expect(h.run()).rejects.toThrow("ECONNRESET");
    expect(attempts(h, exe)).toBe(1);
    expect(h.timer).not.toHaveBeenCalled();
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
    expect(h.timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000].slice(0, attempt - 1));
    expect(h.repos.deleteReleaseAsset).toHaveBeenCalledTimes(attempt - 1);
  });

  it("cleans only an empty starter immediately before an actual retry", async () => {
    const h = harness();
    h.state.outcomes.set(exe, [{ error: httpError(500), appeared: "starter" }]);
    await h.run();
    expect(h.state.operations.filter((op) => /^(upload|delete|sleep):/.test(op))).toEqual([
      `upload:${exe}`,
      "sleep:1000",
      "delete:100",
      `upload:${exe}`,
      `upload:${msi}`,
    ]);
  });

  it.each([null, undefined])("allows an initial empty starter with digest %s", async (digest) => {
    const h = harness([{ id: 1, name: exe, state: "starter", size: 0, digest }]);
    await h.run();
    expect(h.repos.deleteReleaseAsset).toHaveBeenCalledExactlyOnceWith({
      owner: "owner",
      repo: "viritura",
      asset_id: 1,
    });
  });
});

const invalidMetadata: [string, Partial<Asset>][] = [
  ["nonempty starter", { state: "starter", size: 1, digest: null }],
  ["starter digest", { state: "starter", size: 0, digest: `sha256:${"b".repeat(64)}` }],
  ["empty-string starter digest", { state: "starter", size: 0, digest: "" }],
  ["unknown state", { state: "pending" }],
  ["zero uploaded size", { size: 0 }],
  ["negative uploaded size", { size: -1 }],
  ["fractional uploaded size", { size: 1.5 }],
  ["unsafe uploaded size", { size: Number.MAX_SAFE_INTEGER + 1 }],
  ["missing uploaded digest", { digest: undefined }],
  ["null uploaded digest", { digest: null }],
  ["uppercase uploaded digest", { digest: `sha256:${"B".repeat(64)}` }],
  ["malformed uploaded digest", { digest: "sha256:abcd" }],
  ["wrong digest algorithm", { digest: `sha512:${"b".repeat(64)}` }],
];

describe("desktop release remote asset safety", () => {
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
      const initial = change === "starter" ? { ...stale(exe), state: "starter", size: 0, digest: null } : stale(exe);
      const h = harness(change === "absent" ? [] : [initial]);
      h.state.onOperation = (op) => {
        if (op !== "list" || h.paginate.mock.calls.length !== 2) return;
        const replacement = stale(exe);
        if (change === "id") replacement.id++;
        if (change === "size") replacement.size++;
        if (change === "digest") replacement.digest = `sha256:${"c".repeat(64)}`;
        h.state.assets = [replacement];
      };
      await expect(h.run()).rejects.toThrow("changed since initial validation");
      expectUntouched(h);
    },
  );

  it("does not delete an MSI that appeared while the EXE uploaded", async () => {
    const h = harness();
    const unexpected = stale(msi);
    h.state.onOperation = (op) => {
      if (op === `upload:${exe}`) h.state.assets.push(unexpected);
    };
    await expect(h.run()).rejects.toThrow("changed since initial validation");
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

  it.each(invariantChanges)("rechecks %s before deleting a stale asset", async (_label, change) => {
    const h = harness([stale(exe)]);
    h.state.onOperation = (op) => {
      if (op === "list") change(h);
    };
    await expect(h.run()).rejects.toThrow();
    expectUntouched(h);
  });

  it.each(invariantChanges)("rechecks %s before uploading after a delete", async (_label, change) => {
    const h = harness([stale(exe)]);
    h.state.onOperation = (op) => {
      if (op === "delete:1") change(h);
    };
    await expect(h.run()).rejects.toThrow();
    expect(h.repos.deleteReleaseAsset).toHaveBeenCalledOnce();
    expect(h.repos.uploadReleaseAsset).not.toHaveBeenCalled();
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

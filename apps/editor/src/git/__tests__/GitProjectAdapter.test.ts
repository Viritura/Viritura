/**
 * Adapter conformance + commit message tests using the in-memory FS.
 */

import git from "isomorphic-git";
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryFs } from "../fs/inMemoryFs";
import { initRepo, openRepo, GitProjectAdapter } from "../GitProjectAdapter";
import { _clearIdentityForTesting } from "../identity";
import { synthesizeCommitMessage } from "../commitMessage";

const SCORE_V1 = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [{ name: "Flute", measures: [{}] }],
});

const SCORE_V2 = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [{ name: "Flute", measures: [{ sequences: [{ content: [] }] }] }],
});

describe("InMemoryFs", () => {
  it("writes and reads a file", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/hello.txt", "world");
    const text = await fs.readFile("/hello.txt", { encoding: "utf8" });
    expect(text).toBe("world");
  });

  it("creates intermediate directories with mkdir recursive", async () => {
    const fs = new InMemoryFs();
    await fs.mkdir("/a/b/c", { recursive: true });
    const stat = await fs.stat("/a/b/c");
    expect(stat.isDirectory()).toBe(true);
  });

  it("readdir returns immediate children only", async () => {
    const fs = new InMemoryFs();
    await fs.mkdir("/d", { recursive: true });
    await fs.writeFile("/d/x", "x");
    await fs.writeFile("/d/y", "y");
    await fs.mkdir("/d/sub", { recursive: true });
    await fs.writeFile("/d/sub/z", "z");
    const names = await fs.readdir("/d");
    expect(names).toEqual(["sub", "x", "y"]);
  });

  it("ENOENT for missing file", async () => {
    const fs = new InMemoryFs();
    await expect(fs.readFile("/nope")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("GitProjectAdapter end-to-end", () => {
  beforeEach(() => {
    _clearIdentityForTesting();
  });

  it("init creates an initial commit and lists it in the log", async () => {
    const fs = new InMemoryFs();
    const adapter = await initRepo({
      fs,
      name: "my-symphony",
      scorePath: "score.mnx",
      initialJson: SCORE_V1,
    });
    const log = await adapter.log();
    expect(log).toHaveLength(1);
    expect(log[0].subject).toBe("Initial draft");
    expect(log[0].refs).toContain("main");
    expect(log[0].author.name).toBe("local");
  });

  it("commit returns null when nothing changed", async () => {
    const fs = new InMemoryFs();
    const adapter = await initRepo({
      fs,
      name: "p",
      scorePath: "score.mnx",
      initialJson: SCORE_V1,
    });
    const sha = await adapter.commit("noop");
    expect(sha).toBeNull();
    const log = await adapter.log();
    expect(log).toHaveLength(1);
  });

  it("commit creates a new entry when score changes", async () => {
    const fs = new InMemoryFs();
    const adapter = await initRepo({
      fs,
      name: "p",
      scorePath: "score.mnx",
      initialJson: SCORE_V1,
    });
    await adapter.writeScore(SCORE_V2);
    const sha = await adapter.commit("Edit: Flute · added sequence");
    expect(typeof sha).toBe("string");
    const log = await adapter.log();
    expect(log).toHaveLength(2);
    expect(log[0].subject).toBe("Edit: Flute · added sequence");
    expect(log[1].subject).toBe("Initial draft");
  });

  it("readScoreAtCommit returns the historical content", async () => {
    const fs = new InMemoryFs();
    const adapter = await initRepo({
      fs,
      name: "p",
      scorePath: "score.mnx",
      initialJson: SCORE_V1,
    });
    await adapter.writeScore(SCORE_V2);
    await adapter.commit("v2");
    const log = await adapter.log();
    const v1 = await adapter.readScoreAtCommit(log[1].sha);
    expect(v1).toBe(SCORE_V1);
    const v2 = await adapter.readScoreAtCommit(log[0].sha);
    expect(v2).toBe(SCORE_V2);
  });

  it("status reflects dirty working tree", async () => {
    const fs = new InMemoryFs();
    const adapter = await initRepo({
      fs,
      name: "p",
      scorePath: "score.mnx",
      initialJson: SCORE_V1,
    });
    let s = await adapter.status();
    expect(s.dirty).toBe(false);
    expect(s.commitCount).toBe(1);
    await adapter.writeScore(SCORE_V2);
    s = await adapter.status();
    expect(s.dirty).toBe(true);
    expect(s.branch).toBe("main");
  });

  it("sets and reports the origin remote", async () => {
    const fs = new InMemoryFs();
    const adapter = await initRepo({
      fs,
      name: "p",
      scorePath: "score.mnx",
      initialJson: SCORE_V1,
    });

    expect((await adapter.status()).remoteUrl).toBeNull();

    await adapter.setRemoteUrl("origin", "https://github.com/peter/quartet.git");

    let status = await adapter.status();
    expect(status.remoteUrl).toBe("https://github.com/peter/quartet.git");
    expect(status.aheadCount).toBe(1);

    await adapter.writeScore(SCORE_V2);
    await adapter.commit("v2");

    status = await adapter.status();
    expect(status.aheadCount).toBe(2);
  });

  it("openRepo reopens a previously-initialised filesystem", async () => {
    const fs = new InMemoryFs();
    await initRepo({ fs, name: "p", scorePath: "score.mnx", initialJson: SCORE_V1 });
    const reopened = await openRepo({ fs, name: "p", scorePath: "score.mnx" });
    expect(reopened).toBeInstanceOf(GitProjectAdapter);
    const log = await reopened.log();
    expect(log).toHaveLength(1);
  });

  it("openRepo creates the initial commit for an unborn repository", async () => {
    const fs = new InMemoryFs();
    await git.init({ fs, dir: "/", defaultBranch: "main" });
    await fs.writeFile("/score.mnx", SCORE_V1);

    const opened = await openRepo({ fs, name: "p", scorePath: "score.mnx" });

    const log = await opened.log();
    expect(log).toHaveLength(1);
    expect(log[0].subject).toBe("Initial draft");
    expect(await git.resolveRef({ fs, dir: "/", ref: "HEAD" })).toBe(log[0].sha);
  });

  it("openRepo rejects a folder without a git repository", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/score.mnx", SCORE_V1);

    await expect(openRepo({ fs, name: "p", scorePath: "score.mnx" })).rejects.toThrow("No git repository at root of p");
  });

  it("openRepo rejects a repository with a malformed HEAD", async () => {
    const fs = new InMemoryFs();
    await git.init({ fs, dir: "/", defaultBranch: "main" });
    await fs.writeFile("/.git/HEAD", "not a symbolic ref\n");
    await fs.writeFile("/score.mnx", SCORE_V1);

    await expect(openRepo({ fs, name: "p", scorePath: "score.mnx" })).rejects.toThrow("No git repository at root of p");
  });

  it("openRepo does not overwrite an existing malformed branch ref", async () => {
    const fs = new InMemoryFs();
    await git.init({ fs, dir: "/", defaultBranch: "main" });
    await fs.writeFile("/.git/refs/heads/main", "not an object id\n");
    await fs.writeFile("/score.mnx", SCORE_V1);

    await expect(openRepo({ fs, name: "p", scorePath: "score.mnx" })).rejects.toThrow("No git repository at root of p");
    expect(await fs.readFile("/.git/refs/heads/main", { encoding: "utf8" })).toBe("not an object id\n");
  });
});

describe("synthesizeCommitMessage", () => {
  it("returns 'Initial draft' when there's no previous content", () => {
    const m = synthesizeCommitMessage(null, SCORE_V1);
    expect(m.subject).toBe("Initial draft");
    expect(m.empty).toBe(false);
  });

  it("marks empty when nothing changed", () => {
    const m = synthesizeCommitMessage(SCORE_V1, SCORE_V1);
    expect(m.empty).toBe(true);
  });

  it("produces a labelled message for a single change", () => {
    const m = synthesizeCommitMessage(SCORE_V1, SCORE_V2);
    expect(m.empty).toBe(false);
    expect(m.subject).toMatch(/^(Edit|Structure|Layout):/);
    expect(m.changeCount).toBeGreaterThan(0);
  });

  it("appends [auto] suffix when opts.auto is true", () => {
    const m = synthesizeCommitMessage(SCORE_V1, SCORE_V2, { auto: true });
    expect(m.subject).toMatch(/\[auto\]$/);
  });

  it("falls back to 'Save · …' for unparseable JSON", () => {
    const m = synthesizeCommitMessage("not json", SCORE_V1);
    expect(m.subject).toMatch(/^Save · /);
  });
});

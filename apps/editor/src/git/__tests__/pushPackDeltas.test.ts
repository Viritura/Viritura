/**
 * Push packfiles from the patched isomorphic-git (patches/isomorphic-git@*.patch)
 * delta-compress revised files, and native `git receive-pack` accepts them.
 */

import git, { type GitHttpRequest, type GitHttpResponse, type HttpClient } from "isomorphic-git";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryFs } from "../fs/inMemoryFs";

const DIR = "/repo";
const SCORE_PATH = "score.json";
const AUTHOR = { name: "Test", email: "test@example.com" };

function pktLine(text: string): string {
  return `${(text.length + 4).toString(16).padStart(4, "0")}${text}`;
}

async function collectBody(body: GitHttpRequest["body"]): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  if (body) for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Serves Git smart HTTP for receive-pack from a native bare repository. */
function receivePackHttp(bareDir: string, pushedPackBytes: number[]): HttpClient {
  return {
    async request({ url, method, body }: GitHttpRequest): Promise<GitHttpResponse> {
      let payload: Buffer;
      let contentType: string;
      if (method === "GET") {
        const advertisement = execFileSync("git", ["receive-pack", "--stateless-rpc", "--advertise-refs", bareDir]);
        payload = Buffer.concat([Buffer.from(`${pktLine("# service=git-receive-pack\n")}0000`), advertisement]);
        contentType = "application/x-git-receive-pack-advertisement";
      } else {
        const request = await collectBody(body);
        pushedPackBytes.push(request.length - request.indexOf("PACK"));
        payload = execFileSync("git", ["receive-pack", "--stateless-rpc", bareDir], {
          input: request,
        });
        contentType = "application/x-git-receive-pack-result";
      }
      return {
        url,
        method,
        statusCode: 200,
        statusMessage: "OK",
        headers: { "content-type": contentType },
        body: [new Uint8Array(payload)],
      };
    },
  };
}

/** Deterministic, poorly compressible score-sized text so deflate alone cannot hide full copies. */
function makeScore(lines: number): string[] {
  let seed = 0x9e3779b9;
  const result: string[] = [];
  for (let line = 0; line < lines; line++) {
    let text = "";
    for (let i = 0; i < 8; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      text += seed.toString(16).padStart(8, "0");
    }
    result.push(`{"line":${line},"data":"${text}"}`);
  }
  return result;
}

describe("push packfile delta compression", () => {
  let bareDir: string;
  let fs: InMemoryFs;
  let pushedPackBytes: number[];
  let http: HttpClient;
  let score: string[];

  beforeEach(async () => {
    bareDir = mkdtempSync(join(tmpdir(), "viritura-push-delta-"));
    execFileSync("git", ["init", "--bare", "--initial-branch=main", bareDir]);
    fs = new InMemoryFs();
    pushedPackBytes = [];
    http = receivePackHttp(bareDir, pushedPackBytes);
    score = makeScore(3000);
    await git.init({ fs, dir: DIR, defaultBranch: "main" });
    await git.addRemote({ fs, dir: DIR, remote: "origin", url: "https://example.test/score.git" });
  });

  afterEach(() => {
    rmSync(bareDir, { recursive: true, force: true });
  });

  async function commitRevision(line: number): Promise<string> {
    score[line] = `{"line":${line},"data":"revised ${line}"}`;
    await fs.writeFile(`${DIR}/${SCORE_PATH}`, score.join("\n"));
    await git.add({ fs, dir: DIR, filepath: SCORE_PATH });
    return git.commit({ fs, dir: DIR, message: `Revise ${line}`, author: AUTHOR });
  }

  async function push(): Promise<void> {
    const result = await git.push({ fs, http, dir: DIR, remote: "origin", ref: "main" });
    expect(result.ok).toBe(true);
  }

  function bareGit(...args: string[]): string {
    return execFileSync("git", ["--git-dir", bareDir, ...args], { encoding: "utf8" });
  }

  function expectRemoteMatches(head: string): void {
    expect(bareGit("rev-parse", "main").trim()).toBe(head);
    expect(bareGit("show", `main:${SCORE_PATH}`)).toBe(score.join("\n"));
    bareGit("fsck", "--strict", "--no-dangling");
  }

  it("deltas revisions against objects within the same pack", async () => {
    await commitRevision(0);
    const fullScoreBytes = Buffer.byteLength(score.join("\n"));
    for (let line = 1; line <= 10; line++) await commitRevision(line * 250);
    const head = await commitRevision(2999);

    await push();

    expect(pushedPackBytes[0]).toBeLessThan(fullScoreBytes * 0.75);
    expectRemoteMatches(head);
  });

  it("sends thin packs that delta against objects the remote already has", async () => {
    await commitRevision(0);
    await push();
    const firstPackBytes = pushedPackBytes[0];

    for (let line = 1; line <= 10; line++) await commitRevision(line * 250);
    const head = await commitRevision(2999);
    await push();

    expect(pushedPackBytes[1]).toBeLessThan(firstPackBytes / 20);
    expectRemoteMatches(head);
  });
});

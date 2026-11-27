import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { checkPagesReadiness, editorWorkerCheck } from "./wait-for-pages.ts";

const commit = "abc123";
const worker = "self.onmessage = () => {};";
const asset = {
  path: "/assets/layout.worker-hash.js",
  sha256: createHash("sha256").update(worker).digest("hex"),
};

function pagesResponses(marker: Response, script?: Response): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.endsWith(`/viritura-build-${commit}.txt`)) return marker;
    assert.ok(url.endsWith(asset.path));
    assert.ok(script, "unexpected worker request");
    return script;
  };
}

test("requires the correct marker and the exact JavaScript worker", async () => {
  const marker = () => new Response(commit);
  assert.equal(
    await checkPagesReadiness("https://example.test", commit, asset, pagesResponses(new Response("old"))),
    "build marker does not match",
  );
  assert.match(
    (await checkPagesReadiness(
      "https://example.test",
      commit,
      asset,
      pagesResponses(marker(), new Response("<html>", { headers: { "content-type": "text/html" } })),
    )) ?? "",
    /content type text\/html/,
  );
  assert.match(
    (await checkPagesReadiness(
      "https://example.test",
      commit,
      asset,
      pagesResponses(
        marker(),
        new Response("missing", { status: 404, headers: { "content-type": "text/javascript" } }),
      ),
    )) ?? "",
    /HTTP 404/,
  );
  assert.equal(
    await checkPagesReadiness(
      "https://example.test",
      commit,
      asset,
      pagesResponses(marker(), new Response("wrong", { headers: { "content-type": "application/javascript" } })),
    ),
    "worker content does not match the deployed artifact",
  );
  assert.equal(
    await checkPagesReadiness(
      "https://example.test",
      commit,
      asset,
      pagesResponses(marker(), new Response(worker, { headers: { "content-type": "text/javascript; charset=utf-8" } })),
    ),
    null,
  );
  assert.equal(await checkPagesReadiness("https://example.test", commit, undefined, pagesResponses(marker())), null);
});

test("selects the worker from the built artifact and rejects ambiguous builds", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "viritura-pages-"));
  try {
    mkdirSync(resolve(directory, "assets"));
    assert.throws(() => editorWorkerCheck(directory), /found 0/);
    writeFileSync(resolve(directory, `.${asset.path}`), worker);
    assert.deepEqual(editorWorkerCheck(directory), asset);
    writeFileSync(resolve(directory, "assets", "layout.worker-other.js"), worker);
    assert.throws(() => editorWorkerCheck(directory), /found 2/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

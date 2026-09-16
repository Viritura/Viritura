import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pins source fixes and exports instead of patching generated JavaScript", async () => {
  const [buildScript, enginePatch, metadataText, processor, wrapperPatch] = await Promise.all([
    readFile(path.join(root, "vendor", "build-sfizz.ps1"), "utf8"),
    readFile(path.join(root, "vendor", "patches", "sfizz-filedata-move.patch"), "utf8"),
    readFile(path.join(root, "vendor", "sfizz-runtime.json"), "utf8"),
    readFile(path.join(root, "src", "sfizzProcessor.js"), "utf8"),
    readFile(path.join(root, "vendor", "patches", "sfizz-webaudio.patch"), "utf8"),
  ]);
  const metadata = JSON.parse(metadataText);

  assert.equal(metadata.emsdkVersion, "3.1.31");
  assert.equal(metadata.sfizzWebaudioCommit, "41f08e6974c48f3f424509d37cd78631596cacfb");
  assert.equal(metadata.sfizzCommit, "0b3aaa8cedb0d732fb15820db7eda2c841657d2d");
  assert.equal((enginePatch.match(/^\+\s*preloadCallCount = other\.preloadCallCount;$/gm) ?? []).length, 2);
  assert.match(wrapperPatch, /^\+\s*bool load\(std::string file\)$/m);
  assert.match(wrapperPatch, /^\+\s*bool loadAtPath\(std::string path, std::string file\)$/m);
  assert.match(wrapperPatch, /EXPORTED_FUNCTIONS=\['?_malloc'?,'?_free'?\]/);
  assert.match(wrapperPatch, /EXPORTED_RUNTIME_METHODS=\['?FS'?/);
  assert.doesNotMatch(wrapperPatch, /^\+\s*load\("<region> sample=\*saw"\);$/m);
  assert.doesNotMatch(processor, /separateBootstrapLoadPath|wrapperBootstrapPath|isolatedBootstrapPath|HEAPU8/);
  assert.match(processor, /this\.synth\.loadAtPath\(sfzPath, message\.sfz\)/);
  assert.match(buildScript, /external\/abseil-cpp/);
  assert.doesNotMatch(buildScript, /fetch-sfizz-artifact|raw\.githubusercontent\.com.*build\/sfizz\.wasm\.js/);
  assert.doesNotMatch(buildScript, /"reset",\s*"--hard"|"clean",\s*"-ffd"|"checkout".*"--force"|Remove-Item/);
});

test("local generated runtime matches pinned source-build metadata when present", async (context) => {
  const metadata = JSON.parse(await readFile(path.join(root, "vendor", "sfizz-runtime.json"), "utf8"));
  let artifact;
  try {
    artifact = await readFile(path.join(root, "vendor", metadata.artifact));
  } catch (error) {
    if (error.code === "ENOENT") {
      context.skip("generated runtime is intentionally ignored");
      return;
    }
    throw error;
  }
  assert.equal(artifact.byteLength, metadata.artifactBytes);
  assert.equal(createHash("sha256").update(artifact).digest("hex").toUpperCase(), metadata.artifactSha256);
});

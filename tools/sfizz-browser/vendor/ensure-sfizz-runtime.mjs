import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const metadata = JSON.parse(await readFile(path.join(directory, "sfizz-runtime.json"), "utf8"));
const artifactPath = path.join(directory, metadata.artifact);
const buildScript = path.join(directory, "build-sfizz.ps1");

async function artifactMatches() {
  try {
    const bytes = await readFile(artifactPath);
    const hash = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    return bytes.byteLength === metadata.artifactBytes && hash === metadata.artifactSha256;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function runSourceBuild() {
  if (process.platform !== "win32") {
    throw new Error(`Build the missing runtime with PowerShell: ${buildScript}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn("pwsh", ["-NoLogo", "-NoProfile", "-File", buildScript], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`sfizz source build failed with exit code ${code}`));
      }
    });
  });
}

export async function ensureSfizzRuntime() {
  if (await artifactMatches()) {
    return;
  }
  console.log("Building the pinned sfizz WebAssembly runtime from source.");
  await runSourceBuild();
  if (!(await artifactMatches())) {
    throw new Error("The source-built sfizz runtime does not match its pinned metadata.");
  }
}

if (import.meta.main) {
  await ensureSfizzRuntime();
  console.log(`sfizz runtime ready: ${artifactPath}`);
}

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

interface AssetCheck {
  path: string;
  sha256: string;
}

export function editorWorkerCheck(directory: string): AssetCheck {
  const assets = resolve(directory, "assets");
  const workers = readdirSync(assets).filter((name) => /^layout\.worker-[\w-]+\.js$/.test(name));
  if (workers.length !== 1) {
    throw new Error(`Expected exactly one layout worker in ${assets}, found ${workers.length}`);
  }
  const name = workers[0];
  return {
    path: `/assets/${name}`,
    sha256: createHash("sha256")
      .update(readFileSync(resolve(assets, name)))
      .digest("hex"),
  };
}

export async function checkPagesReadiness(
  baseUrl: string,
  commit: string,
  asset: AssetCheck | undefined,
  fetchPage: typeof fetch = fetch,
): Promise<string | null> {
  const marker = await fetchPage(`${baseUrl}/viritura-build-${commit}.txt`, { signal: AbortSignal.timeout(5_000) });
  if (!marker.ok || (await marker.text()).trim() !== commit) return "build marker does not match";
  if (!asset) return null;

  const response = await fetchPage(`${baseUrl}${asset.path}`, { signal: AbortSignal.timeout(5_000) });
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!response.ok || (contentType !== "application/javascript" && contentType !== "text/javascript")) {
    return `worker returned HTTP ${response.status} with content type ${contentType ?? "(missing)"}`;
  }
  const actualHash = createHash("sha256")
    .update(Buffer.from(await response.arrayBuffer()))
    .digest("hex");
  return actualHash === asset.sha256 ? null : "worker content does not match the deployed artifact";
}

async function main(): Promise<void> {
  const [baseUrl, target, directory, commit] = process.argv.slice(2);
  if (!baseUrl || (target !== "editor" && target !== "website") || !directory || !commit) {
    throw new Error("Usage: node scripts/wait-for-pages.ts <url> <editor|website> <build-directory> <commit>");
  }
  const asset = target === "editor" ? editorWorkerCheck(directory) : undefined;
  const deadline = Date.now() + 60_000;
  let reason = "not checked";
  while (Date.now() < deadline) {
    try {
      const result = await checkPagesReadiness(baseUrl.replace(/\/$/, ""), commit, asset);
      if (result === null) {
        console.log(`${baseUrl} is serving build ${commit}${asset ? ` and ${asset.path}` : ""}.`);
        return;
      }
      reason = result;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    console.log(`Waiting for ${baseUrl}: ${reason}`);
    await sleep(Math.min(5_000, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`${baseUrl} did not publish build ${commit} within 60 seconds: ${reason}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

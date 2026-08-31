#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256, parseJson, type MnxSchemaSourceLock } from "./mnx-schema-provenance";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const upstreamRepo = resolve(repoRoot, process.env["MNX_REPO"] ?? "../mnx");
const upstreamRef = process.env["MNX_REF"] ?? "origin/main";
const upstreamPath = "docs/mnx-schema.json";

function git(...args: string[]): string {
  return execFileSync("git", ["-C", upstreamRepo, ...args], { encoding: "utf8" }).trim();
}

const upstreamCommit = git("rev-parse", `${upstreamRef}^{commit}`);
const upstreamBlob = git("rev-parse", `${upstreamRef}:${upstreamPath}`);
const schemaText = execFileSync("git", ["-C", upstreamRepo, "show", `${upstreamRef}:${upstreamPath}`], {
  encoding: "utf8",
});
const schema = parseJson(schemaText, `${upstreamRef}:${upstreamPath}`);
if (schema === null || Array.isArray(schema) || typeof schema !== "object" || typeof schema["$id"] !== "string") {
  throw new Error("Upstream MNX schema is missing its string $id");
}

const lock: MnxSchemaSourceLock = {
  upstreamRepository: "https://github.com/w3c-cg/mnx",
  upstreamCommit,
  upstreamPath,
  upstreamBlob,
  schemaId: schema["$id"],
  canonicalSha256: canonicalSha256(schema),
};
writeFileSync(join(repoRoot, "packages/format/schemas/mnx-schema.json"), schemaText, "utf8");
writeFileSync(
  join(repoRoot, "packages/format/schemas/mnx-schema-source.json"),
  `${JSON.stringify(lock, null, 2)}\n`,
  "utf8",
);
console.log(`Synced MNX schema from ${upstreamCommit} (${upstreamBlob}).`);

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSourceLock, canonicalSha256, parseJson } from "./mnx-schema-provenance";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = join(repoRoot, "packages/format/schemas/mnx-schema.json");
const lockPath = join(repoRoot, "packages/format/schemas/mnx-schema-source.json");
const schema = parseJson(readFileSync(schemaPath, "utf8"), "Vendored MNX schema");
const lock = parseJson(readFileSync(lockPath, "utf8"), "MNX schema source lock");
assertSourceLock(lock);

const schemaId = schema !== null && !Array.isArray(schema) && typeof schema === "object" ? schema["$id"] : undefined;
const checksum = canonicalSha256(schema);
const failures: string[] = [];
if (schemaId !== lock.schemaId) failures.push(`schema $id is ${JSON.stringify(schemaId)}, expected ${lock.schemaId}`);
if (checksum !== lock.canonicalSha256) {
  failures.push(`canonical SHA-256 is ${checksum}, expected ${lock.canonicalSha256}`);
}

if (failures.length > 0) {
  console.error("Vendored MNX schema does not match its upstream source lock:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("Run `pnpm mnx:schema:sync` to update the schema and provenance lock from the MNX repository.");
  process.exit(1);
}

console.log(`MNX schema matches ${lock.upstreamCommit.slice(0, 12)} (${lock.schemaId}).`);

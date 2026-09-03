#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { fetchUpstreamSnapshot } from "./upstream";
import { updateAuditMarkdown } from "./update";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const auditPath = resolve(repoRoot, "docs/spec/music-notationref-coverage.md");
const args = process.argv.slice(2);
const write = args.includes("--write");
const revisionIndex = args.indexOf("--viritura-revision");
const virituraRevision = revisionIndex >= 0 ? args[revisionIndex + 1] : undefined;
if (revisionIndex >= 0 && !virituraRevision) throw new Error("--viritura-revision requires a commit SHA.");
if (virituraRevision && !/^[0-9a-f]{40}$/.test(virituraRevision)) {
  throw new Error("--viritura-revision must be a full 40-character commit SHA.");
}

const currentMarkdown = await readFile(auditPath, "utf8");
const snapshot = await fetchUpstreamSnapshot();
const today = new Date().toISOString().slice(0, 10);
const result = updateAuditMarkdown(currentMarkdown, snapshot, { today, virituraRevision });
const formatted = await format(result.markdown, { filepath: auditPath });
const changed = formatted.replace(/\r\n/g, "\n") !== currentMarkdown.replace(/\r\n/g, "\n");

console.log(JSON.stringify(result.report, null, 2));
const reviewCount =
  result.report.added.length +
  result.report.removed.length +
  result.report.renamed.length +
  result.report.moved.length +
  result.report.upstreamStatusChanged.length +
  result.report.matrixMissingIds.mnx.length +
  result.report.matrixMissingIds.musicXml.length;
if (write && changed) {
  await writeFile(auditPath, formatted, "utf8");
  console.log(`Updated ${auditPath}.`);
} else if (write) {
  console.log("Notationref audit is already current; no file was written.");
} else if (changed) {
  console.log("Audit update available; rerun with --write after reviewing the report.");
} else {
  console.log("Notationref audit is already current.");
}
if (reviewCount > 0) {
  console.warn(`REVIEW REQUIRED: ${reviewCount} taxonomy or upstream-status changes need assessment.`);
}

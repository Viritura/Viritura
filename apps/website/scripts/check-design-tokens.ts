import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(fileURLToPath(import.meta.url), "../..");
const sourceRoot = resolve(websiteRoot, "src");
const sourceExtensions = new Set([".css", ".ts", ".tsx"]);
const violations: string[] = [];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

for (const path of sourceFiles(sourceRoot)) {
  const sourcePath = relative(websiteRoot, path).replaceAll("\\", "/");
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.includes("var(--hm-")) {
      violations.push(`${sourcePath}:${index + 1} consumes a deprecated --hm-* token`);
    }
    if (/^\s*--(?:marketing|docs|mnx-hub)-[\w-]+\s*:/.test(line)) {
      violations.push(`${sourcePath}:${index + 1} defines a route-local design token`);
    }
    if (line.includes("--hm-") && sourcePath !== "src/index.css") {
      violations.push(`${sourcePath}:${index + 1} declares or documents a deprecated --hm-* token`);
    }
  });
}

if (violations.length > 0) {
  console.error("Website design token policy failed:\n" + violations.map((violation) => `- ${violation}`).join("\n"));
  process.exit(1);
}

console.log("Website design token policy passed.");

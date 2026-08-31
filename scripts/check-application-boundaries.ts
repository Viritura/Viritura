import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface PackageManifest {
  contributes?: unknown;
  engines?: { vscode?: string };
  scripts?: Record<string, string>;
}

const STORYBOOK_LIBRARY_EXCEPTIONS = new Map([
  ["packages/ui", "Reusable design-system library owns the UI Storybook."],
]);

function findFiles(root: string, name: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "target") return [];
    const child = resolve(root, entry.name);
    if (entry.isDirectory()) return findFiles(child, name);
    return entry.name === name ? [child] : [];
  });
}

export function findApplicationBoundaryViolations(repoRoot: string): string[] {
  const packagesRoot = resolve(repoRoot, "packages");
  const violations: string[] = [];

  for (const config of findFiles(packagesRoot, "tauri.conf.json")) {
    violations.push(`${relative(repoRoot, config)} is a Tauri application manifest`);
  }

  for (const manifestPath of findFiles(packagesRoot, "package.json")) {
    const packageRoot = dirname(manifestPath);
    const packagePath = relative(repoRoot, packageRoot).replaceAll("\\", "/");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
    const scripts = Object.values(manifest.scripts ?? {});

    if (manifest.engines?.vscode || manifest.contributes) {
      violations.push(`${packagePath}/package.json is a VS Code extension manifest`);
    }

    const hasViteAppCommand = scripts.some((script) => /(^|\s|&&)vite(?:\s|$)/.test(script));
    const hasViteAppEntry = existsSync(resolve(packageRoot, "index.html"));
    if (hasViteAppCommand && hasViteAppEntry) {
      violations.push(`${packagePath}/package.json defines a deployable Vite application`);
    }

    const hasStorybook = scripts.some((script) => /(^|\s)storybook(?:\s|$)/.test(script));
    if (hasStorybook && !STORYBOOK_LIBRARY_EXCEPTIONS.has(packagePath)) {
      violations.push(`${packagePath}/package.json owns Storybook without an explicit library exception`);
    }
  }

  return violations;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = findApplicationBoundaryViolations(repoRoot);
  if (violations.length > 0) {
    console.error("Deployable application manifests must live under apps/:\n");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log("Application boundary check passed.");
  }
}

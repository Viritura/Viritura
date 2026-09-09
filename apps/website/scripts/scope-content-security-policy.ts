import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";

const wasmRoutes = new Set(["mnx/mxl-converter/index.html", "mnx/playground/index.html"]);
const monacoRoutes = new Set(["mnx/playground/index.html"]);

function removeSource(directive: string, source: string): string {
  return directive
    .split(/\s+/)
    .filter((token) => token !== source)
    .join(" ");
}

export function scopeContentSecurityPolicy(html: string, route: string): string {
  return html.replace(
    /(<meta\s+http-equiv="content-security-policy"\s+content=")([^"]+)(">)/i,
    (_, opening: string, policy: string, closing: string) => {
      const directives = policy.split(";").map((directive) => directive.trim());
      const scoped = directives.map((directive) => {
        if (directive.startsWith("script-src ") && !wasmRoutes.has(route)) {
          return removeSource(directive, "'wasm-unsafe-eval'");
        }
        if (directive.startsWith("style-src-elem ") && !monacoRoutes.has(route)) {
          return removeSource(directive, "'unsafe-inline'");
        }
        return directive;
      });
      return `${opening}${scoped.join(";")}${closing}`;
    },
  );
}

export function scopeBuiltContentSecurityPolicies(distPath: string): void {
  const htmlFiles = readdirSync(distPath, { recursive: true, withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".html"),
  );
  for (const file of htmlFiles) {
    const path = resolve(file.parentPath, file.name);
    const route = relative(distPath, path).replaceAll("\\", "/");
    const html = readFileSync(path, "utf8");
    writeFileSync(path, scopeContentSecurityPolicy(html, route));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  scopeBuiltContentSecurityPolicies(resolve(import.meta.dirname, "../dist"));
}

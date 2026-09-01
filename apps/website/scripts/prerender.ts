import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyRouteMetadata, type SeoRoute } from "../src/seo";

interface StaticRenderer {
  renderRoute(url: string): Promise<{ html: string; injectedHtml: string }>;
  sitemapRoutes: readonly SeoRoute[];
  staticRoutes: readonly SeoRoute[];
}

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(websiteRoot, "dist");
const staticBundleRoot = resolve(websiteRoot, "dist-static");
const staticBundleUrl = pathToFileURL(resolve(staticBundleRoot, "entry-static.js")).href;
const renderer = (await import(staticBundleUrl)) as StaticRenderer;
const templatePath = resolve(outputRoot, "index.html");
const template = await readFile(templatePath, "utf8");

function outputFile(route: SeoRoute): string {
  if (route.outputPath) return resolve(outputRoot, route.outputPath);
  if (route.path === "/") return templatePath;
  return resolve(outputRoot, route.path.slice(1), "index.html");
}

function removeClientScripts(html: string): string {
  return html
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, "")
    .replace(/\s*<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g, "");
}

for (const route of renderer.staticRoutes) {
  const { html: appHtml, injectedHtml } = await renderer.renderRoute(route.renderPath ?? route.path);
  if (!/<h1(?:\s|>)/.test(appHtml)) throw new Error(`${route.path} did not prerender an h1.`);

  const withContent = template
    .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
    .replace("</body>", `${injectedHtml}</body>`);
  if (withContent === template) throw new Error("Could not find the root mount point in the Vite HTML output.");

  const destination = outputFile(route);
  await mkdir(dirname(destination), { recursive: true });
  const outputHtml = applyRouteMetadata(withContent, route);
  await writeFile(destination, route.outputPath ? removeClientScripts(outputHtml) : outputHtml);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${renderer.sitemapRoutes
  .map((route) => `  <url><loc>${new URL(route.canonicalPath, "https://viritura.com").href}</loc></url>`)
  .join("\n")}
</urlset>
`;

await writeFile(resolve(outputRoot, "sitemap.xml"), sitemap);
await writeFile(
  resolve(outputRoot, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: https://viritura.com/sitemap.xml\n",
);
await rm(staticBundleRoot, { recursive: true, force: true });

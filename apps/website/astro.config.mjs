import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { containerWatchOptions } from "../../infra/dev/viteWatch.ts";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { SITE_ORIGIN, sitemapRoutes } from "./src/seo/routeCatalog.ts";
import { DOC_PAGE_META } from "./src/routes/docs/docPageMeta.ts";

function externalizeLargeSoundfont() {
  return {
    name: "viritura-externalize-large-soundfont",
    closeBundle() {
      if (process.env.VIRITURA_EXTERNAL_SOUNDFONT !== "true") return;
      rmSync(resolve(import.meta.dirname, "dist/sounds/Shan-SGM-Pro-15.sf2"), { force: true });
    },
  };
}

/** Last commit timestamp for a repo-relative file, or `undefined` if git history isn't available. */
function gitLastModified(repoRelativePath) {
  try {
    const repoRoot = resolve(import.meta.dirname, "../..");
    const iso = execFileSync("git", ["log", "-1", "--format=%cI", "--", repoRelativePath], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    return iso || undefined;
  } catch {
    return undefined;
  }
}

const containerHost = process.env.VIRITURA_CONTAINER_HOST;
const allowedSitemapUrls = new Set(
  sitemapRoutes.map((route) => new URL(route.canonicalPath, SITE_ORIGIN).href.replace(/\/$/, "")),
);
// Doc pages are single-source markdown files, so their last commit date is a
// meaningful `lastmod`. Other routes span multiple components/data sources,
// so we leave their `lastmod` unset rather than pick one arbitrary file.
const docLastModByUrl = new Map(
  DOC_PAGE_META.map((page) => [
    new URL(`/docs/${page.slug}`, SITE_ORIGIN).href.replace(/\/$/, ""),
    gitLastModified(page.file),
  ]),
);

export default defineConfig({
  site: SITE_ORIGIN,
  server: {
    port: 5180,
    host: containerHost ? true : undefined,
    open: !containerHost,
  },
  integrations: [
    react(),
    sitemap({
      filter: (page) => allowedSitemapUrls.has(page.replace(/\/$/, "")),
      serialize(item) {
        const lastmod = docLastModByUrl.get(item.url.replace(/\/$/, ""));
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
  vite: {
    plugins: [externalizeLargeSoundfont()],
    oxc: { target: "es2022" },
    build: {
      target: "es2022",
      sourcemap: false,
      cssCodeSplit: false,
    },
    optimizeDeps: {
      esbuildOptions: { target: "es2022" },
    },
    server: {
      strictPort: true,
      allowedHosts: containerHost ? [".localhost"] : undefined,
      hmr: containerHost ? { host: containerHost, clientPort: 80, protocol: "ws" } : undefined,
      watch: containerWatchOptions(containerHost),
    },
  },
});

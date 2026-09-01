import { describe, expect, it } from "vitest";
import { DOC_PAGES } from "../routes/docs/docsManifest";
import { sitemapRoutes, staticRoutes } from "./routeCatalog";

describe("SEO route catalog", () => {
  it("contains each route only once", () => {
    const paths = staticRoutes.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps the MusicXML converter under the MNX tooling namespace", () => {
    const paths = staticRoutes.map((route) => route.path);
    expect(paths).toContain("/mnx/mxl-converter");
    expect(paths).not.toContain("/mnx-converter");
  });

  it("keeps every documentation page in the sitemap", () => {
    const sitemapPaths = new Set(sitemapRoutes.map((route) => route.path));
    for (const page of DOC_PAGES) expect(sitemapPaths.has(`/docs/${page.slug}`), page.slug).toBe(true);
  });

  it("excludes account and error routes from the sitemap", () => {
    expect(sitemapRoutes.every((route) => route.indexable)).toBe(true);
    expect(sitemapRoutes.some((route) => route.path.startsWith("/auth/") || route.path.startsWith("/signup"))).toBe(
      false,
    );
    expect(sitemapRoutes.some((route) => route.path === "/404")).toBe(false);
  });
});

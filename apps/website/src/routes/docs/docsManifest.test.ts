import { describe, expect, it } from "vitest";
import { DOC_SECTION_ROOTS, type DocSection } from "./docPageMeta";
import {
  DOC_PAGES,
  docPagesInSection,
  docSectionHome,
  docSectionRouteParams,
  findDocPageInSection,
} from "./docsManifest";

const SECTIONS = Object.keys(DOC_SECTION_ROOTS) as DocSection[];

describe("documentation sections", () => {
  it("gives every page a unique slug and path", () => {
    expect(new Set(DOC_PAGES.map((page) => page.slug)).size).toBe(DOC_PAGES.length);
    expect(new Set(DOC_PAGES.map((page) => page.path)).size).toBe(DOC_PAGES.length);
  });

  it("serves each section's landing page at its root", () => {
    expect(docSectionHome("guide").path).toBe("/docs");
    expect(docSectionHome("developers").path).toBe("/developers");
  });

  it("keeps every page under its section root", () => {
    for (const section of SECTIONS) {
      const root = DOC_SECTION_ROOTS[section];
      for (const page of docPagesInSection(section)) {
        expect(page.path === root || page.path.startsWith(`${root}/`), page.path).toBe(true);
      }
    }
  });

  it("routes every non-landing page and resolves it back", () => {
    for (const section of SECTIONS) {
      const params = docSectionRouteParams(section);
      expect(params).toHaveLength(docPagesInSection(section).length - 1);
      for (const { params: route } of params) {
        expect(route.slug).not.toContain("/");
        expect(findDocPageInSection(section, route.slug)?.section).toBe(section);
      }
    }
  });

  it("names developer slugs the way the client router derives them", () => {
    expect(docSectionHome("developers").slug).toBe("developers");
    for (const { params } of docSectionRouteParams("developers")) {
      expect(findDocPageInSection("developers", params.slug)?.slug).toBe(`developers/${params.slug}`);
    }
  });
});

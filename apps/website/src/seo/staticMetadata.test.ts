import { describe, expect, it } from "vitest";
import { applyRouteMetadata } from "./staticMetadata";
import type { SeoRoute } from "./routeCatalog";

const route: SeoRoute = {
  path: "/example",
  title: "Example & Test",
  description: 'A useful "example" page.',
  canonicalPath: "/example",
  indexable: true,
};

const template = `<!doctype html><html><head><title>Default</title><meta name="description" content="Default" /></head><body></body></html>`;

describe("static route metadata", () => {
  it("replaces defaults and inserts canonical indexing metadata", () => {
    const html = applyRouteMetadata(template, route);

    expect(html).toContain("<title>Example &amp; Test</title>");
    expect(html).toContain('content="A useful &quot;example&quot; page."');
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    expect(html).toContain('<link rel="canonical" href="https://viritura.com/example" />');
  });

  it("fails when the Vite template no longer contains replaceable defaults", () => {
    expect(() => applyRouteMetadata("<html><head></head><body></body></html>", route)).toThrow(
      "Expected exactly one <title> for /example.",
    );
  });
});

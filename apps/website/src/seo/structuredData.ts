import { SITE_ORIGIN, canonicalUrl, type SeoRoute } from "./routeCatalog";

/** Minimal JSON-LD shape shared by the schema.org objects this site emits. */
export type JsonLd = Record<string, unknown>;

/** `SoftwareApplication` schema for the homepage. */
export function softwareApplicationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Viritura",
    url: SITE_ORIGIN,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    description:
      "Write, revise, review, and publish in one connected music notation workspace built around an open score format.",
  };
}

/** `TechArticle` schema for a documentation page. */
export function techArticleJsonLd(route: SeoRoute): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: route.title,
    description: route.description,
    url: canonicalUrl(route),
    isPartOf: {
      "@type": "WebSite",
      name: "Viritura Documentation",
      url: new URL("/docs/getting-started", SITE_ORIGIN).href,
    },
  };
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

/** `BreadcrumbList` schema built from an ordered list of `{ name, path }` crumbs. */
export function breadcrumbJsonLd(items: readonly BreadcrumbItem[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: new URL(item.path, SITE_ORIGIN).href,
    })),
  };
}

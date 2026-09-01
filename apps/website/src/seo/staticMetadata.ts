import { canonicalUrl, type SeoRoute } from "./routeCatalog";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function countMatches(html: string, pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

export function applyRouteMetadata(html: string, route: SeoRoute): string {
  const canonical = canonicalUrl(route);
  const robots = route.indexable ? "index, follow" : "noindex, nofollow";
  const output = html
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(route.title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/>/s,
      `<meta name="description" content="${escapeHtml(route.description)}" />`,
    )
    .replace(
      "</head>",
      `    <meta name="robots" content="${robots}" />\n    <link rel="canonical" href="${canonical}" />\n  </head>`,
    );

  const expectedTags = [
    [/<title>[^<]*<\/title>/g, `<title> for ${route.path}`],
    [/<meta\s+name="description"\s+content="[^"]*"\s*\/>/g, `description for ${route.path}`],
    [/<meta\s+name="robots"\s+content="[^"]*"\s*\/>/g, `robots directive for ${route.path}`],
    [/<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/g, `canonical URL for ${route.path}`],
  ] as const;
  const head = output.match(/<head>[\s\S]*?<\/head>/)?.[0];
  if (!head) throw new Error(`Missing <head> for ${route.path}.`);

  for (const [pattern, label] of expectedTags) {
    if (countMatches(head, pattern) !== 1) throw new Error(`Expected exactly one ${label}.`);
  }
  if (!head.includes(`<title>${escapeHtml(route.title)}</title>`))
    throw new Error(`Incorrect title for ${route.path}.`);
  if (!head.includes(`content="${escapeHtml(route.description)}"`)) {
    throw new Error(`Incorrect description for ${route.path}.`);
  }
  if (!head.includes(`content="${robots}"`)) throw new Error(`Incorrect robots directive for ${route.path}.`);
  if (!head.includes(`href="${canonical}"`)) throw new Error(`Incorrect canonical URL for ${route.path}.`);

  return output;
}

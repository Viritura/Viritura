/**
 * Markdown → HTML rendering for the docs site.
 *
 * Source markdown lives in `docs/` and is authored by us (no user input), so
 * rendering the `marked` output via `dangerouslySetInnerHTML` is safe — there is
 * no untrusted HTML to sanitize. We post-process to inject heading ids so
 * `/docs/<slug>#<heading>` deep links resolve, and to build an on-page
 * table of contents from the `##`/`###` headings.
 */

import { marked } from "marked";

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface RenderedDoc {
  html: string;
  toc: TocEntry[];
  embeds: readonly DocEmbed[];
}

interface DocEmbed {
  id: string;
}

export interface ModifierKeyLabels {
  primary: "Ctrl" | "Cmd";
  alternate: "Alt" | "Option";
}

const DEFAULT_MODIFIER_KEYS: ModifierKeyLabels = { primary: "Ctrl", alternate: "Alt" };

marked.setOptions({ gfm: true, breaks: false });

const EXCLUDED_BLOCK_RE = /<!--\s*docs-site:exclude-start\s*-->[\s\S]*?<!--\s*docs-site:exclude-end\s*-->/gi;
const INTERACTIVE_BLOCK_RE = /:::interactive\s+id="([a-zA-Z0-9._-]+)"\s*\r?\n:::/g;
const AVAILABILITY_ALERT_RE =
  /<blockquote>\s*<p>\[!(?:NOTE|IMPORTANT)\]\s*<strong>Availability:\s*([^<]+)<\/strong>\s*<\/p>\s*([\s\S]*?)<\/blockquote>/g;

/** Slugify heading text into a stable anchor id. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&[a-z]+;/g, " ") // strip HTML entities (e.g. &amp;)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Use the platform's primary and alternate modifier names in rendered docs. */
export function getModifierKeyLabels(): ModifierKeyLabels {
  if (typeof navigator === "undefined") return DEFAULT_MODIFIER_KEYS;
  const apple = /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
  return apple ? { primary: "Cmd", alternate: "Option" } : DEFAULT_MODIFIER_KEYS;
}

/** Convert a doc's markdown to HTML + a heading table of contents. */
export function renderDoc(markdown: string, modifierKeys: ModifierKeyLabels = DEFAULT_MODIFIER_KEYS): RenderedDoc {
  const embeds: DocEmbed[] = [];
  const publicMarkdown = markdown.replace(EXCLUDED_BLOCK_RE, "").replace(INTERACTIVE_BLOCK_RE, (_match, id: string) => {
    embeds.push({ id });
    return `\n<div data-doc-embed="${id}" aria-label="Interactive example"></div>\n`;
  });
  const rawHtml = (marked.parse(publicMarkdown, { async: false }) as string)
    .replace(/Ctrl\/Cmd/g, modifierKeys.primary)
    .replace(/\bMod\b/g, modifierKeys.primary)
    .replace(/\bAlt\b/g, modifierKeys.alternate)
    .replace(
      AVAILABILITY_ALERT_RE,
      '<aside class="docs-availability"><div class="docs-availability-label"><span>Availability</span>$1</div><div class="docs-availability-body">$2</div></aside>',
    );
  const toc: TocEntry[] = [];
  const usedIds = new Set<string>();

  // Inject ids on h2/h3 (the levels the docs use for sections) and collect TOC.
  const html = rawHtml.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_match: string, levelStr: string, inner: string) => {
    const level = Number(levelStr) as 2 | 3;
    const explicitId = inner.match(/\s*\{#([\w-]+)\}\s*$/)?.[1];
    const visibleInner = explicitId ? inner.replace(/\s*\{#[\w-]+\}\s*$/, "") : inner;
    const text = visibleInner.replace(/<[^>]+>/g, "").trim();
    let id = explicitId ?? slugify(text);
    // De-dupe repeated headings so anchors stay unique.
    let n = 2;
    const base = id;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    toc.push({ id, text, level });
    return `<h${level} id="${id}">${visibleInner}</h${level}>`;
  });

  return { html, toc, embeds };
}

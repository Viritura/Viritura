/**
 * Docs page metadata — slug, title, group, and source file for every page of
 * the user guide (`/docs`) and the developer documentation (`/developers`),
 * without importing the markdown content itself. Kept separate from
 * {@link ./docsManifest} (which pairs this metadata with `?raw` markdown
 * imports) so build-time tooling such as `astro.config.mjs` — which cannot
 * process Vite's `?raw` query — can still resolve a slug to its source file
 * (for example, to compute sitemap `lastmod` from git history).
 */

export type DocSection = "guide" | "developers";

export interface DocPageMeta {
  /** Stable content identifier, unique across sections. */
  slug: string;
  /** Public URL path. */
  path: string;
  /** Sidebar + page title. */
  title: string;
  /** Documentation site section; the sidebar and pager stay within it. */
  section: DocSection;
  /** Sidebar group heading. */
  group: string;
  /** Source markdown path, relative to the repo root. */
  file: string;
}

export const DOC_SECTION_LABELS: Readonly<Record<DocSection, string>> = {
  guide: "Documentation",
  developers: "Developers",
};

/** URL prefix of each section; its landing page is served at the prefix itself. */
export const DOC_SECTION_ROOTS: Readonly<Record<DocSection, string>> = {
  guide: "/docs",
  developers: "/developers",
};

const GUIDE_PAGES: readonly Omit<DocPageMeta, "section">[] = [
  {
    slug: "getting-started",
    path: "/docs",
    title: "Getting Started",
    group: "Start",
    file: "docs/guide/getting-started.md",
  },
  {
    slug: "instruments-and-scores",
    path: "/docs/instruments-and-scores",
    title: "Scores, Parts & Layouts",
    group: "Create",
    file: "docs/guide/instruments-and-scores.md",
  },
  {
    slug: "percussion-maps",
    path: "/docs/percussion-maps",
    title: "Percussion Maps",
    group: "Create",
    file: "docs/guide/percussion-maps.md",
  },
  {
    slug: "note-entry",
    path: "/docs/note-entry",
    title: "Note Entry",
    group: "Create",
    file: "docs/guide/note-entry.md",
  },
  {
    slug: "chord-symbols",
    path: "/docs/chord-symbols",
    title: "Chord Symbols",
    group: "Create",
    file: "docs/guide/chord-symbols.md",
  },
  {
    slug: "lyrics",
    path: "/docs/lyrics",
    title: "Lyrics",
    group: "Create",
    file: "docs/guide/lyrics.md",
  },
  {
    slug: "notation-and-editing",
    path: "/docs/notation-and-editing",
    title: "Notation & Editing",
    group: "Create",
    file: "docs/guide/notation-and-editing.md",
  },
  {
    slug: "engraving-and-layout",
    path: "/docs/engraving-and-layout",
    title: "Engraving & Layout",
    group: "Shape & Hear",
    file: "docs/guide/engraving-and-layout.md",
  },
  {
    slug: "playback-and-piano-roll",
    path: "/docs/playback-and-piano-roll",
    title: "Playback, Mixer & Piano Roll",
    group: "Shape & Hear",
    file: "docs/guide/playback-and-piano-roll.md",
  },
  {
    slug: "scoring-to-picture",
    path: "/docs/scoring-to-picture",
    title: "Scoring to Picture",
    group: "Shape & Hear",
    file: "docs/guide/scoring-to-picture.md",
  },
  {
    slug: "collaboration",
    path: "/docs/collaboration",
    title: "Collaboration",
    group: "Share & Finish",
    file: "docs/guide/collaboration.md",
  },
  { slug: "mcp", path: "/docs/mcp", title: "MCP", group: "Share & Finish", file: "docs/guide/mcp.md" },
  {
    slug: "viewing-and-review",
    path: "/docs/viewing-and-review",
    title: "Viewing & Review",
    group: "Share & Finish",
    file: "docs/guide/viewing-and-review.md",
  },
  {
    slug: "publishing-and-export",
    path: "/docs/publishing-and-export",
    title: "Publishing & Export",
    group: "Share & Finish",
    file: "docs/guide/publishing-and-export.md",
  },
  {
    slug: "settings-and-import",
    path: "/docs/settings-and-import",
    title: "Settings & Import",
    group: "Reference",
    file: "docs/guide/settings-and-import.md",
  },
  {
    slug: "keyboard-shortcuts",
    path: "/docs/keyboard-shortcuts",
    title: "Keyboard & Mouse",
    group: "Reference",
    file: "docs/spec/keyboard-shortcuts.md",
  },
];

const DEVELOPER_PAGES: readonly Omit<DocPageMeta, "section">[] = [
  {
    slug: "developers",
    path: "/developers",
    title: "Overview",
    group: "Start",
    file: "docs/developers/overview.md",
  },
  {
    slug: "developers/score-viewer-react",
    path: "/developers/score-viewer-react",
    title: "Score Viewer React",
    group: "Packages",
    file: "docs/developers/score-viewer-react.md",
  },
  {
    slug: "developers/score-viewer",
    path: "/developers/score-viewer",
    title: "Score Viewer",
    group: "Packages",
    file: "docs/developers/score-viewer.md",
  },
  {
    slug: "developers/score-engine",
    path: "/developers/score-engine",
    title: "Score Engine",
    group: "Packages",
    file: "docs/developers/score-engine.md",
  },
];

export const DOC_PAGE_META: readonly DocPageMeta[] = [
  ...GUIDE_PAGES.map((page) => ({ ...page, section: "guide" as const })),
  ...DEVELOPER_PAGES.map((page) => ({ ...page, section: "developers" as const })),
];

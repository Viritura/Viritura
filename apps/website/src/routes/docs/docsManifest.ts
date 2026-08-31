/**
 * Docs manifest — the single nav tree for the `/docs` site.
 *
 * Each page is a markdown file under `docs/` (repo root), imported `?raw` and
 * bundled at build time, then rendered by {@link ./DocsPage}. Markdown is the
 * single source of truth: the same files render on GitHub, drive this site, and
 * (for keyboard-shortcuts.md) feed the in-app Help dialog. To add a page, drop a
 * markdown file under `docs/guide/` and add a row here.
 */

import gettingStarted from "../../../../../docs/guide/getting-started.md?raw";
import instrumentsAndScores from "../../../../../docs/guide/instruments-and-scores.md?raw";
import percussionMaps from "../../../../../docs/guide/percussion-maps.md?raw";
import noteEntry from "../../../../../docs/guide/note-entry.md?raw";
import notationAndEditing from "../../../../../docs/guide/notation-and-editing.md?raw";
import engravingAndLayout from "../../../../../docs/guide/engraving-and-layout.md?raw";
import playbackAndPianoRoll from "../../../../../docs/guide/playback-and-piano-roll.md?raw";
import scoringToPicture from "../../../../../docs/guide/scoring-to-picture.md?raw";
import collaboration from "../../../../../docs/guide/collaboration.md?raw";
import mcp from "../../../../../docs/guide/mcp.md?raw";
import viewingAndReview from "../../../../../docs/guide/viewing-and-review.md?raw";
import publishingAndExport from "../../../../../docs/guide/publishing-and-export.md?raw";
import settingsAndImport from "../../../../../docs/guide/settings-and-import.md?raw";
import keyboardShortcuts from "../../../../../docs/spec/keyboard-shortcuts.md?raw";

export interface DocPage {
  /** URL slug: `/docs/<slug>`. */
  slug: string;
  /** Sidebar + page title. */
  title: string;
  /** Sidebar group heading. */
  group: string;
  /** Raw markdown source. */
  raw: string;
}

export const DOC_PAGES: readonly DocPage[] = [
  { slug: "getting-started", title: "Getting Started", group: "Start", raw: gettingStarted },
  {
    slug: "instruments-and-scores",
    title: "Scores, Parts & Layouts",
    group: "Create",
    raw: instrumentsAndScores,
  },
  { slug: "percussion-maps", title: "Percussion Maps", group: "Create", raw: percussionMaps },
  { slug: "note-entry", title: "Note Entry", group: "Create", raw: noteEntry },
  { slug: "notation-and-editing", title: "Notation & Editing", group: "Create", raw: notationAndEditing },
  {
    slug: "engraving-and-layout",
    title: "Engraving & Layout",
    group: "Shape & Hear",
    raw: engravingAndLayout,
  },
  {
    slug: "playback-and-piano-roll",
    title: "Playback, Mixer & Piano Roll",
    group: "Shape & Hear",
    raw: playbackAndPianoRoll,
  },
  {
    slug: "scoring-to-picture",
    title: "Scoring to Picture",
    group: "Shape & Hear",
    raw: scoringToPicture,
  },
  { slug: "collaboration", title: "Collaboration", group: "Share & Finish", raw: collaboration },
  { slug: "mcp", title: "MCP", group: "Share & Finish", raw: mcp },
  { slug: "viewing-and-review", title: "Viewing & Review", group: "Share & Finish", raw: viewingAndReview },
  {
    slug: "publishing-and-export",
    title: "Publishing & Export",
    group: "Share & Finish",
    raw: publishingAndExport,
  },
  { slug: "settings-and-import", title: "Settings & Import", group: "Reference", raw: settingsAndImport },
  { slug: "keyboard-shortcuts", title: "Keyboard & Mouse", group: "Reference", raw: keyboardShortcuts },
];

/** Ordered, de-duplicated group names in first-seen order. */
export const DOC_GROUPS: readonly string[] = DOC_PAGES.reduce<string[]>((groups, page) => {
  if (!groups.includes(page.group)) groups.push(page.group);
  return groups;
}, []);

/** Look up a page by slug. */
export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}

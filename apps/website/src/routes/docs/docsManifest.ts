/**
 * Docs manifest — the single nav tree for the `/docs` site.
 *
 * Each page is a markdown file under `docs/` (repo root), imported `?raw` and
 * bundled at build time, then rendered by {@link ./DocsPage}. Markdown is the
 * single source of truth: the same files render on GitHub, drive this site, and
 * (for keyboard-shortcuts.md) feed the in-app Help dialog. To add a page, drop a
 * markdown file under `docs/guide/`, add a row to {@link ./docPageMeta}, and add
 * the matching `?raw` import below.
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
import { DOC_PAGE_META, type DocPageMeta } from "./docPageMeta";

/** Raw markdown source, keyed by slug (mirrors {@link DOC_PAGE_META} order). */
const rawBySlug: Readonly<Record<string, string>> = {
  "getting-started": gettingStarted,
  "instruments-and-scores": instrumentsAndScores,
  "percussion-maps": percussionMaps,
  "note-entry": noteEntry,
  "notation-and-editing": notationAndEditing,
  "engraving-and-layout": engravingAndLayout,
  "playback-and-piano-roll": playbackAndPianoRoll,
  "scoring-to-picture": scoringToPicture,
  collaboration,
  mcp,
  "viewing-and-review": viewingAndReview,
  "publishing-and-export": publishingAndExport,
  "settings-and-import": settingsAndImport,
  "keyboard-shortcuts": keyboardShortcuts,
};

export interface DocPage extends DocPageMeta {
  /** Raw markdown source. */
  raw: string;
}

export const DOC_PAGES: readonly DocPage[] = DOC_PAGE_META.map((meta) => {
  const raw = rawBySlug[meta.slug];
  if (raw === undefined) throw new Error(`Missing markdown import for doc page "${meta.slug}".`);
  return { ...meta, raw };
});

/** Ordered, de-duplicated group names in first-seen order. */
export const DOC_GROUPS: readonly string[] = DOC_PAGES.reduce<string[]>((groups, page) => {
  if (!groups.includes(page.group)) groups.push(page.group);
  return groups;
}, []);

/** Look up a page by slug. */
export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}

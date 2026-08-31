/**
 * Pagination snapshot helpers for Engrave Mode.
 *
 * MNX represents per-score pagination as `ScoreDefinition.pages[].systems[]`,
 * where each system is a forced break point (start of system) at a measure id,
 * and pages are sequences of systems. The semantics are all-or-nothing: when
 * any pagination is authored for a score, the snapshot must enumerate every
 * system boundary the engine should honor.
 *
 * These helpers convert between the MNX-shaped `pages[]` structure and a
 * flatter `Snapshot` form that's easier for UI/mutations to manipulate.
 */
import type { PageDefinition, ScoreDefinition, SystemDefinition } from "./layout";

/** A single system entry in a flat snapshot. */
export interface PaginationEntry {
  /** Measure id where the system starts. */
  measure: string;
  /** Optional layout override for this system. */
  layout?: string;
  /** True when this entry also begins a new page. */
  pageBreak: boolean;
}

/** Flat representation of all forced system/page breaks in one score view. */
export interface PaginationSnapshot {
  /** Ordered system-start entries. The first entry implicitly starts page 0. */
  entries: PaginationEntry[];
}

/** Empty snapshot — score uses fully automatic pagination. */
export function emptySnapshot(): PaginationSnapshot {
  return { entries: [] };
}

/**
 * Extract the current pagination snapshot from a `ScoreDefinition`.
 * Returns an empty snapshot if no `pages[]` are authored.
 */
export function extractSnapshot(score: ScoreDefinition): PaginationSnapshot {
  if (!score.pages || score.pages.length === 0) return emptySnapshot();

  const entries: PaginationEntry[] = [];
  for (let pi = 0; pi < score.pages.length; pi++) {
    const page = score.pages[pi]!;
    for (let si = 0; si < page.systems.length; si++) {
      const sys = page.systems[si]!;
      entries.push({
        measure: sys.measure,
        ...(sys.layout ? { layout: sys.layout } : {}),
        pageBreak: si === 0 && pi > 0,
      });
    }
  }
  return { entries };
}

/**
 * Build a `pages[]` array from a flat snapshot. Returns `undefined` when
 * the snapshot has no entries (caller should clear `score.pages`).
 *
 * The first entry always starts page 0 regardless of its `pageBreak` flag.
 * Subsequent entries with `pageBreak === true` start new pages; others
 * extend the current page.
 */
export function snapshotToPages(snap: PaginationSnapshot): PageDefinition[] | undefined {
  if (snap.entries.length === 0) return undefined;

  const pages: PageDefinition[] = [{ systems: [] }];
  for (let i = 0; i < snap.entries.length; i++) {
    const entry = snap.entries[i]!;
    const sys: SystemDefinition = { measure: entry.measure };
    if (entry.layout) sys.layout = entry.layout;

    if (i > 0 && entry.pageBreak) {
      pages.push({ systems: [sys] });
    } else {
      pages[pages.length - 1]!.systems.push(sys);
    }
  }
  return pages;
}

/** Insert or update a forced break at a measure id. Idempotent. */
export function insertBreak(
  snap: PaginationSnapshot,
  measureId: string,
  kind: "system" | "page",
  layout?: string,
): PaginationSnapshot {
  const entries = snap.entries.slice();
  const idx = entries.findIndex((e) => e.measure === measureId);
  const next: PaginationEntry = {
    measure: measureId,
    pageBreak: kind === "page",
    ...(layout ? { layout } : {}),
  };
  if (idx >= 0) {
    entries[idx] = next;
  } else {
    // Insert in measure-id order if caller provides a comparable string;
    // otherwise append. For numeric m1, m2, … ids this works lexically when
    // padded but not in general. We append and let the caller order via
    // `sortSnapshot` if the document uses non-monotonic ids.
    entries.push(next);
  }
  return { entries };
}

/** Remove a forced break at a measure id. Idempotent. */
export function clearBreak(snap: PaginationSnapshot, measureId: string): PaginationSnapshot {
  return { entries: snap.entries.filter((e) => e.measure !== measureId) };
}

/**
 * Re-order a snapshot's entries to match the provided measure-id order.
 * Entries whose measure is not in `order` are dropped (they no longer
 * exist in the document).
 */
export function sortSnapshot(snap: PaginationSnapshot, order: readonly string[]): PaginationSnapshot {
  const rank = new Map<string, number>();
  order.forEach((id, i) => rank.set(id, i));
  const entries = snap.entries
    .filter((e) => rank.has(e.measure))
    .slice()
    .sort((a, b) => rank.get(a.measure)! - rank.get(b.measure)!);
  return { entries };
}

/**
 * Apply a snapshot to a score definition, returning a new score with
 * `pages` set (or unset, if the snapshot is empty).
 */
export function applySnapshot(score: ScoreDefinition, snap: PaginationSnapshot): ScoreDefinition {
  const pages = snapshotToPages(snap);
  const next: ScoreDefinition = { ...score };
  if (pages) next.pages = pages;
  else delete next.pages;
  return next;
}

import type { Score } from "@viritura/core";

/** Compute the implicit system starts for a score by reading the live engine
 * display list. Returns one `{measure, pageBreak}` entry per system in
 * top-to-bottom order.
 *
 * `pageBreak` is ALWAYS `false`: the seed captures only where SYSTEMS begin, not
 * where pages do. Page boundaries in the live display list come from the
 * auto-pagination / page-turn optimizer; freezing them into the authored
 * `pages[]` makes them hard forced breaks that go stale the moment the user adds
 * a system break, leaving sparse half-empty pages and inflating the page count.
 * By seeding system starts only, the explicit-pages path keeps the user's system
 * layout but RE-paginates freely (dense, well-filled pages). Explicit page
 * breaks the user adds later are still honoured — they enter the snapshot via
 * `insertBreak(kind: "page")`, not through this seed. */
export function defaultSystemStarts(
  score: Score,
  displayList: {
    measureBounds?: { measureId?: string; partIndex: number; staffIndex?: number; systemIndex?: number; x: number }[];
    pages?: { pageNumber: number; systemIndices: number[] }[];
  } | null,
): { measure: string; pageBreak: boolean }[] {
  const mbs = displayList?.measureBounds;
  if (mbs && mbs.length > 0) {
    // Pick min-x measureId per systemIndex — this is the first measure of
    // each system. Order by systemIndex (top-to-bottom).
    const firstBySys = new Map<number, { measureId: string; x: number }>();
    for (const mb of mbs) {
      const si = mb.systemIndex ?? 0;
      if (!mb.measureId) continue;
      const cur = firstBySys.get(si);
      if (!cur || mb.x < cur.x) firstBySys.set(si, { measureId: mb.measureId, x: mb.x });
    }
    if (firstBySys.size > 0) {
      return [...firstBySys.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, v]) => ({
          measure: v.measureId,
          pageBreak: false,
        }));
    }
  }
  const first = score.global.measures[0]?.id;
  return first ? [{ measure: first, pageBreak: false }] : [];
}

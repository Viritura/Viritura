/**
 * staffVisibilityMutations — engrave-mode hide/show staff on per-system
 * basis. Derives layouts on demand and garbage-collects unreferenced ones.
 *
 * Extracted from ScoreMutations.ts to keep that file under the lint cap.
 */

import type { LayoutContent, Score, ScoreDefinition, Sequence, SequenceContent } from "@viritura/core";
import {
  applySnapshot,
  ensureDerivedLayout,
  extractSnapshot,
  isRest,
  pruneUnusedDerivedLayouts,
  sortSnapshot,
} from "@viritura/core";
import { measureOrder, withScoreDef } from "./scoreDefHelpers";

/** Set of every layout id referenced anywhere in the score (across all score defs). */
export function collectReferencedLayoutIds(score: Score): Set<string> {
  const ids = new Set<string>();
  for (const sd of score.scores ?? []) {
    if (sd.layout) ids.add(sd.layout);
    for (const page of sd.pages ?? []) {
      for (const sys of page.systems) {
        if (sys.layout) ids.add(sys.layout);
        for (const lc of sys.layoutChanges ?? []) ids.add(lc.layout);
      }
    }
  }
  return ids;
}

/**
 * Resolve the effective layout id at a given system, honoring MNX's
 * "system.layout overrides from that system onward" semantics.
 *
 * The target system need NOT be materialised in `pages[].systems[]` — for
 * non-materialised systems we walk back through measure order to find the
 * most recent materialised system entry with an explicit `layout`. This is
 * how a hide authored on system 3 is reported as still in effect on the
 * engine-computed (auto-flow) systems 4, 5, 6, etc. that aren't themselves
 * in the snapshot.
 */
function effectiveLayoutAtSystem(
  sd: ScoreDefinition,
  systemMeasureId: string,
  measureOrderList: readonly string[],
): string | undefined {
  const baseId = sd.layout;
  const allSystems = (sd.pages ?? []).flatMap((p) => p.systems);
  if (allSystems.length === 0) return baseId;

  const targetIdx = measureOrderList.indexOf(systemMeasureId);
  if (targetIdx < 0) return baseId;

  let inherited: string | undefined;
  for (const sys of allSystems) {
    const sysIdx = measureOrderList.indexOf(sys.measure);
    if (sysIdx < 0 || sysIdx > targetIdx) continue;
    if (sys.layout) inherited = sys.layout;
  }
  return inherited ?? baseId;
}

/** Collect the set of part ids referenced by any staff node in `content`. */
function collectPartIdsInLayout(content: LayoutContent[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: LayoutContent[]) => {
    for (const n of nodes) {
      if (n.type === "staff") for (const s of n.sources) ids.add(s.part);
      else walk(n.content);
    }
  };
  walk(content);
  return ids;
}

/**
 * Compute the set of hidden parts on a system by diffing the system's
 * effective layout against the score's base layout. Returns an empty set
 * when no parts are hidden or when layouts cannot be resolved.
 */
export function hiddenPartsOnSystem(score: Score, scoreIndex: number, systemMeasureId: string): Set<string> {
  const sd = score.scores?.[scoreIndex];
  if (!sd) return new Set();
  const baseId = sd.layout;
  if (!baseId) return new Set();
  const effectiveId =
    effectiveLayoutAtSystem(
      sd,
      systemMeasureId,
      score.global.measures.map((m) => m.id ?? ""),
    ) ?? baseId;
  if (effectiveId === baseId) return new Set();

  const base = score.layouts?.find((l) => l.id === baseId);
  const effective = score.layouts?.find((l) => l.id === effectiveId);
  if (!base || !effective) return new Set();

  const basePresent = collectPartIdsInLayout(base.content);
  const effectivePresent = collectPartIdsInLayout(effective.content);
  const hidden = new Set<string>();
  for (const id of basePresent) if (!effectivePresent.has(id)) hidden.add(id);
  return hidden;
}

/**
 * Ordered list of base-layout part ids (top-to-bottom). Used to compute
 * ghost-rail groupings for hidden staves on a system.
 */
export function basePartOrder(score: Score, scoreIndex: number): string[] {
  const sd = score.scores?.[scoreIndex];
  if (!sd?.layout) return [];
  const base = score.layouts?.find((l) => l.id === sd.layout);
  if (!base) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (nodes: LayoutContent[]) => {
    for (const n of nodes) {
      if (n.type === "staff") {
        for (const s of n.sources) {
          if (!seen.has(s.part)) {
            seen.add(s.part);
            out.push(s.part);
          }
        }
      } else {
        walk(n.content);
      }
    }
  };
  walk(base.content);
  return out;
}

/**
 * Resolve a part id → the full set of part ids that share the same
 * LayoutStaff entry in the base layout. For a condensed staff (e.g. one
 * staff with sources [Fl1, Fl2]), passing either Fl1 or Fl2 returns both.
 * For a non-condensed staff it returns just the singleton. If the part
 * id is not in the base layout at all, returns just [partId] so callers
 * can fall back gracefully.
 *
 * Engrave staff-visibility hides whole *staves*, not individual voices on
 * a condensed staff — empty-staff hiding is the intended use case, and
 * leaving half a condensed staff visible produces a confusing intermediate
 * state. Voice-level operations belong to the (future) condensing UI.
 */
function partIdsOnSameStaff(score: Score, scoreIndex: number, partId: string): string[] {
  const sd = score.scores?.[scoreIndex];
  if (!sd?.layout) return [partId];
  const base = score.layouts?.find((l) => l.id === sd.layout);
  if (!base) return [partId];
  let found: string[] | null = null;
  const walk = (nodes: LayoutContent[]) => {
    for (const n of nodes) {
      if (found) return;
      if (n.type === "staff") {
        if (n.sources.some((s) => s.part === partId)) {
          found = n.sources.map((s) => s.part);
          return;
        }
      } else {
        walk(n.content);
      }
    }
  };
  walk(base.content);
  return found ?? [partId];
}

/**
 * Group consecutive hidden parts on a system into ghost-rail entries.
 * Each group represents a stretch of one or more hidden staves between two
 * visible staves (or at the top/bottom edge of the system). The canvas uses
 * these to draw a single rail per group instead of one per hidden staff.
 */
export interface GhostRailGroup {
  /** Stable id for React keys — `${systemMeasureId}|${first}-${last}`. */
  id: string;
  /** Hidden part ids in base-layout (top-to-bottom) order. */
  partIds: string[];
  /**
   * Hidden part ids grouped by the base-layout staff they share. A
   * non-condensed staff yields a singleton inner array; a condensed
   * staff (e.g. Fl 1 + Fl 2 sharing one staff) yields a multi-id inner
   * array. UI surfaces one popover row per inner array because
   * visibility operates on whole staves, not individual sources.
   */
  staffGroups: string[][];
  /**
   * Parallel to `staffGroups`: true if the hidden range for that staff group
   * contains real music (notes/rests beyond whole-measure rests). Used by
   * the UI to differentiate "hidden empty staff" (blue) from "hidden staff
   * with music" (red + warning).
   */
  staffGroupHasMusic: boolean[];
  /** Visible part id directly above this run, or null if at the top edge. */
  aboveVisiblePartId: string | null;
  /** Visible part id directly below this run, or null if at the bottom edge. */
  belowVisiblePartId: string | null;
}

/** Build a map of partId -> stable staff key for the base layout. */
function buildStaffKeyByPart(base: { content: LayoutContent[] } | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!base) return map;
  let staffCounter = 0;
  const walk = (nodes: LayoutContent[]) => {
    for (const n of nodes) {
      if (n.type === "staff") {
        const key = `s${staffCounter++}`;
        for (const s of n.sources) map.set(s.part, key);
      } else {
        walk(n.content);
      }
    }
  };
  walk(base.content);
  return map;
}

/** Collapse a run of hidden part ids into sub-runs sharing the same staff key. */
function groupRunByStaff(run: string[], staffKeyByPart: Map<string, string>): string[][] {
  const out: string[][] = [];
  let lastKey: string | null = null;
  for (const pid of run) {
    const k = staffKeyByPart.get(pid) ?? pid;
    if (k === lastKey) {
      out[out.length - 1]!.push(pid);
    } else {
      out.push([pid]);
      lastKey = k;
    }
  }
  return out;
}

export function ghostRailGroupsOnSystem(score: Score, scoreIndex: number, systemMeasureId: string): GhostRailGroup[] {
  const order = basePartOrder(score, scoreIndex);
  if (order.length === 0) return [];
  const hidden = hiddenPartsOnSystem(score, scoreIndex, systemMeasureId);
  if (hidden.size === 0) return [];

  const sd = score.scores?.[scoreIndex];
  const base = score.layouts?.find((l) => l.id === sd?.layout);
  const staffKeyByPart = buildStaffKeyByPart(base);

  const musicByGroups = (sgs: string[][]): boolean[] =>
    sgs.map((arr) => arr.some((pid) => hiddenRangeHasMusic(score, scoreIndex, systemMeasureId, pid)));

  const groups: GhostRailGroup[] = [];
  let run: string[] = [];
  let aboveVisible: string | null = null;
  for (const pid of order) {
    if (hidden.has(pid)) {
      run.push(pid);
      continue;
    }
    if (run.length > 0) {
      const sgs = groupRunByStaff(run, staffKeyByPart);
      groups.push({
        id: `${systemMeasureId}|${run[0]}-${run[run.length - 1]}`,
        partIds: run,
        staffGroups: sgs,
        staffGroupHasMusic: musicByGroups(sgs),
        aboveVisiblePartId: aboveVisible,
        belowVisiblePartId: pid,
      });
      run = [];
    }
    aboveVisible = pid;
  }
  if (run.length > 0) {
    const sgs = groupRunByStaff(run, staffKeyByPart);
    groups.push({
      id: `${systemMeasureId}|${run[0]}-${run[run.length - 1]}`,
      partIds: run,
      staffGroups: sgs,
      staffGroupHasMusic: musicByGroups(sgs),
      aboveVisiblePartId: aboveVisible,
      belowVisiblePartId: null,
    });
  }
  return groups;
}

/** Returns true if hiding `nextHidden` would leave NO visible staves on this base layout. */
function wouldEmptyTheSystem(baseLayout: { content: LayoutContent[] }, nextHidden: Set<string>): boolean {
  const presentParts = collectPartIdsInLayout(baseLayout.content);
  const remaining = [...presentParts].filter((p) => !nextHidden.has(p));
  return remaining.length === 0;
}

/**
 * Hide or show a staff (by part id) for the system that begins at
 * `systemMeasureId` in the active score. Generates or reuses a derived
 * layout, swaps the system's `layout` reference, and garbage-collects
 * derived layouts that nothing references anymore.
 *
 * The system must already exist in `pages[].systems[]` — call
 * `insertBreakInScore` first if needed to materialize the snapshot.
 */
export function setStaffVisibilityInScore(
  score: Score,
  scoreIndex: number,
  systemMeasureId: string,
  partId: string,
  visible: boolean,
): Score {
  const sd = score.scores?.[scoreIndex];
  if (!sd?.pages || !sd.layout) return score;

  const baseId = sd.layout;
  const currentlyHidden = hiddenPartsOnSystem(score, scoreIndex, systemMeasureId);
  const nextHidden = new Set(currentlyHidden);
  // Staff-visibility operates on whole staves. For condensed staves
  // (multiple sources sharing one LayoutStaff) we toggle every part on
  // that staff together — leaving half a condensed staff visible
  // produces an unusable intermediate state.
  const staffPartIds = partIdsOnSameStaff(score, scoreIndex, partId);
  if (visible) {
    for (const id of staffPartIds) nextHidden.delete(id);
  } else {
    for (const id of staffPartIds) nextHidden.add(id);
  }

  // Guard: refuse to hide every staff in a system. An empty layout would
  // produce a blank system with phantom barlines and confuse the engine.
  if (!visible) {
    const baseLayout = score.layouts?.find((l) => l.id === baseId);
    if (baseLayout && wouldEmptyTheSystem(baseLayout, nextHidden)) {
      // No-op: would hide every visible staff.
      return score;
    }
  }

  let layouts = score.layouts ? score.layouts.slice() : [];
  const ensured = ensureDerivedLayout(layouts, baseId, nextHidden);
  layouts = ensured.layouts;
  const newLayoutId = ensured.layoutId;

  // Update the system's layout reference. We always SET an explicit `layout`
  // (even when it equals the base) — dropping it would let an upstream
  // `system.layout` override silently leak through via MNX inheritance, and
  // a "show this hidden staff" toggle would have no effect.
  const newScores = score.scores!.map((s, i) => {
    if (i !== scoreIndex) return s;
    return {
      ...s,
      pages: s.pages!.map((page) => ({
        ...page,
        systems: page.systems.map((sys) => {
          if (sys.measure !== systemMeasureId) return sys;
          return { ...sys, layout: newLayoutId };
        }),
      })),
    };
  });

  // Garbage-collect orphaned derived layouts. We must include refs from
  // ALL score definitions, not just the one we edited — `score.layouts`
  // is global and a derived layout may still be referenced by another
  // score's pagination snapshot.
  const referenced = collectReferencedLayoutIds({ ...score, scores: newScores });
  layouts = pruneUnusedDerivedLayouts(layouts, referenced);

  return { ...score, layouts, scores: newScores };
}

/**
 * Toggle staff visibility on a system, materialising just enough of
 * `pages[].systems[]` to anchor the layout override on the target system.
 *
 * Only the target system is added to the snapshot. All other system
 * boundaries stay on engine auto-flow so that subsequent content edits
 * (and reflow across pages) work normally — we deliberately do NOT
 * materialise every engine-computed system, because doing so would
 * convert auto-flow boundaries (especially page breaks) into forced
 * breaks and lock page geometry.
 *
 * Cross-system staff state (e.g. last clef) is recovered engine-side:
 * when a part is hidden through the target system, the engine scans
 * backward from the visible m_start to find the most recent explicit
 * clef. See ``test_clef_inherited_when_hidden_from_start`` and
 * ``test_clef_inherited_after_staff_unhidden`` in the Rust tests.
 *
 * `computedSystemStarts` is retained for signature compatibility (some
 * call-sites still pass it) but is no longer used.
 *
 * The optional `fromMeasureIndex` is reserved for a future v2 that
 * supports mid-system visibility changes (divisi / ossia / cue staves).
 * v1 ignores it and always treats the change as starting at the first
 * measure of the system.
 */
export function applyStaffVisibilityFromSystem(
  score: Score,
  scoreIndex: number,
  systemMeasureId: string,
  partId: string,
  visible: boolean,
  computedSystemStarts: readonly { measure: string; pageBreak: boolean }[],
  _fromMeasureIndex?: number,
): Score {
  void computedSystemStarts;
  let next = withScoreDef(score, scoreIndex, (sd) => {
    const snap = extractSnapshot(sd);
    if (snap.entries.some((e) => e.measure === systemMeasureId)) {
      // Target already materialised (existing user-authored break or
      // prior visibility action). Nothing to seed.
      return sd;
    }
    const merged = {
      entries: [...snap.entries, { measure: systemMeasureId, pageBreak: false }],
    };
    return applySnapshot(sd, sortSnapshot(merged, measureOrder(score)));
  });
  next = setStaffVisibilityInScore(next, scoreIndex, systemMeasureId, partId, visible);
  return next;
}

/** Recursively walks a sequence, returning true if it contains any non-rest event. */
function sequenceHasMusic(content: readonly SequenceContent[]): boolean {
  for (const item of content) {
    if (item.type === "event") {
      if (!isRest(item)) return true;
    } else if (item.type === "tuplet" || item.type === "tremolo") {
      if (sequenceHasMusic(item.content as SequenceContent[])) return true;
    } else if (item.type === "grace") {
      // Grace events are notated music — flag them too.
      return true;
    }
  }
  return false;
}

/**
 * Returns true if hiding `partId` over the contiguous range [systemMeasureId,
 * end-of-staying-hidden) would conceal user-authored music. Empty bars and
 * whole rests do not count. v1 scope: walks from `systemMeasureId` through
 * the end of all subsequent systems whose effective layout would inherit the
 * change (i.e. until the next user-overridden system).
 */
export function wouldHideMusic(score: Score, scoreIndex: number, fromSystemMeasureId: string, partId: string): boolean {
  return hiddenRangeHasMusic(score, scoreIndex, fromSystemMeasureId, partId);
}

/**
 * Returns true if the part's measures from `fromSystemMeasureId` through the
 * end of the current layout-inheritance range contain real music (not just
 * whole-measure rests). Used both as the "would hiding this suppress music?"
 * preview for visible staves and as the "is this hidden staff carrying
 * music?" indicator for ghost rails.
 */
export function hiddenRangeHasMusic(
  score: Score,
  scoreIndex: number,
  fromSystemMeasureId: string,
  partId: string,
): boolean {
  const sd = score.scores?.[scoreIndex];
  if (!sd) return false;
  const part = score.parts.find((p) => p.id === partId);
  if (!part) return false;
  const measureOrderList = score.global.measures.map((m) => m.id ?? "");
  const fromIdx = measureOrderList.indexOf(fromSystemMeasureId);
  if (fromIdx < 0) return false;

  // Find end measure: first system after fromSystemMeasureId that has its own
  // explicit layout override (which would terminate the inheritance chain).
  const allSystems = (sd.pages ?? []).flatMap((p) => p.systems);
  let endIdx = measureOrderList.length;
  let foundFrom = false;
  for (const sys of allSystems) {
    if (!foundFrom) {
      if (sys.measure === fromSystemMeasureId) foundFrom = true;
      continue;
    }
    if (sys.layout) {
      const i = measureOrderList.indexOf(sys.measure);
      if (i > fromIdx) {
        endIdx = i;
        break;
      }
    }
  }

  for (let i = fromIdx; i < endIdx; i++) {
    const pm = part.measures[i];
    if (!pm?.sequences) continue;
    for (const seq of pm.sequences as Sequence[]) {
      if (sequenceHasMusic(seq.content ?? [])) return true;
    }
  }
  return false;
}

/**
 * Per-score instrument membership.
 *
 * In MNX a part exists in `parts[]` independently of any score; a score
 * "contains" an instrument only insofar as that part appears in the staff
 * `sources` of the score's `layout`. This module reads and edits that
 * derived membership:
 *
 *  - {@link collectConductorScores}    list multi-part scores —
 *                                      the valid targets for adding an instrument.
 *  - {@link collectPartIdsInLayout}    part ids referenced by a layout tree.
 *  - {@link scoreLayoutContainsPart}   membership test for one score.
 *  - {@link addPartToScoreLayout}      add an existing part's staff to a layout.
 *  - {@link removePartFromScoreLayout} remove a part's staff from a layout
 *                                      (the part itself stays in the document).
 *
 * These deliberately do NOT touch `parts[]`, `global`, or the per-part extract
 * score — they only edit the layout tree that defines what a conductor score
 * renders. Adding/removing whole instruments lives in `instrumentMutations`.
 */

import type { Score, LayoutContent, LayoutGroup, LayoutStaff, ScoreDefinition, Part } from "@viritura/core";
import { FAMILY_META, getCatalogInstrument, type InstrumentFamily } from "./InstrumentCatalog";
import { appendStaffToFullScoreContent, buildStaffNodeForPart, removePartFromContent } from "./instrumentMutations";

/** A multi-part score — a valid target for adding an instrument. */
export interface ConductorScore {
  /** Index into `score.scores`. */
  index: number;
  /** The layout id this score renders. */
  layoutId: string;
  /** Display name. */
  name: string;
  /** Number of staves currently in the layout. */
  staffCount: number;
}

/** Resolve the layout id a score definition renders (top-level or first page). */
function scoreLayoutId(sd: ScoreDefinition): string | undefined {
  return sd.layout ?? sd.pages?.[0]?.systems?.[0]?.layout;
}

/** Count leaf staff nodes in a layout content tree. */
/** Total number of staves rendered by a layout subtree. */
function countStaves(content: readonly LayoutContent[]): number {
  let n = 0;
  for (const node of content) {
    if (node.type === "group") n += countStaves((node as LayoutGroup).content);
    else n++;
  }
  return n;
}

/** Collect every part id referenced by a layout content tree. */
export function collectPartIdsInLayout(content: readonly LayoutContent[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly LayoutContent[]) => {
    for (const node of nodes) {
      if (node.type === "group") walk((node as LayoutGroup).content);
      else for (const s of (node as LayoutStaff).sources) if (s.part) ids.add(s.part);
    }
  };
  walk(content);
  return ids;
}

/**
 * List the conductor scores — those whose layout references more than one part.
 * These are the scores that can meaningfully gain or lose an instrument; a
 * multi-staff layout sourcing only one part (for example piano) is still a part
 * extract and is excluded.
 */
export function collectConductorScores(score: Score): ConductorScore[] {
  const layouts = score.layouts ?? [];
  const out: ConductorScore[] = [];
  const scores = score.scores ?? [];
  for (let i = 0; i < scores.length; i++) {
    const sd = scores[i]!;
    const layoutId = scoreLayoutId(sd);
    if (!layoutId) continue;
    const layout = layouts.find((l) => l.id === layoutId);
    if (!layout) continue;
    const staffCount = countStaves(layout.content);
    if (collectPartIdsInLayout(layout.content).size <= 1) continue;
    out.push({ index: i, layoutId, name: sd.name ?? layoutId, staffCount });
  }
  return out;
}

/** Whether the given layout already renders a staff sourcing `partId`. */
export function scoreLayoutContainsPart(score: Score, layoutId: string, partId: string): boolean {
  const layout = (score.layouts ?? []).find((l) => l.id === layoutId);
  if (!layout) return false;
  return collectPartIdsInLayout(layout.content).has(partId);
}

/** Resolve a part's catalog instrument via its stored instrument id. */
function resolvePartInstrument(score: Score, partId: string) {
  const part = score.parts.find((p) => p.id === partId);
  const instrumentId = part?._x?.viritura?.instrumentId;
  return instrumentId ? getCatalogInstrument(instrumentId) : undefined;
}

/**
 * Add an existing part's staff to a specific layout (family-group aware).
 * No-op when the part is missing, the layout is missing, or the part is
 * already present. Does not modify `parts[]` or any other layout.
 */
export function addPartToScoreLayout(score: Score, partId: string, layoutId: string): Score {
  if (scoreLayoutContainsPart(score, layoutId, partId)) return score;
  const layouts = score.layouts ?? [];
  const layout = layouts.find((l) => l.id === layoutId);
  if (!layout) return score;
  const part = score.parts.find((p) => p.id === partId);
  if (!part) return score;

  const inst = resolvePartInstrument(score, partId);
  const newStaffNode: LayoutContent = inst
    ? buildStaffNodeForPart(inst, partId)
    : ({ type: "staff", sources: [{ part: partId, labelref: "name" }] } as LayoutStaff);
  const familyLabel = inst ? FAMILY_META[inst.family as InstrumentFamily]?.label : undefined;

  const newLayouts = layouts.map((l) =>
    l.id === layoutId ? { ...l, content: appendStaffToFullScoreContent(l.content, familyLabel, newStaffNode) } : l,
  );
  return { ...score, layouts: newLayouts };
}

/**
 * Remove a part's staff node(s) from a specific layout, keeping the part in the
 * document. Empty family/brace groups left behind are pruned. No-op when the
 * part is absent from that layout.
 */
export function removePartFromScoreLayout(score: Score, partId: string, layoutId: string): Score {
  if (!scoreLayoutContainsPart(score, layoutId, partId)) return score;
  const newLayouts = (score.layouts ?? []).map((l) =>
    l.id === layoutId ? { ...l, content: removePartFromContent(l.content, partId) } : l,
  );
  return { ...score, layouts: newLayouts };
}

/**
 * Create a new conductor score containing exactly `partIds`, family-grouped.
 *
 * Builds a fresh layout (`layout-section-<ts>`) and score definition with the
 * chosen parts in document order, bracketing each multi-member family — so
 * "glock + timpani" land under one Percussion bracket. Returns the new index
 * for selection. No-op (null) when no known parts are chosen.
 */
export function createSectionScore(
  score: Score,
  partIds: readonly string[],
  name?: string,
): { score: Score; selectedIndex: number } | null {
  const wanted = new Set(partIds);
  // Preserve document order; drop ids that don't resolve to a real part.
  const chosen = score.parts.filter((p) => p.id && wanted.has(p.id));
  if (chosen.length === 0) return null;

  const layoutId = `layout-section-${Date.now()}`;
  const content = buildSectionContent(score, chosen);
  const newLayouts = [...(score.layouts ?? []), { id: layoutId, content }];
  const newScore: ScoreDefinition = { name: name?.trim() || "Section Score", layout: layoutId };
  const newScores = [...(score.scores ?? []).map((sd) => ({ ...sd })), newScore];
  return { score: { ...score, layouts: newLayouts, scores: newScores }, selectedIndex: newScores.length - 1 };
}

/** A part's instrument family, or `undefined` when unknown. */
function partFamily(part: Part): InstrumentFamily | undefined {
  const fam = part._x?.viritura?.family as InstrumentFamily | undefined;
  return fam && fam in FAMILY_META ? fam : undefined;
}

/** Build a layout staff/brace node for a part (honors multi-staff brace parts). */
function staffNodeFor(score: Score, part: Part): LayoutContent {
  const inst = part.id ? resolvePartInstrument(score, part.id) : undefined;
  return inst && part.id
    ? buildStaffNodeForPart(inst, part.id)
    : ({ type: "staff", sources: [{ part: part.id!, labelref: "name" }] } as LayoutStaff);
}

/**
 * Build family-grouped layout content from a chosen subset of parts.
 *
 * Parts are bucketed by family (standard family order, document order within a
 * family); a family with two or more members is wrapped in a bracket group
 * labelled with the family name, matching full-score engraving. Single members
 * — and parts of unknown family — sit ungrouped, so a lone glockenspiel isn't
 * bracketed alone but glock + timpani share a Percussion bracket.
 */
function buildSectionContent(score: Score, chosen: readonly Part[]): LayoutContent[] {
  const buckets = new Map<InstrumentFamily | "other", Part[]>();
  for (const p of chosen) {
    const key = partFamily(p) ?? "other";
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }
  const order = (k: InstrumentFamily | "other") => (k === "other" ? 99 : FAMILY_META[k].order);
  const out: LayoutContent[] = [];
  for (const key of [...buckets.keys()].sort((a, b) => order(a) - order(b))) {
    const parts = buckets.get(key)!;
    const nodes = parts.map((p) => staffNodeFor(score, p));
    if (nodes.length > 1 && key !== "other") {
      out.push({ type: "group", symbol: "bracket", label: FAMILY_META[key].label, content: nodes } as LayoutGroup);
    } else {
      out.push(...nodes);
    }
  }
  return out;
}

/**
 * Make a layout contain exactly `partIds`: add the missing parts (in document
 * order, family-grouped) and remove the extra ones (part stays in document).
 * Used by the "Manage Instruments" dialog. No-op for an unknown layout.
 */
export function setScoreLayoutMembership(score: Score, layoutId: string, partIds: readonly string[]): Score {
  const layout = (score.layouts ?? []).find((l) => l.id === layoutId);
  if (!layout) return score;
  const target = new Set(partIds);
  const current = collectPartIdsInLayout(layout.content);

  let next = score;
  for (const id of current) {
    if (!target.has(id)) next = removePartFromScoreLayout(next, id, layoutId);
  }
  for (const p of score.parts) {
    if (p.id && target.has(p.id) && !current.has(p.id)) next = addPartToScoreLayout(next, p.id, layoutId);
  }
  return next;
}

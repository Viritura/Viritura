/**
 * instrumentMutations — add / remove / re-arrange Player parts on an
 * existing Score, preserving music data and re-deriving layouts.
 *
 * Extracted from ScoreMutations.ts to keep that file under the lint cap.
 */

import type { ClefSign, LayoutContent, LayoutGroup, LayoutStaff, Part, Score, ScoreDefinition } from "@viritura/core";
import { resolvePartDisplayNames } from "@viritura/core";
import {
  type Player,
  FAMILY_META,
  INSTRUMENT_CATALOG,
  createPlayer,
  getCatalogInstrument,
  buildPartTransposition,
} from "./InstrumentCatalog";
import { buildLayouts, buildScoreDefinitions } from "./layoutBuilder";
import { createCatalogPart, persistedPartNames } from "./catalogPart";

// ─── Extract players from an existing Score ──────────────────────

/** A player derived from an existing part in the Score. */
export interface ExistingPlayer extends Player {
  /** Index of this player's part in the Score.parts array. */
  partIndex: number;
}

/**
 * Returns true when an instrument with this name pattern is compatible
 * with the requested transposition (or lack thereof).
 */
function transpositionMatches(inst: (typeof INSTRUMENT_CATALOG)[number], halfSteps: number | undefined): boolean {
  if (halfSteps !== undefined) return inst.transposition?.halfSteps === halfSteps;
  return !inst.transposition;
}

type NameMatcher = (
  inst: (typeof INSTRUMENT_CATALOG)[number],
  part: Part,
  nameLower: string,
  staves: number,
  halfSteps: number | undefined,
) => string | null;

/** Exact match on the full catalog name (already encodes transposition). */
const matchExactName: NameMatcher = (inst, part, _nl, staves) =>
  inst.name === part.name && inst.staves === staves ? inst.id : null;

/** Exact match on `baseName` (the user-facing string typically stored in MNX). */
const matchBaseName: NameMatcher = (inst, part, _nl, staves, halfSteps) =>
  inst.baseName === part.name && inst.staves === staves && transpositionMatches(inst, halfSteps) ? inst.id : null;

/** Case-insensitive exact match against `baseName` (falling back to `name`). */
const matchCaseInsensitiveName: NameMatcher = (inst, _part, nameLower, staves, halfSteps) => {
  const target = (inst.baseName ?? inst.name).toLowerCase();
  return nameLower === target && inst.staves === staves && transpositionMatches(inst, halfSteps) ? inst.id : null;
};

/** Prefix match — accepts numeric suffixes (e.g. "Flute 1" -> "Flute"). */
const matchPrefixWithNumber: NameMatcher = (inst, part, _nl, staves) => {
  const target = inst.baseName ?? inst.name;
  if (!part.name.startsWith(target) || inst.staves !== staves) return null;
  const suffix = part.name.slice(target.length).trim();
  return suffix === "" || /^\d+$/.test(suffix) ? inst.id : null;
};

/** Case-insensitive substring (e.g. "Alto Trombone" contains "trombone"). */
const matchSubstring: NameMatcher = (inst, _part, nameLower, staves, halfSteps) => {
  const target = (inst.baseName ?? inst.name).toLowerCase();
  return nameLower.includes(target) && inst.staves === staves && transpositionMatches(inst, halfSteps) ? inst.id : null;
};

const NAME_MATCHERS: readonly NameMatcher[] = [
  matchExactName,
  matchBaseName,
  matchCaseInsensitiveName,
  matchPrefixWithNumber,
  matchSubstring,
];

/** Try every name-based heuristic to match a Part back to a catalog instrument. */
function matchInstrumentByName(part: Part, staves: number, halfSteps?: number): string | null {
  const nameLower = part.name.toLowerCase();
  for (const matcher of NAME_MATCHERS) {
    for (const inst of INSTRUMENT_CATALOG) {
      const hit = matcher(inst, part, nameLower, staves, halfSteps);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Guess the instrument ID for a part by matching transposition + staves.
 * Returns null if no reasonable match is found.
 */
function guessInstrumentId(part: Part): string | null {
  const staves = part.staves ?? 1;
  const halfSteps = part.transposition?.interval?.halfSteps;

  const byName = matchInstrumentByName(part, staves, halfSteps);
  if (byName) return byName;

  // Match by transposition + staves
  if (halfSteps !== undefined) {
    for (const inst of INSTRUMENT_CATALOG) {
      if (inst.transposition?.halfSteps === halfSteps && inst.staves === staves) return inst.id;
    }
  }
  return null;
}

/**
 * Extract a player list from a Score by inspecting its parts.
 * Tries to map each part back to a catalog instrument by matching
 * the instrument's transposition and staves.
 */
export function extractPlayersFromScore(score: Score): ExistingPlayer[] {
  const players: Player[] = [];
  const indices: number[] = [];

  for (let i = 0; i < score.parts.length; i++) {
    const part = score.parts[i]!;
    // Prefer the explicit catalog identity stored in `_x.viritura.instrumentId`
    // (set by the wizard / addInstrumentToScore). Falls back to the heuristic
    // matcher for legacy MNX, hand-edited files, or imports.
    const explicitId = part._x?.viritura?.instrumentId;
    const instId = (explicitId && getCatalogInstrument(explicitId) ? explicitId : null) ?? guessInstrumentId(part);
    if (instId) {
      const player = createPlayer(instId);
      // Preserve the part's stored base name (which may have been user-edited)
      player.displayName = part.name;
      player.displayShortName = part.shortName ?? player.displayShortName;
      players.push(player);
    } else {
      // No catalog match — create a synthetic player preserving the part's identity.
      // Use a unique pseudo-ID so renumberPlayers won't group it with unrelated instruments.
      const pseudoId = `__unknown_${i}`;
      const player: Player = {
        uid: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        instrumentId: pseudoId,
        displayName: part.name,
        displayShortName: part.shortName ?? part.name,
      };
      players.push(player);
    }
    indices.push(i);
  }

  return players.map((p, i) => ({ ...p, partIndex: indices[i]! }));
}

// ─── Apply player changes to an existing Score ──────────────────

export interface PlayerChange {
  /** Desired player order after edits. */
  players: Player[];
  /** For existing players, the index of their original part (-1 = new). */
  originalPartIndices: number[];
}

/** Build initial empty measures (with optional first-bar clefs) for a new part. */
function buildEmptyMeasures(
  staves: number,
  measureCount: number,
  inst: ReturnType<typeof getCatalogInstrument> | undefined,
): Part["measures"] {
  const measures: Part["measures"] = [];
  for (let m = 0; m < measureCount; m++) {
    const mObj: Part["measures"][number] = { sequences: [] };

    if (m === 0 && inst) {
      const clefs = [];
      for (let s = 1; s <= staves; s++) {
        const clefDef = inst.clefs[s];
        if (clefDef) {
          clefs.push({
            clef: {
              sign: clefDef.sign as ClefSign,
              staffPosition: clefDef.staffPosition,
              ...(clefDef.glyph ? { glyph: clefDef.glyph } : {}),
            },
            ...(staves > 1 ? { staff: s } : {}),
          });
        }
      }
      mObj.clefs = clefs;
    }

    const sequences = [];
    for (let s = 1; s <= staves; s++) {
      sequences.push({
        content: [],
        fullMeasure: { visualDuration: { base: "whole" as const } },
        ...(staves > 1 ? { staff: s } : {}),
      });
    }
    mObj.sequences = sequences;
    measures.push(mObj);
  }
  return measures;
}

/** Update fields on an existing Part while preserving its music data. */
function updateExistingPart(existing: Part, player: Player, partId: string): Part {
  const inst = getCatalogInstrument(player.instrumentId);
  const updated: Part = {
    ...existing,
    id: partId,
    name: player.displayName,
    measures: existing.measures,
  };
  if (player.displayShortName) updated.shortName = player.displayShortName;
  const numStaves = inst?.staves ?? existing.staves;
  if (numStaves !== undefined && numStaves > 1) updated.staves = numStaves;
  if (inst?.transposition) {
    updated.transposition = buildPartTransposition(inst.transposition);
  }
  return updated;
}

/** Build a brand-new Part with empty measures for a player without prior data. */
function buildNewPart(player: Player, partId: string, measureCount: number): Part {
  const inst = getCatalogInstrument(player.instrumentId);
  const staves = inst?.staves ?? 1;
  return {
    id: partId,
    name: player.displayName,
    ...(player.displayShortName ? { shortName: player.displayShortName } : {}),
    measures: buildEmptyMeasures(staves, measureCount, inst),
    ...(staves > 1 ? { staves } : {}),
    ...(inst?.transposition ? { transposition: buildPartTransposition(inst.transposition) } : {}),
  };
}

/**
 * Apply player changes to an existing Score, preserving music data for
 * existing parts and generating empty measures for new ones.
 * Returns a new Score object (does not mutate the input).
 */
export function applyPlayerChanges(score: Score, change: PlayerChange): Score {
  const { players, originalPartIndices } = change;
  const measureCount = score.global.measures.length;
  const newParts: Part[] = [];
  const partIds: string[] = [];

  for (let i = 0; i < players.length; i++) {
    const player = players[i]!;
    const origIdx = originalPartIndices[i]!;
    const partId = `P${i + 1}`;
    partIds.push(partId);

    if (origIdx >= 0 && origIdx < score.parts.length) {
      newParts.push(updateExistingPart(score.parts[origIdx]!, player, partId));
    } else {
      newParts.push(buildNewPart(player, partId, measureCount));
    }
  }

  const layouts = buildLayouts(players, partIds);
  const scores = buildScoreDefinitions(players, partIds);

  return { ...score, parts: newParts, layouts, scores };
}

// ─── Remove a part from layout content ──────────────────────────

/** Remove all staff nodes referencing a given part ID from the layout tree. */
export function removePartFromContent(content: LayoutContent[], partId: string): LayoutContent[] {
  return content
    .map((node): LayoutContent | null => {
      if (node.type === "group") {
        const filtered = removePartFromContent(node.content, partId);
        if (filtered.length === 0) return null;
        return { ...node, content: filtered };
      }
      if (node.sources.some((s) => s.part === partId)) return null;
      return node;
    })
    .filter((n): n is LayoutContent => n !== null);
}

// ─── Add an instrument ───────────────────────────────────────────

interface NewInstrumentNames {
  displayName: string;
  displayShortName: string;
}

/** Allocate a fresh, unique part id of the form `P{n}`. */
function nextUniquePartId(score: Score): string {
  const existingIds = new Set(score.parts.map((p) => p.id).filter(Boolean));
  let partNum = score.parts.length + 1;
  while (existingIds.has(`P${partNum}`)) partNum++;
  return `P${partNum}`;
}

/** Resolve a fresh display name + short name, auto-numbering if same-instrument already exists. */
function resolveNewInstrumentNames(
  score: Score,
  inst: NonNullable<ReturnType<typeof getCatalogInstrument>>,
): NewInstrumentNames {
  const baseName = inst.baseName ?? inst.name;
  const sameInstrumentCount = score.parts.filter(
    (p) => p.name === baseName || p.name === inst.name || p.name.startsWith(baseName + " "),
  ).length;
  const needsNumber = sameInstrumentCount > 0;
  return {
    displayName: needsNumber ? `${baseName} ${sameInstrumentCount + 1}` : baseName,
    displayShortName: needsNumber ? `${inst.shortName} ${sameInstrumentCount + 1}` : inst.shortName,
  };
}

/** Build a brace-group (for multi-staff brace instruments) or single staff node. */
export function buildStaffNodeForPart(
  inst: NonNullable<ReturnType<typeof getCatalogInstrument>>,
  partId: string,
): LayoutContent {
  const staves = inst.staves ?? 1;
  if (staves > 1 && inst.bracketSymbol === "brace") {
    const staffNodes: LayoutStaff[] = [];
    for (let s = 1; s <= staves; s++) {
      staffNodes.push({
        type: "staff",
        sources: [{ part: partId, staff: s, labelref: "name" }],
      });
    }
    return { type: "group", content: staffNodes, symbol: "brace" } as LayoutGroup;
  }
  return {
    type: "staff",
    sources: [{ part: partId, labelref: "name" }],
  } as LayoutStaff;
}

/** Find or create a family group and append `newStaffNode` to it. */
export function appendStaffToFullScoreContent(
  content: LayoutContent[],
  familyLabel: string | undefined,
  newStaffNode: LayoutContent,
): LayoutContent[] {
  if (familyLabel) {
    for (let i = 0; i < content.length; i++) {
      const node = content[i]!;
      if (node.type === "group" && (node as LayoutGroup).label === familyLabel) {
        const updated = [...content];
        const group = { ...(node as LayoutGroup) };
        group.content = [...group.content, newStaffNode];
        updated[i] = group;
        return updated;
      }
    }
  }
  return [...content, newStaffNode];
}

/** Identify the layout id(s) that represent the full-score / condensed-score view. */
function collectFullScoreLayoutIds(score: Score): Set<string> {
  const ids = new Set<string>();
  for (const sd of score.scores ?? []) {
    if ((sd.name === "Full Score" || sd.name === "Condensed Score") && sd.layout) {
      ids.add(sd.layout);
    }
  }
  if (ids.size === 0 && (score.layouts ?? []).length > 0) {
    ids.add(score.layouts![0]!.id);
  }
  return ids;
}

/** Synchronize per-part score definitions with derived part display names. */
export function synchronizePartScoreDefinitions(
  parts: readonly Part[],
  scores: readonly ScoreDefinition[],
): ScoreDefinition[] {
  const displayNames = resolvePartDisplayNames(parts);
  const byLayout = new Map<string, { name: string; useWritten: true | undefined }>(
    parts.flatMap((part, index) =>
      part.id
        ? [
            [
              `L-${part.id}`,
              { name: displayNames[index]!.displayName, useWritten: part.transposition ? true : undefined },
            ] as const,
            [
              `part-${part.id}`,
              { name: displayNames[index]!.displayName, useWritten: part.transposition ? true : undefined },
            ] as const,
          ]
        : [],
    ),
  );
  return scores.map((score) => {
    const derived = score.layout ? byLayout.get(score.layout) : undefined;
    if (!derived) return { ...score };
    const next = { ...score, name: derived.name };
    if (derived.useWritten) next.useWritten = true;
    else delete next.useWritten;
    return next;
  });
}

/**
 * Incrementally add a new instrument (Part) to an existing Score
 * without rebuilding existing layouts. Creates the Part with empty measures,
 * appends a staff to the chosen conductor layout(s), creates a per-part layout,
 * and adds a per-part score definition.
 *
 * `targetLayoutIds` selects which existing layouts receive the new staff. When
 * omitted, the canonical full-/condensed-score layout(s) are used (legacy
 * behavior). Pass an explicit (possibly empty) list to control exactly which
 * conductor scores the instrument joins; the per-part extract score is always
 * created regardless.
 */
export function addInstrumentToScore(score: Score, instrumentId: string, targetLayoutIds?: readonly string[]): Score {
  const inst = getCatalogInstrument(instrumentId);
  if (!inst) return score;

  const newPartId = nextUniquePartId(score);
  const names = resolveNewInstrumentNames(score, inst);
  const measureCount = score.global.measures.length;

  const storedNames = persistedPartNames(inst, { name: names.displayName, shortName: names.displayShortName });
  const { part: newPart, sounds: newSounds } = createCatalogPart(
    inst,
    newPartId,
    storedNames,
    measureCount,
    score.parts.length,
  );

  const newStaffNode = buildStaffNodeForPart(inst, newPartId);
  const familyLabel = FAMILY_META[inst.family]?.label;
  const targetIds = targetLayoutIds ? new Set(targetLayoutIds) : collectFullScoreLayoutIds(score);

  const newLayouts = (score.layouts ?? []).map((layout) =>
    targetIds.has(layout.id)
      ? { ...layout, content: appendStaffToFullScoreContent(layout.content, familyLabel, newStaffNode) }
      : layout,
  );

  // Per-part layout
  newLayouts.push({ id: `L-${newPartId}`, content: [buildStaffNodeForPart(inst, newPartId)] });

  // Per-part score definition
  const newScoreDef: ScoreDefinition = {
    name: names.displayName,
    layout: `L-${newPartId}`,
    ...(inst.transposition ? { useWritten: true } : {}),
  };
  const newParts = [...score.parts.map((p) => ({ ...p })), newPart];
  const newScores = synchronizePartScoreDefinitions(newParts, [...(score.scores ?? []), newScoreDef]);

  let newGlobal = score.global;
  if (Object.keys(newSounds).length > 0) {
    newGlobal = {
      ...score.global,
      sounds: { ...(score.global.sounds ?? {}), ...newSounds },
    };
  }

  return { ...score, global: newGlobal, parts: newParts, layouts: newLayouts, scores: newScores };
}

// ─── Remove an instrument ────────────────────────────────────────

/**
 * Incrementally remove an instrument (Part) from an existing Score.
 *
 * Note: keeps stale entries in `global.sounds` if a kit-bearing part is
 * removed. They are harmless because nothing references them.
 *
 * without rebuilding other layouts. Removes the Part, its staff nodes
 * from all layouts, its per-part layout, and its score definition.
 */
export function removeInstrumentFromScore(score: Score, partId: string): Score {
  const partIndex = score.parts.findIndex((p) => p.id === partId);
  if (partIndex < 0) return score;
  if (score.parts.length <= 1) return score;

  const newParts = score.parts.filter((p) => p.id !== partId).map((p) => ({ ...p }));

  const perPartLayoutId = `L-${partId}`;
  const newLayouts = (score.layouts ?? [])
    .filter((l) => l.id !== perPartLayoutId)
    .map((layout) => ({ ...layout, content: removePartFromContent(layout.content, partId) }));

  const newScores = synchronizePartScoreDefinitions(
    newParts,
    (score.scores ?? []).filter((sd) => sd.layout !== perPartLayoutId),
  );

  return { ...score, parts: newParts, layouts: newLayouts, scores: newScores };
}

// ─── Reorder an instrument ───────────────────────────────────────

/** Does this node's subtree reference `partId` at all? */
function subtreeReferencesPart(node: LayoutContent, partId: string): boolean {
  if (node.type === "group") return (node as LayoutGroup).content.some((c) => subtreeReferencesPart(c, partId));
  return (node as LayoutStaff).sources.some((s) => s.part === partId);
}

/** Does this node's subtree reference *only* `partId` (and nothing else)? */
function subtreeReferencesOnlyPart(node: LayoutContent, partId: string): boolean {
  if (node.type === "group") {
    const content = (node as LayoutGroup).content;
    return content.length > 0 && content.every((c) => subtreeReferencesOnlyPart(c, partId));
  }
  const sources = (node as LayoutStaff).sources;
  return sources.length > 0 && sources.every((s) => s.part === partId);
}

/**
 * Locate the top-most node that belongs entirely to `partId`, returning its
 * live container array and index. For a single-staff part this is the staff
 * node; for a multi-staff (brace) part it is the brace group; for a part
 * nested inside a mixed family group it is the staff node within that group.
 */
function findPartOwner(content: LayoutContent[], partId: string): { container: LayoutContent[]; index: number } | null {
  for (let i = 0; i < content.length; i++) {
    const node = content[i]!;
    if (subtreeReferencesOnlyPart(node, partId)) return { container: content, index: i };
    if (node.type === "group" && subtreeReferencesPart(node, partId)) {
      const inner = findPartOwner((node as LayoutGroup).content, partId);
      if (inner) return inner;
    }
  }
  return null;
}

/** Drop empty groups left behind after a node is moved out of them. */
function pruneEmptyGroups(content: LayoutContent[]): LayoutContent[] {
  return content
    .map((node) =>
      node.type === "group" ? { ...node, content: pruneEmptyGroups((node as LayoutGroup).content) } : node,
    )
    .filter((node) => !(node.type === "group" && (node as LayoutGroup).content.length === 0));
}

/**
 * Move the node owned by `fromPartId` so it sits immediately before/after the
 * node owned by `toPartId`, joining the target's container (so a part dragged
 * next to members of a family group joins that group). Preserves brace groups
 * and other groupings of the moved part.
 */
function movePartOwnerNode(
  content: LayoutContent[],
  fromPartId: string,
  toPartId: string,
  placeAfter: boolean,
): LayoutContent[] {
  const tree = JSON.parse(JSON.stringify(content)) as LayoutContent[];
  const from = findPartOwner(tree, fromPartId);
  if (!from) return content;
  const [movedNode] = from.container.splice(from.index, 1);
  if (!movedNode) return content;
  const pruned = pruneEmptyGroups(tree);
  const to = findPartOwner(pruned, toPartId);
  if (!to) return content;
  to.container.splice(placeAfter ? to.index + 1 : to.index, 0, movedNode);
  return pruned;
}

/**
 * Reorder an instrument in the ensemble roster, moving `fromPartId` to sit
 * immediately before/after `toPartId`. Updates both the `parts` array (the
 * roster order) and the full-score layout(s) so the engraved score follows.
 */
export function reorderInstrumentInScore(
  score: Score,
  fromPartId: string,
  toPartId: string,
  placeAfter: boolean,
): Score {
  if (fromPartId === toPartId) return score;

  const fromIndex = score.parts.findIndex((p) => p.id === fromPartId);
  const toIndex = score.parts.findIndex((p) => p.id === toPartId);
  if (fromIndex < 0 || toIndex < 0) return score;

  const newParts = score.parts.map((p) => ({ ...p }));
  const [movedPart] = newParts.splice(fromIndex, 1);
  const insertAt = newParts.findIndex((p) => p.id === toPartId);
  newParts.splice(placeAfter ? insertAt + 1 : insertAt, 0, movedPart!);

  const fullScoreLayoutIds = collectFullScoreLayoutIds(score);
  const newLayouts = (score.layouts ?? []).map((layout) =>
    fullScoreLayoutIds.has(layout.id)
      ? { ...layout, content: movePartOwnerNode(layout.content, fromPartId, toPartId, placeAfter) }
      : layout,
  );

  return { ...score, parts: newParts, layouts: newLayouts };
}

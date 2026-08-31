/**
 * ScoreBuilder — generates blank MNX JSON from user settings.
 *
 * Used by the New Score dialog to create empty scores with the
 * specified time signature, key signature, instruments, and measures.
 * Generates MNX layouts (brackets/braces) and scores (full + per-player)
 * so that the Parts tab works out of the box.
 */

import { type Player, type InstrumentFamily, getCatalogInstrument, FAMILY_META } from "./InstrumentCatalog";
import {
  generateId,
  resolvePartDisplayNames,
  type GlobalMeasure,
  type LayoutDefinition,
  type Part,
  type Score,
  type ScoreDefinition,
  type Sound,
} from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import { createCatalogPart, persistedPartNames } from "./catalogPart";

/** Settings for creating a new blank score. */
export interface NewScoreSettings {
  /** Score title stored in Viritura score metadata. */
  title: string;
  /** Players (instruments) in score order. */
  players: Player[];
  /** Time signature */
  time: { count: number; unit: number };
  /** Key signature (circle of fifths) */
  keyFifths: number;
  /** Number of measures */
  measureCount: number;
  /** Initial tempo in BPM, stored as a standard MNX tempo. */
  tempoBpm: number;
  /**
   * "project" creates a folder with a git repo so the score has version
   * history; "standalone" creates a single in-memory MNX file. Defaults to
   * "project" when omitted.
   */
  versioning?: "project" | "standalone";
}

/** Default settings for a new blank score. */
export const DEFAULT_NEW_SCORE_SETTINGS: NewScoreSettings = {
  title: "Untitled Score",
  players: [],
  time: { count: 4, unit: 4 },
  keyFifths: 0,
  measureCount: 32,
  tempoBpm: 120,
  versioning: "project",
};

/**
 * Build a valid MNX JSON string from score settings.
 * Generates parts, layouts (with brackets/braces), and scores
 * (full score + one per player) so the Parts tab works out of the box.
 */
export function buildBlankScore(settings: NewScoreSettings): string {
  const { players, time, keyFifths, measureCount, tempoBpm } = settings;
  const usedIds = new Set<string>();

  const globalMeasures = buildGlobalMeasures(measureCount, time, keyFifths, tempoBpm, usedIds);

  const partIds: string[] = [];
  const sounds: Record<string, Sound> = {};
  const parts = players.map((player, index) => {
    const instrument = getCatalogInstrument(player.instrumentId);
    if (!instrument) throw new Error(`Unknown instrument: ${player.instrumentId}`);
    let partId = generateId();
    while (usedIds.has(partId)) partId = generateId();
    usedIds.add(partId);
    partIds.push(partId);
    const names = persistedPartNames(
      instrument,
      { name: player.displayName, shortName: player.displayShortName },
      {
        name: player.nameOverridden ?? player.userRenamed,
        shortName: player.shortNameOverridden ?? player.userRenamed,
      },
    );
    const created = createCatalogPart(instrument, partId, names, measureCount, index, player.kit);
    Object.assign(sounds, created.sounds);
    return created.part;
  });

  const layouts = buildLayouts(players, partIds);
  const scores = buildScores(parts);

  const title = settings.title.trim();
  const score: Score = {
    mnx: { version: 1 },
    global: {
      measures: globalMeasures as GlobalMeasure[],
      ...(Object.keys(sounds).length > 0 ? { sounds } : {}),
    },
    parts,
    layouts: layouts as unknown as LayoutDefinition[],
    scores: scores as unknown as ScoreDefinition[],
    ...(title ? { metadata: { title } } : {}),
  };
  return JSON.stringify(serializeMnx(score));
}

function buildGlobalMeasures(
  measureCount: number,
  time: { count: number; unit: number },
  keyFifths: number,
  tempoBpm: number,
  usedIds: Set<string>,
): Record<string, unknown>[] {
  const globalMeasures: Record<string, unknown>[] = [];
  for (let i = 0; i < measureCount; i++) {
    const m: Record<string, unknown> = {};
    let id = generateId();
    while (usedIds.has(id)) id = generateId();
    usedIds.add(id);
    m["id"] = id;
    if (i === 0) {
      m["time"] = { count: time.count, unit: time.unit };
      m["key"] = { fifths: keyFifths };
      if (tempoBpm > 0) m["tempos"] = [{ bpm: tempoBpm, value: { base: "quarter" } }];
    }
    globalMeasures.push(m);
  }
  return globalMeasures;
}

function buildLayouts(players: Player[], partIds: string[]): Record<string, unknown>[] {
  const layouts: Record<string, unknown>[] = [];
  const familyGroups = buildFamilyGroups(players);

  const fullScoreContent: Record<string, unknown>[] = [];
  for (const group of familyGroups) {
    const staveEntries = group.playerIndices.map((idx) => buildStaveEntry(players[idx]!, idx, partIds));

    if (group.playerIndices.length > 1) {
      fullScoreContent.push(buildFamilyBracket(group.family, staveEntries));
    } else if (staveEntries.length === 1) {
      fullScoreContent.push(staveEntries[0]!.node);
    }
  }

  layouts.push({ id: "FullScore", content: fullScoreContent });

  for (let idx = 0; idx < players.length; idx++) {
    layouts.push({
      id: `L-${partIds[idx]}`,
      content: buildPerPlayerLayoutContent(players[idx]!, idx, partIds),
    });
  }
  return layouts;
}

function buildStaveEntry(
  player: Player,
  idx: number,
  partIds: string[],
): { node: Record<string, unknown>; subGroup: string | undefined } {
  const inst = getCatalogInstrument(player.instrumentId);
  const numStaves = inst?.staves ?? 1;
  let node: Record<string, unknown>;
  if (numStaves > 1 && inst?.bracketSymbol === "brace") {
    const staffNodes: Record<string, unknown>[] = [];
    for (let s = 1; s <= numStaves; s++) {
      staffNodes.push({
        type: "staff",
        sources: [{ part: partIds[idx], staff: s, labelref: "name" }],
      });
    }
    node = { type: "group", symbol: "brace", content: staffNodes };
  } else {
    node = {
      type: "staff",
      sources: [{ part: partIds[idx], labelref: "name" }],
    };
  }
  return { node, subGroup: inst?.subGroup };
}

function buildFamilyBracket(
  family: InstrumentFamily,
  staveEntries: { node: Record<string, unknown>; subGroup: string | undefined }[],
): Record<string, unknown> {
  const subGroupRuns = groupConsecutiveBySubGroup(staveEntries);
  const hasMultipleSubGroups = subGroupRuns.length > 1;

  const content: Record<string, unknown>[] = hasMultipleSubGroups
    ? subGroupRuns.map((run) =>
        run.nodes.length > 1 ? { type: "group", symbol: "bracket", content: run.nodes } : run.nodes[0]!,
      )
    : staveEntries.map((e) => e.node);

  return {
    type: "group",
    symbol: "bracket",
    label: FAMILY_META[family].label,
    content,
  };
}

function buildPerPlayerLayoutContent(player: Player, idx: number, partIds: string[]): Record<string, unknown>[] {
  const inst = getCatalogInstrument(player.instrumentId);
  const numStaves = inst?.staves ?? 1;

  if (numStaves > 1 && inst?.bracketSymbol === "brace") {
    const staffNodes: Record<string, unknown>[] = [];
    for (let s = 1; s <= numStaves; s++) {
      staffNodes.push({
        type: "staff",
        sources: [{ part: partIds[idx], staff: s, labelref: "name" }],
      });
    }
    return [{ type: "group", symbol: "brace", content: staffNodes }];
  }
  return [
    {
      type: "staff",
      sources: [{ part: partIds[idx], labelref: "name" }],
    },
  ];
}

function buildScores(parts: Part[]): Record<string, unknown>[] {
  const scores: Record<string, unknown>[] = [];

  const fullScoreObj: Record<string, unknown> = {
    name: "Full score",
    layout: "FullScore",
  };
  if (parts.length >= 4) {
    // Orchestral: A3 portrait, Rastral 3 (condensed full score)
    fullScoreObj["_x"] = {
      viritura: {
        pageSetup: {
          width: 297,
          height: 420,
          orientation: "portrait",
          spatiumMm: 1.625,
        },
      },
    };
  }
  scores.push(fullScoreObj);

  const displayNames = resolvePartDisplayNames(parts);
  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx]!;
    const scoreObj: Record<string, unknown> = {
      name: displayNames[idx]!.displayName,
      layout: `L-${part.id}`,
    };
    if (part.transposition) scoreObj["useWritten"] = true;
    scores.push(scoreObj);
  }
  return scores;
}

// ─── Helpers ───────────────────────────────────────────────────────

interface FamilyGroup {
  family: InstrumentFamily;
  playerIndices: number[];
}

interface SubGroupRun {
  subGroup: string | undefined;
  nodes: Record<string, unknown>[];
}

/**
 * Group consecutive entries with the same subGroup into runs.
 * Entries without a subGroup are never merged with neighbours.
 */
function groupConsecutiveBySubGroup(entries: { node: Record<string, unknown>; subGroup?: string }[]): SubGroupRun[] {
  const runs: SubGroupRun[] = [];
  for (const entry of entries) {
    const last = runs[runs.length - 1];
    if (last && last.subGroup != null && last.subGroup === entry.subGroup) {
      last.nodes.push(entry.node);
    } else {
      runs.push({ subGroup: entry.subGroup, nodes: [entry.node] });
    }
  }
  return runs;
}

/**
 * Group players by instrument family, preserving the order they appear
 * in the players list. Adjacent players of the same family are merged.
 */
function buildFamilyGroups(players: Player[]): FamilyGroup[] {
  const groups: FamilyGroup[] = [];
  for (let i = 0; i < players.length; i++) {
    const inst = getCatalogInstrument(players[i]!.instrumentId);
    const family: InstrumentFamily = inst?.family ?? "keyboards";
    const last = groups[groups.length - 1];
    if (last && last.family === family) {
      last.playerIndices.push(i);
    } else {
      groups.push({ family, playerIndices: [i] });
    }
  }
  return groups;
}

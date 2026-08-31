/**
 * layoutBuilder — derive LayoutDefinition[] and ScoreDefinition[] from a
 * Player[] + part-id list. Used by both the "create new score" flow and
 * the apply-player-changes flow.
 */

import type { LayoutContent, LayoutDefinition, LayoutGroup, LayoutStaff, ScoreDefinition } from "@viritura/core";
import { FAMILY_META, getCatalogInstrument, type InstrumentFamily, type Player } from "./InstrumentCatalog";

interface FamilyGroup {
  family: InstrumentFamily;
  playerIndices: number[];
}

interface SubGroupRun {
  subGroup: string | undefined;
  nodes: LayoutContent[];
}

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

function groupConsecutiveBySubGroup(entries: { node: LayoutContent; subGroup: string | undefined }[]): SubGroupRun[] {
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

/** Build a brace-grouped multi-staff node (e.g. piano), or a single staff node. */
function buildPlayerStaffNode(player: Player, partId: string): LayoutContent {
  const inst = getCatalogInstrument(player.instrumentId);
  const numStaves = inst?.staves ?? 1;
  if (numStaves > 1 && inst?.bracketSymbol === "brace") {
    const staffNodes: LayoutStaff[] = [];
    for (let s = 1; s <= numStaves; s++) {
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

/** Build content for one family group within the full-score layout. */
function buildFamilyGroupContent(group: FamilyGroup, players: Player[], partIds: string[]): LayoutContent | null {
  const staveEntries = group.playerIndices.map((idx) => {
    const inst = getCatalogInstrument(players[idx]!.instrumentId);
    return { node: buildPlayerStaffNode(players[idx]!, partIds[idx]!), subGroup: inst?.subGroup };
  });

  if (group.playerIndices.length > 1) {
    const subGroupRuns = groupConsecutiveBySubGroup(staveEntries);
    const hasMultipleSubGroups = subGroupRuns.length > 1;
    const content: LayoutContent[] = hasMultipleSubGroups
      ? subGroupRuns.map((run) =>
          run.nodes.length > 1
            ? ({ type: "group", symbol: "bracket", content: run.nodes } as LayoutGroup)
            : run.nodes[0]!,
        )
      : staveEntries.map((e) => e.node);

    return {
      type: "group",
      symbol: "bracket",
      label: FAMILY_META[group.family].label,
      content,
    } as LayoutGroup;
  }
  if (staveEntries.length === 1) return staveEntries[0]!.node;
  return null;
}

/**
 * Build full-score and per-player layouts from a player list and part IDs.
 */
export function buildLayouts(players: Player[], partIds: string[]): LayoutDefinition[] {
  const layouts: LayoutDefinition[] = [];
  const familyGroups = buildFamilyGroups(players);

  const fullScoreContent: LayoutContent[] = [];
  for (const group of familyGroups) {
    const node = buildFamilyGroupContent(group, players, partIds);
    if (node) fullScoreContent.push(node);
  }

  layouts.push({ id: "FullScore", content: fullScoreContent });

  // Per-player layouts
  for (let idx = 0; idx < players.length; idx++) {
    layouts.push({
      id: `L-${partIds[idx]}`,
      content: [buildPlayerStaffNode(players[idx]!, partIds[idx]!)],
    });
  }

  return layouts;
}

/**
 * Build score definitions from a player list and part IDs.
 */
export function buildScoreDefinitions(players: Player[], partIds: string[]): ScoreDefinition[] {
  const scores: ScoreDefinition[] = [];
  scores.push({ name: "Full score", layout: "FullScore" });

  for (let idx = 0; idx < players.length; idx++) {
    const player = players[idx]!;
    const inst = getCatalogInstrument(player.instrumentId);
    const sd: ScoreDefinition = {
      name: player.displayName,
      layout: `L-${partIds[idx]}`,
    };
    if (inst?.transposition) sd.useWritten = true;
    scores.push(sd);
  }

  return scores;
}

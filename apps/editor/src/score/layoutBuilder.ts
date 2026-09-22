/**
 * layoutBuilder — derive LayoutDefinition[] and ScoreDefinition[] from a
 * Player[] + part-id list. Used by both the "create new score" flow and
 * the apply-player-changes flow.
 */

import type { LayoutContent, LayoutDefinition, LayoutGroup, LayoutStaff, ScoreDefinition } from "@viritura/core";
import { getCatalogInstrument, type Player } from "./InstrumentCatalog";
import { buildOrchestralLayoutGroups, orchestralInstrumentGroup } from "./layoutGrouping";

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

/**
 * Build full-score and per-player layouts from a player list and part IDs.
 */
export function buildLayouts(players: Player[], partIds: string[]): LayoutDefinition[] {
  const layouts: LayoutDefinition[] = [];
  const fullScoreContent = buildOrchestralLayoutGroups(
    players.map((player, index) => {
      const instrument = getCatalogInstrument(player.instrumentId);
      return {
        family: instrument?.family,
        subGroup: orchestralInstrumentGroup(player.instrumentId),
        node: buildPlayerStaffNode(player, partIds[index]!),
      };
    }),
  );

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

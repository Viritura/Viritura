/**
 * ScoreBuilder — generates blank MNX JSON from user settings.
 *
 * Used by the New Score dialog to create empty scores with the
 * specified time signature, key signature, instruments, and measures.
 * Generates MNX layouts (brackets/braces) and scores (full + per-player)
 * so that the Parts tab works out of the box.
 */

import { type Player, getCatalogInstrument } from "./InstrumentCatalog";
import {
  generateId,
  resolvePartDisplayNames,
  type GlobalMeasure,
  type Part,
  type Score,
  type ScoreDefinition,
  type Sound,
} from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import { createCatalogPart, persistedPartNames } from "./catalogPart";
import { buildLayouts } from "./layoutBuilder";

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

export type InitialScoreSettings = Pick<NewScoreSettings, "time" | "keyFifths" | "measureCount" | "tempoBpm">;

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
    layouts,
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

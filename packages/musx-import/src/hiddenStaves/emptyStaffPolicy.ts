import type { DenigmaDiagnostic } from "../types";
import { isUnmarkedMeasure, measureHasNotes } from "./emptyMeasures";
import { layoutStaves, restoreSystemLayout } from "./systemLayouts";

type Json = Record<string, unknown>;

interface ScoreSystem {
  measure: string;
  layoutId: string;
  start: number;
  end: number;
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function content(layout: Json | undefined): unknown[] {
  return Array.isArray(layout?.["content"]) ? layout["content"] : [];
}

function staffCounts(layoutContent: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const staff of layoutStaves(layoutContent)) {
    for (const source of records(staff["sources"])) {
      const part = String(source["part"]);
      counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }
  return counts;
}

function scoreSystems(score: Json, measureIndex: ReadonlyMap<string, number>, measureCount: number) {
  const systems: ScoreSystem[] = [];
  for (const page of records(score["pages"])) {
    for (const system of records(page["systems"])) {
      const start = typeof system["measure"] === "string" ? measureIndex.get(system["measure"]) : undefined;
      if (start === undefined || typeof system["layout"] !== "string") return undefined;
      systems.push({ measure: system["measure"] as string, layoutId: system["layout"], start, end: measureCount });
    }
  }
  for (let index = 0; index < systems.length - 1; index += 1) {
    const next = systems[index + 1]!;
    if (next.start <= systems[index]!.start) return undefined;
    systems[index]!.end = next.start;
  }
  return systems;
}

function layoutReferences(scores: Json[]): Map<string, number> {
  const references = new Map<string, number>();
  const add = (id: unknown) => {
    if (typeof id === "string") references.set(id, (references.get(id) ?? 0) + 1);
  };
  for (const score of scores) {
    add(score["layout"]);
    for (const page of records(score["pages"])) {
      for (const system of records(page["systems"])) add(system["layout"]);
    }
  }
  return references;
}

interface DocumentIndex {
  layouts: Map<string, Json>;
  parts: Map<string, Json>;
  partOrder: string[];
  measureIndex: Map<string, number>;
  measureCount: number;
  references: Map<string, number>;
}

interface ScoreView {
  name: string;
  full: Json;
  systems: ScoreSystem[];
  /** Staff count per part on each system, as Finale laid it out. */
  shown: Map<string, number>[];
}

function partMeasures(index: DocumentIndex, partId: string, system: ScoreSystem): unknown[] {
  return records(index.parts.get(partId)?.["measures"]).slice(system.start, system.end);
}

function emptyOn(index: DocumentIndex, partId: string, system: ScoreSystem): boolean {
  return partMeasures(index, partId, system).every((measure, offset) =>
    isUnmarkedMeasure(measure, system.start + offset),
  );
}

/** Parts omitted only from whole systems where they are empty, plus whether any omission disqualified a part. */
function hiddenEmptyParts(index: DocumentIndex, view: ScoreView) {
  const candidates = new Set<string>();
  const disqualified = new Set<string>();
  view.systems.forEach((system, systemIndex) => {
    for (const [partId, count] of staffCounts(content(view.full))) {
      const visible = view.shown[systemIndex]!.get(partId) ?? 0;
      if (visible === count) continue;
      if (visible > 0 || !index.parts.has(partId) || !emptyOn(index, partId, system)) disqualified.add(partId);
      else candidates.add(partId);
    }
  });
  for (const partId of disqualified) candidates.delete(partId);
  return { candidates, hasDisqualified: disqualified.size > 0 };
}

/** Restore candidates to system layouts that only this score view uses. */
function restoreLayouts(index: DocumentIndex, view: ScoreView, candidates: ReadonlySet<string>): Set<string> {
  const restored = new Set<string>();
  for (const system of view.systems) {
    const layout = index.layouts.get(system.layoutId);
    if (!layout || layout === view.full || restored.has(system.layoutId)) continue;
    const uses = view.systems.filter((entry) => entry.layoutId === system.layoutId).length;
    if (index.references.get(system.layoutId) !== uses) continue;
    const restoredContent = restoreSystemLayout(content(view.full), content(layout), candidates);
    if (!restoredContent) continue;
    layout["content"] = restoredContent;
    restored.add(system.layoutId);
  }
  return restored;
}

/** Decisions that reproduce Finale's display of policy parts it showed while empty. */
function keepDecisions(
  index: DocumentIndex,
  view: ScoreView,
  policyParts: ReadonlySet<string>,
  restored: ReadonlySet<string>,
): Json {
  const keepVisible: Array<{ measure: string; parts: string[] }> = [];
  let firstSystem: "show" | undefined;
  const hidesOnFirst =
    restored.has(view.systems[0]!.layoutId) && [...policyParts].some((partId) => !view.shown[0]!.has(partId));
  view.systems.forEach((system, systemIndex) => {
    const kept = index.partOrder.filter(
      (partId) =>
        policyParts.has(partId) &&
        view.shown[systemIndex]!.has(partId) &&
        !partMeasures(index, partId, system).some(measureHasNotes),
    );
    if (kept.length === 0) return;
    if (systemIndex === 0 && !hidesOnFirst) firstSystem = "show";
    else keepVisible.push({ measure: system.measure, parts: kept });
  });
  const decisions: Json = {};
  if (firstSystem) decisions["firstSystem"] = firstSystem;
  if (keepVisible.length > 0) decisions["keepVisible"] = keepVisible;
  return decisions;
}

function writePolicy(score: Json, parts: string[], decisions: Json): void {
  const x = isRecord(score["_x"]) ? score["_x"] : {};
  const viritura = isRecord(x["viritura"]) ? x["viritura"] : {};
  viritura["autoHideEmptyParts"] = parts;
  if (Object.keys(decisions).length > 0) viritura["autoHideEmptyStaves"] = decisions;
  x["viritura"] = viritura;
  score["_x"] = x;
}

function scoreView(index: DocumentIndex, score: Json): ScoreView | undefined {
  const existing = isRecord(score["_x"]) && isRecord(score["_x"]["viritura"]) ? score["_x"]["viritura"] : undefined;
  if (existing?.["autoHideEmptyParts"] !== undefined) return undefined;
  const full = typeof score["layout"] === "string" ? index.layouts.get(score["layout"]) : undefined;
  const systems = scoreSystems(score, index.measureIndex, index.measureCount);
  if (!full || !systems || systems.length === 0) return undefined;
  return {
    name: typeof score["name"] === "string" ? score["name"] : "score",
    full,
    systems,
    shown: systems.map((system) => staffCounts(content(index.layouts.get(system.layoutId) ?? full))),
  };
}

function mapScore(index: DocumentIndex, score: Json): DenigmaDiagnostic[] {
  const view = scoreView(index, score);
  if (!view) return [];
  const diagnostics: DenigmaDiagnostic[] = [];
  const { candidates, hasDisqualified } = hiddenEmptyParts(index, view);
  if (hasDisqualified) {
    diagnostics.push({
      severity: "info",
      message: `Finale hid staves that contain music on some systems of "${view.name}"; those systems keep Finale's staff lists.`,
    });
  }
  if (candidates.size === 0) return diagnostics;

  const restored = restoreLayouts(index, view, candidates);
  const policyParts = new Set(
    [...candidates].filter((partId) =>
      view.systems.some(
        (system, systemIndex) => restored.has(system.layoutId) && !view.shown[systemIndex]!.has(partId),
      ),
    ),
  );
  if (policyParts.size === 0) return diagnostics;

  const ordered = index.partOrder.filter((partId) => policyParts.has(partId));
  writePolicy(score, ordered, keepDecisions(index, view, policyParts, restored));
  const names = ordered.map((partId) => {
    const name = index.parts.get(partId)?.["name"];
    return typeof name === "string" && name.length > 0 ? name : partId;
  });
  diagnostics.push({
    severity: "info",
    message: `Finale's hidden empty staves in "${view.name}" now hide automatically when empty: ${names.join(", ")}.`,
  });
  return diagnostics;
}

/**
 * Finale removes staves from a system's staff list when "optimize systems"
 * drops empty staves or a collapse hide mode covers the whole system. Denigma
 * writes those systems as explicit MNX layouts. When every such omission is of
 * an empty instrument, convert it into Viritura's automatic empty-staff policy:
 * restore the staves to the system layouts, opt the instruments in, and record
 * first-system and per-system keep-visible decisions wherever Finale showed an
 * empty staff, so the imported pages render as Finale laid them out while
 * later edits recompute visibility.
 */
export function mapHiddenEmptyStaves(document: Json): DenigmaDiagnostic[] {
  const parts = new Map(records(document["parts"]).map((part) => [String(part["id"]), part]));
  const globalMeasures = isRecord(document["global"]) ? records(document["global"]["measures"]) : [];
  const scores = records(document["scores"]);
  const index: DocumentIndex = {
    layouts: new Map(records(document["layouts"]).map((layout) => [String(layout["id"]), layout])),
    parts,
    partOrder: [...parts.keys()],
    measureIndex: new Map(
      globalMeasures.flatMap((measure, position) =>
        typeof measure["id"] === "string" ? [[measure["id"], position] as const] : [],
      ),
    ),
    measureCount: globalMeasures.length,
    references: layoutReferences(scores),
  };
  return scores.flatMap((score) => mapScore(index, score));
}

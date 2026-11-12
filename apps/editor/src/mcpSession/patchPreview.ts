import {
  applyPatchesToScore,
  patch,
  patchAffectedMeasures,
  walkSequenceEvents,
  type Score,
  type ScorePatch,
} from "@viritura/core";
import { parseMnx, serializeEvent, serializeMnx, serializeSequenceContent } from "@viritura/format";
import {
  analyzeBeatCounts,
  analyzeBeatCountsInRange,
  repairBeatCounts,
  type MeasureBeatInfo,
} from "../commands/measureValidation";
import { sequenceContentBeats } from "../commands/noteCommands";
import { measureReference, type MeasureReference } from "./measureReferences";

interface BeatRepair extends MeasureReference {
  partId: string | null;
  partIndex: number;
  voice: number;
  actualBeats: number;
  expectedBeats: number;
  repairedBeats: number;
  action: "pad" | "truncate";
  removedEventIds: string[];
  modifiedEventIds: string[];
}

interface RepairPreview {
  score: Score;
  repairs: BeatRepair[];
  remainingIssues: MeasureBeatInfo[];
}

export interface PatchPreview extends RepairPreview {
  effectivePatches: readonly ScorePatch[];
  needsDocumentCommit: boolean;
  splicePreviews: {
    partId: string;
    measureIndex: number;
    voice: number;
    before: object[] | null;
    after: object[] | null;
  }[];
  splicePreviewsTruncated: boolean;
}

export function previewPatches(score: Score, patches: readonly ScorePatch[]): PatchPreview {
  const proposed = applyPatchesToScore(score, structuredClone(patches));
  parseMnx(serializeMnx(proposed));
  const range = patchAffectedMeasures(patches) ?? undefined;
  const repaired = previewRepairs(proposed, range);
  const repairPatches: ScorePatch[] = [];
  let needsDocumentCommit = false;
  for (const repair of repaired.repairs) {
    const part = repaired.score.parts[repair.partIndex];
    const sequence = part?.measures[repair.measureIndex]?.sequences[repair.voice];
    if (!part?.id || !sequence) {
      needsDocumentCommit = true;
      continue;
    }
    repairPatches.push(
      patch.setSequenceContent(
        { partId: part.id, measureIndex: repair.measureIndex, voice: repair.voice },
        structuredClone(sequence.content),
      ),
    );
  }
  const splicePaths = new Map<string, { partId: string; measureIndex: number; voice: number }>();
  for (const candidate of patches) {
    if (candidate.kind !== "spliceSequenceContent") continue;
    const path = candidate.sequencePath;
    splicePaths.set(JSON.stringify([path.partId, path.measureIndex, path.voice]), path);
  }
  const splicePreviews = [...splicePaths.values()].slice(0, 32).map((path) => ({
    ...path,
    before: sequenceContent(score, path),
    after: sequenceContent(repaired.score, path),
  }));
  return {
    ...repaired,
    effectivePatches: needsDocumentCommit ? patches : [...patches, ...repairPatches],
    needsDocumentCommit,
    splicePreviews,
    splicePreviewsTruncated: splicePaths.size > splicePreviews.length,
  };
}

export function previewRepairs(score: Score, range?: { start: number; end: number }): RepairPreview {
  const proposed = structuredClone(score);
  const issues = range ? analyzeBeatCountsInRange(proposed, range.start, range.end) : analyzeBeatCounts(proposed);
  const beforeEvents = issues.map((issue) => eventSnapshots(proposed, issue));
  repairBeatCounts(proposed, range);
  const repairs = issues.map((issue, index) => describeRepair(proposed, issue, beforeEvents[index]!));
  const remainingIssues = range
    ? analyzeBeatCountsInRange(proposed, range.start, range.end)
    : analyzeBeatCounts(proposed);
  parseMnx(serializeMnx(proposed));
  return { score: proposed, repairs, remainingIssues };
}

function eventSnapshots(score: Score, issue: MeasureBeatInfo): Map<string, string> {
  const content =
    score.parts[issue.partIndex]?.measures[issue.measureIndex]?.sequences[issue.voiceIndex]?.content ?? [];
  const result = new Map<string, string>();
  for (const { event } of walkSequenceEvents(content)) {
    if (event.id) result.set(event.id, JSON.stringify(serializeEvent(event)));
  }
  return result;
}

function describeRepair(score: Score, issue: MeasureBeatInfo, before: Map<string, string>): BeatRepair {
  const part = score.parts[issue.partIndex];
  const sequence = part?.measures[issue.measureIndex]?.sequences[issue.voiceIndex];
  const after = eventSnapshots(score, issue);
  return {
    partId: part?.id ?? null,
    partIndex: issue.partIndex,
    ...measureReference(score, issue.measureIndex),
    voice: issue.voiceIndex,
    actualBeats: issue.actualBeats,
    expectedBeats: issue.expectedBeats,
    repairedBeats: sequence?.content.reduce((total, item) => total + sequenceContentBeats(item), 0) ?? 0,
    action: issue.difference < 0 ? "pad" : "truncate",
    removedEventIds: [...before.keys()].filter((id) => !after.has(id)),
    modifiedEventIds: [...before.keys()].filter((id) => after.has(id) && before.get(id) !== after.get(id)),
  };
}

function sequenceContent(score: Score, path: { partId: string; measureIndex: number; voice: number }): object[] | null {
  const content = score.parts.find((part) => part.id === path.partId)?.measures[path.measureIndex]?.sequences[
    path.voice
  ]?.content;
  return content ? content.map(serializeSequenceContent) : null;
}

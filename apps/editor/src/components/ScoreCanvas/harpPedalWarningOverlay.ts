import { analyzeHarpPedalCompatibility, type HarpPedalIssue, type Score } from "@viritura/core";
import { commandsForExactElement, paintCommand, type DisplayList, type RenderCommand } from "@viritura/renderer";

type NoteheadGlyph = Extract<RenderCommand, { type: "DrawGlyph" }>;

const WARNING_RED = "#d32f2f";
const analysisCache = new WeakMap<Score, HarpPedalIssue[]>();
const elementIdCache = new WeakMap<DisplayList, { version: number; ids: Map<string, string[]> }>();

function issueKey(partIndex: number, measureIndex: number, eventId: string, noteIndex: number): string {
  return JSON.stringify([partIndex, measureIndex, eventId, noteIndex]);
}

function issuesForScore(score: Score): HarpPedalIssue[] {
  const cached = analysisCache.get(score);
  if (cached) return cached;
  const issues = score.parts.flatMap((_part, partIndex) => analyzeHarpPedalCompatibility(score, partIndex).issues);
  analysisCache.set(score, issues);
  return issues;
}

function elementIdsForIssues(displayList: DisplayList, version: number): Map<string, string[]> {
  const cached = elementIdCache.get(displayList);
  if (cached?.version === version) return cached.ids;

  const ids = new Map<string, string[]>();
  for (const elementId of displayList.elementIds ?? []) {
    if (!elementId) continue;
    const match = elementId.match(/^p(\d+)\/m(\d+)\/s\d+\/(.+)\/n(\d+)$/);
    if (!match) continue;
    const eventId = match[3]!.split("/").at(-1)!;
    const key = issueKey(Number(match[1]), Number(match[2]), eventId, Number(match[4]));
    const elementIds = ids.get(key);
    if (elementIds) elementIds.push(elementId);
    else ids.set(key, [elementId]);
  }
  elementIdCache.set(displayList, { version, ids });
  return ids;
}

export function harpPedalWarningGlyphs(score: Score, displayList: DisplayList, version: number): NoteheadGlyph[] {
  const ids = elementIdsForIssues(displayList, version);
  const glyphs: NoteheadGlyph[] = [];
  const seen = new Set<string>();
  for (const issue of issuesForScore(score)) {
    for (const elementId of ids.get(issueKey(issue.partIndex, issue.measureIndex, issue.eventId, issue.noteIndex)) ??
      []) {
      if (seen.has(elementId)) continue;
      seen.add(elementId);
      for (const command of commandsForExactElement(displayList, elementId, version) ?? []) {
        if (command.type === "DrawGlyph") glyphs.push({ ...command, color: WARNING_RED });
      }
    }
  }
  return glyphs;
}

export function paintHarpPedalWarningGlyphs(ctx: CanvasRenderingContext2D, glyphs: readonly NoteheadGlyph[]): void {
  ctx.save();
  for (const command of glyphs) paintCommand(ctx, command);
  ctx.restore();
}

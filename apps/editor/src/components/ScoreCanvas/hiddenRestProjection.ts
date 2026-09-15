import type { DisplayList, RenderCommand } from "@viritura/renderer";
import type { Score, SequenceContent } from "@viritura/core";
import {
  fractionToDuration,
  HIDDEN_REST_ID_PREFIX,
  hiddenRestPlaceholderSuffix,
} from "../../score/hiddenRestMutations";

export const HIDDEN_REST_COLOR = "#777777";

interface JsonObject {
  [key: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectContent(content: unknown[], parentPath: readonly number[] = []): boolean {
  let changed = false;
  for (let index = 0; index < content.length; index++) {
    const item = content[index];
    const path = [...parentPath, index];
    if (!isObject(item)) continue;
    if (item["type"] === "space" && Array.isArray(item["duration"]) && item["duration"].length === 2) {
      const duration = fractionToDuration(item["duration"] as [number, number]);
      if (!duration) continue;
      content[index] = {
        id: hiddenRestPlaceholderSuffix({ contentPath: path, eventIndex: index }),
        duration,
        rest: {},
      };
      changed = true;
      continue;
    }
    if (item["type"] !== "tuplet" || !Array.isArray(item["content"])) continue;
    changed = projectContent(item["content"], path) || changed;
  }
  return changed;
}

export function projectHiddenRestsForWrite(mnxJson: string): string {
  if (!mnxJson) return mnxJson;
  const root: unknown = JSON.parse(mnxJson);
  if (!isObject(root)) return mnxJson;
  let changed = false;
  const projectMeasure = (measure: unknown) => {
    if (!isObject(measure) || !Array.isArray(measure["sequences"])) return;
    for (const sequence of measure["sequences"]) {
      if (isObject(sequence) && Array.isArray(sequence["content"])) {
        changed = projectContent(sequence["content"]) || changed;
      }
    }
  };
  for (const part of Array.isArray(root["parts"]) ? root["parts"] : []) {
    if (!isObject(part) || !Array.isArray(part["measures"])) continue;
    for (const measure of part["measures"]) projectMeasure(measure);
  }
  if (isObject(root["partMeasures"])) {
    for (const measures of Object.values(root["partMeasures"])) {
      if (!isObject(measures)) continue;
      for (const measure of Object.values(measures)) projectMeasure(measure);
    }
  }
  return changed ? JSON.stringify(root) : mnxJson;
}

function contentHasSpace(content: readonly SequenceContent[]): boolean {
  return content.some((item) => item.type === "space" || (item.type === "tuplet" && contentHasSpace(item.content)));
}

export function scoreHasHiddenRests(score: Score | null): boolean {
  return (
    score?.parts.some((part) =>
      part.measures.some((measure) => measure.sequences.some((sequence) => contentHasSpace(sequence.content))),
    ) ?? false
  );
}

function tintCommand(command: RenderCommand): RenderCommand {
  return "color" in command ? { ...command, color: HIDDEN_REST_COLOR } : command;
}

export function tintHiddenRestPlaceholders(displayList: DisplayList): DisplayList {
  if (!displayList.elementIds?.some((id) => id?.includes(HIDDEN_REST_ID_PREFIX))) return displayList;
  return {
    ...displayList,
    commands: displayList.commands.map((command, index) =>
      displayList.elementIds?.[index]?.includes(HIDDEN_REST_ID_PREFIX) ? tintCommand(command) : command,
    ),
  };
}

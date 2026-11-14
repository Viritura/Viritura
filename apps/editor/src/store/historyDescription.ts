import type { GlobalMeasure, ScorePatch } from "@viritura/core";
import type { CursorPosition } from "./noteInputStore";

const patchLabels: Record<ScorePatch["kind"], string> = {
  setNotePitch: "Change pitch",
  setNoteField: "Change note",
  setNoteMarking: "Change note marking",
  addNoteToEvent: "Add note",
  removeNoteFromEvent: "Remove note",
  setEventField: "Change event",
  setEventMarking: "Change articulation",
  setMeasureDynamicGroup: "Change dynamics",
  addMeasureExpression: "Add expression",
  setMeasureExpression: "Edit expression",
  removeMeasureExpression: "Remove expression",
  setMeasureArpeggio: "Change arpeggio",
  spliceSequenceContent: "Edit notes",
  setGlobalMeasureField: "Change score marking",
  insertMeasures: "Add measures",
  removeMeasures: "Remove measures",
  setPartMeasureField: "Change staff setup",
  setSequenceContent: "Edit measure content",
  addPart: "Add part",
  removePart: "Remove part",
  setPartField: "Edit part",
  setScoreMetadata: "Edit score metadata",
  setMnxSupport: "Change MNX support",
  setScoreExtension: "Edit score settings",
};

function patchLabel(patch: ScorePatch): string {
  switch (patch.kind) {
    case "setEventField":
      return `Change ${patch.update.field}`;
    case "setEventMarking":
      return `Change ${patch.markingKey}`;
    case "setPartField":
      return `Edit part ${patch.update.field}`;
    case "setScoreExtension":
      return `Edit ${patch.update.field}`;
    default:
      return patchLabels[patch.kind];
  }
}

function patchMeasureIndex(patch: ScorePatch): number | undefined {
  if ("locator" in patch) return patch.locator.sequencePath.measureIndex;
  if ("sequencePath" in patch) return patch.sequencePath.measureIndex;
  if ("measurePath" in patch) return patch.measurePath.measureIndex;

  switch (patch.kind) {
    case "setGlobalMeasureField":
      return patch.measureIndex;
    case "insertMeasures":
      return patch.atIndex;
    case "removeMeasures":
      return patch.startIndex;
    case "addPart":
    case "removePart":
    case "setPartField":
    case "setScoreMetadata":
    case "setMnxSupport":
    case "setScoreExtension":
      return undefined;
  }
}

function formatMeasure(measureIndex: number | undefined, measures?: readonly GlobalMeasure[]): string {
  if (measureIndex === undefined || !Number.isInteger(measureIndex) || measureIndex < 0) return "";
  const measure = measures?.[measureIndex];
  if (measures && !measure) return "";
  return ` · m. ${measure?.number ?? measureIndex + 1}`;
}

export function describeHistoryChange(
  patches: readonly ScorePatch[],
  cursorBefore?: CursorPosition | null,
  cursorAfter?: CursorPosition | null,
  measures?: readonly GlobalMeasure[],
  previousMeasures?: readonly GlobalMeasure[],
): string {
  if (patches.length > 0) {
    const firstLabel = patchLabel(patches[0]!);
    const sameLabel = patches.every((patch) => patchLabel(patch) === firstLabel);
    const labels = sameLabel
      ? `${firstLabel}${patches.length > 1 ? ` · ${patches.length} changes` : ""}`
      : `${firstLabel}, +${patches.length - 1} more change${patches.length === 2 ? "" : "s"}`;
    const indices = new Set(patches.map(patchMeasureIndex).filter((index) => index !== undefined));
    const measureIndex = indices.size === 1 ? indices.values().next().value : undefined;
    const hasRemoval = patches.some((patch) => patch.kind === "removeMeasures");
    if (hasRemoval && (patches.length !== 1 || !previousMeasures)) return labels;
    return `${labels}${formatMeasure(measureIndex, hasRemoval ? previousMeasures : measures)}`;
  }

  const cursor = cursorBefore ?? cursorAfter;
  return cursor
    ? `Edit${formatMeasure(cursor.measureIndex, cursorBefore ? (previousMeasures ?? measures) : measures)}`
    : "Edit";
}

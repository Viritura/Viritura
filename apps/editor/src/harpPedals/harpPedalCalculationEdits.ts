import {
  compareChordSymbolPositions,
  generateUniqueId,
  type HarpPedalSetting,
  type Score,
  type SequenceContent,
} from "@viritura/core";
import type { HarpPedalSolution } from "@viritura/core";
import { produce } from "../score/scoreClone";

function samePosition(left: HarpPedalSetting, right: { measureIndex: number; fraction: [number, number] }): boolean {
  return left.position.fraction[0] * right.fraction[1] === right.fraction[0] * left.position.fraction[1];
}

function applySpellingEdits(content: SequenceContent[], edits: HarpPedalSolution["spellingEdits"]): void {
  for (const item of content) {
    if (item.type === "event") {
      if (!item.id) continue;
      for (const edit of edits) {
        if (item.id === edit.eventId && item.notes?.[edit.noteIndex]) {
          item.notes[edit.noteIndex]!.pitch = edit.pitch;
        }
      }
    } else if (item.type !== "space") {
      applySpellingEdits(item.content, edits);
    }
  }
}

export function applyHarpPedalSolution(score: Score, partIndex: number, solution: HarpPedalSolution): Score {
  const part = score.parts[partIndex];
  if (!part) throw new RangeError("The harp part no longer exists.");
  const existingIds = new Set(
    part.measures.flatMap((measure) => (measure.harpPedals ?? []).map((setting) => setting.id)),
  );
  const replacements = solution.settings.map((setting) => {
    const original = part.measures[setting.measureIndex]?.harpPedals?.find(
      (candidate) => candidate.source === "calculated" && samePosition(candidate, setting),
    );
    const id = original?.id ?? generateUniqueId(existingIds);
    existingIds.add(id);
    return {
      measureIndex: setting.measureIndex,
      setting: {
        ...original,
        id,
        position: { fraction: [...setting.fraction] },
        tuning: setting.tuning,
        source: "calculated",
      } satisfies HarpPedalSetting,
    };
  });
  return produce(score, (draft) => {
    const draftPart = draft.parts[partIndex]!;
    for (const measure of draftPart.measures) {
      if (measure.harpPedals)
        measure.harpPedals = measure.harpPedals.filter((setting) => setting.source !== "calculated");
    }
    for (const { measureIndex, setting } of replacements) {
      const measure = draftPart.measures[measureIndex]!;
      measure.harpPedals = [...(measure.harpPedals ?? []), setting].sort((left, right) =>
        compareChordSymbolPositions(left.position, right.position),
      );
    }
    for (const measure of draftPart.measures) {
      for (const sequence of measure.sequences) applySpellingEdits(sequence.content, solution.spellingEdits);
    }
  });
}

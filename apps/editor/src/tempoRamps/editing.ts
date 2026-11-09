import { generateId, type GradualTempo, type Score, type TempoRampCurve } from "@viritura/core";
import { buildTempoModel, playbackGlobalMeasures } from "@viritura/midi";
import { produce } from "../score/scoreClone";
import { ensureMeasureId } from "../score/spanUtils";
import { barBeats, type RampSpan } from "./selection";

export interface RampEdit extends RampSpan {
  targetMode: "ratio" | "absolute";
  target: number;
  curve: TempoRampCurve;
  text: string;
  startBpm?: number;
}

interface RampEditResult {
  score?: Score;
  error?: string;
}

function fraction(beat: number): [number, number] {
  return [Math.round(beat * 1_000_000), 4_000_000];
}

function removeOwnedText(score: Score, owner: number): void {
  const measure = score.global.measures[owner];
  const id = measure?.gradualTempo?.systemTextId;
  if (id && measure?.systemText) {
    measure.systemText = measure.systemText.filter((text) => text.id !== id);
    if (!measure.systemText.length) delete measure.systemText;
  }
}

export function removeTempoRamp(score: Score, owner: number): Score {
  return produce(score, (draft) => {
    removeOwnedText(draft, owner);
    const measure = draft.global.measures[owner];
    if (measure) delete measure.gradualTempo;
  });
}

function validateEdit(score: Score, edit: RampEdit): void {
  const points: [number, number][] = [
    [edit.startMeasure, edit.startBeat],
    [edit.endMeasure, edit.endBeat],
  ];
  for (const [index, beat] of points) {
    if (!Number.isInteger(index) || index < 0 || !score.global.measures[index]) {
      throw new RangeError("Choose bars within the score.");
    }
    if (!Number.isFinite(beat) || beat < 0 || beat > barBeats(score, index)) {
      throw new RangeError("Beat offsets must be within their bars.");
    }
  }
  if (!Number.isFinite(edit.target) || edit.target <= 0) {
    throw new RangeError("Target tempo must be greater than zero.");
  }
}

export function saveTempoRamp(score: Score, edit: RampEdit, owner?: number): RampEditResult {
  try {
    validateEdit(score, edit);
    const result = produce(score, (draft) => {
      const old = owner === undefined ? undefined : draft.global.measures[owner]?.gradualTempo;
      const oldText =
        owner === undefined
          ? undefined
          : draft.global.measures[owner]?.systemText?.find((text) => text.id === old?.systemTextId);
      const textId = old?.systemTextId ?? generateId();
      if (owner !== undefined) {
        removeOwnedText(draft, owner);
        delete draft.global.measures[owner]!.gradualTempo;
      }
      const measure = draft.global.measures[edit.startMeasure]!;
      if (measure.gradualTempo) throw new RangeError("Only one tempo ramp may start in a bar.");
      const ramp: GradualTempo = {
        position: { fraction: fraction(edit.startBeat) },
        end: {
          measure: ensureMeasureId(draft, edit.endMeasure),
          position: { fraction: fraction(edit.endBeat) },
        },
        ...(edit.targetMode === "ratio" ? { endRatio: edit.target / 100 } : { endBpm: edit.target }),
        curve: edit.curve,
        ...(old?.kind ? { kind: old.kind } : {}),
        ...(edit.startBpm !== undefined ? { startBpm: edit.startBpm } : {}),
      };
      if (edit.text.trim()) {
        ramp.systemTextId = textId;
        measure.systemText ??= [];
        measure.systemText.push({
          ...oldText,
          id: textId,
          text:
            oldText?.text.map((chunk) => ("text" in chunk ? chunk.text : "")).join("") === edit.text.trim()
              ? oldText.text
              : [{ text: edit.text.trim() }],
          position: ramp.position,
          placement: oldText?.placement ?? "above",
        });
      }
      measure.gradualTempo = ramp;
    });
    buildTempoModel(
      playbackGlobalMeasures(
        result,
        result.global.measures.map((_, index) => index),
      ),
    );
    return { score: result };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { error: error.message };
  }
}

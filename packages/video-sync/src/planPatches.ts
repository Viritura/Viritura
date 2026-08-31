/**
 * Turning a span plan into score edits.
 *
 * The plan says what the music between two hits should be; this works out the
 * smallest set of patches that makes the score agree, and — just as importantly
 * — reports what those patches would destroy before anything is applied.
 *
 * The safety model is the point of this module. Setting a tempo is reversible
 * and touches nothing; inserting, removing or re-metering bars can silently
 * damage music the composer has already written. So the two are separated:
 * tempo is always applied, structure only on an explicit opt-in, and the caller
 * is handed a count of exactly which written-in bars are at risk so the choice
 * is informed rather than brave.
 *
 * Meter is written only where it changes, matching how the score is engraved
 * and avoiding a restatement on every bar of the span.
 */

import type { GlobalMeasure, Score, ScorePatch, TimeSignature } from "@viritura/core";
import { planMeters, type SpanPlan } from "./spanPlan";

export interface ApplyPlanRequest {
  readonly score: Score;
  readonly plan: SpanPlan;
  /** 0-based index of the bar the span starts on. */
  readonly startMeasureIndex: number;
  /** How many bars the span currently occupies in the score. */
  readonly currentBars: number;
  /** Tempo derived from the plan. */
  readonly bpm: number;
  /** Whether bar counts and meters may be changed, not just the tempo. */
  readonly changeStructure: boolean;
}

export interface PlanApplication {
  readonly patches: readonly ScorePatch[];
  readonly insertedBars: number;
  readonly removedBars: number;
  /**
   * Bars that already contain music and would be disturbed.
   *
   * Empty does not mean the edit is free — it means nothing written would be
   * lost, which is the question a composer is actually asking.
   */
  readonly disturbedBars: readonly number[];
  /** Plain-language consequences, for display before applying. */
  readonly warnings: readonly string[];
}

/**
 * Quarter note, the unit MNX tempo marks are written against here.
 *
 * The plan derives a quarter-note tempo, so the mark has to say so; writing the
 * same number against a dotted quarter would play at a different speed.
 */
const QUARTER = { base: "quarter" } as const;

export function planPatches(request: ApplyPlanRequest): PlanApplication {
  const { score, plan, bpm, changeStructure } = request;
  const patches: ScorePatch[] = [];
  const warnings: string[] = [];

  const meters = planMeters(plan);
  const targetBars = meters.length;

  const measureCount = score.global.measures.length;
  const startMeasureIndex = Math.max(0, Math.min(request.startMeasureIndex, measureCount));
  // A span can sit wholly or partly past the end of the written music —
  // spotting the film before composing is the normal order of work — so the
  // bars it "currently holds" is however many actually exist under it.
  const currentBars = Math.max(0, Math.min(request.currentBars, measureCount - startMeasureIndex));
  const beyondEnd = startMeasureIndex >= measureCount;

  if (beyondEnd && !changeStructure) {
    // Nothing to write a tempo onto. Emitting the patch anyway targets a
    // measure that does not exist, which throws when applied.
    warnings.push(
      `This span is past the end of the score, so there are no bars to set a tempo on. ` +
        `Turn on “Change bars and meters too” to add them.`,
    );
    return { patches, insertedBars: 0, removedBars: 0, disturbedBars: [], warnings };
  }

  const insertedBars = changeStructure ? Math.max(0, targetBars - currentBars) : 0;
  const removedBars = changeStructure ? Math.max(0, currentBars - targetBars) : 0;

  // Bars that will be removed outright, plus bars whose meter changes under
  // existing music. Both can lose notes; neither is recoverable by undoing the
  // tempo alone.
  const disturbed = changeStructure
    ? disturbedBarIndices(score, startMeasureIndex, currentBars, targetBars, meters)
    : [];

  // Structure first, then fields. A span that starts past the end of the score
  // has no measure to carry a tempo until one has been inserted, and inserting
  // or removing *after* `startMeasureIndex` never shifts it, so the field
  // patches below address the same bars either way.
  if (removedBars > 0) {
    patches.push({
      kind: "removeMeasures",
      startIndex: startMeasureIndex + targetBars,
      count: removedBars,
    });
    warnings.push(`${removedBars} bar${removedBars === 1 ? "" : "s"} will be removed from the end of the span.`);
  }

  if (insertedBars > 0) {
    patches.push({
      kind: "insertMeasures",
      atIndex: startMeasureIndex + currentBars,
      globalMeasures: Array.from({ length: insertedBars }, (): GlobalMeasure => ({})),
    });
  }

  patches.push({
    kind: "setGlobalMeasureField",
    measureIndex: startMeasureIndex,
    update: { field: "tempos", value: [{ bpm, value: QUARTER }] },
  });

  if (!changeStructure) {
    if (targetBars !== currentBars) {
      warnings.push(
        `The plan is ${targetBars} bars but the span currently holds ${currentBars}. ` +
          `Only the tempo will change; the span will not end on the marker.`,
      );
    }
    return { patches, insertedBars: 0, removedBars: 0, disturbedBars: [], warnings };
  }

  // Meter is written only where it changes, which means comparing against the
  // meter in force just before the span, not against each bar's own field.
  let inForce = meterInForce(score, startMeasureIndex);
  meters.forEach((meter, offset) => {
    if (sameMeter(meter, inForce)) return;
    patches.push({
      kind: "setGlobalMeasureField",
      measureIndex: startMeasureIndex + offset,
      update: { field: "time", value: { ...meter } },
    });
    inForce = meter;
  });

  if (disturbed.length > 0) {
    warnings.push(
      `${disturbed.length} bar${disturbed.length === 1 ? "" : "s"} in this span already contain music ` +
        `that may not fit the new bar lengths.`,
    );
  }

  return { patches, insertedBars, removedBars, disturbedBars: disturbed, warnings };
}

/** The time signature in force immediately before `measureIndex`. */
function meterInForce(score: Score, measureIndex: number): TimeSignature | undefined {
  for (let i = Math.min(measureIndex, score.global.measures.length) - 1; i >= 0; i -= 1) {
    const time = score.global.measures[i]?.time;
    if (time) return time;
  }
  return undefined;
}

function sameMeter(a: TimeSignature | undefined, b: TimeSignature | undefined): boolean {
  if (!a || !b) return false;
  return a.count === b.count && a.unit === b.unit;
}

/**
 * Bars in the span that hold music and would be re-metered or removed.
 *
 * A bar holding nothing but rests is not counted: re-metering it costs the
 * composer nothing, and warning about it would make the warning meaningless in
 * the common case of planning ahead of the writing.
 */
function disturbedBarIndices(
  score: Score,
  startMeasureIndex: number,
  currentBars: number,
  targetBars: number,
  meters: readonly TimeSignature[],
): number[] {
  const disturbed: number[] = [];
  const inspectTo = Math.max(currentBars, targetBars);
  let inForce = meterInForce(score, startMeasureIndex);

  for (let offset = 0; offset < inspectTo; offset += 1) {
    const index = startMeasureIndex + offset;
    if (index >= score.global.measures.length) break;

    const existing = score.global.measures[index]?.time ?? inForce;
    const planned = meters[offset];
    if (existing) inForce = existing;

    const removed = offset >= targetBars;
    const remetered = planned !== undefined && !sameMeter(planned, existing);
    if (!removed && !remetered) continue;
    if (barHasMusic(score, index)) disturbed.push(index);
  }

  return disturbed;
}

/** Whether any part writes something other than rests in this bar. */
function barHasMusic(score: Score, measureIndex: number): boolean {
  return score.parts.some((part) =>
    part.measures[measureIndex]?.sequences?.some((sequence) =>
      sequence.content?.some((item) => item.type === "event" && (item.notes?.length ?? 0) > 0),
    ),
  );
}

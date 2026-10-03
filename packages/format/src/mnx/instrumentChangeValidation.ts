/**
 * Cross-object checks for the provisional instrument-change extensions
 * (`_x.viritura.instruments` / `initialInstrument` on a part and
 * `_x.viritura.instrumentChanges` on its measures) that JSON Schema cannot
 * express.
 */

import type { Root as RawScore } from "@viritura/core/raw";
import type { InstrumentTransposition, PartExtensions, PartMeasureExtensions } from "@viritura/core/raw-viritura";

interface InstrumentChangeValidationError {
  pointer: string;
  message: string;
  keyword: string;
}

type IntervalLike = Pick<InstrumentTransposition, "interval"> | undefined;

function sameInterval(a: IntervalLike, b: IntervalLike): boolean {
  return (
    (a?.interval.halfSteps ?? 0) === (b?.interval.halfSteps ?? 0) &&
    (a?.interval.staffDistance ?? 0) === (b?.interval.staffDistance ?? 0)
  );
}

function pointerToken(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function validateInstrumentChanges(score: RawScore): InstrumentChangeValidationError[] {
  const errors: InstrumentChangeValidationError[] = [];
  score.parts.forEach((part, partIndex) => {
    const extPointer = `/parts/${partIndex}/_x/viritura`;
    const ext = part._x?.["viritura"] as PartExtensions | undefined;
    const instruments = ext?.instruments;
    const initialKey = ext?.initialInstrument;

    if (instruments && initialKey === undefined) {
      errors.push({
        pointer: `${extPointer}/initialInstrument`,
        message: "is required when the part declares instruments",
        keyword: "required",
      });
    }
    if (initialKey !== undefined) {
      const initial = instruments && Object.hasOwn(instruments, initialKey) ? instruments[initialKey] : undefined;
      if (!initial) {
        errors.push({
          pointer: `${extPointer}/initialInstrument`,
          message: `must reference an instrument on this part ('${initialKey}' was not found)`,
          keyword: "reference",
        });
      } else {
        if (ext?.instrumentId !== undefined && ext.instrumentId !== initial.instrumentId) {
          errors.push({
            pointer: `${extPointer}/instrumentId`,
            message: `must match the initial instrument's instrumentId ('${initial.instrumentId}')`,
            keyword: "consistency",
          });
        }
        if (!sameInterval(part.transposition, initial.transposition)) {
          errors.push({
            pointer: `${extPointer}/instruments/${pointerToken(initialKey)}/transposition`,
            message: "must match the part transposition for the initial instrument",
            keyword: "consistency",
          });
        }
      }
    }

    part.measures.forEach((measure, measureIndex) => {
      const measureExt = measure._x?.["viritura"] as PartMeasureExtensions | undefined;
      const seenPositions = new Set<string>();
      measureExt?.instrumentChanges?.forEach((change, changeIndex) => {
        const changePointer = `/parts/${partIndex}/measures/${measureIndex}/_x/viritura/instrumentChanges/${changeIndex}`;
        if (change.instrument === undefined && change.transposition === undefined) {
          errors.push({
            pointer: changePointer,
            message: "must set instrument, transposition, or both",
            keyword: "required",
          });
        }
        if (change.instrument !== undefined && (!instruments || !Object.hasOwn(instruments, change.instrument))) {
          errors.push({
            pointer: `${changePointer}/instrument`,
            message: `must reference an instrument on this part ('${change.instrument}' was not found)`,
            keyword: "reference",
          });
        }
        const [numerator, denominator] = change.position?.fraction ?? [0, 1];
        if (numerator === undefined || denominator === undefined || numerator < 0 || denominator <= 0) {
          errors.push({
            pointer: `${changePointer}/position`,
            message: "must be a non-negative fraction with a positive denominator",
            keyword: "range",
          });
          return;
        }
        const key = `${numerator / denominator}`;
        if (seenPositions.has(key)) {
          errors.push({
            pointer: `${changePointer}/position`,
            message: "must not repeat the position of another instrument change in this measure",
            keyword: "uniquePosition",
          });
        }
        seenPositions.add(key);
      });
    });
  });
  return errors;
}

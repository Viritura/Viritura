/**
 * Sequence-level recovery for imported MNX documents.
 *
 * A single malformed event (for example a tuplet whose content does not fill
 * its declared inner duration) makes its sequence ambiguous, but it should not
 * prevent every other part, measure, and voice from loading. This module
 * empties only the sequences that fail validation, removes references to the
 * discarded events, and optionally marks each emptied sequence with a text
 * expression that names the matching error-log entry.
 *
 * Errors outside a sequence (document structure, global measures, part
 * metadata) are not recoverable here and are returned to the caller.
 */

import { validateRawScore, type RawScoreValidationError, type RawScoreValidationResult } from "./validator";

/** One sequence emptied because it failed validation. */
export interface RecoveredSequence {
  /** Stable log identifier, e.g. `E1`, also used in the in-score marker. */
  logId: string;
  partIndex: number;
  partId?: string;
  partName?: string;
  measureIndex: number;
  /** Global measure id, when the source provided one. */
  measureId?: string;
  sequenceIndex: number;
  staff: number;
  voice?: string;
  /** Ids of events, notes, and kit notes that were discarded. */
  discardedIds: string[];
  /** Validation failures that caused the sequence to be emptied. */
  errors: RawScoreValidationError[];
}

export interface RecoverInvalidSequencesOptions {
  /** Add a text expression referencing the log id to each emptied sequence. Default: true. */
  annotate?: boolean;
  /** Prefix for generated log ids. Default: `E`. */
  logIdPrefix?: string;
}

export interface SequenceRecoveryResult {
  /** Recovered document (a copy when anything was changed, otherwise the input). */
  document: unknown;
  recovered: RecoveredSequence[];
  /** Validation of the recovered document; `ok: false` means unrecoverable errors remain. */
  validation: RawScoreValidationResult;
}

type JsonObject = Record<string, unknown>;

const SEQUENCE_POINTER = /^\/parts\/(\d+)\/measures\/(\d+)\/sequences\/(\d+)(?:\/|$)/;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asObject).filter((item): item is JsonObject => item !== undefined) : [];
}

function itemAt(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
}

function stringField(object: JsonObject | undefined, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === "string" ? value : undefined;
}

function collectIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectIds(item, ids));
    return;
  }
  const object = asObject(value);
  if (!object) return;
  const id = stringField(object, "id");
  if (id) ids.add(id);
  for (const key of ["content", "notes", "kitNotes"]) collectIds(object[key], ids);
}

function referencesDiscarded(object: JsonObject, discarded: ReadonlySet<string>): boolean {
  return ["target", "startNote", "endNote"].some((key) => {
    const value = stringField(object, key);
    return value !== undefined && discarded.has(value);
  });
}

/** Remove array entries (ties, slurs, glissandi, …) whose target was discarded. */
function pruneReferences(value: unknown, discarded: ReadonlySet<string>): void {
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const object = asObject(value[index]);
      if (object && referencesDiscarded(object, discarded)) value.splice(index, 1);
      else pruneReferences(value[index], discarded);
    }
    return;
  }
  const object = asObject(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    if (key === "_x") continue;
    pruneReferences(child, discarded);
  }
}

/** Remove beams that include any discarded event; returns the surviving list. */
function pruneBeams(beams: unknown, discarded: ReadonlySet<string>): unknown[] {
  return asObjects(beams)
    .filter((beam) => {
      const events = Array.isArray(beam["events"]) ? beam["events"] : [];
      return !events.some((event) => typeof event === "string" && discarded.has(event));
    })
    .map((beam) => (Array.isArray(beam["beams"]) ? { ...beam, beams: pruneBeams(beam["beams"], discarded) } : beam));
}

function sequenceKey(partIndex: number, measureIndex: number, sequenceIndex: number): string {
  return `${partIndex}/${measureIndex}/${sequenceIndex}`;
}

function annotate(root: JsonObject, entry: RecoveredSequence): void {
  const part = asObject(itemAt(root["parts"], entry.partIndex));
  const measure = asObject(itemAt(part?.["measures"], entry.measureIndex));
  if (!measure) return;
  const x = asObject(measure["_x"]) ?? {};
  const viritura = asObject(x["viritura"]) ?? {};
  const expressions = Array.isArray(viritura["expressions"]) ? viritura["expressions"] : [];
  const marker: JsonObject = {
    text: `Import error ${entry.logId}`,
    position: { fraction: [0, 1] },
    placement: "above",
    staff: entry.staff,
  };
  if (entry.voice !== undefined) marker["voice"] = entry.voice;
  measure["_x"] = { ...x, viritura: { ...viritura, expressions: [...expressions, marker] } };
}

interface SequenceErrors {
  indices: [partIndex: number, measureIndex: number, sequenceIndex: number];
  errors: RawScoreValidationError[];
}

/** Group errors by the sequence they point into, skipping sequences already emptied. */
function groupBySequence(
  errors: readonly RawScoreValidationError[],
  emptied: ReadonlySet<string>,
): Map<string, SequenceErrors> {
  const groups = new Map<string, SequenceErrors>();
  for (const error of errors) {
    const match = SEQUENCE_POINTER.exec(error.pointer);
    if (!match) continue;
    const indices: SequenceErrors["indices"] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const key = sequenceKey(...indices);
    if (emptied.has(key)) continue;
    const group = groups.get(key);
    if (group) group.errors.push(error);
    else groups.set(key, { indices, errors: [error] });
  }
  return groups;
}

/** Empty one sequence in place and describe what was removed. */
function emptySequence(
  document: JsonObject,
  { indices, errors }: SequenceErrors,
  logId: string,
  discarded: Set<string>,
): RecoveredSequence | undefined {
  const [partIndex, measureIndex, sequenceIndex] = indices;
  const part = asObject(itemAt(document["parts"], partIndex));
  const measure = asObject(itemAt(part?.["measures"], measureIndex));
  const sequences = measure?.["sequences"];
  if (!Array.isArray(sequences) || sequenceIndex >= sequences.length) return undefined;
  const sequence = asObject(sequences[sequenceIndex]) ?? {};
  sequences[sequenceIndex] = sequence;
  const ids = new Set<string>();
  collectIds(sequence["content"], ids);
  ids.forEach((id) => discarded.add(id));
  sequence["content"] = [];

  const partId = stringField(part, "id");
  const partName = stringField(part, "name");
  const measureId = stringField(asObject(itemAt(asObject(document["global"])?.["measures"], measureIndex)), "id");
  const voice = stringField(sequence, "voice");
  return {
    logId,
    partIndex,
    ...(partId !== undefined ? { partId } : {}),
    ...(partName !== undefined ? { partName } : {}),
    measureIndex,
    ...(measureId !== undefined ? { measureId } : {}),
    sequenceIndex,
    staff: typeof sequence["staff"] === "number" ? sequence["staff"] : 1,
    ...(voice !== undefined ? { voice } : {}),
    discardedIds: [...ids],
    errors,
  };
}

function pruneDiscarded(document: JsonObject, discarded: ReadonlySet<string>): void {
  for (const part of asObjects(document["parts"])) {
    for (const measure of asObjects(part["measures"])) {
      if (Array.isArray(measure["beams"])) measure["beams"] = pruneBeams(measure["beams"], discarded);
      pruneReferences(measure["sequences"], discarded);
    }
  }
}

/**
 * Validate `json` and empty every sequence that contains a validation error.
 * Repeats until the document validates or only non-sequence errors remain.
 * The input is never mutated.
 */
export function recoverInvalidSequences(
  json: unknown,
  options: RecoverInvalidSequencesOptions = {},
): SequenceRecoveryResult {
  const initial = validateRawScore(json);
  if (initial.ok || !asObject(json)) return { document: json, recovered: [], validation: initial };

  const document = structuredClone(json) as JsonObject;
  const prefix = options.logIdPrefix ?? "E";
  const recovered: RecoveredSequence[] = [];
  const emptied = new Set<string>();
  const discarded = new Set<string>();
  let validation: RawScoreValidationResult = initial;

  while (!validation.ok) {
    const groups = groupBySequence(validation.errors, emptied);
    if (groups.size === 0) break;
    for (const [key, group] of groups) {
      emptied.add(key);
      const entry = emptySequence(document, group, `${prefix}${recovered.length + 1}`, discarded);
      if (entry) recovered.push(entry);
    }
    pruneDiscarded(document, discarded);
    validation = validateRawScore(document);
  }

  if (recovered.length === 0) return { document: json, recovered, validation };

  if (validation.ok && options.annotate !== false) {
    const annotated = structuredClone(document);
    recovered.forEach((entry) => annotate(annotated, entry));
    const annotatedValidation = validateRawScore(annotated);
    if (annotatedValidation.ok) return { document: annotated, recovered, validation: annotatedValidation };
  }
  return { document, recovered, validation };
}

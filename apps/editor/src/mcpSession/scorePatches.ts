import type { Note, ScorePatch, SequenceContent } from "@viritura/core";
import type { SequenceContent as RawSequenceContent } from "@viritura/core/raw";
import { parseRawSequenceContent, serializeSequenceContent } from "@viritura/format";
import type { ErrorObject } from "ajv/dist/2020";
import {
  scorePatchValidators,
  validateMnxSequenceContent,
  validateModelNote,
  validateModelSequenceContent,
} from "./scorePatchValidator.generated";

type PatchValidator = ((value: unknown) => boolean) & { errors?: readonly ErrorObject[] | null };

export function readScorePatches(input: readonly unknown[]): ScorePatch[] {
  return input.map((value, index) => {
    if (!isObject(value) || typeof value.kind !== "string") {
      throw new Error(`Patch ${index} must be an object with a kind discriminator.`);
    }
    if (!Object.hasOwn(scorePatchValidators, value.kind)) {
      throw new Error(`Patch ${index} has unknown kind "${value.kind}".`);
    }
    const validator: PatchValidator = scorePatchValidators[value.kind as keyof typeof scorePatchValidators];
    if (!validator(value)) {
      const details = (validator.errors ?? [])
        .slice(0, 4)
        .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
        .join("; ");
      throw new Error(`Patch ${index} (${value.kind}) is invalid: ${details}`);
    }
    const patch = structuredClone(value);
    if (patch.kind === "setSequenceContent" || patch.kind === "spliceSequenceContent") {
      const field = patch.kind === "setSequenceContent" ? "content" : "insert";
      patch[field] = normalizeSequenceContent(patch[field]);
    } else if (patch.kind === "addNoteToEvent") {
      patch.note = normalizeNote(patch.note);
    }
    if (!isValidatedScorePatch(patch)) throw new Error(`Patch ${index} failed normalization.`);
    return patch;
  });
}

function isValidatedScorePatch(value: unknown): value is ScorePatch {
  if (!isObject(value) || typeof value.kind !== "string" || !Object.hasOwn(scorePatchValidators, value.kind)) {
    return false;
  }
  const validator: PatchValidator = scorePatchValidators[value.kind as keyof typeof scorePatchValidators];
  return validator(value);
}

function normalizeSequenceContent(value: unknown): SequenceContent[] {
  if (!Array.isArray(value)) throw new Error("Sequence content must be an array.");
  if (isMnxSequenceContent(value)) {
    const parsed = parseRawSequenceContent(value);
    assertPreserved(value, parsed.map(serializeSequenceContent), "content");
    return parsed;
  }
  if (!isModelSequenceContent(value)) {
    throw new Error("Sequence content mixes MNX wire data with internal-only fields or contains invalid MNX.");
  }
  const serialized = value.map(serializeSequenceContent);
  if (!isMnxSequenceContent(serialized))
    throw new Error("Internal sequence content cannot be serialized as valid MNX.");
  assertPreserved(value, parseRawSequenceContent(serialized), "content");
  return value;
}

function normalizeNote(value: unknown): unknown {
  const content = [{ duration: { base: "quarter" }, notes: [value] }];
  if (isMnxSequenceContent(content)) {
    const parsed = parseRawSequenceContent(content);
    assertPreserved(content, parsed.map(serializeSequenceContent), "note");
    const event = parsed[0];
    if (event?.type !== "event" || !event.notes?.[0]) throw new Error("Could not normalize note.");
    return event.notes[0];
  }
  if (!isModelNote(value)) throw new Error("The note mixes MNX wire data with internal-only fields or is invalid.");
  const serialized = [serializeSequenceContent({ type: "event", duration: { base: "quarter" }, notes: [value] })];
  if (!isMnxSequenceContent(serialized)) throw new Error("The internal note cannot be serialized as valid MNX.");
  const event = parseRawSequenceContent(serialized)[0];
  if (event?.type !== "event" || !event.notes?.[0]) throw new Error("Could not normalize note.");
  assertPreserved(value, event.notes[0], "note");
  return value;
}

function isMnxSequenceContent(value: unknown): value is RawSequenceContent {
  return Boolean(validateMnxSequenceContent(value));
}

function isModelSequenceContent(value: unknown): value is SequenceContent[] {
  return Boolean(validateModelSequenceContent(value));
}

function isModelNote(value: unknown): value is Note {
  return Boolean(validateModelNote(value));
}

function assertPreserved(original: unknown, serialized: unknown, path: string): void {
  if (Array.isArray(original)) {
    if (!Array.isArray(serialized) || original.length !== serialized.length) {
      throw new Error(`MNX ${path} cannot be round-tripped without losing data.`);
    }
    original.forEach((value, index) => assertPreserved(value, serialized[index], `${path}/${index}`));
    return;
  }
  if (isObject(original)) {
    if (!isObject(serialized)) throw new Error(`MNX ${path} cannot be round-tripped without losing data.`);
    for (const [key, value] of Object.entries(original)) {
      if (key === "type" && value === "event" && serialized[key] === undefined) continue;
      assertPreserved(value, serialized[key], `${path}/${key}`);
    }
    return;
  }
  if (original !== serialized) throw new Error(`MNX ${path} cannot be round-tripped without losing data.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import type { ErrorObject, ValidateFunction } from "ajv/dist/2020";
import type { RawScoreValidationError } from "./validator";
import { mnxEvent, mnxGrace, mnxTuplet, mnxSpace, mnxTremolo } from "./standaloneValidators";

type ContentValidator = ((data: unknown) => boolean) & Pick<ValidateFunction, "errors">;

const contentValidators: Record<string, ContentValidator> = {
  event: mnxEvent,
  grace: mnxGrace,
  tuplet: mnxTuplet,
  space: mnxSpace,
  tremolo: mnxTremolo,
};
const SEQUENCE_ITEM = /^\/parts\/\d+\/measures\/\d+\/sequences\/\d+\/content\/\d+(?=\/|$)/;
const NESTED_ITEM = /^\/content\/\d+(?=\/|$)/;

function valueAtPointer(value: unknown, pointer: string): unknown {
  for (const token of pointer.split("/").slice(1)) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function normaliseError(error: ErrorObject, prefix = ""): RawScoreValidationError {
  const pointer = `${prefix}${error.instancePath}`;
  let message = error.message ?? "(no message)";
  const property: unknown = error.params["unevaluatedProperty"] ?? error.params["additionalProperty"];
  if (typeof property === "string") {
    message = `must NOT have unrecognized property '${property}'`;
  } else if (error.keyword === "type" && error.params["type"] === "object" && /\/_x\/[^/]+$/.test(pointer)) {
    message =
      "must be a vendor dictionary (object); _x maps vendor namespaces to dictionaries, for example _x: { yourApp: { ... } }";
  } else if (error.keyword === "type" && error.params["type"] === "integer" && /\/pitch\/alter$/.test(pointer)) {
    message =
      "must be an integer number of semitones; fractional microtonal alterations are not supported by the MNX schema";
  } else if (error.keyword === "const") {
    message = `must equal ${JSON.stringify(error.params["allowedValue"])}`;
  }
  return { pointer: pointer || "(root)", message, keyword: error.keyword };
}

export function normaliseErrors(errors: ErrorObject[] | null | undefined): RawScoreValidationError[] {
  return (errors ?? []).map((error) => normaliseError(error));
}

function diagnoseContent(value: unknown, pointer: string, eventOnly = false): RawScoreValidationError[] {
  const type = valueAtPointer(value, "/type");
  const kind = type === undefined ? "event" : type;
  const validate = eventOnly
    ? contentValidators["event"]
    : typeof kind === "string" && Object.hasOwn(contentValidators, kind)
      ? contentValidators[kind]
      : undefined;
  if (!validate) {
    return [
      {
        pointer: `${pointer}/type`,
        keyword: "enum",
        message:
          "must be a recognized sequence content type: 'event' (or omitted), 'grace', 'tuplet', 'space', or 'tremolo'",
      },
    ];
  }
  if (validate(value)) return [];
  const errors = [...(validate.errors ?? [])];
  const nested = !eventOnly && (kind === "grace" || kind === "tuplet" || kind === "tremolo");
  const emitted = new Set<string>();
  const result: RawScoreValidationError[] = [];
  for (const error of errors) {
    const childPointer = nested ? NESTED_ITEM.exec(error.instancePath)?.[0] : undefined;
    if (!childPointer) {
      result.push(normaliseError(error, pointer));
    } else if (!emitted.has(childPointer)) {
      emitted.add(childPointer);
      result.push(
        ...diagnoseContent(valueAtPointer(value, childPointer), `${pointer}${childPointer}`, kind === "grace"),
      );
    }
  }
  return result;
}

/** Explain the intended content branch, not every failed alternative in MNX's anyOf. */
export function diagnoseMnxSchemaErrors(
  document: unknown,
  errors: ErrorObject[] | null | undefined,
): RawScoreValidationError[] {
  const emitted = new Set<string>();
  const result: RawScoreValidationError[] = [];
  for (const error of errors ?? []) {
    const pointer = SEQUENCE_ITEM.exec(error.instancePath)?.[0];
    if (!pointer) {
      result.push(normaliseError(error));
    } else if (!emitted.has(pointer)) {
      emitted.add(pointer);
      const contentErrors = diagnoseContent(valueAtPointer(document, pointer), pointer);
      result.push(...(contentErrors.length > 0 ? contentErrors : [normaliseError(error)]));
    }
  }
  const unique = new Map(result.map((error) => [JSON.stringify(error), error]));
  return [...unique.values()];
}

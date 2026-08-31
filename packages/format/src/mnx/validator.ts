/**
 * Runtime validation of unknown JSON against the MNX JSON Schema.
 *
 * This is the runtime counterpart to {@link @viritura/core/raw}: the
 * generated types describe the shape, this module proves a value
 * inhabits that shape at runtime. Together they form the only safe
 * boundary at which `unknown` can be narrowed to {@link RawScore}.
 *
 * Architecture: the MNX schema is the single source of truth. The
 * generator script (`pnpm gen:raw`) copies the schema into
 * `@viritura/core/raw/mnx-schema.json` alongside the generated types, so this
 * module never duplicates schema files between packages.
 *
 * The Ajv validator is lazy-initialised on first use (compiling a draft
 * 2020-12 schema is not free).
 */

import Ajv2020, { type ValidateFunction, type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import mnxSchema from "@viritura/core/raw/mnx-schema.json" with { type: "json" };
import virituraExtensionsSchema from "../../schemas/viritura-extensions.json" with { type: "json" };
import type { Root as RawScore } from "@viritura/core/raw";
import { isSupportedDynamicGlyph } from "@viritura/core";

let cachedValidator: ValidateFunction | null = null;
const cachedVirituraExtensionsValidators = new Map<string, ValidateFunction>();

function getValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;
  // `strict: false` because the MNX schema uses keywords (e.g.
  // unevaluatedProperties contexts) that Ajv would otherwise warn on;
  // we want validation behavior, not lint warnings. `allErrors` so the
  // full diagnostic set is available, not just the first failure.
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  cachedValidator = ajv.compile(mnxSchema as unknown as object);
  return cachedValidator;
}

function getVirituraExtensionsValidator(definition: string): ValidateFunction {
  const cached = cachedVirituraExtensionsValidators.get(definition);
  if (cached) return cached;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validator = ajv.compile({
    ...virituraExtensionsSchema,
    $ref: `#/$defs/${definition}`,
  });
  cachedVirituraExtensionsValidators.set(definition, validator);
  return validator;
}

/** A single schema-validation failure, normalised for caller consumption. */
export interface RawScoreValidationError {
  /** JSON pointer to the offending location (e.g. `/parts/0/measures/2`). */
  pointer: string;
  /** Human-readable Ajv message (e.g. `must have required property 'mnx'`). */
  message: string;
  /** Ajv keyword that failed (e.g. `required`, `enum`, `type`). */
  keyword: string;
}

/** Result of {@link validateRawScore}. */
export type RawScoreValidationResult =
  | { ok: true; value: RawScore }
  | { ok: false; errors: readonly RawScoreValidationError[] };

/**
 * Validate `json` against the MNX JSON Schema and return either the
 * (now-typed) value or a structured error list.
 */
export function validateRawScore(json: unknown): RawScoreValidationResult {
  const validate = getValidator();
  const ok = validate(json);
  if (ok) {
    const value = json as RawScore;
    const extensionErrors = validateVirituraExtensions(json);
    if (extensionErrors.length > 0) return { ok: false, errors: extensionErrors };
    const semanticErrors = [...validateDynamicGroups(value), ...validateKitReferences(value)];
    if (semanticErrors.length > 0) return { ok: false, errors: semanticErrors };
    return { ok: true, value };
  }

  return { ok: false, errors: normaliseErrors(validate.errors) };
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asObject).filter((item): item is JsonObject => item !== undefined) : [];
}

function pointerToken(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function validateVirituraExtensions(document: unknown): RawScoreValidationError[] {
  const root = asObject(document);
  if (!root) return [];
  const errors: RawScoreValidationError[] = [];
  const consumed = new Set<string>();

  const validateAt = (object: JsonObject | undefined, pointer: string, definition: string): void => {
    const extensionContainer = asObject(object?.["_x"]);
    if (!extensionContainer || !("viritura" in extensionContainer)) return;
    const extension = extensionContainer["viritura"];
    const extensionPointer = `${pointer}/_x/viritura`;
    consumed.add(extensionPointer);
    const validate = getVirituraExtensionsValidator(definition);
    if (validate(extension)) return;
    errors.push(
      ...normaliseErrors(validate.errors).map((error) => ({
        ...error,
        pointer: `${extensionPointer}${error.pointer === "(root)" ? "" : error.pointer}`,
      })),
    );
  };

  const visitContent = (content: unknown, pointer: string): void => {
    if (!Array.isArray(content)) return;
    content.forEach((item, index) => {
      const object = asObject(item);
      if (!object) return;
      const itemPointer = `${pointer}/${index}`;
      const type = object["type"];
      if (type !== "grace" && type !== "tuplet" && type !== "space" && type !== "tremolo") {
        validateAt(object, itemPointer, "event-extensions");
        const markings = asObject(object["markings"]);
        validateAt(markings, `${itemPointer}/markings`, "event-markings-extensions");
        asObjects(object["notes"]).forEach((note, noteIndex) =>
          validateAt(note, `${itemPointer}/notes/${noteIndex}`, "note-extensions"),
        );
        asObjects(object["slurs"]).forEach((slur, slurIndex) =>
          validateAt(slur, `${itemPointer}/slurs/${slurIndex}`, "slur-extensions"),
        );
      }
      visitContent(object["content"], `${itemPointer}/content`);
    });
  };

  validateAt(root, "", "root-extensions");
  const global = asObject(root["global"]);
  asObjects(global?.["measures"]).forEach((measure, measureIndex) => {
    const measurePointer = `/global/measures/${measureIndex}`;
    validateAt(measure, measurePointer, "measure-global-extensions");
    validateAt(asObject(measure["key"]), `${measurePointer}/key`, "key-extensions");
    asObjects(measure["tempos"]).forEach((tempo, tempoIndex) =>
      validateAt(tempo, `${measurePointer}/tempos/${tempoIndex}`, "tempo-extensions"),
    );
  });

  asObjects(root["parts"]).forEach((part, partIndex) => {
    const partPointer = `/parts/${partIndex}`;
    validateAt(part, partPointer, "part-extensions");
    const kit = asObject(part["kit"]);
    for (const [componentId, component] of Object.entries(kit ?? {})) {
      validateAt(asObject(component), `${partPointer}/kit/${pointerToken(componentId)}`, "kit-component-extensions");
    }
    asObjects(part["measures"]).forEach((measure, measureIndex) => {
      const measurePointer = `${partPointer}/measures/${measureIndex}`;
      validateAt(measure, measurePointer, "part-measure-extensions");
      asObjects(measure["dynamics"]).forEach((dynamic, dynamicIndex) =>
        validateAt(dynamic, `${measurePointer}/dynamics/${dynamicIndex}`, "dynamic-group-extensions"),
      );
      asObjects(measure["sequences"]).forEach((sequence, sequenceIndex) =>
        visitContent(sequence["content"], `${measurePointer}/sequences/${sequenceIndex}/content`),
      );
    });
  });

  asObjects(root["layouts"]).forEach((layout, index) =>
    validateAt(layout, `/layouts/${index}`, "system-layout-extensions"),
  );
  asObjects(root["scores"]).forEach((score, index) => validateAt(score, `/scores/${index}`, "score-extensions"));

  const findUnsupported = (value: unknown, pointer: string): void => {
    const object = asObject(value);
    if (!object) {
      if (Array.isArray(value)) value.forEach((item, index) => findUnsupported(item, `${pointer}/${index}`));
      return;
    }
    const extensionContainer = asObject(object["_x"]);
    if (extensionContainer && "viritura" in extensionContainer) {
      const extensionPointer = `${pointer}/_x/viritura`;
      if (!consumed.has(extensionPointer)) {
        errors.push({
          pointer: extensionPointer,
          message: "Viritura extensions are not supported at this MNX object location",
          keyword: "extensionLocation",
        });
      }
    }
    for (const [key, child] of Object.entries(object)) {
      if (key !== "_x") findUnsupported(child, `${pointer}/${pointerToken(key)}`);
    }
  };
  findUnsupported(root, "");
  return errors;
}

/**
 * Runtime type guard: returns true iff `json` validates against the MNX
 * schema. Use this when you need a `json is RawScore` narrowing in a
 * conditional (e.g. branching on user-supplied input). For most parser
 * paths prefer {@link assertRawScore} or {@link validateRawScore}, which
 * surface the failure details.
 */
export function isRawScore(json: unknown): json is RawScore {
  return validateRawScore(json).ok;
}

/**
 * Runtime assertion: throws a {@link RawScoreValidationFailure} if
 * `json` does not validate against the MNX schema. On success, narrows
 * `json` to {@link RawScore}.
 */
export function assertRawScore(json: unknown): asserts json is RawScore {
  const result = validateRawScore(json);
  if (!result.ok) {
    throw new RawScoreValidationFailure(result.errors);
  }
}

/**
 * Error thrown by {@link assertRawScore}. Carries the full diagnostic
 * list so callers (parser, importer, API boundary) can render their own
 * UX instead of just a string.
 */
export class RawScoreValidationFailure extends Error {
  readonly errors: readonly RawScoreValidationError[];

  constructor(errors: readonly RawScoreValidationError[]) {
    super(formatErrorSummary(errors));
    this.name = "RawScoreValidationFailure";
    this.errors = errors;
  }
}

function normaliseErrors(errors: ErrorObject[] | null | undefined): RawScoreValidationError[] {
  if (!errors) return [];
  return errors.map((e) => ({
    pointer: e.instancePath || "(root)",
    message: e.message ?? "(no message)",
    keyword: e.keyword,
  }));
}

/** Validate dynamic-group requirements currently expressed only by MNX prose. */
function validateDynamicGroups(score: RawScore): RawScoreValidationError[] {
  const errors: RawScoreValidationError[] = [];
  const measureIds = new Set(score.global.measures.flatMap((measure) => (measure.id ? [measure.id] : [])));
  const groupIds = new Set<string>();

  score.parts.forEach((part, partIndex) => {
    const staffCount = part.staves ?? 1;
    part.measures.forEach((measure, measureIndex) => {
      measure.dynamics?.forEach((group, groupIndex) => {
        const pointer = `/parts/${partIndex}/measures/${measureIndex}/dynamics/${groupIndex}`;
        const requireField = (present: boolean, field: string): void => {
          if (!present) {
            errors.push({ pointer, message: `${group.type} dynamic group requires '${field}'`, keyword: "required" });
          }
        };

        if (group.type === "immediate" || group.type === "accent") {
          requireField(group.value !== undefined, "value");
        } else if (group.type === "gradual") {
          requireField(group.end !== undefined, "end");
          requireField(group.wedgeType !== undefined, "wedgeType");
        } else if (group.type === "relative") {
          requireField(group.relativeValue !== undefined, "relativeValue");
        }

        if (group.id) {
          if (groupIds.has(group.id)) {
            errors.push({ pointer: `${pointer}/id`, message: "must be unique", keyword: "unique" });
          }
          groupIds.add(group.id);
        }

        if (group.end && !measureIds.has(group.end.measure)) {
          errors.push({
            pointer: `${pointer}/end/measure`,
            message: "must reference an existing global measure id",
            keyword: "reference",
          });
        }
        if (group.staff !== undefined && (group.staff < 1 || group.staff > staffCount)) {
          errors.push({
            pointer: `${pointer}/staff`,
            message: `must address a staff between 1 and ${staffCount}`,
            keyword: "range",
          });
        }
        if (group.orient === "between") {
          const hasPair = group.staff !== undefined ? group.staff < staffCount : staffCount === 2;
          if (!hasPair) {
            errors.push({
              pointer: `${pointer}/orient`,
              message: "'between' requires an adjacent staff pair; specify staff for parts with more than two staves",
              keyword: "placement",
            });
          }
        }
        group.glyphs?.forEach((glyph, glyphIndex) => {
          if (!isSupportedDynamicGlyph(glyph)) {
            errors.push({
              pointer: `${pointer}/glyphs/${glyphIndex}`,
              message: `unsupported SMuFL dynamic glyph '${glyph}'`,
              keyword: "glyph",
            });
          }
        });
      });
    });
  });

  return errors;
}

/** Validate cross-object percussion references that JSON Schema cannot express. */
function validateKitReferences(score: RawScore): RawScoreValidationError[] {
  const errors: RawScoreValidationError[] = [];
  const sounds = new Set(Object.keys(score.global.sounds ?? {}));

  score.parts.forEach((part, partIndex) => {
    const kit = part.kit ?? {};
    const componentIds = new Set(Object.keys(kit));
    Object.entries(kit).forEach(([componentId, component]) => {
      if (component.sound !== undefined && !sounds.has(component.sound)) {
        errors.push({
          pointer: `/parts/${partIndex}/kit/${componentId}/sound`,
          message: `must reference an existing global sound id ('${component.sound}' was not found)`,
          keyword: "reference",
        });
      }
    });

    const visitContent = (content: unknown[], pointer: string): void => {
      content.forEach((item, itemIndex) => {
        if (!item || typeof item !== "object") return;
        const record = item as Record<string, unknown>;
        const itemPointer = `${pointer}/${itemIndex}`;
        const kitNotes = Array.isArray(record["kitNotes"]) ? record["kitNotes"] : [];
        kitNotes.forEach((kitNote, noteIndex) => {
          if (!kitNote || typeof kitNote !== "object") return;
          const component = (kitNote as Record<string, unknown>)["kitComponent"];
          if (typeof component === "string" && !componentIds.has(component)) {
            errors.push({
              pointer: `${itemPointer}/kitNotes/${noteIndex}/kitComponent`,
              message: `must reference a kit component on this part ('${component}' was not found)`,
              keyword: "reference",
            });
          }
        });
        if (Array.isArray(record["content"])) visitContent(record["content"], `${itemPointer}/content`);
      });
    };

    part.measures.forEach((measure, measureIndex) => {
      measure.sequences.forEach((sequence, sequenceIndex) => {
        visitContent(
          sequence.content as unknown[],
          `/parts/${partIndex}/measures/${measureIndex}/sequences/${sequenceIndex}/content`,
        );
      });
    });
  });

  return errors;
}

function formatErrorSummary(errors: readonly RawScoreValidationError[]): string {
  const head = `MNX schema validation failed (${errors.length} ${errors.length === 1 ? "error" : "errors"})`;
  const lines = errors.slice(0, 8).map((e) => `  ${e.pointer}: ${e.message}`);
  const tail = errors.length > 8 ? `\n  ... and ${errors.length - 8} more` : "";
  return `${head}:\n${lines.join("\n")}${tail}`;
}

/**
 * Runtime validation of unknown JSON against the MNX JSON Schema.
 *
 * This is the runtime counterpart to {@link @viritura/core/raw}: the
 * generated types describe the shape, this module proves a value
 * inhabits that shape at runtime. Together they form the only safe
 * boundary at which `unknown` can be narrowed to {@link RawScore}.
 *
 * Architecture: the MNX and Viritura schemas are the single sources of truth.
 * AJV standalone validators are generated from them at build time so browser
 * validation does not require dynamic code evaluation.
 */

import type { ValidateFunction, ErrorObject } from "ajv/dist/2020";
import type { Root as RawScore } from "@viritura/core/raw";
import type { MeasureGlobalExtensions } from "@viritura/core/raw-viritura";
import { isSupportedDynamicGlyph } from "@viritura/core";
import {
  mnxDocument,
  rootExtensions,
  measureGlobalExtensions,
  timeExtensions,
  keyExtensions,
  tempoExtensions,
  partExtensions,
  kitComponentExtensions,
  partMeasureExtensions,
  tupletExtensions,
  positionedStaffConfigExtensions,
  dynamicGroupExtensions,
  eventExtensions,
  eventMarkingsExtensions,
  noteExtensions,
  slurExtensions,
  systemLayoutExtensions,
  layoutStaffExtensions,
  scoreExtensions,
} from "./standaloneValidators";

type ExtensionDefinition =
  | "root-extensions"
  | "measure-global-extensions"
  | "time-extensions"
  | "key-extensions"
  | "tempo-extensions"
  | "part-extensions"
  | "kit-component-extensions"
  | "part-measure-extensions"
  | "tuplet-extensions"
  | "positioned-staff-config-extensions"
  | "dynamic-group-extensions"
  | "event-extensions"
  | "event-markings-extensions"
  | "note-extensions"
  | "slur-extensions"
  | "system-layout-extensions"
  | "layout-staff-extensions"
  | "score-extensions";

type StandaloneValidateFunction = ((data: unknown) => boolean) & Pick<ValidateFunction, "errors">;

const extensionValidators: Record<ExtensionDefinition, StandaloneValidateFunction> = {
  "root-extensions": rootExtensions,
  "measure-global-extensions": measureGlobalExtensions,
  "time-extensions": timeExtensions,
  "key-extensions": keyExtensions,
  "tempo-extensions": tempoExtensions,
  "part-extensions": partExtensions,
  "kit-component-extensions": kitComponentExtensions,
  "part-measure-extensions": partMeasureExtensions,
  "tuplet-extensions": tupletExtensions,
  "positioned-staff-config-extensions": positionedStaffConfigExtensions,
  "dynamic-group-extensions": dynamicGroupExtensions,
  "event-extensions": eventExtensions,
  "event-markings-extensions": eventMarkingsExtensions,
  "note-extensions": noteExtensions,
  "slur-extensions": slurExtensions,
  "system-layout-extensions": systemLayoutExtensions,
  "layout-staff-extensions": layoutStaffExtensions,
  "score-extensions": scoreExtensions,
};

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
  { ok: true; value: RawScore } | { ok: false; errors: readonly RawScoreValidationError[] };

/**
 * Validate `json` against the MNX JSON Schema and return either the
 * (now-typed) value or a structured error list.
 */
export function validateRawScore(json: unknown): RawScoreValidationResult {
  const validate: StandaloneValidateFunction = mnxDocument;
  const ok = validate(json);
  if (ok) {
    const value = json as RawScore;
    const extensionErrors = validateVirituraExtensions(json);
    if (extensionErrors.length > 0) return { ok: false, errors: extensionErrors };
    const semanticErrors = [
      ...validateChordSymbols(value),
      ...validateDynamicGroups(value),
      ...validateKitReferences(value),
      ...validateBeatStructures(value),
      ...validateTupletSpans(json),
      ...validateTupletDurations(json),
    ];
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

  const validateAt = (object: JsonObject | undefined, pointer: string, definition: ExtensionDefinition): void => {
    const extensionContainer = asObject(object?.["_x"]);
    if (!extensionContainer || !("viritura" in extensionContainer)) return;
    const extension = extensionContainer["viritura"];
    const extensionPointer = `${pointer}/_x/viritura`;
    consumed.add(extensionPointer);
    const validate = extensionValidators[definition];
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
      if (type === "tuplet") validateAt(object, itemPointer, "tuplet-extensions");
      visitContent(object["content"], `${itemPointer}/content`);
    });
  };

  const visitLayoutContent = (content: unknown, pointer: string): void => {
    if (!Array.isArray(content)) return;
    content.forEach((item, index) => {
      const object = asObject(item);
      if (!object) return;
      const itemPointer = `${pointer}/${index}`;
      if (object["type"] === "staff") {
        validateAt(object, itemPointer, "layout-staff-extensions");
      } else if (object["type"] === "group") {
        visitLayoutContent(object["content"], `${itemPointer}/content`);
      }
    });
  };

  validateAt(root, "", "root-extensions");
  const global = asObject(root["global"]);
  asObjects(global?.["measures"]).forEach((measure, measureIndex) => {
    const measurePointer = `/global/measures/${measureIndex}`;
    validateAt(measure, measurePointer, "measure-global-extensions");
    validateAt(asObject(measure["time"]), `${measurePointer}/time`, "time-extensions");
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
      asObjects(measure["staffConfigs"]).forEach((config, configIndex) =>
        validateAt(config, `${measurePointer}/staffConfigs/${configIndex}`, "positioned-staff-config-extensions"),
      );
      asObjects(measure["dynamics"]).forEach((dynamic, dynamicIndex) =>
        validateAt(dynamic, `${measurePointer}/dynamics/${dynamicIndex}`, "dynamic-group-extensions"),
      );
      asObjects(measure["sequences"]).forEach((sequence, sequenceIndex) => {
        visitContent(sequence["content"], `${measurePointer}/sequences/${sequenceIndex}/content`);
      });
    });
  });

  asObjects(root["layouts"]).forEach((layout, index) => {
    const pointer = `/layouts/${index}`;
    validateAt(layout, pointer, "system-layout-extensions");
    visitLayoutContent(layout["content"], `${pointer}/content`);
  });
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

function validateTupletSpans(document: unknown): RawScoreValidationError[] {
  interface Fragment {
    measure: number;
    sequence: number;
    type: string;
    signature: string;
    pointer: string;
  }

  const errors: RawScoreValidationError[] = [];
  const root = asObject(document);
  const parts = asObjects(root?.["parts"]);

  parts.forEach((part, partIndex) => {
    const spans = new Map<string, Fragment[]>();
    asObjects(part["measures"]).forEach((measure, measureIndex) => {
      asObjects(measure["sequences"]).forEach((sequence, sequenceIndex) => {
        const visit = (content: unknown, pointer: string): void => {
          if (!Array.isArray(content)) return;
          content.forEach((item, itemIndex) => {
            const object = asObject(item);
            if (!object) return;
            const itemPointer = `${pointer}/${itemIndex}`;
            if (object["type"] === "tuplet") {
              const viritura = asObject(asObject(object["_x"])?.["viritura"]);
              const span = asObject(viritura?.["span"]);
              if (span && typeof span["id"] === "string" && typeof span["type"] === "string") {
                const fragment: Fragment = {
                  measure: measureIndex,
                  sequence: sequenceIndex,
                  type: span["type"],
                  signature: JSON.stringify({
                    inner: object["inner"],
                    outer: object["outer"],
                    bracket: object["bracket"],
                    showNumber: object["showNumber"],
                    showValue: object["showValue"],
                    placement: object["placement"],
                    staff: object["staff"],
                  }),
                  pointer: `${itemPointer}/_x/viritura/span`,
                };
                const group = spans.get(span["id"]);
                if (group) group.push(fragment);
                else spans.set(span["id"], [fragment]);
              }
            }
            visit(object["content"], `${itemPointer}/content`);
          });
        };
        visit(sequence["content"], `/parts/${partIndex}/measures/${measureIndex}/sequences/${sequenceIndex}/content`);
      });
    });

    for (const [id, fragments] of spans) {
      const valid =
        fragments.length >= 2 &&
        fragments[0]?.type === "start" &&
        fragments.at(-1)?.type === "stop" &&
        fragments.slice(1, -1).every((fragment) => fragment.type === "continue") &&
        fragments.every((fragment, index) => {
          const first = fragments[0]!;
          return (
            fragment.sequence === first.sequence &&
            fragment.signature === first.signature &&
            (index === 0 || fragment.measure === fragments[index - 1]!.measure + 1)
          );
        });
      if (!valid) {
        errors.push({
          pointer: fragments[0]?.pointer ?? `/parts/${partIndex}`,
          message: `tuplet span "${id}" must contain start, contiguous continue fragments, and stop in one sequence with identical tuplet settings`,
          keyword: "tupletSpan",
        });
      }
    }
  });

  return errors;
}

const NOTE_VALUE_WHOLES: Readonly<Record<string, number>> = {
  maxima: 8,
  longa: 4,
  breve: 2,
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  "16th": 1 / 16,
  "32nd": 1 / 32,
  "64th": 1 / 64,
  "128th": 1 / 128,
  "256th": 1 / 256,
  "512th": 1 / 512,
  "1024th": 1 / 1024,
};

function noteValueWholes(value: unknown): number | undefined {
  const duration = asObject(value);
  if (!duration) return undefined;
  const base = duration["base"];
  if (typeof base !== "string") return undefined;
  const baseValue = NOTE_VALUE_WHOLES[base];
  if (baseValue === undefined) return undefined;
  const dots = typeof duration["dots"] === "number" ? duration["dots"] : 0;
  return baseValue * (2 - 1 / 2 ** dots);
}

function quantityWholes(value: unknown): number | undefined {
  const quantity = asObject(value);
  const duration = noteValueWholes(quantity?.["duration"]);
  const multiple = quantity?.["multiple"];
  return duration !== undefined && typeof multiple === "number" ? duration * multiple : undefined;
}

function contentWholes(content: unknown): number | undefined {
  if (!Array.isArray(content)) return undefined;
  let total = 0;
  for (const item of content) {
    const object = asObject(item);
    if (!object) return undefined;
    const type = object["type"];
    let duration: number | undefined;
    if (type === "grace") duration = 0;
    else if (type === "space") {
      const fraction = object["duration"];
      duration =
        Array.isArray(fraction) && typeof fraction[0] === "number" && typeof fraction[1] === "number"
          ? fraction[0] / fraction[1]
          : undefined;
    } else if (type === "tuplet" || type === "tremolo") duration = quantityWholes(object["outer"]);
    else duration = noteValueWholes(object["duration"]);
    if (duration === undefined) return undefined;
    total += duration;
  }
  return total;
}

function validateTupletDurations(document: unknown): RawScoreValidationError[] {
  const errors: RawScoreValidationError[] = [];
  const root = asObject(document);
  asObjects(root?.["parts"]).forEach((part, partIndex) => {
    asObjects(part["measures"]).forEach((measure, measureIndex) => {
      asObjects(measure["sequences"]).forEach((sequence, sequenceIndex) => {
        const visit = (content: unknown, pointer: string): void => {
          if (!Array.isArray(content)) return;
          content.forEach((item, itemIndex) => {
            const object = asObject(item);
            if (!object) return;
            const itemPointer = `${pointer}/${itemIndex}`;
            if (object["type"] === "tuplet") {
              const span = asObject(asObject(asObject(object["_x"])?.["viritura"])?.["span"]);
              const expected = quantityWholes(object["inner"]);
              const actual = contentWholes(object["content"]);
              if (!span && expected !== undefined && actual !== undefined && Math.abs(expected - actual) > 1e-9) {
                errors.push({
                  pointer: `${itemPointer}/content`,
                  message:
                    "tuplet content duration must equal its inner duration; use linked Viritura span fragments for a cross-barline tuplet",
                  keyword: "tupletDuration",
                });
              }
            }
            visit(object["content"], `${itemPointer}/content`);
          });
        };
        visit(sequence["content"], `/parts/${partIndex}/measures/${measureIndex}/sequences/${sequenceIndex}/content`);
      });
    });
  });
  return errors;
}

function validateChordSymbols(score: RawScore): RawScoreValidationError[] {
  const errors: RawScoreValidationError[] = [];
  score.global.measures.forEach((measure, measureIndex) => {
    const extension = measure._x?.["viritura"] as MeasureGlobalExtensions | undefined;
    extension?.chordSymbols?.forEach((chord, chordIndex) => {
      const pointer = `/global/measures/${measureIndex}/_x/viritura/chordSymbols/${chordIndex}`;
      // Required-property unions cannot be faithfully represented by both wire generators.
      if (chord.root === undefined && chord.rawText === undefined) {
        errors.push({ pointer, message: "chord symbol requires root or rawText", keyword: "required" });
      }
      const [numerator, denominator] = chord.position.fraction;
      if (
        !Number.isSafeInteger(numerator) ||
        numerator! < 0 ||
        !Number.isSafeInteger(denominator) ||
        denominator! <= 0
      ) {
        errors.push({
          pointer: `${pointer}/position/fraction`,
          message:
            "chord position requires a nonnegative safe-integer numerator and a positive safe-integer denominator",
          keyword: "range",
        });
      }
    });
  });
  return errors;
}

function validateBeatStructures(score: RawScore): RawScoreValidationError[] {
  const errors: RawScoreValidationError[] = [];
  score.global.measures.forEach((measure, measureIndex) => {
    const time = measure.time;
    if (!time) return;
    const extension = time._x?.["viritura"] as { beatStructure?: unknown } | undefined;
    if (!Array.isArray(extension?.beatStructure)) return;
    const total = extension.beatStructure.reduce(
      (sum: number, group: unknown) => sum + (typeof group === "number" ? group : 0),
      0,
    );
    if (total !== time.count) {
      errors.push({
        pointer: `/global/measures/${measureIndex}/time/_x/viritura/beatStructure`,
        message: `beatStructure values must sum to time.count (${time.count})`,
        keyword: "sum",
      });
    }
  });
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

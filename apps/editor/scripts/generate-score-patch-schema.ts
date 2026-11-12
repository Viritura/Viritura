import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import standaloneCode from "ajv/dist/standalone";
import { buildGenerator, generateSchema, programFromConfig, type Definition } from "typescript-json-schema";

const root = resolve(import.meta.dirname, "../../..");
const schemaPath = resolve(root, "server/Viritura.Api/Mcp/score-patches.schema.json");
const validatorPath = resolve(root, "apps/editor/src/mcpSession/scorePatchValidator.generated.ts");
const program = programFromConfig(resolve(root, "packages/core/tsconfig.json"));
const schema = generateSchema(program, "ScorePatch", {
  required: true,
  noExtraProps: true,
  strictNullChecks: true,
  ignoreErrors: true,
});
if (!schema?.definitions || !schema.anyOf) throw new Error("Could not generate the ScorePatch union.");

schema.$schema = "https://json-schema.org/draft/2020-12/schema";
schema.$id = "https://viritura.com/schemas/mcp-score-patch";

function upgradeTuples(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(upgradeTuples);
    return;
  }
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.items)) {
    object.prefixItems = object.items;
    if (object.additionalItems === undefined) delete object.items;
    else object.items = object.additionalItems;
    delete object.additionalItems;
  }
  Object.values(object).forEach(upgradeTuples);
}
function definition(name: string): Definition {
  const result = schema!.definitions![name];
  if (!result || typeof result !== "object") throw new Error(`Missing generated definition ${name}.`);
  return result;
}

const dictionaryGenerator = buildGenerator(program, {
  required: true,
  noExtraProps: true,
  strictNullChecks: true,
  ignoreErrors: true,
  uniqueNames: true,
});
if (!dictionaryGenerator) throw new Error("Could not build dictionary-value schemas.");
for (const name of Object.keys(schema.definitions)) {
  const match = /^Record<string,(.+)>$/.exec(name);
  if (!match) continue;
  const valueType = match[1]!;
  const dictionary = definition(name);
  if (valueType === "never" || valueType === "unknown") {
    dictionary.additionalProperties = true;
    continue;
  }
  const symbol = dictionaryGenerator
    .getSymbols(valueType)
    .find((candidate) =>
      candidate.symbol.declarations?.some((declaration) =>
        declaration.getSourceFile().fileName.replaceAll("\\", "/").includes("/packages/core/src/model/"),
      ),
    );
  if (!symbol) throw new Error(`Missing model type for ${name}.`);
  const generated = dictionaryGenerator.getSchemaForSymbol(symbol.name);
  const nested = generated.definitions ?? {};
  delete generated.definitions;
  delete generated.$schema;
  const prefix = `dictionary_${valueType}_`;
  const canonical = (key: string) => key.replace(/\.[0-9a-f]{8}$/, "");
  const rewriteRefs = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(rewriteRefs);
      return;
    }
    const node = value as Record<string, unknown>;
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/definitions/")) {
      const target = canonical(decodeURIComponent(node.$ref.slice("#/definitions/".length)));
      node.$ref = `#/definitions/${encodeURIComponent(prefix + target)}`;
    }
    Object.values(node).forEach(rewriteRefs);
  };
  rewriteRefs(generated);
  schema.definitions[`dictionary_${valueType}`] = generated;
  for (const [nestedName, value] of Object.entries(nested)) {
    if (!value || typeof value !== "object") throw new Error(`Invalid nested schema ${nestedName}.`);
    const normalizedName = canonical(nestedName);
    if (/^Record<string,(never|unknown)>$/.test(normalizedName)) value.additionalProperties = true;
    rewriteRefs(value);
    const target = prefix + normalizedName;
    if (schema.definitions[target]) throw new Error(`Duplicate generated dictionary definition ${target}.`);
    schema.definitions[target] = value;
  }
  dictionary.additionalProperties = { $ref: `#/definitions/dictionary_${valueType}` };
}

function optionalProperty(node: Definition, name: string): void {
  if (!node.required?.includes(name)) throw new Error(`Missing required property ${name}.`);
  node.required = node.required.filter((property) => property !== name);
}

for (const [name, property] of [
  ["SetNoteMarkingPatch", "value"],
  ["SetEventMarkingPatch", "value"],
  ["SetMeasureDynamicGroupPatch", "value"],
  ["SetMeasureArpeggioPatch", "mark"],
  ["SetMnxSupportPatch", "value"],
  ["SetScoreMetadataPatch", "value"],
]) {
  optionalProperty(definition(name!), property!);
}

for (const [name, requiredValues] of [
  ["NoteScalarField", []],
  ["EventScalarField", ["duration"]],
  ["GlobalMeasureField", []],
  ["PartMeasureField", []],
  ["PartField", ["name"]],
  ["ScoreExtensionField", []],
] as const) {
  const variants = definition(name).anyOf;
  if (!variants) throw new Error(`Missing variants for ${name}.`);
  for (const variant of variants) {
    if (!variant || typeof variant !== "object") throw new Error(`Invalid variant for ${name}.`);
    const field = variant.properties?.["field"];
    if (!field || typeof field !== "object" || typeof field.const !== "string") {
      throw new Error(`Missing field discriminator for ${name}.`);
    }
    if (!(requiredValues as readonly string[]).includes(field.const)) optionalProperty(variant, "value");
  }
}

for (const [name, property, minimum] of [
  ["SequencePath", "measureIndex", 0],
  ["SequencePath", "voice", 0],
  ["MeasurePath", "measureIndex", 0],
  ["AddNoteToEventPatch", "index", 0],
  ["AddMeasureExpressionPatch", "expressionIndex", 0],
  ["SetMeasureExpressionPatch", "expressionIndex", 0],
  ["RemoveMeasureExpressionPatch", "expressionIndex", 0],
  ["SetGlobalMeasureFieldPatch", "measureIndex", 0],
  ["InsertMeasuresPatch", "atIndex", 0],
  ["RemoveMeasuresPatch", "startIndex", 0],
  ["RemoveMeasuresPatch", "count", 1],
  ["AddPartPatch", "index", 0],
] as const) {
  const field = definition(name).properties?.[property];
  if (!field || typeof field !== "object") throw new Error(`Missing ${name}.${property}.`);
  field.type = "integer";
  field.minimum = minimum;
}
const insertedMeasures = definition("InsertMeasuresPatch").properties?.["globalMeasures"];
if (!insertedMeasures || typeof insertedMeasures !== "object")
  throw new Error("Missing insertMeasures.globalMeasures.");
insertedMeasures.minItems = 1;

const mnx = JSON.parse(readFileSync(resolve(root, "packages/format/schemas/mnx-schema.json"), "utf8")) as {
  $defs: Record<string, Definition>;
};
for (const [name, value] of Object.entries(mnx.$defs)) {
  schema.definitions[`mnx_${name}`] = JSON.parse(
    JSON.stringify(value).replaceAll("#/$defs/", "#/definitions/mnx_"),
  ) as Definition;
}
for (const [name, field] of [
  ["SetSequenceContentPatch", "content"],
  ["SpliceSequenceContentPatch", "insert"],
]) {
  const properties = definition(name!).properties;
  const modelContent = properties?.[field!];
  if (!properties || !modelContent) throw new Error(`Missing ${name}.${field}.`);
  if (name === "SetSequenceContentPatch") {
    schema.definitions["model_sequence-content"] = JSON.parse(JSON.stringify(modelContent)) as Definition;
  }
  properties[field!] = {
    anyOf: [modelContent, { $ref: "#/definitions/mnx_sequence-content" }],
    description: "Use either internal model content or MNX sequence content, including _x.viritura extensions.",
  };
}

const noteProperties = definition("AddNoteToEventPatch").properties;
const modelNote = noteProperties?.["note"];
if (!noteProperties || !modelNote) throw new Error("Missing AddNoteToEventPatch.note.");
schema.definitions["model_note"] = JSON.parse(JSON.stringify(modelNote)) as Definition;
noteProperties["note"] = {
  anyOf: [modelNote, { $ref: "#/definitions/mnx_note" }],
  description: "Use either an internal model note or an MNX note, including _x.viritura extensions.",
};
upgradeTuples(schema);

function stripDescriptions(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(stripDescriptions);
    return;
  }
  const object = value as Record<string, unknown>;
  delete object.description;
  Object.values(object).forEach(stripDescriptions);
}
for (const [name, value] of Object.entries(schema.definitions)) {
  if (!name.endsWith("Patch") && name !== "SequencePath" && name !== "MeasurePath") stripDescriptions(value);
}

const reachable = new Set<string>();
const queue = ["mnx_sequence-content", "model_sequence-content", "model_note"];
function collectReferences(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(collectReferences);
    return;
  }
  const node = value as Record<string, unknown>;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/definitions/")) {
    queue.push(decodeURIComponent(node.$ref.slice("#/definitions/".length)));
  }
  Object.values(node).forEach(collectReferences);
}
collectReferences(schema.anyOf);
while (queue.length) {
  const name = queue.pop()!;
  if (reachable.has(name)) continue;
  const entry = schema.definitions[name];
  if (entry === undefined) throw new Error(`Missing referenced definition ${name}.`);
  reachable.add(name);
  collectReferences(entry);
}
for (const name of Object.keys(schema.definitions)) {
  if (!reachable.has(name)) delete schema.definitions[name];
}

const ajv = new Ajv2020({ strict: false, allErrors: true, code: { esm: true, source: true } });
ajv.addSchema(schema);
const variantRefs: Record<string, string> = {};
const kinds: Record<string, string> = {};
for (const variant of schema.anyOf) {
  if (!variant || typeof variant !== "object" || !variant.$ref?.startsWith("#/definitions/")) {
    throw new Error("ScorePatch variant is not a definition reference.");
  }
  const name = decodeURIComponent(variant.$ref.slice("#/definitions/".length));
  const kind = definition(name).properties?.["kind"];
  if (!kind || typeof kind !== "object" || typeof kind.const !== "string") {
    throw new Error(`Missing kind discriminator for ${name}.`);
  }
  variantRefs[name] = `${schema.$id}${variant.$ref}`;
  kinds[kind.const] = name;
}
variantRefs["validateMnxSequenceContent"] = `${schema.$id}#/definitions/mnx_sequence-content`;
variantRefs["validateModelSequenceContent"] = `${schema.$id}#/definitions/model_sequence-content`;
variantRefs["validateModelNote"] = `${schema.$id}#/definitions/model_note`;
const generated = standaloneCode(ajv, variantRefs);
let esmGenerated = generated.replace(
  /const (\w+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/g,
  'import $1Module from "ajv/dist/runtime/ucs2length.js";' +
    'const $1 = typeof $1Module === "function" ? $1Module : $1Module.default;',
);
if (esmGenerated.includes("require(")) throw new Error("AJV emitted an unsupported CommonJS helper.");
for (const name of Object.values(kinds)) {
  const exported = `export const ${name} =`;
  if (!esmGenerated.includes(exported)) throw new Error(`Missing generated validator ${name}.`);
  esmGenerated = esmGenerated.replace(exported, `const ${name} =`);
}
const outputs = new Map([
  [schemaPath, `${JSON.stringify(schema)}\n`],
  [
    validatorPath,
    "/* eslint-disable -- generated standalone schema validator */\n" +
      "// @ts-nocheck\n" +
      "// Generated by pnpm --filter @viritura/editor gen:score-patches; do not edit.\n" +
      esmGenerated +
      `\nexport const scorePatchValidators = {${Object.entries(kinds)
        .map(([kind, name]) => `${JSON.stringify(kind)}:${name}`)
        .join(",")}};\n`,
  ],
]);
for (const [path, content] of outputs) {
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== content) throw new Error(`Generated artifact is stale: ${path}`);
  } else {
    writeFileSync(path, content);
    console.log(`Wrote ${path}`);
  }
}

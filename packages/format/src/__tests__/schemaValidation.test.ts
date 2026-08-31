/**
 * Stage 1 schema-validation insurance.
 *
 * For every MNX example file we ship, assert two things:
 *
 *   1. The file on disk validates against the official MNX JSON Schema.
 *      This is the sanity check — if this fails, our fixture is bad, not
 *      our parser.
 *
 *   2. parse(file) → serialize → validates against the same schema.
 *      This is the real insurance — if the TS Score model has drifted
 *      from the MNX wire shape (a field renamed, a discriminator dropped,
 *      a vendor extension promoted incorrectly), the serializer output
 *      will no longer be valid MNX, and this test surfaces it on the PR
 *      that introduces the drift.
 *
 * We separate the two failure modes deliberately: if the file-on-disk
 * check passes but the round-trip check fails, you know the bug is in
 * @viritura/format (parser dropped a field, serializer emitted wrong
 * shape). If the file-on-disk check fails, the fixture itself is invalid.
 */

import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

const scoresDir = path.resolve(__dirname, "../../fixtures/mnx");
const schemaPath = path.resolve(__dirname, "../../schemas/mnx-schema.json");

const mnxFiles = fs
  .readdirSync(scoresDir)
  .filter((f) => f.endsWith(".mnx"))
  .sort();

let validate: ValidateFunction;

beforeAll(() => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  // The MNX schema uses Draft 2020-12; Ajv has a dedicated entry point.
  // `strict: false` because the MNX schema uses some keywords (e.g.
  // unevaluatedProperties contexts) that Ajv would otherwise warn on; we
  // want validation behavior, not lint warnings.
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  validate = ajv.compile(schema);
});

function formatErrors(errors: ValidateFunction["errors"]): string {
  if (!errors) return "(no errors)";
  return errors
    .slice(0, 8)
    .map((e) => `  ${e.instancePath || "(root)"}: ${e.message ?? "?"}`)
    .join("\n");
}

describe("MNX schema: example files on disk are valid", () => {
  for (const file of mnxFiles) {
    it(`${file} validates against mnx-schema.json`, () => {
      const raw = fs.readFileSync(path.join(scoresDir, file), "utf-8");
      const doc = JSON.parse(raw);
      const ok = validate(doc);
      if (!ok) {
        throw new Error(`Schema violations:\n${formatErrors(validate.errors)}`);
      }
      expect(ok).toBe(true);
    });
  }
});

describe("MNX schema: parser output round-trips to valid MNX", () => {
  for (const file of mnxFiles) {
    it(`parse(${file}) → serialize → valid MNX`, () => {
      const raw = fs.readFileSync(path.join(scoresDir, file), "utf-8");
      const doc = JSON.parse(raw);
      const score = parseMnx(doc);
      const reserialized = serializeMnx(score);
      const ok = validate(reserialized);
      if (!ok) {
        throw new Error(`Serializer produced invalid MNX for ${file}:\n${formatErrors(validate.errors)}`);
      }
      expect(ok).toBe(true);
    });
  }
});

import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mnxDocument } from "../mnx/standaloneValidators";

const fixturePath = resolve(__dirname, "../../fixtures/mnx");
const schema = JSON.parse(readFileSync(resolve(__dirname, "../../schemas/mnx-schema.json"), "utf8"));
const fixtures = readdirSync(fixturePath)
  .filter((file) => file.endsWith(".mnx"))
  .map((file) => JSON.parse(readFileSync(resolve(fixturePath, file), "utf8")));
const invalidDocuments = [
  {},
  { mnx: { version: 1 }, global: { measures: [] }, parts: [], inventedProperty: true },
  { mnx: { version: 999 }, global: { measures: [] }, parts: [] },
];

function comparableErrors(errors: ErrorObject[] | null | undefined) {
  return errors?.map(({ instancePath, keyword, message }) => ({ instancePath, keyword, message })) ?? [];
}

describe("standalone MNX validator parity", () => {
  it("matches runtime AJV for fixtures and representative failures", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const runtimeValidator = ajv.compile(schema);

    for (const document of [...fixtures, ...invalidDocuments]) {
      expect(mnxDocument(document)).toBe(runtimeValidator(document));
      expect(comparableErrors(mnxDocument.errors)).toEqual(comparableErrors(runtimeValidator.errors));
    }
  });
});

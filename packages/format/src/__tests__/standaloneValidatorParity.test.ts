import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { mnxDocument } from "../mnx/standaloneValidators";
import { mnxFixtures } from "./mnxCorpus";

const invalidDocuments = [
  {},
  { mnx: { version: 1 }, global: { measures: [] }, parts: [], inventedProperty: true },
  { mnx: { version: 999 }, global: { measures: [] }, parts: [] },
];

function comparableErrors(errors: ErrorObject[] | null | undefined) {
  return errors?.map(({ instancePath, keyword, message }) => ({ instancePath, keyword, message })) ?? [];
}

describe("standalone MNX validator parity", () => {
  const standaloneValidator: ((data: unknown) => boolean) & Pick<ValidateFunction, "errors"> = mnxDocument;
  let runtimeValidator: ValidateFunction;

  beforeAll(() => {
    const schema = JSON.parse(readFileSync(resolve(__dirname, "../../schemas/mnx-schema.json"), "utf8"));
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    runtimeValidator = ajv.compile(schema);
  });

  function expectParity(document: unknown): void {
    expect(standaloneValidator(document)).toBe(runtimeValidator(document));
    expect(comparableErrors(standaloneValidator.errors)).toEqual(comparableErrors(runtimeValidator.errors));
  }

  for (const file of mnxFixtures) {
    it(
      `matches runtime AJV for ${file.name}`,
      () => {
        expectParity(JSON.parse(readFileSync(file.path, "utf8")));
      },
      file.timeout,
    );
  }

  it("matches runtime AJV for representative failures", () => {
    for (const document of invalidDocuments) expectParity(document);
  });
});

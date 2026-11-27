import { expect, it } from "vitest";
import { corpusTimeout, mnxFixtures } from "./mnxCorpus";

it("extends the timeout only for fixtures of at least one megabyte", () => {
  expect(corpusTimeout(999_999)).toBeUndefined();
  expect(corpusTimeout(1_000_000)).toBe(15_000);
});

it("classifies large and small corpus files by their size", () => {
  expect(mnxFixtures.find((file) => file.name === "Rhapsody in Blue.mnx")).toMatchObject({ timeout: 15_000 });
  expect(mnxFixtures.find((file) => file.name === "c-major-scale.mnx")).toMatchObject({ timeout: undefined });
});

import { describe, expect, it } from "vitest";
import { partShowsChordSymbols, type Score } from "@viritura/core";
import { serializeMnx, validateRawScore } from "@viritura/format";
import { enrichInstrumentIdentities } from "../InstrumentCatalog";

describe("instrument identity enrichment", () => {
  it("uses a declared initial instrument before guessing from the part name", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          name: "Flute",
          measures: [],
          _x: {
            viritura: {
              initialInstrument: "guitar",
              instruments: { guitar: { instrumentId: "pluck.guitar" } },
            },
          },
        },
        {
          name: "Piano",
          measures: [],
          _x: {
            viritura: {
              initialInstrument: "custom",
              instruments: { custom: { instrumentId: "custom.zither" } },
            },
          },
        },
        { name: "Piano", measures: [] },
      ],
    };

    expect(enrichInstrumentIdentities(score)).toBe(3);
    expect(score.parts.map((part) => part._x?.viritura?.instrumentId)).toEqual([
      "pluck.guitar",
      "custom.zither",
      "keyboard.piano",
    ]);
    expect(score.parts.map(partShowsChordSymbols)).toEqual([true, false, true]);
    expect(validateRawScore(serializeMnx(score)).ok).toBe(true);
    expect(enrichInstrumentIdentities(score)).toBe(0);
  });
});

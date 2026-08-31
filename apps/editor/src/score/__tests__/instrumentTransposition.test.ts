import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { addInstrumentToScore } from "../instrumentMutations";
import { buildPartTransposition, createPlayer, getCatalogInstrument, INSTRUMENT_CATALOG } from "../InstrumentCatalog";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../ScoreBuilder";

/** Instruments that transpose by whole octaves only (same pitch class). */
const PURE_OCTAVE_IDS = [
  "piccolo",
  "xylophone",
  "glockenspiel",
  "contrabassoon",
  "double-bass",
  "guitar",
  "electric-guitar",
  "bass-guitar",
];

/** Transposing instruments whose interval changes the pitch class. */
const KEY_TRANSPOSER_IDS = [
  "bflat-clarinet",
  "a-clarinet",
  "eflat-clarinet",
  "bass-clarinet",
  "alto-flute",
  "english-horn",
  "horn",
  "trumpet",
  "alto-sax",
  "tenor-sax",
  "baritone-sax",
];

describe("buildPartTransposition — prefersWrittenPitches", () => {
  it("flags every pure-octave transposer in the catalog", () => {
    for (const id of PURE_OCTAVE_IDS) {
      const inst = getCatalogInstrument(id);
      expect(inst?.transposition, `${id} should be a transposing instrument`).toBeDefined();
      const t = buildPartTransposition(inst!.transposition!);
      expect(t.prefersWrittenPitches, `${id} should prefer written pitches`).toBe(true);
    }
  });

  it("does not flag key transposers (pitch-class changing intervals)", () => {
    for (const id of KEY_TRANSPOSER_IDS) {
      const inst = getCatalogInstrument(id);
      const t = buildPartTransposition(inst!.transposition!);
      expect(t.prefersWrittenPitches, `${id} should NOT prefer written pitches`).toBeUndefined();
    }
  });

  it("matches every octave-only catalog interval and no others", () => {
    for (const inst of INSTRUMENT_CATALOG) {
      if (!inst.transposition) continue;
      const t = buildPartTransposition(inst.transposition);
      const sd = inst.transposition.staffDistance ?? 0;
      const isPureOctave = inst.transposition.halfSteps !== 0 && inst.transposition.halfSteps * 7 === sd * 12;
      expect(!!t.prefersWrittenPitches).toBe(isPureOctave);
    }
  });
});

describe("piccolo default template", () => {
  it("sets prefersWrittenPitches when added via addInstrumentToScore", () => {
    const empty = JSON.parse(buildBlankScore({ ...DEFAULT_NEW_SCORE_SETTINGS, players: [] })) as Score;
    const next = addInstrumentToScore(empty, "piccolo");
    const piccolo = next.parts.find((p) => p.name.startsWith("Piccolo"));
    expect(piccolo?.transposition?.prefersWrittenPitches).toBe(true);
    expect(piccolo?.transposition?.interval).toEqual({ halfSteps: -12, staffDistance: -7 });
  });

  it("sets prefersWrittenPitches when built via the New Score dialog (ScoreBuilder)", () => {
    const json = buildBlankScore({ ...DEFAULT_NEW_SCORE_SETTINGS, players: [createPlayer("piccolo")] });
    const score = JSON.parse(json) as Score;
    expect(score.parts[0]!.transposition?.prefersWrittenPitches).toBe(true);
  });
});

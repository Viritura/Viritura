import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { addInstrumentToScore } from "../instrumentMutations";
import { buildPartTransposition, createPlayer, getCatalogInstrument, INSTRUMENT_CATALOG } from "../InstrumentCatalog";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../ScoreBuilder";

/** Instruments that transpose by whole octaves only (same pitch class). */
const PURE_OCTAVE_IDS = [
  "wind.flutes.flute.piccolo",
  "pitched-percussion.xylophone",
  "pitched-percussion.glockenspiel",
  "wind.reed.contrabassoon",
  "strings.contrabass",
  "pluck.guitar",
  "pluck.guitar.electric",
  "pluck.bass.electric",
];

/** Transposing instruments whose interval changes the pitch class. */
const KEY_TRANSPOSER_IDS = [
  "wind.reed.clarinet.bflat",
  "wind.reed.clarinet.a",
  "wind.reed.clarinet.eflat",
  "wind.reed.clarinet.bass",
  "wind.flutes.flute.alto",
  "wind.reed.english-horn",
  "brass.french-horn",
  "brass.trumpet.bflat",
  "wind.reed.saxophone.alto",
  "wind.reed.saxophone.tenor",
  "wind.reed.saxophone.baritone",
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
    const next = addInstrumentToScore(empty, "wind.flutes.flute.piccolo");
    const piccolo = next.parts.find((p) => p.name.startsWith("Piccolo"));
    expect(piccolo?.transposition?.prefersWrittenPitches).toBe(true);
    expect(piccolo?.transposition?.interval).toEqual({ halfSteps: -12, staffDistance: -7 });
  });

  it("sets prefersWrittenPitches when built via the New Score dialog (ScoreBuilder)", () => {
    const json = buildBlankScore({
      ...DEFAULT_NEW_SCORE_SETTINGS,
      players: [createPlayer("wind.flutes.flute.piccolo")],
    });
    const score = JSON.parse(json) as Score;
    expect(score.parts[0]!.transposition?.prefersWrittenPitches).toBe(true);
  });
});

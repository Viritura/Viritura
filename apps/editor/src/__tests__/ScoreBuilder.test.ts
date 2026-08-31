import { describe, it, expect } from "vitest";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS, type NewScoreSettings } from "../score/ScoreBuilder";
import {
  createPlayer,
  renumberPlayers,
  INSTRUMENT_CATALOG,
  ENSEMBLE_TEMPLATES,
  expandTemplate,
} from "../score/InstrumentCatalog";

/** Helper: create a renumbered player list from instrument IDs. */
function makePlayers(...ids: string[]) {
  return renumberPlayers(ids.map((id) => createPlayer(id)));
}

describe("buildBlankScore", () => {
  it("creates a valid MNX JSON string with default settings (empty players)", () => {
    const json = buildBlankScore(DEFAULT_NEW_SCORE_SETTINGS);
    const parsed = JSON.parse(json);

    expect(parsed.mnx.version).toBe(1);
    expect(parsed.global.measures).toHaveLength(32);
    expect(parsed.parts).toHaveLength(0);
  });

  it("sets time signature on first global measure only", () => {
    const settings: NewScoreSettings = {
      ...DEFAULT_NEW_SCORE_SETTINGS,
      players: makePlayers("piano"),
    };
    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    expect(parsed.global.measures[0].time).toEqual({ count: 4, unit: 4 });
    expect(parsed.global.measures[1].time).toBeUndefined();
  });

  it("sets key signature on first global measure only", () => {
    const settings: NewScoreSettings = {
      ...DEFAULT_NEW_SCORE_SETTINGS,
      players: makePlayers("piano"),
    };
    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    expect(parsed.global.measures[0].key).toEqual({ fifths: 0 });
    expect(parsed.global.measures[1].key).toBeUndefined();
  });

  it("persists the score title and initial tempo", () => {
    const parsed = JSON.parse(
      buildBlankScore({
        ...DEFAULT_NEW_SCORE_SETTINGS,
        title: "  New Work  ",
        tempoBpm: 96,
        players: makePlayers("piano"),
      }),
    );

    expect(parsed._x.viritura.metadata.title).toBe("New Work");
    expect(parsed.global.measures[0].tempos).toEqual([{ bpm: 96, value: { base: "quarter" } }]);
  });

  it("creates Piano in 3/4 with 32 measures", () => {
    const settings: NewScoreSettings = {
      title: "Test",
      players: makePlayers("piano"),
      time: { count: 3, unit: 4 },
      keyFifths: 0,
      measureCount: 32,
      tempoBpm: 120,
    };

    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    expect(parsed.global.measures).toHaveLength(32);
    expect(parsed.global.measures[0].time).toEqual({ count: 3, unit: 4 });
    expect(parsed.parts[0].name).toBe("Piano");
    expect(parsed.parts[0].staves).toBe(2);

    // First measure has clefs
    expect(parsed.parts[0].measures[0].clefs).toHaveLength(2);
    expect(parsed.parts[0].measures[0].clefs[0].clef.sign).toBe("G");
    expect(parsed.parts[0].measures[0].clefs[0].staff).toBe(1);
    expect(parsed.parts[0].measures[0].clefs[1].clef.sign).toBe("F");
    expect(parsed.parts[0].measures[0].clefs[1].staff).toBe(2);

    // All measures have full-measure rest sequences
    for (let i = 0; i < 32; i++) {
      const m = parsed.parts[0].measures[i];
      expect(m.sequences).toHaveLength(2);
      expect(m.sequences[0].content).toEqual([]);
      expect(m.sequences[0].fullMeasure).toEqual({ visualDuration: { base: "whole" } });
      expect(m.sequences[0].staff).toBe(1);
      expect(m.sequences[1].staff).toBe(2);
    }

    // Second measure has no clefs
    expect(parsed.parts[0].measures[1].clefs).toBeUndefined();
  });

  it("creates single-staff instrument without staff field", () => {
    const settings: NewScoreSettings = {
      title: "Test",
      players: makePlayers("violin"),
      time: { count: 4, unit: 4 },
      keyFifths: 0,
      measureCount: 4,
      tempoBpm: 120,
    };

    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    expect(parsed.parts[0].staves).toBeUndefined();
    expect(parsed.parts[0].measures[0].clefs[0].staff).toBeUndefined();
    expect(parsed.parts[0].measures[0].sequences[0].staff).toBeUndefined();
  });

  it("creates multiple parts with correct names", () => {
    const settings: NewScoreSettings = {
      title: "Duo",
      players: makePlayers("violin", "cello"),
      time: { count: 4, unit: 4 },
      keyFifths: -2,
      measureCount: 8,
      tempoBpm: 100,
    };

    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts[0].name).toBe("Violin");
    expect(parsed.parts[0].shortName).toBe("Vln.");
    expect(parsed.parts[1].name).toBe("Cello");
    expect(parsed.parts[1].shortName).toBe("Vc.");

    expect(parsed.global.measures[0].key).toEqual({ fifths: -2 });
    expect(parsed.parts[0].measures).toHaveLength(8);
    expect(parsed.parts[1].measures).toHaveLength(8);

    // Violin: treble clef, Cello: bass clef
    expect(parsed.parts[0].measures[0].clefs[0].clef.sign).toBe("G");
    expect(parsed.parts[1].measures[0].clefs[0].clef.sign).toBe("F");
  });

  it("uses correct clef for viola (C clef)", () => {
    const settings: NewScoreSettings = {
      title: "Test",
      players: makePlayers("viola"),
      time: { count: 4, unit: 4 },
      keyFifths: 0,
      measureCount: 1,
      tempoBpm: 120,
    };

    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    expect(parsed.parts[0].measures[0].clefs[0].clef.sign).toBe("C");
    expect(parsed.parts[0].measures[0].clefs[0].clef.staffPosition).toBe(0);
  });

  it("outputs parseable JSON", () => {
    const settings: NewScoreSettings = {
      ...DEFAULT_NEW_SCORE_SETTINGS,
      players: makePlayers("piano"),
    };
    const json = buildBlankScore(settings);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("generates layouts and scores for parts tab", () => {
    const settings: NewScoreSettings = {
      title: "Quartet",
      players: makePlayers("violin", "violin", "viola", "cello"),
      time: { count: 4, unit: 4 },
      keyFifths: 0,
      measureCount: 4,
      tempoBpm: 120,
    };

    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    // Should have layouts
    expect(parsed.layouts).toBeDefined();
    expect(parsed.layouts.length).toBeGreaterThanOrEqual(5); // FullScore + 4 part layouts

    // Full score layout
    expect(parsed.layouts[0].id).toBe("FullScore");

    // Should have scores: Full score + 4 parts
    expect(parsed.scores).toHaveLength(5);
    expect(parsed.scores[0].name).toBe("Full score");
    expect(parsed.scores[1].name).toBe("Violin 1");
    expect(parsed.scores[2].name).toBe("Violin 2");
    expect(parsed.scores[3].name).toBe("Viola");
    expect(parsed.scores[4].name).toBe("Cello");
  });

  it("auto-numbers duplicate instruments", () => {
    const players = makePlayers("horn", "horn", "horn", "horn");
    expect(players[0]!.displayName).toBe("Horn in F 1");
    expect(players[1]!.displayName).toBe("Horn in F 2");
    expect(players[2]!.displayName).toBe("Horn in F 3");
    expect(players[3]!.displayName).toBe("Horn in F 4");
  });

  it("adds transposition for transposing instruments", () => {
    const settings: NewScoreSettings = {
      title: "Test",
      players: makePlayers("bflat-clarinet"),
      time: { count: 4, unit: 4 },
      keyFifths: 0,
      measureCount: 1,
      tempoBpm: 120,
    };

    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    expect(parsed.parts[0].transposition).toBeDefined();
    expect(parsed.parts[0].transposition.interval.halfSteps).toBe(2);
    expect(parsed.parts[0].name).toBe("Clarinet");
    expect(parsed.scores[1].name).toBe("Clarinet in B♭");

    // Part score should have useWritten
    expect(parsed.scores[1].useWritten).toBe(true);
  });

  it.each([
    ["snare-drum", 38, "normal"],
    ["cymbals", 49, "x"],
    ["triangle", 81, "x"],
  ] as const)("creates %s as a one-component MNX percussion map", (instrumentId, midiNumber, notehead) => {
    const parsed = JSON.parse(
      buildBlankScore({
        ...DEFAULT_NEW_SCORE_SETTINGS,
        players: makePlayers(instrumentId),
        measureCount: 1,
      }),
    );

    expect(parsed.parts[0].kit.hit.staffPosition).toBe(0);
    expect(parsed.global.sounds[parsed.parts[0].kit.hit.sound].midiNumber).toBe(midiNumber);
    expect(parsed.parts[0].kit.hit._x?.viritura.notehead ?? "normal").toBe(notehead);
  });

  it("uses a customized percussion map supplied by the wizard", () => {
    const [player] = makePlayers("drum-kit");
    player!.kit = [
      { id: "custom", name: "Custom Gong", midiNumber: 45, staffPosition: 2, notehead: "diamond", drumKit: 49 },
    ];
    const parsed = JSON.parse(buildBlankScore({ ...DEFAULT_NEW_SCORE_SETTINGS, players: [player!], measureCount: 1 }));

    expect(Object.keys(parsed.parts[0].kit)).toEqual(["custom"]);
    expect(parsed.parts[0].kit.custom._x.viritura).toEqual({ notehead: "diamond", drumKit: 49 });
    expect(parsed.global.sounds[parsed.parts[0].kit.custom.sound].midiNumber).toBe(45);
  });

  it("groups instruments by family with brackets", () => {
    const settings: NewScoreSettings = {
      title: "Test",
      players: makePlayers("flute", "oboe", "trumpet", "trombone", "violin", "cello"),
      time: { count: 4, unit: 4 },
      keyFifths: 0,
      measureCount: 1,
      tempoBpm: 120,
    };

    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    // Full score layout should have bracket groups
    const fullLayout = parsed.layouts[0];
    const groups = fullLayout.content.filter((c: { type: string }) => c.type === "group");
    expect(groups.length).toBeGreaterThanOrEqual(3); // Woodwinds, Brass, Strings
  });

  it("generates nested brackets for sub-groups within a family", () => {
    // Two flutes + two oboes → woodwinds bracket with two nested line brackets
    const settings: NewScoreSettings = {
      title: "Test",
      players: makePlayers("flute", "flute", "oboe", "oboe"),
      time: { count: 4, unit: 4 },
      keyFifths: 0,
      measureCount: 1,
      tempoBpm: 120,
    };

    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    const fullLayout = parsed.layouts[0];
    // Outer: one bracket group for woodwinds
    expect(fullLayout.content).toHaveLength(1);
    const wwGroup = fullLayout.content[0];
    expect(wwGroup.type).toBe("group");
    expect(wwGroup.symbol).toBe("bracket");
    // Inner: two nested bracket subgroups (flutes, oboes)
    expect(wwGroup.content).toHaveLength(2);
    expect(wwGroup.content[0].type).toBe("group");
    expect(wwGroup.content[0].symbol).toBe("bracket");
    expect(wwGroup.content[0].content).toHaveLength(2); // 2 flutes
    expect(wwGroup.content[1].type).toBe("group");
    expect(wwGroup.content[1].symbol).toBe("bracket");
    expect(wwGroup.content[1].content).toHaveLength(2); // 2 oboes
  });

  it("does not nest when only one sub-group exists", () => {
    // Two flutes only → one flat bracket, no nesting
    const settings: NewScoreSettings = {
      title: "Test",
      players: makePlayers("flute", "flute"),
      time: { count: 4, unit: 4 },
      keyFifths: 0,
      measureCount: 1,
      tempoBpm: 120,
    };

    const json = buildBlankScore(settings);
    const parsed = JSON.parse(json);

    const fullLayout = parsed.layouts[0];
    const wwGroup = fullLayout.content[0];
    expect(wwGroup.type).toBe("group");
    expect(wwGroup.symbol).toBe("bracket");
    // All staves should be flat children (no nested bracket groups)
    for (const child of wwGroup.content) {
      expect(child.type).toBe("staff");
    }
  });
});

describe("INSTRUMENT_CATALOG", () => {
  it("has a comprehensive set of instruments", () => {
    expect(INSTRUMENT_CATALOG.length).toBeGreaterThan(40);
  });

  it("every instrument has required fields", () => {
    for (const inst of INSTRUMENT_CATALOG) {
      expect(inst.id).toBeTruthy();
      expect(inst.name).toBeTruthy();
      expect(inst.shortName).toBeTruthy();
      expect(inst.family).toBeTruthy();
      expect(inst.staves).toBeGreaterThanOrEqual(1);
      for (let s = 1; s <= inst.staves; s++) {
        expect(inst.clefs[s]).toBeDefined();
        expect(inst.clefs[s]!.sign).toBeTruthy();
        expect(typeof inst.clefs[s]!.staffPosition).toBe("number");
      }
      expect(typeof inst.midiProgram).toBe("number");
      expect(typeof inst.rangeLow).toBe("number");
      expect(typeof inst.rangeHigh).toBe("number");
    }
  });
});

describe("ENSEMBLE_TEMPLATES", () => {
  it("has multiple templates", () => {
    expect(ENSEMBLE_TEMPLATES.length).toBeGreaterThan(5);
  });

  it("all templates expand to valid players", () => {
    for (const tmpl of ENSEMBLE_TEMPLATES) {
      const players = expandTemplate(tmpl.id);
      expect(players.length).toBeGreaterThan(0);
      for (const p of players) {
        expect(p.displayName).toBeTruthy();
        expect(p.instrumentId).toBeTruthy();
      }
    }
  });
});

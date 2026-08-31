import { describe, it, expect } from "vitest";
import {
  extractPlayersFromScore,
  applyPlayerChanges,
  buildLayouts,
  buildScoreDefinitions,
  applyScoreDefChanges,
  addInstrumentToScore,
  removeInstrumentFromScore,
  insertEmptyMeasures,
  appendEmptyMeasures,
  synchronizePartScoreDefinitions,
} from "../score/ScoreMutations";
import { buildBlankScore, type NewScoreSettings } from "../score/ScoreBuilder";
import { createPlayer, renumberPlayers } from "../score/InstrumentCatalog";
import { parseMnx } from "@viritura/format";
import type { Score, LayoutStaff, LayoutGroup } from "@viritura/core";

/** Create a parsed score from instrument IDs. */
function makeScore(...ids: string[]): Score {
  const players = renumberPlayers(ids.map((id) => createPlayer(id)));
  const settings: NewScoreSettings = {
    title: "Test",
    players,
    time: { count: 4, unit: 4 },
    keyFifths: 0,
    measureCount: 4,
    tempoBpm: 120,
  };
  return parseMnx(JSON.parse(buildBlankScore(settings)));
}

describe("extractPlayersFromScore", () => {
  it("extracts players from a simple score", () => {
    const score = makeScore("flute", "violin");
    const players = extractPlayersFromScore(score);

    expect(players).toHaveLength(2);
    expect(players[0]!.instrumentId).toBe("flute");
    expect(players[0]!.partIndex).toBe(0);
    expect(players[1]!.instrumentId).toBe("violin");
    expect(players[1]!.partIndex).toBe(1);
  });

  it("extracts players from a score with duplicates", () => {
    const score = makeScore("violin", "violin", "cello");
    const players = extractPlayersFromScore(score);

    expect(players).toHaveLength(3);
    expect(players[0]!.instrumentId).toBe("violin");
    expect(players[1]!.instrumentId).toBe("violin");
    expect(players[2]!.instrumentId).toBe("cello");
  });

  it("recognizes multi-staff instruments", () => {
    const score = makeScore("piano");
    const players = extractPlayersFromScore(score);

    expect(players).toHaveLength(1);
    expect(players[0]!.instrumentId).toBe("piano");
  });
});

describe("applyPlayerChanges", () => {
  it("preserves music data when reordering parts", () => {
    const score = makeScore("flute", "violin");
    const originalPart0 = score.parts[0]!;
    const originalPart1 = score.parts[1]!;

    // Reverse order: violin first, then flute
    const players = renumberPlayers([createPlayer("violin"), createPlayer("flute")]);

    const result = applyPlayerChanges(score, {
      players,
      originalPartIndices: [1, 0], // violin was index 1, flute was index 0
    });

    expect(result.parts).toHaveLength(2);
    // Violin (previously at index 1) now at index 0 — same measures
    expect(result.parts[0]!.name).toBe("Violin");
    expect(result.parts[0]!.measures).toHaveLength(originalPart1.measures.length);
    // Flute (previously at index 0) now at index 1
    expect(result.parts[1]!.name).toBe("Flute");
    expect(result.parts[1]!.measures).toHaveLength(originalPart0.measures.length);
  });

  it("adds new parts with empty measures", () => {
    const score = makeScore("flute");
    const players = renumberPlayers([createPlayer("flute"), createPlayer("oboe")]);

    const result = applyPlayerChanges(score, {
      players,
      originalPartIndices: [0, -1], // flute exists, oboe is new
    });

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]!.name).toBe("Flute");
    expect(result.parts[1]!.name).toBe("Oboe");
    // New part should have same number of measures as existing
    expect(result.parts[1]!.measures).toHaveLength(score.global.measures.length);
  });

  it("removes parts", () => {
    const score = makeScore("flute", "oboe", "violin");
    // Keep only flute and violin
    const players = renumberPlayers([createPlayer("flute"), createPlayer("violin")]);

    const result = applyPlayerChanges(score, {
      players,
      originalPartIndices: [0, 2], // flute at 0, violin at 2 (oboe removed)
    });

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]!.name).toBe("Flute");
    expect(result.parts[1]!.name).toBe("Violin");
  });

  it("rebuilds layouts and scores", () => {
    const score = makeScore("flute", "violin");
    const players = renumberPlayers([createPlayer("flute"), createPlayer("oboe"), createPlayer("violin")]);

    const result = applyPlayerChanges(score, {
      players,
      originalPartIndices: [0, -1, 1],
    });

    // Should have FullScore + 3 per-player layouts
    expect(result.layouts).toHaveLength(4);
    expect(result.layouts![0]!.id).toBe("FullScore");

    // Should have Full score + 3 per-player score defs
    expect(result.scores).toHaveLength(4);
    expect(result.scores![0]!.name).toBe("Full score");
  });
});

describe("buildLayouts", () => {
  it("creates full-score layout with brackets", () => {
    const players = renumberPlayers([createPlayer("flute"), createPlayer("oboe")]);
    const partIds = ["P1", "P2"];

    const layouts = buildLayouts(players, partIds);
    const fullScore = layouts[0]!;

    expect(fullScore.id).toBe("FullScore");
    // Both woodwinds → one bracket group
    expect(fullScore.content).toHaveLength(1);
    expect((fullScore.content[0] as { symbol?: string }).symbol).toBe("bracket");
  });

  it("creates per-player layouts", () => {
    const players = renumberPlayers([createPlayer("flute"), createPlayer("violin")]);
    const partIds = ["P1", "P2"];

    const layouts = buildLayouts(players, partIds);

    expect(layouts).toHaveLength(3); // FullScore + 2 per-player
    expect(layouts[1]!.id).toBe("L-P1");
    expect(layouts[2]!.id).toBe("L-P2");
  });
});

describe("buildScoreDefinitions", () => {
  it("creates full score + per-player scores", () => {
    const players = renumberPlayers([createPlayer("flute"), createPlayer("trumpet")]);
    const partIds = ["P1", "P2"];

    const scores = buildScoreDefinitions(players, partIds);

    expect(scores).toHaveLength(3);
    expect(scores[0]!.name).toBe("Full score");
    expect(scores[0]!.layout).toBe("FullScore");
    expect(scores[1]!.name).toBe("Flute");
    expect(scores[1]!.layout).toBe("L-P1");
    // Trumpet is transposing
    expect(scores[2]!.useWritten).toBe(true);
  });
});

describe("applyScoreDefChanges", () => {
  it("replaces score definitions", () => {
    const score = makeScore("flute", "violin");
    const edits = [
      { name: "Conductor", layoutId: "FullScore", useWritten: false },
      { name: "Violin Part", layoutId: "L-P2", useWritten: false },
    ];

    const result = applyScoreDefChanges(score, edits);

    expect(result.scores).toHaveLength(2);
    expect(result.scores![0]!.name).toBe("Conductor");
    expect(result.scores![1]!.name).toBe("Violin Part");
    expect(result.scores![1]!.layout).toBe("L-P2");
  });
});

// ─── insert / append empty measures ──────────────────────────────

describe("insertEmptyMeasures / appendEmptyMeasures", () => {
  it("appends measures to global and every part", () => {
    const score = makeScore("flute", "violin");
    const before = score.global.measures.length;

    const result = appendEmptyMeasures(score, 3);

    expect(result.global.measures).toHaveLength(before + 3);
    for (const part of result.parts) {
      expect(part.measures).toHaveLength(before + 3);
    }
    // Original score is untouched (structural sharing, new object).
    expect(score.global.measures).toHaveLength(before);
  });

  it("inserts measures mid-score at the given index", () => {
    const score = makeScore("flute");
    const before = score.global.measures.length;

    const result = insertEmptyMeasures(score, 1, 2);

    expect(result.global.measures).toHaveLength(before + 2);
    expect(result.parts[0]!.measures).toHaveLength(before + 2);
    // The two inserted part measures carry a meter-independent bar rest.
    const inserted = result.parts[0]!.measures[1]!;
    expect(inserted.sequences![0]).toEqual({
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
  });

  it("inserts a single bar rest in 5/4 without decomposing it", () => {
    const score = makeScore("flute");
    score.global.measures[0]!.time = { count: 5, unit: 4 };

    const result = appendEmptyMeasures(score, 1);
    const inserted = result.parts[0]!.measures.at(-1)!.sequences[0]!;

    expect(inserted.content).toEqual([]);
    expect(inserted.fullMeasure).toEqual({ visualDuration: { base: "whole" } });
  });

  it("clamps an out-of-range index to an append", () => {
    const score = makeScore("flute");
    const before = score.global.measures.length;

    const result = insertEmptyMeasures(score, 9999, 1);

    expect(result.global.measures).toHaveLength(before + 1);
  });

  it("returns the input unchanged for count < 1", () => {
    const score = makeScore("flute");
    expect(insertEmptyMeasures(score, 0, 0)).toBe(score);
    expect(appendEmptyMeasures(score, -1)).toBe(score);
  });
});

// ─── addInstrumentToScore tests ──────────────────────────────────

describe("addInstrumentToScore", () => {
  it("adds a new instrument with empty measures", () => {
    const score = makeScore("flute");
    const result = addInstrumentToScore(score, "oboe");

    expect(result.parts).toHaveLength(2);
    expect(result.parts[1]!.name).toBe("Oboe");
    expect(result.parts[1]!.measures).toHaveLength(score.global.measures.length);
  });

  it("generates a unique part ID", () => {
    const score = makeScore("flute", "violin");
    const result = addInstrumentToScore(score, "oboe");

    const ids = result.parts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it("keeps canonical base names for duplicate instruments", () => {
    const score = makeScore("flute");
    const result = addInstrumentToScore(score, "flute");

    expect(result.parts[0]!.name).toBe("Flute");
    expect(result.parts[1]!.name).toBe("Flute");
  });

  it("keeps canonical short names for duplicate instruments", () => {
    const score = makeScore("flute");
    const result = addInstrumentToScore(score, "flute");

    expect(result.parts[0]!.shortName).toBe("Fl.");
    expect(result.parts[1]!.shortName).toBe("Fl.");
  });

  it("does not mutate the original score", () => {
    const score = makeScore("flute");
    const originalName = score.parts[0]!.name;
    addInstrumentToScore(score, "flute");

    // Original should be untouched
    expect(score.parts[0]!.name).toBe(originalName);
  });

  it("creates a per-part layout and score definition", () => {
    const score = makeScore("flute");
    const result = addInstrumentToScore(score, "oboe");

    const newPartId = result.parts[1]!.id;
    const perPartLayout = result.layouts!.find((l) => l.id === `L-${newPartId}`);
    expect(perPartLayout).toBeDefined();
    expect(perPartLayout!.content).toHaveLength(1);
    expect((perPartLayout!.content[0] as LayoutStaff).sources[0]!.part).toBe(newPartId);

    const perPartScore = result.scores!.find((sd) => sd.layout === `L-${newPartId}`);
    expect(perPartScore).toBeDefined();
    expect(perPartScore!.name).toBe("Oboe");
  });

  it("appends staff to full-score layout only", () => {
    const score = makeScore("flute", "violin");
    const _fullScoreLayoutBefore = score.layouts![0]!;
    const perPartLayoutCount = score.layouts!.length - 1; // FullScore excluded

    const result = addInstrumentToScore(score, "oboe");

    // Per-part layouts for original instruments should be unchanged in content
    for (let i = 1; i <= perPartLayoutCount; i++) {
      const origLayout = score.layouts![i]!;
      const updatedLayout = result.layouts!.find((l) => l.id === origLayout.id);
      expect(updatedLayout).toBeDefined();
      // Per-part layouts should NOT have the new staff
      const allPartIds = collectPartIds(updatedLayout!.content);
      expect(allPartIds).not.toContain(result.parts[2]!.id);
    }

    // Full-score layout should have the new staff
    const fullScoreLayout = result.layouts![0]!;
    const allPartIds = collectPartIds(fullScoreLayout.content);
    expect(allPartIds).toContain(result.parts[2]!.id);
  });

  it("sets useWritten for transposing instruments", () => {
    const score = makeScore("flute");
    const result = addInstrumentToScore(score, "trumpet");

    const trumpetPartId = result.parts[1]!.id;
    const perPartScore = result.scores!.find((sd) => sd.layout === `L-${trumpetPartId}`);
    expect(perPartScore!.useWritten).toBe(true);
  });

  it("returns the score unchanged for unknown instrument ID", () => {
    const score = makeScore("flute");
    const result = addInstrumentToScore(score, "nonexistent_instrument_xyz");

    expect(result).toBe(score);
  });

  it("creates grand staff for piano", () => {
    const score = makeScore("flute");
    const result = addInstrumentToScore(score, "piano");

    const pianoPartId = result.parts[1]!.id;
    const perPartLayout = result.layouts!.find((l) => l.id === `L-${pianoPartId}`);
    expect(perPartLayout).toBeDefined();
    // Piano should have a brace group with 2 staves
    expect(perPartLayout!.content).toHaveLength(1);
    expect((perPartLayout!.content[0] as LayoutGroup).symbol).toBe("brace");
    expect((perPartLayout!.content[0] as LayoutGroup).content).toHaveLength(2);
  });

  it("updates score definition names when renumbering", () => {
    const score = makeScore("flute");
    const result = addInstrumentToScore(score, "flute");

    // Score defs for per-part layouts should match the renumbered names
    const scoreDef1 = result.scores!.find((sd) => sd.layout === `L-${result.parts[0]!.id}`);
    const scoreDef2 = result.scores!.find((sd) => sd.layout === `L-${result.parts[1]!.id}`);
    expect(scoreDef1?.name).toBe("Flute 1");
    expect(scoreDef2?.name).toBe("Flute 2");
  });
});

describe("synchronizePartScoreDefinitions", () => {
  it("derives extract names and useWritten from the updated parts", () => {
    const score = makeScore("flute", "oboe");
    const parts = score.parts.map((part, index) =>
      index === 1
        ? {
            ...part,
            name: "English Horn",
            transposition: { interval: { halfSteps: 7, staffDistance: 4 } },
          }
        : part,
    );

    const definitions = synchronizePartScoreDefinitions(parts, score.scores ?? []);
    const oboeExtract = definitions.find((definition) => definition.layout === `L-${parts[1]!.id}`);
    expect(oboeExtract?.name).toBe("English Horn in F");
    expect(oboeExtract?.useWritten).toBe(true);

    const reset = synchronizePartScoreDefinitions(
      parts.map((part, index) => (index === 1 ? { ...part, transposition: undefined } : part)),
      definitions,
    );
    const resetExtract = reset.find((definition) => definition.layout === `L-${parts[1]!.id}`);
    expect(resetExtract?.name).toBe("English Horn");
    expect(resetExtract?.useWritten).toBeUndefined();
  });

  it("updates imported part-{id} extract names", () => {
    const score = makeScore("bass-drum");
    const part = { ...score.parts[0]!, name: "Percussion", shortName: "Perc." };
    const definitions = synchronizePartScoreDefinitions([part], [{ name: "Bass Drum", layout: `part-${part.id}` }]);

    expect(definitions[0]?.name).toBe("Percussion");
  });
});

// ─── removeInstrumentFromScore tests ─────────────────────────────

describe("removeInstrumentFromScore", () => {
  it("removes a part by ID", () => {
    const score = makeScore("flute", "oboe");
    const oboeId = score.parts[1]!.id!;
    const result = removeInstrumentFromScore(score, oboeId);

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.name).toBe("Flute");
  });

  it("does not mutate the original score", () => {
    const score = makeScore("flute", "oboe");
    const originalPartCount = score.parts.length;
    const oboeId = score.parts[1]!.id!;
    removeInstrumentFromScore(score, oboeId);

    expect(score.parts).toHaveLength(originalPartCount);
  });

  it("refuses to remove the last instrument", () => {
    const score = makeScore("flute");
    const fluteId = score.parts[0]!.id!;
    const result = removeInstrumentFromScore(score, fluteId);

    expect(result.parts).toHaveLength(1);
    expect(result).toBe(score); // returns the same object
  });

  it("returns score unchanged for unknown part ID", () => {
    const score = makeScore("flute", "oboe");
    const result = removeInstrumentFromScore(score, "nonexistent");

    expect(result).toBe(score);
  });

  it("removes the per-part layout and score definition", () => {
    const score = makeScore("flute", "oboe");
    const oboeId = score.parts[1]!.id!;
    const result = removeInstrumentFromScore(score, oboeId);

    expect(result.layouts!.find((l) => l.id === `L-${oboeId}`)).toBeUndefined();
    expect(result.scores!.find((sd) => sd.layout === `L-${oboeId}`)).toBeUndefined();
  });

  it("removes the part from all layouts", () => {
    const score = makeScore("flute", "oboe");
    const oboeId = score.parts[1]!.id!;
    const result = removeInstrumentFromScore(score, oboeId);

    // No layout should reference the removed part
    for (const layout of result.layouts!) {
      const partIds = collectPartIds(layout.content);
      expect(partIds).not.toContain(oboeId);
    }
  });

  it("removes the number when only one of a kind remains", () => {
    const score = makeScore("flute", "flute");
    expect(score.scores?.find((entry) => entry.layout === `L-${score.parts[0]!.id}`)?.name).toBe("Flute 1");
    expect(score.scores?.find((entry) => entry.layout === `L-${score.parts[1]!.id}`)?.name).toBe("Flute 2");

    const flute2Id = score.parts[1]!.id!;
    const result = removeInstrumentFromScore(score, flute2Id);

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.name).toBe("Flute");
    expect(result.scores?.find((entry) => entry.layout === `L-${result.parts[0]!.id}`)?.name).toBe("Flute");
  });

  it("renumbers remaining parts when removing from middle", () => {
    const score = makeScore("flute", "flute", "flute");

    const flute2Id = score.parts[1]!.id!;
    const result = removeInstrumentFromScore(score, flute2Id);

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]!.name).toBe("Flute");
    expect(result.parts[1]!.name).toBe("Flute");
    expect(result.scores?.find((entry) => entry.layout === `L-${result.parts[0]!.id}`)?.name).toBe("Flute 1");
    expect(result.scores?.find((entry) => entry.layout === `L-${result.parts[1]!.id}`)?.name).toBe("Flute 2");
  });

  it("updates shortName when renumbering after removal", () => {
    const score = makeScore("flute", "flute");
    const flute2Id = score.parts[1]!.id!;
    const result = removeInstrumentFromScore(score, flute2Id);

    // Only one left — short name should lose the number
    expect(result.parts[0]!.shortName).toBe("Fl.");
  });
});

// ─── Test helpers ────────────────────────────────────────────────

/** Collect all part IDs referenced in a layout content tree. */
function collectPartIds(
  content: Array<{ type: string; sources?: Array<{ part: string }>; content?: unknown[] }>,
): string[] {
  const ids: string[] = [];
  for (const node of content) {
    if (node.type === "staff" && node.sources) {
      for (const src of node.sources) ids.push(src.part);
    } else if (node.type === "group" && node.content) {
      ids.push(
        ...collectPartIds(
          node.content as Array<{ type: string; sources?: Array<{ part: string }>; content?: unknown[] }>,
        ),
      );
    }
  }
  return ids;
}

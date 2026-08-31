import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { applyPatchesToScore } from "@viritura/core";
import {
  toggleArticulation,
  toggleDynamic,
  setBreathMark,
  setCaesura,
  setSingleTremoloMarks,
  setMultiNoteTremolo,
  removeMultiNoteTremolo,
  setFermataShape,
  setTrillAccidental,
  setOrnaments,
  setArpeggioDirection,
  setArpeggioMark,
  setFingerings,
  planToggleArticulation,
  planSetBreathMark,
  planSetCaesura,
  planSetSingleTremoloMarks,
  planSetFermataShape,
  planSetTrillAccidental,
  planSetOrnaments,
  planSetFingerings,
  planToggleDynamic,
  planSetArpeggioMark,
  planSetArpeggioDirection,
} from "../commands/articulationCommands";

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function makeScoreWithNote(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                  {
                    type: "event",
                    id: "ev2",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
                  },
                  {
                    type: "event",
                    id: "ev3",
                    duration: { base: "half" },
                    rest: {},
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function getEvent(score: Score, eventIndex: number) {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[eventIndex]!;
}

// ═══════════════════════════════════════════
// Articulation toggle tests
// ═══════════════════════════════════════════

describe("toggleArticulation", () => {
  it("adds staccato to a note", () => {
    const score = makeScoreWithNote();
    const result = toggleArticulation(score, 0, 0, 0, 0, "staccato");
    expect(result).not.toBeNull();
    const ev = getEvent(result!, 0);
    expect(ev.markings).toBeDefined();
    expect(ev.markings!.staccato).toBeDefined();
  });

  it("removes staccato when toggled again", () => {
    const score = makeScoreWithNote();
    toggleArticulation(score, 0, 0, 0, 0, "staccato");
    const result = toggleArticulation(score, 0, 0, 0, 0, "staccato");
    expect(result).not.toBeNull();
    const ev = getEvent(result!, 0);
    expect(ev.markings).toBeUndefined();
  });

  it("adds accent to a note", () => {
    const score = makeScoreWithNote();
    const result = toggleArticulation(score, 0, 0, 0, 0, "accent");
    expect(result).not.toBeNull();
    const ev = getEvent(result!, 0);
    expect(ev.markings!.accent).toBeDefined();
  });

  it("adds tenuto to a note", () => {
    const score = makeScoreWithNote();
    const result = toggleArticulation(score, 0, 0, 0, 0, "tenuto");
    expect(result).not.toBeNull();
    const ev = getEvent(result!, 0);
    expect(ev.markings!.tenuto).toBeDefined();
  });

  it("adds marcato (strongAccent) to a note", () => {
    const score = makeScoreWithNote();
    const result = toggleArticulation(score, 0, 0, 0, 0, "strongAccent");
    expect(result).not.toBeNull();
    const ev = getEvent(result!, 0);
    expect(ev.markings!.strongAccent).toBeDefined();
  });

  it("adds spiccato to a note", () => {
    const score = makeScoreWithNote();
    const result = toggleArticulation(score, 0, 0, 0, 0, "spiccato");
    expect(result).not.toBeNull();
    const ev = getEvent(result!, 0);
    expect(ev.markings!.spiccato).toBeDefined();
  });

  it("adds soft accent to a note", () => {
    const score = makeScoreWithNote();
    const result = toggleArticulation(score, 0, 0, 0, 0, "softAccent");
    expect(result).not.toBeNull();
    const ev = getEvent(result!, 0);
    expect(ev.markings!.softAccent).toBeDefined();
  });

  it("removes spiccato when toggled again", () => {
    const score = makeScoreWithNote();
    toggleArticulation(score, 0, 0, 0, 0, "spiccato");
    const result = toggleArticulation(score, 0, 0, 0, 0, "spiccato");
    expect(result).not.toBeNull();
    const ev = getEvent(result!, 0);
    expect(ev.markings).toBeUndefined();
  });

  it("supports multiple articulations on one note", () => {
    const score = makeScoreWithNote();
    toggleArticulation(score, 0, 0, 0, 0, "staccato");
    toggleArticulation(score, 0, 0, 0, 0, "accent");
    const ev = getEvent(score, 0);
    expect(ev.markings!.staccato).toBeDefined();
    expect(ev.markings!.accent).toBeDefined();
  });

  it("removes only the toggled articulation, keeping others", () => {
    const score = makeScoreWithNote();
    toggleArticulation(score, 0, 0, 0, 0, "staccato");
    toggleArticulation(score, 0, 0, 0, 0, "accent");
    toggleArticulation(score, 0, 0, 0, 0, "staccato");
    const ev = getEvent(score, 0);
    expect(ev.markings!.staccato).toBeUndefined();
    expect(ev.markings!.accent).toBeDefined();
  });

  it("returns null for a rest", () => {
    const score = makeScoreWithNote();
    const result = toggleArticulation(score, 0, 0, 0, 2, "staccato");
    expect(result).toBeNull();
  });

  it("returns null for invalid location", () => {
    const score = makeScoreWithNote();
    expect(toggleArticulation(score, 5, 0, 0, 0, "staccato")).toBeNull();
    expect(toggleArticulation(score, 0, 5, 0, 0, "staccato")).toBeNull();
    expect(toggleArticulation(score, 0, 0, 5, 0, "staccato")).toBeNull();
  });
});

describe("event marking setters", () => {
  it("sets and clears breath symbol", () => {
    const score = makeScoreWithNote();
    setBreathMark(score, 0, 0, 0, 0, "tick");
    const ev = getEvent(score, 0);
    expect(ev.markings?.breath?.symbol).toBe("tick");
    setBreathMark(score, 0, 0, 0, 0);
    expect(ev.markings?.breath).toBeUndefined();
  });

  it("sets and clears single-note tremolo marks", () => {
    const score = makeScoreWithNote();
    setSingleTremoloMarks(score, 0, 0, 0, 0, 3);
    const ev = getEvent(score, 0);
    expect(ev.markings?.tremolo?.marks).toBe(3);
    setSingleTremoloMarks(score, 0, 0, 0, 0);
    expect(ev.markings?.tremolo).toBeUndefined();
  });

  it("supports fermata shape on rests", () => {
    const score = makeScoreWithNote();
    setFermataShape(score, 0, 0, 0, 2, "square");
    const ev = getEvent(score, 2);
    expect(ev.fermata?.symbol).toBe("square");
  });

  it("sets trill accidental and ornaments", () => {
    const score = makeScoreWithNote();
    setTrillAccidental(score, 0, 0, 0, 0, -1);
    setOrnaments(score, 0, 0, 0, 0, ["turn", "mordent"]);
    const ev = getEvent(score, 0);
    expect(ev.markings?.trill?.accidental).toBe(-1);
    expect(ev.markings?.ornaments).toEqual(["turn", "mordent"]);
  });

  it("requires a chord for arpeggio direction", () => {
    const score = makeScoreWithNote();
    expect(setArpeggioDirection(score, 0, 0, 0, 0, "down")).toBeNull();
    const ev = getEvent(score, 0);
    if (ev.type === "event") {
      ev.notes = [{ pitch: { step: "C", octave: 4 } }, { pitch: { step: "E", octave: 4 } }];
    }
    expect(setArpeggioDirection(score, 0, 0, 0, 0, "down")).not.toBeNull();
    const arpeggio = score.parts[0]!.measures[0]!.arpeggios![0]!;
    expect(arpeggio.direction).toBe("down");
    expect(arpeggio.arrow).toBe(true);
    expect(arpeggio.span.start).toBeDefined();
    expect(arpeggio.span.end).toBeDefined();
  });

  it("sets plain arpeggio and non-arpeggio bracket as MNX measure objects", () => {
    const score = makeScoreWithNote();
    const ev = getEvent(score, 0);
    if (ev.type === "event") {
      ev.notes = [
        { id: "low", pitch: { step: "C", octave: 4 } },
        { id: "high", pitch: { step: "E", octave: 4 } },
      ];
    }

    expect(setArpeggioMark(score, 0, 0, 0, 0, "plain")).not.toBeNull();
    expect(score.parts[0]!.measures[0]!.arpeggios).toEqual([
      { position: { fraction: [0, 1] }, span: { start: "low", end: "high" }, direction: "auto", arrow: false },
    ]);

    expect(setArpeggioMark(score, 0, 0, 0, 0, "nonArpeggio")).not.toBeNull();
    expect(score.parts[0]!.measures[0]!.arpeggios).toBeUndefined();
    expect(score.parts[0]!.measures[0]!.nonArpeggios).toEqual([
      { position: { fraction: [0, 1] }, span: { start: "low", end: "high" } },
    ]);
  });

  it("sanitizes fingering values", () => {
    const score = makeScoreWithNote();
    setFingerings(score, 0, 0, 0, 0, [1, -2, 6, 3]);
    const ev = getEvent(score, 0);
    expect(ev.markings?.fingerings?.map((f) => f.finger)).toEqual([1, 3]);
  });
});

describe("multi-note tremolo", () => {
  it("doubles the displayed note values while preserving the pair duration", () => {
    const score = makeScoreWithNote();
    expect(setMultiNoteTremolo(score, 0, 0, 0, 0, 1, 2)).not.toBeNull();
    const tremolo = getEvent(score, 0);
    expect(tremolo.type).toBe("tremolo");
    if (tremolo.type !== "tremolo") return;
    expect(tremolo.content.map((event) => event.duration)).toEqual([{ base: "half" }, { base: "half" }]);
    expect(tremolo.outer).toEqual({ duration: { base: "quarter" }, multiple: 2 });
    expect(tremolo.individualDuration).toEqual({ base: "quarter" });
  });

  it("explicitly removes a tremolo and restores the original durations", () => {
    const score = makeScoreWithNote();
    setMultiNoteTremolo(score, 0, 0, 0, 0, 1, 3);
    expect(removeMultiNoteTremolo(score, 0, 0, 0, 0)).not.toBeNull();
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content.slice(0, 2).map((event) => event.duration)).toEqual([
      { base: "quarter" },
      { base: "quarter" },
    ]);
  });
});

// ═══════════════════════════════════════════
// Dynamic toggle tests
// ═══════════════════════════════════════════

describe("toggleDynamic", () => {
  it("adds a dynamic at the event's position", () => {
    const score = makeScoreWithNote();
    const result = toggleDynamic(score, 0, 0, 0, 0, "f");
    expect(result).not.toBeNull();
    const pm = result!.parts[0]!.measures[0]!;
    expect(pm.dynamics).toBeDefined();
    expect(pm.dynamics!.length).toBe(1);
    expect(pm.dynamics![0]!.value).toBe("f");
    // First event at position 0/1
    expect(pm.dynamics![0]!.position.fraction[0]).toBe(0);
  });

  it("keeps simultaneous dynamics separate by voice", () => {
    const score = makeScoreWithNote();
    const measure = score.parts[0]!.measures[0]!;
    measure.sequences = [
      { ...measure.sequences[0]!, voice: "v1" },
      {
        voice: "v2",
        content: [
          {
            type: "event",
            id: "lower",
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "C", octave: 3 } }],
          },
        ],
      },
    ];

    toggleDynamic(score, 0, 0, 0, 0, "f");
    toggleDynamic(score, 0, 0, 1, 0, "p");

    expect(measure.dynamics).toHaveLength(2);
    expect(measure.dynamics?.map((dynamic) => dynamic.voice)).toEqual(["v1", "v2"]);
  });

  it("adds dynamic at second event position", () => {
    const score = makeScoreWithNote();
    const result = toggleDynamic(score, 0, 0, 0, 1, "pp");
    expect(result).not.toBeNull();
    const pm = result!.parts[0]!.measures[0]!;
    expect(pm.dynamics!.length).toBe(1);
    expect(pm.dynamics![0]!.value).toBe("pp");
    // Second event at beat 1 = 1/4 of whole note
    expect(pm.dynamics![0]!.position.fraction[0]).toBeGreaterThan(0);
  });

  it("removes dynamic when toggled with same value", () => {
    const score = makeScoreWithNote();
    toggleDynamic(score, 0, 0, 0, 0, "f");
    const result = toggleDynamic(score, 0, 0, 0, 0, "f");
    expect(result).not.toBeNull();
    const pm = result!.parts[0]!.measures[0]!;
    expect(pm.dynamics).toBeUndefined();
  });

  it("replaces dynamic when toggled with different value", () => {
    const score = makeScoreWithNote();
    toggleDynamic(score, 0, 0, 0, 0, "f");
    const result = toggleDynamic(score, 0, 0, 0, 0, "pp");
    expect(result).not.toBeNull();
    const pm = result!.parts[0]!.measures[0]!;
    expect(pm.dynamics!.length).toBe(1);
    expect(pm.dynamics![0]!.value).toBe("pp");
  });

  it("supports dynamics at different positions", () => {
    const score = makeScoreWithNote();
    toggleDynamic(score, 0, 0, 0, 0, "f");
    toggleDynamic(score, 0, 0, 0, 1, "p");
    const pm = score.parts[0]!.measures[0]!;
    expect(pm.dynamics!.length).toBe(2);
  });

  it("returns null for invalid location", () => {
    const score = makeScoreWithNote();
    expect(toggleDynamic(score, 5, 0, 0, 0, "f")).toBeNull();
    expect(toggleDynamic(score, 0, 5, 0, 0, "f")).toBeNull();
  });
});

// ═══════════════════════════════════════════
// Patch-IR (plan*) siblings — convergence with in-place mutators
// ═══════════════════════════════════════════
//
// Each test runs the plan* sibling against a score with part id "p1",
// applies the resulting patches via the canonical Immer interpreter, then
// compares against running the in-place mutator on a structural clone of
// the same input. Convergence here proves the new patch path is a
// drop-in for the marking/fermata setters.

function makeScoreWithPartId(): Score {
  const s = makeScoreWithNote();
  s.parts[0]!.id = "p1";
  return s;
}

function normalizeDynamicIds(score: Score): Score {
  const clone = structuredClone(score);
  for (const part of clone.parts) {
    for (const measure of part.measures) {
      for (const [index, dynamic] of (measure.dynamics ?? []).entries()) dynamic.id = `dynamic-${index}`;
    }
  }
  return clone;
}

function expectPlanMatchesMutator(
  plan: readonly import("@viritura/core").ScorePatch[] | null,
  runMutator: (s: Score) => void,
): void {
  expect(plan).not.toBeNull();
  const viaPatches = applyPatchesToScore(makeScoreWithPartId(), plan!);
  const viaMutator = makeScoreWithPartId();
  runMutator(viaMutator);
  expect(normalizeDynamicIds(viaPatches)).toEqual(normalizeDynamicIds(viaMutator));
}

describe("plan* siblings converge with in-place mutators", () => {
  it("planToggleArticulation: adds staccato", () => {
    const score = makeScoreWithPartId();
    expectPlanMatchesMutator(planToggleArticulation(score, 0, 0, 0, 0, "staccato"), (s) => {
      toggleArticulation(s, 0, 0, 0, 0, "staccato");
    });
  });

  it("planToggleArticulation: removes existing staccato", () => {
    const seeded = makeScoreWithPartId();
    toggleArticulation(seeded, 0, 0, 0, 0, "staccato");
    expect(planToggleArticulation(seeded, 0, 0, 0, 0, "staccato")).not.toBeNull();
    const viaPatches = applyPatchesToScore(seeded, planToggleArticulation(seeded, 0, 0, 0, 0, "staccato")!);
    const viaMutator = makeScoreWithPartId();
    toggleArticulation(viaMutator, 0, 0, 0, 0, "staccato");
    toggleArticulation(viaMutator, 0, 0, 0, 0, "staccato");
    expect(normalizeDynamicIds(viaPatches)).toEqual(normalizeDynamicIds(viaMutator));
  });

  it("planSetBreathMark: comma, tick, clear", () => {
    expectPlanMatchesMutator(planSetBreathMark(makeScoreWithPartId(), 0, 0, 0, 0, "comma"), (s) => {
      setBreathMark(s, 0, 0, 0, 0, "comma");
    });
    expectPlanMatchesMutator(planSetBreathMark(makeScoreWithPartId(), 0, 0, 0, 0, "tick"), (s) => {
      setBreathMark(s, 0, 0, 0, 0, "tick");
    });
    expectPlanMatchesMutator(planSetBreathMark(makeScoreWithPartId(), 0, 0, 0, 0), (s) => {
      setBreathMark(s, 0, 0, 0, 0);
    });
  });

  it("planSetCaesura: normal + clear", () => {
    expectPlanMatchesMutator(planSetCaesura(makeScoreWithPartId(), 0, 0, 0, 0, "normal"), (s) => {
      setCaesura(s, 0, 0, 0, 0, "normal");
    });
    expectPlanMatchesMutator(planSetCaesura(makeScoreWithPartId(), 0, 0, 0, 0, "thick"), (s) => {
      setCaesura(s, 0, 0, 0, 0, "thick");
    });
    expectPlanMatchesMutator(planSetCaesura(makeScoreWithPartId(), 0, 0, 0, 0), (s) => {
      setCaesura(s, 0, 0, 0, 0);
    });
  });

  it("planSetSingleTremoloMarks: set + clear", () => {
    expectPlanMatchesMutator(planSetSingleTremoloMarks(makeScoreWithPartId(), 0, 0, 0, 0, 3), (s) => {
      setSingleTremoloMarks(s, 0, 0, 0, 0, 3);
    });
    expectPlanMatchesMutator(planSetSingleTremoloMarks(makeScoreWithPartId(), 0, 0, 0, 0), (s) => {
      setSingleTremoloMarks(s, 0, 0, 0, 0);
    });
  });

  it("planSetFermataShape: normal, square, clear (applied to a rest event)", () => {
    // Index 2 is the rest in this fixture — fermata is legal on rests.
    expectPlanMatchesMutator(planSetFermataShape(makeScoreWithPartId(), 0, 0, 0, 2, "normal"), (s) => {
      setFermataShape(s, 0, 0, 0, 2, "normal");
    });
    expectPlanMatchesMutator(planSetFermataShape(makeScoreWithPartId(), 0, 0, 0, 2, "square"), (s) => {
      setFermataShape(s, 0, 0, 0, 2, "square");
    });
    expectPlanMatchesMutator(planSetFermataShape(makeScoreWithPartId(), 0, 0, 0, 2), (s) => {
      setFermataShape(s, 0, 0, 0, 2);
    });
  });

  it("planSetTrillAccidental: -1, null (plain), clear", () => {
    expectPlanMatchesMutator(planSetTrillAccidental(makeScoreWithPartId(), 0, 0, 0, 0, -1), (s) => {
      setTrillAccidental(s, 0, 0, 0, 0, -1);
    });
    expectPlanMatchesMutator(planSetTrillAccidental(makeScoreWithPartId(), 0, 0, 0, 0, null), (s) => {
      setTrillAccidental(s, 0, 0, 0, 0, null);
    });
    expectPlanMatchesMutator(planSetTrillAccidental(makeScoreWithPartId(), 0, 0, 0, 0), (s) => {
      setTrillAccidental(s, 0, 0, 0, 0);
    });
  });

  it("planSetOrnaments: set + clear", () => {
    expectPlanMatchesMutator(planSetOrnaments(makeScoreWithPartId(), 0, 0, 0, 0, ["turn", "mordent"]), (s) => {
      setOrnaments(s, 0, 0, 0, 0, ["turn", "mordent"]);
    });
    expectPlanMatchesMutator(planSetOrnaments(makeScoreWithPartId(), 0, 0, 0, 0, []), (s) => {
      setOrnaments(s, 0, 0, 0, 0, []);
    });
  });

  it("planSetFingerings: sanitizes + clears", () => {
    expectPlanMatchesMutator(planSetFingerings(makeScoreWithPartId(), 0, 0, 0, 0, [1, -2, 6, 3]), (s) => {
      setFingerings(s, 0, 0, 0, 0, [1, -2, 6, 3]);
    });
    expectPlanMatchesMutator(planSetFingerings(makeScoreWithPartId(), 0, 0, 0, 0, []), (s) => {
      setFingerings(s, 0, 0, 0, 0, []);
    });
  });

  it("returns null when the part has no id", () => {
    const noId = makeScoreWithNote(); // no part.id
    expect(planToggleArticulation(noId, 0, 0, 0, 0, "staccato")).toBeNull();
    expect(planSetFermataShape(noId, 0, 0, 0, 2, "normal")).toBeNull();
    expect(planToggleDynamic(noId, 0, 0, 0, 0, "f")).toBeNull();
    expect(planSetArpeggioMark(noId, 0, 0, 0, 0, "up")).toBeNull();
  });

  // ── measure-level plan* siblings ────────────────────────────────────────

  /** Score with a 2-note chord (with ids) on event 0 — needed for arpeggio plans. */
  function makeScoreWithChordId(): Score {
    const s = makeScoreWithPartId();
    const ev = s.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      ev.notes = [
        { id: "low", pitch: { step: "C", octave: 4 } },
        { id: "high", pitch: { step: "E", octave: 4 } },
      ];
    }
    return s;
  }

  function expectPlanMatchesMutatorOn(
    makeScore: () => Score,
    plan: readonly import("@viritura/core").ScorePatch[] | null,
    runMutator: (s: Score) => void,
  ): void {
    expect(plan).not.toBeNull();
    const viaPatches = applyPatchesToScore(makeScore(), plan!);
    const viaMutator = makeScore();
    runMutator(viaMutator);
    expect(viaPatches).toEqual(viaMutator);
  }

  it("planToggleDynamic: adds a dynamic at event 0", () => {
    expectPlanMatchesMutator(planToggleDynamic(makeScoreWithPartId(), 0, 0, 0, 0, "f"), (s) => {
      toggleDynamic(s, 0, 0, 0, 0, "f");
    });
  });

  it("planToggleDynamic: same value at same position toggles off", () => {
    const seeded = makeScoreWithPartId();
    toggleDynamic(seeded, 0, 0, 0, 0, "f");
    expectPlanMatchesMutatorOn(
      () => structuredClone(seeded),
      planToggleDynamic(seeded, 0, 0, 0, 0, "f"),
      (s) => {
        toggleDynamic(s, 0, 0, 0, 0, "f");
      },
    );
  });

  it("planToggleDynamic: different value replaces", () => {
    const seeded = makeScoreWithPartId();
    toggleDynamic(seeded, 0, 0, 0, 0, "f");
    expectPlanMatchesMutatorOn(
      () => structuredClone(seeded),
      planToggleDynamic(seeded, 0, 0, 0, 0, "pp"),
      (s) => {
        toggleDynamic(s, 0, 0, 0, 0, "pp");
      },
    );
  });

  it("planSetArpeggioMark: plain", () => {
    expectPlanMatchesMutatorOn(
      makeScoreWithChordId,
      planSetArpeggioMark(makeScoreWithChordId(), 0, 0, 0, 0, "plain"),
      (s) => {
        setArpeggioMark(s, 0, 0, 0, 0, "plain");
      },
    );
  });

  it("planSetArpeggioMark: nonArpeggio replaces existing arpeggio", () => {
    const seeded = makeScoreWithChordId();
    setArpeggioMark(seeded, 0, 0, 0, 0, "down");
    expectPlanMatchesMutatorOn(
      () => {
        const s = makeScoreWithChordId();
        setArpeggioMark(s, 0, 0, 0, 0, "down");
        return s;
      },
      planSetArpeggioMark(seeded, 0, 0, 0, 0, "nonArpeggio"),
      (s) => {
        setArpeggioMark(s, 0, 0, 0, 0, "nonArpeggio");
      },
    );
  });

  it("planSetArpeggioMark: clear with kind=undefined", () => {
    const seeded = makeScoreWithChordId();
    setArpeggioMark(seeded, 0, 0, 0, 0, "up");
    expectPlanMatchesMutatorOn(
      () => {
        const s = makeScoreWithChordId();
        setArpeggioMark(s, 0, 0, 0, 0, "up");
        return s;
      },
      planSetArpeggioMark(seeded, 0, 0, 0, 0, undefined),
      (s) => {
        setArpeggioMark(s, 0, 0, 0, 0, undefined);
      },
    );
  });

  it("planSetArpeggioMark: requires a chord (notes ≥ 2)", () => {
    // makeScoreWithPartId has a single note on event 0
    expect(planSetArpeggioMark(makeScoreWithPartId(), 0, 0, 0, 0, "up")).toBeNull();
  });

  it("planSetArpeggioMark: returns null when notes lack ids", () => {
    const s = makeScoreWithPartId();
    const ev = s.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      ev.notes = [{ pitch: { step: "C", octave: 4 } }, { pitch: { step: "E", octave: 4 } }];
    }
    expect(planSetArpeggioMark(s, 0, 0, 0, 0, "up")).toBeNull();
  });

  it("planSetArpeggioDirection: wraps planSetArpeggioMark", () => {
    expectPlanMatchesMutatorOn(
      makeScoreWithChordId,
      planSetArpeggioDirection(makeScoreWithChordId(), 0, 0, 0, 0, "down"),
      (s) => {
        setArpeggioDirection(s, 0, 0, 0, 0, "down");
      },
    );
  });
});

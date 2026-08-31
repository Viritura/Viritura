import { describe, expect, it } from "vitest";
import type { LayoutContent, LayoutGroup, LayoutStaff, NoteEvent, Score, SequenceContent } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { refreshOrchestralCondensedScore, splitOrchestralParts } from ".";

describe("splitOrchestralParts", () => {
  it("assigns unique dynamic IDs and remaps continuation links per staff", () => {
    const score = makeScore();
    score.parts.find((part) => part.id === "P2")!.measures[0]!.dynamics = [
      { id: "dynamic-1", type: "immediate", position: { fraction: [0, 1] }, value: "mf" },
      {
        id: "dynamic-2",
        type: "immediate",
        position: { fraction: [1, 2] },
        value: "f",
        visuallyContinues: "dynamic-1",
      },
    ];

    const result = splitOrchestralParts(score);
    const allDynamics = ["P2-1", "P2-2"].flatMap((partId) => {
      const dynamics = result.parts.find((part) => part.id === partId)!.measures[0]!.dynamics!;
      expect(dynamics.every((dynamic) => dynamic.staff === undefined && dynamic.staffEnd === undefined)).toBe(true);
      expect(dynamics[1]!.visuallyContinues).toBe(dynamics[0]!.id);
      return dynamics;
    });
    expect(new Set(allDynamics.map((dynamic) => dynamic.id))).toHaveLength(allDynamics.length);
  });

  it("splits dyads high/low, duplicates a2 singles, and defaults unlabelled singles to first", () => {
    const score = makeScore();
    score.parts[0]!.measures = [measure([event("dyad", [pitch("C", 4), pitch("G", 4)])])];
    score.parts[1]!.measures = [
      {
        ...measure([
          event("both", [pitch("D", 4)]),
          event("reset", [pitch("C", 4), pitch("G", 4)]),
          event("after", [pitch("E", 4)]),
        ]),
        expressions: [expression("a2")],
      },
    ];
    score.parts[2]!.measures = [measure([event("single", [pitch("E", 4)])])];

    const result = splitOrchestralParts(score);

    expect(staffPitches(result, "P2", 1)).toEqual(["G4"]);
    expect(staffPitches(result, "P2", 2)).toEqual(["C4"]);
    expect(staffPitches(result, "P5", 1)).toEqual(["D4", "G4", "E4"]);
    expect(staffPitches(result, "P5", 2)).toEqual(["D4", "C4"]);
    expect(staffPitches(result, "P6", 1)).toEqual(["E4"]);
    expect(staffPitches(result, "P6", 2)).toEqual([]);
    expect(result.parts.find((part) => part.id === "P5-1")!.measures[0]!.expressions).toBeUndefined();
  });

  it("keeps independent voices rhythmically distinct and maps P7 source staff 2 to staff 3", () => {
    const score = makeScore();
    score.parts[0]!.measures = [
      {
        sequences: [
          { staff: 1, voice: "v1", content: [event("v1", [pitch("C", 5)], "half")] },
          { staff: 1, voice: "v2", content: [event("v2", [pitch("C", 4)], "quarter")] },
        ],
      },
    ];
    score.parts[3]!.measures = [
      {
        sequences: [
          { staff: 1, content: [event("tb12", [pitch("D", 4)])] },
          { staff: 2, content: [event("tb3", [pitch("F", 3)])] },
        ],
      },
    ];

    const result = splitOrchestralParts(score);
    const oboe1 = result.parts.find((part) => part.id === "P2-1")!.measures[0]!;
    const oboe2 = result.parts.find((part) => part.id === "P2-2")!.measures[0]!;
    expect(oboe1.sequences.filter(staffPitched)).toHaveLength(1);
    expect(oboe2.sequences.filter(staffPitched)).toHaveLength(1);
    expect(oboe1.sequences.find(staffPitched)?.voice).toBe("v1");
    expect(oboe2.sequences.find(staffPitched)?.voice).toBe("v2");
    expect(staffPitches(result, "P7", 3)).toEqual(["F3"]);
  });

  it("preserves multiple P3 staff-1 sequences only in Clarinet 1", () => {
    const score = makeScore();
    const clarinets = score.parts.find((part) => part.id === "P3")!;
    clarinets.measures = [
      {
        sequences: [
          { staff: 1, voice: "v1", content: [event("cl1-v1", [pitch("C", 5)], "half")] },
          { staff: 1, voice: "v2", content: [event("cl1-v2", [pitch("E", 4)], "quarter")] },
          { staff: 2, voice: "v1", content: [event("cl2", [pitch("G", 4)], "whole")] },
        ],
      },
    ];

    const result = splitOrchestralParts(score);
    const clarinet1 = result.parts.find((part) => part.id === "P3-1")!;
    const clarinet2 = result.parts.find((part) => part.id === "P3-2")!;

    expect(clarinet1.measures[0]!.sequences.map((sequence) => sequence.voice)).toEqual(["v1", "v2"]);
    expect(staffPitches(result, "P3", 1)).toEqual(["C5", "E4"]);
    expect(staffPitches(result, "P3", 2)).toEqual(["G4"]);
    expect(clarinet2.measures[0]!.sequences).toHaveLength(1);
  });

  it("normalizes player labels and persists routing state across measures", () => {
    const score = makeScore();
    score.global.measures.push({});
    score.parts[2]!.measures = [
      { ...measure([event("second-1", [pitch("A", 4)])]), expressions: [expression("II.")] },
      measure([event("second-2", [pitch("B", 4)])]),
    ];

    const result = splitOrchestralParts(score);

    expect(staffPitches(result, "P6", 1)).toEqual([]);
    expect(staffPitches(result, "P6", 2)).toEqual(["A4", "B4"]);
  });

  it("distinguishes combined I.II. routing from III. using P7 source staff context", () => {
    const score = makeScore();
    score.parts[3]!.measures = [
      {
        sequences: [
          { staff: 1, content: [event("tb12", [pitch("D", 4)])] },
          { staff: 2, content: [event("tb3", [pitch("F", 3)])] },
        ],
        expressions: [expression("I.II."), { ...expression("III."), staff: 2 }],
      },
    ];

    const result = splitOrchestralParts(score);

    expect(staffPitches(result, "P7", 1)).toEqual(["D4"]);
    expect(staffPitches(result, "P7", 2)).toEqual(["D4"]);
    expect(staffPitches(result, "P7", 3)).toEqual(["F3"]);
    expect(result.parts.find((part) => part.id === "P7-1")!.measures[0]!.expressions).toBeUndefined();
  });

  it("applies routing labels at their rhythmic position within a measure", () => {
    const score = makeScore();
    score.parts[2]!.measures = [
      {
        ...measure([event("before", [pitch("C", 4)]), event("after", [pitch("D", 4)])]),
        expressions: [{ ...expression("2."), position: { fraction: [1, 4] } }],
      },
    ];

    const result = splitOrchestralParts(score);

    expect(staffPitches(result, "P6", 1)).toEqual(["C4"]);
    expect(staffPitches(result, "P6", 2)).toEqual(["D4"]);
  });

  it("descends into nested content and remaps unique beam, tie, slur, and glissando references", () => {
    const score = makeScore();
    const first = event("e1", [pitch("C", 4)]);
    first.notes![0]!.ties = [{ target: "n2" }];
    first.slurs = [{ target: "e2", startNote: "n1", endNote: "n2" }];
    first.glissandos = [{ target: "n2" }];
    first.notes![0]!.id = "n1";
    const second = event("e2", [pitch("D", 4)]);
    second.notes![0]!.id = "n2";
    score.parts[0]!.measures = [
      {
        sequences: [
          {
            staff: 1,
            content: [
              {
                type: "tuplet",
                inner: { duration: { base: "eighth" }, multiple: 3 },
                outer: { duration: { base: "eighth" }, multiple: 2 },
                content: [
                  { type: "grace", content: [first] },
                  {
                    type: "tremolo",
                    content: [second, event("e3", [pitch("E", 4)])],
                    marks: 1,
                    outer: { duration: { base: "quarter" }, multiple: 1 },
                  },
                ],
              },
            ],
          },
        ],
        beams: [{ events: ["e1", "e2"], beams: [{ events: ["e1", "e2"] }] }],
      },
    ];

    const result = splitOrchestralParts(score);
    const events = collectEvents(
      result.parts.find((part) => part.id === "P2-1")!.measures[0]!.sequences.flatMap((sequence) => sequence.content),
    );
    const routedFirst = events.find((candidate) => candidate.notes?.[0]?.pitch.step === "C")!;
    const routedSecond = events.find((candidate) => candidate.notes?.[0]?.pitch.step === "D")!;
    expect(routedFirst.id).not.toBe("e1");
    expect(routedFirst.notes![0]!.id).not.toBe("n1");
    expect(routedFirst.notes![0]!.ties![0]!.target).toBe(routedSecond.notes![0]!.id);
    expect(routedFirst.slurs![0]).toMatchObject({
      target: routedSecond.id,
      startNote: routedFirst.notes![0]!.id,
      endNote: routedSecond.notes![0]!.id,
    });
    expect(routedFirst.glissandos![0]!.target).toBe(routedSecond.notes![0]!.id);
    expect(result.parts[0]!.measures[0]!.beams![0]!.events).toEqual([routedFirst.id, routedSecond.id]);
    expect(
      new Set(events.flatMap((candidate) => [candidate.id, ...(candidate.notes ?? []).map((note) => note.id)])).size,
    ).toBe(events.reduce((count, candidate) => count + 1 + (candidate.notes?.length ?? 0), 0));
    expect(parseMnx(serializeMnx(result))).toBeDefined();
  });

  it("expands target sources in full-score and extracted-part layouts without duplicate groups", () => {
    const score = makeScore();
    score.parts[3]!.measures[0] = {
      ...score.parts[3]!.measures[0]!,
      clefs: [{ position: { fraction: [0, 1] }, clef: { sign: "F", staffPosition: 2 }, staff: 2 }],
      dynamics: [{ id: "dynamic", type: "immediate", position: { fraction: [0, 1] }, value: "f", staff: 1 }],
    };
    score.layouts = [
      {
        id: "full",
        content: [
          {
            type: "group",
            symbol: "bracket",
            label: "Winds",
            barlineStyle: "mensurstrich",
            content: [
              { type: "staff", label: "Ob.", sources: [{ part: "P2" }] },
              { type: "staff", labelref: "name", sources: [{ part: "P7", staff: 1 }] },
              { type: "staff", sources: [{ part: "P7", staff: 2 }] },
            ],
          },
        ],
      },
      { id: "part", content: [{ type: "staff", sources: [{ part: "P5" }] }] },
    ];

    const result = splitOrchestralParts(score);
    const full = result.layouts![0]!.content[0]!;
    expect(full.type).toBe("group");
    if (full.type !== "group") throw new Error("Expected group");
    expect(full).toMatchObject({ symbol: "bracket", label: "Winds", barlineStyle: "mensurstrich" });
    expect(
      full.content.flatMap((node) => (node.type === "staff" ? node.sources.map((source) => source.part) : [])),
    ).toEqual(["P2-1", "P2-2", "P7-1", "P7-2", "P7-3"]);
    expect(full.content).toEqual(
      expect.arrayContaining([
        { type: "staff", label: "Ob.", sources: [{ part: "P2-1", staff: undefined }] },
        { type: "staff", labelref: "name", sources: [{ part: "P2-2", staff: undefined }] },
        { type: "staff", labelref: "name", sources: [{ part: "P7-1", staff: undefined }] },
        { type: "staff", labelref: "name", sources: [{ part: "P7-2", staff: undefined }] },
        { type: "staff", labelref: "name", sources: [{ part: "P7-3", staff: undefined }] },
      ]),
    );
    expect(result.layouts!.some((layout) => layout.id === "part-P5-1")).toBe(true);
    expect(
      result.parts.find((part) => part.id === "P7-3")!.measures[0]!.clefs?.every((clef) => clef.staff === undefined),
    ).toBe(true);
    for (const partId of ["P7-1", "P7-2"]) {
      expect(
        result.parts
          .find((part) => part.id === partId)!
          .measures[0]!.dynamics?.every((dynamic) => dynamic.staff === undefined),
      ).toBe(true);
    }
  });

  it("replaces combined parts and creates uncondensed, condensed, and individual-player scores", () => {
    const score = makeDocumentScore();
    const result = splitOrchestralParts(score);

    expect(score.parts).toHaveLength(16);
    expect(result.parts).toHaveLength(23);
    expect(result.parts.map((part) => part.id)).toEqual([
      "N1",
      "N2",
      "N3",
      "N4",
      "N5",
      "N6",
      "N7",
      "N8",
      "N9",
      "N10",
      "P2-1",
      "P2-2",
      "P3-1",
      "P3-2",
      "P4-1",
      "P4-2",
      "P5-1",
      "P5-2",
      "P6-1",
      "P6-2",
      "P7-1",
      "P7-2",
      "P7-3",
    ]);
    expect(result.parts.some((part) => ["P2", "P3", "P4", "P5", "P6", "P7"].includes(part.id ?? ""))).toBe(false);
    expect(result.parts.slice(10).map((part) => [part.name, part.shortName])).toEqual([
      ["Oboe 1", "Ob. 1"],
      ["Oboe 2", "Ob. 2"],
      ["Clarinet in B♭ 1", "Cl. 1"],
      ["Clarinet in B♭ 2", "Cl. 2"],
      ["Bassoon 1", "Bsn. 1"],
      ["Bassoon 2", "Bsn. 2"],
      ["Horn in F 1", "Cor. 1"],
      ["Horn in F 2", "Cor. 2"],
      ["Trumpet in Bb 1", "Tr. 1"],
      ["Trumpet in Bb 2", "Tr. 2"],
      ["Trombone 1", "Tbn. 1"],
      ["Trombone 2", "Tbn. 2"],
      ["Trombone 3", "Tbn. 3"],
    ]);
    expect(result.parts.slice(10).every((part) => part.staves === undefined)).toBe(true);
    expect(
      result.parts
        .slice(10)
        .every((part) =>
          part.measures.every((partMeasure) => partMeasure.sequences.every((sequence) => sequence.staff === undefined)),
        ),
    ).toBe(true);

    const fullLayout = result.layouts!.find((layout) => layout.id === "full-score")!;
    expect(flatLayoutSources(fullLayout.content).slice(-13)).toEqual([
      ["P2-1"],
      ["P2-2"],
      ["P3-1"],
      ["P3-2"],
      ["P4-1"],
      ["P4-2"],
      ["P5-1"],
      ["P5-2"],
      ["P6-1"],
      ["P6-2"],
      ["P7-1"],
      ["P7-2"],
      ["P7-3"],
    ]);
    const splitPlayerStaves = collectLayoutStaffs(fullLayout.content).filter(
      (staff) => staff.sources.length === 1 && /^P[2-7]-\d+$/.test(staff.sources[0]?.part ?? ""),
    );
    expect(splitPlayerStaves).toHaveLength(13);
    expect(splitPlayerStaves.every((staff) => Boolean(staff.label?.trim()) || staff.labelref === "name")).toBe(true);
    expect(fullLayout.content[0]).toMatchObject({
      type: "group",
      symbol: "bracket",
      label: "Orchestra",
      barlineStyle: "mensurstrich",
    });
    expect(findGroupByParts(fullLayout.content, ["P7-1", "P7-2", "P7-3"])).toMatchObject({
      symbol: "bracket",
      label: "Tromboni",
      barlineStyle: "unified",
    });

    const condensedLayout = result.layouts!.find((layout) => layout.id === "condensed-score")!;
    const condensedSources = flatLayoutSources(condensedLayout.content);
    expect(condensedSources).toEqual(
      expect.arrayContaining([
        ["P2-1", "P2-2"],
        ["P3-1", "P3-2"],
        ["P4-1", "P4-2"],
        ["P5-1", "P5-2"],
        ["P6-1", "P6-2"],
        ["P7-1", "P7-2"],
        ["P7-3"],
        ["N9"],
        ["N10"],
      ]),
    );
    expect(condensedSources).not.toContainEqual(["N9", "N10"]);

    expect(result.scores?.[0]).toEqual(score.scores?.[0]);
    expect(result.scores?.[1]).toMatchObject({ name: "Condensed Score", layout: "condensed-score" });
    expect(result.layouts).toHaveLength(25);
    expect(result.scores).toHaveLength(25);
    expect(result.scores?.filter((definition) => definition.name === "Condensed Score")).toHaveLength(1);
    expect(
      result.layouts?.some((layout) =>
        ["part-P2", "part-P3", "part-P4", "part-P5", "part-P6", "part-P7"].includes(layout.id),
      ),
    ).toBe(false);
    expect(
      result.scores?.some((definition) =>
        ["Oboi", "Clarinetti in Bb", "Fagotti", "Corni in F", "Trombe in Bb", "Tromboni"].includes(
          definition.name ?? "",
        ),
      ),
    ).toBe(false);
    for (const partId of [
      "P2-1",
      "P2-2",
      "P3-1",
      "P3-2",
      "P4-1",
      "P4-2",
      "P5-1",
      "P5-2",
      "P6-1",
      "P6-2",
      "P7-1",
      "P7-2",
      "P7-3",
    ]) {
      expect(result.layouts?.find((layout) => layout.id === `part-${partId}`)?.content).toEqual([
        { type: "staff", sources: [{ part: partId }], labelref: "name" },
      ]);
      expect(result.scores?.some((definition) => definition.layout === `part-${partId}`)).toBe(true);
    }
    expect(result.scores?.find((definition) => definition.layout === "part-P5-1")?.useWritten).toBe(true);
    expect(result.scores?.find((definition) => definition.layout === "part-P6-1")?.useWritten).toBe(true);
    expect(result.scores?.find((definition) => definition.layout === "part-P3-1")?.useWritten).toBe(true);
    expect(result.scores?.find((definition) => definition.layout === "part-N1")).toMatchObject({
      name: "Flute",
      useWritten: false,
    });

    for (const partId of ["P5-1", "P5-2"]) {
      const part = result.parts.find((candidate) => candidate.id === partId)!;
      expect(part.transposition).toEqual(score.parts.find((candidate) => candidate.id === "P5")!.transposition);
      expect(part._x).toEqual(score.parts.find((candidate) => candidate.id === "P5")!._x);
      expect(result.soundProfile?.parts[partId]).toEqual({ sourceId: "horns" });
    }
    expect(result.soundProfile?.parts.P5).toBeUndefined();
    for (const partId of ["P3-1", "P3-2"]) {
      const part = result.parts.find((candidate) => candidate.id === partId)!;
      expect(part.transposition).toEqual(score.parts.find((candidate) => candidate.id === "P3")!.transposition);
      expect(part._x).toEqual(score.parts.find((candidate) => candidate.id === "P3")!._x);
    }
    for (const partId of ["P4-1", "P4-2"]) {
      expect(result.parts.find((candidate) => candidate.id === partId)!._x).toEqual(
        score.parts.find((candidate) => candidate.id === "P4")!._x,
      );
    }

    const identifiers = result.parts
      .flatMap((part) =>
        part.measures.flatMap((partMeasure) => [
          ...(partMeasure.dynamics ?? []).map((dynamic) => dynamic.id),
          ...collectEvents(partMeasure.sequences.flatMap((sequence) => sequence.content)).flatMap((noteEvent) => [
            noteEvent.id,
            ...(noteEvent.notes ?? []).map((note) => note.id),
          ]),
        ]),
      )
      .filter((id): id is string => Boolean(id));
    expect(new Set(identifiers)).toHaveLength(identifiers.length);

    const roundTripped = parseMnx(serializeMnx(result));
    expect(roundTripped.parts).toHaveLength(23);
    expect(roundTripped.scores?.[1]?.name).toBe("Condensed Score");
    expect(splitOrchestralParts(result)).toEqual(result);
  });

  it("progresses a prior 21-part migration to the final 23-part roster", () => {
    const intermediate = makePrior21Score();

    expect(intermediate.parts).toHaveLength(21);
    const result = splitOrchestralParts(intermediate);

    expect(result.parts).toHaveLength(23);
    expect(result.parts.map((part) => part.id)).toEqual([
      "N1",
      "N2",
      "N3",
      "N4",
      "N5",
      "N6",
      "N7",
      "N8",
      "N9",
      "N10",
      "P2-1",
      "P2-2",
      "P3-1",
      "P3-2",
      "P4-1",
      "P4-2",
      "P5-1",
      "P5-2",
      "P6-1",
      "P6-2",
      "P7-1",
      "P7-2",
      "P7-3",
    ]);
    expect(result.layouts).toHaveLength(25);
    expect(result.scores).toHaveLength(25);
    expect(result.scores?.filter((definition) => definition.name === "Condensed Score")).toHaveLength(1);
    expect(flatLayoutSources(result.layouts!.find((layout) => layout.id === "condensed-score")!.content)).toEqual(
      expect.arrayContaining([
        ["P3-1", "P3-2"],
        ["P4-1", "P4-2"],
      ]),
    );
  });

  it("repairs an already split obsolete brace and condensed layout idempotently", () => {
    const migrated = splitOrchestralParts(makeDocumentScore());
    const fullLayout = migrated.layouts!.find((layout) => layout.id === "full-score")!;
    const condensedLayout = migrated.layouts!.find((layout) => layout.id === "condensed-score")!;
    const fullP7Group = findGroupByParts(fullLayout.content, ["P7-1", "P7-2", "P7-3"]);
    const condensedP7Group = findGroupByParts(condensedLayout.content, ["P7-1", "P7-2", "P7-3"]);
    if (!fullP7Group || !condensedP7Group) throw new Error("Expected P7 groups");
    fullP7Group.symbol = "brace";
    condensedP7Group.symbol = "brace";
    condensedP7Group.content = ["P7-1", "P7-2", "P7-3"].map((part) => ({
      type: "staff",
      sources: [{ part }],
    }));
    for (const partId of ["P2-2", "P5-2", "P6-2", "P7-2", "P7-3"]) {
      const staff = findStaffByPart(fullLayout.content, partId);
      if (!staff) throw new Error(`Expected ${partId} staff`);
      delete staff.label;
      delete staff.labelref;
    }
    const explicitLabelStaff = findStaffByPart(fullLayout.content, "P2-1");
    if (!explicitLabelStaff) throw new Error("Expected P2-1 staff");
    explicitLabelStaff.label = "Ob.";
    delete explicitLabelStaff.labelref;

    const layoutIds = migrated.layouts!.map((layout) => layout.id);
    const scoreDefinitions = structuredClone(migrated.scores);
    const repaired = refreshOrchestralCondensedScore(migrated);
    const repairedFull = repaired.layouts!.find((layout) => layout.id === "full-score")!;
    const repairedCondensed = repaired.layouts!.find((layout) => layout.id === "condensed-score")!;

    expect(findGroupByParts(repairedFull.content, ["P7-1", "P7-2", "P7-3"])?.symbol).toBe("bracket");
    expect(findStaffByPart(repairedFull.content, "P2-1")).toMatchObject({ label: "Ob." });
    for (const partId of ["P2-2", "P5-2", "P6-2", "P7-2", "P7-3"]) {
      expect(findStaffByPart(repairedFull.content, partId)).toMatchObject({ labelref: "name" });
      expect(repaired.layouts?.find((layout) => layout.id === `part-${partId}`)?.content[0]).toMatchObject({
        type: "staff",
        labelref: "name",
        sources: [{ part: partId }],
      });
    }
    expect(flatLayoutSources(repairedCondensed.content)).toEqual(
      expect.arrayContaining([
        ["P2-1", "P2-2"],
        ["P3-1", "P3-2"],
        ["P4-1", "P4-2"],
        ["P5-1", "P5-2"],
        ["P6-1", "P6-2"],
        ["P7-1", "P7-2"],
        ["P7-3"],
      ]),
    );
    expect(findStaffByParts(repairedCondensed.content, ["P2-1", "P2-2"])).toMatchObject({
      sources: [{ part: "P2-1" }, { part: "P2-2" }],
    });
    expect(findStaffByParts(repairedCondensed.content, ["P2-1", "P2-2"])?.labelref).toBeUndefined();
    expect(repaired.layouts!.map((layout) => layout.id)).toEqual(layoutIds);
    expect(repaired.scores).toEqual(scoreDefinitions);
    expect(refreshOrchestralCondensedScore(repaired)).toEqual(repaired);
    const roundTripped = parseMnx(serializeMnx(repaired));
    const roundTrippedCondensed = roundTripped.layouts!.find((layout) => layout.id === "condensed-score")!;
    expect(flatLayoutSources(roundTrippedCondensed.content)).toContainEqual(["P7-1", "P7-2"]);
    expect(flatLayoutSources(roundTrippedCondensed.content)).toContainEqual(["P7-3"]);
  });

  it("preserves unrelated layouts when generated layout IDs collide", () => {
    const score = makeDocumentScore();
    score.layouts!.push(
      { id: "condensed-score", content: [{ type: "staff", sources: [{ part: "N1" }] }] },
      { id: "part-P2-1", content: [{ type: "staff", sources: [{ part: "N2" }] }] },
    );
    score.scores!.push({ name: "Existing Reduced Score", layout: "condensed-score" });

    const result = splitOrchestralParts(score);

    expect(result.layouts?.find((layout) => layout.id === "condensed-score")?.content).toEqual([
      { type: "staff", sources: [{ part: "N1" }] },
    ]);
    expect(result.scores?.find((definition) => definition.name === "Existing Reduced Score")?.layout).toBe(
      "condensed-score",
    );
    expect(result.scores?.[1]?.layout).toBe("condensed-score-2");
    expect(result.layouts?.find((layout) => layout.id === "part-P2-1-2")?.content).toEqual([
      { type: "staff", sources: [{ part: "P2-1" }], labelref: "name" },
    ]);
  });

  it("rejects chords and voice counts that exceed the target players", () => {
    const chordScore = makeScore();
    chordScore.parts[0]!.measures = [measure([event("large", [pitch("C", 4), pitch("E", 4), pitch("G", 4)])])];
    expect(() => splitOrchestralParts(chordScore)).toThrow(/exceeds 2 players/);

    const voicesScore = makeScore();
    voicesScore.parts[0]!.measures = [
      {
        sequences: [1, 2, 3].map((index) => ({
          staff: 1,
          content: [event(`v${String(index)}`, [pitch("C", index + 3)])],
        })),
      },
    ];
    expect(() => splitOrchestralParts(voicesScore)).toThrow(/3 pitched voices for 2 players/);
  });
});

function makeScore(): Score {
  const targets = [
    ["P2", "Oboi", 1],
    ["P5", "Corni in F", 1],
    ["P6", "Trombe in Bb", 1],
    ["P7", "Tromboni", 2],
    ["P3", "Clarinetti in Bb", 2],
    ["P4", "Fagotti", 2],
  ] as const;
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: targets.map(([id, name, staves]) => ({
      id,
      name,
      staves,
      measures: [measure([{ type: "event", id: `${id}-rest`, duration: { base: "whole" }, rest: {} }])],
    })),
  };
}

function measure(content: SequenceContent[]): Score["parts"][number]["measures"][number] {
  return { sequences: [{ staff: 1, content }] };
}

function event(
  id: string,
  notes: NonNullable<NoteEvent["notes"]>,
  base: NoteEvent["duration"]["base"] = "quarter",
): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: notes.map((note, index) => ({ ...note, id: `${id}-n${String(index)}` })),
  };
}

function pitch(
  step: NonNullable<NoteEvent["notes"]>[number]["pitch"]["step"],
  octave: NonNullable<NoteEvent["notes"]>[number]["pitch"]["octave"],
): NonNullable<NoteEvent["notes"]>[number] {
  return { pitch: { step, octave } };
}

function expression(text: string): NonNullable<Score["parts"][number]["measures"][number]["expressions"]>[number] {
  return { text, position: { fraction: [0, 1] } };
}

function staffPitches(score: Score, partId: string, staff: number): string[] {
  const part = score.parts.find((candidate) => candidate.id === `${partId}-${String(staff)}`)!;
  return part.measures.flatMap((partMeasure) =>
    partMeasure.sequences.flatMap((sequence) =>
      collectEvents(sequence.content).flatMap((candidate) =>
        (candidate.notes ?? []).map((note) => `${note.pitch.step}${String(note.pitch.octave)}`),
      ),
    ),
  );
}

function staffPitched(sequence: Score["parts"][number]["measures"][number]["sequences"][number]): boolean {
  return collectEvents(sequence.content).some((candidate) => (candidate.notes?.length ?? 0) > 0);
}

function collectEvents(content: readonly SequenceContent[]): NoteEvent[] {
  return content.flatMap((item): NoteEvent[] => {
    if (item.type === "event") return [item];
    if (item.type === "tuplet") return collectEvents(item.content);
    if (item.type === "grace" || item.type === "tremolo") return item.content;
    return [];
  });
}

function makeDocumentScore(): Score {
  const targets = makeScore().parts;
  targets.sort((left, right) => Number(left.id!.slice(1)) - Number(right.id!.slice(1)));
  targets.find((part) => part.id === "P5")!.transposition = {
    interval: { halfSteps: 7, staffDistance: 4 },
  };
  targets.find((part) => part.id === "P5")!._x = {
    viritura: { instrumentId: "french-horn", midiProgram: 60, family: "brass" },
  };
  targets.find((part) => part.id === "P6")!.transposition = {
    interval: { halfSteps: 2, staffDistance: 1 },
  };
  targets.find((part) => part.id === "P3")!.transposition = {
    interval: { halfSteps: 2, staffDistance: 1 },
  };
  targets.find((part) => part.id === "P3")!._x = {
    viritura: { instrumentId: "bflat-clarinet", midiProgram: 71, family: "woodwinds" },
  };
  targets.find((part) => part.id === "P4")!._x = {
    viritura: { instrumentId: "bassoon", midiProgram: 70, family: "woodwinds" },
  };
  const nonTargets = Array.from({ length: 10 }, (_, index) => ({
    id: `N${String(index + 1)}`,
    name:
      index === 8 ? "Violin 1" : index === 9 ? "Violin 2" : index === 0 ? "Flute" : `Instrument ${String(index + 1)}`,
    measures: [measure([event(`N${String(index + 1)}-event`, [pitch("C", 4)])])],
  }));
  const parts = [...nonTargets, ...targets];
  const fullContent: LayoutContent[] = [
    {
      type: "group",
      symbol: "bracket",
      label: "Orchestra",
      barlineStyle: "mensurstrich",
      content: parts.flatMap((part): LayoutContent[] =>
        part.id === "P7"
          ? [
              {
                type: "group",
                symbol: "brace",
                label: "Tromboni",
                barlineStyle: "unified",
                content: [
                  { type: "staff", labelref: "shortName", sources: [{ part: part.id, staff: 1 }] },
                  { type: "staff", sources: [{ part: part.id, staff: 2 }] },
                ],
              },
            ]
          : [{ type: "staff", labelref: "shortName", sources: [{ part: part.id! }] }],
      ),
    },
  ];
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts,
    layouts: [
      { id: "full-score", content: fullContent },
      ...targets.map((part) => ({
        id: `part-${part.id!}`,
        content: [{ type: "staff" as const, sources: [{ part: part.id! }] }],
      })),
      ...nonTargets.map((part) => ({
        id: `part-${part.id}`,
        content: [{ type: "staff" as const, sources: [{ part: part.id }] }],
      })),
    ],
    scores: [
      { name: "Full Score", layout: "full-score", pageSetup: { pageWidth: 210, pageHeight: 297 } },
      { name: "Oboi", layout: "part-P2" },
      { name: "Clarinetti in Bb", layout: "part-P3", useWritten: true },
      { name: "Fagotti", layout: "part-P4" },
      { name: "Corni in F", layout: "part-P5", useWritten: true },
      { name: "Trombe in Bb", layout: "part-P6" },
      { name: "Tromboni", layout: "part-P7" },
      ...nonTargets.map((part, index) => ({
        name: part.name,
        layout: `part-${part.id}`,
        ...(index === 0 ? { useWritten: false } : {}),
      })),
    ],
    soundProfile: {
      profileId: "test-profile",
      profileVersion: 1,
      parts: { P5: { sourceId: "horns" }, N1: { sourceId: "flute" } },
    },
  };
}

function makePrior21Score(): Score {
  const original = makeDocumentScore();
  const result = splitOrchestralParts(original);
  for (const sourceId of ["P3", "P4"] as const) {
    const source = structuredClone(original.parts.find((part) => part.id === sourceId)!);
    const firstIndex = result.parts.findIndex((part) => part.id === `${sourceId}-1`);
    result.parts.splice(firstIndex, 2, source);
    result.layouts = result
      .layouts!.filter((layout) => ![`part-${sourceId}-1`, `part-${sourceId}-2`].includes(layout.id))
      .map((layout) => ({ ...layout, content: collapsePlayerPair(layout.content, sourceId) }));
    result.layouts.push(structuredClone(original.layouts!.find((layout) => layout.id === `part-${sourceId}`)!));
    result.scores = result.scores!.filter(
      (definition) => ![`part-${sourceId}-1`, `part-${sourceId}-2`].includes(definition.layout ?? ""),
    );
    result.scores.push(
      structuredClone(original.scores!.find((definition) => definition.layout === `part-${sourceId}`)!),
    );
  }
  return result;
}

function collapsePlayerPair(content: readonly LayoutContent[], sourceId: string): LayoutContent[] {
  return content
    .map((node): LayoutContent => {
      if (node.type === "group") return { ...node, content: collapsePlayerPair(node.content, sourceId) };
      const sources = node.sources.map((source) =>
        source.part === `${sourceId}-1` || source.part === `${sourceId}-2` ? { ...source, part: sourceId } : source,
      );
      return {
        ...node,
        sources: sources.filter((source, index) => index === 0 || source.part !== sources[index - 1]!.part),
      };
    })
    .filter((node, index, nodes) => {
      if (node.type !== "staff" || index === 0 || nodes[index - 1]!.type !== "staff") return true;
      const previous = nodes[index - 1];
      return previous.type !== "staff" || previous.sources[0]?.part !== node.sources[0]?.part;
    });
}

function flatLayoutSources(content: readonly LayoutContent[]): string[][] {
  return content.flatMap((node): string[][] =>
    node.type === "group" ? flatLayoutSources(node.content) : [node.sources.map((source) => source.part)],
  );
}

function collectLayoutStaffs(content: readonly LayoutContent[]): LayoutStaff[] {
  return content.flatMap((node): LayoutStaff[] => (node.type === "group" ? collectLayoutStaffs(node.content) : [node]));
}

function findStaffByPart(content: readonly LayoutContent[], partId: string): LayoutStaff | undefined {
  for (const node of content) {
    if (node.type === "group") {
      const nested = findStaffByPart(node.content, partId);
      if (nested) return nested;
    } else if (node.sources.length === 1 && node.sources[0]?.part === partId) {
      return node;
    }
  }
  return undefined;
}

function findStaffByParts(content: readonly LayoutContent[], partIds: readonly string[]): LayoutStaff | undefined {
  for (const node of content) {
    if (node.type === "group") {
      const nested = findStaffByParts(node.content, partIds);
      if (nested) return nested;
    } else if (
      node.sources.length === partIds.length &&
      node.sources.every((source, index) => source.part === partIds[index])
    ) {
      return node;
    }
  }
  return undefined;
}

function findGroupByParts(
  content: readonly LayoutContent[],
  expectedParts: readonly string[],
): LayoutGroup | undefined {
  const expected = [...expectedParts].sort();
  for (const node of content) {
    if (node.type !== "group") continue;
    const actual = flatLayoutSources(node.content).flat().sort();
    if (actual.length === expected.length && actual.every((part, index) => part === expected[index])) return node;
    const nested = findGroupByParts(node.content, expectedParts);
    if (nested) return nested;
  }
  return undefined;
}

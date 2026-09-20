import { describe, expect, it } from "vitest";
import type { LayoutContent, Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import type { DisplayList } from "@viritura/renderer";
import { buildPatchJson, injectExpandedStaves, injectSyntheticLayout } from "../layoutHelpers";
import { getRenderedStaffSources, recordRenderedStaffSources } from "../renderedStaffSources";

function sourceScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          chordSymbols: [
            { position: { fraction: [0, 1] }, root: { step: "C" }, bass: { step: "E" } },
            { position: { fraction: [1, 2] }, root: { step: "G" }, quality: "dominant", bass: { step: "B" } },
          ],
        },
      ],
    },
    parts: [
      { id: "hidden", name: "Hidden", measures: [], chordSymbolVisibility: "hide" },
      {
        id: "bb",
        name: "B-flat",
        measures: [],
        chordSymbolVisibility: "show",
        transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
      },
      { id: "piano", name: "Piano", measures: [], staves: 2, chordSymbolVisibility: "auto" },
    ],
    layouts: [
      {
        id: "full",
        content: [
          {
            type: "group",
            symbol: "bracket",
            content: [
              {
                type: "staff",
                sources: [{ part: "hidden" }, { part: "bb", staff: 1, voice: "solo" }],
              },
              { type: "staff", sources: [{ part: "piano", staff: 1 }] },
              { type: "staff", sources: [{ part: "piano", staff: 2 }] },
            ],
          },
        ],
      },
    ],
    scores: [{ name: "Written", layout: "full", useWritten: true }],
  };
}

function staffSources(content: LayoutContent[]): unknown[] {
  return content.flatMap((node) => (node.type === "group" ? staffSources(node.content) : [node.sources]));
}

function project(score: Score, partIds: string[]) {
  const projection = injectSyntheticLayout(JSON.stringify(serializeMnx(score)), partIds, 0);
  const projected = parseMnx(JSON.parse(projection.json));
  const definition = projected.scores![projection.scoreIndex]!;
  const layout = projected.layouts!.find((candidate) => candidate.id === definition.layout)!;
  return { projected, definition, layout, projection };
}

describe("chord source projection", () => {
  it("retains selected condensed staves, preserving written mode and canonical root/bass", () => {
    const score = sourceScore();
    const before = structuredClone(score);
    const { projected, definition, layout } = project(score, ["bb"]);

    expect(staffSources(layout.content)).toEqual([[{ part: "hidden" }, { part: "bb", staff: 1, voice: "solo" }]]);
    expect(definition.useWritten).toBe(true);
    expect(projected.parts).toEqual(parseMnx(serializeMnx(score)).parts);
    expect(projected.parts[1]?.id).toBe("bb");
    expect(projected.global.measures[0]?.chordSymbols).toEqual(score.global.measures[0]?.chordSymbols);
    expect(score).toEqual(before);
  });

  it("keeps the whole progression when extracting a later grand-staff source", () => {
    const score = sourceScore();
    const { projected, layout } = project(score, ["piano", "piano"]);
    expect(staffSources(layout.content)).toEqual([[{ part: "piano", staff: 1 }], [{ part: "piano", staff: 2 }]]);
    expect(projected.global.measures[0]?.chordSymbols).toHaveLength(2);
    expect(projected.parts[2]?.chordSymbolVisibility).toBe("auto");
    expect(projected.parts.every((part) => part.measures.every((measure) => !("chordSymbols" in measure)))).toBe(true);
  });

  it("does not duplicate the global lane when a condensed source is expanded", () => {
    const score = sourceScore();
    const wire = serializeMnx(score);
    const expanded: typeof wire = JSON.parse(injectExpandedStaves(JSON.stringify(wire), 0, new Set(["0-0"])));
    expect(staffSources(expanded.layouts![0]!.content)).toEqual([
      [{ part: "hidden" }, { part: "bb", staff: 1, voice: "solo" }],
      [{ part: "hidden", labelref: "name" }],
      [{ part: "bb", staff: 1, voice: "solo", labelref: "name" }],
      [{ part: "piano", staff: 1 }],
      [{ part: "piano", staff: 2 }],
    ]);
    expect(expanded.parts).toEqual(wire.parts);
    expect(expanded.global).toEqual(wire.global);
  });

  it("retains explicit concert view through repeated projection without appending duplicate views", () => {
    const score = sourceScore();
    score.scores![0]!.useWritten = false;
    const { projection } = project(score, ["bb"]);
    const repeated = injectSyntheticLayout(projection.json, ["piano"], 0);
    const projected = parseMnx(JSON.parse(repeated.json));
    expect(repeated.scoreIndex).toBe(projection.scoreIndex);
    expect(projected.scores).toHaveLength(2);
    expect(projected.scores![repeated.scoreIndex]?.useWritten).toBe(false);
    expect(projected.global.measures[0]?.chordSymbols).toEqual(score.global.measures[0]?.chordSymbols);
  });

  it("sends chord edits only in changed global measures without materializing per-part harmony", () => {
    const wire = serializeMnx(sourceScore());
    const patch: unknown = JSON.parse(
      buildPatchJson(JSON.stringify(wire), {
        structuralChange: false,
        changedGlobalMeasures: [0],
        changedPartMeasures: new Map(),
      }),
    );
    expect(patch).toEqual({ globalMeasures: { 0: wire.global.measures[0] } });
  });

  it("uses only real unique source identities when synthesizing a layout without an authored tree", () => {
    const score = sourceScore();
    delete score.layouts;
    score.scores = [{ useWritten: true }];
    const { projected, layout } = project(score, ["bb", "missing", "bb", "piano"]);
    expect(staffSources(layout.content)).toEqual([
      [{ part: "bb", labelref: "name" }],
      [{ part: "piano", labelref: "name" }],
    ]);
    expect(projected.parts.map((part) => part.id)).toEqual(["hidden", "bb", "piano"]);
    expect(projected.global.measures[0]?.chordSymbols).toEqual(score.global.measures[0]?.chordSymbols);
  });

  it.each([
    { sourcePartIndices: [2, 1, 2], partIndex: 2, ids: ["piano", "bb"] },
    { sourcePartIndices: undefined, partIndex: 1, ids: ["bb"] },
    { sourcePartIndices: [99], partIndex: 0, ids: [] },
  ])("maps rendered staff 7 using engine source indices, not layout positions: $ids", (source) => {
    const displayList: DisplayList = {
      commands: [],
      width: 100,
      height: 100,
      measureBounds: [
        {
          index: 0,
          staffIndex: 7,
          partIndex: source.partIndex,
          sourcePartIndices: source.sourcePartIndices,
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          prefixWidth: 0,
          totalBeats: 4,
          beatAnchors: [],
        },
      ],
    };
    recordRenderedStaffSources(displayList, sourceScore());
    expect(getRenderedStaffSources(displayList)).toEqual([{ staffIndex: 7, measureIndex: 0, partIds: source.ids }]);
  });
});

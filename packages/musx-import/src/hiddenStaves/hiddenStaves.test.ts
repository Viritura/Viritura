import { describe, expect, it } from "vitest";
import { adaptHiddenStaves } from "./index";

type Json = Record<string, unknown>;

const rest = { content: [], fullMeasure: {} };
const note = {
  content: [{ duration: { base: "whole" }, id: "e", notes: [{ id: "n", pitch: { octave: 4, step: "C" } }] }],
};

function staff(part: string, labelref = "name"): Json {
  return { type: "staff", sources: [{ part, staff: 1, labelref }] };
}

function group(labelref: string, ...parts: string[]): Json {
  return { type: "group", symbol: "bracket", label: labelref, content: parts.map((part) => staff(part, labelref)) };
}

function document(systemLayouts: Record<string, unknown[]>, music: Record<string, boolean[]>): Json {
  return {
    global: { measures: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] },
    parts: Object.entries(music).map(([id, measures]) => ({
      id,
      name: `Part ${id}`,
      measures: measures.map((hasMusic, index) => ({ id: `${id}.m${index + 1}`, sequences: [hasMusic ? note : rest] })),
    })),
    layouts: [
      { id: "full", content: [group("name", "P1", "P2"), staff("P3")] },
      ...Object.entries(systemLayouts).map(([id, content]) => ({ id, content })),
    ],
    scores: [
      {
        name: "Score",
        layout: "full",
        pages: [
          {
            systems: [
              { measure: "m1", layout: "s1" },
              { measure: "m2", layout: "s2" },
              { measure: "m3", layout: "s3" },
            ],
          },
        ],
      },
    ],
  };
}

function adapt(source: Json) {
  const result = adaptHiddenStaves(JSON.stringify(source), undefined);
  return { document: JSON.parse(result.mnxJson) as Json, diagnostics: result.diagnostics };
}

function layout(doc: Json, id: string): unknown {
  return (doc["layouts"] as Json[]).find((entry) => entry["id"] === id)?.["content"];
}

function scoreExtension(doc: Json): unknown {
  return ((doc["scores"] as Json[])[0]!["_x"] as Json | undefined)?.["viritura"];
}

describe("adaptHiddenStaves", () => {
  it("turns Finale's hidden empty staves into the automatic policy with matching decisions", () => {
    const { document: doc, diagnostics } = adapt(
      document(
        {
          s1: [group("name", "P1", "P2"), staff("P3")],
          s2: [group("shortName", "P1")],
          s3: [group("shortName", "P1", "P2")],
        },
        { P1: [true, true, true], P2: [true, false, false], P3: [false, false, false] },
      ),
    );

    expect(scoreExtension(doc)).toEqual({
      autoHideEmptyParts: ["P2", "P3"],
      autoHideEmptyStaves: { firstSystem: "show", keepVisible: [{ measure: "m3", parts: ["P2"] }] },
    });
    expect(layout(doc, "s2")).toEqual([group("shortName", "P1", "P2"), staff("P3", "shortName")]);
    expect(layout(doc, "s3")).toEqual([group("shortName", "P1", "P2"), staff("P3", "shortName")]);
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: "info", message: expect.stringContaining("Part P2, Part P3") }),
    ]);
  });

  it("keeps Finale's explicit staff lists when a hidden staff contains music", () => {
    const source = document(
      { s1: [group("name", "P1", "P2"), staff("P3")], s2: [group("shortName", "P1")], s3: [group("shortName", "P1")] },
      { P1: [true, true, true], P2: [false, false, true], P3: [false, false, false] },
    );
    const { document: doc, diagnostics } = adapt(source);

    expect(scoreExtension(doc)).toBeUndefined();
    expect(layout(doc, "s3")).toEqual([group("shortName", "P1")]);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining("hid staves that contain music"),
    ]);
  });

  it("leaves reordered system layouts as manual decisions", () => {
    const source = document(
      {
        s1: [group("name", "P1", "P2"), staff("P3")],
        s2: [staff("P3"), group("name", "P1")],
        s3: [group("name", "P1", "P2"), staff("P3")],
      },
      { P1: [true, true, true], P2: [false, false, false], P3: [false, false, false] },
    );
    const { document: doc, diagnostics } = adapt(source);

    expect(scoreExtension(doc)).toBeUndefined();
    expect(layout(doc, "s2")).toEqual([staff("P3"), group("name", "P1")]);
    expect(diagnostics).toEqual([]);
  });

  it("warns that assigned cutaway staves import visible but ignores unassigned styles", () => {
    const xml = `
      <others>
        <staffStyle cmper="11"><hideMode>cutaway</hideMode></staffStyle>
        <staffStyle cmper="21"><hideMode>scoreParts</hideMode></staffStyle>
        <staffStyleAssign cmper="3" inci="0"><style>11</style><startMeas>1</startMeas></staffStyleAssign>
        <staffStyleAssign cmper="3" inci="0" part="1" shared="false"><style>11</style></staffStyleAssign>
        <staffStyleAssign cmper="4" inci="0"><style>21</style></staffStyleAssign>
        <staffSpec cmper="5"><hideMode>cutaway</hideMode></staffSpec>
      </others>`;
    const full = [group("name", "P1", "P2"), staff("P3")];
    const plain = JSON.stringify(
      document(
        { s1: full, s2: full, s3: full },
        { P1: [true, true, true], P2: [true, true, true], P3: [true, true, true] },
      ),
    );

    expect(adaptHiddenStaves(plain, xml).diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("2 staves import fully visible"),
      }),
    ]);
    expect(
      adaptHiddenStaves(plain, '<staffStyle cmper="11"><hideMode>cutaway</hideMode></staffStyle>').diagnostics,
    ).toEqual([]);
  });
});

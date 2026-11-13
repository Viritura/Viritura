import { describe, expect, it } from "vitest";
import type { LayoutContent, Part } from "@viritura/core";
import { buildCondensedLayoutContent } from "./condensedLayout";

describe("condensed instrument identity", () => {
  const content: LayoutContent[] = [
    {
      type: "group",
      symbol: "bracket",
      content: [
        { type: "staff", sources: [{ part: "ob1" }] },
        { type: "staff", sources: [{ part: "ob2" }] },
      ],
    },
  ];
  const parts: Part[] = [
    { id: "ob1", name: "Oboe 1", measures: [], _x: { viritura: { instrumentId: "wind.reed.oboe" } } },
    {
      id: "ob2",
      name: "Oboe in C",
      measures: [],
      _x: {
        viritura: {
          initialInstrument: "ob",
          instruments: {
            ob: { instrumentId: "wind.reed.oboe", name: "Oboe", midiProgram: 68 },
            eh: { instrumentId: "wind.reed.english-horn", name: "English Horn" },
          },
        },
      },
    },
  ];

  it("pairs a doubling oboe with a plain oboe despite different display names", () => {
    expect(buildCondensedLayoutContent(content, parts)).toEqual([
      {
        type: "group",
        symbol: "bracket",
        content: [{ type: "staff", sources: [{ part: "ob1" }, { part: "ob2" }] }],
      },
    ]);
  });

  it("does not pair matching names with different identities or intervals", () => {
    for (const second of [
      { ...parts[1]!, _x: { viritura: { instrumentId: "wind.reed.english-horn" } } },
      { ...parts[1]!, transposition: { interval: { halfSteps: 7, staffDistance: 4 } } },
    ]) {
      const result = buildCondensedLayoutContent(content, [parts[0]!, second]);
      expect(result[0]?.type === "group" && result[0].content).toHaveLength(2);
    }
  });

  it("retains name-based pairing for legacy parts without catalog identities", () => {
    expect(
      buildCondensedLayoutContent(
        content,
        parts.map((part, index) => ({
          ...part,
          name: `Oboe ${index + 1}`,
          _x: undefined,
        })),
      ),
    ).toEqual([
      {
        type: "group",
        symbol: "bracket",
        content: [{ type: "staff", sources: [{ part: "ob1" }, { part: "ob2" }] }],
      },
    ]);
  });
});
